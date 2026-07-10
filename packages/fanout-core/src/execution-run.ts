import type { TierName } from "./execution-packet.ts";

export const EXECUTION_RUN_SCHEMA = "fanout.execution-run";
export const EXECUTION_RUN_VERSION = 1;

export const EXECUTION_EVENT_NAMES = [
	"execution_start",
	"packet_loaded",
	"preflight_start",
	"preflight_end",
	"confirmation_requested",
	"confirmation_accepted",
	"node_ready",
	"node_started",
	"node_succeeded",
	"node_failed",
	"node_skipped",
	"scheduler_finished",
	"worker_attempt_started",
	"worker_attempt_finished",
	"worker_attempt_failed",
	"worker_clean_rerun_scheduled",
	"worker_retry_scheduled",
	"worker_fallback_started",
	"worker_fallback_finished",
	"worker_fallback_failed",
	"metrics_imported",
	"metrics_missing",
	"patch_capture_started",
	"patch_capture_finished",
	"ownership_check_started",
	"ownership_check_finished",
	"validation_started",
	"validation_finished",
	"patch_apply_check_started",
	"patch_apply_check_finished",
	"patch_apply_conflict",
	"patch_rejected",
	"patch_applied",
	"validation_repair_started",
	"validation_repair_finished",
	"validation_repair_failed",
	"integration_repair_started",
	"integration_repair_finished",
	"integration_repair_failed",
	"final_validation_started",
	"final_validation_finished",
	"execution_finished",
] as const;

export type ExecutionEventName = (typeof EXECUTION_EVENT_NAMES)[number];
export type ExecutionRunStatus = "running" | "succeeded" | "failed" | "aborted";
export type ExecutionNodeStatus = "pending" | "ready" | "running" | "succeeded" | "failed" | "skipped";
export type ValidationStatus = "passed" | "failed";

export interface WorkerMetrics {
	provider: string;
	model: string;
	tier: TierName;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedCostUsd: number;
	pricingSource: string;
	ttftMs: number;
	pollCount: number;
	pollDurationMs: number;
	toolDurationMs: number;
	workerDurationMs: number;
}

export interface PatchStats {
	filesChanged: number;
	insertions: number;
	deletions: number;
	applyDurationMs: number;
	changedFiles?: string[];
}

export interface ValidationStats {
	commandCount: number;
	durationMs: number;
	status: ValidationStatus;
}

export interface ExecutionNodeSnapshot {
	id: string;
	status: ExecutionNodeStatus;
	startedAt?: string;
	finishedAt?: string;
	durationMs?: number;
	worker?: WorkerMetrics;
	patch?: PatchStats;
	validation?: ValidationStats;
	error?: string;
}

export interface ExecutionRunTotals {
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedCostUsd: number;
	workerDurationMs: number;
	validationDurationMs: number;
	toolDurationMs: number;
	pollDurationMs: number;
	patchApplyDurationMs: number;
	filesChanged: number;
	insertions: number;
	deletions: number;
}

export interface ExecutionRunSnapshot {
	schema: typeof EXECUTION_RUN_SCHEMA;
	version: typeof EXECUTION_RUN_VERSION;
	runId: string;
	packetPath: string;
	artifactDir: string;
	startedAt: string;
	finishedAt?: string;
	status: ExecutionRunStatus;
	nodes: ExecutionNodeSnapshot[];
	totals: ExecutionRunTotals;
	eventCounts: Partial<Record<ExecutionEventName, number>>;
	finalValidation?: ValidationStats;
}

export interface ExecutionRunEvent {
	ts: string;
	runId: string;
	event: ExecutionEventName;
	nodeId?: string;
	[key: string]: unknown;
}

export interface WorkerMetricsValidationResult {
	ok: boolean;
	errors: string[];
	metrics?: WorkerMetrics;
}

export function validateWorkerMetrics(value: unknown): WorkerMetricsValidationResult {
	if (!isRecord(value)) return { ok: false, errors: ["worker metrics must be an object"] };

	const errors: string[] = [];
	for (const field of ["provider", "model", "pricingSource"] as const) {
		if (!nonEmptyString(value[field])) errors.push(`${field} must be a non-empty string`);
	}
	if (value.tier !== "tier1" && value.tier !== "tier2") errors.push("tier must be tier1 or tier2");
	for (const field of ["inputTokens", "outputTokens", "totalTokens", "pollCount"] as const) {
		if (!nonNegativeInteger(value[field])) errors.push(`${field} must be a non-negative integer`);
	}
	for (const field of ["estimatedCostUsd", "ttftMs", "pollDurationMs", "toolDurationMs", "workerDurationMs"] as const) {
		if (!nonNegativeNumber(value[field])) errors.push(`${field} must be a finite non-negative number`);
	}
	if (nonNegativeInteger(value.inputTokens) && nonNegativeInteger(value.outputTokens) && nonNegativeInteger(value.totalTokens) && value.totalTokens < value.inputTokens + value.outputTokens) {
		errors.push("totalTokens must be at least inputTokens + outputTokens");
	}

	return errors.length === 0 ? { ok: true, errors, metrics: value as unknown as WorkerMetrics } : { ok: false, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function nonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
