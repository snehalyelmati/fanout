import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { AcceptedPatch, AcceptedStateTransition, ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import type { CorrelatedAttemptMetrics } from "../../fanout-core/src/attempt-metrics.ts";
import type { AttemptAllocation, StageFact } from "../../fanout-core/src/execution-attempt.ts";
import type { AttemptRecoveryContext } from "../../fanout-core/src/recovery-evidence.ts";
import type { FanoutExecutionPacket, FanoutWorkUnit, TierName } from "../../fanout-core/src/execution-packet.ts";
import type { ProjectExecutionProfile } from "../../fanout-core/src/project-execution-profile.ts";
import { contractWriteResources, type WorkContract } from "../../fanout-core/src/work-contract.ts";
import { correlatedWorkerMetrics, emptyAttemptMetrics, processStageFact, retryableProcessFailure } from "./attempt-evidence.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import { normalizeCandidate, type CandidateNormalizationEvidence, type CandidateNormalizationFailure } from "./candidate-normalization.ts";
import { artifactSegment, normalizeRepoPath, runProcess, writeJson } from "./fanout-git.ts";
import { buildCanonicalWorkerPrompt, extractWorkerSummary, type SourceTaggedRepositoryInstruction } from "./fanout-worker-contract.ts";
import {
	applyRepairSeedOverlay,
	capturePatchCandidate,
	createReconstructedWorktree,
	type PlanningBase,
} from "./repository-identity.ts";
import { WORKER_MODEL_TOOLS } from "./worker-capabilities.ts";
import { buildWorkerSourceContext } from "./worker-context.ts";
import { publishWorkerValidationManifest } from "./worker-validation.ts";
import { prepareProjectWorktree } from "./project-execution-profile.ts";

export interface WorkerTier {
	tier: TierName;
	provider: string;
	model: string;
	thinking: string;
}

export type AttemptKind = "original" | "retry" | "fallback" | "validation-repair" | "integration-repair";
export type FailureKind = "process" | "metrics" | "normalization" | "patch" | "unsafe" | "ownership" | "validation" | "apply" | "bookkeeping";

export interface WorkerAttempt {
	ok: boolean;
	attemptId: string;
	attemptDir: string;
	worktreePath?: string;
	base?: PlanningBase;
	tier: WorkerTier;
	kind: AttemptKind;
	patch?: AcceptedPatch;
	error?: string;
	failureKind?: FailureKind;
	retryable?: boolean;
	allocation: AttemptAllocation;
	startedAt: string;
	correlatedMetrics: CorrelatedAttemptMetrics;
	terminalFact?: StageFact;
	recovery?: AttemptRecoveryContext;
	repairSource?: AttemptRecoveryContext;
	workerSummary?: string;
	excludedEvidenceRefs?: readonly string[];
	fallbackAllowed: boolean;
}

export interface WorkerAttemptExecutionOptions {
	packet: FanoutExecutionPacket;
	unit: FanoutWorkUnit;
	contract: WorkContract;
	repoRoot: string;
	runDir: string;
	runId: string;
	extensionEntry: string;
	piCommand: string;
	workerTimeoutMs: number;
	validationTimeoutMs: number;
	planningBase: PlanningBase;
	ledger: readonly { patch: AcceptedPatch }[];
	profile: ProjectExecutionProfile;
	preparedBase?: PlanningBase;
	profileIdentity: ArtifactIdentity;
	allocation: AttemptAllocation;
	attemptDir: string;
	worktreePath: string;
	tier: WorkerTier;
	kind: AttemptKind;
	startedAt: string;
	fallbackAllowed: boolean;
	recovery?: AttemptRecoveryContext;
	precedingWorkerSummary?: string;
	seedPatch?: AcceptedStateTransition;
	signal?: AbortSignal;
	beforeNormalizationAuditRewrite?: () => void;
}

export async function executeWorkerAttempt(options: WorkerAttemptExecutionOptions): Promise<WorkerAttempt> {
	const { packet, unit, contract, allocation, attemptDir, worktreePath, tier, kind, startedAt, signal } = options;
	const attemptId = allocation.attemptId;
	const base: WorkerAttempt = {
		ok: false,
		attemptId,
		attemptDir,
		tier,
		kind,
		allocation,
		startedAt,
		correlatedMetrics: emptyAttemptMetrics(attemptId),
		fallbackAllowed: options.fallbackAllowed,
		...(options.recovery ? { repairSource: options.recovery } : {}),
	};
	try {
		signal?.throwIfAborted();
		mkdirSync(attemptDir, { recursive: true });
		const attemptBase = options.preparedBase ?? createReconstructedWorktree(options.repoRoot, worktreePath, options.planningBase, options.runDir, options.ledger);
		if (!options.preparedBase && options.seedPatch) applyRepairSeedOverlay(worktreePath, options.runDir, options.seedPatch, { exact: options.recovery?.kind === "final-validation" });
		const prepared = await prepareProjectWorktree(options.profile, options.profileIdentity, {
			worktreePath, artifactRoot: options.runDir,
			evidencePath: `${relative(options.runDir, attemptDir).split("\\").join("/")}/preparation.json`,
			scopeId: attemptId, timeoutMs: options.validationTimeoutMs, signal,
		});
		signal?.throwIfAborted();
		if (prepared.evidence.status !== "passed") throw new Error(`project worktree preparation failed: ${prepared.evidence.error ?? "unknown failure"}`);

		const promptPath = join(attemptDir, "prompt.md");
		const stdoutPath = join(attemptDir, "stdout.log");
		const stderrPath = join(attemptDir, "stderr.log");
		const observabilityPath = join(attemptDir, "observability.jsonl");
		const sessionDir = join(attemptDir, "session");
		if (options.recovery) writeJson(join(attemptDir, "recovery.json"), options.recovery);
		writeFileSync(promptPath, buildCanonicalWorkerPrompt(
			{
				objective: packet.objective,
				userContext: packet.userContext,
				discoveredRepoFacts: packet.discoveredRepoFacts,
				assumptions: packet.assumptions,
			},
			{ id: unit.id, kind: unit.kind, workContract: contract },
			collectRepositoryInstructions(worktreePath, unit),
			options.recovery,
			options.precedingWorkerSummary,
			buildWorkerSourceContext(worktreePath, options.planningBase.tree, contract),
		), "utf8");
		writeFileSync(observabilityPath, "", { encoding: "utf8", flag: "wx" });
		mkdirSync(sessionDir);
		const validationManifest = publishWorkerValidationManifest(attemptDir, {
			runId: options.runId,
			nodeId: unit.id,
			attemptId,
			worktreeRoot: worktreePath,
			platform: packet.planningHost.platform,
			commands: contract.validationCommands,
			writeResources: contractWriteResources(contract),
			forbiddenWrites: contract.forbiddenWrites.map((entry) => entry.resource),
			timeoutMs: options.validationTimeoutMs,
		});

		const providerRunId = `${options.runId}-${artifactSegment(unit.id)}-${attemptId}`;
		const args = [
			"--no-context-files",
			"--approve",
			"--tools",
			WORKER_MODEL_TOOLS.join(","),
			"-e",
			worktreeExtensionPath(options.repoRoot, worktreePath, options.extensionEntry),
			"--model",
			`${tier.provider}/${tier.model}`,
			"--mode",
			"json",
			"--session-dir",
			sessionDir,
		];
		if (CLI_THINKING_LEVELS.has(tier.thinking)) args.push("--thinking", tier.thinking);
		args.push("-p", `@${promptPath}`);

		const processResult = await runProcess(options.piCommand, args, {
			cwd: worktreePath,
			timeoutMs: options.workerTimeoutMs,
			env: {
				...process.env,
				FANOUT_OBSERVABILITY_FILE: observabilityPath,
				FANOUT_RUN_ID: options.runId,
				FANOUT_NODE_ID: unit.id,
				FANOUT_ATTEMPT_ID: attemptId,
				FANOUT_WORKER_DIR: attemptDir,
				FANOUT_WORKTREE_ROOT: worktreePath,
				FANOUT_VALIDATION_MANIFEST: JSON.stringify(validationManifest),
				DOUBLEWORD_OBSERVABILITY_FILE: observabilityPath,
				DOUBLEWORD_RUN_ID: providerRunId,
				DOUBLEWORD_EXECUTION_MODE: tier.tier === "tier2" ? "async" : "realtime",
			},
			isFirstOutput: isAssistantOutput,
			signal,
		});
		signal?.throwIfAborted();
		writeFileSync(stdoutPath, processResult.stdout, "utf8");
		writeFileSync(stderrPath, processResult.stderr, "utf8");
		base.workerSummary = extractWorkerSummary(stdoutPath);

		base.correlatedMetrics = correlatedWorkerMetrics({ allocation, attemptEnvelope: { startedAt, finishedAt: new Date().toISOString() }, providerRunId, stdoutPath, observabilityPath, workerDurationMs: processResult.durationMs, workerFirstOutputMs: processResult.firstOutputMs });

		let patch: AcceptedPatch | undefined;
		let patchError: string | undefined;
		const capturePatch = () => {
			try {
				const patchPath = `${relative(options.runDir, attemptDir).split("\\").join("/")}/patch.bin`;
				patch = capturePatchCandidate(worktreePath, attemptBase, options.runDir, patchPath);
			} catch (error) {
				patchError = errorMessage(error);
			}
		};
		const writeResult = () => writeJson(join(attemptDir, "result.json"), {
			nodeId: unit.id,
			attemptId,
			kind,
			tier,
			process: { ...processResult, stdout: undefined, stderr: undefined },
			correlatedMetrics: base.correlatedMetrics,
			metricErrors: base.correlatedMetrics.issues,
			workerSummary: base.workerSummary,
			patch: patch ? { artifact: patch.artifact, changedFiles: patch.changedPaths, stats: patch.stats, baseTree: patch.baseTree, resultTree: patch.resultTree } : undefined,
			patchError,
		});
		const processOk = processResult.exitCode === 0 && !processResult.timedOut && !processResult.spawnError;
		if (!processOk) {
			capturePatch();
			writeResult();
			const hasUsablePatch = Boolean(patch && (patch.artifact.byteLength > 0 || contractWriteResources(contract).length === 0));
			const details = [processResult.timedOut ? "worker timed out" : undefined, processResult.spawnError, processResult.exitCode !== 0 ? `worker exited ${processResult.exitCode}` : undefined, processResult.stderr.trim()].filter(Boolean).join(": ");
			return {
				...base,
				worktreePath,
				base: attemptBase,
				patch,
				error: details || "worker subprocess failed",
				failureKind: "process",
				retryable: !hasUsablePatch && retryableProcessFailure(processResult, observabilityPath, { runId: providerRunId, provider: tier.provider, model: tier.model }),
				terminalFact: processStageFact(processResult, observabilityPath, { runId: providerRunId, provider: tier.provider, model: tier.model }),
			};
		}
		if (base.correlatedMetrics.status === "invalid") {
			capturePatch();
			writeResult();
			return { ...base, worktreePath, base: attemptBase, patch, error: base.correlatedMetrics.issues.map((issue) => issue.message).join("; "), failureKind: "metrics", retryable: false, terminalFact: { stage: "metrics", code: "malformed" } };
		}

		if (options.profile.candidateNormalization.length) {
			let normalization = await normalizeCandidate({
				attemptId,
				worktreePath,
				commands: options.profile.candidateNormalization.map((entry) => entry.command),
				expectedPlatform: process.platform,
				timeoutMs: options.validationTimeoutMs,
				inheritedEnv: process.env,
				signal,
			});
			const normalizationPath = `${relative(options.runDir, attemptDir).split("\\").join("/")}/candidate-normalization.json`;
			const publishNormalization = (evidence: CandidateNormalizationEvidence) => writeArtifactAtomically(options.runDir, normalizationPath, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
			const abortEvidence = (): CandidateNormalizationEvidence => ({
				...normalization,
				status: "interrupted",
				failure: { code: "user-abort", ...(signal?.reason === undefined ? {} : { detail: errorMessage(signal.reason) }) },
			});
			const failNormalization = (failure: CandidateNormalizationFailure, excludedEvidenceRefs: readonly string[] = []): WorkerAttempt => {
				try { writeResult(); } catch { /* Typed normalization authority remains terminal when optional diagnostics fail. */ }
				return {
					...base,
					worktreePath,
					base: attemptBase,
						error: failure.detail ?? `candidate normalization ${failure.code}`,
					failureKind: "normalization",
					retryable: false,
					excludedEvidenceRefs,
					terminalFact: { stage: "candidate-normalization", code: failure.code, ...(failure.commandIndex === undefined ? {} : { commandIndex: failure.commandIndex }) },
				};
			};
			if (!normalization.failure && signal?.aborted) normalization = abortEvidence();
			try {
				publishNormalization(normalization);
			} catch (error) {
				return { ...base, worktreePath, base: attemptBase, error: `candidate normalization audit publication failed: ${errorMessage(error)}`, failureKind: "normalization", retryable: false, terminalFact: { stage: "candidate-normalization", code: "audit-failure" } };
			}
			if (normalization.failure) return failNormalization(normalization.failure);
			if (signal?.aborted) {
				normalization = abortEvidence();
				try {
					options.beforeNormalizationAuditRewrite?.();
					publishNormalization(normalization);
				} catch (error) {
					return failNormalization({ ...normalization.failure as CandidateNormalizationFailure, detail: `candidate normalization audit update failed after user abort: ${errorMessage(error)}` }, ["candidate-normalization.json"]);
				}
				return failNormalization(normalization.failure as CandidateNormalizationFailure);
			}
		}

		capturePatch();
		writeResult();
		if (!patch) return { ...base, worktreePath, base: attemptBase, error: patchError ?? "patch could not be captured", failureKind: "patch", retryable: false, terminalFact: { stage: "worker-gate", code: "malformed-patch" } };
		if (patch.artifact.byteLength === 0 && contractWriteResources(contract).length > 0) return { ...base, worktreePath, base: attemptBase, patch, error: "worker produced no patch for a mutating work unit", failureKind: "patch", retryable: false, terminalFact: { stage: "worker-gate", code: "mutating-noop" } };
		return { ...base, ok: true, worktreePath, base: attemptBase, patch };
	} catch (error) {
		const durationMs = Math.max(0, Date.now() - Date.parse(startedAt));
		const aborted = signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
		const failedAttempt: WorkerAttempt = {
			...base,
			worktreePath,
			error: errorMessage(error),
			failureKind: "process",
			retryable: !aborted,
			terminalFact: aborted
				? { stage: "process", code: "user-abort", durationMs }
				: { stage: "process", code: "infrastructure-failure", durationMs },
		};
		try {
			mkdirSync(attemptDir, { recursive: true });
			writeJson(join(attemptDir, "result.json"), { nodeId: unit.id, attemptId, kind, tier, error: failedAttempt.error, failureKind: failedAttempt.failureKind });
		} catch {
			// Attempt completion remains the authoritative causal record when diagnostics cannot be written.
		}
		return failedAttempt;
	}
}

function worktreeExtensionPath(repoRoot: string, worktreePath: string, extensionEntry: string): string {
	const path = relative(repoRoot, extensionEntry);
	return path && path !== ".." && !path.startsWith("../") ? resolve(worktreePath, path) : extensionEntry;
}

function collectRepositoryInstructions(worktreePath: string, unit: FanoutWorkUnit): SourceTaggedRepositoryInstruction[] {
	const directories = new Set([""]);
	for (const rawPath of [...contractWriteResources(unit.workContract), ...unit.workContract.readDependencies.map((read) => read.resource)].map((resource) => resource.path)) {
		const path = normalizeRepoPath(rawPath);
		const segments = path.split("/");
		let directorySegments = segments.slice(0, -1);
		try {
			if (lstatSync(resolve(worktreePath, path)).isDirectory()) directorySegments = segments;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			if (/[\\/]\s*$/.test(rawPath)) directorySegments = segments;
		}
		for (let length = 1; length <= directorySegments.length; length++) directories.add(directorySegments.slice(0, length).join("/"));
	}

	const sections: SourceTaggedRepositoryInstruction[] = [];
	const orderedDirectories = Array.from(directories).sort((left, right) => left.split("/").filter(Boolean).length - right.split("/").filter(Boolean).length || (left < right ? -1 : left > right ? 1 : 0));
	for (const directory of orderedDirectories) {
		for (const name of ["AGENTS.md", "CLAUDE.md"]) {
			const relativePath = directory ? `${directory}/${name}` : name;
			const instructionPath = resolve(worktreePath, relativePath);
			try {
				if (!lstatSync(instructionPath).isFile()) continue;
				const content = readFileSync(instructionPath, "utf8").trim();
				if (content) sections.push({ source: relativePath, text: content });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
	return sections;
}

function isAssistantOutput(line: string): boolean {
	try {
		const event = JSON.parse(line);
		return (event?.type === "message_update" && ["text_delta", "thinking_delta", "toolcall_start", "toolcall_delta"].includes(event?.assistantMessageEvent?.type))
			|| (event?.type === "message_end" && event?.message?.role === "assistant");
	} catch {
		return false;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const CLI_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
