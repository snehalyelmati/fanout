import { canonicalTimestamp, deepFreeze } from "./contract-value.ts";

export type MetricCompatibility = "generic" | "instrumented";

export interface TurnMetricEvidence {
	attemptId: string;
	turnId: string;
	terminal: "completed";
	provider: string;
	model: string;
	tier: "tier1" | "tier2";
	requestedAt?: string;
	firstOutputAt?: string;
	finishedAt?: string;
	durationMs?: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
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
	requestedAt?: string;
	firstTokenAt?: string;
	finishedAt?: string;
	durationMs?: number;
	pollIds: string[];
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
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
	name: string;
	terminal: "completed";
	startedAt?: string;
	finishedAt?: string;
	durationMs?: number;
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
	cacheReadTokens: number;
	cacheWriteTokens: number;
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
const TURN_FIELDS = new Set(["attemptId", "turnId", "terminal", "provider", "model", "tier", "requestedAt", "firstOutputAt", "finishedAt", "durationMs", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "costUsd", "pricingSource", "responseIds", "toolCallIds"]);
const RESPONSE_FIELDS = new Set(["attemptId", "turnId", "responseId", "provider", "model", "terminal", "requestedAt", "firstTokenAt", "finishedAt", "durationMs", "pollIds", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "costUsd", "pricingSource"]);
const POLL_FIELDS = new Set(["attemptId", "turnId", "responseId", "pollId", "status", "durationMs"]);
const TOOL_FIELDS = new Set(["attemptId", "turnId", "toolCallId", "name", "terminal", "startedAt", "finishedAt", "durationMs"]);
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
	const responseIds = uniqueIdentities(responses, (response) => response.responseId, "metrics.responses", errors);
	const pollIds = uniqueIdentities(polls, (poll) => poll.pollId, "metrics.polls", errors);
	const toolIds = uniqueIdentities(tools, (tool) => tool.toolCallId, "metrics.tools", errors);
	const responseOwners = claimOwners(turns, (turn) => turn.responseIds, (turn) => turn.turnId, "metrics.turns", "responseIds", errors);
	const toolOwners = claimOwners(turns, (turn) => turn.toolCallIds, (turn) => turn.turnId, "metrics.turns", "toolCallIds", errors);
	const pollOwners = claimOwners(responses, (response) => response.pollIds, (response) => response.responseId, "metrics.responses", "pollIds", errors);
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
		if (!turn || responseOwners.get(response.responseId) !== response.turnId) add(errors, "correlation-mismatch", `metrics.responses[${index}]`, "response is not claimed only by its parent turn");
		else if (!contains(turn.requestedAt, turn.finishedAt, response.requestedAt, response.finishedAt)) add(errors, "correlation-mismatch", `metrics.responses[${index}]`, "response interval is not contained by its parent turn");
		for (const pollId of response.pollIds) if (!pollIds.has(pollId)) add(errors, "missing-poll", `metrics.responses[${index}].pollIds`, `missing poll ${pollId}`);
	}
	for (const [index, poll] of polls.entries()) {
		const response = responses.find((candidate) => candidate.turnId === poll.turnId && candidate.responseId === poll.responseId);
		if (!response || pollOwners.get(poll.pollId) !== poll.responseId) add(errors, "correlation-mismatch", `metrics.polls[${index}]`, "poll is not claimed only by its parent response");
	}
	for (const [index, tool] of tools.entries()) {
		const turn = turns.find((candidate) => candidate.turnId === tool.turnId);
		if (!turn || toolOwners.get(tool.toolCallId) !== tool.turnId) add(errors, "correlation-mismatch", `metrics.tools[${index}]`, "tool result is not claimed only by its parent turn");
		else if (!contains(turn.requestedAt, turn.finishedAt, tool.startedAt, tool.finishedAt)) add(errors, "correlation-mismatch", `metrics.tools[${index}]`, "tool interval is not contained by its parent turn");
	}
	for (const [index, turn] of turns.entries()) {
		for (const responseId of turn.responseIds) if (!responseIds.has(responseId)) add(errors, "missing-identity", `metrics.turns[${index}].responseIds`, `missing response ${responseId}`);
		for (const toolCallId of turn.toolCallIds) if (!toolIds.has(toolCallId)) add(errors, "missing-tool", `metrics.turns[${index}].toolCallIds`, `missing tool result ${toolCallId}`);
		if (compatibility === "instrumented") compareInstrumentedTurn(turn, responses.filter((response) => response.turnId === turn.turnId), index, errors);
	}
	if (compatibility === "generic" && (responses.length || polls.length)) add(errors, "provider-evidence-mismatch", "metrics.responses", "generic metrics cannot include instrumented provider responses or polls");
	if (workerFirstOutputMs === undefined) add(errors, "missing-timing", "metrics.workerFirstOutputMs", "worker first-output timing is required");
	if (workerDurationMs === undefined) add(errors, "missing-timing", "metrics.workerDurationMs", "worker duration is required");

	const partialTurns = firstBy(turns, (turn) => turn.turnId).map((turn) => ({
		...turn,
		responseIds: turn.responseIds.filter((responseId) => responseOwners.get(responseId) === turn.turnId),
		toolCallIds: turn.toolCallIds.filter((toolCallId) => toolOwners.get(toolCallId) === turn.turnId),
	}));
	const partialResponses = firstBy(responses, (response) => response.responseId)
		.filter((response) => partialTurns.some((turn) => turn.turnId === response.turnId && turn.responseIds.includes(response.responseId)))
		.map((response) => ({ ...response, pollIds: response.pollIds.filter((pollId) => pollOwners.get(pollId) === response.responseId) }));
	const partialPolls = firstBy(polls, (poll) => poll.pollId)
		.filter((poll) => partialResponses.some((response) => response.turnId === poll.turnId && response.responseId === poll.responseId && response.pollIds.includes(poll.pollId)));
	const partialTools = firstBy(tools, (tool) => tool.toolCallId)
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
	return metrics.responses.reduce((total, response) => total + intervalMs(response.requestedAt, response.firstTokenAt), 0);
}

