import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadActiveExecutionPacket } from "../../fanout-core/src/active-packet.ts";
import { runDag, type DagRunResult, type DagNodeState } from "../../fanout-core/src/dag-scheduler.ts";
import type { FanoutExecutionPacket } from "../../fanout-core/src/execution-packet.ts";
import type { ExecutionRunProjection } from "../../fanout-core/src/execution-projection.ts";
import type { FinalValidationResult } from "../../fanout-core/src/final-validation.ts";
import { contractWriteResources } from "../../fanout-core/src/work-contract.ts";
import { createFanoutNodeExecutor } from "./fanout-node-executor.ts";
import { fullGitVisibleTree } from "./repository-identity.ts";
import { RuntimeEventRecorder, commandIdentity } from "./runtime-event-recorder.ts";
import { preflightValidationCommands } from "./validation-runner.ts";
import { WORKER_TRUST_BOUNDARY } from "./worker-capabilities.ts";
import { parseSharedWorktreePaths, validateSharedWorktreePaths } from "./worktree-preparation.ts";

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
	worktreeSharedPaths?: readonly string[];
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
	finalValidation?: FinalValidationResult;
	error?: string;
	dryRun?: boolean;
}

export async function executeFanout(options: ExecuteFanoutOptions): Promise<ExecuteFanoutResult> {
	// Exact pointer/packet admission intentionally precedes lock creation and every repository mutation (A18).
	const loaded = loadActiveExecutionPacket(options.activePointerPath, options.projectArtifactRoot);
	rejectArtifactStorageInsideWorktree(options.cwd, loaded.projectArtifactRoot, loaded.artifactDir);
	const runId = options.runId === undefined ? executionRunId() : canonicalRunId(options.runId);
	const worktreeSharedPaths = options.worktreeSharedPaths === undefined ? parseSharedWorktreePaths() : parseSharedWorktreePaths(JSON.stringify(options.worktreeSharedPaths));
	const { maxConcurrency, failFast, fallbackAllowed } = loaded.packet.runtimePolicy;
	const runDir = join(loaded.artifactDir, "executions", runId);
	const release = acquireExecutionLock(executionLockPath(options.cwd, loaded.projectArtifactRoot), runId);
	let recorder: RuntimeEventRecorder | undefined;
	let executor: ReturnType<typeof createFanoutNodeExecutor> | undefined;
	const started = Date.now();
	let dag: DagRunResult | undefined;
	let finalValidation: FinalValidationResult | undefined;
	try {
		recorder = new RuntimeEventRecorder(runDir, runId);
		await recorder.record("run-started", {
			mode: options.dryRun ? "dry-run" : "live",
			packet: loaded.pointer.packet,
			planningBaseTree: loaded.packet.planningBase.tree,
			nodeIds: loaded.packet.nodes.filter((node) => node.kind !== "final-validation").map((node) => node.id),
			policy: { maxConcurrency, failFast, fallbackAllowed },
		});
		const preflight = runPreflight(options, loaded.packet, worktreeSharedPaths);
		let projection = await recorder.record("preflight-completed", { status: preflight.issues.length ? "failed" : "passed", planningBaseTree: loaded.packet.planningBase.tree, repositoryTree: preflight.tree, issues: preflight.issues });
		if (preflight.issues.length) return await finish(recorder, loaded, started, "failed", { kind: "event", eventSequence: projection.preflight!.eventSequence, code: "preflight-failed" }, { error: `Fanout preflight failed: ${preflight.issues.map((issue) => issue.detail).join("; ")}` });
		if (options.dryRun) return await finish(recorder, loaded, started, "dry-run-completed", { kind: "event", eventSequence: projection.preflight!.eventSequence, code: "dry-run" }, { dryRun: true });

		const confirmed = options.confirm ? await options.confirm("Execute Fanout packet", confirmationSummary(loaded.packet, maxConcurrency, runDir, worktreeSharedPaths)) : false;
		projection = await recorder.record("confirmation-decided", { decision: confirmed ? "accepted" : "declined" });
		if (!confirmed) return await finish(recorder, loaded, started, "aborted", { kind: "event", eventSequence: projection.confirmationEventSequence!, code: "confirmation-declined" });

		executor = createFanoutNodeExecutor({ packet: loaded.packet, packetIdentity: loaded.pointer.packet, repoRoot: preflight.repoRoot!, runDir, runId, extensionEntry: options.extensionEntry, recorder, piCommand: options.piCommand, workerTimeoutMs: options.workerTimeoutMs, validationTimeoutMs: options.validationTimeoutMs, worktreeSharedPaths, afterActiveApply: options.afterActiveApply });
		dag = await runDag(loaded.packet, {
			maxConcurrency,
			failFast,
			runNode: (node, signal) => executor.runNode(node, signal),
			onNodeCompleted: async (node) => { await recordNodeCompletion(recorder, node); },
		});
		if (!dag.ok) {
			projection = recorder.projection();
			const failed = projection.nodes.find((node) => node.status === "failed") ?? projection.nodes.find((node) => node.status === "skipped")!;
			return await finish(recorder, loaded, started, "failed", { kind: "event", eventSequence: failed.completionSequence!, code: failed.status === "failed" ? "node-failed" : "dependency-failed", nodeId: failed.id, ...(failed.causalAttemptId ? { attemptId: failed.causalAttemptId } : {}) }, { dag, error: "one or more DAG nodes failed" });
		}

		const finalNode = loaded.packet.nodes.find((node) => node.kind === "final-validation")!;
		const expectedTree = recorder.projection().acceptedLedger.at(-1)?.transition.patch.resultTree ?? loaded.packet.planningBase.tree;
		projection = await recorder.record("final-validation-started", { commandIdentities: finalNode.workContract.validationCommands.map(commandIdentity), expectedTree });
		finalValidation = await executor.runFinalValidation(finalNode.workContract.validationCommands);
		const validatedTree = finalValidation.evidence.expectedValidationTree;
		projection = await recorder.record("final-validation-completed", {
			status: finalValidation.status,
			commandCount: finalValidation.commandCount,
			durationMs: finalValidation.durationMs,
			evidence: finalValidation.evidenceArtifact,
			expectedTree: validatedTree,
			beforeTree: finalValidation.evidence.validation.before.tree,
			afterTree: finalValidation.evidence.validation.after.tree,
		});
		if (finalValidation.status !== "passed") return await finish(recorder, loaded, started, "failed", { kind: "event", eventSequence: projection.finalValidation.disposition === "failed" ? projection.finalValidation.completionSequence : 0, code: "final-validation-failed" }, { dag, finalValidation, error: "final validation failed" });
		return await finish(recorder, loaded, started, "completed", { kind: "event", eventSequence: projection.finalValidation.disposition === "passed" ? projection.finalValidation.completionSequence : 0, code: "final-validation-passed" }, { dag, finalValidation });
	} catch (error) {
		if (!recorder?.store.projection()) throw error;
		const projection = recorder.projection();
		if (projection.terminalOutcome) throw error;
		const aborted = projection.attempts.find((attempt) => attempt.outcome?.action === "abort");
		if (aborted) return await finish(recorder, loaded, started, "aborted", { kind: "event", eventSequence: aborted.completionSequence!, code: "user-abort", nodeId: aborted.allocation.nodeId, attemptId: aborted.allocation.attemptId }, { dag, finalValidation, error: message(error), dryRun: options.dryRun });
		return await finish(recorder, loaded, started, "failed", { kind: "controller", stage: projection.phase === "finished" ? "attempts" : projection.phase, code: "internal-failure", detail: message(error) }, { dag, finalValidation, error: message(error), dryRun: options.dryRun });
	} finally {
		try { executor?.cleanupWorktrees(); } finally { if (!executor?.manualReconciliationRequired) release(); }
	}
}

