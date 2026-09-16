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
import { FIXED_WORKER_CAPABILITIES } from "./work-contract.ts";
import { FINAL_VALIDATION_NODE_ID } from "./work-contract-graph.ts";

export const EXECUTION_EVENT_SCHEMA = "fanout.execution-event";
export const EXECUTION_EVENT_VERSION = 6;
export const EXECUTION_EVENT_NAMES = ["run-started", "preflight-completed", "confirmation-decided", "attempt-allocated", "attempt-completed", "node-completed", "final-validation-started", "final-validation-completed", "run-finished"] as const;

export type ExecutionEventName = (typeof EXECUTION_EVENT_NAMES)[number];
export type RunMode = "live" | "dry-run";
export type RunOutcome = "completed" | "dry-run-completed" | "failed" | "aborted";
export type ExecutionPhase = "preflight" | "confirmation" | "attempts" | "final-validation" | "finished";
export type PreflightIssueCode = "planning-base-mismatch" | "repository-tree-mismatch" | "platform-mismatch" | "executable-unavailable" | "artifact-invalid" | "capability-unavailable" | "controller-failure";
export type RunEventCauseCode = "preflight-failed" | "confirmation-declined" | "node-failed" | "dependency-failed" | "final-validation-failed" | "dry-run" | "final-validation-passed" | "user-abort";
export type ControllerRunStage = Exclude<ExecutionPhase, "finished"> | "cleanup";

export interface RunPolicy {
	maxConcurrency: number;
	failFast: boolean;
	fallbackAllowed: boolean;
}

export interface PreflightComparison {
	expected: string;
	actual: string | null;
	status: "matched" | "mismatched" | "unavailable";
}

export interface PreflightCommandEvidence {
	packetNodeIndex: number;
	nodeId: string;
	commandIndex: number;
	manifest: { executable: string; args: string[]; cwd: string | null };
	resolution: { status: "available" | "unavailable"; resolvedExecutable: string | null; resolvedCwd: string | null };
}

export interface PreflightEvidence {
	planningCommit: PreflightComparison;
	repositoryTree: PreflightComparison;
	platform: PreflightComparison;
	worker: {
		extension: { requested: string; resolved: string | null; status: "available" | "unavailable" };
		launcher: { executable: string; args: string[]; resolvedExecutable: string | null; resolvedCwd: string | null; version: string | null; status: "available" | "unavailable" };
		modelCallableTools: string[];
	};
	commandCounts: { candidateNormalization: number[]; validation: number[] };
	candidateNormalizationCommands: PreflightCommandEvidence[];
	validationCommands: PreflightCommandEvidence[];
}

