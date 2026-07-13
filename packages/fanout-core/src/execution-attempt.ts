import { isCorrelatedAttemptMetrics, type CorrelatedAttemptMetrics } from "./attempt-metrics.ts";
import { deepFreeze } from "./contract-value.ts";
import { parseAttemptRecoveryContext, type AttemptRecoveryContext } from "./recovery-evidence.ts";

export const ATTEMPT_OUTCOME_SCHEMA = "fanout.attempt-outcome";
export const ATTEMPT_OUTCOME_VERSION = 1;

export type AttemptKind = "original" | "retry" | "fallback" | "validation-repair" | "integration-repair";
export type ControllerAction = "accept" | "retry" | "fallback" | "validation-repair" | "integration-repair" | "fail" | "abort";
export type AttemptBudgetName = "original" | "retry" | "fallback" | "validationRepair" | "integrationRepair";

export interface AttemptAssignment {
	tier: "tier1" | "tier2";
	provider: string;
	model: string;
}

export interface AttemptBudgetCounts {
	original: number;
	retry: number;
	fallback: number;
	validationRepair: number;
	integrationRepair: number;
}

export interface NodeAttemptState {
	nodeId: string;
	nextAttemptNumber: number;
	counts: AttemptBudgetCounts;
	allocations: readonly AttemptAllocation[];
}

export interface BudgetTransition {
	name: AttemptBudgetName;
	before: number;
	after: number;
	limit: number;
}

export interface AttemptAllocation {
	runId: string;
	nodeId: string;
	attemptId: string;
	attemptNumber: number;
	kind: AttemptKind;
	assignment: AttemptAssignment;
	sourceAttemptId?: string;
	budgetTransition: BudgetTransition;
}

export interface AttemptAllocationResult {
	allocation: AttemptAllocation;
	state: NodeAttemptState;
}

export type CompilerFact = { stage: "compiler"; code: "artifact-invalid" | "schema-invalid" | "path-invalid" | "coverage-invalid" | "read-classification-invalid" | "graph-invalid" | "packet-invalid"; artifactPhase: "plan" | "details" | "packet" | "work-contract"; fieldPath: Array<string | number>; sourceIds: string[] };
export type ProcessFact = { stage: "process"; code: "completed" | "spawn-failed" | "timeout" | "signal" | "nonzero" | "infrastructure-failure" | "user-abort"; exitCode?: number; signal?: string; timeoutMs?: number; durationMs: number };
export type ProviderFact = { stage: "provider"; code: "completed" | "rate-limit" | "retryable-service" | "network" | "authentication" | "quota" | "invalid-request" | "invalid-model" | "abort" | "protocol"; httpStatus?: number; networkCode?: string; providerCode?: string };
export type MetricsFact = { stage: "metrics"; code: "complete" | "malformed" | "missing-identity" | "correlation-mismatch" | "duplicate-identity" | "usage-mismatch" | "pricing-mismatch" | "missing-timing" | "missing-poll" | "missing-tool" | "invalid-number" };
export type WorkerGateFact = { stage: "worker-gate"; code: "passed" | "missing-patch" | "malformed-patch" | "mutating-noop" | "worker-commit" | "forbidden-change" | "unauthorized-change" | "post-validation-change" | "capability-violation" };
export type ValidationFact = { stage: "validation"; code: "passed" | "program-failure" | "spawn-failure" | "timeout" | "signal" | "abort" | "malformed-evidence"; failedCommandIndexes?: number[] };
export type ApplyFact = { stage: "apply"; code: "applied" | "check-conflict" | "apply-failure" | "post-tree-mismatch" | "identity-failure" | "state-drift" };
export type BookkeepingFact = { stage: "bookkeeping"; code: "failed-after-mutation" | "publication-failure" };
export type StageFact = CompilerFact | ProcessFact | ProviderFact | MetricsFact | WorkerGateFact | ValidationFact | ApplyFact | BookkeepingFact;

export interface RoutingContext {
	kind: AttemptKind;
	assignment: AttemptAssignment;
	fallbackAllowed: boolean;
	remaining: AttemptBudgetCounts;
}

export interface AttemptOutcome {
	schema: typeof ATTEMPT_OUTCOME_SCHEMA;
	version: typeof ATTEMPT_OUTCOME_VERSION;
	runId: string;
	nodeId: string;
	attemptId: string;
	attemptNumber: number;
	kind: AttemptKind;
	assignment: AttemptAssignment;
	sourceAttemptId?: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	terminalFact: StageFact;
	action: ControllerAction;
	budgetTransition: BudgetTransition;
	metrics: CorrelatedAttemptMetrics;
	recovery?: AttemptRecoveryContext;
	evidenceRefs: string[];
	diagnostic?: string;
}