async function recordNodeCompletion(recorder: RuntimeEventRecorder, node: DagNodeState): Promise<void> {
	if (node.status === "succeeded" || node.status === "failed") {
		if (!node.result?.attemptId) throw new Error(`node ${node.id} completed without a causal attempt`);
		await recorder.record("node-completed", { nodeId: node.id, status: node.status, cause: { attemptId: node.result.attemptId } });
	} else if (node.status === "skipped") {
		if (!node.upstreamNodeId) throw new Error(`skipped node ${node.id} has no upstream cause`);
		await recorder.record("node-completed", { nodeId: node.id, status: "skipped", cause: { upstreamNodeId: node.upstreamNodeId } });
	}
}

async function finish(recorder: RuntimeEventRecorder, loaded: ReturnType<typeof loadActiveExecutionPacket>, started: number, outcome: "completed" | "dry-run-completed" | "failed" | "aborted", cause: Record<string, unknown>, extra: Partial<ExecuteFanoutResult> = {}): Promise<ExecuteFanoutResult> {
	const projection = await recorder.record("run-finished", { outcome, durationMs: Math.max(0, Date.now() - started), cause });
	return { status: outcome === "completed" || outcome === "dry-run-completed" ? "succeeded" : outcome, runId: projection.runId, packetPath: loaded.packetPath, paths: recorder.paths, snapshot: projection, ...extra } as ExecuteFanoutResult;
}