export interface RunStartedPayload {
	mode: RunMode;
	packet: ArtifactIdentity;
	profile: ArtifactIdentity;
	profileValidation: ArtifactIdentity;
	planningBaseTree: GitTreeId;
	nodeIds: string[];
	policy: RunPolicy;
	preflightEvidence: PreflightEvidence;
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

export interface FinalValidationRoundSummary {
	status: "passed" | "failed";
	commandCount: number;
	durationMs: number;
	evidence: ArtifactIdentity;
	expectedTree: GitTreeId;
	beforeTree: GitTreeId;
	afterTree: GitTreeId;
}

export type FinalControllerFailure =
	| { kind: "round" }
	| { kind: "attempt"; attemptId: string }
	| { kind: "controller"; code: "publication-failure" | "internal-failure"; detail: string };

export interface FinalValidationCompletedPayload {
	status: "passed" | "failed";
	lastRound: FinalValidationRoundSummary | null;
	totalCommandDurationMs: number | null;
	failure?: FinalControllerFailure;
}

export type RunFinishCause =
	| { kind: "event"; eventSequence: number; code: RunEventCauseCode; nodeId?: string; attemptId?: string }
	| { kind: "controller"; stage: ControllerRunStage; code: "internal-failure" | "publication-failure"; detail: string };

export interface RunFinishedPayload {
	outcome: RunOutcome;
	durationMs: number;
	cleanupDurationMs: number;
	cause: RunFinishCause;
}

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
		const item = exactRecord(value, ["mode", "packet", "profile", "profileValidation", "planningBaseTree", "nodeIds", "policy", "preflightEvidence"], [], name);
		if (item.mode !== "live" && item.mode !== "dry-run") throw new TypeError("run mode must be live or dry-run");
		const policy = exactRecord(item.policy, ["maxConcurrency", "failFast", "fallbackAllowed"], [], "run policy");
		const nodeIds = identities(item.nodeIds, "nodeIds");
		if (!nodeIds.length) throw new TypeError("run-started requires packet-ordered nodes");
		const planningBaseTree = parseGitTreeId(item.planningBaseTree);
		const preflightEvidence = parsePreflightEvidence(item.preflightEvidence);
		if (preflightEvidence.repositoryTree.expected !== planningBaseTree) throw new TypeError("preflight repository-tree expectation must match the run planning base");
		assertPacketOrderedCommandNodes(preflightEvidence, nodeIds);
		return { mode: item.mode, packet: parseArtifactIdentity(item.packet), profile: parseArtifactIdentity(item.profile), profileValidation: parseArtifactIdentity(item.profileValidation), planningBaseTree, nodeIds, policy: { maxConcurrency: positiveInteger(policy.maxConcurrency, "maxConcurrency"), failFast: boolean(policy.failFast, "failFast"), fallbackAllowed: boolean(policy.fallbackAllowed, "fallbackAllowed") }, preflightEvidence };
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
		if (item.status === "skipped" && record(item.cause) && item.cause.policy === "fail-fast") {
			const cause = exactRecord(item.cause, ["policy", "triggerNodeId", "triggerAttemptId"], [], "fail-fast cause");
			return { nodeId: identity(item.nodeId, "nodeId"), status: "skipped", cause: { policy: "fail-fast", triggerNodeId: identity(cause.triggerNodeId, "triggerNodeId"), triggerAttemptId: identity(cause.triggerAttemptId, "triggerAttemptId") } };
		}
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
		const item = exactRecord(value, ["status", "lastRound", "totalCommandDurationMs", "failure"], ["failure"], name);
		if (item.status !== "passed" && item.status !== "failed") throw new TypeError("final-validation status is invalid");
		let lastRound: FinalValidationRoundSummary | null = null;
		if (item.lastRound !== null) {
			const round = exactRecord(item.lastRound, ["status", "commandCount", "durationMs", "evidence", "expectedTree", "beforeTree", "afterTree"], [], "lastRound");
			if (round.status !== "passed" && round.status !== "failed") throw new TypeError("last round status is invalid");
			lastRound = { status: round.status, commandCount: positiveInteger(round.commandCount, "commandCount"), durationMs: nonNegativeNumber(round.durationMs, "durationMs"), evidence: parseArtifactIdentity(round.evidence), expectedTree: parseGitTreeId(round.expectedTree), beforeTree: parseGitTreeId(round.beforeTree), afterTree: parseGitTreeId(round.afterTree) };
			if (lastRound.status === "passed" && (lastRound.beforeTree !== lastRound.expectedTree || lastRound.afterTree !== lastRound.expectedTree)) throw new TypeError("passing final round must preserve its expected tree");
		}
		const totalCommandDurationMs = item.totalCommandDurationMs === null ? null : nonNegativeNumber(item.totalCommandDurationMs, "totalCommandDurationMs");
		if (lastRound && totalCommandDurationMs !== null && totalCommandDurationMs < lastRound.durationMs) throw new TypeError("all-round duration is shorter than the last round");
		let failure: FinalControllerFailure | undefined;
		if (item.failure !== undefined) {
			const raw = record(item.failure) ? item.failure : {};
			if (raw.kind === "round") { exactRecord(raw, ["kind"], [], "failure"); failure = { kind: "round" }; }
			else if (raw.kind === "attempt") { exactRecord(raw, ["kind", "attemptId"], [], "failure"); failure = { kind: "attempt", attemptId: identity(raw.attemptId, "attemptId") }; }
			else {
				const controller = exactRecord(raw, ["kind", "code", "detail"], [], "failure");
				if (controller.kind !== "controller" || !["publication-failure", "internal-failure"].includes(String(controller.code))) throw new TypeError("final controller failure is invalid");
				failure = { kind: "controller", code: controller.code as "publication-failure" | "internal-failure", detail: string(controller.detail, "failure.detail") };
			}
		}
		if ((item.status === "failed") !== Boolean(failure)) throw new TypeError("final status and failure disagree");
		if (item.status === "passed" && (lastRound?.status !== "passed" || totalCommandDurationMs === null)) throw new TypeError("successful final controller requires a passing round and known total");
		if (!lastRound && failure?.kind !== "controller" || failure?.kind === "round" && lastRound?.status !== "failed") throw new TypeError("final failure does not match its last round");
		return { status: item.status, lastRound, totalCommandDurationMs, ...(failure ? { failure } : {}) };
	}
	const item = exactRecord(value, ["outcome", "durationMs", "cleanupDurationMs", "cause"], [], name);
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
		if (parsed.kind !== "controller" || !["preflight", "confirmation", "attempts", "final-validation", "cleanup"].includes(String(parsed.stage)) || !["internal-failure", "publication-failure"].includes(String(parsed.code))) throw new TypeError("controller run finish cause is invalid");
		cause = { kind: "controller", stage: parsed.stage as ControllerRunStage, code: parsed.code as "internal-failure" | "publication-failure", detail: string(parsed.detail, "cause.detail") };
	}
	return { outcome: item.outcome, durationMs: nonNegativeNumber(item.durationMs, "durationMs"), cleanupDurationMs: nonNegativeNumber(item.cleanupDurationMs, "cleanupDurationMs"), cause };
}

