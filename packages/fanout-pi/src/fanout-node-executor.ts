import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { AcceptedPatch, AcceptedStateTransition } from "../../fanout-core/src/artifact-identity.ts";
import type { ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
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
import type { AcceptedLedgerProvenance, AttemptRecoveryContext } from "../../fanout-core/src/recovery-evidence.ts";
import type { FanoutExecutionPacket, FanoutWorkUnit, TierName } from "../../fanout-core/src/execution-packet.ts";
import type { DagNodeResult } from "../../fanout-core/src/dag-scheduler.ts";
import type { ExecutionEventName, PatchStats, ValidationStats, WorkerMetrics } from "../../fanout-core/src/execution-run.ts";
import type { ExecutionRecorder } from "./execution-recorder.ts";
import {
	artifactSegment,
	checkContractOwnership,
	checkFinalRepairOwnership,
	normalizeRepoPath,
	runProcess,
	writeJson,
} from "./fanout-git.ts";
import { buildCanonicalWorkerPrompt, importWorkerMetrics, type SourceTaggedRepositoryInstruction } from "./fanout-worker-contract.ts";
import { WORKER_MODEL_TOOLS } from "./worker-capabilities.ts";
import {
	AmbiguousApplyError,
	applyAcceptedTransition,
	capturePatchCandidate,
	capturePlanningBase,
	createReconstructedWorktree,
	fullGitVisibleTree,
	verifyPatchCandidate,
	type PlanningBase,
} from "./repository-identity.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import { legacyWorkContract } from "./legacy-work-contract.ts";
import type { WorkContract } from "../../fanout-core/src/work-contract.ts";
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
	repoRoot: string;
	runDir: string;
	runId: string;
	extensionEntry: string;
	recorder: ExecutionRecorder;
	piCommand?: string;
	workerTimeoutMs?: number;
	validationTimeoutMs?: number;
	maxValidationRepairAttempts?: number;
	maxIntegrationRepairAttempts?: number;
}

export class FanoutNodeExecutor {
	readonly #packet: FanoutExecutionPacket;
	readonly #repoRoot: string;
	readonly #runDir: string;
	readonly #runId: string;
	readonly #extensionEntry: string;
	readonly #recorder: ExecutionRecorder;
	readonly #piCommand: string;
	readonly #workerTimeoutMs: number;
	readonly #validationTimeoutMs: number;
	readonly #planningBase: PlanningBase;
	#attemptStates = new Map<string, NodeAttemptState>();
	#outcomes: AttemptOutcome[] = [];
	#acceptedLedger: AcceptedLedgerProvenance[] = [];
	#contracts = new Map<string, WorkContract>();
	#applyTail: Promise<void> = Promise.resolve();

	constructor(options: FanoutNodeExecutorOptions) {
		this.#packet = options.packet;
		this.#repoRoot = resolve(options.repoRoot);
		this.#runDir = resolve(options.runDir);
		this.#runId = options.runId;
		this.#extensionEntry = resolve(options.extensionEntry);
		this.#recorder = options.recorder;
		this.#piCommand = options.piCommand ?? process.env.FANOUT_PI_COMMAND ?? "pi";
		this.#workerTimeoutMs = positiveInteger(options.workerTimeoutMs, 600_000, "workerTimeoutMs");
		this.#validationTimeoutMs = positiveInteger(options.validationTimeoutMs, 600_000, "validationTimeoutMs");
		fixedRepairLimit(options.maxValidationRepairAttempts, "maxValidationRepairAttempts");
		fixedRepairLimit(options.maxIntegrationRepairAttempts, "maxIntegrationRepairAttempts");
		this.#planningBase = capturePlanningBase(this.#repoRoot);
	}

