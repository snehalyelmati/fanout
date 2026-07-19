import type { TierName } from "./execution-packet.ts";

export interface WorkerMetrics {
	provider: string; model: string; tier: TierName;
	inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalTokens: number; estimatedCostUsd: number;
	pricingSource: string; ttftMs: number; pollCount: number; pollDurationMs: number; toolDurationMs: number; workerDurationMs: number;
}

export interface WorkerMetricsValidationResult { ok: boolean; errors: string[]; metrics?: WorkerMetrics; }

export function validateWorkerMetrics(value: unknown): WorkerMetricsValidationResult {
	if (!record(value)) return { ok: false, errors: ["worker metrics must be an object"] };
	const errors: string[] = [];
	for (const field of ["provider", "model", "pricingSource"]) if (typeof value[field] !== "string" || !value[field]) errors.push(`${field} must be a non-empty string`);
	if (value.tier !== "tier1" && value.tier !== "tier2") errors.push("tier must be tier1 or tier2");
	for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "pollCount"]) if (!Number.isInteger(value[field]) || Number(value[field]) < 0) errors.push(`${field} must be a non-negative integer`);
	for (const field of ["estimatedCostUsd", "ttftMs", "pollDurationMs", "toolDurationMs", "workerDurationMs"]) if (typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] < 0) errors.push(`${field} must be a finite non-negative number`);
	if (Number(value.totalTokens) < Number(value.inputTokens) + Number(value.outputTokens)) errors.push("totalTokens must include input and output tokens");
	return errors.length ? { ok: false, errors } : { ok: true, errors, metrics: value as unknown as WorkerMetrics };
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
