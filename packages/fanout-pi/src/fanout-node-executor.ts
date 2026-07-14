import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { AcceptedPatch, AcceptedStateTransition } from "../../fanout-core/src/artifact-identity.ts";
import { verifyArtifactBytes, type ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import type { CorrelatedAttemptMetrics } from "../../fanout-core/src/attempt-metrics.ts";
import {
	allocateAttempt,
	appendTerminalOutcome,
	commitAttemptCompletion,
	createNodeAttemptState,
	discardPreparedAttemptCompletion,
	prepareAttemptCompletion,
	type AttemptAllocation,
	type AttemptOutcome,
	type NodeAttemptState,
	type StageFact,
} from "../../fanout-core/src/execution-attempt.ts";
import { assertFinalValidationRecoverySource, type AcceptedLedgerProvenance, type AttemptRecoveryContext } from "../../fanout-core/src/recovery-evidence.ts";
import { executionPacketBytes, type FanoutExecutionPacket, type FanoutWorkUnit, type TierName } from "../../fanout-core/src/execution-packet.ts";
import type { DagNodeResult } from "../../fanout-core/src/dag-scheduler.ts";
import type { WorkerMetrics } from "../../fanout-core/src/worker-metrics.ts";
import {
	artifactSegment,
	checkContractOwnership,
	checkFinalRepairOwnership,
	normalizeRepoPath,
	ownershipViolationFactCode,
	runProcess,
	writeJson,
} from "./fanout-git.ts";
import { buildCanonicalWorkerPrompt, importWorkerMetrics, type SourceTaggedRepositoryInstruction } from "./fanout-worker-contract.ts";
import { WORKER_MODEL_TOOLS } from "./worker-capabilities.ts";
import {
	AcceptedTransitionIdentityError,
	AcceptedTransitionProcessError,
	AmbiguousApplyError,
	applyAcceptedTransition,
	applyRepairSeedOverlay,
	capturePatchCandidate,
	createReconstructedWorktree,
	fullGitVisibleTree,
	removeReconstructedWorktree,
	verifyPatchCandidate,
	type PlanningBase,
} from "./repository-identity.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import { contractWriteResources, type WorkContract } from "../../fanout-core/src/work-contract.ts";
import { runValidationCommands, type ValidationRunResult } from "./validation-runner.ts";
import { deriveFinalRepairWorkContract, type FinalValidationResult } from "../../fanout-core/src/final-validation.ts";
import type { ValidationCommand } from "../../fanout-core/src/validation-command.ts";
import { runFinalValidation as coordinateFinalValidation } from "./final-validation.ts";
import {
	attemptEvidenceRefs,
	correlatedWorkerMetrics,
	emptyAttemptMetrics,
	integrationFailureEvidence,
	processStageFact,
	retryableProcessFailure,
	validationFailureEvidence,
} from "./attempt-evidence.ts";
import { prepareSharedWorktreePaths } from "./worktree-preparation.ts";

interface WorkerTier {
	tier: TierName;
	provider: string;
	model: string;
	thinking: string;
}

type AttemptKind = "original" | "retry" | "fallback" | "validation-repair" | "integration-repair";
type FailureKind = "process" | "metrics" | "patch" | "unsafe" | "ownership" | "validation" | "apply" | "bookkeeping";

interface WorkerAttempt {
	ok: boolean;
	attemptId: string;
	attemptDir: string;
	worktreePath?: string;
	base?: PlanningBase;
	tier: WorkerTier;
	kind: AttemptKind;
	metrics?: WorkerMetrics;
	patch?: AcceptedPatch;
	error?: string;
	failureKind?: FailureKind;
	retryable?: boolean;
	allocation: AttemptAllocation;
	startedAt: string;
	correlatedMetrics: CorrelatedAttemptMetrics;
	terminalFact?: StageFact;
	recovery?: AttemptRecoveryContext;
	fallbackAllowed: boolean;
}

interface GatedAttempt extends WorkerAttempt {
	ok: true;
	worktreePath: string;
	base: PlanningBase;
	metrics: WorkerMetrics;
	patch: AcceptedPatch;
	validation: ValidationRunResult;
}

export interface FanoutNodeExecutorOptions {
	packet: FanoutExecutionPacket;
	packetIdentity: ArtifactIdentity;
	repoRoot: string;
	runDir: string;
	runId: string;
	extensionEntry: string;
	recorder: RuntimeAttemptRecorder;
	piCommand?: string;
	workerTimeoutMs?: number;
	validationTimeoutMs?: number;
	maxValidationRepairAttempts?: number;
	maxIntegrationRepairAttempts?: number;
	worktreeSharedPaths?: readonly string[];
	afterActiveApply?: () => void;
}

export interface RuntimeAttemptRecorder {
	recordAttemptAllocated(allocation: AttemptAllocation): Promise<void>;
	recordAttemptCompleted(outcome: AttemptOutcome, acceptedTransition?: AcceptedStateTransition): Promise<void>;
	flush(): Promise<void>;
}

export class FanoutNodeExecutor {
	readonly #packet: FanoutExecutionPacket;
	readonly #packetIdentity: ArtifactIdentity;
	readonly #repoRoot: string;
	readonly #runDir: string;
	readonly #runId: string;
	readonly #extensionEntry: string;
	readonly #recorder: RuntimeAttemptRecorder;
	readonly #piCommand: string;
	readonly #workerTimeoutMs: number;
	readonly #validationTimeoutMs: number;
	readonly #planningBase: PlanningBase;
	readonly #worktreeSharedPaths: readonly string[];
	readonly #afterActiveApply?: () => void;
	#attemptStates = new Map<string, NodeAttemptState>();
	#outcomes: AttemptOutcome[] = [];
	#acceptedLedger: AcceptedLedgerProvenance[] = [];
	#contracts = new Map<string, WorkContract>();
	#applyTail: Promise<void> = Promise.resolve();
	#worktrees = new Set<string>();
	#manualReconciliationRequired = false;

	constructor(options: FanoutNodeExecutorOptions) {
		this.#packet = options.packet;
		this.#packetIdentity = verifyArtifactBytes(options.packetIdentity, executionPacketBytes(options.packet));
		this.#repoRoot = resolve(options.repoRoot);
		this.#runDir = resolve(options.runDir);
		this.#runId = options.runId;
		this.#extensionEntry = resolve(options.extensionEntry);
		this.#recorder = options.recorder;
		this.#piCommand = options.piCommand ?? process.env.FANOUT_PI_COMMAND ?? "pi";
		this.#workerTimeoutMs = positiveInteger(options.workerTimeoutMs, 600_000, "workerTimeoutMs");
		this.#validationTimeoutMs = positiveInteger(options.validationTimeoutMs, 600_000, "validationTimeoutMs");
		this.#afterActiveApply = options.afterActiveApply;
		fixedRepairLimit(options.maxValidationRepairAttempts, "maxValidationRepairAttempts");
		fixedRepairLimit(options.maxIntegrationRepairAttempts, "maxIntegrationRepairAttempts");
		this.#planningBase = this.#packet.planningBase;
		this.#worktreeSharedPaths = [...(options.worktreeSharedPaths ?? [])];
	}

	get manualReconciliationRequired(): boolean { return this.#manualReconciliationRequired; }

	finalValidationCommands(fallback: readonly ValidationCommand[]): ValidationCommand[] {
		const finalUnit = this.#packet.nodes.find((unit) => unit.kind === "final-validation");
		return finalUnit ? [...this.#contract(finalUnit).validationCommands] : [...fallback];
	}

	cleanupWorktrees(): void {
		let failure: unknown;
		for (const worktreePath of [...this.#worktrees].reverse()) {
			try { removeReconstructedWorktree(this.#repoRoot, worktreePath); }
			catch (error) { failure ??= error; }
			finally { this.#worktrees.delete(worktreePath); }
		}
		if (failure) throw failure;
	}

	async runFinalValidation(commands: readonly ValidationCommand[]): Promise<FinalValidationResult> {
		const initialTree = this.#acceptedLedger.at(-1)?.patch.resultTree ?? this.#planningBase.tree;
		const finalUnit = this.#packet.nodes.find((unit) => unit.kind === "final-validation");
		const finalContract = finalUnit ? this.#contract(finalUnit) : undefined;
		const upstreamWorkContracts = this.#packet.nodes.filter((unit) => unit.kind !== "final-validation").map((unit) => ({ nodeId: unit.id, workContract: this.#contract(unit) }));
		const authoritativeCommands = finalContract?.validationCommands ?? commands;
		const repairContract = finalContract ? deriveFinalRepairWorkContract(this.#packet.nodes.filter((unit) => unit !== finalUnit).map((unit) => this.#contract(unit)), finalContract) : undefined;
		const repairUnit = finalUnit && repairContract ? { ...finalUnit, kind: "implement" as const } : undefined;
		if (repairUnit && repairContract) this.#contracts.set(repairUnit.id, repairContract);
		return await coordinateFinalValidation<WorkerAttempt>({
			repoRoot: this.#repoRoot,
			runDir: this.#runDir,
			planningBase: this.#planningBase,
			ledger: this.#acceptedLedger.map(({ patch }) => ({ patch })),
			commands: authoritativeCommands,
			expectedValidationTree: initialTree,
			expectedActiveTree: initialTree,
			timeoutMs: this.#validationTimeoutMs,
			prepareWorktree: (worktreePath) => prepareSharedWorktreePaths(this.#repoRoot, worktreePath, this.#worktreeSharedPaths),
			...(repairUnit && repairContract ? { repair: {
				packetIdentity: this.#packetIdentity,
				workContract: repairContract,
				finalValidationContract: finalContract as WorkContract,
				upstreamWorkContracts,
				acceptedLedger: this.#acceptedLedger,
				available: () => (this.#attemptStates.get(repairUnit.id)?.counts.validationRepair ?? 0) < 2,
				launch: async (recovery, source) => {
					const attempt = await this.#runWorkerAttempt(repairUnit, tierOne(this.#packet), "validation-repair", recovery, undefined, source.attemptId, source.evidence);
					return { attemptId: attempt.attemptId, ...(attempt.ok && attempt.patch && attempt.worktreePath ? { candidate: attempt } : {}), continue: !attempt.ok && this.#terminalOutcome(attempt).action === "validation-repair" };
				},
				transition: (attempt) => ({ patch: attempt.patch as AcceptedPatch }),
				authorize: async (attempt) => this.#authorizeFinalRepair(repairUnit, repairContract, attempt),
				reject: async (attempt, result, recovery, fact) => this.#rejectFinalRepair(attempt, result, recovery, fact),
				apply: async (attempt, result) => (await this.#apply(repairUnit, { ...attempt, validation: { status: "passed", executedCount: result.commandCount, durationMs: result.durationMs, commands: [] } } as GatedAttempt)).ok,
			} } : {}),
		});
	}

	async #authorizeFinalRepair(unit: FanoutWorkUnit, contract: WorkContract, attempt: WorkerAttempt): Promise<boolean> {
		if (!attempt.patch) return false;
		const ownership = checkFinalRepairOwnership(contract, attempt.patch, attempt.attemptDir);
		if (ownership.ok) return true;
		await this.#completeTerminalAttempt({ ...attempt, ok: false, error: ownership.violations.map((value) => `${value.file}: ${value.reason}`).join("; "), failureKind: "ownership", terminalFact: { stage: "worker-gate", code: ownershipViolationFactCode(ownership.violations) } });
		return false;
	}

	async #rejectFinalRepair(attempt: WorkerAttempt, result: FinalValidationResult, recovery: AttemptRecoveryContext | undefined, fact: StageFact): Promise<boolean> {
		const repairBudgetRemains = (this.#attemptStates.get(attempt.allocation.nodeId)?.counts.validationRepair ?? 0) < 2;
		const completed = await this.#completeTerminalAttempt({ ...attempt, ok: false, error: result.evidence.failure?.kind === "hard" ? result.evidence.failure.detail : "final validation program failed", failureKind: "validation", terminalFact: fact, ...(recovery && repairBudgetRemains ? { recovery } : {}) });
		return this.#terminalOutcome(completed).action === "validation-repair";
	}

	async runNode(unit: FanoutWorkUnit, signal?: AbortSignal): Promise<DagNodeResult> {
		signal?.throwIfAborted();
		try {
			this.#contract(unit);
		} catch (error) {
			return { ok: false, error: errorMessage(error) };
		}
		const original = await this.#runOriginalWithRetry(unit, signal);
		if (!original.ok) return await this.#result(original);

		if (signal?.aborted) return await this.#result(await this.#completeAbortedAttempt(original, signal.reason));
		let gated = await this.#gateOwnershipAndValidation(unit, original, signal);
		if (!gated.ok && gated.failureKind === "validation" && this.#terminalOutcome(gated).action === "validation-repair") gated = await this.#repairValidation(unit, gated, signal);
		if (!gated.ok) return await this.#result(gated);

		const applied = await this.#apply(unit, gated, signal);
		if (applied.ok) return await this.#result(applied);
		if (applied.failureKind !== "apply") return await this.#result(applied);

		const repaired = await this.#repairIntegration(unit, applied, applied.error ?? "git apply --check failed", signal);
		return await this.#result(repaired);
	}

	async #result(attempt: WorkerAttempt): Promise<DagNodeResult> {
		await this.#recorder.flush();
		if (!attempt.ok && this.#terminalOutcome(attempt).action === "abort") throw abortError(attempt.error ?? "Fanout attempt aborted");
		return attempt.ok ? { ok: true, attemptId: attempt.attemptId } : { ...failed(attempt), attemptId: attempt.attemptId };
	}

	async #runOriginalWithRetry(unit: FanoutWorkUnit, signal?: AbortSignal): Promise<WorkerAttempt> {
		const assigned = tierForUnit(unit);
		let outcome: WorkerAttempt | undefined;
		for (let attempt = 1; attempt <= 2; attempt++) {
			signal?.throwIfAborted();
			outcome = await this.#runWorkerAttempt(unit, assigned, attempt === 1 ? "original" : "retry", undefined, undefined, outcome?.attemptId, undefined, signal);
			if (outcome.ok) return outcome;
			const action = this.#terminalOutcome(outcome).action;
			if (action !== "retry") {
				if (attempt === 2 && action === "fallback") break;
				return outcome;
			}
		}

		if (assigned.tier !== "tier2" || !outcome || this.#terminalOutcome(outcome).action !== "fallback" || unit.tier.fallback !== "tier1") {
			if (!outcome) throw new Error(`worker attempts did not run for ${unit.id}`);
			return outcome;
		}
		const fallback = tierTwoFallback(this.#packet);
		signal?.throwIfAborted();
		const result = await this.#runWorkerAttempt(unit, fallback, "fallback", undefined, undefined, outcome.attemptId, undefined, signal);
		return result;
	}

	async #runWorkerAttempt(
		unit: FanoutWorkUnit,
		tier: WorkerTier,
		kind: AttemptKind,
		recovery?: AttemptRecoveryContext,
		seedPatch?: AcceptedStateTransition,
		sourceAttemptId?: string,
		sourceFinalValidationEvidence?: ArtifactIdentity,
		signal?: AbortSignal,
	): Promise<WorkerAttempt> {
		signal?.throwIfAborted();
		if (sourceFinalValidationEvidence) {
			if (recovery?.kind !== "final-validation") throw new Error("final validation repair launch requires typed failed-round recovery evidence");
			assertFinalValidationRecoverySource(recovery, sourceFinalValidationEvidence);
		}
		const previousState = this.#attemptStates.get(unit.id) ?? createNodeAttemptState(unit.id);
		const allocated = allocateAttempt(previousState, {
			runId: this.#runId,
			nodeId: unit.id,
			kind,
			assignment: { tier: tier.tier, provider: tier.provider, model: tier.model },
			...(sourceAttemptId ? { sourceAttemptId } : {}),
			...(sourceFinalValidationEvidence ? { sourceFinalValidationEvidence } : {}),
			fallbackAllowed: this.#packet.runtimePolicy.fallbackAllowed && unit.tier.fallback === "tier1",
		});
		this.#attemptStates.set(unit.id, allocated.state);
		const { allocation } = allocated;
		const attemptId = allocation.attemptId;
		const artifactAttemptId = `${String(allocation.attemptNumber).padStart(3, "0")}-${kind}`;
		const attemptDir = join(this.#runDir, "workers", artifactSegment(unit.id), "attempts", artifactAttemptId);
		const worktreePath = join(attemptDir, "worktree");
		const startedAt = new Date().toISOString();
		const base: WorkerAttempt = {
			ok: false,
			attemptId,
			attemptDir,
			tier,
			kind,
			allocation,
			startedAt,
			correlatedMetrics: emptyAttemptMetrics(attemptId),
			fallbackAllowed: this.#packet.runtimePolicy.fallbackAllowed && unit.tier.fallback === "tier1",
		};
		await this.#recorder.recordAttemptAllocated(allocation);
		try {
			signal?.throwIfAborted();
			mkdirSync(attemptDir, { recursive: true });

			const ledger = await this.#withApplyLock(() => this.#acceptedLedger.map(({ patch }) => ({ patch })));
			signal?.throwIfAborted();
			this.#worktrees.add(worktreePath);
			const attemptBase = createReconstructedWorktree(this.#repoRoot, worktreePath, this.#planningBase, this.#runDir, ledger);
			if (seedPatch) {
				applyRepairSeedOverlay(worktreePath, this.#runDir, seedPatch);
			}
			prepareSharedWorktreePaths(this.#repoRoot, worktreePath, this.#worktreeSharedPaths);

			const promptPath = join(attemptDir, "prompt.md");
		const stdoutPath = join(attemptDir, "stdout.log");
		const stderrPath = join(attemptDir, "stderr.log");
		const observabilityPath = join(attemptDir, "observability.jsonl");
		const sessionDir = join(attemptDir, "session");
		writeFileSync(promptPath, buildCanonicalWorkerPrompt(
			{
				objective: this.#packet.objective,
				userContext: this.#packet.userContext,
				discoveredRepoFacts: this.#packet.discoveredRepoFacts,
				assumptions: this.#packet.assumptions,
			},
			{ id: unit.id, kind: unit.kind, workContract: this.#contract(unit) },
			collectRepositoryInstructions(worktreePath, unit),
			recovery,
		), "utf8");
		writeFileSync(observabilityPath, "", { encoding: "utf8", flag: "wx" });
		mkdirSync(sessionDir);

		const extensionEntry = worktreeExtensionPath(this.#repoRoot, worktreePath, this.#extensionEntry);
		const providerRunId = `${this.#runId}-${artifactSegment(unit.id)}-${attemptId}`;
		const args = [
			"--no-context-files",
			"--approve",
			"--tools",
			WORKER_MODEL_TOOLS.join(","),
			"-e",
			extensionEntry,
			"--model",
			`${tier.provider}/${tier.model}`,
			"--mode",
			"json",
			"--session-dir",
			sessionDir,
		];
		if (CLI_THINKING_LEVELS.has(tier.thinking)) args.push("--thinking", tier.thinking);
		args.push("-p", `@${promptPath}`);

		const processResult = await runProcess(this.#piCommand, args, {
			cwd: worktreePath,
			timeoutMs: this.#workerTimeoutMs,
			env: {
				...process.env,
				FANOUT_OBSERVABILITY_FILE: observabilityPath,
				FANOUT_RUN_ID: this.#runId,
				FANOUT_NODE_ID: unit.id,
				FANOUT_WORKER_DIR: attemptDir,
				FANOUT_WORKTREE_ROOT: worktreePath,
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

		const imported = importWorkerMetrics({
			stdoutPath,
			observabilityPath,
			tier: tier.tier,
			workerDurationMs: processResult.durationMs,
			firstOutputMs: processResult.firstOutputMs,
			expectedProvider: tier.provider,
			expectedModel: tier.model,
		});
		base.correlatedMetrics = correlatedWorkerMetrics(attemptId, imported.metrics ?? {
			provider: typeof imported.partialMetrics.provider === "string" ? imported.partialMetrics.provider : tier.provider,
			model: typeof imported.partialMetrics.model === "string" ? imported.partialMetrics.model : tier.model,
			tier: tier.tier,
			workerDurationMs: processResult.durationMs,
		}, stdoutPath, observabilityPath, processResult.firstOutputMs);
		const metricsCorrelated = base.correlatedMetrics.complete;

		let patch: AcceptedPatch | undefined;
		let patchError: string | undefined;
		try {
			const patchPath = `${relative(this.#runDir, attemptDir).split("\\").join("/")}/patch.bin`;
			patch = capturePatchCandidate(worktreePath, attemptBase, this.#runDir, patchPath);
		} catch (error) {
			patchError = errorMessage(error);
		}

		const processOk = processResult.exitCode === 0 && !processResult.timedOut && !processResult.spawnError;
		const hasUsablePatch = Boolean(patch && (patch.artifact.byteLength > 0 || contractWriteResources(unit.workContract).length === 0));
		const resultData = {
			nodeId: unit.id,
			attemptId,
			kind,
			tier,
			process: { ...processResult, stdout: undefined, stderr: undefined },
			metrics: imported.metrics ?? imported.partialMetrics,
			metricsComplete: imported.ok,
			correlatedMetrics: base.correlatedMetrics,
			metricErrors: imported.errors,
			patch: patch ? { artifact: patch.artifact, changedFiles: patch.changedPaths, stats: patch.stats, baseTree: patch.baseTree, resultTree: patch.resultTree } : undefined,
			patchError,
		};
		writeJson(join(attemptDir, "result.json"), resultData);
		if (!processOk) {
			const details = [processResult.timedOut ? "worker timed out" : undefined, processResult.spawnError, processResult.exitCode !== 0 ? `worker exited ${processResult.exitCode}` : undefined, processResult.stderr.trim()].filter(Boolean).join(": ");
			return await this.#finishFailedAttempt({
				...base,
				worktreePath,
				base: attemptBase,
				metrics: imported.metrics,
				patch,
				error: details || "worker subprocess failed",
				failureKind: "process",
				retryable: (!hasUsablePatch || !imported.metrics) && retryableProcessFailure(processResult, observabilityPath, { runId: providerRunId, provider: tier.provider, model: tier.model }),
				terminalFact: processStageFact(processResult, observabilityPath, { runId: providerRunId, provider: tier.provider, model: tier.model }),
			});
		}
		if (!imported.ok || !imported.metrics || !metricsCorrelated) return await this.#finishFailedAttempt({ ...base, worktreePath, base: attemptBase, patch, error: [...imported.errors, ...(metricsCorrelated ? [] : ["attempt identity correlation incomplete"])].join("; "), failureKind: "metrics", retryable: false, terminalFact: { stage: "metrics", code: metricsCorrelated ? "malformed" : "correlation-mismatch" } });
		if (!patch) return await this.#finishFailedAttempt({ ...base, worktreePath, base: attemptBase, metrics: imported.metrics, error: patchError ?? "patch could not be captured", failureKind: "patch", retryable: false, terminalFact: { stage: "worker-gate", code: "malformed-patch" } });
		if (patch.artifact.byteLength === 0 && contractWriteResources(unit.workContract).length > 0) return await this.#finishFailedAttempt({ ...base, worktreePath, base: attemptBase, metrics: imported.metrics, patch, error: "worker produced no patch for a mutating work unit", failureKind: "patch", retryable: false, terminalFact: { stage: "worker-gate", code: "mutating-noop" } });

			return { ...base, ok: true, worktreePath, base: attemptBase, metrics: imported.metrics, patch };
		} catch (error) {
			if (this.#outcomes.some((outcome) => outcome.attemptId === attemptId)) throw error;
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
			return await this.#finishFailedAttempt(failedAttempt);
		}
	}

	async #gateOwnershipAndValidation(unit: FanoutWorkUnit, attempt: WorkerAttempt, signal?: AbortSignal): Promise<GatedAttempt | WorkerAttempt> {
		if (!attempt.ok || !attempt.worktreePath || !attempt.base || !attempt.metrics || !attempt.patch) return attempt;
		if (signal?.aborted) return await this.#completeAbortedAttempt(attempt, signal.reason);
		let ownership;
		try {
			ownership = checkContractOwnership(this.#contract(unit), attempt.patch, attempt.attemptDir, this.#repoRoot);
		} catch (error) {
			ownership = { ok: false, violations: [{ file: "packet", code: "unauthorized-change" as const, reason: errorMessage(error) }] };
		}
		if (!ownership.ok) {
			return await this.#completeTerminalAttempt({
				...attempt,
				ok: false,
				error: ownership.violations.map((value) => `${value.file}: ${value.reason}`).join("; "),
				failureKind: "ownership",
				retryable: false,
				terminalFact: { stage: "worker-gate", code: ownershipViolationFactCode(ownership.violations) },
			});
		}

		const validationCommands = this.#contract(unit).validationCommands;
		let validation: ValidationRunResult;
		try {
			signal?.throwIfAborted();
			validation = await runValidationCommands(validationCommands, {
				checkoutRoot: attempt.worktreePath,
				expectedPlatform: process.platform,
				scopeId: attempt.attemptId,
				timeoutMs: this.#validationTimeoutMs,
				inheritedEnv: process.env,
				signal,
			});
		} catch (error) {
			if (signal?.aborted) return await this.#completeAbortedAttempt(attempt, signal.reason ?? error);
			const message = errorMessage(error);
			writeJson(join(attempt.attemptDir, "validation.json"), { status: "failed", preflightError: message, commands: validationCommands });
			return await this.#completeTerminalAttempt({ ...attempt, ok: false, error: message, failureKind: "validation", retryable: false, terminalFact: { stage: "validation", code: "spawn-failure" } });
		}
		if (signal?.aborted) return await this.#completeAbortedAttempt(attempt, signal.reason);
		writeJson(join(attempt.attemptDir, "validation.json"), validation);
		let patchUnchanged = false;
		let patchCheckError: string | undefined;
		try {
			verifyPatchCandidate(attempt.worktreePath, this.#runDir, attempt.patch);
			patchUnchanged = true;
		} catch (error) {
			patchCheckError = errorMessage(error);
		}
		if (!patchUnchanged) {
			const error = patchCheckError ? `cannot verify the patch after validation: ${patchCheckError}` : "validation commands modified the captured patch";
			return await this.#completeTerminalAttempt({ ...attempt, ok: false, error, failureKind: "patch", retryable: false, terminalFact: { stage: "worker-gate", code: "post-validation-change" } });
		}
		if (validation.status === "failed") {
			const evidence = validationFailureEvidence(this.#contract(unit), attempt, validation);
			const failedAttempt = {
				...attempt,
				ok: false,
				error: validationError(validation),
				failureKind: "validation" as const,
				retryable: false,
				validation,
				terminalFact: evidence.fact,
				recovery: evidence.recovery,
			};
			return await this.#completeTerminalAttempt(failedAttempt);
		}
		return { ...attempt, ok: true, validation } as GatedAttempt;
	}

	async #repairValidation(unit: FanoutWorkUnit, failedAttempt: WorkerAttempt, signal?: AbortSignal): Promise<GatedAttempt | WorkerAttempt> {
		let current = failedAttempt;
		let seedPatch = failedAttempt.patch;
		let recoveryContext = failedAttempt.recovery;
		while ((this.#attemptStates.get(unit.id)?.counts.validationRepair ?? 0) < 2) {
			signal?.throwIfAborted();
			if (!seedPatch) break;
			if (recoveryContext?.kind !== "validation") break;
			const repair = await this.#runWorkerAttempt(unit, tierOne(this.#packet), "validation-repair", recoveryContext, { patch: seedPatch }, current.attemptId, undefined, signal);
			if (!repair.ok) {
				if (this.#terminalOutcome(repair).action !== "validation-repair") return repair;
				current = repair;
				continue;
			}
			const gated = await this.#gateOwnershipAndValidation(unit, repair, signal);
			if (gated.ok) {
				return gated as GatedAttempt;
			}
			if (gated.failureKind === "ownership" || gated.failureKind === "metrics" || gated.failureKind === "unsafe") return gated;
			current = gated;
			seedPatch = gated.patch;
			recoveryContext = gated.recovery;
		}
		return { ...current, ok: false, error: current.error ?? "validation repair attempts exhausted", failureKind: "validation", retryable: false };
	}

	async #apply(unit: FanoutWorkUnit, attempt: GatedAttempt, signal?: AbortSignal): Promise<WorkerAttempt> {
		if (signal?.aborted) return await this.#completeAbortedAttempt(attempt, signal.reason);
		return await this.#withApplyLock(async () => {
			if (signal?.aborted) return await this.#completeAbortedAttempt(attempt, signal.reason);
			const started = performance.now();
			try {
				const transition = applyAcceptedTransition(this.#repoRoot, this.#runDir, { patch: attempt.patch }, { afterApply: this.#afterActiveApply });
				const applyDurationMs = roundMs(performance.now() - started);
				try {
					writeJson(join(attempt.attemptDir, "apply-check.json"), { ok: true, artifact: attempt.patch.artifact, baseTree: attempt.patch.baseTree, resultTree: attempt.patch.resultTree, applyDurationMs });
					await this.#completeAttempt(attempt, { stage: "apply", code: "applied" }, undefined, transition);
					this.#acceptedLedger.push({ sourceAttemptId: attempt.attemptId, patch: transition.patch });
					return attempt;
				} catch (error) {
					this.#manualReconciliationRequired = true;
					const failedAttempt = {
						...attempt,
						ok: false,
						error: `bookkeeping failed after active mutation: ${errorMessage(error)}`,
						failureKind: "bookkeeping",
						retryable: false,
						terminalFact: { stage: "bookkeeping", code: "failed-after-mutation" },
					} as WorkerAttempt;
					return this.#outcomes.some((outcome) => outcome.attemptId === attempt.attemptId) ? failedAttempt : await this.#completeTerminalAttempt(failedAttempt);
				}
			} catch (error) {
				const message = errorMessage(error);
				if (error instanceof AmbiguousApplyError) {
					this.#manualReconciliationRequired = true;
					return await this.#completeTerminalAttempt({ ...attempt, ok: false, error: message, failureKind: "bookkeeping", retryable: false, terminalFact: { stage: "bookkeeping", code: "failed-after-mutation" } });
				}
				const acceptedTree = this.#acceptedLedger.at(-1)?.patch.resultTree ?? this.#planningBase.tree;
				if (fullGitVisibleTree(this.#repoRoot) !== acceptedTree) {
					this.#manualReconciliationRequired = true;
					return await this.#completeTerminalAttempt({ ...attempt, ok: false, error: `active worktree drifted from accepted state: ${message}`, failureKind: "bookkeeping", retryable: false, terminalFact: { stage: "apply", code: "state-drift" } });
				}
				try {
					writeJson(join(attempt.attemptDir, "apply-check.json"), { ok: false, error: message, baseTree: attempt.patch.baseTree, resultTree: attempt.patch.resultTree });
				} catch {
					// The original deterministic gate failure remains authoritative.
				}
				if (error instanceof AcceptedTransitionIdentityError) return await this.#completeTerminalAttempt({ ...attempt, ok: false, error: message, failureKind: "patch", retryable: false, terminalFact: { stage: "apply", code: error.code } });
				if (!(error instanceof AcceptedTransitionProcessError)) return await this.#completeTerminalAttempt({ ...attempt, ok: false, error: message, failureKind: "bookkeeping", retryable: false, terminalFact: { stage: "bookkeeping", code: "publication-failure" } });
				const failedAttempt = {
					...attempt,
					ok: false,
					error: message,
					failureKind: "apply" as const,
					retryable: false,
					terminalFact: { stage: "apply", code: error.code } as const,
					recovery: integrationFailureEvidence(this.#contract(unit), attempt, error.evidence, this.#acceptedLedger, acceptedTree),
				};
				return await this.#completeTerminalAttempt(failedAttempt);
			}
		});
	}

	async #repairIntegration(unit: FanoutWorkUnit, rejected: WorkerAttempt, applyError: string, signal?: AbortSignal): Promise<WorkerAttempt> {
		if (!rejected.patch) return { ...rejected, ok: false, error: rejected.error ?? "integration repair has no rejected patch", failureKind: "patch", retryable: false };
		let currentError = applyError;
		let sourceAttemptId = rejected.attemptId;
		let recoveryContext = rejected.recovery;
		let lastRejected = rejected;
		while ((this.#attemptStates.get(unit.id)?.counts.integrationRepair ?? 0) < 2) {
			signal?.throwIfAborted();
			if (recoveryContext?.kind !== "integration") break;
			const repair = await this.#runWorkerAttempt(unit, tierOne(this.#packet), "integration-repair", recoveryContext, undefined, sourceAttemptId, undefined, signal);
			if (!repair.ok) {
				lastRejected = repair;
				if (this.#terminalOutcome(repair).action !== "integration-repair") return repair;
				sourceAttemptId = repair.attemptId;
				continue;
			}
			let gated = await this.#gateOwnershipAndValidation(unit, repair, signal);
			if (!gated.ok && gated.failureKind === "validation" && gated.patch && this.#terminalOutcome(gated).action === "validation-repair") {
				gated = await this.#repairValidation(unit, gated, signal);
			}
			if (!gated.ok) {
				return gated;
			}
			const applied = await this.#apply(unit, gated as GatedAttempt, signal);
			lastRejected = applied;
			if (applied.ok) {
				return applied;
			}
			if (applied.failureKind !== "apply") return applied;
			currentError = applied.error ?? currentError;
			sourceAttemptId = applied.attemptId;
			recoveryContext = applied.recovery;
		}
		return { ...lastRejected, ok: false, error: currentError || "integration repair attempts exhausted", failureKind: "apply", retryable: false };
	}

	async #finishFailedAttempt(attempt: WorkerAttempt): Promise<WorkerAttempt> {
		return await this.#completeTerminalAttempt(attempt);
	}

	async #completeAbortedAttempt(attempt: WorkerAttempt, reason: unknown): Promise<WorkerAttempt> {
		return await this.#completeTerminalAttempt({
			...attempt,
			ok: false,
			error: reason === undefined ? "Fanout attempt aborted" : errorMessage(reason),
			failureKind: "process",
			retryable: false,
			terminalFact: { stage: "process", code: "user-abort", durationMs: Math.max(0, Date.now() - Date.parse(attempt.startedAt)) },
		});
	}

	async #completeTerminalAttempt(attempt: WorkerAttempt): Promise<WorkerAttempt> {
		if (!attempt.terminalFact) throw new Error(`attempt ${attempt.attemptId} has no typed terminal fact`);
		await this.#completeAttempt(attempt, attempt.terminalFact, attempt.terminalFact.stage === "validation" || attempt.terminalFact.stage === "apply" ? attempt.recovery : undefined);
		return attempt;
	}

	async #completeAttempt(attempt: WorkerAttempt, terminalFact: StageFact, recovery?: AttemptRecoveryContext, acceptedTransition?: AcceptedStateTransition): Promise<AttemptOutcome> {
		const existing = this.#outcomes.find((outcome) => outcome.attemptId === attempt.attemptId);
		if (existing) return existing;
		const state = this.#attemptStates.get(attempt.allocation.nodeId);
		if (!state) throw new Error(`missing attempt state for ${attempt.allocation.nodeId}`);
		const prepared = prepareAttemptCompletion(attempt.allocation, {
			startedAt: attempt.startedAt,
			finishedAt: new Date().toISOString(),
			terminalFact,
			state,
			fallbackAllowed: attempt.fallbackAllowed,
			metrics: attempt.correlatedMetrics,
			...(recovery ? { recovery } : {}),
			evidenceRefs: attemptEvidenceRefs(this.#runDir, attempt),
			...(attempt.error ? { diagnostic: attempt.error } : {}),
		});
		const artifactPath = `${relative(this.#runDir, attempt.attemptDir).split("\\").join("/")}/attempt-outcome.json`;
		try {
			writeArtifactAtomically(this.#runDir, artifactPath, Buffer.from(`${JSON.stringify(prepared.outcome, null, 2)}\n`));
		} catch (error) {
			discardPreparedAttemptCompletion(prepared);
			throw error;
		}
		const outcome = commitAttemptCompletion(prepared);
		this.#outcomes = appendTerminalOutcome(this.#outcomes, outcome);
		await this.#recorder.recordAttemptCompleted(outcome, acceptedTransition);
		return outcome;
	}

	#terminalOutcome(attempt: WorkerAttempt): AttemptOutcome {
		const outcome = this.#outcomes.find((candidate) => candidate.attemptId === attempt.attemptId);
		if (!outcome) throw new Error(`attempt ${attempt.attemptId} has no terminal outcome`);
		return outcome;
	}

	async #withApplyLock<T>(run: () => T | Promise<T>): Promise<T> {
		const previous = this.#applyTail;
		let release!: () => void;
		this.#applyTail = new Promise<void>((resolvePromise) => {
			release = resolvePromise;
		});
		await previous;
		try {
			return await run();
		} finally {
			release();
		}
	}

	#contract(unit: FanoutWorkUnit): WorkContract {
		const existing = this.#contracts.get(unit.id);
		if (existing) return existing;
		const contract = unit.workContract;
		this.#contracts.set(unit.id, contract);
		return contract;
	}
}

export function createFanoutNodeExecutor(options: FanoutNodeExecutorOptions): FanoutNodeExecutor {
	return new FanoutNodeExecutor(options);
}

function tierForUnit(unit: FanoutWorkUnit): WorkerTier {
	return { tier: unit.tier.assigned, provider: unit.tier.provider, model: unit.tier.model, thinking: unit.tier.thinking };
}

function tierOne(packet: FanoutExecutionPacket): WorkerTier {
	return { tier: "tier1", provider: packet.tierPlan.tier1.provider, model: packet.tierPlan.tier1.model, thinking: packet.tierPlan.tier1.thinking };
}

function tierTwoFallback(packet: FanoutExecutionPacket): WorkerTier {
	return { tier: "tier1", provider: packet.tierPlan.tier2Fallback.provider, model: packet.tierPlan.tier2Fallback.model, thinking: packet.tierPlan.tier2Fallback.thinking };
}

function failed(attempt: WorkerAttempt): DagNodeResult {
	return { ok: false, error: attempt.error ?? `${attempt.kind} attempt ${attempt.attemptId} failed` };
}

function validationError(result: ValidationRunResult): string {
	const failedCommand = result.commands.find((command) => command.outcome !== "passed" && command.outcome !== "unexecuted");
	return failedCommand ? `${failedCommand.command.executable} ${failedCommand.command.args.join(" ")}: ${failedCommand.spawnError || failedCommand.stderr.trim() || failedCommand.stdout.trim() || failedCommand.signal || failedCommand.outcome}` : "validation failed";
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

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`);
	return result;
}

function fixedRepairLimit(value: number | undefined, name: string): void {
	if (value !== undefined && value !== 2) throw new Error(`${name} is fixed at 2`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function abortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

function roundMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}

const CLI_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
