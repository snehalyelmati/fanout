import { parseAcceptedPatch, parseArtifactIdentity, parseGitTreeId, verifyArtifactBytes, type AcceptedPatch, type ArtifactIdentity, type GitTreeId } from "./artifact-identity.ts";
import { deriveFinalRepairWorkContract, parseFinalValidationEvidence, type FinalValidationEvidence } from "./final-validation.ts";
import { parseValidationCommand, type ValidationCommand } from "./validation-command.ts";
import { validateWorkContract, type WorkContract } from "./work-contract.ts";

export interface ValidationCommandEvidence {
	index: number;
	command: ValidationCommand;
	status: "passed" | "nonzero" | "spawn-failure" | "timeout" | "signal" | "unexecuted";
	exitCode: number | null;
	signal: string | null;
	timeoutMs: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
}

export interface ValidationRecoveryContext {
	kind: "validation";
	sourceAttemptId: string;
	workContract: WorkContract;
	commands: ValidationCommandEvidence[];
	rejectedPatch: AcceptedPatch;
	reconstructedTree: GitTreeId;
}

export interface ApplyFailureEvidence {
	stage: "check" | "apply" | "post-tree";
	code: "nonzero" | "spawn-failure" | "timeout" | "signal" | "tree-mismatch";
	exitCode: number | null;
	signal: string | null;
	timeoutMs: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
}

export interface AcceptedLedgerProvenance {
	sourceAttemptId: string;
	patch: AcceptedPatch;
}

export interface IntegrationRecoveryContext {
	kind: "integration";
	sourceAttemptId: string;
	workContract: WorkContract;
	applyFailure: ApplyFailureEvidence;
	rejectedPatch: AcceptedPatch;
	acceptedLedger: AcceptedLedgerProvenance[];
	reconstructedTree: GitTreeId;
}

export interface FinalValidationRecoveryContext {
	kind: "final-validation";
	packetIdentity: ArtifactIdentity;
	sourceFinalValidationEvidence: ArtifactIdentity;
	failedRound: FinalValidationEvidence;
	workContract: WorkContract;
	finalValidationContract: WorkContract;
	upstreamWorkContracts: Array<{ nodeId: string; workContract: WorkContract }>;
	commands: ValidationCommandEvidence[];
	acceptedLedger: AcceptedLedgerProvenance[];
	reconstructedTree: GitTreeId;
}

export type AttemptRecoveryContext = ValidationRecoveryContext | IntegrationRecoveryContext | FinalValidationRecoveryContext;

export function assertFinalValidationRecoverySource(recovery: FinalValidationRecoveryContext, sourceValue: unknown): void {
	const source = parseArtifactIdentity(sourceValue);
	if (JSON.stringify(recovery.sourceFinalValidationEvidence) !== JSON.stringify(source)) throw new Error("final validation repair launch source does not match its recovery evidence identity");
}

const VALIDATION_FIELDS = ["kind", "sourceAttemptId", "workContract", "commands", "rejectedPatch", "reconstructedTree"];
const INTEGRATION_FIELDS = ["kind", "sourceAttemptId", "workContract", "applyFailure", "rejectedPatch", "acceptedLedger", "reconstructedTree"];
const FINAL_VALIDATION_FIELDS = ["kind", "packetIdentity", "sourceFinalValidationEvidence", "failedRound", "workContract", "finalValidationContract", "upstreamWorkContracts", "commands", "acceptedLedger", "reconstructedTree"];
const COMMAND_FIELDS = ["index", "command", "status", "exitCode", "signal", "timeoutMs", "stdout", "stderr", "durationMs"];
const APPLY_FIELDS = ["stage", "code", "exitCode", "signal", "timeoutMs", "stdout", "stderr", "durationMs"];