	finalValidationCommands(fallback: readonly ValidationCommand[]): ValidationCommand[] {
		const finalUnit = this.#packet.workUnits.find((unit) => unit.kind === "final-validation");
		return finalUnit ? [...this.#contract(finalUnit).validationCommands] : [...fallback];
	}

	async runFinalValidation(commands: readonly ValidationCommand[]): Promise<FinalValidationResult> {
		const initialTree = this.#acceptedLedger.at(-1)?.patch.resultTree ?? this.#planningBase.tree;
		const finalUnit = this.#packet.workUnits.find((unit) => unit.kind === "final-validation");
		const finalContract = finalUnit ? this.#contract(finalUnit) : undefined;
		const authoritativeCommands = finalContract?.validationCommands ?? commands;
		const repairContract = finalContract ? deriveFinalRepairWorkContract(this.#packet.workUnits.filter((unit) => unit !== finalUnit).map((unit) => this.#contract(unit)), finalContract) : undefined;
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
			...(repairUnit && repairContract ? { repair: {
				workContract: repairContract,
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
		await this.#event("ownership_check_finished", { nodeId: unit.id, attemptId: attempt.attemptId, finalRepair: true, ...ownership });
		if (ownership.ok) return true;
		this.#completeTerminalAttempt({ ...attempt, ok: false, error: ownership.violations.map((value) => `${value.file}: ${value.reason}`).join("; "), failureKind: "ownership", terminalFact: { stage: "worker-gate", code: ownership.violations.some((value) => value.reason.includes("forbidden")) ? "forbidden-change" : "unauthorized-change" } });
		return false;
	}

	async #rejectFinalRepair(attempt: WorkerAttempt, result: FinalValidationResult, recovery: AttemptRecoveryContext | undefined, fact: StageFact): Promise<boolean> {
		const repairBudgetRemains = (this.#attemptStates.get(attempt.allocation.nodeId)?.counts.validationRepair ?? 0) < 2;
		const completed = this.#completeTerminalAttempt({ ...attempt, ok: false, error: result.evidence.failure?.kind === "hard" ? result.evidence.failure.detail : "final validation program failed", failureKind: "validation", terminalFact: fact, ...(recovery && repairBudgetRemains ? { recovery } : {}) });
		return this.#terminalOutcome(completed).action === "validation-repair";
	}

	async runNode(unit: FanoutWorkUnit): Promise<DagNodeResult> {
		try {
			this.#contract(unit);
		} catch (error) {
			return { ok: false, error: errorMessage(error) };
		}
		const original = await this.#runOriginalWithRetry(unit);
		if (!original.ok) return failed(original);

		let gated = await this.#gateOwnershipAndValidation(unit, original);
		if (!gated.ok && gated.failureKind === "validation" && this.#terminalOutcome(gated).action === "validation-repair") gated = await this.#repairValidation(unit, gated);
		if (!gated.ok) return failed(gated);

		const applied = await this.#apply(unit, gated);
		if (applied.ok) return { ok: true };
		if (applied.failureKind !== "apply") return failed(applied);

		const repaired = await this.#repairIntegration(unit, applied, applied.error ?? "git apply --check failed");
		return repaired.ok ? { ok: true } : failed(repaired);
	}

	async #runOriginalWithRetry(unit: FanoutWorkUnit): Promise<WorkerAttempt> {
		const assigned = tierForUnit(unit);
		let outcome: WorkerAttempt | undefined;
		for (let attempt = 1; attempt <= 2; attempt++) {
			if (attempt > 1) {
				await this.#event("worker_clean_rerun_scheduled", { nodeId: unit.id, tier: assigned.tier, nextAttempt: attempt });
				if (assigned.tier === "tier2") await this.#event("worker_retry_scheduled", { nodeId: unit.id, tier: assigned.tier, nextAttempt: attempt });
			}
			outcome = await this.#runWorkerAttempt(unit, assigned, attempt === 1 ? "original" : "retry", undefined, undefined, outcome?.attemptId);
			if (outcome.ok || this.#terminalOutcome(outcome).action !== "retry") {
				if (attempt === 2 && this.#terminalOutcome(outcome).action === "fallback") break;
				return outcome;
			}
		}

		if (assigned.tier !== "tier2" || !outcome || this.#terminalOutcome(outcome).action !== "fallback" || unit.tier.fallback !== "tier1") {
			if (!outcome) throw new Error(`worker attempts did not run for ${unit.id}`);
			return outcome;
		}
		const fallback = tierTwoFallback(this.#packet);
		await this.#event("worker_fallback_started", { nodeId: unit.id, fromTier: "tier2", tier: "tier1", provider: fallback.provider, model: fallback.model });
		const result = await this.#runWorkerAttempt(unit, fallback, "fallback", undefined, undefined, outcome.attemptId);
		await this.#event(result.ok ? "worker_fallback_finished" : "worker_fallback_failed", { nodeId: unit.id, attemptId: result.attemptId, error: result.error });
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
	): Promise<WorkerAttempt> {
		const previousState = this.#attemptStates.get(unit.id) ?? createNodeAttemptState(unit.id);
		const allocated = allocateAttempt(previousState, {
			runId: this.#runId,
			nodeId: unit.id,
			kind,
			assignment: { tier: tier.tier, provider: tier.provider, model: tier.model },
			...(sourceAttemptId ? { sourceAttemptId } : {}),
			...(sourceFinalValidationEvidence ? { sourceFinalValidationEvidence } : {}),
			fallbackAllowed: unit.tier.fallback === "tier1",
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
			fallbackAllowed: unit.tier.fallback === "tier1",
		};
		await this.#event("worker_attempt_started", { nodeId: unit.id, attemptId, kind, tier: tier.tier, provider: tier.provider, model: tier.model, allocation });
		mkdirSync(attemptDir, { recursive: true });

		let attemptBase: PlanningBase;
		try {
			const ledger = await this.#withApplyLock(() => this.#acceptedLedger.map(({ patch }) => ({ patch })));
			attemptBase = createReconstructedWorktree(this.#repoRoot, worktreePath, this.#planningBase, this.#runDir, ledger);
			if (seedPatch) {
				applyAcceptedTransition(worktreePath, this.#runDir, seedPatch);
			}
		} catch (error) {
			const failedAttempt = { ...base, worktreePath, error: errorMessage(error), failureKind: "process" as const, retryable: true, terminalFact: { stage: "process", code: "infrastructure-failure", durationMs: 0 } as const };
			writeJson(join(attemptDir, "result.json"), { nodeId: unit.id, attemptId, kind, tier, error: failedAttempt.error, failureKind: failedAttempt.failureKind });
			return await this.#finishFailedAttempt(unit, failedAttempt);
		}

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
		});
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
		base.correlatedMetrics = correlatedWorkerMetrics(attemptId, imported.metrics, stdoutPath, observabilityPath, processResult.firstOutputMs);
		const metricsCorrelated = base.correlatedMetrics.complete;
		if (imported.ok && imported.metrics && metricsCorrelated) {
			this.#recorder.recordAttemptMetrics(unit.id, attemptId, imported.metrics);
			await this.#event("metrics_imported", { nodeId: unit.id, attemptId, metrics: imported.metrics });
		} else {
			this.#recorder.recordAttemptMetrics(unit.id, attemptId, imported.partialMetrics);
			await this.#event("metrics_missing", { nodeId: unit.id, attemptId, errors: [...imported.errors, ...(metricsCorrelated ? [] : ["attempt identity correlation incomplete"])], partialMetrics: imported.partialMetrics });
		}

		let patch: AcceptedPatch | undefined;
		let patchError: string | undefined;
		await this.#event("patch_capture_started", { nodeId: unit.id, attemptId });
		try {
			const patchPath = `${relative(this.#runDir, attemptDir).split("\\").join("/")}/patch.bin`;
			patch = capturePatchCandidate(worktreePath, attemptBase, this.#runDir, patchPath);
			await this.#event("patch_capture_finished", { nodeId: unit.id, attemptId, changedFiles: patch.changedPaths, stats: patch.stats, artifact: patch.artifact });
		} catch (error) {
			patchError = errorMessage(error);
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId, reason: "patch_capture_failed", error: patchError });
		}

		const processOk = processResult.exitCode === 0 && !processResult.timedOut && !processResult.spawnError;
		const hasUsablePatch = Boolean(patch && (patch.artifact.byteLength > 0 || unit.ownedFiles.length === 0));
		const resultData = {
			nodeId: unit.id,
			attemptId,
			kind,
			tier,
			process: { ...processResult, stdout: undefined, stderr: undefined },
			metrics: imported.metrics,
			metricErrors: imported.errors,
			patch: patch ? { artifact: patch.artifact, changedFiles: patch.changedPaths, stats: patch.stats, baseTree: patch.baseTree, resultTree: patch.resultTree } : undefined,
			patchError,
		};
		writeJson(join(attemptDir, "result.json"), resultData);
		if (!processOk) {
			const details = [processResult.timedOut ? "worker timed out" : undefined, processResult.spawnError, processResult.exitCode !== 0 ? `worker exited ${processResult.exitCode}` : undefined, processResult.stderr.trim()].filter(Boolean).join(": ");
			return await this.#finishFailedAttempt(unit, {
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
		if (!imported.ok || !imported.metrics || !metricsCorrelated) return await this.#finishFailedAttempt(unit, { ...base, worktreePath, base: attemptBase, patch, error: [...imported.errors, ...(metricsCorrelated ? [] : ["attempt identity correlation incomplete"])].join("; "), failureKind: "metrics", retryable: false, terminalFact: { stage: "metrics", code: metricsCorrelated ? "malformed" : "correlation-mismatch" } });
		if (!patch) return await this.#finishFailedAttempt(unit, { ...base, worktreePath, base: attemptBase, metrics: imported.metrics, error: patchError ?? "patch could not be captured", failureKind: "patch", retryable: false, terminalFact: { stage: "worker-gate", code: "malformed-patch" } });
		if (patch.artifact.byteLength === 0 && unit.ownedFiles.length > 0) return await this.#finishFailedAttempt(unit, { ...base, worktreePath, base: attemptBase, metrics: imported.metrics, patch, error: "worker produced no patch for a mutating work unit", failureKind: "patch", retryable: false, terminalFact: { stage: "worker-gate", code: "mutating-noop" } });

		await this.#event("worker_attempt_finished", { nodeId: unit.id, attemptId, kind, tier: tier.tier });
		return { ...base, ok: true, worktreePath, base: attemptBase, metrics: imported.metrics, patch };
	}

	async #gateOwnershipAndValidation(unit: FanoutWorkUnit, attempt: WorkerAttempt): Promise<GatedAttempt | WorkerAttempt> {
		if (!attempt.ok || !attempt.worktreePath || !attempt.base || !attempt.metrics || !attempt.patch) return attempt;
		await this.#event("ownership_check_started", { nodeId: unit.id, attemptId: attempt.attemptId });
		let ownership;
		try {
			ownership = checkContractOwnership(this.#contract(unit), attempt.patch, attempt.attemptDir, this.#repoRoot);
		} catch (error) {
			ownership = { ok: false, violations: [{ file: "packet", reason: errorMessage(error) }] };
		}
		await this.#event("ownership_check_finished", { nodeId: unit.id, attemptId: attempt.attemptId, ...ownership });
		if (!ownership.ok) {
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: "ownership", violations: ownership.violations });
			return this.#completeTerminalAttempt({
				...attempt,
				ok: false,
				error: ownership.violations.map((value) => `${value.file}: ${value.reason}`).join("; "),
				failureKind: "ownership",
				retryable: false,
				terminalFact: { stage: "worker-gate", code: ownership.violations.some((value) => value.reason.includes("forbidden")) ? "forbidden-change" : "unauthorized-change" },
			});
		}

		const validationCommands = this.#contract(unit).validationCommands;
		await this.#event("validation_started", { nodeId: unit.id, attemptId: attempt.attemptId, commands: validationCommands });
		let validation: ValidationRunResult;
		try {
			validation = await runValidationCommands(validationCommands, {
				checkoutRoot: attempt.worktreePath,
				expectedPlatform: process.platform,
				scopeId: attempt.attemptId,
				timeoutMs: this.#validationTimeoutMs,
				inheritedEnv: process.env,
			});
		} catch (error) {
			const message = errorMessage(error);
			writeJson(join(attempt.attemptDir, "validation.json"), { status: "failed", preflightError: message, commands: validationCommands });
			await this.#event("validation_finished", { nodeId: unit.id, attemptId: attempt.attemptId, status: "failed", preflightError: message });
			return this.#completeTerminalAttempt({ ...attempt, ok: false, error: message, failureKind: "validation", retryable: false, terminalFact: { stage: "validation", code: "spawn-failure" } });
		}
		writeJson(join(attempt.attemptDir, "validation.json"), validation);
		this.#recorder.setValidationStats(unit.id, validationStats(validation));
		let patchUnchanged = false;
		let patchCheckError: string | undefined;
		try {
			verifyPatchCandidate(attempt.worktreePath, this.#runDir, attempt.patch);
			patchUnchanged = true;
		} catch (error) {
			patchCheckError = errorMessage(error);
		}
		await this.#event("validation_finished", { nodeId: unit.id, attemptId: attempt.attemptId, ...validation, patchUnchanged, patchCheckError });
		if (!patchUnchanged) {
			const error = patchCheckError ? `cannot verify the patch after validation: ${patchCheckError}` : "validation commands modified the captured patch";
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: "validation_modified_patch", error });
			return this.#completeTerminalAttempt({ ...attempt, ok: false, error, failureKind: "patch", retryable: false, terminalFact: { stage: "worker-gate", code: "post-validation-change" } });
		}
		if (validation.status === "failed") {
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: "validation" });
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
			return this.#completeTerminalAttempt(failedAttempt);
		}
		return { ...attempt, ok: true, validation } as GatedAttempt;
	}

	async #repairValidation(unit: FanoutWorkUnit, failedAttempt: WorkerAttempt): Promise<GatedAttempt | WorkerAttempt> {
		let current = failedAttempt;
		let seedPatch = failedAttempt.patch;
		let recoveryContext = failedAttempt.recovery;
		while ((this.#attemptStates.get(unit.id)?.counts.validationRepair ?? 0) < 2) {
			const attempt = (this.#attemptStates.get(unit.id)?.counts.validationRepair ?? 0) + 1;
			if (!seedPatch) break;
			await this.#event("validation_repair_started", { nodeId: unit.id, repairAttempt: attempt, sourceAttemptId: current.attemptId, tier: "tier1" });
			if (recoveryContext?.kind !== "validation") break;
			const repair = await this.#runWorkerAttempt(unit, tierOne(this.#packet), "validation-repair", recoveryContext, { patch: seedPatch }, current.attemptId);
			if (!repair.ok) {
				await this.#event("validation_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: repair.attemptId, error: repair.error });
				if (this.#terminalOutcome(repair).action !== "validation-repair") return repair;
				current = repair;
				continue;
			}
			const gated = await this.#gateOwnershipAndValidation(unit, repair);
			if (gated.ok) {
				await this.#event("validation_repair_finished", { nodeId: unit.id, repairAttempt: attempt, attemptId: gated.attemptId });
				return gated as GatedAttempt;
			}
			await this.#event("validation_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: gated.attemptId, error: gated.error });
			if (gated.failureKind === "ownership" || gated.failureKind === "metrics" || gated.failureKind === "unsafe") return gated;
			current = gated;
			seedPatch = gated.patch;
			recoveryContext = gated.recovery;
		}
		return { ...current, ok: false, error: current.error ?? "validation repair attempts exhausted", failureKind: "validation", retryable: false };
	}

	async #apply(unit: FanoutWorkUnit, attempt: GatedAttempt): Promise<WorkerAttempt> {
		await this.#event("patch_apply_check_started", { nodeId: unit.id, attemptId: attempt.attemptId });
		return await this.#withApplyLock(async () => {
			const started = performance.now();
			try {
				const transition = applyAcceptedTransition(this.#repoRoot, this.#runDir, { patch: attempt.patch });
				const applyDurationMs = roundMs(performance.now() - started);
				try {
					writeJson(join(attempt.attemptDir, "apply-check.json"), { ok: true, artifact: attempt.patch.artifact, baseTree: attempt.patch.baseTree, resultTree: attempt.patch.resultTree, applyDurationMs });
					await this.#event("patch_apply_check_finished", { nodeId: unit.id, attemptId: attempt.attemptId, ok: true, baseTree: attempt.patch.baseTree, resultTree: attempt.patch.resultTree });
					this.#acceptAttempt(unit, attempt, applyDurationMs);
					await this.#event("patch_applied", { nodeId: unit.id, attemptId: attempt.attemptId, stats: attempt.patch.stats, applyDurationMs, noOp: attempt.patch.artifact.byteLength === 0 });
					this.#completeAttempt(attempt, { stage: "apply", code: "applied" });
					this.#acceptedLedger.push({ sourceAttemptId: attempt.attemptId, patch: transition.patch });
					return attempt;
				} catch (error) {
					const failedAttempt = {
						...attempt,
						ok: false,
						error: `bookkeeping failed after active mutation: ${errorMessage(error)}`,
						failureKind: "bookkeeping",
						retryable: false,
						terminalFact: { stage: "bookkeeping", code: "failed-after-mutation" },
					} as WorkerAttempt;
					return this.#outcomes.some((outcome) => outcome.attemptId === attempt.attemptId) ? failedAttempt : this.#completeTerminalAttempt(failedAttempt);
				}
			} catch (error) {
				const message = errorMessage(error);
				if (error instanceof AmbiguousApplyError) return this.#completeTerminalAttempt({ ...attempt, ok: false, error: message, failureKind: "bookkeeping", retryable: false, terminalFact: { stage: "bookkeeping", code: "failed-after-mutation" } });
				const acceptedTree = this.#acceptedLedger.at(-1)?.patch.resultTree ?? this.#planningBase.tree;
				if (fullGitVisibleTree(this.#repoRoot) !== acceptedTree) {
					return this.#completeTerminalAttempt({ ...attempt, ok: false, error: `active worktree drifted from accepted state: ${message}`, failureKind: "bookkeeping", retryable: false, terminalFact: { stage: "apply", code: "state-drift" } });
				}
				const identityFailure = /artifact|identity|changed paths|statistics|result tree/i.test(message);
				try {
					writeJson(join(attempt.attemptDir, "apply-check.json"), { ok: false, error: message, baseTree: attempt.patch.baseTree, resultTree: attempt.patch.resultTree });
					await this.#event("patch_apply_check_finished", { nodeId: unit.id, attemptId: attempt.attemptId, ok: false, error: message });
					await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: identityFailure ? "patch_identity" : "apply_conflict", error: message });
				} catch {
					// The original deterministic gate failure remains authoritative.
				}
				if (identityFailure) return this.#completeTerminalAttempt({ ...attempt, ok: false, error: message, failureKind: "patch", retryable: false, terminalFact: { stage: "apply", code: "identity-failure" } });
				const failedAttempt = {
					...attempt,
					ok: false,
					error: message,
					failureKind: "apply" as const,
					retryable: false,
					terminalFact: { stage: "apply", code: "check-conflict" } as const,
					recovery: integrationFailureEvidence(this.#contract(unit), attempt, message, this.#acceptedLedger, acceptedTree),
				};
				return this.#completeTerminalAttempt(failedAttempt);
			}
		});
	}

	async #repairIntegration(unit: FanoutWorkUnit, rejected: WorkerAttempt, applyError: string): Promise<WorkerAttempt> {
		if (!rejected.patch) return { ...rejected, ok: false, error: rejected.error ?? "integration repair has no rejected patch", failureKind: "patch", retryable: false };
		let currentPatch = rejected.patch;
		let currentError = applyError;
		let sourceAttemptId = rejected.attemptId;
		let recoveryContext = rejected.recovery;
		while ((this.#attemptStates.get(unit.id)?.counts.integrationRepair ?? 0) < 2) {
			const attempt = (this.#attemptStates.get(unit.id)?.counts.integrationRepair ?? 0) + 1;
			await this.#event("integration_repair_started", { nodeId: unit.id, repairAttempt: attempt, sourceAttemptId, tier: "tier1" });
			if (recoveryContext?.kind !== "integration") break;
			const repair = await this.#runWorkerAttempt(unit, tierOne(this.#packet), "integration-repair", recoveryContext, undefined, sourceAttemptId);
			if (!repair.ok) {
				await this.#event("integration_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: repair.attemptId, error: repair.error });
				if (this.#terminalOutcome(repair).action !== "integration-repair") return repair;
				sourceAttemptId = repair.attemptId;
				continue;
			}
			let gated = await this.#gateOwnershipAndValidation(unit, repair);
			if (!gated.ok && gated.failureKind === "validation" && gated.patch && this.#terminalOutcome(gated).action === "validation-repair") {
				gated = await this.#repairValidation(unit, gated);
			}
			if (!gated.ok) {
				await this.#event("integration_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: gated.attemptId, error: gated.error });
				return gated;
			}
			const applied = await this.#apply(unit, gated as GatedAttempt);
			if (applied.ok) {
				await this.#event("integration_repair_finished", { nodeId: unit.id, repairAttempt: attempt, attemptId: applied.attemptId });
				return applied;
			}
			if (applied.failureKind !== "apply") return applied;
			currentPatch = (gated as GatedAttempt).patch;
			currentError = applied.error ?? currentError;
			sourceAttemptId = applied.attemptId;
			recoveryContext = applied.recovery;
			await this.#event("integration_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: applied.attemptId, error: applied.error });
		}
		return { ...rejected, ok: false, error: currentError || "integration repair attempts exhausted", failureKind: "apply", retryable: false };
	}

	#acceptAttempt(unit: FanoutWorkUnit, attempt: GatedAttempt, applyDurationMs: number): void {
		this.#recorder.recordAttemptMetrics(unit.id, attempt.attemptId, attempt.metrics, { accepted: true });
		const stats: PatchStats = { ...attempt.patch.stats, applyDurationMs, changedFiles: attempt.patch.changedPaths };
		this.#recorder.setPatchStats(unit.id, stats);
	}

	async #finishFailedAttempt(unit: FanoutWorkUnit, attempt: WorkerAttempt): Promise<WorkerAttempt> {
		await this.#event("worker_attempt_failed", {
			nodeId: unit.id,
			attemptId: attempt.attemptId,
			kind: attempt.kind,
			tier: attempt.tier.tier,
			error: attempt.error,
			failureKind: attempt.failureKind,
			retryable: attempt.retryable === true,
		});
		return this.#completeTerminalAttempt(attempt);
	}

	#completeTerminalAttempt(attempt: WorkerAttempt): WorkerAttempt {
		if (!attempt.terminalFact) throw new Error(`attempt ${attempt.attemptId} has no typed terminal fact`);
		this.#completeAttempt(attempt, attempt.terminalFact, attempt.terminalFact.stage === "validation" || attempt.terminalFact.stage === "apply" ? attempt.recovery : undefined);
		return attempt;
	}

	#completeAttempt(attempt: WorkerAttempt, terminalFact: StageFact, recovery?: AttemptRecoveryContext): AttemptOutcome {
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
		return outcome;
	}

	#terminalOutcome(attempt: WorkerAttempt): AttemptOutcome {
		const outcome = this.#outcomes.find((candidate) => candidate.attemptId === attempt.attemptId);
		if (!outcome) throw new Error(`attempt ${attempt.attemptId} has no terminal outcome`);
		return outcome;
	}

	async #event(event: ExecutionEventName, data: Record<string, unknown>): Promise<void> {
		await this.#recorder.appendEvent(event, data);
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
		const contract = legacyWorkContract(unit, this.#repoRoot, this.#packet.workUnits);
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

function validationStats(result: ValidationRunResult): ValidationStats {
	return { commandCount: result.executedCount, durationMs: result.durationMs, status: result.status };
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
	for (const rawPath of [...unit.ownedFiles, ...unit.readOnlyFiles]) {
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

function roundMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}

const CLI_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
