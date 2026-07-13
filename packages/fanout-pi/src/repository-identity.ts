import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import {
	artifactIdentity,
	parseAcceptedPatch,
	parseAcceptedStateTransition,
	parseGitCommitId,
	parseGitTreeId,
	type AcceptedPatch,
	type AcceptedStateTransition,
	type GitCommitId,
	type GitTreeId,
	type PatchStatistics,
} from "../../fanout-core/src/artifact-identity.ts";
import { decodeGitPathList } from "../../fanout-core/src/repository-resource.ts";
import type { ApplyFailureEvidence } from "../../fanout-core/src/recovery-evidence.ts";
import { readVerifiedArtifact, writeArtifactAtomically } from "./artifact-store.ts";

export interface PlanningBase {
	headCommit: GitCommitId;
	tree: GitTreeId;
}

export interface RepositoryStateIdentity extends PlanningBase {
	headTree: GitTreeId;
	indexTree: GitTreeId;
	indexMatchesHead: boolean;
}

export class AcceptedTransitionIdentityError extends Error {
	readonly code = "identity-failure" as const;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AcceptedTransitionIdentityError";
	}
}

export class AcceptedTransitionProcessError extends Error {
	readonly code: "check-conflict" | "apply-failure";
	readonly evidence: ApplyFailureEvidence;

	constructor(code: AcceptedTransitionProcessError["code"], evidence: ApplyFailureEvidence, options?: ErrorOptions) {
		super(evidence.stderr || `${evidence.stage} failed`, options);
		this.name = "AcceptedTransitionProcessError";
		this.code = code;
		this.evidence = evidence;
	}
}

export class AmbiguousApplyError extends Error {
	readonly code = "post-tree-mismatch" as const;
	readonly evidence: ApplyFailureEvidence;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AmbiguousApplyError";
		this.evidence = { stage: "post-tree", code: "tree-mismatch", exitCode: null, signal: null, timeoutMs: null, stdout: "", stderr: message, durationMs: 0 };
	}
}