function parsePreflightEvidence(value: unknown): PreflightEvidence {
	const item = exactRecord(value, ["planningCommit", "repositoryTree", "platform", "worker", "commandCounts", "candidateNormalizationCommands", "validationCommands"], [], "preflightEvidence");
	const worker = exactRecord(item.worker, ["extension", "launcher", "modelCallableTools"], [], "preflightEvidence.worker");
	const commandCounts = exactRecord(item.commandCounts, ["candidateNormalization", "validation"], [], "preflightEvidence.commandCounts");
	const extension = exactRecord(worker.extension, ["requested", "resolved", "status"], [], "preflightEvidence.worker.extension");
	if (extension.status !== "available" && extension.status !== "unavailable") throw new TypeError("preflight extension status is invalid");
	const resolvedExtension = nullableIdentity(extension.resolved, "preflightEvidence.worker.extension.resolved");
	if ((extension.status === "available") !== (resolvedExtension !== null)) throw new TypeError("preflight extension status contradicts its resolution");
	const launcher = exactRecord(worker.launcher, ["executable", "args", "resolvedExecutable", "resolvedCwd", "version", "status"], [], "preflightEvidence.worker.launcher");
	if (launcher.status !== "available" && launcher.status !== "unavailable") throw new TypeError("preflight launcher status is invalid");
	const resolvedExecutable = nullableIdentity(launcher.resolvedExecutable, "preflightEvidence.worker.launcher.resolvedExecutable");
	const resolvedCwd = nullableIdentity(launcher.resolvedCwd, "preflightEvidence.worker.launcher.resolvedCwd");
	const version = nullableIdentity(launcher.version, "preflightEvidence.worker.launcher.version");
	if ((resolvedExecutable === null) !== (resolvedCwd === null)) throw new TypeError("preflight launcher resolution must keep executable and cwd paired");
	if (launcher.status === "available" && (resolvedExecutable === null || resolvedCwd === null || version === null)) throw new TypeError("available preflight launcher requires complete resolution evidence");
	if (launcher.status === "unavailable" && version !== null) throw new TypeError("unavailable preflight launcher cannot report a successful version");
	const tools = identities(worker.modelCallableTools, "preflightEvidence.worker.modelCallableTools");
	if (JSON.stringify(tools) !== JSON.stringify(FIXED_WORKER_CAPABILITIES.modelCallableTools)) throw new TypeError("preflight worker tools do not match the fixed capability profile");
	const candidateNormalizationCommands = parseCommandEvidence(item.candidateNormalizationCommands, "preflightEvidence.candidateNormalizationCommands");
	const validationCommands = parseCommandEvidence(item.validationCommands, "preflightEvidence.validationCommands");
	assertConsistentCommandNodes(candidateNormalizationCommands, validationCommands);
	return {
		planningCommit: parseComparison(item.planningCommit, "preflightEvidence.planningCommit", parseGitTreeId),
		repositoryTree: parseComparison(item.repositoryTree, "preflightEvidence.repositoryTree", parseGitTreeId),
		platform: parseComparison(item.platform, "preflightEvidence.platform", identity),
		worker: {
			extension: { requested: identity(extension.requested, "preflightEvidence.worker.extension.requested"), resolved: resolvedExtension, status: extension.status },
			launcher: { executable: identity(launcher.executable, "preflightEvidence.worker.launcher.executable"), args: strings(launcher.args, "preflightEvidence.worker.launcher.args"), resolvedExecutable, resolvedCwd, version, status: launcher.status },
			modelCallableTools: tools,
		},
		commandCounts: {
			candidateNormalization: nonNegativeIntegers(commandCounts.candidateNormalization, "preflightEvidence.commandCounts.candidateNormalization"),
			validation: nonNegativeIntegers(commandCounts.validation, "preflightEvidence.commandCounts.validation"),
		},
		candidateNormalizationCommands,
		validationCommands,
	};
}

