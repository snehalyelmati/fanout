import { deriveAttemptMetricTotals } from "./attempt-metrics.ts";
import type { AcceptedStateTransition, ArtifactIdentity, GitTreeId } from "./artifact-identity.ts";
import { deepFreeze } from "./contract-value.ts";
import type { AttemptAllocation, AttemptBudgetCounts, AttemptKind, AttemptOutcome } from "./execution-attempt.ts";
import { routeAttempt } from "./execution-attempt.ts";
import {
	parseExecutionEvent,
	type AttemptCompletedPayload,
	type ExecutionEvent,
	type ExecutionPhase,
	type FinalValidationCompletedPayload,
	type PreflightCompletedPayload,
	type RunFinishCause,
	type RunMode,
	type RunOutcome,
	type RunPolicy,
	type RunStartedPayload,
} from "./execution-event.ts";

export const EXECUTION_PROJECTION_SCHEMA = "fanout.execution-run";
export const EXECUTION_PROJECTION_VERSION = 2;

export interface AttemptProjection {
	allocationSequence: number;
	completionSequence: number | null;
	allocation: AttemptAllocation;
	outcome: AttemptOutcome | null;
}

export interface NodeProjection {
	id: string;
	status: "pending" | "succeeded" | "failed" | "skipped";
	completionSequence: number | null;
	attemptIds: string[];
	causalAttemptId: string | null;
	causalUpstreamNodeId: string | null;
}

export interface AcceptedLedgerEntry {
	eventSequence: number;
	attemptId: string;
	transition: AcceptedStateTransition;
}

export interface ExecutionTotals {
	attempts: number;
	attemptKinds: Record<AttemptKind, number>;
	actions: Record<AttemptOutcome["action"], number>;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedCostUsd: number;
	workerDurationMs: number;
	toolDurationMs: number;
	pollDurationMs: number;
	pollCount: number;
	filesChanged: number;
	insertions: number;
	deletions: number;
	finalValidationDurationMs: number;
	runDurationMs: number;
}

export type FinalValidationProjection =
	| { disposition: "not-started" }
	| { disposition: "running"; commandIdentities: string[]; expectedTree: GitTreeId; startedAt: string }
	| ({ disposition: "passed" | "failed"; completionSequence: number } & FinalValidationCompletedPayload)
	| { disposition: "not-run"; reason: "dry-run" | "aborted" | "upstream-failure" };

export interface ExecutionRunProjection {
	schema: typeof EXECUTION_PROJECTION_SCHEMA;
	version: typeof EXECUTION_PROJECTION_VERSION;
	runId: string;
	lastEventSequence: number;
	mode: RunMode;
	phase: ExecutionPhase;
	terminalOutcome: { outcome: RunOutcome; durationMs: number; cause: RunFinishCause } | null;
	packet: ArtifactIdentity;
	planningBaseTree: GitTreeId;
	policy: RunPolicy;
	startedAt: string;
	updatedAt: string;
	finishedAt: string | null;
	preflight: (PreflightCompletedPayload & { eventSequence: number }) | null;
	confirmation: "pending" | "accepted" | "declined" | "not-required";
	confirmationEventSequence: number | null;
	nodes: NodeProjection[];
	attempts: AttemptProjection[];
	budgets: Record<string, AttemptBudgetCounts>;
	acceptedLedger: AcceptedLedgerEntry[];
	finalValidation: FinalValidationProjection;
	totals: ExecutionTotals;
}

const BUDGET_LIMITS: AttemptBudgetCounts = { original: 1, retry: 1, fallback: 1, validationRepair: 2, integrationRepair: 2 };
const KIND_BUDGET: Record<AttemptKind, keyof AttemptBudgetCounts> = { original: "original", retry: "retry", fallback: "fallback", "validation-repair": "validationRepair", "integration-repair": "integrationRepair" };

export function replayExecutionEvents(values: readonly unknown[]): ExecutionRunProjection {
	if (!Array.isArray(values) || values.length === 0) throw new TypeError("event log must contain run-started");
	let state: ExecutionRunProjection | undefined;
	for (const value of values) state = reduceExecutionEvent(state, value);
	return state as ExecutionRunProjection;
}

