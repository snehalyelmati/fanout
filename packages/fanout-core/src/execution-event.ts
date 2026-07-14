import { parseAcceptedStateTransition, parseArtifactIdentity, parseGitTreeId, type AcceptedStateTransition, type ArtifactIdentity, type GitTreeId } from "./artifact-identity.ts";
import {
	canonicalTimestamp as timestamp,
	contractIdentity as identity,
	contractRecord as record,
	contractString as string,
	exactContractRecord as exactRecord,
	nonNegativeFiniteNumber as nonNegativeNumber,
	nonNegativeSafeInteger as nonNegativeInteger,
	positiveSafeInteger as positiveInteger,
} from "./contract-value.ts";
import { parseAttemptAllocation, parseAttemptOutcome, type AttemptOutcome } from "./execution-attempt.ts";

export const EXECUTION_EVENT_SCHEMA = "fanout.execution-event";
export const EXECUTION_EVENT_VERSION = 2;
export const EXECUTION_EVENT_NAMES = ["run-started", "preflight-completed", "confirmation-decided", "attempt-allocated", "attempt-completed", "node-completed", "final-validation-started", "final-validation-completed", "run-finished"] as const;

export type ExecutionEventName = (typeof EXECUTION_EVENT_NAMES)[number];
export type RunMode = "live" | "dry-run";
export type RunOutcome = "completed" | "dry-run-completed" | "failed" | "aborted";
export type ExecutionPhase = "preflight" | "confirmation" | "attempts" | "final-validation" | "finished";
export type PreflightIssueCode = "planning-base-mismatch" | "repository-tree-mismatch" | "platform-mismatch" | "executable-unavailable" | "artifact-invalid" | "capability-unavailable" | "controller-failure";
export type RunEventCauseCode = "preflight-failed" | "confirmation-declined" | "node-failed" | "dependency-failed" | "final-validation-failed" | "dry-run" | "final-validation-passed" | "user-abort";
export type ControllerRunStage = Exclude<ExecutionPhase, "finished">;

export interface RunPolicy {
	maxConcurrency: number;
	failFast: boolean;
	fallbackAllowed: boolean;
}

export interface RunStartedPayload {
	mode: RunMode;
	packet: ArtifactIdentity;
	planningBaseTree: GitTreeId;
	nodeIds: string[];
	policy: RunPolicy;
}

export interface PreflightIssue {
	code: PreflightIssueCode;
	detail: string;
}

export interface PreflightCompletedPayload {
	status: "passed" | "failed";
	planningBaseTree: GitTreeId;
	repositoryTree: GitTreeId;
	issues: PreflightIssue[];
}

export interface AttemptCompletedPayload {
	outcome: AttemptOutcome;
	acceptedTransition?: AcceptedStateTransition;
}

export interface FinalValidationCompletedPayload {
	status: "passed" | "failed";
	commandCount: number;
	durationMs: number;
	evidence: ArtifactIdentity;
	expectedTree: GitTreeId;
	beforeTree: GitTreeId;
	afterTree: GitTreeId;
}

export type RunFinishCause =
	| { kind: "event"; eventSequence: number; code: RunEventCauseCode; nodeId?: string; attemptId?: string }
	| { kind: "controller"; stage: ControllerRunStage; code: "internal-failure" | "publication-failure"; detail: string };

export interface ExecutionEvent {
	schema: typeof EXECUTION_EVENT_SCHEMA;
	version: typeof EXECUTION_EVENT_VERSION;
	runId: string;
	sequence: number;
	occurredAt: string;
	event: ExecutionEventName;
	payload: Record<string, unknown>;
}

const EVENT_NAMES = new Set<string>(EXECUTION_EVENT_NAMES);
const PREFLIGHT_ISSUE_CODES = new Set<PreflightIssueCode>(["planning-base-mismatch", "repository-tree-mismatch", "platform-mismatch", "executable-unavailable", "artifact-invalid", "capability-unavailable", "controller-failure"]);
const RUN_EVENT_CAUSE_CODES = new Set<RunEventCauseCode>(["preflight-failed", "confirmation-declined", "node-failed", "dependency-failed", "final-validation-failed", "dry-run", "final-validation-passed", "user-abort"]);

