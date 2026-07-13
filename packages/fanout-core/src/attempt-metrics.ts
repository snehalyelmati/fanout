import { deepFreeze } from "./contract-value.ts";

export type MetricCompatibility = "generic" | "instrumented";

export interface TurnMetricEvidence {
	attemptId: string;
	turnId: string;
	terminal: "completed";
	provider: string;
	model: string;
	tier: "tier1" | "tier2";
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
	pricingSource: string;
	responseIds: string[];
	toolCallIds: string[];
}

export interface ResponseMetricEvidence {
	attemptId: string;
	turnId: string;
	responseId: string;
	provider: string;
	model: string;
	terminal: "completed";
	ttftMs: number;
	pollIds: string[];
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
	pricingSource: string;
}

export interface PollMetricEvidence {
	attemptId: string;
	turnId: string;
	responseId: string;
	pollId: string;
	status: "queued" | "in-progress" | "completed";
	durationMs: number;
}

export interface ToolMetricEvidence {
	attemptId: string;
	turnId: string;
	toolCallId: string;
	terminal: "completed";
	durationMs: number;
}

export interface AttemptMetricEvidence {
	attemptId: string;
	compatibility: MetricCompatibility;
	turns: TurnMetricEvidence[];
	responses: ResponseMetricEvidence[];
	polls: PollMetricEvidence[];
	tools: ToolMetricEvidence[];
	workerFirstOutputMs?: number;
	workerDurationMs?: number;
}

export interface AttemptMetricTotals {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
	pollCount: number;
	pollDurationMs: number;
	toolDurationMs: number;
}

export interface CorrelatedAttemptMetrics extends AttemptMetricEvidence {
	complete: boolean;
}

export interface MetricIssue {
	code:
		| "malformed-input"
		| "missing-identity"
		| "correlation-mismatch"
		| "duplicate-identity"
		| "usage-mismatch"
		| "pricing-mismatch"
		| "missing-timing"
		| "missing-poll"
		| "missing-tool"
		| "invalid-number"
		| "provider-evidence-mismatch";
	path: string;
	message: string;
}

export interface CorrelateAttemptMetricsResult {
	ok: boolean;
	errors: MetricIssue[];
	metrics?: CorrelatedAttemptMetrics;
	partialMetrics: CorrelatedAttemptMetrics;
}

const EVIDENCE_FIELDS = new Set(["attemptId", "compatibility", "turns", "responses", "polls", "tools", "workerFirstOutputMs", "workerDurationMs"]);
const TURN_FIELDS = new Set(["attemptId", "turnId", "terminal", "provider", "model", "tier", "inputTokens", "outputTokens", "totalTokens", "costUsd", "pricingSource", "responseIds", "toolCallIds"]);
const RESPONSE_FIELDS = new Set(["attemptId", "turnId", "responseId", "provider", "model", "terminal", "ttftMs", "pollIds", "inputTokens", "outputTokens", "totalTokens", "costUsd", "pricingSource"]);
const POLL_FIELDS = new Set(["attemptId", "turnId", "responseId", "pollId", "status", "durationMs"]);
const TOOL_FIELDS = new Set(["attemptId", "turnId", "toolCallId", "terminal", "durationMs"]);
const correlatedMetrics = new WeakSet<object>();