export function validateAttemptMetricEnvelope(metrics: CorrelatedAttemptMetrics, startedAt: string, finishedAt: string): void {
	for (const [kind, records] of [["turn", metrics.turns], ["response", metrics.responses], ["tool", metrics.tools]] as const) {
		for (const record of records) {
			const start = kind === "tool" ? record.startedAt : record.requestedAt;
			if (start !== undefined && record.finishedAt !== undefined && !contains(startedAt, finishedAt, start, record.finishedAt)) throw new TypeError(`${kind} interval must be contained within its Attempt envelope`);
		}
	}
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
		...intervalFields(record, path, "requestedAt", "firstOutputAt", "finishedAt", errors),
		inputTokens: parseNonNegativeNumber(record.inputTokens, `${path}.inputTokens`, errors, true),
		outputTokens: parseNonNegativeNumber(record.outputTokens, `${path}.outputTokens`, errors, true),
		cacheReadTokens: parseNonNegativeNumber(record.cacheReadTokens, `${path}.cacheReadTokens`, errors, true),
		cacheWriteTokens: parseNonNegativeNumber(record.cacheWriteTokens, `${path}.cacheWriteTokens`, errors, true),
		totalTokens: parseNonNegativeNumber(record.totalTokens, `${path}.totalTokens`, errors, true),
		costUsd: parseNonNegativeNumber(record.costUsd, `${path}.costUsd`, errors),
		pricingSource: identity(record.pricingSource, `${path}.pricingSource`, errors),
		responseIds: identities(record.responseIds, `${path}.responseIds`, errors),
		toolCallIds: identities(record.toolCallIds, `${path}.toolCallIds`, errors),
	};
	if (result.totalTokens < result.inputTokens + result.outputTokens) add(errors, "usage-mismatch", `${path}.totalTokens`, "totalTokens must include input and output tokens");
	const intervalStatus = checkInterval(result.requestedAt, result.firstOutputAt, result.finishedAt, result.durationMs, path, errors, true);
	return intervalStatus !== "invalid" && recordUsable(errors, before, path) ? [result] : [];
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
		...intervalFields(record, path, "requestedAt", "firstTokenAt", "finishedAt", errors),
		pollIds: identities(record.pollIds, `${path}.pollIds`, errors),
		inputTokens: parseNonNegativeNumber(record.inputTokens, `${path}.inputTokens`, errors, true),
		outputTokens: parseNonNegativeNumber(record.outputTokens, `${path}.outputTokens`, errors, true),
		cacheReadTokens: parseNonNegativeNumber(record.cacheReadTokens, `${path}.cacheReadTokens`, errors, true),
		cacheWriteTokens: parseNonNegativeNumber(record.cacheWriteTokens, `${path}.cacheWriteTokens`, errors, true),
		totalTokens: parseNonNegativeNumber(record.totalTokens, `${path}.totalTokens`, errors, true),
		costUsd: parseNonNegativeNumber(record.costUsd, `${path}.costUsd`, errors),
		pricingSource: identity(record.pricingSource, `${path}.pricingSource`, errors),
	};
	if (result.totalTokens < result.inputTokens + result.outputTokens) add(errors, "usage-mismatch", `${path}.totalTokens`, "totalTokens must include input and output tokens");
	const intervalStatus = checkInterval(result.requestedAt, result.firstTokenAt, result.finishedAt, result.durationMs, path, errors, true);
	return intervalStatus !== "invalid" && recordUsable(errors, before, path) ? [result] : [];
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
		name: identity(record.name, `${path}.name`, errors),
		terminal: record.terminal === "completed" ? "completed" : (add(errors, "malformed-input", `${path}.terminal`, "tool terminal must be completed"), "completed"),
		...intervalFields(record, path, "startedAt", undefined, "finishedAt", errors),
	};
	const intervalStatus = checkInterval(result.startedAt, undefined, result.finishedAt, result.durationMs, path, errors);
	return intervalStatus !== "invalid" && recordUsable(errors, before, path) ? [result] : [];
}

