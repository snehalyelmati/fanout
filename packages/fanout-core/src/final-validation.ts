import { parseAcceptedStateTransition, parseGitCommitId, parseGitTreeId, type AcceptedStateTransition, type ArtifactIdentity, type GitCommitId, type GitTreeId } from "./artifact-identity.ts";
import { parseValidationCommand, type ValidationCommand } from "./validation-command.ts";
import { FIXED_WORKER_CAPABILITIES, validateWorkContract, type WorkContract } from "./work-contract.ts";

export const FINAL_VALIDATION_EVIDENCE_SCHEMA = "fanout.final-validation-evidence";
export const FINAL_VALIDATION_EVIDENCE_VERSION = 1;
export const FINAL_VALIDATION_TRUST_BOUNDARY = "Validation programs are trusted local code. Fanout checks the planning commit, index relation, tracked files, modes, symlinks, and non-ignored untracked files at sequence boundaries; ignored files, external paths, network, processes, services, inherited environment, and mutate-then-restore effects remain outside containment.";

export type FinalValidationProgramOutcome = "nonzero" | "timeout" | "signal";
export type FinalValidationFailure =
	| { kind: "program"; outcome: FinalValidationProgramOutcome; commandIndex: number }
	| { kind: "hard"; code: "preflight" | "spawn" | "abort" | "malformed-evidence" | "validation-drift" | "active-drift" | "identity" | "controller"; detail: string };

export interface RepositoryBoundaryIdentity {
	headCommit: GitCommitId;
	headTree: GitTreeId;
	indexTree: GitTreeId;
	indexMatchesHead: boolean;
	tree: GitTreeId;
}

export interface FinalValidationCommandEvidence {
	id: string;
	index: number;
	command: ValidationCommand;
	outcome: "passed" | "nonzero" | "spawn" | "signal" | "timeout" | "aborted" | "unexecuted";
	exitCode: number | null;
	signal: string | null;
	timeoutMs: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
}

export interface FinalValidationEvidence {
	schema: typeof FINAL_VALIDATION_EVIDENCE_SCHEMA;
	version: typeof FINAL_VALIDATION_EVIDENCE_VERSION;
	roundId: string;
	status: "passed" | "failed";
	expectedValidationTree: GitTreeId;
	expectedActiveTree: GitTreeId;
	validation: { before: RepositoryBoundaryIdentity; after: RepositoryBoundaryIdentity };
	active: { before: RepositoryBoundaryIdentity; after: RepositoryBoundaryIdentity };
	commands: FinalValidationCommandEvidence[];
	durationMs: number;
	failure?: FinalValidationFailure;
	candidate?: AcceptedStateTransition;
	acceptedRepair?: { transition: AcceptedStateTransition; activeAfterApply: RepositoryBoundaryIdentity };
	trustBoundary: typeof FINAL_VALIDATION_TRUST_BOUNDARY;
}

export interface FinalValidationResult {
	status: "passed" | "failed";
	commandCount: number;
	durationMs: number;
	commands: FinalValidationCommandEvidence[];
	evidence: FinalValidationEvidence;
	evidenceArtifact: ArtifactIdentity;
	repairable: boolean;
}