export function correlateAttemptMetrics(value: unknown): CorrelateAttemptMetricsResult {
	const errors: MetricIssue[] = [];
	const record = parseRecord(value, "metrics", EVIDENCE_FIELDS, errors);
	const attemptId = identity(record?.attemptId, "metrics.attemptId", errors);
	const compatibility = record?.compatibility === "generic" || record?.compatibility === "instrumented"
		? record.compatibility
		: (add(errors, "malformed-input", "metrics.compatibility", "compatibility must be generic or instrumented"), "generic");
	const parsedTurns = parseArray(record?.turns, "metrics.turns", errors).flatMap((item, index) => parseTurn(item, index, errors));
	const parsedResponses = parseArray(record?.responses, "metrics.responses", errors).flatMap((item, index) => parseResponse(item, index, errors));
	const parsedPolls = parseArray(record?.polls, "metrics.polls", errors).flatMap((item, index) => parsePoll(item, index, errors));
	const parsedTools = parseArray(record?.tools, "metrics.tools", errors).flatMap((item, index) => parseTool(item, index, errors));
	const workerFirstOutputMs = optionalNumber(record?.workerFirstOutputMs, "metrics.workerFirstOutputMs", errors);
	const workerDurationMs = optionalNumber(record?.workerDurationMs, "metrics.workerDurationMs", errors);
	for (const [index, turn] of parsedTurns.entries()) checkAttempt(turn.attemptId, attemptId, `metrics.turns[${index}].attemptId`, errors);
	for (const [index, response] of parsedResponses.entries()) checkAttempt(response.attemptId, attemptId, `metrics.responses[${index}].attemptId`, errors);
	for (const [index, poll] of parsedPolls.entries()) checkAttempt(poll.attemptId, attemptId, `metrics.polls[${index}].attemptId`, errors);
	for (const [index, tool] of parsedTools.entries()) checkAttempt(tool.attemptId, attemptId, `metrics.tools[${index}].attemptId`, errors);
	const turns = parsedTurns.filter((turn) => turn.attemptId === attemptId);
	const responses = parsedResponses.filter((response) => response.attemptId === attemptId);
	const polls = parsedPolls.filter((poll) => poll.attemptId === attemptId);
	const tools = parsedTools.filter((tool) => tool.attemptId === attemptId);

	const turnIds = uniqueIdentities(turns, (turn) => turn.turnId, "metrics.turns", errors);
	const responseIds = uniqueIdentities(responses, (response) => scoped(response.turnId, response.responseId), "metrics.responses", errors);
	const pollIds = uniqueIdentities(polls, (poll) => scoped(responseScope(poll.turnId, poll.responseId), poll.pollId), "metrics.polls", errors);
	const toolIds = uniqueIdentities(tools, (tool) => scoped(tool.turnId, tool.toolCallId), "metrics.tools", errors);
	if (!turns.length) add(errors, "missing-identity", "metrics.turns", "attempt metrics require at least one terminal turn");
	for (const [index, turn] of turns.entries()) {
		uniqueClaims(turn.responseIds, `metrics.turns[${index}].responseIds`, errors);
		uniqueClaims(turn.toolCallIds, `metrics.turns[${index}].toolCallIds`, errors);
		if (compatibility === "generic" && turn.responseIds.length) add(errors, "provider-evidence-mismatch", `metrics.turns[${index}].responseIds`, "generic turns cannot claim provider responses");
		if (compatibility === "instrumented" && !turn.responseIds.length) add(errors, "missing-identity", `metrics.turns[${index}].responseIds`, "instrumented turns require provider response identities");
	}
	for (const [index, response] of responses.entries()) {
		uniqueClaims(response.pollIds, `metrics.responses[${index}].pollIds`, errors);
		const turn = turns.find((candidate) => candidate.turnId === response.turnId);
		if (!turn || !turn.responseIds.includes(response.responseId)) add(errors, "correlation-mismatch", `metrics.responses[${index}]`, "response is not claimed by its parent turn");
		for (const pollId of response.pollIds) if (!pollIds.has(scoped(responseScope(response.turnId, response.responseId), pollId))) add(errors, "missing-poll", `metrics.responses[${index}].pollIds`, `missing poll ${pollId}`);
	}
	for (const [index, poll] of polls.entries()) {
		const response = responses.find((candidate) => candidate.turnId === poll.turnId && candidate.responseId === poll.responseId);
		if (!response || !response.pollIds.includes(poll.pollId)) add(errors, "correlation-mismatch", `metrics.polls[${index}]`, "poll is not claimed by its parent response");
	}
	for (const [index, tool] of tools.entries()) {
		const turn = turns.find((candidate) => candidate.turnId === tool.turnId);
		if (!turn || !turn.toolCallIds.includes(tool.toolCallId)) add(errors, "correlation-mismatch", `metrics.tools[${index}]`, "tool result is not claimed by its parent turn");
	}
	for (const [index, turn] of turns.entries()) {
		for (const responseId of turn.responseIds) if (!responseIds.has(scoped(turn.turnId, responseId))) add(errors, "missing-identity", `metrics.turns[${index}].responseIds`, `missing response ${responseId}`);
		for (const toolCallId of turn.toolCallIds) if (!toolIds.has(scoped(turn.turnId, toolCallId))) add(errors, "missing-tool", `metrics.turns[${index}].toolCallIds`, `missing tool result ${toolCallId}`);
		if (compatibility === "instrumented") compareInstrumentedTurn(turn, responses.filter((response) => response.turnId === turn.turnId), index, errors);
	}
	if (compatibility === "generic" && (responses.length || polls.length)) add(errors, "provider-evidence-mismatch", "metrics.responses", "generic metrics cannot include instrumented provider responses or polls");
	if (workerFirstOutputMs === undefined) add(errors, "missing-timing", "metrics.workerFirstOutputMs", "worker first-output timing is required");
	if (workerDurationMs === undefined) add(errors, "missing-timing", "metrics.workerDurationMs", "worker duration is required");

	const partialTurns = firstBy(turns, (turn) => turn.turnId);
	const partialResponses = firstBy(responses, (response) => scoped(response.turnId, response.responseId))
		.filter((response) => partialTurns.some((turn) => turn.turnId === response.turnId && turn.responseIds.includes(response.responseId)));
	const partialPolls = firstBy(polls, (poll) => scoped(responseScope(poll.turnId, poll.responseId), poll.pollId))
		.filter((poll) => partialResponses.some((response) => response.turnId === poll.turnId && response.responseId === poll.responseId && response.pollIds.includes(poll.pollId)));
	const partialTools = firstBy(tools, (tool) => scoped(tool.turnId, tool.toolCallId))
		.filter((tool) => partialTurns.some((turn) => turn.turnId === tool.turnId && turn.toolCallIds.includes(tool.toolCallId)));
	const partialMetrics: CorrelatedAttemptMetrics = {
		attemptId,
		compatibility,
		turns: partialTurns,
		responses: partialResponses,
		polls: partialPolls,
		tools: partialTools,
		...(workerFirstOutputMs === undefined ? {} : { workerFirstOutputMs }),
		...(workerDurationMs === undefined ? {} : { workerDurationMs }),
		complete: errors.length === 0,
	};
	deepFreeze(partialMetrics);
	correlatedMetrics.add(partialMetrics);
	return errors.length ? { ok: false, errors, partialMetrics } : { ok: true, errors, metrics: partialMetrics, partialMetrics };
}

