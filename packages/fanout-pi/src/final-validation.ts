import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AcceptedStateTransition } from "../../fanout-core/src/artifact-identity.ts";
import type { ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import type { StageFact } from "../../fanout-core/src/execution-attempt.ts";
import {
	FINAL_VALIDATION_EVIDENCE_SCHEMA,
	FINAL_VALIDATION_EVIDENCE_VERSION,
	FINAL_VALIDATION_TRUST_BOUNDARY,
	classifyFinalValidationFailure,
	type FinalValidationCommandEvidence,
	type FinalValidationEvidence,
	type FinalValidationFailure,
	type FinalValidationResult,
	type RepositoryBoundaryIdentity,
} from "../../fanout-core/src/final-validation.ts";
import { parseValidationCommands, type ValidationCommand } from "../../fanout-core/src/validation-command.ts";
import type { AcceptedLedgerProvenance, FinalValidationRecoveryContext, ValidationCommandEvidence } from "../../fanout-core/src/recovery-evidence.ts";
import type { WorkContract } from "../../fanout-core/src/work-contract.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import {
	captureRepositoryState,
	createReconstructedWorktree,
	removeReconstructedWorktree,
	type PlanningBase,
	type RepositoryStateIdentity,
} from "./repository-identity.ts";
import { runValidationCommands } from "./validation-runner.ts";