export function parseFinalValidationEvidence(value: unknown): FinalValidationEvidence {
	const root = exactRecord(value, ["schema", "version", "roundId", "status", "expectedValidationTree", "expectedActiveTree", "validation", "active", "commands", "durationMs", "failure", "candidate", "acceptedRepair", "trustBoundary"], ["failure", "candidate", "acceptedRepair"], "final validation evidence");
	if (root.schema !== FINAL_VALIDATION_EVIDENCE_SCHEMA || root.version !== FINAL_VALIDATION_EVIDENCE_VERSION) throw new TypeError("unsupported final validation evidence generation");
	if (root.status !== "passed" && root.status !== "failed") throw new TypeError("final validation evidence status is invalid");
	const roundId = identity(root.roundId, "roundId");
	const validation = parseBoundaryPair(root.validation, "validation");
	const active = parseBoundaryPair(root.active, "active");
	const boundaries = [validation.before, validation.after, active.before, active.after];
	if (!Array.isArray(root.commands)) throw new TypeError("final validation evidence commands must be an array");
	const commands = root.commands.map(parseFinalCommand);
	if (!commands.length) throw new TypeError("final validation evidence requires the nonempty authoritative command manifest");
	commands.forEach((command, index) => { if (command.index !== index || command.id !== `${roundId}/${index}`) throw new TypeError("final validation evidence command identities must be gapless and round-bound"); });
	const failure = root.failure === undefined ? undefined : parseFinalFailure(root.failure);
	if ((root.status === "failed") !== Boolean(failure)) throw new TypeError("final validation evidence status and failure disagree");
	const firstTerminal = commands.findIndex((command) => command.outcome !== "passed" && command.outcome !== "unexecuted");
	if (!isFailFastManifest(commands)) throw new TypeError("final validation command evidence violates fail-fast order");
	if (failure?.kind === "hard" && failure.code === "spawn" && commands[firstTerminal]?.outcome !== "spawn") throw new TypeError("spawn failure does not match command evidence");
	if (failure?.kind === "hard" && failure.code === "abort" && commands[firstTerminal]?.outcome !== "aborted") throw new TypeError("abort failure does not match command evidence");
	if (failure?.kind === "hard" && ["preflight", "identity", "controller", "malformed-evidence"].includes(failure.code) && commands.some((command) => command.outcome !== "unexecuted")) throw new TypeError(`${failure.code} failure requires a wholly unexecuted command manifest`);
	if (failure?.kind === "program" && (commands[failure.commandIndex]?.outcome !== failure.outcome || commands.slice(0, failure.commandIndex).some((command) => command.outcome !== "passed") || commands.slice(failure.commandIndex + 1).some((command) => command.outcome !== "unexecuted"))) throw new TypeError("final validation program failure does not match fail-fast command evidence");
	if (!failure && commands.some((command) => command.outcome !== "passed")) throw new TypeError("passed final validation evidence requires every command to pass");
	const candidate = root.candidate === undefined ? undefined : parseAcceptedStateTransition(root.candidate);
	const expectedValidationTree = parseGitTreeId(root.expectedValidationTree);
	const expectedActiveTree = parseGitTreeId(root.expectedActiveTree);
	if (candidate ? candidate.patch.headCommit !== boundaries[0].headCommit || candidate.patch.baseTree !== expectedActiveTree || candidate.patch.resultTree !== expectedValidationTree : expectedValidationTree !== expectedActiveTree) throw new TypeError("final validation candidate does not match the round boundary authority");
	const expectedHead = { headCommit: boundaries[0].headCommit, headTree: boundaries[0].headTree };
	const boundaryMatches = {
		validationBefore: matchesExpectedBoundary(validation.before, expectedHead, expectedValidationTree),
		validationAfter: matchesExpectedBoundary(validation.after, expectedHead, expectedValidationTree),
		activeBefore: matchesExpectedBoundary(active.before, expectedHead, expectedActiveTree),
		activeAfter: matchesExpectedBoundary(active.after, expectedHead, expectedActiveTree),
	};
	const allCommandsUnexecuted = commands.every((command) => command.outcome === "unexecuted");
	const preCommandActiveDrift = !boundaryMatches.activeBefore && allCommandsUnexecuted;
	const postCommandActiveDrift = boundaryMatches.activeBefore && boundaryMatches.validationBefore && !allCommandsUnexecuted;
	if (failure?.kind === "hard" && failure.code === "active-drift" && (boundaryMatches.activeAfter || (!preCommandActiveDrift && !postCommandActiveDrift))) throw new TypeError("active-drift failure does not match active boundary evidence");
	if (failure?.kind === "hard" && failure.code === "validation-drift" && (!boundaryMatches.validationBefore || boundaryMatches.validationAfter || !boundaryMatches.activeBefore || !boundaryMatches.activeAfter || allCommandsUnexecuted)) throw new TypeError("validation-drift failure does not match validation boundary evidence");
	if (failure?.kind === "hard" && failure.code === "identity" && (boundaryMatches.validationBefore || !boundaryMatches.activeBefore)) throw new TypeError("identity failure does not match pre-command boundary evidence");
	if (failure?.kind === "hard" && failure.code === "preflight" && (!boundaryMatches.validationBefore || !boundaryMatches.activeBefore)) throw new TypeError("preflight failure does not match pre-command boundary evidence");
	if ((failure?.kind === "program" || failure?.kind === "hard" && ["spawn", "abort", "malformed-evidence"].includes(failure.code)) && Object.values(boundaryMatches).some((matches) => !matches)) throw new TypeError("command failure requires stable expected repository boundaries");
	if ((root.status === "passed" || failure?.kind === "program") && boundaries.some((boundary) => boundary.headCommit !== boundaries[0].headCommit || boundary.headTree !== boundaries[0].headTree)) throw new TypeError("stable final validation boundaries disagree on HEAD authority");
	if (root.status === "passed" && Object.values(boundaryMatches).some((matches) => !matches)) throw new TypeError("passed final validation boundaries do not match the expected trees");
	const acceptedRepair = root.acceptedRepair === undefined ? undefined : parseAcceptedRepair(root.acceptedRepair);
	if (acceptedRepair && (root.status !== "passed" || !candidate || JSON.stringify(acceptedRepair.transition) !== JSON.stringify(candidate) || acceptedRepair.activeAfterApply.headCommit !== candidate.patch.headCommit || acceptedRepair.activeAfterApply.headTree !== boundaries[0].headTree || !acceptedRepair.activeAfterApply.indexMatchesHead || acceptedRepair.activeAfterApply.tree !== candidate.patch.resultTree)) throw new TypeError("accepted final repair does not exactly match the validated candidate and active identity");
	if (root.trustBoundary !== FINAL_VALIDATION_TRUST_BOUNDARY) throw new TypeError("final validation trust boundary is invalid");
	const durationMs = nonNegativeNumber(root.durationMs, "durationMs");
	if (durationMs !== roundMs(commands.reduce((sum, command) => sum + command.durationMs, 0))) throw new TypeError("final validation duration does not equal command evidence");
	return {
		schema: FINAL_VALIDATION_EVIDENCE_SCHEMA,
		version: FINAL_VALIDATION_EVIDENCE_VERSION,
		roundId,
		status: root.status,
		expectedValidationTree,
		expectedActiveTree,
		validation,
		active,
		commands,
		durationMs,
		...(failure ? { failure } : {}),
		...(candidate ? { candidate } : {}),
		...(acceptedRepair ? { acceptedRepair } : {}),
		trustBoundary: FINAL_VALIDATION_TRUST_BOUNDARY,
	};
}