export interface CompleteAttemptInput {
	startedAt: string;
	finishedAt: string;
	terminalFact: StageFact;
	state: NodeAttemptState;
	fallbackAllowed: boolean;
	metrics: CorrelatedAttemptMetrics;
	recovery?: AttemptRecoveryContext;
	evidenceRefs?: string[];
	diagnostic?: string;
}

const LIMITS: Readonly<AttemptBudgetCounts> = Object.freeze({ original: 1, retry: 1, fallback: 1, validationRepair: 2, integrationRepair: 2 });
const KIND_BUDGET: Readonly<Record<AttemptKind, AttemptBudgetName>> = Object.freeze({ original: "original", retry: "retry", fallback: "fallback", "validation-repair": "validationRepair", "integration-repair": "integrationRepair" });
const issuedStates = new WeakSet<object>();
const issuedAllocations = new WeakSet<object>();
const issuedOutcomes = new WeakSet<object>();
const completedAllocations = new WeakMap<object, AttemptOutcome>();

export function createNodeAttemptState(nodeId: string): NodeAttemptState {
	const state = { nodeId: requiredIdentity(nodeId, "nodeId"), nextAttemptNumber: 1, counts: { original: 0, retry: 0, fallback: 0, validationRepair: 0, integrationRepair: 0 }, allocations: [] };
	deepFreeze(state);
	issuedStates.add(state);
	return state;
}

export function allocateAttempt(state: NodeAttemptState, input: { runId: string; nodeId: string; kind: AttemptKind; assignment: AttemptAssignment; sourceAttemptId?: string; fallbackAllowed?: boolean }): AttemptAllocationResult {
	validateNodeState(state);
	if (input.nodeId !== state.nodeId) throw new Error(`attempt node ${input.nodeId} does not match budget state ${state.nodeId}`);
	const runId = requiredIdentity(input.runId, "runId");
	const nodeId = requiredIdentity(input.nodeId, "nodeId");
	validateAssignment(input.assignment);
	if (!(input.kind in KIND_BUDGET)) throw new TypeError(`unknown attempt kind: ${input.kind}`);
	if (input.kind === "original" && input.sourceAttemptId !== undefined) throw new TypeError("original attempt cannot have a sourceAttemptId");
	if (input.kind !== "original" && !input.sourceAttemptId) throw new TypeError(`${input.kind} attempt requires sourceAttemptId`);
	if (input.sourceAttemptId) validateSourceAttemptId(input.sourceAttemptId, nodeId, state.nextAttemptNumber);
	validateAllocationSequence(state, input);
	const name = KIND_BUDGET[input.kind];
	const before = state.counts[name];
	const limit = LIMITS[name];
	if (before >= limit) throw new Error(`${name} budget exhausted for node ${nodeId}`);
	const attemptNumber = state.nextAttemptNumber;
	const attemptId = `${nodeId}:${String(attemptNumber).padStart(6, "0")}`;
	const transition = { name, before, after: before + 1, limit };
	const nextCounts = { ...state.counts, [name]: transition.after };
	const allocation: AttemptAllocation = {
			runId,
			nodeId,
			attemptId,
			attemptNumber,
			kind: input.kind,
			assignment: { ...input.assignment },
			...(input.sourceAttemptId ? { sourceAttemptId: requiredIdentity(input.sourceAttemptId, "sourceAttemptId") } : {}),
			budgetTransition: transition,
	};
	const nextState = { nodeId, nextAttemptNumber: attemptNumber + 1, counts: nextCounts, allocations: [...state.allocations, allocation] };
	deepFreeze(allocation);
	deepFreeze(nextState);
	issuedAllocations.add(allocation);
	issuedStates.add(nextState);
	return { allocation, state: nextState };
}

export function remainingAttemptBudgets(state: NodeAttemptState): AttemptBudgetCounts {
	validateNodeState(state);
	return Object.fromEntries(Object.entries(LIMITS).map(([name, limit]) => [name, limit - state.counts[name as AttemptBudgetName]])) as unknown as AttemptBudgetCounts;
}