function runPreflight(options: ExecuteFanoutOptions, packet: FanoutExecutionPacket, worktreeSharedPaths: readonly string[]): { repoRoot?: string; tree: string; issues: Array<{ code: string; detail: string }> } {
	const issues: Array<{ code: string; detail: string }> = [];
	const top = command("git", ["rev-parse", "--show-toplevel"], options.cwd);
	const repoRoot = top.status === 0 ? resolve(top.stdout.trim()) : undefined;
	let tree = packet.planningBase.tree;
	if (!repoRoot) issues.push({ code: "controller-failure", detail: "active directory is not a Git worktree" });
	else {
		const head = command("git", ["rev-parse", "--verify", "HEAD^{commit}"], repoRoot);
		if (head.stdout.trim() !== packet.planningBase.headCommit) issues.push({ code: "planning-base-mismatch", detail: "active HEAD differs from the packet planning commit; rerun /fanout-plan" });
		const committedTree = command("git", ["rev-parse", "--verify", `${packet.planningBase.headCommit}^{tree}`], repoRoot);
		if (committedTree.status !== 0) issues.push({ code: "planning-base-mismatch", detail: "packet planning commit is unavailable; rerun /fanout-plan" });
		else if (committedTree.stdout.trim() !== packet.planningBase.tree) issues.push({ code: "planning-base-mismatch", detail: "packet planning base contains non-HEAD content that detached workers cannot reconstruct; commit, stash, or remove it and rerun /fanout-plan" });
		try { tree = fullGitVisibleTree(repoRoot); if (tree !== packet.planningBase.tree) issues.push({ code: "repository-tree-mismatch", detail: "active Git-visible tree differs from the packet planning base; rerun /fanout-plan" }); }
		catch (error) { issues.push({ code: "controller-failure", detail: message(error) }); }
		try { validateSharedWorktreePaths(repoRoot, worktreeSharedPaths); }
		catch (error) { issues.push({ code: "capability-unavailable", detail: message(error) }); }
	}
	if (packet.planningHost.platform !== process.platform) issues.push({ code: "platform-mismatch", detail: `packet was planned for ${packet.planningHost.platform}, running ${process.platform}; rerun /fanout-plan` });
	if (!existsSync(resolve(options.extensionEntry))) issues.push({ code: "capability-unavailable", detail: "Fanout extension entry is unavailable" });
	const pi = command(options.piCommand ?? process.env.FANOUT_PI_COMMAND ?? "pi", ["--version"], options.cwd);
	if (pi.status !== 0) issues.push({ code: "capability-unavailable", detail: "Pi worker command is unavailable" });
	if (repoRoot) try { preflightValidationCommands(packet.nodes.flatMap((node) => node.workContract.validationCommands), { checkoutRoot: repoRoot, expectedPlatform: packet.planningHost.platform }); }
	catch (error) { issues.push({ code: "executable-unavailable", detail: message(error) }); }
	return { repoRoot, tree, issues };
}

function confirmationSummary(packet: FanoutExecutionPacket, maxConcurrency: number, runDir: string, worktreeSharedPaths: readonly string[]): string {
	const writes = [...new Set(packet.nodes.flatMap((node) => contractWriteResources(node.workContract).map((resource) => `${resource.kind}:${resource.path}`)))];
	return [`Objective: ${packet.objective}`, `Packet: ${packet.sourceArtifacts.details.sha256.slice(0, 12)} / base ${packet.planningBase.tree}`, `Work nodes: ${packet.nodes.length - 1}`, `Maximum concurrency: ${maxConcurrency}`, `Typed writes: ${writes.join(", ") || "none"}`, `Validation manifests: ${packet.nodes.reduce((sum, node) => sum + node.workContract.validationCommands.length, 0)}`, `Shared worktree paths: ${worktreeSharedPaths.join(", ") || "none"}`, WORKER_TRUST_BOUNDARY, `Audit artifacts: ${runDir}`].join("\n");
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
