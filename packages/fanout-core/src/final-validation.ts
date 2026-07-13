import type { AcceptedStateTransition, ArtifactIdentity, GitCommitId, GitTreeId } from "./artifact-identity.ts";
import type { ValidationCommand } from "./validation-command.ts";
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