function compareInstrumentedTurn(turn: TurnMetricEvidence, responses: ResponseMetricEvidence[], index: number, errors: MetricIssue[]): void {
	const path = `metrics.turns[${index}]`;
	for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "costUsd"] as const) {
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
		cacheReadTokens: sum(turns, "cacheReadTokens"),
		cacheWriteTokens: sum(turns, "cacheWriteTokens"),
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

function intervalFields(record: Record<string, unknown>, path: string, startField: string, firstField: string | undefined, finishField: string, errors: MetricIssue[]): Record<string, string | number> {
	const start = metricTimestamp(record[startField], `${path}.${startField}`, errors);
	const first = firstField ? metricTimestamp(record[firstField], `${path}.${firstField}`, errors) : undefined;
	const finish = metricTimestamp(record[finishField], `${path}.${finishField}`, errors);
	const duration = evidenceNumber(record.durationMs, `${path}.durationMs`, errors, "missing-timing");
	return { ...(start ? { [startField]: start } : {}), ...(firstField && first ? { [firstField]: first } : {}), ...(finish ? { [finishField]: finish } : {}), ...(record.durationMs === undefined ? {} : { durationMs: duration }) };
}

function metricTimestamp(value: unknown, path: string, errors: MetricIssue[]): string | undefined {
	try { return canonicalTimestamp(value, path); } catch { add(errors, "missing-timing", path, `${path} must be a canonical timestamp`); return undefined; }
}

function checkInterval(start: string | undefined, first: string | undefined, finish: string | undefined, duration: number | undefined, path: string, errors: MetricIssue[], requireFirst = false): "complete" | "missing" | "invalid" {
	if (start === undefined || finish === undefined || duration === undefined || requireFirst && first === undefined) {
		add(errors, "missing-timing", path, `${path} requires complete interval timing`);
		return "missing";
	}
	if (first !== undefined && Date.parse(first) < Date.parse(start) || first !== undefined && Date.parse(first) > Date.parse(finish) || Date.parse(finish) < Date.parse(start)) {
		add(errors, "missing-timing", path, `${path} timestamps must be ordered`);
		return "invalid";
	}
	if (intervalMs(start, finish) !== duration) {
		add(errors, "missing-timing", `${path}.durationMs`, "durationMs must equal its timestamp interval");
		return "invalid";
	}
	return "complete";
}

function recordUsable(errors: MetricIssue[], before: number, path: string): boolean {
	return errors.slice(before).every((error) => error.code === "missing-timing" || error.code === "missing-identity" && error.path === `${path}.name`);
}

function intervalMs(start: string | undefined, finish: string | undefined): number {
	return start === undefined || finish === undefined ? 0 : Date.parse(finish) - Date.parse(start);
}

function contains(parentStart: string | undefined, parentFinish: string | undefined, childStart: string | undefined, childFinish: string | undefined): boolean {
	return parentStart !== undefined && parentFinish !== undefined && childStart !== undefined && childFinish !== undefined && Date.parse(parentStart) <= Date.parse(childStart) && Date.parse(childFinish) <= Date.parse(parentFinish);
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

function claimOwners<T>(parents: T[], claims: (parent: T) => string[], owner: (parent: T) => string, path: string, field: string, errors: MetricIssue[]): Map<string, string> {
	const result = new Map<string, string>();
	const ambiguous = new Set<string>();
	for (const [index, parent] of parents.entries()) {
		for (const identity of claims(parent)) {
			if (ambiguous.has(identity)) continue;
			if (result.has(identity)) {
				add(errors, "duplicate-identity", `${path}[${index}].${field}`, `${identity} is claimed more than once`);
				result.delete(identity);
				ambiguous.add(identity);
			}
			else result.set(identity, owner(parent));
		}
	}
	return result;
}

function checkAttempt(actual: string, expected: string, path: string, errors: MetricIssue[]): void {
	if (actual !== expected) add(errors, "correlation-mismatch", path, `record belongs to attempt ${actual || "<missing>"}, expected ${expected || "<missing>"}`);
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