export function isCorrelatedAttemptMetrics(value: CorrelatedAttemptMetrics): boolean {
	return correlatedMetrics.has(value);
}

export function deriveAttemptMetricTotals(metrics: CorrelatedAttemptMetrics): AttemptMetricTotals {
	return totals(metrics.turns, metrics.polls, metrics.tools);
}

export function deriveSummedResponseTtftMs(metrics: CorrelatedAttemptMetrics): number {
	return sum(metrics.responses, "ttftMs");
}

function parseTurn(value: unknown, index: number, errors: MetricIssue[]): TurnMetricEvidence[] {
	const path = `metrics.turns[${index}]`;
	const record = parseRecord(value, path, TURN_FIELDS, errors);
	if (!record) return [];
	const before = errors.length;
	const result: TurnMetricEvidence = {
		attemptId: identity(record.attemptId, `${path}.attemptId`, errors),
		turnId: identity(record.turnId, `${path}.turnId`, errors),
		terminal: record.terminal === "completed" ? "completed" : (add(errors, "malformed-input", `${path}.terminal`, "turn terminal must be completed"), "completed"),
		provider: identity(record.provider, `${path}.provider`, errors),
		model: identity(record.model, `${path}.model`, errors),
		tier: record.tier === "tier1" || record.tier === "tier2" ? record.tier : (add(errors, "malformed-input", `${path}.tier`, "tier must be tier1 or tier2"), "tier1"),
		inputTokens: parseNonNegativeNumber(record.inputTokens, `${path}.inputTokens`, errors, true),
		outputTokens: parseNonNegativeNumber(record.outputTokens, `${path}.outputTokens`, errors, true),
		totalTokens: parseNonNegativeNumber(record.totalTokens, `${path}.totalTokens`, errors, true),
		costUsd: parseNonNegativeNumber(record.costUsd, `${path}.costUsd`, errors),
		pricingSource: identity(record.pricingSource, `${path}.pricingSource`, errors),
		responseIds: identities(record.responseIds, `${path}.responseIds`, errors),
		toolCallIds: identities(record.toolCallIds, `${path}.toolCallIds`, errors),
	};
	if (result.totalTokens !== result.inputTokens + result.outputTokens) add(errors, "usage-mismatch", `${path}.totalTokens`, "totalTokens must equal inputTokens + outputTokens");
	return errors.length === before ? [result] : [];
}