export function parseAttemptRecoveryContext(value: unknown): AttemptRecoveryContext {
	const kind = record(value)?.kind;
	const root = exactRecord(value, kind === "validation" ? VALIDATION_FIELDS : kind === "final-validation" ? FINAL_VALIDATION_FIELDS : INTEGRATION_FIELDS, "recovery context");
	const validation = validateWorkContract(root.workContract);
	if (!validation.ok || !validation.contract) throw new TypeError(`invalid recovery work contract: ${validation.errors.map((error) => error.message).join("; ")}`);
	if (root.kind === "final-validation") {
		const packetIdentity = parseArtifactIdentity(root.packetIdentity);
		const finalContractValidation = validateWorkContract(root.finalValidationContract, { finalValidation: true });
		if (!finalContractValidation.ok || !finalContractValidation.contract) throw new TypeError(`invalid final-validation command contract: ${finalContractValidation.errors.map((error) => error.message).join("; ")}`);
		const upstreamWorkContracts = parseUpstreamWorkContracts(root.upstreamWorkContracts);
		if (JSON.stringify(deriveFinalRepairWorkContract(upstreamWorkContracts.map((entry) => entry.workContract), finalContractValidation.contract)) !== JSON.stringify(validation.contract)) throw new TypeError("final-validation effective repair contract does not match its ordered upstream contracts and original command contract");
		if (!Array.isArray(root.commands) || !root.commands.length) throw new TypeError("final-validation recovery requires ordered command evidence");
		const commands = root.commands.map(parseCommandEvidence);
		requireContractCommands(validation.contract, commands, "final-validation");
		if (!commands.some((command) => command.status !== "passed" && command.status !== "unexecuted")) throw new TypeError("final-validation recovery requires a failed command");
		const acceptedLedger = parseLedger(root.acceptedLedger);
		const reconstructedTree = parseGitTreeId(root.reconstructedTree);
		if (acceptedLedger.length && acceptedLedger.at(-1)?.patch.resultTree !== reconstructedTree) throw new TypeError("final-validation reconstructed tree must match acceptedLedger state");
		const failedRound = parseFinalValidationEvidence(root.failedRound);
		const sourceFinalValidationEvidence = verifyArtifactBytes(root.sourceFinalValidationEvidence, new TextEncoder().encode(`${JSON.stringify(failedRound, null, 2)}\n`));
		if (failedRound.status !== "failed" || failedRound.failure?.kind !== "program") throw new TypeError("final-validation recovery requires a repairable failed round");
		if (failedRound.expectedActiveTree !== reconstructedTree) throw new TypeError("final-validation failed round active tree must match reconstructed accepted state");
		if (failedRound.candidate ? failedRound.candidate.patch.baseTree !== reconstructedTree || failedRound.candidate.patch.resultTree !== failedRound.expectedValidationTree : failedRound.expectedValidationTree !== reconstructedTree) throw new TypeError("final-validation failed round candidate identity is inconsistent");
		const expectedHead = acceptedLedger[0]?.patch.headCommit ?? failedRound.candidate?.patch.headCommit ?? failedRound.validation.before.headCommit;
		if (acceptedLedger.some((entry) => entry.patch.headCommit !== expectedHead) || failedRound.candidate && failedRound.candidate.patch.headCommit !== expectedHead) throw new TypeError("final-validation recovery HEAD authority is inconsistent");
		const boundaries = [failedRound.validation.before, failedRound.validation.after, failedRound.active.before, failedRound.active.after];
		if (boundaries.some((identity, index) => identity.headCommit !== expectedHead || !identity.indexMatchesHead || identity.tree !== (index < 2 ? failedRound.expectedValidationTree : failedRound.expectedActiveTree))) throw new TypeError("final-validation failed round boundary identities do not match expected trees");
		const failedIndexes = commands.filter((command) => command.status !== "passed" && command.status !== "unexecuted").map((command) => command.index);
		if (failedIndexes.length !== 1 || failedIndexes[0] !== failedRound.failure.commandIndex) throw new TypeError("final-validation failed round does not match command recovery evidence");
		if (commands.length !== failedRound.commands.length || commands.some((command, index) => {
			const round = failedRound.commands[index];
			const status = round.outcome === "spawn" ? "spawn-failure" : round.outcome === "aborted" ? "signal" : round.outcome;
			const signal = round.outcome === "timeout" ? null : round.signal;
			return command.index !== round.index || JSON.stringify(command.command) !== JSON.stringify(round.command) || command.status !== status || command.exitCode !== round.exitCode || command.signal !== signal || command.timeoutMs !== round.timeoutMs || command.stdout !== round.stdout || command.stderr !== round.stderr || command.durationMs !== round.durationMs;
		})) throw new TypeError("final-validation failed round command evidence diverges from recovery evidence");
		return { kind: "final-validation", packetIdentity, sourceFinalValidationEvidence, failedRound, workContract: validation.contract, finalValidationContract: finalContractValidation.contract, upstreamWorkContracts, commands, acceptedLedger, reconstructedTree };
	}
	const sourceAttemptId = identity(root.sourceAttemptId, "sourceAttemptId");
	const rejectedPatch = parseAcceptedPatch(root.rejectedPatch);
	const reconstructedTree = parseGitTreeId(root.reconstructedTree);
	if (root.kind === "validation") {
		if (!Array.isArray(root.commands) || !root.commands.length) throw new TypeError("validation recovery requires ordered command evidence");
		const commands = root.commands.map(parseCommandEvidence);
		requireContractCommands(validation.contract, commands, "validation");
		let failed = false;
		for (const [index, command] of commands.entries()) {
			if (command.index !== index) throw new TypeError("validation command evidence indexes must be ordered and gapless");
			if (!failed && command.status === "unexecuted") throw new TypeError("validation command cannot be unexecuted before the first failure");
			if (failed && command.status !== "unexecuted") throw new TypeError("commands after the first validation failure must be unexecuted");
			if (command.status !== "passed" && command.status !== "unexecuted") failed = true;
		}
		if (!failed) throw new TypeError("validation recovery requires a failed command");
		if (rejectedPatch.resultTree !== reconstructedTree) throw new TypeError("validation recovery tree must match the rejected candidate result tree");
		return { kind: "validation", sourceAttemptId, workContract: validation.contract, commands, rejectedPatch, reconstructedTree };
	}
	if (root.kind !== "integration") throw new TypeError("recovery kind must be validation or integration");
	const acceptedLedger = parseLedger(root.acceptedLedger);
	if (acceptedLedger.length && acceptedLedger.at(-1)?.patch.resultTree !== reconstructedTree) throw new TypeError("integration reconstructed tree must match acceptedLedger state");
	const acceptedStates = acceptedLedger.length ? [acceptedLedger[0].patch.baseTree, ...acceptedLedger.map((entry) => entry.patch.resultTree)] : [reconstructedTree];
	if (!acceptedStates.includes(rejectedPatch.baseTree)) throw new TypeError("integration rejected patch base must be an exact prior accepted state");
	return { kind: "integration", sourceAttemptId, workContract: validation.contract, applyFailure: parseApplyFailure(root.applyFailure), rejectedPatch, acceptedLedger, reconstructedTree };
}

