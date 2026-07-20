import type { ResponseMetricEvidence, ToolMetricEvidence, TurnMetricEvidence } from "../../fanout-core/src/attempt-metrics";

export type ProviderProfile =
	| { mode: "observed" }
	| {
		mode: "fixed"; name: string; capacity: number | "unlimited";
		ttftMs: number; outputTokensPerSecond: number; pricesPerMillion: ProviderPrices;
	}
	| {
		mode: "cold-warm"; name: string; capacity: number | "unlimited"; warmthScope: "attempt" | "run";
		coldTtftMs: number; warmTtftMs: number; outputTokensPerSecond: number; pricesPerMillion: ProviderPrices;
		reset?: { idleExpiryMs?: number; warmCallLimit?: number; previousResponseDurationResetMs?: number };
	};

export interface ProviderProfiles { tier1: ProviderProfile; tier2: ProviderProfile }
export interface ProviderPrices { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface ProviderAttemptInput {
	nodeId: string; attemptId: string; allocationSequence: number; allocationEpochMs: number;
	scenarioStartMs: number; recordedDurationMs: number; tier: "tier1" | "tier2";
	turns: TurnMetricEvidence[]; responses: ResponseMetricEvidence[]; tools: ToolMetricEvidence[];
}

export interface ProviderCallSchedule {
	nodeId: string; attemptId: string; turnId: string; responseId: string | null; callId: string; tier: "tier1" | "tier2"; turnOrder: number; callOrder: number;
	issueMs: number; providerStartMs: number; providerEndMs: number; providerWaitMs: number;
	ttftMs: number; generationMs: number; durationMs: number; warmth: "cold" | "warm" | "fixed" | "observed";
	observedCostUsd: number | null; scenarioCostUsd: number | null; capacityPredecessorId: string | null;
}

export interface ProviderPlan {
	turns: Array<Record<string, unknown>>;
	responses: ProviderCallSchedule[];
	tools: Array<{ toolCallId: string; startMs: number; endMs: number }>;
	durationOverrides: ReadonlyMap<string, number>;
	tiers: Array<Record<string, unknown>>;
	cost: Record<string, unknown>;
}

const OBSERVED: ProviderProfile = { mode: "observed" };
export const observedProviderProfiles = (): ProviderProfiles => ({ tier1: OBSERVED, tier2: OBSERVED });

export function parseProviderProfiles(value: unknown): ProviderProfiles {
	if (value === undefined) return observedProviderProfiles();
	const body = record(value, "providerProfiles");
	exactKeys(body, ["tier1", "tier2"], "providerProfiles");
	return { tier1: parseProfile(body.tier1, "tier1"), tier2: parseProfile(body.tier2, "tier2") };
}

export function buildProviderPlan(attempts: ProviderAttemptInput[], profiles: ProviderProfiles): ProviderPlan {
	const responses = (["tier1", "tier2"] as const).flatMap((tier) => scheduleTier(attempts.filter((attempt) => attempt.tier === tier), profiles[tier]));
	const durationOverrides = new Map<string, number>();
	for (const attempt of attempts) {
		const evidence = callsForAttempt(attempt);
		if (profiles[attempt.tier].mode === "observed" || !evidence.length) continue;
		const recordedLast = evidence.at(-1)!;
		const last = responses.find(({ callId }) => callId === recordedLast.callId);
		if (!last) throw new TypeError(`Provider Profile requires complete provider-call timing for ${attempt.attemptId}`);
		const tailMs = attempt.recordedDurationMs - (Date.parse(recordedLast.finishedAt) - attempt.allocationEpochMs);
		if (tailMs < 0) throw new TypeError(`Provider Profile Turn timing exceeds Attempt ${attempt.attemptId}`);
		durationOverrides.set(attempt.attemptId, last.providerEndMs - attempt.scenarioStartMs + tailMs);
	}
	const tierRows = (["tier1", "tier2"] as const).map((tier) => aggregateTier(tier, responses.filter((call) => call.tier === tier), profiles[tier]));
	const observed = costSummary(responses, "observedCostUsd");
	const scenario = costSummary(responses, "scenarioCostUsd");
	const status = scenario.status === "unavailable" ? "unavailable" : observed.status === "available" && scenario.status === "available" ? "available" : "partial";
	const ordered = responses.sort((a, b) => a.issueMs - b.issueMs || attempts.find((item) => item.attemptId === a.attemptId)!.allocationSequence - attempts.find((item) => item.attemptId === b.attemptId)!.allocationSequence || a.turnOrder - b.turnOrder || a.callOrder - b.callOrder);
	return {
		turns: aggregateTurns(ordered), responses: ordered, tools: scheduleTools(attempts, ordered),
		durationOverrides,
		tiers: tierRows,
		cost: { status, observedUsd: observed.value, scenarioUsd: scenario.value, deltaUsd: status === "available" ? money(scenario.value! - observed.value!) : null },
	};
}

interface CallEvidence {
	turnId: string; responseId: string | null; callId: string; requestedAt: string; firstTokenAt: string; finishedAt: string; durationMs: number;
	inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; turnOrder: number; callOrder: number;
}

function scheduleTier(attempts: ProviderAttemptInput[], profile: ProviderProfile): ProviderCallSchedule[] {
	if (profile.mode === "observed") return attempts.flatMap((attempt) => callsForAttempt(attempt).map((call) => observedCall(attempt, call)));
	type Candidate = { attempt: ProviderAttemptInput; calls: CallEvidence[]; index: number; issueMs: number };
	const candidates: Candidate[] = attempts.flatMap((attempt) => {
		const calls = callsForAttempt(attempt);
		return calls.length ? [{ attempt, calls, index: 0, issueMs: attempt.scenarioStartMs + firstGap(attempt, calls[0]!) }] : [];
	});
	const rows: ProviderCallSchedule[] = [];
	const slots = profile.capacity === "unlimited" ? [] : Array.from({ length: profile.capacity }, () => ({ endMs: 0, callId: null as string | null }));
	while (candidates.length) {
		candidates.sort((a, b) => a.issueMs - b.issueMs || a.attempt.allocationSequence - b.attempt.allocationSequence || a.calls[a.index]!.turnOrder - b.calls[b.index]!.turnOrder || a.calls[a.index]!.callOrder - b.calls[b.index]!.callOrder);
		const candidate = candidates.shift()!;
		const call = candidate.calls[candidate.index]!;
		if (!nonNegative(call.outputTokens)) throw new TypeError(`Provider Profile requires output-token evidence for ${candidate.attempt.attemptId}`);
		let providerStartMs = candidate.issueMs;
		let slot = -1, capacityPredecessorId: string | null = null;
		if (slots.length) {
			slot = slots.reduce((best, value, index) => value.endMs < slots[best]!.endMs ? index : best, 0);
			if (slots[slot]!.endMs > providerStartMs) capacityPredecessorId = slots[slot]!.callId;
			providerStartMs = Math.max(providerStartMs, slots[slot]!.endMs);
		}
		const warmth = classifyWarmth(profile, rows, candidate.attempt.attemptId, candidate.issueMs);
		const ttftMs = profile.mode === "fixed" ? profile.ttftMs : warmth === "cold" ? profile.coldTtftMs : profile.warmTtftMs;
		const generationMs = call.outputTokens / profile.outputTokensPerSecond * 1_000;
		const durationMs = ttftMs + generationMs;
		const providerEndMs = providerStartMs + durationMs;
		if (slot >= 0) slots[slot] = { endMs: providerEndMs, callId: call.callId };
		rows.push({ nodeId: candidate.attempt.nodeId, attemptId: candidate.attempt.attemptId, turnId: call.turnId, responseId: call.responseId, callId: call.callId, tier: candidate.attempt.tier, turnOrder: call.turnOrder, callOrder: call.callOrder, issueMs: candidate.issueMs, providerStartMs, providerEndMs, providerWaitMs: providerStartMs - candidate.issueMs, ttftMs, generationMs, durationMs, warmth: profile.mode === "fixed" ? "fixed" : warmth, observedCostUsd: validCost(call.costUsd), scenarioCostUsd: profileCost(call, profile.pricesPerMillion), capacityPredecessorId });
		const nextIndex = candidate.index + 1;
		if (nextIndex < candidate.calls.length) {
			const next = candidate.calls[nextIndex]!, gap = Date.parse(next.requestedAt) - Date.parse(call.finishedAt);
			if (gap < 0) throw new TypeError(`Provider Profile requires ordered Worker Turns for ${candidate.attempt.attemptId}`);
			candidates.push({ ...candidate, index: nextIndex, issueMs: providerEndMs + gap });
		}
	}
	return rows;
}

function observedCall(attempt: ProviderAttemptInput, call: CallEvidence): ProviderCallSchedule {
	const issueMs = attempt.scenarioStartMs + Date.parse(call.requestedAt) - attempt.allocationEpochMs;
	const ttftMs = Date.parse(call.firstTokenAt) - Date.parse(call.requestedAt);
	const generationMs = Date.parse(call.finishedAt) - Date.parse(call.firstTokenAt);
	return { nodeId: attempt.nodeId, attemptId: attempt.attemptId, turnId: call.turnId, responseId: call.responseId, callId: call.callId, tier: attempt.tier, turnOrder: call.turnOrder, callOrder: call.callOrder, issueMs, providerStartMs: issueMs, providerEndMs: issueMs + call.durationMs, providerWaitMs: 0, ttftMs, generationMs, durationMs: call.durationMs, warmth: "observed", observedCostUsd: validCost(call.costUsd), scenarioCostUsd: validCost(call.costUsd), capacityPredecessorId: null };
}

function classifyWarmth(profile: Exclude<ProviderProfile, { mode: "observed" | "fixed" }>, rows: ProviderCallSchedule[], attemptId: string, issueMs: number): "cold" | "warm" {
	const scope = rows.filter((row) => (profile.warmthScope === "run" || row.attemptId === attemptId) && row.providerEndMs <= issueMs).sort((a, b) => a.issueMs - b.issueMs || a.providerEndMs - b.providerEndMs);
	const previous = [...scope].sort((a, b) => b.providerEndMs - a.providerEndMs)[0];
	if (!previous) return "cold";
	const reset = profile.reset;
	if (reset?.idleExpiryMs !== undefined && issueMs - previous.providerEndMs >= reset.idleExpiryMs) return "cold";
	if (reset?.previousResponseDurationResetMs !== undefined && previous.durationMs >= reset.previousResponseDurationResetMs) return "cold";
	if (reset?.warmCallLimit !== undefined) {
		const lastCold = scope.findLastIndex(({ warmth }) => warmth === "cold");
		if (scope.slice(lastCold + 1).filter(({ warmth }) => warmth === "warm").length >= reset.warmCallLimit) return "cold";
	}
	return "warm";
}

function aggregateTier(tier: "tier1" | "tier2", calls: ProviderCallSchedule[], profile: ProviderProfile): Record<string, unknown> {
	const scenario = costSummary(calls, "scenarioCostUsd");
	return { tier, profile: profile.mode === "observed" ? "Observed" : profile.name, mode: profile.mode, calls: calls.length, providerWaitMs: sum(calls, "providerWaitMs"), ttftMs: sum(calls, "ttftMs"), generationMs: sum(calls, "generationMs"), peakProviderUtilization: peak(calls), costStatus: scenario.status, scenarioCostUsd: scenario.value };
}

function costSummary(calls: ProviderCallSchedule[], field: "observedCostUsd" | "scenarioCostUsd"): { status: "available" | "partial" | "unavailable"; value: number | null } {
	const known = calls.flatMap((call) => call[field] === null ? [] : [call[field]!]);
	return { status: !known.length ? "unavailable" : known.length === calls.length ? "available" : "partial", value: known.length ? money(known.reduce((total, value) => total + value, 0)) : null };
}

function profileCost(call: CallEvidence, prices: ProviderPrices): number | null {
	if (![call.inputTokens, call.outputTokens, call.cacheReadTokens, call.cacheWriteTokens].every(nonNegative)) return null;
	return money((call.inputTokens * prices.input + call.outputTokens * prices.output + call.cacheReadTokens * prices.cacheRead + call.cacheWriteTokens * prices.cacheWrite) / 1_000_000);
}

function callsForAttempt(attempt: ProviderAttemptInput): CallEvidence[] {
	return attempt.turns.flatMap((turn, turnOrder) => {
		const responses = attempt.responses.filter((response) => response.turnId === turn.turnId);
		if (responses.length) return responses.map((response, callOrder) => callEvidence(response.turnId, response.responseId, response.requestedAt, response.firstTokenAt, response.finishedAt, response.durationMs, response, turnOrder, callOrder));
		return [callEvidence(turn.turnId, null, turn.requestedAt, turn.firstOutputAt, turn.finishedAt, turn.durationMs, turn, turnOrder, 0)];
	});
}

function callEvidence(turnId: string, responseId: string | null, requestedAt: string | undefined, firstTokenAt: string | undefined, finishedAt: string | undefined, durationMs: number | undefined, usage: Pick<TurnMetricEvidence, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsd">, turnOrder: number, callOrder: number): CallEvidence {
	if (!requestedAt || !firstTokenAt || !finishedAt || !nonNegative(durationMs)) throw new TypeError(`Provider timing is unavailable for ${responseId ?? turnId}`);
	return { turnId, responseId, callId: responseId ?? `${turnId}:provider`, requestedAt, firstTokenAt, finishedAt, durationMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, costUsd: usage.costUsd, turnOrder, callOrder };
}

function aggregateTurns(calls: ProviderCallSchedule[]): Array<Record<string, unknown>> {
	const groups = new Map<string, ProviderCallSchedule[]>();
	for (const call of calls) {
		const key = `${call.attemptId}\0${call.turnId}`;
		groups.set(key, [...(groups.get(key) ?? []), call]);
	}
	return [...groups.values()].map((group) => {
		const first = group[0]!, observed = costSummary(group, "observedCostUsd"), scenario = costSummary(group, "scenarioCostUsd");
		return { nodeId: first.nodeId, attemptId: first.attemptId, turnId: first.turnId, tier: first.tier, responseIds: group.flatMap(({ responseId }) => responseId ? [responseId] : []), issueMs: Math.min(...group.map(({ issueMs }) => issueMs)), providerStartMs: Math.min(...group.map(({ providerStartMs }) => providerStartMs)), providerEndMs: Math.max(...group.map(({ providerEndMs }) => providerEndMs)), providerWaitMs: sum(group, "providerWaitMs"), ttftMs: sum(group, "ttftMs"), generationMs: sum(group, "generationMs"), durationMs: Math.max(...group.map(({ providerEndMs }) => providerEndMs)) - Math.min(...group.map(({ issueMs }) => issueMs)), warmth: group.map(({ warmth }) => warmth).join(" → "), observedCostUsd: observed.value, scenarioCostUsd: scenario.value, costStatus: scenario.status, capacityPredecessorIds: group.flatMap(({ capacityPredecessorId }) => capacityPredecessorId ? [capacityPredecessorId] : []) };
	});
}

function scheduleTools(attempts: ProviderAttemptInput[], calls: ProviderCallSchedule[]): Array<{ toolCallId: string; startMs: number; endMs: number }> {
	return attempts.flatMap((attempt) => {
		const evidence = callsForAttempt(attempt), scheduled = calls.filter(({ attemptId }) => attemptId === attempt.attemptId);
		return attempt.tools.flatMap((tool) => {
			if (!tool.startedAt || !tool.finishedAt || !nonNegative(tool.durationMs)) return [];
			const startedAt = Date.parse(tool.startedAt);
			const prior = evidence.filter((call) => Date.parse(call.finishedAt) <= startedAt).sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0];
			const priorSchedule = prior ? scheduled.find(({ callId }) => callId === prior.callId) : undefined;
			const startMs = prior && priorSchedule ? priorSchedule.providerEndMs + startedAt - Date.parse(prior.finishedAt) : attempt.scenarioStartMs + startedAt - attempt.allocationEpochMs;
			return [{ toolCallId: tool.toolCallId, startMs, endMs: startMs + tool.durationMs }];
		});
	});
}