function parseResponse(value: unknown, index: number, errors: MetricIssue[]): ResponseMetricEvidence[] {
	const path = `metrics.responses[${index}]`;
	const record = parseRecord(value, path, RESPONSE_FIELDS, errors);
	if (!record) return [];
	const before = errors.length;
	const result: ResponseMetricEvidence = {
		attemptId: identity(record.attemptId, `${path}.attemptId`, errors),
		turnId: identity(record.turnId, `${path}.turnId`, errors),
		responseId: identity(record.responseId, `${path}.responseId`, errors),
		provider: identity(record.provider, `${path}.provider`, errors),
		model: identity(record.model, `${path}.model`, errors),
		terminal: record.terminal === "completed" ? "completed" : (add(errors, "malformed-input", `${path}.terminal`, "response terminal must be completed"), "completed"),
		ttftMs: evidenceNumber(record.ttftMs, `${path}.ttftMs`, errors, "missing-timing"),
		pollIds: identities(record.pollIds, `${path}.pollIds`, errors),
		inputTokens: parseNonNegativeNumber(record.inputTokens, `${path}.inputTokens`, errors, true),
		outputTokens: parseNonNegativeNumber(record.outputTokens, `${path}.outputTokens`, errors, true),
		totalTokens: parseNonNegativeNumber(record.totalTokens, `${path}.totalTokens`, errors, true),
		costUsd: parseNonNegativeNumber(record.costUsd, `${path}.costUsd`, errors),
		pricingSource: identity(record.pricingSource, `${path}.pricingSource`, errors),
	};
	if (result.totalTokens !== result.inputTokens + result.outputTokens) add(errors, "usage-mismatch", `${path}.totalTokens`, "totalTokens must equal inputTokens + outputTokens");
	return errors.length === before ? [result] : [];
}

function parsePoll(value: unknown, index: number, errors: MetricIssue[]): PollMetricEvidence[] {
	const path = `metrics.polls[${index}]`;
	const record = parseRecord(value, path, POLL_FIELDS, errors);
	if (!record) return [];
	const before = errors.length;
	const result: PollMetricEvidence = {
		attemptId: identity(record.attemptId, `${path}.attemptId`, errors),
		turnId: identity(record.turnId, `${path}.turnId`, errors),
		responseId: identity(record.responseId, `${path}.responseId`, errors),
		pollId: identity(record.pollId, `${path}.pollId`, errors),
		status: record.status === "queued" || record.status === "in-progress" || record.status === "completed" ? record.status : (add(errors, "malformed-input", `${path}.status`, "poll status is invalid"), "queued"),
		durationMs: evidenceNumber(record.durationMs, `${path}.durationMs`, errors, "missing-poll"),
	};
	return errors.length === before ? [result] : [];
}

function parseTool(value: unknown, index: number, errors: MetricIssue[]): ToolMetricEvidence[] {
	const path = `metrics.tools[${index}]`;
	const record = parseRecord(value, path, TOOL_FIELDS, errors);
	if (!record) return [];
	const before = errors.length;
	const result: ToolMetricEvidence = {
		attemptId: identity(record.attemptId, `${path}.attemptId`, errors),
		turnId: identity(record.turnId, `${path}.turnId`, errors),
		toolCallId: identity(record.toolCallId, `${path}.toolCallId`, errors),
		terminal: record.terminal === "completed" ? "completed" : (add(errors, "malformed-input", `${path}.terminal`, "tool terminal must be completed"), "completed"),
		durationMs: evidenceNumber(record.durationMs, `${path}.durationMs`, errors, "missing-tool"),
	};
	return errors.length === before ? [result] : [];
}