export function classifyFinalValidationFailure(
	commands: readonly FinalValidationCommandEvidence[],
	validationStable: boolean,
	activeStable: boolean,
): FinalValidationFailure | undefined {
	if (!activeStable) return { kind: "hard", code: "active-drift", detail: "active checkout identity changed during final validation" };
	if (!validationStable) return { kind: "hard", code: "validation-drift", detail: "validation checkout did not retain the expected reconstructed identity" };
	const failed = commands.find((command) => command.outcome !== "passed" && command.outcome !== "unexecuted");
	if (!failed) return undefined;
	if (failed.outcome === "nonzero" || failed.outcome === "timeout" || failed.outcome === "signal") return { kind: "program", outcome: failed.outcome, commandIndex: failed.index };
	return { kind: "hard", code: failed.outcome === "spawn" ? "spawn" : failed.outcome === "aborted" ? "abort" : "malformed-evidence", detail: `final validation command ${failed.index} ended as ${failed.outcome}` };
}

export function deriveFinalRepairWorkContract(upstream: readonly WorkContract[], finalValidation: WorkContract): WorkContract {
	const candidate = {
		schema: finalValidation.schema,
		version: finalValidation.version,
		goals: uniqueBy(upstream.flatMap((contract) => contract.goals), (value) => `${value.sourcePlanId}\0${value.statement}`),
		changes: upstream.flatMap((contract) => contract.changes),
		readDependencies: uniqueBy(upstream.flatMap((contract) => contract.readDependencies), (value) => JSON.stringify(value)),
		forbiddenWrites: uniqueBy(upstream.flatMap((contract) => contract.forbiddenWrites), (value) => JSON.stringify(value)),
		validationCommands: finalValidation.validationCommands,
		capabilities: FIXED_WORKER_CAPABILITIES,
		semanticReviewCriteria: uniqueBy(upstream.flatMap((contract) => contract.semanticReviewCriteria), (value) => `${value.sourcePlanId}\0${value.statement}`),
		advisoryNotes: uniqueBy(upstream.flatMap((contract) => contract.advisoryNotes), (value) => JSON.stringify(value)),
	};
	const validation = validateWorkContract(candidate);
	if (!validation.ok || !validation.contract) throw new Error(`cannot derive final-repair authority: ${validation.errors.map((issue) => issue.message).join("; ")}`);
	return validation.contract;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const identity = key(value);
		if (seen.has(identity)) return false;
		seen.add(identity);
		return true;
	});
}