function parseProfile(value: unknown, tier: string): ProviderProfile {
	const profile = record(value, `providerProfiles.${tier}`);
	if (profile.mode === "observed") { exactKeys(profile, ["mode"], `providerProfiles.${tier}`); return OBSERVED; }
	const common = ["mode", "name", "capacity", "outputTokensPerSecond", "pricesPerMillion"];
	if (profile.mode === "fixed") exactKeys(profile, [...common, "ttftMs"], `providerProfiles.${tier}`);
	else if (profile.mode === "cold-warm") exactKeys(profile, [...common, "warmthScope", "coldTtftMs", "warmTtftMs", "reset"], `providerProfiles.${tier}`, ["reset"]);
	else throw new TypeError(`providerProfiles.${tier}.mode must be observed, fixed, or cold-warm`);
	if (typeof profile.name !== "string" || !profile.name.trim()) throw new TypeError(`providerProfiles.${tier}.name must be non-empty`);
	if (profile.capacity !== "unlimited" && (!Number.isSafeInteger(profile.capacity) || Number(profile.capacity) < 1)) throw new TypeError(`providerProfiles.${tier}.capacity must be a positive safe integer or unlimited`);
	positive(profile.outputTokensPerSecond, `providerProfiles.${tier}.outputTokensPerSecond`);
	const prices = record(profile.pricesPerMillion, `providerProfiles.${tier}.pricesPerMillion`); exactKeys(prices, ["input", "output", "cacheRead", "cacheWrite"], `providerProfiles.${tier}.pricesPerMillion`);
	for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) nonNegativeNumber(prices[key], `providerProfiles.${tier}.pricesPerMillion.${key}`);
	if (profile.mode === "fixed") { nonNegativeNumber(profile.ttftMs, `providerProfiles.${tier}.ttftMs`); return profile as unknown as ProviderProfile; }
	if (profile.warmthScope !== "attempt" && profile.warmthScope !== "run") throw new TypeError(`providerProfiles.${tier}.warmthScope must be attempt or run`);
	nonNegativeNumber(profile.coldTtftMs, `providerProfiles.${tier}.coldTtftMs`); nonNegativeNumber(profile.warmTtftMs, `providerProfiles.${tier}.warmTtftMs`);
	if (profile.reset !== undefined) {
		const reset = record(profile.reset, `providerProfiles.${tier}.reset`); exactKeys(reset, ["idleExpiryMs", "warmCallLimit", "previousResponseDurationResetMs"], `providerProfiles.${tier}.reset`, ["idleExpiryMs", "warmCallLimit", "previousResponseDurationResetMs"]);
		if (reset.idleExpiryMs !== undefined) nonNegativeNumber(reset.idleExpiryMs, `providerProfiles.${tier}.reset.idleExpiryMs`);
		if (reset.previousResponseDurationResetMs !== undefined) nonNegativeNumber(reset.previousResponseDurationResetMs, `providerProfiles.${tier}.reset.previousResponseDurationResetMs`);
		if (reset.warmCallLimit !== undefined && (!Number.isSafeInteger(reset.warmCallLimit) || Number(reset.warmCallLimit) < 1)) throw new TypeError(`providerProfiles.${tier}.reset.warmCallLimit must be a positive safe integer`);
	}
	return profile as unknown as ProviderProfile;
}

