import { dirname, join, relative } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { AcceptedPatch, AcceptedStateTransition, ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import type { ProjectExecutionProfile } from "../../fanout-core/src/project-execution-profile.ts";
import type { WorkContract } from "../../fanout-core/src/work-contract.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import { normalizeCandidate } from "./candidate-normalization.ts";
import { checkContractOwnership } from "./fanout-git.ts";
import { prepareProjectWorktree } from "./project-execution-profile.ts";
import {
	applyRepairSeedOverlay,
	capturePatchCandidate,
	createReconstructedWorktree,
	verifyPatchCandidate,
	type PlanningBase,
} from "./repository-identity.ts";
import { runValidationCommands, type ValidationRunResult } from "./validation-runner.ts";

export type ReconciliationResult =
	| { ok: true; patch: AcceptedPatch; validation: ValidationRunResult; base: PlanningBase; worktreePath: string; evidence: ArtifactIdentity }
	| { ok: false; code: "base-not-accepted" | "path-overlap" | "preparation-failed" | "overlay-failed" | "normalization-failed" | "ownership-failed" | "validation-failed" | "repository-failed"; detail: string; evidence: ArtifactIdentity };

export async function reconcilePathDisjointCandidate(options: {
	repoRoot: string;
	runDir: string;
	attemptDir: string;
	attemptId: string;
	planningBase: PlanningBase;
	ledger: readonly AcceptedStateTransition[];
	candidate: AcceptedPatch;
	contract: WorkContract;
	profile: ProjectExecutionProfile;
	profileIdentity: ArtifactIdentity;
	ledgerAdvanceRetry: number;
	timeoutMs: number;
	signal?: AbortSignal;
}): Promise<ReconciliationResult> {
	const started = performance.now();
	const root = join(options.attemptDir, "reconciliation", String(options.ledgerAdvanceRetry));
	const scopeId = `${options.attemptId}/reconciliation/${options.ledgerAdvanceRetry}`;
	const worktreePath = join(root, "worktree");
	mkdirSync(dirname(root), { recursive: true });
	mkdirSync(root); // A trial is single-use, including rejected trials.
	let published = false;
	const acceptedStates = [options.planningBase.tree, ...options.ledger.map((entry) => entry.patch.resultTree)];
	const latestBaseTree = acceptedStates.at(-1)!;
	const baseIndex = acceptedStates.indexOf(options.candidate.baseTree);
	const intervening = baseIndex < 0 ? [] : options.ledger.slice(baseIndex);
	const changed = new Set(options.candidate.changedPaths);
	const overlappingPaths = [...new Set(intervening.flatMap((entry) => entry.patch.changedPaths).filter((path) => changed.has(path)))].sort();
	const pathDisjoint: { status: "passed" | "failed"; overlappingPaths: string[] } = { status: overlappingPaths.length ? "failed" : "passed", overlappingPaths };
	let overlay: { status: "not-run" | "passed" | "failed" } = { status: "not-run" };
	let preparation: unknown;
	let normalization: unknown;
	let validation: ValidationRunResult | undefined;
	if (baseIndex < 0) return failure("base-not-accepted", "candidate base is not an exact accepted ledger state");
	if (overlappingPaths.length) return failure("path-overlap", `candidate overlaps intervening accepted paths: ${overlappingPaths.join(", ")}`);
	try {
		const base = createReconstructedWorktree(options.repoRoot, worktreePath, options.planningBase, options.runDir, options.ledger);
		const prepared = await prepareProjectWorktree(options.profile, options.profileIdentity, {
			worktreePath,
			artifactRoot: options.runDir,
			evidencePath: `${relative(options.runDir, root).split("\\").join("/")}/preparation.json`,
			scopeId,
			timeoutMs: options.timeoutMs,
			signal: options.signal,
		});
		preparation = { artifact: prepared.artifact, evidence: prepared.evidence };
		if (prepared.evidence.status !== "passed") return failure("preparation-failed", prepared.evidence.error ?? "reconciliation preparation failed");
		try {
			applyRepairSeedOverlay(worktreePath, options.runDir, { patch: options.candidate });
			overlay = { status: "passed" };
		} catch (error) {
			overlay = { status: "failed" };
			return failure("overlay-failed", message(error));
		}
		const normalized = await normalizeCandidate({ attemptId: scopeId, worktreePath, commands: options.profile.candidateNormalization.map((entry) => entry.command), expectedPlatform: process.platform, timeoutMs: options.timeoutMs, inheritedEnv: process.env, signal: options.signal });
		normalization = normalized;
		if (normalized.failure) return failure("normalization-failed", normalized.failure.detail ?? normalized.failure.code);
		const patch = capturePatchCandidate(worktreePath, base, options.runDir, `${relative(options.runDir, root).split("\\").join("/")}/patch.bin`);
		const ownership = checkContractOwnership(options.contract, patch, root, options.repoRoot);
		if (!ownership.ok) return failure("ownership-failed", ownership.violations.map((entry) => `${entry.file}: ${entry.reason}`).join("; "));
		validation = await runValidationCommands(options.contract.validationCommands, { checkoutRoot: worktreePath, expectedPlatform: process.platform, scopeId, timeoutMs: options.timeoutMs, inheritedEnv: process.env, signal: options.signal });
		if (validation.status !== "passed") return failure("validation-failed", "reconciled candidate validation failed");
		verifyPatchCandidate(worktreePath, options.runDir, patch);
		const evidence = publish({ status: "accepted", reconciledCandidate: patch });
		return { ok: true, patch, validation, base, worktreePath, evidence };
	} catch (error) {
		if (published) throw error;
		return failure("repository-failed", message(error));
	}

	function failure(code: Extract<ReconciliationResult, { ok: false }>["code"], detail: string): Extract<ReconciliationResult, { ok: false }> {
		return { ok: false, code, detail, evidence: publish({ status: "rejected", code, detail }) };
	}

	function publish(value: unknown): ArtifactIdentity {
		if (published) throw new Error("reconciliation trial already published");
		const timed = typeof value === "object" && value !== null && !Array.isArray(value) ? {
			...value,
			attemptId: options.attemptId,
			originalCandidate: options.candidate,
			originalBaseTree: options.candidate.baseTree,
			latestBaseTree,
			intervening,
			pathDisjoint,
			overlay,
			preparation,
			normalization,
			validation,
			ledgerAdvanceRetries: options.ledgerAdvanceRetry,
			durationMs: Math.max(0, performance.now() - started),
		} : value;
		const evidence = writeArtifactAtomically(options.runDir, `${relative(options.runDir, root).split("\\").join("/")}/result.json`, Buffer.from(`${JSON.stringify(timed, null, 2)}\n`));
		published = true;
		const indexPath = join(options.attemptDir, "reconciliation.json");
		const trials: ArtifactIdentity[] = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")).trials ?? [] : [];
		writeArtifactAtomically(options.runDir, relative(options.runDir, indexPath).split("\\").join("/"), Buffer.from(`${JSON.stringify({ ...timed as object, trials: [...trials, evidence] }, null, 2)}\n`));
		return evidence;
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