export function routeAttempt(fact: StageFact, context: RoutingContext): ControllerAction {
	parseStageFact(fact);
	validateAssignment(context.assignment);
	validateCounts(context.remaining, "remaining");
	if (fact.stage === "apply" && fact.code === "applied") return "accept";
	if ((fact.stage === "process" && fact.code === "user-abort") || (fact.stage === "provider" && fact.code === "abort") || (fact.stage === "validation" && fact.code === "abort")) return "abort";
	if (fact.stage === "validation" && (fact.code === "program-failure" || fact.code === "timeout" || fact.code === "signal")) return context.remaining.validationRepair > 0 ? "validation-repair" : "fail";
	if (fact.stage === "apply" && (fact.code === "check-conflict" || fact.code === "apply-failure")) return context.remaining.integrationRepair > 0 ? "integration-repair" : "fail";
	if (isTransient(fact)) return transientAction(context);
	return "fail";
}

export function completeAttempt(allocation: AttemptAllocation, input: CompleteAttemptInput): AttemptOutcome {
	if (!issuedAllocations.has(allocation)) throw new Error("attempt allocation was not issued by this controller");
	if (completedAllocations.has(allocation)) throw new Error(`attempt ${allocation.attemptId} already has a terminal outcome`);
	validateAllocation(allocation);
	validateNodeState(input.state);
	if (input.state.allocations.at(-1) !== allocation) throw new Error("attempt must complete against its current node allocation state");
	const terminalFact = parseStageFact(input.terminalFact);
	const startedAt = timestamp(input.startedAt, "startedAt");
	const finishedAt = timestamp(input.finishedAt, "finishedAt");
	const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
	if (durationMs < 0) throw new Error("finishedAt cannot precede startedAt");
	const action = routeAttempt(terminalFact, { kind: allocation.kind, assignment: allocation.assignment, fallbackAllowed: input.fallbackAllowed, remaining: remainingAttemptBudgets(input.state) });
	if (input.metrics.attemptId !== allocation.attemptId) throw new Error(`metrics attempt ${input.metrics.attemptId} does not match allocation ${allocation.attemptId}`);
	if (!isCorrelatedAttemptMetrics(input.metrics)) throw new Error("attempt metrics were not produced by the correlation gate");
	if (input.metrics.turns.some((turn) => turn.provider !== allocation.assignment.provider || turn.model !== allocation.assignment.model || turn.tier !== allocation.assignment.tier)) throw new Error("metric turn assignment does not match attempt allocation");
	if (action === "accept" && !input.metrics.complete) throw new Error("accepted attempt requires complete correlated metrics");
	const recovery = input.recovery ? parseAttemptRecoveryContext(input.recovery) : undefined;
	const validationFailure = terminalFact.stage === "validation" && action === "validation-repair";
	const integrationFailure = terminalFact.stage === "apply" && action === "integration-repair";
	const postTreeFailure = terminalFact.stage === "apply" && terminalFact.code === "post-tree-mismatch" && action === "fail";
	if (validationFailure && (recovery?.kind !== "validation" || recovery.sourceAttemptId !== allocation.attemptId)) throw new Error("validation repair action requires correlated typed validation recovery evidence");
	if ((integrationFailure || postTreeFailure) && (recovery?.kind !== "integration" || recovery.sourceAttemptId !== allocation.attemptId)) throw new Error("apply outcome requires correlated typed integration evidence");
	if (!validationFailure && !integrationFailure && !postTreeFailure && recovery) throw new Error("recovery evidence does not match the terminal stage fact");
	if (terminalFact.stage === "validation" && recovery?.kind === "validation") {
		const failed = recovery.commands.filter((command) => command.status !== "passed" && command.status !== "unexecuted").map((command) => command.index);
		if (JSON.stringify(terminalFact.failedCommandIndexes ?? []) !== JSON.stringify(failed)) throw new Error("validation fact indexes do not match recovery command evidence");
	}
	if (terminalFact.stage === "apply" && recovery?.kind === "integration") {
		const expectedStage = terminalFact.code === "check-conflict" ? "check" : terminalFact.code === "apply-failure" ? "apply" : terminalFact.code === "post-tree-mismatch" ? "post-tree" : undefined;
		if (recovery.applyFailure.stage !== expectedStage) throw new Error("apply fact does not match integration recovery evidence");
	}
	const evidenceRefs = input.evidenceRefs ?? [];
	if (!Array.isArray(evidenceRefs) || evidenceRefs.some((reference) => typeof reference !== "string" || !reference || reference !== reference.trim())) throw new TypeError("evidenceRefs must contain non-empty identities");
	const outcome: AttemptOutcome = {
		schema: ATTEMPT_OUTCOME_SCHEMA,
		version: ATTEMPT_OUTCOME_VERSION,
		runId: allocation.runId,
		nodeId: allocation.nodeId,
		attemptId: allocation.attemptId,
		attemptNumber: allocation.attemptNumber,
		kind: allocation.kind,
		assignment: { ...allocation.assignment },
		...(allocation.sourceAttemptId ? { sourceAttemptId: allocation.sourceAttemptId } : {}),
		startedAt,
		finishedAt,
		durationMs,
		terminalFact,
		action,
		budgetTransition: { ...allocation.budgetTransition },
		metrics: structuredClone(input.metrics),
		...(recovery ? { recovery } : {}),
		evidenceRefs: [...evidenceRefs],
		...(input.diagnostic === undefined ? {} : { diagnostic: String(input.diagnostic) }),
	};
	deepFreeze(outcome);
	issuedOutcomes.add(outcome);
	completedAllocations.set(allocation, outcome);
	return outcome;
}

