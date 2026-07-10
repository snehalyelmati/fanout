import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { unsafeCommand, type FanoutExecutionPacket, type FanoutWorkUnit, type TierName } from "../../fanout-core/src/execution-packet.ts";
import type { DagNodeResult } from "../../fanout-core/src/dag-scheduler.ts";
import type { ExecutionEventName, PatchStats, ValidationStats, WorkerMetrics } from "../../fanout-core/src/execution-run.ts";
import type { ExecutionRecorder } from "./execution-recorder.ts";
import {
	artifactSegment,
	captureFileOverlays,
	capturePatch,
	checkAndApplyPatch,
	checkOwnership,
	createAttemptWorktree,
	normalizeRepoPath,
	reverseApplyPatch,
	runProcess,
	runValidationCommands,
	worktreePatchMatches,
	writeApplyResult,
	writeJson,
	writeValidationResult,
	type CapturedPatch,
	type FileOverlay,
	type IntegratedChange,
	type ValidationResult,
} from "./fanout-git.ts";
import { buildWorkerPrompt, importWorkerMetrics, type WorkerRecoveryContext } from "./fanout-worker-contract.ts";

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
	baseRef?: string;
	tier: WorkerTier;
	kind: AttemptKind;
	metrics?: WorkerMetrics;
	patch?: CapturedPatch;
	error?: string;
	failureKind?: FailureKind;
	retryable?: boolean;
}