export function reduceExecutionEvent(previous: ExecutionRunProjection | undefined, value: unknown): ExecutionRunProjection {
	const event = parseExecutionEvent(value);
	if (!previous) {
		if (event.sequence !== 1 || event.event !== "run-started") throw new Error("run-started must be the first event at sequence 1");
		const payload = event.payload as unknown as RunStartedPayload;
		return finalize({
			schema: EXECUTION_PROJECTION_SCHEMA, version: EXECUTION_PROJECTION_VERSION, runId: event.runId, lastEventSequence: 1,
			mode: payload.mode, phase: "preflight", terminalOutcome: null, packet: payload.packet, planningBaseTree: payload.planningBaseTree, policy: payload.policy,
			startedAt: event.occurredAt, updatedAt: event.occurredAt, finishedAt: null, preflight: null,
			confirmation: payload.mode === "live" ? "pending" : "not-required", confirmationEventSequence: null,
			nodes: payload.nodeIds.map((id) => ({ id, status: "pending", completionSequence: null, attemptIds: [], causalAttemptId: null, causalUpstreamNodeId: null })),
			attempts: [], budgets: Object.fromEntries(payload.nodeIds.map((id) => [id, emptyBudgets()])), acceptedLedger: [], finalValidation: { disposition: "not-started" }, totals: emptyTotals(),
		});
	}
	if (previous.terminalOutcome) throw new Error("no event may follow run-finished");
	if (event.runId !== previous.runId) throw new Error("event log contains mixed run IDs");
	if (event.sequence !== previous.lastEventSequence + 1) throw new Error("event sequence must be positive, contiguous, and unique");
	if (event.event === "run-started") throw new Error("run-started is unique");
	const state = structuredClone(previous);
	state.lastEventSequence = event.sequence;
	state.updatedAt = event.occurredAt;
	applyEvent(state, event);
	return finalize(state);
}

function applyEvent(state: ExecutionRunProjection, event: ExecutionEvent): void {
	const payload = event.payload;
	if (event.event === "preflight-completed") return applyPreflight(state, event.sequence, payload as unknown as PreflightCompletedPayload);
	if (event.event === "confirmation-decided") return applyConfirmation(state, event.sequence, payload.decision as "accepted" | "declined");
	if (event.event === "attempt-allocated") return applyAllocation(state, event.sequence, payload.allocation as unknown as AttemptAllocation);
	if (event.event === "attempt-completed") return applyCompletion(state, event.sequence, payload as unknown as AttemptCompletedPayload);
	if (event.event === "node-completed") return applyNodeCompletion(state, event.sequence, payload);
	if (event.event === "final-validation-started") return applyFinalValidationStart(state, payload, event.occurredAt);
	if (event.event === "final-validation-completed") return applyFinalValidationCompletion(state, event.sequence, payload as unknown as FinalValidationCompletedPayload);
	if (event.event === "run-finished") return applyRunFinished(state, payload, event.occurredAt);
	throw new Error(`unsupported event ${event.event}`);
}

function applyPreflight(state: ExecutionRunProjection, sequence: number, payload: PreflightCompletedPayload): void {
	if (state.preflight) throw new Error("preflight may complete only once");
	if (payload.planningBaseTree !== state.planningBaseTree) throw new Error("preflight planning base does not match run authority");
	if (payload.status === "passed" && payload.repositoryTree !== state.planningBaseTree) throw new Error("passed preflight requires the exact planning-base repository tree");
	state.preflight = { ...payload, eventSequence: sequence };
	state.phase = payload.status === "passed" && state.mode === "live" ? "confirmation" : "preflight";
}

function applyConfirmation(state: ExecutionRunProjection, sequence: number, decision: "accepted" | "declined"): void {
	if (state.mode !== "live" || state.preflight?.status !== "passed" || state.confirmation !== "pending") throw new Error("confirmation requires one passed live preflight");
	state.confirmation = decision;
	state.confirmationEventSequence = sequence;
	state.phase = decision === "accepted" ? "attempts" : "confirmation";
}