function parseLedger(value: unknown): AcceptedLedgerProvenance[] {
	if (!Array.isArray(value)) throw new TypeError("acceptedLedger must be an array");
	const ledger = value.map((entry, index) => {
		const item = exactRecord(entry, ["sourceAttemptId", "patch"], `acceptedLedger[${index}]`);
		return { sourceAttemptId: identity(item.sourceAttemptId, `acceptedLedger[${index}].sourceAttemptId`), patch: parseAcceptedPatch(item.patch) };
	});
	if (new Set(ledger.map((entry) => entry.sourceAttemptId)).size !== ledger.length) throw new TypeError("acceptedLedger source attempts must be unique");
	for (let index = 1; index < ledger.length; index++) if (ledger[index - 1].patch.resultTree !== ledger[index].patch.baseTree) throw new TypeError("acceptedLedger tree chain diverges");
	return ledger;
}

function requireContractCommands(contract: WorkContract, commands: readonly ValidationCommandEvidence[], kind: string): void {
	if (JSON.stringify(commands.map((command) => command.command)) !== JSON.stringify(contract.validationCommands)) throw new TypeError(`${kind} recovery command evidence does not match its canonical work contract`);
}

function parseUpstreamWorkContracts(value: unknown): Array<{ nodeId: string; workContract: WorkContract }> {
	if (!Array.isArray(value) || !value.length) throw new TypeError("final-validation recovery requires ordered upstream work contracts");
	const result = value.map((entry, index) => {
		const item = exactRecord(entry, ["nodeId", "workContract"], `upstreamWorkContracts[${index}]`);
		const validation = validateWorkContract(item.workContract);
		if (!validation.ok || !validation.contract) throw new TypeError(`invalid upstream work contract ${index}: ${validation.errors.map((error) => error.message).join("; ")}`);
		return { nodeId: identity(item.nodeId, `upstreamWorkContracts[${index}].nodeId`), workContract: validation.contract };
	});
	if (new Set(result.map((entry) => entry.nodeId)).size !== result.length) throw new TypeError("upstream work contract node identities must be unique");
	return result;
}

function parseCommandEvidence(value: unknown, index: number): ValidationCommandEvidence {
	const path = `commands[${index}]`;
	const item = exactRecord(value, COMMAND_FIELDS, path);
	const status = item.status;
	if (!["passed", "nonzero", "spawn-failure", "timeout", "signal", "unexecuted"].includes(String(status))) throw new TypeError(`${path}.status is invalid`);
	const result: ValidationCommandEvidence = {
		index: nonNegativeInteger(item.index, `${path}.index`),
		command: parseValidationCommand(item.command),
		status: status as ValidationCommandEvidence["status"],
		exitCode: nullableInteger(item.exitCode, `${path}.exitCode`),
		signal: nullableString(item.signal, `${path}.signal`),
		timeoutMs: nullableNumber(item.timeoutMs, `${path}.timeoutMs`),
		stdout: requiredString(item.stdout, `${path}.stdout`),
		stderr: requiredString(item.stderr, `${path}.stderr`),
		durationMs: nonNegativeNumber(item.durationMs, `${path}.durationMs`),
	};
	if (result.status === "passed" && result.exitCode !== 0) throw new TypeError(`${path} passed evidence requires exitCode 0`);
	validateProcessShape(result.status, result, path);
	if (result.status === "unexecuted" && (result.exitCode !== null || result.signal !== null || result.timeoutMs !== null || result.stdout || result.stderr || result.durationMs !== 0)) throw new TypeError(`${path} unexecuted evidence cannot contain process observations`);
	return result;
}