interface GatedAttempt extends WorkerAttempt {
	ok: true;
	worktreePath: string;
	baseRef: string;
	metrics: WorkerMetrics;
	patch: CapturedPatch;
	validation: ValidationResult;
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
	readonly #maxValidationRepairAttempts: number;
	readonly #maxIntegrationRepairAttempts: number;
	#attemptCounts = new Map<string, number>();
	#integratedChanges: IntegratedChange[] = [];
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
		this.#maxValidationRepairAttempts = nonNegativeInteger(options.maxValidationRepairAttempts, 2, "maxValidationRepairAttempts");
		this.#maxIntegrationRepairAttempts = nonNegativeInteger(options.maxIntegrationRepairAttempts, 2, "maxIntegrationRepairAttempts");
	}

	async runNode(unit: FanoutWorkUnit): Promise<DagNodeResult> {
		const original = await this.#runOriginalWithRetry(unit);
		if (!original.ok) return failed(original);

		let gated = await this.#gateOwnershipAndValidation(unit, original);
		if (!gated.ok && gated.failureKind === "validation") gated = await this.#repairValidation(unit, gated);
		if (!gated.ok) return failed(gated);

		const applied = await this.#apply(unit, gated);
		if (applied.ok) return { ok: true };
		if (applied.failureKind !== "apply") return failed(applied);

		const repaired = await this.#repairIntegration(unit, gated, applied.error ?? "git apply --check failed");
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
			outcome = await this.#runWorkerAttempt(unit, assigned, attempt === 1 ? "original" : "retry");
			if (outcome.ok || !outcome.retryable) return outcome;
		}

		if (assigned.tier !== "tier2" || !outcome?.retryable || unit.tier.fallback !== "tier1") return outcome ?? hardFailure(unit, assigned, "worker attempts did not run", "process");
		const fallback = tierOne(this.#packet);
		await this.#event("worker_fallback_started", { nodeId: unit.id, fromTier: "tier2", tier: "tier1" });
		const result = await this.#runWorkerAttempt(unit, fallback, "fallback");
		await this.#event(result.ok ? "worker_fallback_finished" : "worker_fallback_failed", { nodeId: unit.id, attemptId: result.attemptId, error: result.error });
		return result;
	}

	async #runWorkerAttempt(
		unit: FanoutWorkUnit,
		tier: WorkerTier,
		kind: AttemptKind,
		recovery?: WorkerRecoveryContext,
		seedPatch?: string,
		baselineOverlays?: FileOverlay[],
	): Promise<WorkerAttempt> {
		const count = (this.#attemptCounts.get(unit.id) ?? 0) + 1;
		this.#attemptCounts.set(unit.id, count);
		const attemptId = `${String(count).padStart(3, "0")}-${kind}`;
		const attemptDir = join(this.#runDir, "workers", artifactSegment(unit.id), "attempts", attemptId);
		const worktreePath = join(attemptDir, "worktree");
		const base: WorkerAttempt = { ok: false, attemptId, attemptDir, tier, kind };
		mkdirSync(attemptDir, { recursive: true });
		await this.#event("worker_attempt_started", { nodeId: unit.id, attemptId, kind, tier: tier.tier, provider: tier.provider, model: tier.model });

		let baseRef: string;
		try {
			const integrated = await this.#withApplyLock(() => [
				...this.#integratedChanges,
				...(baselineOverlays?.length ? [{ type: "overlay" as const, files: baselineOverlays }] : []),
			]);
			baseRef = createAttemptWorktree(this.#repoRoot, worktreePath, integrated, seedPatch).baseRef;
		} catch (error) {
			const failedAttempt = { ...base, worktreePath, error: errorMessage(error), failureKind: "process" as const, retryable: true };
			writeJson(join(attemptDir, "result.json"), { nodeId: unit.id, attemptId, kind, tier, error: failedAttempt.error, failureKind: failedAttempt.failureKind });
			return await this.#finishFailedAttempt(unit, failedAttempt);
		}

		const promptPath = join(attemptDir, "prompt.md");
		const stdoutPath = join(attemptDir, "stdout.log");
		const stderrPath = join(attemptDir, "stderr.log");
		const observabilityPath = join(attemptDir, "observability.jsonl");
		const sessionDir = join(attemptDir, "session");
		writeFileSync(promptPath, buildWorkerPrompt(this.#packet, unit, recovery, collectRepositoryInstructions(worktreePath, unit)), "utf8");
		writeFileSync(observabilityPath, "", { encoding: "utf8", flag: "wx" });
		mkdirSync(sessionDir);

		const extensionEntry = worktreeExtensionPath(this.#repoRoot, worktreePath, this.#extensionEntry);
		const args = [
			"--no-context-files",
			"--approve",
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
				DOUBLEWORD_OBSERVABILITY_FILE: observabilityPath,
				DOUBLEWORD_RUN_ID: `${this.#runId}-${artifactSegment(unit.id)}-${attemptId}`,
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
		if (imported.ok && imported.metrics) {
			this.#recorder.recordAttemptMetrics(unit.id, attemptId, imported.metrics);
			await this.#event("metrics_imported", { nodeId: unit.id, attemptId, metrics: imported.metrics });
		} else {
			this.#recorder.recordAttemptMetrics(unit.id, attemptId, imported.partialMetrics);
			await this.#event("metrics_missing", { nodeId: unit.id, attemptId, errors: imported.errors, partialMetrics: imported.partialMetrics });
		}

		let patch: CapturedPatch | undefined;
		let patchError: string | undefined;
		await this.#event("patch_capture_started", { nodeId: unit.id, attemptId });
		try {
			patch = capturePatch(worktreePath, baseRef, attemptDir);
			await this.#event("patch_capture_finished", { nodeId: unit.id, attemptId, changedFiles: patch.changedFiles, stats: patch.stats });
		} catch (error) {
			patchError = errorMessage(error);
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId, reason: "patch_capture_failed", error: patchError });
		}

		const processOk = processResult.exitCode === 0 && !processResult.timedOut && !processResult.spawnError;
		const hasUsablePatch = Boolean(patch && (patch.patch.length > 0 || unit.ownedFiles.length === 0));
		const resultData = {
			nodeId: unit.id,
			attemptId,
			kind,
			tier,
			process: { ...processResult, stdout: undefined, stderr: undefined },
			metrics: imported.metrics,
			metricErrors: imported.errors,
			patch: patch ? { changedFiles: patch.changedFiles, stats: patch.stats, workerCommitted: patch.workerCommitted } : undefined,
			patchError,
		};
		writeJson(join(attemptDir, "result.json"), resultData);
		const unsafeTool = unsafeWorkerTool(processResult.stdout);
		if (unsafeTool) {
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId, reason: "unsafe_tool", error: unsafeTool });
			return await this.#finishFailedAttempt(unit, { ...base, worktreePath, baseRef, metrics: imported.metrics, patch, error: unsafeTool, failureKind: "unsafe", retryable: false });
		}

		if (!processOk) {
			const details = [processResult.timedOut ? "worker timed out" : undefined, processResult.spawnError, processResult.exitCode !== 0 ? `worker exited ${processResult.exitCode}` : undefined, processResult.stderr.trim()].filter(Boolean).join(": ");
			const failureText = [processResult.stdout, processResult.stderr, readFileSync(observabilityPath, "utf8")].join("\n");
			return await this.#finishFailedAttempt(unit, {
				...base,
				worktreePath,
				baseRef,
				metrics: imported.metrics,
				patch,
				error: details || "worker subprocess failed",
				failureKind: "process",
				retryable: (!hasUsablePatch || !imported.metrics) && retryableProcessFailure(processResult, failureText),
			});
		}
		if (!imported.ok || !imported.metrics) return await this.#finishFailedAttempt(unit, { ...base, worktreePath, baseRef, patch, error: imported.errors.join("; "), failureKind: "metrics", retryable: false });
		if (!patch) return await this.#finishFailedAttempt(unit, { ...base, worktreePath, baseRef, metrics: imported.metrics, error: patchError ?? "patch could not be captured", failureKind: "patch", retryable: false });
		if (patch.workerCommitted) return await this.#finishFailedAttempt(unit, { ...base, worktreePath, baseRef, metrics: imported.metrics, patch, error: "worker created a commit", failureKind: "unsafe", retryable: false });
		if (!patch.patch.length && unit.ownedFiles.length > 0) return await this.#finishFailedAttempt(unit, { ...base, worktreePath, baseRef, metrics: imported.metrics, patch, error: "worker produced no patch for a mutating work unit", failureKind: "patch", retryable: false });

		await this.#event("worker_attempt_finished", { nodeId: unit.id, attemptId, kind, tier: tier.tier });
		return { ...base, ok: true, worktreePath, baseRef, metrics: imported.metrics, patch };
	}

	async #gateOwnershipAndValidation(unit: FanoutWorkUnit, attempt: WorkerAttempt): Promise<GatedAttempt | WorkerAttempt> {
		if (!attempt.ok || !attempt.worktreePath || !attempt.baseRef || !attempt.metrics || !attempt.patch) return attempt;
		await this.#event("ownership_check_started", { nodeId: unit.id, attemptId: attempt.attemptId });
		let ownership;
		try {
			ownership = checkOwnership(unit, attempt.patch, attempt.worktreePath, attempt.baseRef, attempt.attemptDir);
		} catch (error) {
			ownership = { ok: false, violations: [{ file: "packet", reason: errorMessage(error) }] };
		}
		await this.#event("ownership_check_finished", { nodeId: unit.id, attemptId: attempt.attemptId, ...ownership });
		if (!ownership.ok) {
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: "ownership", violations: ownership.violations });
			return { ...attempt, ok: false, error: ownership.violations.map((value) => `${value.file}: ${value.reason}`).join("; "), failureKind: "ownership", retryable: false };
		}

		await this.#event("validation_started", { nodeId: unit.id, attemptId: attempt.attemptId, commands: unit.validationCommands });
		const validation = await runValidationCommands(unit.validationCommands, attempt.worktreePath, this.#validationTimeoutMs);
		writeValidationResult(attempt.attemptDir, validation);
		this.#recorder.setValidationStats(unit.id, validationStats(validation));
		let patchUnchanged = false;
		let patchCheckError: string | undefined;
		try {
			patchUnchanged = worktreePatchMatches(attempt.worktreePath, attempt.baseRef, attempt.patch.patch);
		} catch (error) {
			patchCheckError = errorMessage(error);
		}
		await this.#event("validation_finished", { nodeId: unit.id, attemptId: attempt.attemptId, ...validation, patchUnchanged, patchCheckError });
		if (!patchUnchanged) {
			const error = patchCheckError ? `cannot verify the patch after validation: ${patchCheckError}` : "validation commands modified the captured patch";
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: "validation_modified_patch", error });
			return { ...attempt, ok: false, error, failureKind: "patch", retryable: false };
		}
		if (validation.status === "failed") {
			await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: "validation" });
			return { ...attempt, ok: false, error: validationError(validation), failureKind: "validation", retryable: false, validation } as WorkerAttempt;
		}
		return { ...attempt, ok: true, validation } as GatedAttempt;
	}

	async #repairValidation(unit: FanoutWorkUnit, failedAttempt: WorkerAttempt, baselineOverlays?: FileOverlay[]): Promise<GatedAttempt | WorkerAttempt> {
		let current = failedAttempt;
		for (let attempt = 1; attempt <= this.#maxValidationRepairAttempts; attempt++) {
			if (!current.patch) break;
			await this.#event("validation_repair_started", { nodeId: unit.id, repairAttempt: attempt, sourceAttemptId: current.attemptId, tier: "tier1" });
			const recovery: WorkerRecoveryContext = {
				kind: "validation",
				instructions: ["Repair only the recorded validation failure.", "Keep all writes within the original owned files."],
				validationFailures: current.error,
			};
			const repair = await this.#runWorkerAttempt(unit, tierOne(this.#packet), "validation-repair", recovery, current.patch.patchPath, baselineOverlays);
			if (!repair.ok) {
				await this.#event("validation_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: repair.attemptId, error: repair.error });
				if (!repair.retryable) return repair;
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
		}
		return { ...current, ok: false, error: current.error ?? "validation repair attempts exhausted", failureKind: "validation", retryable: false };
	}

	async #apply(unit: FanoutWorkUnit, attempt: GatedAttempt, overlayBaseline = false): Promise<WorkerAttempt> {
		if (!attempt.patch.patch.length && unit.ownedFiles.length === 0) {
			try {
				this.#acceptAttempt(unit, attempt, 0);
				await this.#event("patch_applied", { nodeId: unit.id, attemptId: attempt.attemptId, noOp: true });
				return attempt;
			} catch (error) {
				try {
					this.#recorder.rollbackAppliedAttempt(unit.id);
				} catch {
					// The scheduler will still fail the node and preserve the original error.
				}
				return { ...attempt, ok: false, error: `no-op bookkeeping failed: ${errorMessage(error)}`, failureKind: "bookkeeping", retryable: false };
			}
		}

		await this.#event("patch_apply_check_started", { nodeId: unit.id, attemptId: attempt.attemptId });
		return await this.#withApplyLock(async () => {
			const result = checkAndApplyPatch(this.#repoRoot, attempt.patch.patchPath);
			if (!result.ok) {
				writeApplyResult(attempt.attemptDir, result);
				await this.#event("patch_apply_check_finished", { nodeId: unit.id, attemptId: attempt.attemptId, ...result });
				await this.#event("patch_apply_conflict", { nodeId: unit.id, attemptId: attempt.attemptId, error: result.apply?.stderr || result.check.stderr });
				await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: "apply_conflict" });
				return { ...attempt, ok: false, error: result.apply?.stderr || result.check.stderr || "git apply failed", failureKind: "apply", retryable: false };
			}

			let ledgerAdded = false;
			try {
				writeApplyResult(attempt.attemptDir, result);
				await this.#event("patch_apply_check_finished", { nodeId: unit.id, attemptId: attempt.attemptId, ...result });
				this.#integratedChanges.push(overlayBaseline
					? { type: "overlay", files: captureFileOverlays(this.#repoRoot, attempt.patch.changedFiles) }
					: { type: "patch", patchPath: attempt.patch.patchPath });
				ledgerAdded = true;
				this.#acceptAttempt(unit, attempt, result.apply?.durationMs ?? 0);
				await this.#event("patch_applied", { nodeId: unit.id, attemptId: attempt.attemptId, stats: attempt.patch.stats, applyDurationMs: result.apply?.durationMs ?? 0 });
				return attempt;
			} catch (error) {
				if (ledgerAdded) this.#integratedChanges.pop();
				const rollback = reverseApplyPatch(this.#repoRoot, attempt.patch.patchPath);
				let recorderRollbackError: string | undefined;
				try {
					this.#recorder.rollbackAppliedAttempt(unit.id);
				} catch (recorderError) {
					recorderRollbackError = errorMessage(recorderError);
				}
				const bookkeepingError = errorMessage(error);
				try {
					writeApplyResult(attempt.attemptDir, { ...result, rolledBack: rollback.ok, bookkeepingError } as typeof result);
				} catch {
					// Preserve the original bookkeeping failure below.
				}
				if (!rollback.ok) throw new Error(`post-apply bookkeeping failed (${bookkeepingError}) and patch rollback failed: ${rollback.error}`);
				try {
					await this.#event("patch_rejected", { nodeId: unit.id, attemptId: attempt.attemptId, reason: "post_apply_bookkeeping", error: bookkeepingError });
				} catch {
					// The active worktree is already restored; the caller will record node failure if possible.
				}
				return { ...attempt, ok: false, error: `post-apply bookkeeping failed and patch was rolled back: ${bookkeepingError}${recorderRollbackError ? `; recorder rollback: ${recorderRollbackError}` : ""}`, failureKind: "bookkeeping", retryable: false };
			}
		});
	}

	async #repairIntegration(unit: FanoutWorkUnit, rejected: GatedAttempt, applyError: string): Promise<WorkerAttempt> {
		let currentPatch = rejected.patch;
		let currentError = applyError;
		for (let attempt = 1; attempt <= this.#maxIntegrationRepairAttempts; attempt++) {
			await this.#event("integration_repair_started", { nodeId: unit.id, repairAttempt: attempt, sourceAttemptId: rejected.attemptId, tier: "tier1" });
			const recovery: WorkerRecoveryContext = {
				kind: "integration",
				instructions: ["Re-implement the rejected patch intent against the current integrated files.", "Do not expand the original ownership boundary."],
				rejectedPatch: currentPatch.patch,
				applyError: currentError,
				currentOwnedFiles: currentOwnedFileContents(this.#repoRoot, [...unit.ownedFiles, ...currentPatch.changedFiles]),
			};
			const repair = await this.#runWorkerAttempt(unit, tierOne(this.#packet), "integration-repair", recovery, undefined, captureFileOverlays(this.#repoRoot, currentPatch.changedFiles));
			if (!repair.ok) {
				await this.#event("integration_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: repair.attemptId, error: repair.error });
				if (!repair.retryable) return repair;
				continue;
			}
			let gated = await this.#gateOwnershipAndValidation(unit, repair);
			if (!gated.ok && gated.failureKind === "validation" && gated.patch) {
				gated = await this.#repairValidation(unit, gated, captureFileOverlays(this.#repoRoot, gated.patch.changedFiles));
			}
			if (!gated.ok) {
				await this.#event("integration_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: gated.attemptId, error: gated.error });
				return gated;
			}
			const applied = await this.#apply(unit, gated as GatedAttempt, true);
			if (applied.ok) {
				await this.#event("integration_repair_finished", { nodeId: unit.id, repairAttempt: attempt, attemptId: applied.attemptId });
				return applied;
			}
			if (applied.failureKind !== "apply") return applied;
			currentPatch = (gated as GatedAttempt).patch;
			currentError = applied.error ?? currentError;
			await this.#event("integration_repair_failed", { nodeId: unit.id, repairAttempt: attempt, attemptId: applied.attemptId, error: applied.error });
		}
		return { ...rejected, ok: false, error: currentError || "integration repair attempts exhausted", failureKind: "apply", retryable: false };
	}

	#acceptAttempt(unit: FanoutWorkUnit, attempt: GatedAttempt, applyDurationMs: number): void {
		this.#recorder.recordAttemptMetrics(unit.id, attempt.attemptId, attempt.metrics, { accepted: true });
		const stats: PatchStats = { ...attempt.patch.stats, applyDurationMs, changedFiles: attempt.patch.changedFiles };
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
		return attempt;
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