export function appendTerminalOutcome(outcomes: readonly AttemptOutcome[], outcome: AttemptOutcome): AttemptOutcome[] {
	if (!issuedOutcomes.has(outcome)) throw new Error("terminal outcome was not issued by this controller");
	if (outcomes.some((existing) => existing.attemptId === outcome.attemptId)) throw new Error(`attempt ${outcome.attemptId} already has a terminal outcome`);
	return [...outcomes, structuredClone(outcome)];
}

export function parseStageFact(value: unknown): StageFact {
	if (!record(value) || typeof value.stage !== "string" || typeof value.code !== "string") throw new TypeError("stage fact requires stage and code");
	const allowed: Record<StageFact["stage"], readonly string[]> = {
		compiler: ["artifact-invalid", "schema-invalid", "path-invalid", "coverage-invalid", "read-classification-invalid", "graph-invalid", "packet-invalid"],
		process: ["completed", "spawn-failed", "timeout", "signal", "nonzero", "infrastructure-failure", "user-abort"],
		provider: ["completed", "rate-limit", "retryable-service", "network", "authentication", "quota", "invalid-request", "invalid-model", "abort", "protocol"],
		metrics: ["complete", "malformed", "missing-identity", "correlation-mismatch", "duplicate-identity", "usage-mismatch", "pricing-mismatch", "missing-timing", "missing-poll", "missing-tool", "invalid-number"],
		"worker-gate": ["passed", "missing-patch", "malformed-patch", "mutating-noop", "worker-commit", "forbidden-change", "unauthorized-change", "post-validation-change", "capability-violation"],
		validation: ["passed", "program-failure", "spawn-failure", "timeout", "signal", "abort", "malformed-evidence"],
		apply: ["applied", "check-conflict", "apply-failure", "post-tree-mismatch", "identity-failure", "state-drift"],
		bookkeeping: ["failed-after-mutation", "publication-failure"],
	};
	if (!(value.stage in allowed) || !allowed[value.stage as StageFact["stage"]].includes(value.code)) throw new TypeError(`unknown ${value.stage} stage fact: ${value.code}`);
	const fields: Record<StageFact["stage"], Set<string>> = {
		compiler: new Set(["stage", "code", "artifactPhase", "fieldPath", "sourceIds"]),
		process: new Set(["stage", "code", "exitCode", "signal", "timeoutMs", "durationMs"]),
		provider: new Set(["stage", "code", "httpStatus", "networkCode", "providerCode"]),
		metrics: new Set(["stage", "code"]),
		"worker-gate": new Set(["stage", "code"]),
		validation: new Set(["stage", "code", "failedCommandIndexes"]),
		apply: new Set(["stage", "code"]),
		bookkeeping: new Set(["stage", "code"]),
	};
	for (const key of Object.keys(value)) if (!fields[value.stage as StageFact["stage"]].has(key)) throw new TypeError(`unknown ${value.stage} stage fact field: ${key}`);
	if (value.stage === "compiler") {
		if (!["plan", "details", "packet", "work-contract"].includes(String(value.artifactPhase))) throw new TypeError("compiler artifactPhase is invalid");
		if (!Array.isArray(value.fieldPath) || value.fieldPath.some((part) => (typeof part !== "string" || !part) && (!Number.isSafeInteger(part) || Number(part) < 0))) throw new TypeError("compiler fieldPath must contain non-empty field names or non-negative indexes");
		if (!Array.isArray(value.sourceIds) || value.sourceIds.some((sourceId) => typeof sourceId !== "string" || !sourceId || sourceId !== sourceId.trim()) || new Set(value.sourceIds).size !== value.sourceIds.length) throw new TypeError("compiler sourceIds must contain unique identities");
	}
	if (value.stage === "process") {
		finiteNonNegative(value.durationMs, "process durationMs");
		if (value.exitCode !== undefined && !Number.isSafeInteger(value.exitCode)) throw new TypeError("process exitCode must be an integer");
		if (value.timeoutMs !== undefined) finiteNonNegative(value.timeoutMs, "process timeoutMs");
		if (value.signal !== undefined && (typeof value.signal !== "string" || !value.signal)) throw new TypeError("process signal must be a non-empty string");
		if (value.code === "timeout" && value.timeoutMs === undefined) throw new TypeError("process timeout fact requires timeoutMs");
		if (value.code === "signal" && value.signal === undefined) throw new TypeError("process signal fact requires signal");
		if (value.code === "nonzero" && (!Number.isSafeInteger(value.exitCode) || Number(value.exitCode) === 0)) throw new TypeError("process nonzero fact requires a nonzero exitCode");
	}
	if (value.stage === "provider") {
		if (value.httpStatus !== undefined && (!Number.isSafeInteger(value.httpStatus) || Number(value.httpStatus) < 100 || Number(value.httpStatus) > 599)) throw new TypeError("provider httpStatus must be an HTTP status integer");
		for (const field of ["networkCode", "providerCode"] as const) if (value[field] !== undefined && (typeof value[field] !== "string" || !value[field])) throw new TypeError(`provider ${field} must be a non-empty string`);
	}
	if (value.stage === "validation" && value.failedCommandIndexes !== undefined) {
		if (!Array.isArray(value.failedCommandIndexes) || value.failedCommandIndexes.some((index) => !Number.isSafeInteger(index) || Number(index) < 0)) throw new TypeError("validation failedCommandIndexes must be non-negative integers");
		if (new Set(value.failedCommandIndexes).size !== value.failedCommandIndexes.length || value.failedCommandIndexes.some((index, position) => position > 0 && Number(index) <= Number(value.failedCommandIndexes?.[position - 1]))) throw new TypeError("validation failedCommandIndexes must be unique and ordered");
	}
	return structuredClone(value) as StageFact;
}