function applyAllocation(state: ExecutionRunProjection, sequence: number, allocation: AttemptAllocation): void {
	if (state.mode !== "live" || state.preflight?.status !== "passed" || state.confirmation !== "accepted") throw new Error("attempt launch requires passed preflight and accepted live confirmation");
	if (allocation.runId !== state.runId) throw new Error("attempt allocation belongs to another run");
	const node = nodeById(state, allocation.nodeId);
	const finalRepair = allocation.kind === "validation-repair" && node.id === "final-validation" && state.finalValidation.disposition === "running";
	if (node.status !== "pending" && !(finalRepair && node.status === "succeeded")) throw new Error("completed node cannot allocate another attempt outside the running final-validation gate");
	if (state.attempts.some((attempt) => attempt.allocation.attemptId === allocation.attemptId)) throw new Error("attempt identity must be unique");
	const budgets = state.budgets[allocation.nodeId];
	const budgetName = KIND_BUDGET[allocation.kind];
	if (allocation.attemptNumber !== node.attemptIds.length + 1 || allocation.budgetTransition.name !== budgetName || allocation.budgetTransition.before !== budgets[budgetName] || allocation.budgetTransition.after !== budgets[budgetName] + 1 || allocation.budgetTransition.limit !== BUDGET_LIMITS[budgetName]) throw new Error("attempt budget transition reset, overflow, or gap");
	const source = allocation.sourceAttemptId ? completedAttempt(state, allocation.sourceAttemptId) : undefined;
	const latest = state.attempts.filter((attempt) => attempt.allocation.nodeId === allocation.nodeId).at(-1);
	if (allocation.kind === "original") {
		if (allocation.attemptNumber !== 1 || source || allocation.sourceFinalValidationEvidence) throw new Error("original attempt must be the first launch without a source");
	} else if (allocation.sourceFinalValidationEvidence) {
		if (!finalRepair || allocation.attemptNumber !== 1 || latest) throw new Error("failed-round evidence may source only the first final validation repair");
	} else if (!source || source !== latest) throw new Error("recovery attempt requires the latest completed source on the same node");
	if (allocation.kind === "retry" && (source?.allocation.kind !== "original" || source.outcome?.action !== "retry" || !sameAssignment(source.allocation, allocation))) throw new Error("retry causality is invalid");
	if (allocation.kind === "fallback" && (source?.allocation.kind !== "retry" || source.outcome?.action !== "fallback" || source.allocation.assignment.tier !== "tier2" || allocation.assignment.tier !== "tier1" || budgets.retry !== BUDGET_LIMITS.retry)) throw new Error("fallback causality is invalid");
	if (allocation.kind === "validation-repair" && ((!allocation.sourceFinalValidationEvidence && source?.outcome?.action !== "validation-repair") || allocation.assignment.tier !== "tier1")) throw new Error("validation repair causality is invalid");
	if (allocation.kind === "integration-repair" && (source?.outcome?.action !== "integration-repair" || allocation.assignment.tier !== "tier1")) throw new Error("integration repair causality is invalid");
	budgets[budgetName] = allocation.budgetTransition.after;
	node.attemptIds.push(allocation.attemptId);
	state.attempts.push({ allocationSequence: sequence, completionSequence: null, allocation, outcome: null });
	state.phase = "attempts";
}

function applyCompletion(state: ExecutionRunProjection, sequence: number, payload: AttemptCompletedPayload): void {
	const attempt = state.attempts.find((candidate) => candidate.allocation.attemptId === payload.outcome.attemptId);
	if (!attempt || attempt.outcome) throw new Error("attempt completion requires one unmatched allocation");
	const { allocation } = attempt;
	const { outcome } = payload;
	for (const field of ["runId", "nodeId", "attemptId", "attemptNumber", "kind"] as const) if (outcome[field] !== allocation[field]) throw new Error(`attempt outcome ${field} does not match its allocation`);
	if (!sameAssignment(allocation, outcome) || JSON.stringify(outcome.budgetTransition) !== JSON.stringify(allocation.budgetTransition) || outcome.sourceAttemptId !== allocation.sourceAttemptId || JSON.stringify(outcome.sourceFinalValidationEvidence) !== JSON.stringify(allocation.sourceFinalValidationEvidence)) throw new Error("attempt outcome repeats contradictory allocation authority");
	const expected = routeAttempt(outcome.terminalFact, { kind: allocation.kind, assignment: allocation.assignment, fallbackAllowed: state.policy.fallbackAllowed, remaining: remainingBudgets(state.budgets[allocation.nodeId]) });
	if (outcome.action !== expected) throw new Error("attempt controller action contradicts its typed fact and fixed budgets");
	if ((outcome.action === "accept") !== Boolean(payload.acceptedTransition)) throw new Error("only an accepted attempt may append one accepted-state transition");
	if (payload.acceptedTransition) {
		const currentTree = state.acceptedLedger.at(-1)?.transition.patch.resultTree ?? state.planningBaseTree;
		if (payload.acceptedTransition.patch.baseTree !== currentTree) throw new Error("accepted-state ledger tree chain diverges");
		state.acceptedLedger.push({ eventSequence: sequence, attemptId: outcome.attemptId, transition: payload.acceptedTransition });
	}
	attempt.outcome = outcome;
	attempt.completionSequence = sequence;
}

