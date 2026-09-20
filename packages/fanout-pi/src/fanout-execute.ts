import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadActiveExecutionPacket } from "../../fanout-core/src/active-packet.ts";
import type { ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { runDag, type DagRunResult, type DagNodeState } from "../../fanout-core/src/dag-scheduler.ts";
import type { FanoutExecutionPacket } from "../../fanout-core/src/execution-packet.ts";
import type { PreflightCommandEvidence, PreflightComparison, PreflightEvidence, PreflightIssue } from "../../fanout-core/src/execution-event.ts";
import type { ExecutionRunProjection } from "../../fanout-core/src/execution-projection.ts";
import type { FinalControllerResult } from "../../fanout-core/src/final-validation.ts";
import type { ValidationCommand } from "../../fanout-core/src/validation-command.ts";
import type { ProjectExecutionProfile } from "../../fanout-core/src/project-execution-profile.ts";
import { contractWriteResources } from "../../fanout-core/src/work-contract.ts";
import { FanoutNodeExecutor } from "./fanout-node-executor.ts";
import { fullGitVisibleTree } from "./repository-identity.ts";
import { RuntimeEventRecorder, commandIdentity } from "./runtime-event-recorder.ts";
import { preflightValidationCommands } from "./validation-runner.ts";
import { WORKER_MODEL_TOOLS, WORKER_TRUST_BOUNDARY } from "./worker-capabilities.ts";
import { loadProjectExecutionProfile, validateProjectExecutionProfile } from "./project-execution-profile.ts";
import { SHARED_WORKTREE_PATHS_ENV } from "./worktree-preparation.ts";

export interface ExecuteFanoutOptions {
	cwd: string;
	activePointerPath: string;
	projectArtifactRoot: string;
	extensionEntry: string;
	confirm?: (title: string, message: string) => boolean | Promise<boolean>;
	dryRun?: boolean;
	piCommand?: string;
	runId?: string;
	workerTimeoutMs?: number;
	validationTimeoutMs?: number;
	/** Deterministic crash-race injection for repository-boundary regression tests. */
	afterActiveApply?: () => void;
}

export interface ExecutionRecorderPaths { runDir: string; eventsPath: string; snapshotPath: string; summaryPath: string; }
export interface ExecuteFanoutResult {
	status: "succeeded" | "failed" | "aborted";
	runId: string;
	packetPath: string;
	paths: ExecutionRecorderPaths;
	snapshot: Readonly<ExecutionRunProjection>;
	dag?: DagRunResult;
	finalValidation?: FinalControllerResult;
	error?: string;
	dryRun?: boolean;
}

export async function executeFanout(options: ExecuteFanoutOptions): Promise<ExecuteFanoutResult> {
	const started = Date.now();
	// Exact pointer/packet admission intentionally precedes lock creation and every repository mutation (A18).
	const loaded = loadActiveExecutionPacket(options.activePointerPath, options.projectArtifactRoot);
	if (process.env[SHARED_WORKTREE_PATHS_ENV] !== undefined || Object.hasOwn(options, "worktreeSharedPaths")) throw new Error(`${SHARED_WORKTREE_PATHS_ENV} and shared worktree paths are unsupported; refresh the Project Execution Profile`);
	const loadedProfile = loadProjectExecutionProfile(loaded.packet.profile, options.projectArtifactRoot);
	rejectArtifactStorageInsideWorktree(options.cwd, loaded.projectArtifactRoot, loaded.artifactDir);
	const admission = inspectPlanningBase(options, loaded.packet);
	if (admission.issues.length) throw new Error(`Fanout preflight failed: ${admission.issues.map((issue) => issue.detail).join("; ")}`);
	inspectWorkerCapabilities(options, loaded.packet, admission.repoRoot!, admission.issues);
	if (admission.issues.length) throw new Error(`Fanout preflight failed: ${admission.issues.map((issue) => issue.detail).join("; ")}`);
	if (!loaded.packet.nodes.at(-1)!.workContract.validationCommands.length && !loadedProfile.profile.requiredFinalGates.length) throw new Error("final validation requires at least one packet or profile gate; rerun /fanout-plan");
	const runId = options.runId === undefined ? executionRunId() : canonicalRunId(options.runId);
	const { maxConcurrency, failFast, fallbackAllowed } = loaded.packet.runtimePolicy;
	const runDir = join(loaded.artifactDir, "executions", runId);
	const release = acquireExecutionLock(executionLockPath(options.cwd, loaded.projectArtifactRoot), runId);
	let recorder: RuntimeEventRecorder | undefined;
	let executor: FanoutNodeExecutor | undefined;
	let dag: DagRunResult | undefined;
	let finalValidation: FinalControllerResult | undefined;
	try {
		recorder = new RuntimeEventRecorder(runDir, runId);
		const profileValidation = await validateProjectExecutionProfile(loadedProfile.profile, { repoRoot: options.cwd, runDir, planningBase: loaded.packet.planningBase, profileIdentity: loadedProfile.identity, timeoutMs: options.validationTimeoutMs });
		const preflight = runPreflight(options, loaded.packet, loadedProfile.profile);
		if (profileValidation.evidence.status !== "passed") preflight.issues.push({ code: "capability-unavailable", detail: profileValidation.evidence.error ?? "Project Execution Profile validation failed" });
		await recorder.record("run-started", {
			mode: options.dryRun ? "dry-run" : "live",
			packet: loaded.pointer.packet,
			planningBaseTree: loaded.packet.planningBase.tree,
			nodeIds: loaded.packet.nodes.filter((node) => node.kind !== "final-validation").map((node) => node.id),
			policy: { maxConcurrency, failFast, fallbackAllowed },
			profile: loadedProfile.identity,
			profileValidation: profileValidation.artifact,
			preflightEvidence: preflight.evidence,
		});
		let projection = await recorder.record("preflight-completed", { status: preflight.issues.length ? "failed" : "passed", planningBaseTree: loaded.packet.planningBase.tree, repositoryTree: preflight.tree, issues: preflight.issues });
		if (preflight.issues.length) return await finish(recorder, executor, loaded, started, "failed", { kind: "event", eventSequence: projection.preflight!.eventSequence, code: "preflight-failed" }, { error: `Fanout preflight failed: ${preflight.issues.map((issue) => issue.detail).join("; ")}` });
		if (options.dryRun) return await finish(recorder, executor, loaded, started, "dry-run-completed", { kind: "event", eventSequence: projection.preflight!.eventSequence, code: "dry-run" }, { dryRun: true });

		const confirmed = options.confirm ? await options.confirm("Execute Fanout packet", confirmationSummary(loaded.packet, loaded.pointer.packet, loaded.packetPath, loadedProfile.profile, maxConcurrency, runDir)) : false;
		projection = await recorder.record("confirmation-decided", { decision: confirmed ? "accepted" : "declined" });
		if (!confirmed) return await finish(recorder, executor, loaded, started, "aborted", { kind: "event", eventSequence: projection.confirmationEventSequence!, code: "confirmation-declined" });

		executor = new FanoutNodeExecutor({ packet: loaded.packet, packetIdentity: loaded.pointer.packet, profile: loadedProfile.profile, profileIdentity: loadedProfile.identity, repoRoot: preflight.repoRoot!, runDir, runId, extensionEntry: options.extensionEntry, recorder, piCommand: options.piCommand, workerTimeoutMs: options.workerTimeoutMs, validationTimeoutMs: options.validationTimeoutMs, afterActiveApply: options.afterActiveApply });
		dag = await runDag(loaded.packet, {
			maxConcurrency,
			failFast,
			runNode: executor.runNode.bind(executor),
			onNodeCompleted: recordNodeCompletion.bind(undefined, recorder),
		});
		if (!dag.ok) {
			projection = recorder.projection();
			const failed = projection.nodes.find((node) => node.status === "failed") ?? projection.nodes.find((node) => node.status === "skipped")!;
			return await finish(recorder, executor, loaded, started, "failed", { kind: "event", eventSequence: failed.completionSequence!, code: failed.status === "failed" ? "node-failed" : "dependency-failed", nodeId: failed.id, ...(failed.causalAttemptId ? { attemptId: failed.causalAttemptId } : {}) }, { dag, error: "one or more DAG nodes failed" });
		}

		const finalNode = loaded.packet.nodes.find((node) => node.kind === "final-validation")!;
		const expectedTree = recorder.projection().acceptedLedger.at(-1)?.transition.patch.resultTree ?? loaded.packet.planningBase.tree;
		const finalCommands = executor.finalValidationCommands(finalNode.workContract.validationCommands);
		projection = await recorder.record("final-validation-started", { commandIdentities: finalCommands.map(commandIdentity), expectedTree });
		finalValidation = await executor.runFinalValidation(finalNode.workContract.validationCommands);
		const round = finalValidation.lastRound;
		projection = await recorder.record("final-validation-completed", {
			status: finalValidation.status,
			lastRound: round ? {
				status: round.status,
				commandCount: round.commandCount,
				durationMs: round.durationMs,
				evidence: round.evidenceArtifact,
				expectedTree: round.evidence.expectedValidationTree,
				beforeTree: round.evidence.validation.before.tree,
				afterTree: round.evidence.validation.after.tree,
			} : null,
			totalCommandDurationMs: finalValidation.totalCommandDurationMs,
			...(finalValidation.failure ? { failure: finalValidation.failure } : {}),
		});
		if (finalValidation.status !== "passed") return await finish(recorder, executor, loaded, started, "failed", { kind: "event", eventSequence: projection.finalValidation.disposition === "failed" ? projection.finalValidation.completionSequence : 0, code: "final-validation-failed" }, { dag, finalValidation, error: "final validation failed" });
		return await finish(recorder, executor, loaded, started, "completed", { kind: "event", eventSequence: projection.finalValidation.disposition === "passed" ? projection.finalValidation.completionSequence : 0, code: "final-validation-passed" }, { dag, finalValidation });
	} catch (error) {
		if (recorder?.store.projection()?.acceptedLedger.length) executor?.retainMutationLock();
		if (!recorder?.store.projection()) throw error;
		const projection = recorder.projection();
		if (projection.terminalOutcome) throw error;
		const aborted = projection.attempts.find((attempt) => attempt.outcome?.action === "abort");
		if (aborted) return await finish(recorder, executor, loaded, started, "aborted", { kind: "event", eventSequence: aborted.completionSequence!, code: "user-abort", nodeId: aborted.allocation.nodeId, attemptId: aborted.allocation.attemptId }, { dag, finalValidation, error: message(error), dryRun: options.dryRun });
		return await finish(recorder, executor, loaded, started, "failed", { kind: "controller", stage: projection.phase === "finished" ? "attempts" : projection.phase, code: "internal-failure", detail: message(error) }, { dag, finalValidation, error: message(error), dryRun: options.dryRun });
	} finally {
		try {
			if (!recorder?.store.projection()?.terminalOutcome) executor?.cleanupWorktrees();
		} finally {
			if (!executor?.manualReconciliationRequired) release();
		}
	}
}

async function recordNodeCompletion(recorder: RuntimeEventRecorder, node: DagNodeState): Promise<void> {
	if (node.status === "succeeded" || node.status === "failed") {
		if (!node.result?.attemptId) throw new Error(`node ${node.id} completed without a causal attempt`);
		await recorder.record("node-completed", { nodeId: node.id, status: node.status, cause: { attemptId: node.result.attemptId } });
	} else if (node.status === "skipped") {
		if (node.failFastCause) {
			await recorder.record("node-completed", { nodeId: node.id, status: "skipped", cause: { policy: "fail-fast", triggerNodeId: node.failFastCause.nodeId, triggerAttemptId: node.failFastCause.attemptId } });
			return;
		}
		if (!node.upstreamNodeId) throw new Error(`skipped node ${node.id} has no upstream cause`);
		await recorder.record("node-completed", { nodeId: node.id, status: "skipped", cause: { upstreamNodeId: node.upstreamNodeId } });
	}
}

async function finish(recorder: RuntimeEventRecorder, executor: FanoutNodeExecutor | undefined, loaded: ReturnType<typeof loadActiveExecutionPacket>, started: number, outcome: "completed" | "dry-run-completed" | "failed" | "aborted", cause: Record<string, unknown>, extra: Partial<ExecuteFanoutResult> = {}): Promise<ExecuteFanoutResult> {
	const cleanupStarted = performance.now();
	let cleanupFailure: unknown;
	try { executor?.cleanupWorktrees(); } catch (error) { cleanupFailure = error; }
	const cleanupDurationMs = Math.max(0, performance.now() - cleanupStarted);
	const terminalOutcome = cleanupFailure ? "failed" : outcome;
	const terminalCause = cleanupFailure ? { kind: "controller", stage: "cleanup", code: "internal-failure", detail: message(cleanupFailure) } : cause;
	const projection = await recorder.record("run-finished", { outcome: terminalOutcome, durationMs: Math.max(0, Date.now() - started), cleanupDurationMs, cause: terminalCause });
	return {
		status: terminalOutcome === "completed" || terminalOutcome === "dry-run-completed" ? "succeeded" : terminalOutcome,
		runId: projection.runId,
		packetPath: loaded.packetPath,
		paths: recorder.paths,
		snapshot: projection,
		...extra,
		...(cleanupFailure ? { error: [extra.error, `cleanup failed: ${message(cleanupFailure)}`].filter(Boolean).join("; ") } : {}),
	} as ExecuteFanoutResult;
}

function inspectPlanningBase(options: ExecuteFanoutOptions, packet: FanoutExecutionPacket) {
	const issues: PreflightIssue[] = [];
	const top = command("git", ["rev-parse", "--show-toplevel"], options.cwd);
	const repoRoot = top.status === 0 ? resolve(top.stdout.trim()) : undefined;
	let actualCommit: string | null = null;
	let actualTree: string | null = null;
	if (!repoRoot) issues.push({ code: "controller-failure", detail: "active directory is not a Git worktree" });
	else {
		const head = command("git", ["rev-parse", "--verify", "HEAD^{commit}"], repoRoot);
		actualCommit = head.status === 0 ? head.stdout.trim() : null;
		if (actualCommit !== packet.planningBase.headCommit) issues.push({ code: "planning-base-mismatch", detail: "active HEAD differs from the packet planning commit; rerun /fanout-plan" });
		const committedTree = command("git", ["rev-parse", "--verify", `${packet.planningBase.headCommit}^{tree}`], repoRoot);
		if (committedTree.status !== 0) issues.push({ code: "planning-base-mismatch", detail: "packet planning commit is unavailable; rerun /fanout-plan" });
		else if (committedTree.stdout.trim() !== packet.planningBase.tree) issues.push({ code: "planning-base-mismatch", detail: "packet planning base contains non-HEAD content that detached workers cannot reconstruct; commit, stash, or remove it and rerun /fanout-plan" });
		try { actualTree = fullGitVisibleTree(repoRoot); if (actualTree !== packet.planningBase.tree) issues.push({ code: "repository-tree-mismatch", detail: "active Git-visible tree differs from the packet planning base; rerun /fanout-plan" }); }
		catch (error) { issues.push({ code: "controller-failure", detail: message(error) }); }
	}
	if (packet.planningHost.platform !== process.platform) issues.push({ code: "platform-mismatch", detail: `packet was planned for ${packet.planningHost.platform}, running ${process.platform}; rerun /fanout-plan` });
	return { issues, repoRoot, actualCommit, actualTree };
}

function inspectWorkerCapabilities(options: ExecuteFanoutOptions, packet: FanoutExecutionPacket, repoRoot: string, issues: PreflightIssue[]): PreflightEvidence["worker"] {
	const requestedExtension = resolve(options.extensionEntry);
	let resolvedExtension: string | null = null;
	try {
		const candidate = realpathSync(requestedExtension);
		accessSync(candidate, constants.R_OK);
		if (statSync(candidate).isFile()) resolvedExtension = candidate;
	}
	catch { /* The closed unavailable evidence below is authoritative. */ }
	if (!resolvedExtension) issues.push({ code: "capability-unavailable", detail: "Fanout extension entry is unavailable" });
	const launcherExecutable = options.piCommand ?? process.env.FANOUT_PI_COMMAND ?? "pi";
	const launcher = preflightLauncher(launcherExecutable, repoRoot ?? options.cwd, packet.planningHost.platform);
	if (launcher.status === "unavailable") issues.push({ code: "capability-unavailable", detail: "Pi worker command is unavailable" });
	return { extension: { requested: requestedExtension, resolved: resolvedExtension, status: resolvedExtension ? "available" : "unavailable" }, launcher, modelCallableTools: [...WORKER_MODEL_TOOLS] };
}

function runPreflight(options: ExecuteFanoutOptions, packet: FanoutExecutionPacket, profile: ProjectExecutionProfile): { repoRoot?: string; tree: string; issues: PreflightIssue[]; evidence: PreflightEvidence } {
	const { issues, repoRoot, actualCommit, actualTree } = inspectPlanningBase(options, packet);
	const worker = inspectWorkerCapabilities(options, packet, repoRoot ?? options.cwd, issues);
	const candidateNormalizationCommands = preflightProfileCommands(packet, profile.candidateNormalization.map((entry) => entry.command), repoRoot, issues, "candidate normalization");
	const validationCommands = [...preflightCommands(packet, "validationCommands", repoRoot, issues, "validation"), ...preflightProfileCommands(packet, profile.requiredFinalGates.map((entry) => entry.command), repoRoot, issues, "required final gate", true)];
	return {
		repoRoot,
		tree: actualTree ?? packet.planningBase.tree,
		issues,
		evidence: {
			planningCommit: comparison(packet.planningBase.headCommit, actualCommit),
			repositoryTree: comparison(packet.planningBase.tree, actualTree),
			platform: comparison(packet.planningHost.platform, process.platform),
			worker,
			commandCounts: {
				candidateNormalization: packet.nodes.map(() => profile.candidateNormalization.length),
				validation: packet.nodes.map((node, index) => node.workContract.validationCommands.length + (index === packet.nodes.length - 1 ? profile.requiredFinalGates.length : 0)),
			},
			candidateNormalizationCommands,
			validationCommands,
		},
	};
}

function preflightLauncher(executable: string, checkoutRoot: string, expectedPlatform: NodeJS.Platform): PreflightEvidence["worker"]["launcher"] {
	const args = ["--version"];
	let resolvedExecutable: string | null = null;
	let resolvedCwd: string | null = null;
	try {
		const prepared = preflightValidationCommands([{ executable, args }], { checkoutRoot, expectedPlatform })[0];
		resolvedExecutable = prepared.resolvedExecutable;
		resolvedCwd = prepared.resolvedCwd;
		const result = command(resolvedExecutable, args, resolvedCwd);
		const version = result.status === 0 ? result.stdout.trim() : "";
		if (version) return { executable, args, resolvedExecutable, resolvedCwd, version, status: "available" };
	} catch { /* Closed unavailable evidence is returned below. */ }
	return { executable, args, resolvedExecutable, resolvedCwd, version: null, status: "unavailable" };
}

function preflightCommands(
	packet: FanoutExecutionPacket,
	field: "validationCommands",
	repoRoot: string | undefined,
	issues: PreflightIssue[],
	label: string,
): PreflightCommandEvidence[] {
	return packet.nodes.flatMap((node, packetNodeIndex) => node.workContract[field].map((manifest, commandIndex) => {
		let resolution: PreflightCommandEvidence["resolution"] = { status: "unavailable", resolvedExecutable: null, resolvedCwd: null };
		if (repoRoot) {
			try {
				const prepared = preflightValidationCommands([manifest], { checkoutRoot: repoRoot, expectedPlatform: packet.planningHost.platform })[0];
				resolution = { status: "available", resolvedExecutable: prepared.resolvedExecutable, resolvedCwd: prepared.resolvedCwd };
			} catch (error) {
				issues.push({ code: "executable-unavailable", detail: `${label} ${node.id}[${commandIndex}]: ${message(error)}` });
			}
		}
		return { packetNodeIndex, nodeId: node.id, commandIndex, manifest: commandManifest(manifest), resolution };
	}));
}

function preflightProfileCommands(
	packet: FanoutExecutionPacket,
	commands: readonly ValidationCommand[],
	repoRoot: string | undefined,
	issues: PreflightIssue[],
	label: string,
	finalOnly = false,
): PreflightCommandEvidence[] {
	const indexes = finalOnly ? [packet.nodes.length - 1] : packet.nodes.map((_, index) => index);
	return indexes.flatMap((packetNodeIndex) => commands.map((manifest, commandIndex) => {
		let resolution: PreflightCommandEvidence["resolution"] = { status: "unavailable", resolvedExecutable: null, resolvedCwd: null };
		if (repoRoot) {
			try {
				const prepared = preflightValidationCommands([manifest], { checkoutRoot: repoRoot, expectedPlatform: packet.planningHost.platform })[0];
				resolution = { status: "available", resolvedExecutable: prepared.resolvedExecutable, resolvedCwd: prepared.resolvedCwd };
			} catch (error) {
				issues.push({ code: "executable-unavailable", detail: `${label}[${commandIndex}]: ${message(error)}` });
			}
		}
		return { packetNodeIndex, nodeId: packet.nodes[packetNodeIndex].id, commandIndex: finalOnly ? packet.nodes[packetNodeIndex].workContract.validationCommands.length + commandIndex : commandIndex, manifest: commandManifest(manifest), resolution };
	}));
}

function commandManifest(command: ValidationCommand): PreflightCommandEvidence["manifest"] {
	return { executable: command.executable, args: [...command.args], cwd: command.cwd ?? null };
}

function comparison(expected: string, actual: string | null): PreflightComparison {
	return { expected, actual, status: actual === null ? "unavailable" : actual === expected ? "matched" : "mismatched" };
}

function confirmationSummary(packet: FanoutExecutionPacket, packetIdentity: ArtifactIdentity, packetPath: string, profile: ProjectExecutionProfile, maxConcurrency: number, runDir: string): string {
	const writes = [...new Set(packet.nodes.flatMap((node) => contractWriteResources(node.workContract).map((resource) => `${resource.kind}:${resource.path}`)))];
	const normalizers = profile.candidateNormalization.map((entry) => JSON.stringify(entry.command));
	return [`Objective: ${packet.objective}`, `Packet: ${packetPath}`, `SHA-256: ${packetIdentity.sha256}`, `Bytes: ${packetIdentity.byteLength}`, `Planning base: ${packet.planningBase.tree}`, "Invocation already authorized exact profile validation, including possible external/network effects. Confirmation authorizes workers and active apply.", `Project Execution Profile: ${profile.profileId}`, `Work nodes: ${packet.nodes.length - 1}`, `Maximum concurrency: ${maxConcurrency}`, `Typed writes: ${writes.join(", ") || "none"}`, `Preparation commands: ${profile.preparation.length}`, `Readiness commands: ${profile.readiness.length}`, `Candidate normalization manifests: ${normalizers.join(", ") || "none"}`, `Validation manifests: ${packet.nodes.reduce((sum, node) => sum + node.workContract.validationCommands.length, 0) + profile.requiredFinalGates.length}`, WORKER_TRUST_BOUNDARY, `Audit artifacts: ${runDir}`].join("\n");
}

function command(executable: string, args: string[], cwd: string) { const result = spawnSync(executable, executable === "git" ? ["-c", "core.fsmonitor=false", ...args] : args, { cwd, encoding: "utf8", timeout: 30_000 }); return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }; }
function executionRunId(): string { return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`; }
function canonicalRunId(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("runId must be one canonical path segment"); return value; }
function rejectArtifactStorageInsideWorktree(cwd: string, projectArtifactRoot: string, packetArtifactDir: string): void { const top = command("git", ["rev-parse", "--show-toplevel"], cwd); if (top.status !== 0) return; const root = resolve(top.stdout.trim()); for (const path of [projectArtifactRoot, packetArtifactDir]) if (contained(resolve(path), root)) throw new Error("execution artifacts must be outside the active repository"); }
function acquireExecutionLock(path: string, runId: string): () => void { mkdirSync(dirname(path), { recursive: true }); const owner = { runId, pid: process.pid }; try { writeFileSync(path, `${JSON.stringify(owner)}\n`, { flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Fanout execution is already locked at ${path}`); throw error; } return () => { try { const current = JSON.parse(readFileSync(path, "utf8")); if (current.runId === runId && current.pid === process.pid) unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }; }
function executionLockPath(cwd: string, artifactRoot: string): string { const git = command("git", ["rev-parse", "--absolute-git-dir"], cwd); return git.status === 0 ? join(realPath(git.stdout.trim()), "fanout-execution.lock") : join(artifactRoot, "execution.lock"); }
function realPath(path: string): string { try { return realpathSync(resolve(path)); } catch { return resolve(path); } }
function contained(path: string, root: string): boolean { const value = relative(root, path); return value === "" || value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