function transientAction(context: RoutingContext): ControllerAction {
	if (context.kind === "validation-repair") return context.remaining.validationRepair > 0 ? "validation-repair" : "fail";
	if (context.kind === "integration-repair") return context.remaining.integrationRepair > 0 ? "integration-repair" : "fail";
	if ((context.kind === "original" || context.kind === "retry") && context.remaining.retry > 0) return "retry";
	if ((context.kind === "original" || context.kind === "retry") && context.assignment.tier === "tier2" && context.fallbackAllowed && context.remaining.fallback > 0) return "fallback";
	return "fail";
}

function isTransient(fact: StageFact): boolean {
	return (fact.stage === "process" && ["spawn-failed", "timeout", "signal", "infrastructure-failure"].includes(fact.code))
		|| (fact.stage === "provider" && ["rate-limit", "retryable-service", "network"].includes(fact.code));
}

function validateNodeState(state: NodeAttemptState): void {
	if (!issuedStates.has(state)) throw new Error("node attempt state was not issued by this controller");
	requiredIdentity(state.nodeId, "state.nodeId");
	if (!Number.isSafeInteger(state.nextAttemptNumber) || state.nextAttemptNumber < 1) throw new TypeError("nextAttemptNumber must be a positive safe integer");
	validateCounts(state.counts, "counts");
	for (const name of Object.keys(LIMITS) as AttemptBudgetName[]) if (state.counts[name] > LIMITS[name]) throw new Error(`${name} budget exceeds fixed limit`);
	const allocations = Object.values(state.counts).reduce((sum, count) => sum + count, 0);
	if (state.nextAttemptNumber !== allocations + 1) throw new Error("nextAttemptNumber must follow allocated launches without gaps or resets");
	if (!Array.isArray(state.allocations) || state.allocations.length !== allocations) throw new Error("attempt allocation history does not match fixed counters");
	for (const [index, allocation] of state.allocations.entries()) {
		validateAllocation(allocation);
		if (allocation.nodeId !== state.nodeId || allocation.attemptNumber !== index + 1 || allocation.attemptId !== `${state.nodeId}:${String(index + 1).padStart(6, "0")}`) throw new Error("attempt allocation history is not gapless and node-monotonic");
	}
}

