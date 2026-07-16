import { createHash } from "node:crypto";
import { parseRepoPath, type RepoPath } from "./repository-resource.ts";

export interface ArtifactIdentity {
	path: RepoPath;
	sha256: string;
	byteLength: number;
}

declare const gitCommitIdBrand: unique symbol;
declare const gitTreeIdBrand: unique symbol;
export type GitCommitId = string & { readonly [gitCommitIdBrand]: true };
export type GitTreeId = string & { readonly [gitTreeIdBrand]: true };

export interface PatchStatistics {
	filesChanged: number;
	insertions: number;
	deletions: number;
}

export interface AcceptedPatch {
	artifact: ArtifactIdentity;
	headCommit: GitCommitId;
	changedPaths: RepoPath[];
	stats: PatchStatistics;
	baseTree: GitTreeId;
	resultTree: GitTreeId;
}

export interface AcceptedStateTransition {
	patch: AcceptedPatch;
}

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function artifactIdentity(path: unknown, bytes: Uint8Array): ArtifactIdentity {
	return {
		path: parseRepoPath(path),
		sha256: createHash("sha256").update(bytes).digest("hex"),
		byteLength: bytes.byteLength,
	};
}

export function parseArtifactIdentity(value: unknown): ArtifactIdentity {
	if (!hasOnlyFields(value, ["path", "sha256", "byteLength"])) throw new TypeError("artifact identity must contain only path, sha256, and byteLength");
	if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) throw new TypeError("artifact sha256 must be 64 lowercase hexadecimal characters");
	if (!Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 0) throw new TypeError("artifact byteLength must be a non-negative safe integer");
	return { path: parseRepoPath(value.path), sha256: value.sha256, byteLength: Number(value.byteLength) };
}

export function verifyArtifactBytes(identityValue: unknown, bytes: Uint8Array): ArtifactIdentity {
	const identity = parseArtifactIdentity(identityValue);
	if (bytes.byteLength !== identity.byteLength) throw new Error(`artifact byte length mismatch for ${identity.path}`);
	if (createHash("sha256").update(bytes).digest("hex") !== identity.sha256) throw new Error(`artifact SHA-256 mismatch for ${identity.path}`);
	return identity;
}

export function parseAcceptedPatch(value: unknown): AcceptedPatch {
	if (!hasOnlyFields(value, ["artifact", "headCommit", "changedPaths", "stats", "baseTree", "resultTree"])) {
		throw new TypeError("accepted patch has unknown or missing fields");
	}
	if (!Array.isArray(value.changedPaths)) throw new TypeError("accepted patch changedPaths must be an array");
	const changedPaths = value.changedPaths.map(parseRepoPath);
	if (new Set(changedPaths).size !== changedPaths.length) throw new TypeError("accepted patch changedPaths must not contain duplicates");
	const stats = parsePatchStatistics(value.stats);
	if (stats.filesChanged !== changedPaths.length) throw new TypeError("accepted patch filesChanged must equal changedPaths length");
	return {
		artifact: parseArtifactIdentity(value.artifact),
		headCommit: parseGitCommitId(value.headCommit),
		changedPaths,
		stats,
		baseTree: parseGitTreeId(value.baseTree),
		resultTree: parseGitTreeId(value.resultTree),
	};
}

export function parseAcceptedStateTransition(value: unknown): AcceptedStateTransition {
	if (!hasOnlyFields(value, ["patch"])) throw new TypeError("accepted-state transition must contain only patch");
	return { patch: parseAcceptedPatch(value.patch) };
}

export function parseGitCommitId(value: unknown): GitCommitId {
	return gitObjectId(value, "headCommit") as GitCommitId;
}

export function parseGitTreeId(value: unknown): GitTreeId {
	return gitObjectId(value, "tree") as GitTreeId;
}

function gitObjectId(value: unknown, name: string): string {
	if (typeof value !== "string" || !GIT_OBJECT_ID.test(value)) throw new TypeError(`${name} must be a lowercase Git object id`);
	return value;
}

function parsePatchStatistics(value: unknown): PatchStatistics {
	if (!hasOnlyFields(value, ["filesChanged", "insertions", "deletions"])) throw new TypeError("patch statistics must contain only filesChanged, insertions, and deletions");
	for (const field of ["filesChanged", "insertions", "deletions"] as const) {
		if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0) throw new TypeError(`patch statistics ${field} must be a non-negative safe integer`);
	}
	return { filesChanged: Number(value.filesChanged), insertions: Number(value.insertions), deletions: Number(value.deletions) };
}

function hasOnlyFields(value: unknown, fields: string[]): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}