function parseBoundaryPair(value: unknown, path: string): FinalValidationEvidence["validation"] {
	const item = exactRecord(value, ["before", "after"], [], path);
	return { before: parseBoundaryIdentity(item.before, `${path}.before`), after: parseBoundaryIdentity(item.after, `${path}.after`) };
}

function parseBoundaryIdentity(value: unknown, path: string): RepositoryBoundaryIdentity {
	const item = exactRecord(value, ["headCommit", "headTree", "indexTree", "indexMatchesHead", "tree"], [], path);
	if (typeof item.indexMatchesHead !== "boolean") throw new TypeError(`${path}.indexMatchesHead must be boolean`);
	const result = { headCommit: parseGitCommitId(item.headCommit), headTree: parseGitTreeId(item.headTree), indexTree: parseGitTreeId(item.indexTree), indexMatchesHead: item.indexMatchesHead, tree: parseGitTreeId(item.tree) };
	if (result.indexMatchesHead !== (result.indexTree === result.headTree)) throw new TypeError(`${path}.indexMatchesHead contradicts its index and HEAD trees`);
	return result;
}

function matchesExpectedBoundary(identity: RepositoryBoundaryIdentity, expectedHead: Pick<RepositoryBoundaryIdentity, "headCommit" | "headTree">, expectedTree: GitTreeId): boolean {
	return identity.headCommit === expectedHead.headCommit && identity.headTree === expectedHead.headTree && identity.indexMatchesHead && identity.tree === expectedTree;
}

function parseFinalCommand(value: unknown, index: number): FinalValidationCommandEvidence {
	const path = `commands[${index}]`;
	const item = exactRecord(value, ["id", "index", "command", "outcome", "exitCode", "signal", "timeoutMs", "stdout", "stderr", "durationMs"], [], path);
	if (!["passed", "nonzero", "spawn", "signal", "timeout", "aborted", "unexecuted"].includes(String(item.outcome))) throw new TypeError(`${path}.outcome is invalid`);
	const result: FinalValidationCommandEvidence = {
		id: identity(item.id, `${path}.id`),
		index: nonNegativeInteger(item.index, `${path}.index`),
		command: parseValidationCommand(item.command),
		outcome: item.outcome as FinalValidationCommandEvidence["outcome"],
		exitCode: nullableInteger(item.exitCode, `${path}.exitCode`),
		signal: nullableString(item.signal, `${path}.signal`),
		timeoutMs: nullableNumber(item.timeoutMs, `${path}.timeoutMs`),
		stdout: stringValue(item.stdout, `${path}.stdout`),
		stderr: stringValue(item.stderr, `${path}.stderr`),
		durationMs: nonNegativeNumber(item.durationMs, `${path}.durationMs`),
	};
	if (result.outcome === "passed" && (result.exitCode !== 0 || result.signal !== null)) throw new TypeError(`${path} passed process evidence is contradictory`);
	if (result.outcome === "nonzero" && (result.exitCode === null || result.exitCode === 0 || result.signal !== null)) throw new TypeError(`${path} nonzero process evidence is contradictory`);
	if (result.outcome === "spawn" && (result.exitCode !== null || result.signal !== null)) throw new TypeError(`${path} spawn process evidence is contradictory`);
	if (result.outcome === "signal" && (result.exitCode !== null || result.signal === null)) throw new TypeError(`${path} signal process evidence is contradictory`);
	if (result.outcome === "timeout" && (result.exitCode !== null || result.timeoutMs === null)) throw new TypeError(`${path} timeout process evidence is contradictory`);
	if (result.outcome !== "timeout" && result.timeoutMs !== null) throw new TypeError(`${path} non-timeout process evidence cannot carry timeoutMs`);
	if (result.outcome === "aborted" && result.exitCode !== null) throw new TypeError(`${path} aborted process evidence is contradictory`);
	if (result.outcome === "unexecuted" && (result.exitCode !== null || result.signal !== null || result.stdout || result.stderr || result.durationMs !== 0)) throw new TypeError(`${path} unexecuted process evidence is contradictory`);
	return result;
}

