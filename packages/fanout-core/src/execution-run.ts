/**
 * @deprecated Import the event/projection modules directly. This subpath is a
 * fail-closed source-compatibility shim and exposes only the hardened v1/v2
 * generation; it does not parse or recreate execution-run v1.
 */
export { EXECUTION_EVENT_NAMES } from "./execution-event.ts";
export { EXECUTION_PROJECTION_SCHEMA as EXECUTION_RUN_SCHEMA, EXECUTION_PROJECTION_VERSION as EXECUTION_RUN_VERSION } from "./execution-projection.ts";
export { validateWorkerMetrics } from "./worker-metrics.ts";
import type { RunOutcome } from "./execution-event.ts";
export type { ExecutionEvent as ExecutionRunEvent, ExecutionEventName } from "./execution-event.ts";
export type {
	ExecutionRunProjection as ExecutionRunSnapshot,
	ExecutionTotals as ExecutionRunTotals,
	NodeProjection as ExecutionNodeSnapshot,
} from "./execution-projection.ts";
export type { WorkerMetrics, WorkerMetricsValidationResult } from "./worker-metrics.ts";

export type ExecutionRunStatus = "running" | RunOutcome;
export type ExecutionNodeStatus = "pending" | "ready" | "running" | "succeeded" | "failed" | "skipped";
export type ValidationStatus = "passed" | "failed";
export interface PatchStats { filesChanged: number; insertions: number; deletions: number; applyDurationMs: number; changedFiles?: string[]; }
export interface ValidationStats { commandCount: number; durationMs: number; status: ValidationStatus; }
