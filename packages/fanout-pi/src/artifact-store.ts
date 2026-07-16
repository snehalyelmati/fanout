import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
	artifactIdentity,
	parseArtifactIdentity,
	verifyArtifactBytes,
	type ArtifactIdentity,
} from "../../fanout-core/src/artifact-identity.ts";
import { parseRepoPath } from "../../fanout-core/src/repository-resource.ts";

export interface ArtifactPublication {
	path: string;
	bytes: Uint8Array;
}

export function readVerifiedArtifact(root: string, identityValue: unknown): Buffer {
	const identity = parseArtifactIdentity(identityValue);
	const path = artifactPath(root, identity.path, false);
	if (lstatSync(path).isSymbolicLink()) throw new Error(`artifact must not be a symbolic link: ${identity.path}`);
	const canonicalRoot = realpathSync(resolve(root));
	const canonicalPath = realpathSync(path);
	if (!isContained(canonicalPath, canonicalRoot)) throw new Error(`artifact escapes its root: ${identity.path}`);
	const bytes = readFileSync(canonicalPath);
	verifyArtifactBytes(identity, bytes);
	return bytes;
}

export function writeArtifactAtomically(root: string, relativePath: string, input: Uint8Array): ArtifactIdentity {
	const path = artifactPath(root, relativePath, true);
	const bytes = Buffer.from(input);
	const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, bytes, { flag: "wx" });
		renameSync(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
	return artifactIdentity(relativePath, bytes);
}

export function publishPlanningArtifacts(
	root: string,
	activePointerPath: string,
	artifacts: readonly ArtifactPublication[],
	activePointerBytes: Uint8Array,
): ArtifactIdentity[] {
	invalidateActiveSelection(root, activePointerPath);
	const pointer = parseRepoPath(activePointerPath);
	const paths = artifacts.map(({ path }) => parseRepoPath(path));
	if (paths.includes(pointer)) throw new Error("authoritative artifacts must not publish the active pointer early");
	if (new Set(paths).size !== paths.length) throw new Error("authoritative artifact paths must be unique");
	const identities = artifacts.map(({ path, bytes }) => writeArtifactAtomically(root, path, bytes));
	writeArtifactAtomically(root, activePointerPath, activePointerBytes);
	return identities;
}

export function invalidateActiveSelection(root: string, activePointerPath: string): void {
	rmSync(artifactPath(root, activePointerPath, true), { force: true });
}

function artifactPath(root: string, value: string, createParents: boolean): string {
	const relativePath = parseRepoPath(value);
	const resolvedRoot = resolve(root);
	if (createParents) mkdirSync(resolvedRoot, { recursive: true });
	const segments = relativePath.split("/");
	let parent = resolvedRoot;
	for (const segment of segments.slice(0, -1)) {
		parent = resolve(parent, segment);
		if (existsSync(parent)) {
			if (lstatSync(parent).isSymbolicLink()) throw new Error(`artifact parent must not be a symbolic link: ${relativePath}`);
		} else if (createParents) mkdirSync(parent);
	}
	const path = resolve(resolvedRoot, relativePath);
	if (!isContained(path, resolvedRoot)) throw new Error(`artifact escapes its root: ${relativePath}`);
	return path;
}

function isContained(path: string, root: string): boolean {
	const value = relative(root, path);
	return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}
