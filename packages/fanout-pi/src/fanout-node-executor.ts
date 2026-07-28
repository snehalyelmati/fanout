import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { AcceptedPatch, AcceptedStateTransition } from "../../fanout-core/src/artifact-identity.ts";
import { verifyArtifactBytes, type ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
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
import { executionPacketBytes, type FanoutExecutionPacket, type FanoutWorkUnit } from "../../fanout-core/src/execution-packet.ts";
import type { DagNodeResult } from "../../fanout-core/src/dag-scheduler.ts";
import type { WorkerMetrics } from "../../fanout-core/src/worker-metrics.ts";
import type { ProjectExecutionProfile } from "../../fanout-core/src/project-execution-profile.ts";
import {
	artifactSegment,
	checkContractOwnership,
	ownershipViolationFactCode,
	writeJson,
} from "./fanout-git.ts";
import {
	AcceptedTransitionIdentityError,
	AcceptedTransitionProcessError,
	AmbiguousApplyError,
	applyAcceptedTransition,
	applyRepairSeedOverlay,
	createReconstructedWorktree,
	fullGitVisibleTree,
	removeReconstructedWorktree,
	verifyPatchCandidate,
	type PlanningBase,
} from "./repository-identity.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import { runValidationCommands, type ValidationRunResult } from "./validation-runner.ts";
import type { FinalValidationResult } from "../../fanout-core/src/final-validation.ts";
import type { ValidationCommand } from "../../fanout-core/src/validation-command.ts";
import {
	attemptEvidenceRefs,
	integrationFailureEvidence,
	validationFailureEvidence,
} from "./attempt-evidence.ts";
import { cleanupReconciliationWorktree, reconcilePathDisjointCandidate } from "./candidate-reconciliation.ts";
import { prepareProjectWorktree } from "./project-execution-profile.ts";
import { finalValidationCommands, runExecutorFinalValidation } from "./final-validation-adapter.ts";
import { executeWorkerAttempt, type AttemptKind, type WorkerAttempt, type WorkerTier } from "./worker-attempt-execution.ts";

interface GatedAttempt extends WorkerAttempt {
	ok: true;
	worktreePath: string;
	base: PlanningBase;
	metrics: WorkerMetrics;
	patch: AcceptedPatch;
	validation: ValidationRunResult;
}

interface ApplyConflict {
	reconcile: true;
	attempt: GatedAttempt;
	evidence: AcceptedTransitionProcessError["evidence"];
	acceptedTree: AcceptedPatch["resultTree"];
	ledger: AcceptedLedgerProvenance[];
}

interface WorkerLaunchOptions {
	recovery?: AttemptRecoveryContext;
	seedPatch?: AcceptedStateTransition;
	sourceAttemptId?: string;
	sourceFinalValidationEvidence?: ArtifactIdentity;
	signal?: AbortSignal;
	precedingWorkerSummary?: string;
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
	profile: ProjectExecutionProfile;
	profileIdentity: ArtifactIdentity;
	afterActiveApply?: () => void;
	/** Deterministic normalization audit-race injection for repository-boundary regression tests. */
	beforeNormalizationAuditRewrite?: () => void;
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
	readonly #profile: ProjectExecutionProfile;
	readonly #profileIdentity: ArtifactIdentity;
	readonly #afterActiveApply?: () => void;
	readonly #beforeNormalizationAuditRewrite?: () => void;
	#attemptStates = new Map<string, NodeAttemptState>();
	#outcomes: AttemptOutcome[] = [];
	#acceptedLedger: AcceptedLedgerProvenance[] = [];
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
		this.#beforeNormalizationAuditRewrite = options.beforeNormalizationAuditRewrite;
		this.#planningBase = this.#packet.planningBase;
		this.#profile = structuredClone(options.profile);
		this.#profileIdentity = structuredClone(options.profileIdentity);
	}

	get manualReconciliationRequired(): boolean { return this.#manualReconciliationRequired; }

	finalValidationCommands(fallback: readonly ValidationCommand[]): ValidationCommand[] {
		return finalValidationCommands(this.#packet, this.#profile, fallback);
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
		return await runExecutorFinalValidation({
			packet: this.#packet,
			packetIdentity: this.#packetIdentity,
			profile: this.#profile,
			profileIdentity: this.#profileIdentity,
			repoRoot: this.#repoRoot,
			runDir: this.#runDir,
			planningBase: this.#planningBase,
			acceptedLedger: this.#acceptedLedger,
			commands,
			timeoutMs: this.#validationTimeoutMs,
			repairAvailable: (nodeId) => (this.#attemptStates.get(nodeId)?.counts.validationRepair ?? 0) < 2,
			launchRepair: async (unit, recovery, source, seed) => await this.#runWorkerAttempt(unit, tierOne(this.#packet), "validation-repair", {
				recovery,
				seedPatch: seed ? { patch: seed.patch as AcceptedPatch } : undefined,
				sourceAttemptId: source.attemptId,
				sourceFinalValidationEvidence: source.evidence,
			}),
			completeTerminal: async (attempt) => await this.#completeTerminalAttempt(attempt),
			terminalOutcome: (attempt) => this.#terminalOutcome(attempt),
			applyRepair: async (unit, attempt, result) => (await this.#apply(unit, { ...attempt, validation: { status: "passed", executedCount: result.commandCount, durationMs: result.durationMs, commands: [] } } as GatedAttempt)).ok,
		});
	}

	async runNode(unit: FanoutWorkUnit, signal?: AbortSignal): Promise<DagNodeResult> {
		signal?.throwIfAborted();
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
			outcome = await this.#runWorkerAttempt(unit, assigned, attempt === 1 ? "original" : "retry", { sourceAttemptId: outcome?.attemptId, signal });
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
		const result = await this.#runWorkerAttempt(unit, fallback, "fallback", { sourceAttemptId: outcome.attemptId, signal });
		return result;
	}

	async #runWorkerAttempt(
		unit: FanoutWorkUnit,
		tier: WorkerTier,
		kind: AttemptKind,
		launch: WorkerLaunchOptions = {},
	): Promise<WorkerAttempt> {
		const { recovery, seedPatch, sourceAttemptId, sourceFinalValidationEvidence, signal } = launch;
		signal?.throwIfAborted();
		if (sourceFinalValidationEvidence) {
			if (recovery?.kind !== "final-validation") throw new Error("final validation repair launch requires typed failed-round recovery evidence");
			assertFinalValidationRecoverySource(recovery, sourceFinalValidationEvidence);
		}
		const previousState = this.#attemptStates.get(unit.id) ?? createNodeAttemptState(unit.id);
		const fallbackAllowed = this.#packet.runtimePolicy.fallbackAllowed && unit.tier.fallback === "tier1";
		const allocated = allocateAttempt(previousState, {
			runId: this.#runId,
			nodeId: unit.id,
			kind,
			assignment: { tier: tier.tier, provider: tier.provider, model: tier.model },
			...(sourceAttemptId ? { sourceAttemptId } : {}),
			...(sourceFinalValidationEvidence ? { sourceFinalValidationEvidence } : {}),
			fallbackAllowed,
		});
		const artifactAttemptId = `${String(allocated.allocation.attemptNumber).padStart(3, "0")}-${kind}`;
		const attemptDir = join(this.#runDir, "workers", artifactSegment(unit.id), "attempts", artifactAttemptId);
		const worktreePath = join(attemptDir, "worktree");
		const startedAt = new Date().toISOString();
		const ledger = await this.#withApplyLock(() => this.#acceptedLedger.map(({ patch }) => ({ patch })));
		this.#worktrees.add(worktreePath);
		const attemptBase = createReconstructedWorktree(this.#repoRoot, worktreePath, this.#planningBase, this.#runDir, ledger);
		if (seedPatch) applyRepairSeedOverlay(worktreePath, this.#runDir, seedPatch, { exact: recovery?.kind === "final-validation" });
		const prepared = await prepareProjectWorktree(this.#profile, this.#profileIdentity, {
			worktreePath,
			artifactRoot: this.#runDir,
			evidencePath: `${relative(this.#runDir, attemptDir).split("\\").join("/")}/preparation.json`,
			scopeId: allocated.allocation.attemptId,
			timeoutMs: this.#validationTimeoutMs,
			signal,
		});
		if (prepared.evidence.status !== "passed") throw new Error(`project worktree preparation failed before attempt allocation: ${prepared.evidence.error ?? "unknown failure"}`);
		this.#attemptStates.set(unit.id, allocated.state);
		await this.#recorder.recordAttemptAllocated(allocated.allocation);
		const attempt = await executeWorkerAttempt({
			packet: this.#packet,
			unit,
			contract: unit.workContract,
			repoRoot: this.#repoRoot,
			runDir: this.#runDir,
			runId: this.#runId,
			extensionEntry: this.#extensionEntry,
			piCommand: this.#piCommand,
			workerTimeoutMs: this.#workerTimeoutMs,
			validationTimeoutMs: this.#validationTimeoutMs,
			planningBase: this.#planningBase,
			ledger,
			profile: this.#profile,
			preparedBase: attemptBase,
			allocation: allocated.allocation,
			attemptDir,
			worktreePath,
			tier,
			kind,
			startedAt,
			fallbackAllowed,
			...(recovery ? { recovery } : {}),
			...(launch.precedingWorkerSummary ? { precedingWorkerSummary: launch.precedingWorkerSummary } : {}),
			...(seedPatch ? { seedPatch } : {}),
			...(signal ? { signal } : {}),
			...(this.#beforeNormalizationAuditRewrite ? { beforeNormalizationAuditRewrite: this.#beforeNormalizationAuditRewrite } : {}),
		});
		return attempt.ok ? attempt : await this.#finishFailedAttempt(attempt);
	}

	async #gateOwnershipAndValidation(unit: FanoutWorkUnit, attempt: WorkerAttempt, signal?: AbortSignal): Promise<GatedAttempt | WorkerAttempt> {
		if (!attempt.ok || !attempt.worktreePath || !attempt.base || !attempt.metrics || !attempt.patch) return attempt;
		if (signal?.aborted) return await this.#completeAbortedAttempt(attempt, signal.reason);
		let ownership;
		try {
			ownership = checkContractOwnership(unit.workContract, attempt.patch, attempt.attemptDir, this.#repoRoot);
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

		const validationCommands = unit.workContract.validationCommands;
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
			const evidence = validationFailureEvidence(unit.workContract, attempt, validation);
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
			const repair = await this.#runWorkerAttempt(unit, tierOne(this.#packet), "validation-repair", {
				recovery: recoveryContext,
				seedPatch: { patch: seedPatch },
				sourceAttemptId: current.attemptId,
				signal,
				precedingWorkerSummary: current.workerSummary,
			});
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
		let conflict = await this.#withApplyLock(() => this.#applyLocked(unit, attempt, signal, true));
		let ledgerAdvanceRetry = 0;
		while ("reconcile" in conflict) {
			signal?.throwIfAborted();
			const reconciliation = await reconcilePathDisjointCandidate({
				repoRoot: this.#repoRoot,
				runDir: this.#runDir,
				attemptDir: attempt.attemptDir,
				attemptId: attempt.attemptId,
				planningBase: this.#planningBase,
				ledger: conflict.ledger.map(({ patch }) => ({ patch })),
				candidate: attempt.patch,
				contract: unit.workContract,
				profile: this.#profile,
				profileIdentity: this.#profileIdentity,
				ledgerAdvanceRetry,
				timeoutMs: this.#validationTimeoutMs,
				signal,
			});
			const resolved = await this.#withApplyLock(async () => {
				const acceptedTree = this.#acceptedLedger.at(-1)?.patch.resultTree ?? this.#planningBase.tree;
				if (acceptedTree !== conflict.acceptedTree || this.#acceptedLedger.length !== conflict.ledger.length) return undefined;
				if (!reconciliation.ok) {
					if (["preparation-failed", "repository-failed"].includes(reconciliation.code)) {
						return await this.#completeTerminalAttempt({
							...attempt,
							ok: false,
							error: reconciliation.detail,
							failureKind: "process",
							retryable: false,
							terminalFact: { stage: "process", code: "infrastructure-failure", durationMs: 0 },
						});
					}
					const recovery = integrationFailureEvidence(unit.workContract, attempt, conflict.evidence, this.#acceptedLedger, acceptedTree);
					return await this.#completeTerminalAttempt({ ...attempt, ok: false, error: reconciliation.detail, failureKind: "apply", retryable: false, terminalFact: { stage: "apply", code: "check-conflict" }, recovery });
				}
				const reconciled = { ...attempt, patch: reconciliation.patch, validation: reconciliation.validation, base: reconciliation.base, worktreePath: reconciliation.worktreePath } as GatedAttempt;
				return await this.#applyLocked(unit, reconciled, signal, false, "deterministic-reconciliation");
			});
			if (reconciliation.ok) cleanupReconciliationWorktree(this.#repoRoot, reconciliation.worktreePath);
			if (resolved) return resolved;
			ledgerAdvanceRetry += 1;
			conflict = await this.#withApplyLock(() => this.#applyLocked(unit, attempt, signal, true));
		}
		return conflict;
	}

	async #applyLocked(
		unit: FanoutWorkUnit,
		attempt: GatedAttempt,
		signal: AbortSignal | undefined,
		allowReconciliation: boolean,
		disposition?: "deterministic-reconciliation",
	): Promise<WorkerAttempt | ApplyConflict> {
			if (signal?.aborted) return await this.#completeAbortedAttempt(attempt, signal.reason);
			const started = performance.now();
			try {
				const transition = applyAcceptedTransition(this.#repoRoot, this.#runDir, { patch: attempt.patch }, { afterApply: this.#afterActiveApply });
				const applyDurationMs = roundMs(performance.now() - started);
				try {
					writeJson(join(attempt.attemptDir, "apply-check.json"), { ok: true, artifact: attempt.patch.artifact, baseTree: attempt.patch.baseTree, resultTree: attempt.patch.resultTree, applyDurationMs });
					await this.#completeAttempt(attempt, { stage: "apply", code: "applied" }, undefined, transition, disposition);
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
				if (allowReconciliation && error.code === "check-conflict") {
					return {
						reconcile: true,
						attempt,
						evidence: error.evidence,
						acceptedTree,
						ledger: this.#acceptedLedger.map(({ sourceAttemptId, patch }) => ({ sourceAttemptId, patch: structuredClone(patch) })),
					};
				}
				const failedAttempt = {
					...attempt,
					ok: false,
					error: message,
					failureKind: "apply" as const,
					retryable: false,
					terminalFact: { stage: "apply", code: error.code } as const,
					recovery: integrationFailureEvidence(unit.workContract, attempt, error.evidence, this.#acceptedLedger, acceptedTree),
				};
				return await this.#completeTerminalAttempt(failedAttempt);
			}
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
			const repair = await this.#runWorkerAttempt(unit, tierOne(this.#packet), "integration-repair", { recovery: recoveryContext, sourceAttemptId, signal });
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

	async #completeAttempt(
		attempt: WorkerAttempt,
		terminalFact: StageFact,
		recovery?: AttemptRecoveryContext,
		acceptedTransition?: AcceptedStateTransition,
		disposition?: "deterministic-reconciliation",
	): Promise<AttemptOutcome> {
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
			...(attempt.repairSource ? { repairSource: attempt.repairSource } : {}),
			...(disposition ? { disposition } : {}),
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

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`);
	return result;
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