function hardFailure(unit: FanoutWorkUnit, tier: WorkerTier, error: string, failureKind: FailureKind): WorkerAttempt {
	return { ok: false, attemptId: "none", attemptDir: "", tier, kind: "original", error: `${unit.id}: ${error}`, failureKind, retryable: false };
}

function failed(attempt: WorkerAttempt): DagNodeResult {
	return { ok: false, error: attempt.error ?? `${attempt.kind} attempt ${attempt.attemptId} failed` };
}

function validationStats(result: ValidationResult): ValidationStats {
	return { commandCount: result.commandCount, durationMs: result.durationMs, status: result.status };
}

function validationError(result: ValidationResult): string {
	const failedCommand = result.commands.find((command) => command.exitCode !== 0 || command.timedOut);
	return failedCommand ? `${failedCommand.command}: ${failedCommand.stderr.trim() || failedCommand.stdout.trim() || `exit ${failedCommand.exitCode}`}` : "validation failed";
}

function worktreeExtensionPath(repoRoot: string, worktreePath: string, extensionEntry: string): string {
	const path = relative(repoRoot, extensionEntry);
	return path && path !== ".." && !path.startsWith("../") ? resolve(worktreePath, path) : extensionEntry;
}

function currentOwnedFileContents(repoRoot: string, files: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const value of new Set(files)) {
		const file = normalizeRepoPath(value);
		const path = resolve(repoRoot, file);
		if (!existsSync(path)) {
			result[file] = "<missing>";
			continue;
		}
		if (!lstatSync(path).isFile()) {
			result[file] = "<not a regular file>";
			continue;
		}
		const content = readFileSync(path);
		result[file] = content.includes(0) ? `<binary ${content.length} bytes>` : content.toString("utf8");
	}
	return result;
}