export function parseExecutionEvent(value: unknown): ExecutionEvent {
	const event = exactRecord(value, ["schema", "version", "runId", "sequence", "occurredAt", "event", "payload"], [], "execution event");
	if (event.schema !== EXECUTION_EVENT_SCHEMA || event.version !== EXECUTION_EVENT_VERSION) throw new TypeError("execution event schema/version is unsupported");
	const name = identity(event.event, "event") as ExecutionEventName;
	if (!EVENT_NAMES.has(name)) throw new TypeError(`unknown execution event: ${name}`);
	return { schema: EXECUTION_EVENT_SCHEMA, version: EXECUTION_EVENT_VERSION, runId: identity(event.runId, "runId"), sequence: positiveInteger(event.sequence, "sequence"), occurredAt: timestamp(event.occurredAt, "occurredAt"), event: name, payload: parsePayload(name, event.payload) };
}

function parsePayload(name: ExecutionEventName, value: unknown): Record<string, unknown> {
	if (name === "run-started") {
		const item = exactRecord(value, ["mode", "packet", "planningBaseTree", "nodeIds", "policy"], [], name);
		if (item.mode !== "live" && item.mode !== "dry-run") throw new TypeError("run mode must be live or dry-run");
		const policy = exactRecord(item.policy, ["maxConcurrency", "failFast", "fallbackAllowed"], [], "run policy");
		const nodeIds = identities(item.nodeIds, "nodeIds");
		if (!nodeIds.length) throw new TypeError("run-started requires packet-ordered nodes");
		return { mode: item.mode, packet: parseArtifactIdentity(item.packet), planningBaseTree: parseGitTreeId(item.planningBaseTree), nodeIds, policy: { maxConcurrency: positiveInteger(policy.maxConcurrency, "maxConcurrency"), failFast: boolean(policy.failFast, "failFast"), fallbackAllowed: boolean(policy.fallbackAllowed, "fallbackAllowed") } };
	}
	if (name === "preflight-completed") {
		const item = exactRecord(value, ["status", "planningBaseTree", "repositoryTree", "issues"], [], name);
		if (item.status !== "passed" && item.status !== "failed") throw new TypeError("preflight status must be passed or failed");
		if (!Array.isArray(item.issues)) throw new TypeError("preflight issues must be an array");
		const issues = item.issues.map((issue, index) => {
			const parsed = exactRecord(issue, ["code", "detail"], [], `issues[${index}]`);
			const code = identity(parsed.code, `issues[${index}].code`) as PreflightIssueCode;
			if (!PREFLIGHT_ISSUE_CODES.has(code)) throw new TypeError(`issues[${index}].code is invalid`);
			return { code, detail: string(parsed.detail, `issues[${index}].detail`) };
		});
		if ((item.status === "passed") !== (issues.length === 0)) throw new TypeError("passed preflight has no issues and failed preflight has at least one");
		return { status: item.status, planningBaseTree: parseGitTreeId(item.planningBaseTree), repositoryTree: parseGitTreeId(item.repositoryTree), issues };
	}
	if (name === "confirmation-decided") {
		const item = exactRecord(value, ["decision"], [], name);
		if (item.decision !== "accepted" && item.decision !== "declined") throw new TypeError("confirmation decision is invalid");
		return { decision: item.decision };
	}
	if (name === "attempt-allocated") return { allocation: parseAttemptAllocation(exactRecord(value, ["allocation"], [], name).allocation) };
	if (name === "attempt-completed") {
		const item = exactRecord(value, ["outcome", "acceptedTransition"], ["acceptedTransition"], name);
		return { outcome: parseAttemptOutcome(item.outcome), ...(item.acceptedTransition === undefined ? {} : { acceptedTransition: parseAcceptedStateTransition(item.acceptedTransition) }) };
	}
	if (name === "node-completed") {
		const item = exactRecord(value, ["nodeId", "status", "cause"], [], name);
		if (!["succeeded", "failed", "skipped"].includes(String(item.status))) throw new TypeError("node completion status is invalid");
		const cause = exactRecord(item.cause, item.status === "skipped" ? ["upstreamNodeId"] : ["attemptId"], [], "node cause");
		return { nodeId: identity(item.nodeId, "nodeId"), status: item.status, cause: item.status === "skipped" ? { upstreamNodeId: identity(cause.upstreamNodeId, "upstreamNodeId") } : { attemptId: identity(cause.attemptId, "attemptId") } };
	}
	if (name === "final-validation-started") {
		const item = exactRecord(value, ["commandIdentities", "expectedTree"], [], name);
		const commandIdentities = orderedIdentities(item.commandIdentities, "commandIdentities");
		if (!commandIdentities.length) throw new TypeError("final validation requires command identities");
		return { commandIdentities, expectedTree: parseGitTreeId(item.expectedTree) };
	}
	if (name === "final-validation-completed") {
		const item = exactRecord(value, ["status", "commandCount", "durationMs", "evidence", "expectedTree", "beforeTree", "afterTree"], [], name);
		if (item.status !== "passed" && item.status !== "failed") throw new TypeError("final-validation status is invalid");
		return { status: item.status, commandCount: nonNegativeInteger(item.commandCount, "commandCount"), durationMs: nonNegativeNumber(item.durationMs, "durationMs"), evidence: parseArtifactIdentity(item.evidence), expectedTree: parseGitTreeId(item.expectedTree), beforeTree: parseGitTreeId(item.beforeTree), afterTree: parseGitTreeId(item.afterTree) };
	}
	const item = exactRecord(value, ["outcome", "durationMs", "cause"], [], name);
	if (!["completed", "dry-run-completed", "failed", "aborted"].includes(String(item.outcome))) throw new TypeError("run outcome is invalid");
	const causeValue = record(item.cause) ? item.cause : {};
	let cause: RunFinishCause;
	if (causeValue.kind === "event") {
		const parsed = exactRecord(item.cause, ["kind", "eventSequence", "code", "nodeId", "attemptId"], ["nodeId", "attemptId"], "run finish cause");
		const code = identity(parsed.code, "cause.code") as RunEventCauseCode;
		if (!RUN_EVENT_CAUSE_CODES.has(code)) throw new TypeError("run finish event cause code is invalid");
		cause = { kind: "event", eventSequence: positiveInteger(parsed.eventSequence, "cause.eventSequence"), code, ...(parsed.nodeId === undefined ? {} : { nodeId: identity(parsed.nodeId, "cause.nodeId") }), ...(parsed.attemptId === undefined ? {} : { attemptId: identity(parsed.attemptId, "cause.attemptId") }) };
	} else {
		const parsed = exactRecord(item.cause, ["kind", "stage", "code", "detail"], [], "run finish cause");
		if (parsed.kind !== "controller" || !["preflight", "confirmation", "attempts", "final-validation"].includes(String(parsed.stage)) || !["internal-failure", "publication-failure"].includes(String(parsed.code))) throw new TypeError("controller run finish cause is invalid");
		cause = { kind: "controller", stage: parsed.stage as ControllerRunStage, code: parsed.code as "internal-failure" | "publication-failure", detail: string(parsed.detail, "cause.detail") };
	}
	return { outcome: item.outcome, durationMs: nonNegativeNumber(item.durationMs, "durationMs"), cause };
}

function identities(value: unknown, path: string): string[] {
	const result = orderedIdentities(value, path);
	if (new Set(result).size !== result.length) throw new TypeError(`${path} must not contain duplicates`);
	return result;
}

function orderedIdentities(value: unknown, path: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
	return value.map((item, index) => identity(item, `${path}[${index}]`));
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
	return value;
}

export { reduceExecutionEvent, replayExecutionEvents } from "./execution-projection.ts";
export type { ExecutionRunProjection } from "./execution-projection.ts";