function parseComparison(value: unknown, path: string, parse: (value: unknown, path: string) => string): PreflightComparison {
	const item = exactRecord(value, ["expected", "actual", "status"], [], path);
	const expected = parse(item.expected, `${path}.expected`);
	const actual = item.actual === null ? null : parse(item.actual, `${path}.actual`);
	const status = item.status;
	if (status !== "matched" && status !== "mismatched" && status !== "unavailable") throw new TypeError(`${path}.status is invalid`);
	if ((status === "matched") !== (actual === expected) || (status === "unavailable") !== (actual === null)) throw new TypeError(`${path}.status contradicts its values`);
	return { expected, actual, status };
}

function parseCommandEvidence(value: unknown, path: string): PreflightCommandEvidence[] {
	if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
	let previousNode = -1;
	let previousCommand = -1;
	const nodeIds = new Map<number, string>();
	return value.map((entry, index) => {
		const item = exactRecord(entry, ["packetNodeIndex", "nodeId", "commandIndex", "manifest", "resolution"], [], `${path}[${index}]`);
		const packetNodeIndex = nonNegativeInteger(item.packetNodeIndex, `${path}[${index}].packetNodeIndex`);
		const commandIndex = nonNegativeInteger(item.commandIndex, `${path}[${index}].commandIndex`);
		if (packetNodeIndex < previousNode || packetNodeIndex === previousNode && commandIndex !== previousCommand + 1 || packetNodeIndex > previousNode && commandIndex !== 0) throw new TypeError(`${path} must preserve packet and command order`);
		previousNode = packetNodeIndex;
		previousCommand = commandIndex;
		const manifest = exactRecord(item.manifest, ["executable", "args", "cwd"], [], `${path}[${index}].manifest`);
		const resolution = exactRecord(item.resolution, ["status", "resolvedExecutable", "resolvedCwd"], [], `${path}[${index}].resolution`);
		if (resolution.status !== "available" && resolution.status !== "unavailable") throw new TypeError(`${path}[${index}].resolution.status is invalid`);
		const commandExecutable = identity(manifest.executable, `${path}[${index}].manifest.executable`);
		const args = strings(manifest.args, `${path}[${index}].manifest.args`);
		const cwd = manifest.cwd === null ? null : identity(manifest.cwd, `${path}[${index}].manifest.cwd`);
		const resolvedCommand = nullableIdentity(resolution.resolvedExecutable, `${path}[${index}].resolution.resolvedExecutable`);
		const resolvedCommandCwd = nullableIdentity(resolution.resolvedCwd, `${path}[${index}].resolution.resolvedCwd`);
		if ((resolution.status === "available") !== (resolvedCommand !== null && resolvedCommandCwd !== null)) throw new TypeError(`${path}[${index}].resolution status contradicts its values`);
		if (resolution.status === "unavailable" && (resolvedCommand !== null || resolvedCommandCwd !== null)) throw new TypeError(`${path}[${index}].unavailable resolution must not retain partial command authority`);
		const nodeId = identity(item.nodeId, `${path}[${index}].nodeId`);
		const existingNodeId = nodeIds.get(packetNodeIndex);
		if (existingNodeId !== undefined && existingNodeId !== nodeId) throw new TypeError(`${path} assigns multiple node IDs to packet node ${packetNodeIndex}`);
		nodeIds.set(packetNodeIndex, nodeId);
		return { packetNodeIndex, nodeId, commandIndex, manifest: { executable: commandExecutable, args, cwd }, resolution: { status: resolution.status, resolvedExecutable: resolvedCommand, resolvedCwd: resolvedCommandCwd } };
	});
}

