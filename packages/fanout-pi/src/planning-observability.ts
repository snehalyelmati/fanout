import { performance } from "node:perf_hooks";

export type FanoutPlanPhase = "implementation" | "details";

export interface PlanningMetrics {
	started: number;
	phaseStarted: number;
	turnCount: number;
	toolCallCount: number;
	toolDurationMs: number;
	toolIntervals: Array<readonly [number, number]>;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	estimatedCostUsd: number;
	provider?: string;
	model?: string;
	ttftMs?: number;
	implementationDurationMs?: number;
	detailsDurationMs?: number;
}

export function createPlanningMetrics(): PlanningMetrics {
	const now = performance.now();
	return {
		started: now,
		phaseStarted: now,
		turnCount: 0,
		toolCallCount: 0,
		toolDurationMs: 0,
		toolIntervals: [],
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		estimatedCostUsd: 0,
	};
}

export function startPlanningPhase(metrics: PlanningMetrics): void {
	metrics.phaseStarted = performance.now();
}

export function finishPlanningPhase(metrics: PlanningMetrics, phase: FanoutPlanPhase): void {
	const elapsed = roundedDuration(metrics.phaseStarted);
	if (phase === "implementation") metrics.implementationDurationMs = elapsed;
	else metrics.detailsDurationMs = (metrics.detailsDurationMs ?? 0) + elapsed;
}

export function recordPlanningToolInterval(metrics: PlanningMetrics, started: number, ended: number): void {
	if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return;
	metrics.toolIntervals.push([started, ended]);
	metrics.toolDurationMs = intervalUnionDuration(metrics.toolIntervals);
}

export function recordPlanningAssistant(metrics: PlanningMetrics, message: unknown): Record<string, unknown> | undefined {
	if (!isRecord(message) || message.role !== "assistant") return undefined;
	const usage = isRecord(message.usage) ? message.usage : {};
	const cost = isRecord(usage.cost) ? usage.cost : {};
	const inputTokens = number(usage.input);
	const outputTokens = number(usage.output);
	const cacheReadTokens = number(usage.cacheRead);
	const cacheWriteTokens = number(usage.cacheWrite);
	const totalTokens = number(usage.totalTokens);
	const estimatedCostUsd = number(cost.total);
	metrics.inputTokens += inputTokens;
	metrics.outputTokens += outputTokens;
	metrics.cacheReadTokens += cacheReadTokens;
	metrics.cacheWriteTokens += cacheWriteTokens;
	metrics.totalTokens += totalTokens;
	metrics.estimatedCostUsd += estimatedCostUsd;
	metrics.provider = string(message.provider) ?? metrics.provider;
	metrics.model = string(message.model) ?? metrics.model;
	return {
		provider: string(message.provider),
		model: string(message.model),
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalTokens,
		estimatedCostUsd,
		pricingSource: "pi-json-usage",
	};
}

export function planningMetricsSummary(metrics: PlanningMetrics, thinking: unknown, now = performance.now()): Record<string, unknown> {
	const durationMs = roundedElapsed(metrics.started, now);
	return {
		provider: metrics.provider,
		model: metrics.model,
		thinking: string(thinking),
		pricingSource: "pi-json-usage",
		ttftMs: metrics.ttftMs,
		ttftSource: metrics.ttftMs === undefined ? undefined : "local-first-assistant-update",
		turnCount: metrics.turnCount,
		toolCallCount: metrics.toolCallCount,
		inputTokens: metrics.inputTokens,
		outputTokens: metrics.outputTokens,
		cacheReadTokens: metrics.cacheReadTokens,
		cacheWriteTokens: metrics.cacheWriteTokens,
		totalTokens: metrics.totalTokens,
		estimatedCostUsd: metrics.estimatedCostUsd,
		durationMs,
		toolDurationMs: metrics.toolDurationMs,
		nonToolDurationMs: Math.max(0, Math.round((durationMs - metrics.toolDurationMs) * 1000) / 1000),
		implementationDurationMs: metrics.implementationDurationMs,
		detailsDurationMs: metrics.detailsDurationMs,
	};
}

export function roundedDuration(start: number): number {
	return roundedElapsed(start, performance.now());
}

function intervalUnionDuration(intervals: Array<readonly [number, number]>): number {
	const sorted = [...intervals].sort((left, right) => left[0] - right[0]);
	let total = 0;
	let start: number | undefined;
	let end: number | undefined;
	for (const interval of sorted) {
		if (start === undefined || end === undefined) {
			[start, end] = interval;
		} else if (interval[0] <= end) {
			end = Math.max(end, interval[1]);
		} else {
			total += end - start;
			[start, end] = interval;
		}
	}
	if (start !== undefined && end !== undefined) total += end - start;
	return Math.round(total * 1000) / 1000;
}

function roundedElapsed(start: number, end: number): number {
	return Math.round((end - start) * 1000) / 1000;
}

function number(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function string(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