function validateCounts(counts: AttemptBudgetCounts, path: string): void {
	if (!record(counts) || Object.keys(counts).length !== Object.keys(LIMITS).length || Object.keys(LIMITS).some((name) => !Object.hasOwn(counts, name))) throw new TypeError(`${path} must contain exactly the fixed attempt budget counters`);
	for (const name of Object.keys(LIMITS) as AttemptBudgetName[]) if (!Number.isSafeInteger(counts[name]) || counts[name] < 0) throw new TypeError(`${path}.${name} must be a non-negative safe integer`);
}

function validateAssignment(value: AttemptAssignment): void {
	if (!record(value) || Object.keys(value).length !== 3 || !["tier", "provider", "model"].every((field) => Object.hasOwn(value, field)) || !["tier1", "tier2"].includes(String(value.tier))) throw new TypeError("assignment must contain only tier, provider, and model with a valid tier");
	requiredIdentity(value.provider, "assignment.provider");
	requiredIdentity(value.model, "assignment.model");
}

function validateAllocation(value: AttemptAllocation): void {
	requiredIdentity(value.runId, "allocation.runId");
	requiredIdentity(value.nodeId, "allocation.nodeId");
	requiredIdentity(value.attemptId, "allocation.attemptId");
	if (!Number.isSafeInteger(value.attemptNumber) || value.attemptNumber < 1) throw new TypeError("allocation attemptNumber must be positive");
	validateAssignment(value.assignment);
	if (value.budgetTransition.name !== KIND_BUDGET[value.kind] || !Number.isSafeInteger(value.budgetTransition.before) || value.budgetTransition.before < 0 || value.budgetTransition.after !== value.budgetTransition.before + 1 || value.budgetTransition.after > value.budgetTransition.limit || value.budgetTransition.limit !== LIMITS[value.budgetTransition.name]) throw new Error("invalid allocation budget transition");
}

function validateAllocationSequence(state: NodeAttemptState, input: { kind: AttemptKind; assignment: AttemptAssignment; sourceAttemptId?: string; fallbackAllowed?: boolean }): void {
	const source = state.allocations.find((allocation) => allocation.attemptId === input.sourceAttemptId);
	const sourceOutcome = source ? completedAllocations.get(source) : undefined;
	if (input.kind !== "original" && !source) throw new Error("sourceAttemptId does not identify an allocated launch");
	if (input.kind !== "original" && !sourceOutcome) throw new Error("source attempt must have one terminal outcome before another launch is allocated");
	if (input.kind === "retry" && (source?.kind !== "original" || sourceOutcome?.action !== "retry" || !sameAssignment(source.assignment, input.assignment))) throw new Error("retry must follow its original outcome and retain the assignment");
	if (input.kind === "fallback" && (source?.kind !== "retry" || sourceOutcome?.action !== "fallback" || source.assignment.tier !== "tier2" || input.assignment.tier !== "tier1" || input.fallbackAllowed !== true || state.counts.retry !== LIMITS.retry)) throw new Error("fallback requires exhausted retryable Tier 2 work and explicit permission");
	if (input.kind === "validation-repair" && (sourceOutcome?.action !== "validation-repair" || input.assignment.tier !== "tier1")) throw new Error("validation repair must follow its source outcome and use Tier 1");
	if (input.kind === "integration-repair" && (sourceOutcome?.action !== "integration-repair" || input.assignment.tier !== "tier1")) throw new Error("integration repair must follow its source outcome and use Tier 1");
}

function sameAssignment(left: AttemptAssignment, right: AttemptAssignment): boolean {
	return left.tier === right.tier && left.provider === right.provider && left.model === right.model;
}

function timestamp(value: string, path: string): string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError(`${path} must be an ISO timestamp`);
	return value;
}

function requiredIdentity(value: unknown, path: string): string {
	if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError(`${path} must be a non-empty identity`);
	return value;
}

function validateSourceAttemptId(value: string, nodeId: string, nextAttemptNumber: number): void {
	const prefix = `${nodeId}:`;
	const number = value.startsWith(prefix) && /^\d{6}$/.test(value.slice(prefix.length)) ? Number(value.slice(prefix.length)) : 0;
	if (number < 1 || number >= nextAttemptNumber) throw new TypeError("sourceAttemptId must identify an earlier allocated attempt for the same node");
}

function finiteNonNegative(value: unknown, path: string): void {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be a finite non-negative number`);
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
