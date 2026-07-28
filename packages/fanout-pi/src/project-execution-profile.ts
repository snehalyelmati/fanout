import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
	ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA,
	ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION,
	parseProjectExecutionProfile,
	projectExecutionProfileBytes,
	type ActiveProjectExecutionProfile,
	type ProjectExecutionProfile,
} from "../../fanout-core/src/project-execution-profile.ts";
import { artifactIdentity, parseArtifactIdentity, type ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { captureRepositoryState, createReconstructedWorktree, removeReconstructedWorktree, type PlanningBase } from "./repository-identity.ts";
import { readVerifiedArtifact, writeArtifactAtomically } from "./artifact-store.ts";
import { preflightValidationCommands, runValidationCommands, type ValidationRunResult } from "./validation-runner.ts";
import { normalizeCandidate, type CandidateNormalizationEvidence } from "./candidate-normalization.ts";
import type { RepositoryStateIdentity } from "./repository-identity.ts";

export const PROFILE_VALIDATION_EVIDENCE_SCHEMA = "fanout.project-execution-profile-validation";
export const PROFILE_VALIDATION_EVIDENCE_VERSION = 1;

export interface LoadedProjectExecutionProfile {
	pointer: ActiveProjectExecutionProfile;
	profile: ProjectExecutionProfile;
	identity: ArtifactIdentity;
	path: string;
}

export interface ProfileValidationEvidence {
	schema: typeof PROFILE_VALIDATION_EVIDENCE_SCHEMA;
	version: typeof PROFILE_VALIDATION_EVIDENCE_VERSION;
	profileId: string;
	profile: ArtifactIdentity;
	platform: NodeJS.Platform;
	status: "passed" | "failed";
	before?: RepositoryStateIdentity;
	afterPreparation?: RepositoryStateIdentity;
	afterReadiness?: RepositoryStateIdentity;
	afterNormalization?: RepositoryStateIdentity;
	preparationCommands: ValidationRunResult["commands"];
	readinessCommands: ValidationRunResult["commands"];
	normalization?: CandidateNormalizationEvidence;
	finalGateCommands: ProjectExecutionProfile["requiredFinalGates"][number]["command"][];
	finalGateLaunchable: boolean;
	failure?: { phase: "reconstruction" | "preparation" | "readiness" | "normalization" | "final-gate"; detail: string };
	beforeTree: string;
	afterPreparationTree: string;
	afterReadinessTree: string;
	afterNormalizationTree: string;
	preparationDurationMs: number;
	readinessDurationMs: number;
	normalizationDurationMs: number;
	finalGateCount: number;
	error?: string;
}

export interface ProjectWorktreePreparationEvidence {
	schema: "fanout.project-worktree-preparation";
	version: 1;
	profile: ArtifactIdentity;
	scopeId: string;
	status: "passed" | "failed";
	beforeTree: string;
	afterTree: string;
	preparationDurationMs: number;
	readinessDurationMs: number;
	error?: string;
}

export function loadActiveProjectExecutionProfile(activePointerPath: string, projectArtifactRoot: string): LoadedProjectExecutionProfile {
	const pointerValue = JSON.parse(readFileSync(resolve(activePointerPath), "utf8"));
	if (!record(pointerValue) || Object.keys(pointerValue).length !== 4 || pointerValue.schema !== ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA || pointerValue.version !== ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION || typeof pointerValue.publishedAt !== "string") {
		throw new Error("active project execution profile is unsupported; rerun /fanout-plan --refresh-profile");
	}
	const identity = parseArtifactIdentity(pointerValue.profile);
	const loaded = loadProjectExecutionProfile(identity, projectArtifactRoot);
	return {
		pointer: { schema: ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA, version: ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION, publishedAt: pointerValue.publishedAt, profile: identity },
		...loaded,
	};
}

export function loadProjectExecutionProfile(identityValue: unknown, projectArtifactRoot: string): Omit<LoadedProjectExecutionProfile, "pointer"> {
	const identity = parseArtifactIdentity(identityValue);
	const bytes = readVerifiedArtifact(projectArtifactRoot, identity);
	return { profile: parseProjectExecutionProfile(JSON.parse(bytes.toString("utf8"))), identity, path: resolve(projectArtifactRoot, identity.path) };
}

export function publishProjectExecutionProfile(profileValue: unknown, projectArtifactRoot: string, activePointerPath: string): LoadedProjectExecutionProfile {
	const profile = parseProjectExecutionProfile(profileValue);
	const profileRelative = `profiles/${profile.profileId}.json`;
	const bytes = projectExecutionProfileBytes(profile);
	const existingPath = resolve(projectArtifactRoot, profileRelative);
	let identity: ArtifactIdentity;
	if (existsSync(existingPath)) {
		const existing = readFileSync(existingPath);
		if (!existing.equals(bytes)) throw new Error(`immutable project execution profile already exists: ${profile.profileId}`);
		identity = artifactIdentity(profileRelative, existing);
	} else {
		identity = writeArtifactAtomically(projectArtifactRoot, profileRelative, bytes);
	}
	const pointer: ActiveProjectExecutionProfile = {
		schema: ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA,
		version: ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION,
		publishedAt: new Date().toISOString(),
		profile: identity,
	};
	const pointerRelative = relative(resolve(projectArtifactRoot), resolve(activePointerPath)).split(sep).join("/");
	if (!pointerRelative || pointerRelative.startsWith("../")) throw new Error("active profile pointer escapes the project artifact root");
	writeArtifactAtomically(projectArtifactRoot, pointerRelative, Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`));
	return { pointer, profile, identity, path: existingPath };
}

export async function validateProjectExecutionProfile(
	profileValue: unknown,
	options: { repoRoot: string; runDir: string; planningBase: PlanningBase; profileIdentity: ArtifactIdentity; timeoutMs?: number },
): Promise<{ evidence: ProfileValidationEvidence; artifact: ArtifactIdentity }> {
	const profile = parseProjectExecutionProfile(profileValue);
	const worktreePath = resolve(options.runDir, "profile-validation", "worktree");
	let evidence: ProfileValidationEvidence;
	let setup: Awaited<ReturnType<typeof runPreparationAndReadiness>> | undefined;
	let normalization: CandidateNormalizationEvidence | undefined;
	let finalGateLaunchable = false;
	let phase: NonNullable<ProfileValidationEvidence["failure"]>["phase"] = "reconstruction";
	try {
		createReconstructedWorktree(options.repoRoot, worktreePath, options.planningBase, options.runDir, []);
		phase = "preparation";
		setup = await runPreparationAndReadiness(profile, worktreePath, profile.profileId, options.timeoutMs);
		if (setup.error) throw new Error(setup.error);
		phase = "normalization";
		normalization = await normalizeCandidate({ attemptId: `profile-${profile.profileId}`, worktreePath, commands: profile.candidateNormalization.map((entry) => entry.command), expectedPlatform: process.platform, timeoutMs: options.timeoutMs ?? 600_000, inheritedEnv: process.env });
		if (normalization.failure) throw new Error(`profile candidate normalization failed on the clean baseline: ${normalization.failure.detail ?? normalization.failure.code}`);
		const afterNormalization = captureRepositoryState(worktreePath);
		assertUnchanged(setup.afterReadiness, afterNormalization, "candidate normalization");
		phase = "final-gate";
		preflightValidationCommands(profile.requiredFinalGates.map((entry) => entry.command), { checkoutRoot: worktreePath, expectedPlatform: process.platform });
		finalGateLaunchable = true;
		evidence = {
			schema: PROFILE_VALIDATION_EVIDENCE_SCHEMA,
			version: PROFILE_VALIDATION_EVIDENCE_VERSION,
			profileId: profile.profileId,
			profile: options.profileIdentity,
			platform: process.platform,
			status: "passed",
			before: setup.before,
			afterPreparation: setup.afterPreparation,
			afterReadiness: setup.afterReadiness,
			afterNormalization,
			preparationCommands: setup.preparation?.commands ?? [],
			readinessCommands: setup.readiness?.commands ?? [],
			normalization,
			finalGateCommands: profile.requiredFinalGates.map((entry) => entry.command),
			finalGateLaunchable,
			beforeTree: setup.before.tree,
			afterPreparationTree: setup.afterPreparation.tree,
			afterReadinessTree: setup.afterReadiness.tree,
			afterNormalizationTree: afterNormalization.tree,
			preparationDurationMs: setup.preparationDurationMs,
			readinessDurationMs: setup.readinessDurationMs,
			normalizationDurationMs: normalization.durationMs,
			finalGateCount: profile.requiredFinalGates.length,
		};
	} catch (error) {
		const tree = safeTree(worktreePath, options.planningBase.tree);
		if (phase === "preparation" && setup?.phase === "readiness") phase = "readiness";
		evidence = {
			schema: PROFILE_VALIDATION_EVIDENCE_SCHEMA,
			version: PROFILE_VALIDATION_EVIDENCE_VERSION,
			profileId: profile.profileId,
			profile: options.profileIdentity,
			platform: process.platform,
			status: "failed",
			...(setup?.before ? { before: setup.before } : {}),
			...(setup?.afterPreparation ? { afterPreparation: setup.afterPreparation } : {}),
			...(setup?.afterReadiness ? { afterReadiness: setup.afterReadiness } : {}),
			...(normalization?.after ? { afterNormalization: normalization.after } : {}),
			preparationCommands: setup?.preparation?.commands ?? [],
			readinessCommands: setup?.readiness?.commands ?? [],
			...(normalization ? { normalization } : {}),
			finalGateCommands: profile.requiredFinalGates.map((entry) => entry.command),
			finalGateLaunchable,
			failure: { phase, detail: message(error) },
			beforeTree: setup?.before.tree ?? options.planningBase.tree,
			afterPreparationTree: setup?.afterPreparation.tree ?? tree,
			afterReadinessTree: setup?.afterReadiness.tree ?? tree,
			afterNormalizationTree: tree,
			preparationDurationMs: setup?.preparationDurationMs ?? 0,
			readinessDurationMs: setup?.readinessDurationMs ?? 0,
			normalizationDurationMs: 0,
			finalGateCount: profile.requiredFinalGates.length,
			error: message(error),
		};
	} finally {
		removeReconstructedWorktree(options.repoRoot, worktreePath);
	}
	const artifact = writeArtifactAtomically(options.runDir, "profile-validation/evidence.json", Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
	return { evidence, artifact };
}

export async function prepareProjectWorktree(
	profile: ProjectExecutionProfile,
	profileIdentity: ArtifactIdentity,
	options: { worktreePath: string; artifactRoot: string; evidencePath: string; scopeId: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<{ evidence: ProjectWorktreePreparationEvidence; artifact: ArtifactIdentity }> {
	const setup = await runPreparationAndReadiness(profile, options.worktreePath, options.scopeId, options.timeoutMs, options.signal);
	const after = captureRepositoryState(options.worktreePath);
	const evidence: ProjectWorktreePreparationEvidence = {
		schema: "fanout.project-worktree-preparation",
		version: 1,
		profile: profileIdentity,
		scopeId: options.scopeId,
		status: setup.error ? "failed" : "passed",
		beforeTree: setup.before.tree,
		afterTree: after.tree,
		preparationDurationMs: setup.preparationDurationMs,
		readinessDurationMs: setup.readinessDurationMs,
		...(setup.error ? { error: setup.error } : {}),
	};
	const artifact = writeArtifactAtomically(options.artifactRoot, options.evidencePath, Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
	return { evidence, artifact };
}

async function runPreparationAndReadiness(profile: ProjectExecutionProfile, worktreePath: string, scopeId: string, timeoutMs?: number, signal?: AbortSignal) {
	const before = captureRepositoryState(worktreePath);
	let afterPreparation = before;
	let afterReadiness = before;
	let preparationDurationMs = 0;
	let readinessDurationMs = 0;
	let error: string | undefined;
	let phase: "preparation" | "readiness" = "preparation";
	let preparation: ValidationRunResult | undefined;
	let readiness: ValidationRunResult | undefined;
	try {
		preparation = await runValidationCommands(profile.preparation.map((entry) => entry.command), { ...validationOptions(worktreePath, scopeId, timeoutMs), signal });
		preparationDurationMs = preparation.durationMs;
		afterPreparation = captureRepositoryState(worktreePath);
		if (preparation.status !== "passed") throw new Error("project preparation failed");
		assertUnchanged(before, afterPreparation, "preparation");
		phase = "readiness";
		readiness = await runValidationCommands(profile.readiness.map((entry) => entry.command), { ...validationOptions(worktreePath, scopeId, timeoutMs), signal });
		readinessDurationMs = readiness.durationMs;
		afterReadiness = captureRepositoryState(worktreePath);
		if (readiness.status !== "passed") throw new Error("project readiness failed");
		assertUnchanged(afterPreparation, afterReadiness, "readiness");
	} catch (failure) {
		error = message(failure);
	}
	return { before, afterPreparation, afterReadiness, preparationDurationMs, readinessDurationMs, preparation, readiness, phase, error };
}

function validationOptions(checkoutRoot: string, scopeId: string, timeoutMs = 600_000) {
	return { checkoutRoot, expectedPlatform: process.platform, scopeId, timeoutMs, inheritedEnv: process.env };
}

function assertUnchanged(before: ReturnType<typeof captureRepositoryState>, after: ReturnType<typeof captureRepositoryState>, phase: string): void {
	if (before.headCommit !== after.headCommit || !after.indexMatchesHead || before.tree !== after.tree) throw new Error(`profile ${phase} changed the Git-visible baseline`);
}

function safeTree(path: string, fallback: string): string {
	try { return captureRepositoryState(path).tree; } catch { return fallback; }
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