function firstGap(attempt: ProviderAttemptInput, call: CallEvidence): number {
	const gap = Date.parse(call.requestedAt) - attempt.allocationEpochMs;
	if (gap < 0) throw new TypeError(`Provider Profile Turn starts before Attempt ${attempt.attemptId}`);
	return gap;
}
function peak(calls: ProviderCallSchedule[]): number { return calls.reduce((highest, call) => Math.max(highest, calls.filter((other) => other.providerStartMs < call.providerEndMs && other.providerEndMs > call.providerStartMs).length), 0); }
function sum(calls: ProviderCallSchedule[], field: "providerWaitMs" | "ttftMs" | "generationMs"): number { return calls.reduce((total, call) => total + call[field], 0); }
function validCost(value: unknown): number | null { return nonNegative(value) ? Number(value) : null; }
function money(value: number): number { return Math.round(value * 1e12) / 1e12; }
function nonNegative(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function nonNegativeNumber(value: unknown, path: string): void { if (!nonNegative(value)) throw new TypeError(`${path} must be a non-negative finite number`); }
function positive(value: unknown, path: string): void { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${path} must be a positive finite number`); }
function record(value: unknown, path: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`); return value as Record<string, any>; }
function exactKeys(value: Record<string, any>, keys: string[], path: string, optional: string[] = []): void {
	const allowed = new Set(keys); if (Object.keys(value).some((key) => !allowed.has(key)) || keys.some((key) => !optional.includes(key) && !Object.hasOwn(value, key))) throw new TypeError(`${path} contains unsupported or missing fields`);
}