function collectRepositoryInstructions(worktreePath: string, unit: FanoutWorkUnit): string {
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

	const sections: string[] = [];
	const orderedDirectories = Array.from(directories).sort((left, right) => left.split("/").filter(Boolean).length - right.split("/").filter(Boolean).length || (left < right ? -1 : left > right ? 1 : 0));
	for (const directory of orderedDirectories) {
		for (const name of ["AGENTS.md", "CLAUDE.md"]) {
			const relativePath = directory ? `${directory}/${name}` : name;
			const instructionPath = resolve(worktreePath, relativePath);
			try {
				if (!lstatSync(instructionPath).isFile()) continue;
				const content = readFileSync(instructionPath, "utf8").trim();
				if (content) sections.push(`### ${relativePath}\n\n${content}`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
	return sections.join("\n\n");
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

function unsafeWorkerTool(stdout: string): string | undefined {
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line);
			const content = event?.message?.role === "assistant" && Array.isArray(event.message.content) ? event.message.content : [];
			for (const block of content) {
				if (block?.type !== "toolCall" || !["bash", "shell", "terminal"].includes(String(block.name).toLowerCase())) continue;
				const command = typeof block.arguments?.command === "string" ? block.arguments.command : typeof block.arguments?.cmd === "string" ? block.arguments.cmd : undefined;
				if (!command) continue;
				if (/\bgit\s+commit\b/.test(command)) return "worker commits are forbidden";
				const violation = unsafeCommand(command);
				if (violation) return `worker used unsafe command pattern ${violation}`;
			}
		} catch {
			// Non-JSON stdout is handled by the mandatory metrics parser.
		}
	}
	return undefined;
}

function retryableProcessFailure(result: { timedOut: boolean; spawnError?: string; signal: NodeJS.Signals | null }, output: string): boolean {
	if (result.timedOut || result.spawnError || result.signal) return true;
	if (/\b429\b/.test(output)) return true;
	if (/\b(?:401|403)\b|unauthori[sz]ed|authentication|api[ _-]?key|unknown provider|invalid model|model[^\n]*not found|permission denied|quota|billing/i.test(output)) return false;
	if (!output.trim()) return true;
	return /\b5\d\d\b|network|ECONN|ENOTFOUND|ETIMEDOUT|socket|fetch failed|async_poll_retry|transient|timed?\s*out|child process|subprocess|crash|SIG[A-Z]+/i.test(output);
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`);
	return result;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isInteger(result) || result < 0) throw new Error(`${name} must be a non-negative integer`);
	return result;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const CLI_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