function parseFinalFailure(value: unknown): FinalValidationFailure {
	if (record(value) && value.kind === "program") {
		const item = exactRecord(value, ["kind", "outcome", "commandIndex"], [], "failure");
		if (item.outcome !== "nonzero" && item.outcome !== "timeout" && item.outcome !== "signal") throw new TypeError("program failure outcome is invalid");
		return { kind: "program", outcome: item.outcome, commandIndex: nonNegativeInteger(item.commandIndex, "failure.commandIndex") };
	}
	const item = exactRecord(value, ["kind", "code", "detail"], [], "failure");
	if (item.kind !== "hard" || !["preflight", "spawn", "abort", "malformed-evidence", "validation-drift", "active-drift", "identity", "controller"].includes(String(item.code))) throw new TypeError("hard final validation failure is invalid");
	return { kind: "hard", code: item.code as Extract<FinalValidationFailure, { kind: "hard" }>["code"], detail: stringValue(item.detail, "failure.detail") };
}

function parseAcceptedRepair(value: unknown): NonNullable<FinalValidationEvidence["acceptedRepair"]> {
	const item = exactRecord(value, ["transition", "activeAfterApply"], [], "acceptedRepair");
	return { transition: parseAcceptedStateTransition(item.transition), activeAfterApply: parseBoundaryIdentity(item.activeAfterApply, "acceptedRepair.activeAfterApply") };
}

function exactRecord(value: unknown, fields: readonly string[], optional: readonly string[], path: string): Record<string, unknown> {
	if (!record(value)) throw new TypeError(`${path} must be an object`);
	const required = fields.filter((field) => !optional.includes(field));
	const keys = Object.keys(value);
	if (required.some((field) => !Object.hasOwn(value, field)) || keys.some((field) => !fields.includes(field))) throw new TypeError(`${path} has unknown or missing fields`);
	return value;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function identity(value: unknown, path: string): string { if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError(`${path} must be a non-empty identity`); return value; }
function stringValue(value: unknown, path: string): string { if (typeof value !== "string") throw new TypeError(`${path} must be a string`); return value; }
function nonNegativeInteger(value: unknown, path: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${path} must be a non-negative safe integer`); return Number(value); }
function nonNegativeNumber(value: unknown, path: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be a finite non-negative number`); return value; }
function nullableInteger(value: unknown, path: string): number | null { if (value === null) return null; if (!Number.isSafeInteger(value)) throw new TypeError(`${path} must be an integer or null`); return Number(value); }
function nullableString(value: unknown, path: string): string | null { if (value === null) return null; if (typeof value !== "string" || !value) throw new TypeError(`${path} must be a non-empty string or null`); return value; }
function nullableNumber(value: unknown, path: string): number | null { return value === null ? null : nonNegativeNumber(value, path); }
function roundMs(value: number): number { return Math.round(value * 1000) / 1000; }

function isFailFastManifest(commands: readonly FinalValidationCommandEvidence[]): boolean {
	let phase: "running" | "unexecuted" = "running";
	let passed = 0;
	for (const command of commands) {
		if (command.outcome === "passed") {
			if (phase !== "running") return false;
			passed += 1;
		} else if (command.outcome === "unexecuted") {
			if (phase === "running" && passed > 0) return false;
			phase = "unexecuted";
		} else {
			if (phase !== "running") return false;
			phase = "unexecuted";
		}
	}
	return true;
}