function compareInstrumentedTurn(turn: TurnMetricEvidence, responses: ResponseMetricEvidence[], index: number, errors: MetricIssue[]): void {
	const path = `metrics.turns[${index}]`;
	for (const field of ["inputTokens", "outputTokens", "totalTokens", "costUsd"] as const) {
		const observed = responses.reduce((sum, response) => sum + response[field], 0);
		if (turn[field] !== observed) add(errors, "usage-mismatch", `${path}.${field}`, `${field} does not equal correlated provider response evidence`);
	}
	if (responses.some((response) => response.pricingSource !== turn.pricingSource)) add(errors, "pricing-mismatch", `${path}.pricingSource`, "pricing source does not match correlated provider response evidence");
	if (responses.some((response) => response.provider !== turn.provider || response.model !== turn.model)) add(errors, "provider-evidence-mismatch", path, "provider or model does not match correlated response evidence");
}

function totals(turns: TurnMetricEvidence[], polls: PollMetricEvidence[], tools: ToolMetricEvidence[]): AttemptMetricTotals {
	return {
		inputTokens: sum(turns, "inputTokens"),
		outputTokens: sum(turns, "outputTokens"),
		totalTokens: sum(turns, "totalTokens"),
		costUsd: sum(turns, "costUsd"),
		pollCount: polls.length,
		pollDurationMs: sum(polls, "durationMs"),
		toolDurationMs: sum(tools, "durationMs"),
	};
}

function sum<T>(values: T[], field: keyof T): number {
	return values.reduce((total, value) => total + (typeof value[field] === "number" ? Number(value[field]) : 0), 0);
}

function parseRecord(value: unknown, path: string, fields: Set<string>, errors: MetricIssue[]): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) { add(errors, "malformed-input", path, `${path} must be an object`); return undefined; }
	const record = value as Record<string, unknown>;
	for (const field of Object.keys(record)) if (!fields.has(field)) add(errors, "malformed-input", `${path}.${field}`, `unknown field ${field}`);
	return record;
}

function parseArray(value: unknown, path: string, errors: MetricIssue[]): unknown[] {
	if (!Array.isArray(value)) { add(errors, "malformed-input", path, `${path} must be an array`); return []; }
	return value;
}

function identity(value: unknown, path: string, errors: MetricIssue[]): string {
	if (typeof value !== "string" || !value || value !== value.trim()) { add(errors, "missing-identity", path, `${path} must be a non-empty identity`); return ""; }
	return value;
}

function identities(value: unknown, path: string, errors: MetricIssue[]): string[] {
	return parseArray(value, path, errors).map((item, index) => identity(item, `${path}[${index}]`, errors));
}

function parseNonNegativeNumber(value: unknown, path: string, errors: MetricIssue[], integer = false): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) { add(errors, "invalid-number", path, `${path} must be a non-negative ${integer ? "safe integer" : "number"}`); return 0; }
	return value;
}

function optionalNumber(value: unknown, path: string, errors: MetricIssue[]): number | undefined {
	return value === undefined ? undefined : parseNonNegativeNumber(value, path, errors);
}

function evidenceNumber(value: unknown, path: string, errors: MetricIssue[], missingCode: MetricIssue["code"], integer = false): number {
	if (value === undefined) { add(errors, missingCode, path, `${path} is required`); return 0; }
	return parseNonNegativeNumber(value, path, errors, integer);
}

function uniqueIdentities<T>(values: T[], get: (value: T) => string, path: string, errors: MetricIssue[]): Set<string> {
	const result = new Set<string>();
	for (const [index, value] of values.entries()) {
		const id = get(value);
		if (result.has(id)) add(errors, "duplicate-identity", `${path}[${index}]`, `duplicate identity ${id}`);
		result.add(id);
	}
	return result;
}

function uniqueClaims(values: string[], path: string, errors: MetricIssue[]): void {
	if (new Set(values).size !== values.length) add(errors, "duplicate-identity", path, "claimed identities must be unique");
}

function checkAttempt(actual: string, expected: string, path: string, errors: MetricIssue[]): void {
	if (actual !== expected) add(errors, "correlation-mismatch", path, `record belongs to attempt ${actual || "<missing>"}, expected ${expected || "<missing>"}`);
}

function scoped(parentId: string, childId: string): string {
	return `${parentId}\u0000${childId}`;
}

function responseScope(turnId: string, responseId: string): string {
	return scoped(turnId, responseId);
}

function firstBy<T>(values: T[], key: (value: T) => string): T[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const identity = key(value);
		if (seen.has(identity)) return false;
		seen.add(identity);
		return true;
	});
}

function add(errors: MetricIssue[], code: MetricIssue["code"], path: string, message: string): void {
	errors.push({ code, path, message });
}