export interface FinalValidationRoundOptions {
	repoRoot: string;
	runDir: string;
	roundId: string;
	planningBase: PlanningBase;
	ledger: readonly AcceptedStateTransition[];
	commands: readonly ValidationCommand[];
	expectedValidationTree: PlanningBase["tree"];
	expectedActiveTree: PlanningBase["tree"];
	candidate?: AcceptedStateTransition;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface FinalRepairHooks<T> {
	workContract: WorkContract;
	acceptedLedger: readonly AcceptedLedgerProvenance[];
	available: () => boolean;
	launch: (recovery: FinalValidationRecoveryContext, source: { attemptId?: string; evidence?: ArtifactIdentity }) => Promise<{ attemptId: string; candidate?: T; continue: boolean }>;
	transition: (candidate: T) => AcceptedStateTransition;
	authorize: (candidate: T) => Promise<boolean>;
	reject: (candidate: T, result: FinalValidationResult, recovery: FinalValidationRecoveryContext | undefined, fact: StageFact) => Promise<boolean>;
	apply: (candidate: T, result: FinalValidationResult) => Promise<boolean>;
}

export interface FinalValidationControllerOptions<T> extends Omit<FinalValidationRoundOptions, "roundId" | "candidate"> {
	repair?: FinalRepairHooks<T>;
}

export async function runFinalValidation<T>(options: FinalValidationControllerOptions<T>): Promise<FinalValidationResult> {
	let result = await runFinalValidationRound({ ...options, roundId: "initial" });
	if (!result.repairable || !options.repair) return result;
	let source: { attemptId?: string; evidence?: ArtifactIdentity } = { evidence: result.evidenceArtifact };
	let recovery = finalRecovery(result, options.repair.workContract, options.repair.acceptedLedger, options.expectedActiveTree, options.timeoutMs ?? 600_000);
	while (options.repair.available()) {
		const launched = await options.repair.launch(recovery, source);
		if (!launched.candidate) {
			if (!launched.continue) return result;
			source = { attemptId: launched.attemptId };
			continue;
		}
		if (!await options.repair.authorize(launched.candidate)) return result;
		const transition = options.repair.transition(launched.candidate);
		result = await runFinalValidationRound({ ...options, roundId: `repair-${transition.patch.artifact.sha256.slice(0, 12)}`, candidate: transition, expectedValidationTree: transition.patch.resultTree });
		if (result.status === "passed") {
			return await options.repair.apply(launched.candidate, result)
				? recordAcceptedFinalRepair(options.repoRoot, options.runDir, result, transition)
				: { ...result, status: "failed", repairable: false };
		}
		const nextRecovery = result.repairable ? finalRecovery(result, options.repair.workContract, options.repair.acceptedLedger, options.expectedActiveTree, options.timeoutMs ?? 600_000) : undefined;
		if (!await options.repair.reject(launched.candidate, result, nextRecovery, finalValidationFact(result))) return result;
		recovery = nextRecovery as FinalValidationRecoveryContext;
		source = { attemptId: launched.attemptId };
	}
	return result;
}

export async function runFinalValidationRound(options: FinalValidationRoundOptions): Promise<FinalValidationResult> {
	const commands = parseValidationCommands(options.commands, process.platform);
	const roundRoot = join(options.runDir, "final-validation", "rounds", options.roundId);
	const worktreePath = join(roundRoot, "worktree");
	mkdirSync(roundRoot, { recursive: true });
	const replay = [...options.ledger, ...(options.candidate ? [options.candidate] : [])];
	try {
		createReconstructedWorktree(options.repoRoot, worktreePath, options.planningBase, options.runDir, replay);
		const validationBefore = captureRepositoryState(worktreePath);
		const activeBefore = captureRepositoryState(options.repoRoot);
		const validationReady = matchesExpected(validationBefore, options.planningBase.headCommit, options.expectedValidationTree);
		const activeReady = matchesExpected(activeBefore, options.planningBase.headCommit, options.expectedActiveTree);
		let commandEvidence = unexecuted(commands);
		let durationMs = 0;
		let failure: FinalValidationFailure | undefined;
		if (!activeReady) failure = { kind: "hard", code: "active-drift", detail: "active checkout did not match the accepted ledger before final validation" };
		else if (!validationReady) failure = { kind: "hard", code: "identity", detail: "fresh validation reconstruction did not match the accepted candidate before command launch" };
		else {
			try {
				const result = await runValidationCommands(commands, {
					checkoutRoot: worktreePath,
					expectedPlatform: process.platform,
					scopeId: options.roundId,
					timeoutMs: options.timeoutMs,
					inheritedEnv: process.env,
					signal: options.signal,
				});
				commandEvidence = result.commands.map(toEvidence);
				durationMs = result.durationMs;
			} catch (error) {
				failure = { kind: "hard", code: "preflight", detail: errorMessage(error) };
			}
		}
		const validationAfter = captureRepositoryState(worktreePath);
		const activeAfter = captureRepositoryState(options.repoRoot);
		failure ??= classifyFinalValidationFailure(
			commandEvidence,
			validationReady && matchesExpected(validationAfter, options.planningBase.headCommit, options.expectedValidationTree),
			activeReady && matchesExpected(activeAfter, options.planningBase.headCommit, options.expectedActiveTree),
		);
		const evidence: FinalValidationEvidence = {
			schema: FINAL_VALIDATION_EVIDENCE_SCHEMA,
			version: FINAL_VALIDATION_EVIDENCE_VERSION,
			roundId: options.roundId,
			status: failure ? "failed" : "passed",
			expectedValidationTree: options.expectedValidationTree,
			expectedActiveTree: options.expectedActiveTree,
			validation: { before: validationBefore, after: validationAfter },
			active: { before: activeBefore, after: activeAfter },
			commands: commandEvidence,
			durationMs,
			...(failure ? { failure } : {}),
			...(options.candidate ? { candidate: options.candidate } : {}),
			trustBoundary: FINAL_VALIDATION_TRUST_BOUNDARY,
		};
		const evidenceArtifact = writeArtifactAtomically(options.runDir, `final-validation/rounds/${options.roundId}.json`, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
		return {
			status: evidence.status,
			commandCount: commandEvidence.filter((command) => command.outcome !== "unexecuted").length,
			durationMs,
			commands: commandEvidence,
			evidence,
			evidenceArtifact,
			repairable: failure?.kind === "program",
		};
	} finally {
		removeReconstructedWorktree(options.repoRoot, worktreePath);
	}
}

export function recordAcceptedFinalRepair(repoRoot: string, runDir: string, result: FinalValidationResult, transition: AcceptedStateTransition): FinalValidationResult {
	if (result.status !== "passed" || !result.evidence.candidate || result.evidence.candidate.patch.artifact.sha256 !== transition.patch.artifact.sha256) throw new Error("accepted final repair must match its passing candidate evidence");
	const activeAfterApply = captureRepositoryState(repoRoot);
	if (!matchesExpected(activeAfterApply, transition.patch.headCommit, transition.patch.resultTree)) throw new Error("accepted final repair active identity does not match its validated candidate");
	const evidence: FinalValidationEvidence = { ...result.evidence, acceptedRepair: { transition, activeAfterApply } };
	const evidenceArtifact = writeArtifactAtomically(runDir, `final-validation/rounds/${result.evidence.roundId}-accepted.json`, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
	return { ...result, evidence, evidenceArtifact };
}

function matchesExpected(identity: RepositoryStateIdentity, expectedHead: PlanningBase["headCommit"], expectedTree: PlanningBase["tree"]): boolean {
	return identity.headCommit === expectedHead && identity.indexMatchesHead && identity.tree === expectedTree;
}

function unexecuted(commands: readonly ValidationCommand[]): FinalValidationCommandEvidence[] {
	return commands.map((command, index) => ({ id: `final-validation/${index}`, index, command, outcome: "unexecuted", exitCode: null, signal: null, stdout: "", stderr: "", durationMs: 0 }));
}

function toEvidence(value: Awaited<ReturnType<typeof runValidationCommands>>["commands"][number]): FinalValidationCommandEvidence {
	return {
		id: value.id,
		index: value.index,
		command: value.command,
		outcome: value.outcome,
		exitCode: value.exitCode,
		signal: value.signal,
		stdout: value.stdout,
		stderr: value.stderr,
		durationMs: value.durationMs,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function finalRecovery(
	result: FinalValidationResult,
	workContract: WorkContract,
	acceptedLedger: readonly AcceptedLedgerProvenance[],
	reconstructedTree: PlanningBase["tree"],
	timeoutMs: number,
): FinalValidationRecoveryContext {
	return {
		kind: "final-validation",
		sourceFinalValidationEvidence: result.evidenceArtifact,
		workContract,
		commands: result.commands.map((command): ValidationCommandEvidence => ({
			index: command.index,
			command: command.command,
			status: command.outcome === "spawn" ? "spawn-failure" : command.outcome as ValidationCommandEvidence["status"],
			exitCode: command.exitCode,
			signal: command.signal,
			timeoutMs: command.outcome === "timeout" ? timeoutMs : null,
			stdout: command.stdout,
			stderr: command.stderr,
			durationMs: command.durationMs,
		})),
		acceptedLedger: acceptedLedger.map((entry) => structuredClone(entry)),
		reconstructedTree,
	};
}

function finalValidationFact(result: FinalValidationResult): StageFact {
	const failure = result.evidence.failure;
	if (failure?.kind !== "program") return { stage: "validation", code: failure?.code === "abort" ? "abort" : failure?.code === "spawn" || failure?.code === "preflight" ? "spawn-failure" : "malformed-evidence" };
	return { stage: "validation", code: failure.outcome === "nonzero" ? "program-failure" : failure.outcome, failedCommandIndexes: [failure.commandIndex] };
}
