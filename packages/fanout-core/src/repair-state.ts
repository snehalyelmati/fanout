import { createHash } from "node:crypto";
import type { AcceptedPatch } from "./artifact-identity.ts";
import type { AttemptRecoveryContext, ValidationCommandEvidence } from "./recovery-evidence.ts";

export interface RepairStateDigest {
	candidate: string;
	failure: string;
	combined: string;
}

export function repairStateDigest(recovery: AttemptRecoveryContext): RepairStateDigest {
	const candidate = recovery.kind === "final-validation"
		? recovery.failedRound.candidate?.patch ? candidateIdentity(recovery.failedRound.candidate.patch) : { headCommit: recovery.failedRound.validation.before.headCommit, baseTree: recovery.failedRound.expectedActiveTree, resultTree: recovery.failedRound.expectedValidationTree }
		: candidateIdentity(recovery.rejectedPatch);
	const failure = recovery.kind === "integration"
		? { kind: recovery.kind, applyFailure: withoutDuration(recovery.applyFailure) }
		: recovery.kind === "validation"
			? { kind: recovery.kind, commands: recovery.commands.map(commandFailure) }
			: { kind: recovery.kind, failure: recovery.failedRound.failure, commands: recovery.commands.map(commandFailure) };
	const candidateDigest = digest(candidate);
	const failureDigest = digest(failure);
	return { candidate: candidateDigest, failure: failureDigest, combined: digest({ candidate: candidateDigest, failure: failureDigest }) };
}

function candidateIdentity(candidate: AcceptedPatch): unknown {
	const { artifact, ...identity } = candidate;
	return { ...identity, artifact: { sha256: artifact.sha256, byteLength: artifact.byteLength } };
}

function commandFailure(command: ValidationCommandEvidence): unknown {
	const { durationMs: _durationMs, ...value } = command;
	return value;
}

function withoutDuration<T extends { durationMs: number }>(value: T): Omit<T, "durationMs"> {
	const { durationMs: _durationMs, ...rest } = value;
	return rest;
}

function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
}