function assertConsistentCommandNodes(...groups: PreflightCommandEvidence[][]): void {
	const nodeIds = new Map<number, string>();
	for (const entry of groups.flat()) {
		const existingNodeId = nodeIds.get(entry.packetNodeIndex);
		if (existingNodeId !== undefined && existingNodeId !== entry.nodeId) throw new TypeError(`preflight command evidence contradicts packet node ${entry.packetNodeIndex}`);
		nodeIds.set(entry.packetNodeIndex, entry.nodeId);
	}
}

function assertPacketOrderedCommandNodes(evidence: PreflightEvidence, nodeIds: string[]): void {
	const packetNodeIds = [...nodeIds, FINAL_VALIDATION_NODE_ID];
	for (const entry of [...evidence.candidateNormalizationCommands, ...evidence.validationCommands]) {
		const expectedNodeId = packetNodeIds[entry.packetNodeIndex];
		if (entry.nodeId !== expectedNodeId) throw new TypeError(`preflight command evidence does not match packet node ${entry.packetNodeIndex}`);
	}
	assertCommandCoverage(evidence.candidateNormalizationCommands, evidence.commandCounts.candidateNormalization, packetNodeIds.length, "candidate normalization");
	assertCommandCoverage(evidence.validationCommands, evidence.commandCounts.validation, packetNodeIds.length, "validation", true);
}

function assertCommandCoverage(commands: PreflightCommandEvidence[], expected: number[], packetNodeCount: number, label: string, requireFinal = false): void {
	if (expected.length !== packetNodeCount) throw new TypeError(`preflight ${label} command counts must cover every packet node`);
	if (requireFinal && expected[packetNodeCount - 1] === 0) throw new TypeError("preflight validation evidence must cover the required final-validation command");
	const actual = Array<number>(packetNodeCount).fill(0);
	for (const command of commands) actual[command.packetNodeIndex]++;
	if (actual.some((count, index) => count !== expected[index])) throw new TypeError(`preflight ${label} command evidence is incomplete`);
}

function nullableIdentity(value: unknown, path: string): string | null {
	return value === null ? null : identity(value, path);
}

function strings(value: unknown, path: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
	return value.map((item, index) => string(item, `${path}[${index}]`));
}

function nonNegativeIntegers(value: unknown, path: string): number[] {
	if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
	return value.map((item, index) => nonNegativeInteger(item, `${path}[${index}]`));
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