function applyNodeCompletion(state: ExecutionRunProjection, sequence: number, payload: Record<string, unknown>): void {
	const node = nodeById(state, String(payload.nodeId));
	if (node.status !== "pending") throw new Error("node may complete only once");
	const status = payload.status as NodeProjection["status"];
	const cause = payload.cause as Record<string, unknown>;
	if (status === "succeeded") {
		const attempt = completedAttempt(state, String(cause.attemptId));
		if (attempt.allocation.nodeId !== node.id || attempt.outcome?.action !== "accept") throw new Error("node success requires its accepted attempt");
		node.causalAttemptId = attempt.allocation.attemptId;
	} else if (status === "failed") {
		const attempt = completedAttempt(state, String(cause.attemptId));
		if (attempt.allocation.nodeId !== node.id || attempt.outcome?.action !== "fail") throw new Error("node failure requires its terminal fail action");
		node.causalAttemptId = attempt.allocation.attemptId;
	} else {
		const upstream = nodeById(state, String(cause.upstreamNodeId));
		if (upstream.id === node.id || (upstream.status !== "failed" && upstream.status !== "skipped")) throw new Error("node skip requires an earlier failed or skipped node");
		node.causalUpstreamNodeId = upstream.id;
	}
	node.status = status;
	node.completionSequence = sequence;
}

function applyFinalValidationStart(state: ExecutionRunProjection, payload: Record<string, unknown>, occurredAt: string): void {
	if (state.mode !== "live" || state.nodes.some((node) => node.status !== "succeeded") || state.attempts.some((attempt) => !attempt.outcome) || state.finalValidation.disposition !== "not-started") throw new Error("final validation requires every live node and allocation to finish exactly once");
	const acceptedTree = state.acceptedLedger.at(-1)?.transition.patch.resultTree ?? state.planningBaseTree;
	if (payload.expectedTree !== acceptedTree) throw new Error("final validation must target the exact accepted state");
	state.finalValidation = { disposition: "running", commandIdentities: payload.commandIdentities as string[], expectedTree: payload.expectedTree as GitTreeId, startedAt: occurredAt };
	state.phase = "final-validation";
}

function applyFinalValidationCompletion(state: ExecutionRunProjection, sequence: number, payload: FinalValidationCompletedPayload): void {
	if (state.finalValidation.disposition !== "running" || payload.expectedTree !== state.finalValidation.expectedTree || payload.beforeTree !== payload.expectedTree) throw new Error("final-validation completion does not match its start state");
	if (payload.commandCount !== state.finalValidation.commandIdentities.length) throw new Error("final-validation aggregate does not match the launched command identities");
	if (payload.status === "passed" && payload.afterTree !== payload.expectedTree) throw new Error("passed final validation must preserve the expected tree");
	state.finalValidation = { disposition: payload.status, completionSequence: sequence, ...payload };
}