function parseApplyFailure(value: unknown): ApplyFailureEvidence {
	const item = exactRecord(value, APPLY_FIELDS, "applyFailure");
	if (item.stage !== "check" && item.stage !== "apply" && item.stage !== "post-tree") throw new TypeError("applyFailure.stage must be check, apply, or post-tree");
	if (!["nonzero", "spawn-failure", "timeout", "signal", "tree-mismatch"].includes(String(item.code))) throw new TypeError("applyFailure.code is invalid");
	const result: ApplyFailureEvidence = {
		stage: item.stage,
		code: item.code as ApplyFailureEvidence["code"],
		exitCode: nullableInteger(item.exitCode, "applyFailure.exitCode"),
		signal: nullableString(item.signal, "applyFailure.signal"),
		timeoutMs: nullableNumber(item.timeoutMs, "applyFailure.timeoutMs"),
		stdout: requiredString(item.stdout, "applyFailure.stdout"),
		stderr: requiredString(item.stderr, "applyFailure.stderr"),
		durationMs: nonNegativeNumber(item.durationMs, "applyFailure.durationMs"),
	};
	validateProcessShape(result.code, result, "applyFailure");
	if ((result.stage === "post-tree") !== (result.code === "tree-mismatch")) throw new TypeError("post-tree failure requires tree-mismatch code and vice versa");
	return result;
}

function exactRecord(value: unknown, fields: readonly string[], path: string): Record<string, unknown> {
	if (!record(value)) throw new TypeError(`${path} must be an object`);
	const keys = Object.keys(value);
	if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) throw new TypeError(`${path} has unknown or missing fields`);
	return value;
}

function record(value: unknown): Record<string, unknown> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function identity(value: unknown, path: string): string { if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError(`${path} must be a non-empty identity`); return value; }
function requiredString(value: unknown, path: string): string { if (typeof value !== "string") throw new TypeError(`${path} must be a string`); return value; }
function nonNegativeInteger(value: unknown, path: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${path} must be a non-negative safe integer`); return Number(value); }
function nullableInteger(value: unknown, path: string): number | null { if (value === null) return null; if (!Number.isSafeInteger(value)) throw new TypeError(`${path} must be an integer or null`); return Number(value); }
function nullableString(value: unknown, path: string): string | null { if (value === null) return null; if (typeof value !== "string" || !value) throw new TypeError(`${path} must be a non-empty string or null`); return value; }
function nonNegativeNumber(value: unknown, path: string): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be a finite non-negative number`); return value; }
function nullableNumber(value: unknown, path: string): number | null { return value === null ? null : nonNegativeNumber(value, path); }

function validateProcessShape(kind: string, value: { exitCode: number | null; signal: string | null; timeoutMs: number | null }, path: string): void {
	if (kind === "passed" && (value.exitCode !== 0 || value.signal !== null || value.timeoutMs !== null)) throw new TypeError(`${path} passed evidence is contradictory`);
	if (kind === "nonzero" && (value.exitCode === null || value.exitCode === 0 || value.signal !== null || value.timeoutMs !== null)) throw new TypeError(`${path} nonzero evidence is contradictory`);
	if (kind === "spawn-failure" && (value.exitCode !== null || value.signal !== null || value.timeoutMs !== null)) throw new TypeError(`${path} spawn-failure evidence is contradictory`);
	if (kind === "timeout" && (value.exitCode !== null || value.signal !== null || value.timeoutMs === null)) throw new TypeError(`${path} timeout evidence is contradictory`);
	if (kind === "signal" && (value.exitCode !== null || value.signal === null || value.timeoutMs !== null)) throw new TypeError(`${path} signal evidence is contradictory`);
	if ((kind === "unexecuted" || kind === "tree-mismatch") && (value.exitCode !== null || value.signal !== null || value.timeoutMs !== null)) throw new TypeError(`${path} ${kind} evidence is contradictory`);
}
