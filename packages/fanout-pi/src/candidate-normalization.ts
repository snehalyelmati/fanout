import type { ValidationCommand } from "../../fanout-core/src/validation-command.ts";
import { captureRepositoryState, type RepositoryStateIdentity } from "./repository-identity.ts";
import { runValidationCommands, type ValidationCommandOutcome } from "./validation-runner.ts";

export const CANDIDATE_NORMALIZATION_EVIDENCE_SCHEMA = "fanout.candidate-normalization-evidence";
export const CANDIDATE_NORMALIZATION_EVIDENCE_VERSION = 1;

export type CandidateNormalizationFailure = {
	code: "preflight-failure" | "spawn-failure" | "timeout" | "signal" | "head-drift" | "index-drift" | "identity-failure" | "user-abort";
	commandIndex?: number;
	detail?: string;
};

export interface CandidateNormalizationCommandEvidence {
	index: number;
	command: ValidationCommand;
	outcome: ValidationCommandOutcome;
	exitCode: number | null;
	signal: string | null;
	stdout: string;
	stderr: string;
	durationMs: number;
}

export interface CandidateNormalizationEvidence {
	schema: typeof CANDIDATE_NORMALIZATION_EVIDENCE_SCHEMA;
	version: typeof CANDIDATE_NORMALIZATION_EVIDENCE_VERSION;
	attemptId: string;
	status: "completed" | "interrupted";
	before?: RepositoryStateIdentity;
	after?: RepositoryStateIdentity;
	commands: CandidateNormalizationCommandEvidence[];
	durationMs: number;
	failure?: CandidateNormalizationFailure;
}

export interface CandidateNormalizationOptions {
	attemptId: string;
	worktreePath: string;
	commands: readonly ValidationCommand[];
	expectedPlatform: NodeJS.Platform;
	timeoutMs: number;
	inheritedEnv?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
}

export async function normalizeCandidate(options: CandidateNormalizationOptions): Promise<CandidateNormalizationEvidence> {
	let before: RepositoryStateIdentity;
	try {
		before = captureRepositoryState(options.worktreePath);
	} catch (error) {
		return interruptedEvidence(options, options.commands.map((command, index) => unexecuted(command, index)), { code: "identity-failure", detail: errorMessage(error) });
	}
	let commands: CandidateNormalizationCommandEvidence[];
	let failure: CandidateNormalizationFailure | undefined;
	try {
		const result = await runValidationCommands(options.commands, {
			checkoutRoot: options.worktreePath,
			expectedPlatform: options.expectedPlatform,
			scopeId: options.attemptId,
			timeoutMs: options.timeoutMs,
			inheritedEnv: options.inheritedEnv,
			continueAfterNonzero: true,
			signal: options.signal,
		});
		commands = result.commands.map((command) => ({
			index: command.index,
			command: command.command,
			outcome: command.outcome,
			exitCode: command.exitCode,
			signal: command.signal,
			stdout: command.stdout,
			stderr: [command.stderr, command.spawnError].filter(Boolean).join("\n"),
			durationMs: command.durationMs,
		}));
		const interrupted = commands.find((command) => ["spawn", "timeout", "signal", "aborted"].includes(command.outcome));
		if (interrupted) failure = {
			code: interrupted.outcome === "spawn" ? "spawn-failure" : interrupted.outcome === "aborted" ? "user-abort" : interrupted.outcome,
			commandIndex: interrupted.index,
			...(interrupted.stderr ? { detail: interrupted.stderr } : {}),
		};
	} catch (error) {
		commands = options.commands.map((command, index) => unexecuted(command, index));
		failure = { code: "preflight-failure", detail: errorMessage(error) };
	}

	let after: RepositoryStateIdentity | undefined;
	try { after = captureRepositoryState(options.worktreePath); }
	catch (error) { failure = { code: "identity-failure", detail: errorMessage(error) }; }
	if (!failure && after) failure = after.headCommit !== before.headCommit || after.headTree !== before.headTree
		? { code: "head-drift" }
		: !after.indexMatchesHead || after.indexTree !== before.indexTree
			? { code: "index-drift" }
			: undefined;
	return {
		schema: CANDIDATE_NORMALIZATION_EVIDENCE_SCHEMA,
		version: CANDIDATE_NORMALIZATION_EVIDENCE_VERSION,
		attemptId: options.attemptId,
		status: failure ? "interrupted" : "completed",
		before,
		after,
		commands,
		durationMs: roundMs(commands.reduce((total, command) => total + command.durationMs, 0)),
		...(failure ? { failure } : {}),
	};
}

function interruptedEvidence(options: CandidateNormalizationOptions, commands: CandidateNormalizationCommandEvidence[], failure: CandidateNormalizationFailure): CandidateNormalizationEvidence {
	return {
		schema: CANDIDATE_NORMALIZATION_EVIDENCE_SCHEMA,
		version: CANDIDATE_NORMALIZATION_EVIDENCE_VERSION,
		attemptId: options.attemptId,
		status: "interrupted",
		commands,
		durationMs: roundMs(commands.reduce((total, command) => total + command.durationMs, 0)),
		failure,
	};
}

function unexecuted(command: ValidationCommand, index: number): CandidateNormalizationCommandEvidence {
	return { index, command, outcome: "unexecuted", exitCode: null, signal: null, stdout: "", stderr: "", durationMs: 0 };
}

function roundMs(value: number): number { return Math.round(value * 1_000) / 1_000; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