function applyRunFinished(state: ExecutionRunProjection, payload: Record<string, unknown>, occurredAt: string): void {
	const outcome = payload.outcome as RunOutcome;
	const cause = payload.cause as RunFinishCause;
	if (state.attempts.some((attempt) => !attempt.outcome)) throw new Error("run-finished requires one terminal outcome for every allocated attempt");
	if (cause.kind === "event" && (cause.eventSequence >= state.lastEventSequence || cause.eventSequence < 1)) throw new Error("run outcome cause must reference an earlier committed event");
	if (cause.kind === "controller" && cause.stage !== state.phase) throw new Error("controller failure stage does not match the current run phase");
	if (outcome === "completed" && (state.mode !== "live" || state.nodes.some((node) => node.status !== "succeeded") || state.finalValidation.disposition !== "passed")) throw new Error("completed requires successful nodes and final validation");
	if (outcome === "dry-run-completed" && (state.mode !== "dry-run" || state.preflight?.status !== "passed" || state.attempts.length || state.finalValidation.disposition !== "not-started")) throw new Error("dry-run-completed requires passed preflight without execution");
	if (outcome === "aborted" && state.confirmation !== "declined" && !state.attempts.some((attempt) => attempt.outcome?.action === "abort")) throw new Error("aborted requires declined confirmation or an aborting attempt");
	const priorFailure = state.preflight?.status === "failed" || state.nodes.some((node) => node.status === "failed" || node.status === "skipped") || state.finalValidation.disposition === "failed";
	const determinedOutcome: RunOutcome | undefined = priorFailure ? "failed"
		: state.mode === "dry-run" && state.preflight?.status === "passed" ? "dry-run-completed"
		: state.confirmation === "declined" || state.attempts.some((attempt) => attempt.outcome?.action === "abort") ? "aborted"
		: state.finalValidation.disposition === "passed" ? "completed"
		: undefined;
	if (determinedOutcome && outcome !== determinedOutcome) throw new Error(`run outcome must preserve the earlier authoritative ${determinedOutcome} fact`);
	if (outcome === "failed" && !priorFailure && cause.kind !== "controller") throw new Error("failed requires a prior typed failure or controller cause");
	if (outcome === "failed" && priorFailure && cause.kind !== "event") throw new Error("failed must cite its earlier domain failure");
	if ((outcome === "completed" || outcome === "dry-run-completed" || outcome === "aborted") && cause.kind !== "event") throw new Error(`${outcome} requires an earlier domain-event cause`);
	if (outcome === "completed" && cause.kind === "event" && (cause.eventSequence !== (state.finalValidation.disposition === "passed" ? state.finalValidation.completionSequence : -1) || cause.code !== "final-validation-passed" || cause.nodeId || cause.attemptId)) throw new Error("completed cause must reference only passed final validation");
	if (outcome === "dry-run-completed" && cause.kind === "event" && (cause.eventSequence !== state.preflight?.eventSequence || cause.code !== "dry-run" || cause.nodeId || cause.attemptId)) throw new Error("dry-run cause must reference only passed preflight");
	if (outcome === "aborted" && cause.kind === "event") {
		if (cause.code !== (state.confirmation === "declined" ? "confirmation-declined" : "user-abort")) throw new Error("aborted cause code is invalid");
		const attempt = cause.attemptId ? state.attempts.find((item) => item.allocation.attemptId === cause.attemptId && item.outcome?.action === "abort") : undefined;
		if (state.confirmation === "declined" ? cause.eventSequence !== state.confirmationEventSequence || cause.nodeId || cause.attemptId : !attempt || cause.eventSequence !== attempt.completionSequence || cause.nodeId !== undefined && cause.nodeId !== attempt.allocation.nodeId) throw new Error("aborted cause does not identify its causal event");
	}
	if (outcome === "failed" && cause.kind === "event") {
		const node = cause.nodeId ? state.nodes.find((item) => item.id === cause.nodeId && (item.status === "failed" || item.status === "skipped")) : undefined;
		const valid = state.preflight?.status === "failed" && cause.eventSequence === state.preflight.eventSequence && cause.code === "preflight-failed" && !cause.nodeId && !cause.attemptId
			|| node?.completionSequence === cause.eventSequence && cause.code === (node.status === "failed" ? "node-failed" : "dependency-failed") && (node.status === "failed" ? cause.attemptId === node.causalAttemptId : !cause.attemptId)
			|| state.finalValidation.disposition === "failed" && state.finalValidation.completionSequence === cause.eventSequence && cause.code === "final-validation-failed" && !cause.nodeId && !cause.attemptId;
		if (!valid) throw new Error("failed cause does not identify its causal event");
	}
	if (state.finalValidation.disposition === "not-started") state.finalValidation = { disposition: "not-run", reason: outcome === "dry-run-completed" ? "dry-run" : outcome === "aborted" ? "aborted" : "upstream-failure" };
	state.terminalOutcome = { outcome, durationMs: payload.durationMs as number, cause };
	state.finishedAt = occurredAt;
	state.phase = "finished";
}