export function capturePlanningBase(repoRoot: string): PlanningBase {
	return {
		headCommit: parseGitCommitId(gitText(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"])),
		tree: fullGitVisibleTree(repoRoot),
	};
}

export function captureRepositoryState(repoRoot: string): RepositoryStateIdentity {
	const headCommit = parseGitCommitId(gitText(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]));
	const headTree = parseGitTreeId(gitText(repoRoot, ["rev-parse", "--verify", "HEAD^{tree}"]));
	const indexTree = parseGitTreeId(gitText(repoRoot, ["write-tree"]));
	return { headCommit, headTree, indexTree, indexMatchesHead: indexTree === headTree, tree: fullGitVisibleTree(repoRoot) };
}

export function fullGitVisibleTree(repoRoot: string): GitTreeId {
	return withTemporaryIndex(repoRoot, (indexPath) => {
		populateIndex(repoRoot, indexPath, "HEAD");
		return parseGitTreeId(gitText(repoRoot, ["write-tree"], indexPath));
	});
}

export function capturePatchCandidate(
	repoRoot: string,
	base: PlanningBase,
	artifactRoot: string,
	patchPath: string,
): AcceptedPatch {
	const candidate = inspectPatchCandidate(repoRoot, base, patchPath);
	const artifact = writeArtifactAtomically(artifactRoot, patchPath, candidate.bytes);
	return { ...candidate.patch, artifact };
}

export function verifyPatchCandidate(repoRoot: string, artifactRoot: string, value: unknown): AcceptedPatch {
	const expected = parseAcceptedPatch(value);
	const admittedBytes = readVerifiedArtifact(artifactRoot, expected.artifact);
	const current = inspectPatchCandidate(repoRoot, { headCommit: expected.headCommit, tree: expected.baseTree }, expected.artifact.path);
	if (!admittedBytes.equals(current.bytes)) throw new Error("candidate patch bytes changed after capture");
	if (JSON.stringify(current.patch.changedPaths) !== JSON.stringify(expected.changedPaths)) throw new Error("candidate changed paths changed after capture");
	if (JSON.stringify(current.patch.stats) !== JSON.stringify(expected.stats)) throw new Error("candidate patch statistics changed after capture");
	if (current.patch.headCommit !== expected.headCommit) throw new Error("candidate HEAD changed after capture");
	if (current.patch.baseTree !== expected.baseTree) throw new Error("candidate base tree changed after capture");
	if (current.patch.resultTree !== expected.resultTree) throw new Error("candidate resulting tree changed after capture");
	return expected;
}

export function applyAcceptedTransition(
	repoRoot: string,
	artifactRoot: string,
	value: unknown,
	options: { beforeCheck?: () => void; afterCheck?: () => void; afterApply?: () => void } = {},
): AcceptedStateTransition {
	let transition: AcceptedStateTransition;
	let bytes: Buffer;
	try {
		transition = parseAcceptedStateTransition(value);
		const { patch } = transition;
		const beforeIdentity = captureRepositoryState(repoRoot);
		if (beforeIdentity.headCommit !== patch.headCommit) throw new Error(`accepted-state identity HEAD mismatch: expected ${patch.headCommit}, got ${beforeIdentity.headCommit}`);
		if (!beforeIdentity.indexMatchesHead) throw new Error("accepted-state identity index diverges from HEAD");
		const before = beforeIdentity.tree;
		if (before !== patch.baseTree) throw checkConflict(`accepted-state check conflict for ${patch.changedPaths.join(", ")}: expected base tree ${patch.baseTree}, got ${before}`);
		bytes = readVerifiedArtifact(artifactRoot, patch.artifact);
		const predicted = predictedResultTree(repoRoot, bytes, before);
		if (predicted !== patch.resultTree) throw new Error(`accepted-state result tree mismatch: expected ${patch.resultTree}, patch produces ${predicted}`);
		const changedPaths = changedPathsBetweenTrees(repoRoot, before, predicted);
		if (JSON.stringify(changedPaths) !== JSON.stringify(patch.changedPaths)) throw new Error("accepted-state changed paths do not match the verified patch");
		if (JSON.stringify(patchStatisticsBetweenTrees(repoRoot, before, predicted, changedPaths.length)) !== JSON.stringify(patch.stats)) throw new Error("accepted-state patch statistics do not match the verified patch");
	} catch (error) {
		if (error instanceof AcceptedTransitionIdentityError || error instanceof AcceptedTransitionProcessError) throw error;
		throw new AcceptedTransitionIdentityError(errorMessage(error), { cause: error });
	}
	const { patch } = transition;
	if (bytes.byteLength === 0) return transition;
	try { options.beforeCheck?.(); git(repoRoot, ["apply", "--check", "--binary", "-"], undefined, bytes); }
	catch (error) { throw transitionProcessError("check", error); }
	try { options.afterCheck?.(); git(repoRoot, ["apply", "--binary", "-"], undefined, bytes); }
	catch (error) { throw transitionProcessError("apply", error); }
	let after: RepositoryStateIdentity;
	try {
		options.afterApply?.();
		after = captureRepositoryState(repoRoot);
	} catch (error) {
		throw new AmbiguousApplyError(`repository state could not be verified after accepted-state apply: ${errorMessage(error)}; manual reconciliation required`, { cause: error });
	}
	if (after.headCommit !== patch.headCommit || !after.indexMatchesHead || after.tree !== patch.resultTree) {
		throw new AmbiguousApplyError(`repository changed during accepted-state apply: expected HEAD ${patch.headCommit}, clean index, tree ${patch.resultTree}; got HEAD ${after.headCommit}, indexMatchesHead=${after.indexMatchesHead}, tree ${after.tree}; manual reconciliation required`);
	}
	return transition;
}

export function replayAcceptedTransitions(repoRoot: string, artifactRoot: string, values: readonly unknown[]): AcceptedStateTransition[] {
	return values.map((value) => applyAcceptedTransition(repoRoot, artifactRoot, value));
}

export function createReconstructedWorktree(
	repoRoot: string,
	worktreePath: string,
	baseValue: PlanningBase,
	artifactRoot: string,
	ledger: readonly unknown[],
): PlanningBase {
	const base = { headCommit: parseGitCommitId(baseValue.headCommit), tree: parseGitTreeId(baseValue.tree) };
	mkdirSync(dirname(worktreePath), { recursive: true });
	const hooks = mkdtempSync(join(dirname(worktreePath), "empty-hooks-"));
	try {
		git(repoRoot, ["-c", `core.hooksPath=${hooks}`, "worktree", "add", "--detach", worktreePath, base.headCommit]);
	} finally {
		rmSync(hooks, { recursive: true, force: true });
	}
	const actualBase = capturePlanningBase(worktreePath);
	if (actualBase.headCommit !== base.headCommit || actualBase.tree !== base.tree) throw new Error("reconstructed worktree does not match the planning base");
	replayAcceptedTransitions(worktreePath, artifactRoot, ledger);
	return { headCommit: base.headCommit, tree: fullGitVisibleTree(worktreePath) };
}

export function removeReconstructedWorktree(repoRoot: string, worktreePath: string): void {
	try {
		git(repoRoot, ["worktree", "remove", "--force", worktreePath]);
	} catch {
		rmSync(worktreePath, { recursive: true, force: true });
		git(repoRoot, ["worktree", "prune"]);
	}
	rmSync(worktreePath, { recursive: true, force: true });
}

function inspectPatchCandidate(repoRoot: string, baseValue: PlanningBase, patchPath: string): { bytes: Buffer; patch: AcceptedPatch } {
	const base = { headCommit: parseGitCommitId(baseValue.headCommit), tree: parseGitTreeId(baseValue.tree) };
	const headCommit = parseGitCommitId(gitText(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]));
	if (headCommit !== base.headCommit) throw new Error(`candidate HEAD mismatch: expected ${base.headCommit}, got ${headCommit}`);
	requireObjectType(repoRoot, base.tree, "tree");
	return withTemporaryIndex(repoRoot, (indexPath) => {
		populateIndex(repoRoot, indexPath, "HEAD");
		const bytes = git(repoRoot, ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", base.tree, "--"], indexPath).stdout;
		const paths = decodeGitPathList(git(repoRoot, ["diff", "--cached", "--name-only", "--no-renames", "-z", base.tree, "--"], indexPath).stdout);
		const stats = patchStatistics(git(repoRoot, ["diff", "--cached", "--numstat", "--no-renames", "-z", base.tree, "--"], indexPath).stdout, paths.length);
		const resultTree = parseGitTreeId(gitText(repoRoot, ["write-tree"], indexPath));
		return {
			bytes,
			patch: {
				artifact: artifactIdentity(patchPath, bytes),
				headCommit,
				changedPaths: paths,
				stats,
				baseTree: base.tree,
				resultTree,
			},
		};
	});
}

function predictedResultTree(repoRoot: string, patch: Buffer, currentTree: GitTreeId): GitTreeId {
	return withTemporaryIndex(repoRoot, (indexPath) => {
		populateIndex(repoRoot, indexPath, "HEAD");
		const indexedTree = gitText(repoRoot, ["write-tree"], indexPath);
		if (indexedTree !== currentTree) throw new Error(`repository changed during transition preflight: expected ${currentTree}, got ${indexedTree}`);
		if (patch.byteLength > 0) git(repoRoot, ["apply", "--cached", "--binary", "-"], indexPath, patch);
		return parseGitTreeId(gitText(repoRoot, ["write-tree"], indexPath));
	});
}

function changedPathsBetweenTrees(repoRoot: string, before: GitTreeId, after: GitTreeId): string[] {
	return decodeGitPathList(git(repoRoot, ["diff-tree", "-r", "--no-commit-id", "--name-only", "--no-renames", "-z", before, after, "--"]).stdout);
}

function patchStatisticsBetweenTrees(repoRoot: string, before: GitTreeId, after: GitTreeId, filesChanged: number): PatchStatistics {
	return patchStatistics(git(repoRoot, ["diff-tree", "-r", "--no-commit-id", "--numstat", "--no-renames", "-z", before, after, "--"]).stdout, filesChanged);
}

function patchStatistics(bytes: Uint8Array, filesChanged: number): PatchStatistics {
	let insertions = 0;
	let deletions = 0;
	for (const entry of new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0")) {
		if (!entry) continue;
		const [added, removed] = entry.split("\t", 2);
		if (/^\d+$/.test(added)) insertions += Number(added);
		if (/^\d+$/.test(removed)) deletions += Number(removed);
	}
	return { filesChanged, insertions, deletions };
}

function requireObjectType(repoRoot: string, objectId: string, expected: string): void {
	const actual = gitText(repoRoot, ["cat-file", "-t", objectId]);
	if (actual !== expected) throw new Error(`expected Git ${expected} ${objectId}, got ${actual}`);
}

function populateIndex(repoRoot: string, indexPath: string, baseRef: string): void {
	git(repoRoot, ["read-tree", baseRef], indexPath);
	git(repoRoot, ["add", "-A", "--", "."], indexPath);
}

function withTemporaryIndex<T>(repoRoot: string, run: (indexPath: string) => T): T {
	const directory = mkdtempSync(join(tmpdir(), "fanout-index-"));
	try {
		return run(join(directory, "index"));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function gitText(repoRoot: string, args: string[], indexPath?: string): string {
	return git(repoRoot, args, indexPath).stdout.toString("utf8").trim();
}

function git(repoRoot: string, args: string[], indexPath?: string, input?: Buffer): { stdout: Buffer; stderr: Buffer } {
	const env = indexPath === undefined ? process.env : { ...process.env, GIT_INDEX_FILE: indexPath };
	const started = performance.now();
	const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
		cwd: repoRoot,
		env,
		input,
		maxBuffer: 256 * 1024 * 1024,
	});
	if (result.status !== 0) throw new GitCommandError(`git ${args.join(" ")} failed: ${result.stderr?.toString("utf8").trim() || result.error?.message || `exit ${result.status}`}`, {
		exitCode: result.status,
		signal: result.signal,
		stdout: result.stdout ?? Buffer.alloc(0),
		stderr: result.stderr ?? Buffer.alloc(0),
		spawnError: result.error,
		durationMs: Math.max(0, performance.now() - started),
	});
	return { stdout: result.stdout ?? Buffer.alloc(0), stderr: result.stderr ?? Buffer.alloc(0) };
}

class GitCommandError extends Error {
	readonly result: { exitCode: number | null; signal: NodeJS.Signals | null; stdout: Buffer; stderr: Buffer; spawnError?: Error; durationMs: number };

	constructor(message: string, result: GitCommandError["result"]) {
		super(message);
		this.name = "GitCommandError";
		this.result = result;
	}
}

function transitionProcessError(stage: "check" | "apply", error: unknown): AcceptedTransitionProcessError {
	if (error instanceof AcceptedTransitionProcessError) return error;
	const result = error instanceof GitCommandError ? error.result : undefined;
	const spawnFailure = Boolean(result?.spawnError) || !result;
	const signal = result?.signal ?? null;
	const evidence: ApplyFailureEvidence = {
		stage,
		code: spawnFailure ? "spawn-failure" : signal ? "signal" : "nonzero",
		exitCode: spawnFailure || signal ? null : result?.exitCode ?? 1,
		signal,
		timeoutMs: null,
		stdout: result?.stdout.toString("utf8") ?? "",
		stderr: [result?.stderr.toString("utf8").trim(), errorMessage(error)].filter(Boolean).join("\n"),
		durationMs: result?.durationMs ?? 0,
	};
	return new AcceptedTransitionProcessError(stage === "check" ? "check-conflict" : "apply-failure", evidence, { cause: error });
}

function checkConflict(message: string): AcceptedTransitionProcessError {
	return new AcceptedTransitionProcessError("check-conflict", { stage: "check", code: "nonzero", exitCode: 1, signal: null, timeoutMs: null, stdout: "", stderr: message, durationMs: 0 });
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