function finalize(state: ExecutionRunProjection): ExecutionRunProjection {
	state.attempts.sort((left, right) => (left.completionSequence ?? Number.MAX_SAFE_INTEGER) - (right.completionSequence ?? Number.MAX_SAFE_INTEGER) || left.allocationSequence - right.allocationSequence);
	state.totals = deriveTotals(state);
	return deepFreeze(state);
}

function deriveTotals(state: ExecutionRunProjection): ExecutionTotals {
	const totals = emptyTotals();
	for (const attempt of state.attempts) {
		totals.attempts++;
		totals.attemptKinds[attempt.allocation.kind]++;
		if (!attempt.outcome) continue;
		totals.actions[attempt.outcome.action]++;
		const metrics = deriveAttemptMetricTotals(attempt.outcome.metrics);
		totals.inputTokens += metrics.inputTokens;
		totals.outputTokens += metrics.outputTokens;
		totals.totalTokens += metrics.totalTokens;
		totals.estimatedCostUsd += metrics.costUsd;
		totals.workerDurationMs += attempt.outcome.metrics.workerDurationMs ?? 0;
		totals.toolDurationMs += metrics.toolDurationMs;
		totals.pollDurationMs += metrics.pollDurationMs;
		totals.pollCount += metrics.pollCount;
	}
	for (const entry of state.acceptedLedger) {
		totals.filesChanged += entry.transition.patch.stats.filesChanged;
		totals.insertions += entry.transition.patch.stats.insertions;
		totals.deletions += entry.transition.patch.stats.deletions;
	}
	if (state.finalValidation.disposition === "passed" || state.finalValidation.disposition === "failed") totals.finalValidationDurationMs = state.finalValidation.durationMs;
	totals.runDurationMs = state.terminalOutcome?.durationMs ?? 0;
	return totals;
}

function emptyTotals(): ExecutionTotals {
	return {
		attempts: 0, attemptKinds: { original: 0, retry: 0, fallback: 0, "validation-repair": 0, "integration-repair": 0 },
		actions: { accept: 0, retry: 0, fallback: 0, "validation-repair": 0, "integration-repair": 0, fail: 0, abort: 0 },
		inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, workerDurationMs: 0, toolDurationMs: 0, pollDurationMs: 0, pollCount: 0,
		filesChanged: 0, insertions: 0, deletions: 0, finalValidationDurationMs: 0, runDurationMs: 0,
	};
}

function emptyBudgets(): AttemptBudgetCounts {
	return { original: 0, retry: 0, fallback: 0, validationRepair: 0, integrationRepair: 0 };
}

function remainingBudgets(counts: AttemptBudgetCounts): AttemptBudgetCounts {
	return Object.fromEntries(Object.entries(BUDGET_LIMITS).map(([name, limit]) => [name, limit - counts[name as keyof AttemptBudgetCounts]])) as unknown as AttemptBudgetCounts;
}

function nodeById(state: ExecutionRunProjection, nodeId: string): NodeProjection {
	const node = state.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`unknown run node: ${nodeId}`);
	return node;
}

function completedAttempt(state: ExecutionRunProjection, attemptId: string): AttemptProjection {
	const attempt = state.attempts.find((candidate) => candidate.allocation.attemptId === attemptId);
	if (!attempt?.outcome) throw new Error(`source attempt is not complete: ${attemptId}`);
	return attempt;
}

function sameAssignment(left: { assignment: AttemptAllocation["assignment"] }, right: { assignment: AttemptAllocation["assignment"] }): boolean {
	return left.assignment.tier === right.assignment.tier && left.assignment.provider === right.assignment.provider && left.assignment.model === right.assignment.model;
}
