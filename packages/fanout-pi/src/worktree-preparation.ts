import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeRepoPath } from "./fanout-git.ts";

export const SHARED_WORKTREE_PATHS_ENV = "FANOUT_WORKTREE_SHARED_PATHS";

export function parseSharedWorktreePaths(value = process.env[SHARED_WORKTREE_PATHS_ENV]): string[] {
	if (value === undefined || value === "") return [];
	let parsed: unknown;
	try { parsed = JSON.parse(value); } catch { throw new Error(`${SHARED_WORKTREE_PATHS_ENV} must be a JSON array of repository-relative paths`); }
	if (!Array.isArray(parsed) || parsed.some((path) => typeof path !== "string")) throw new Error(`${SHARED_WORKTREE_PATHS_ENV} must be a JSON array of repository-relative paths`);
	const paths = parsed.map(sharedPath);
	if (new Set(paths).size !== paths.length) throw new Error(`${SHARED_WORKTREE_PATHS_ENV} must not contain duplicate paths`);
	return paths;
}

export function validateSharedWorktreePaths(repoRoot: string, paths: readonly string[]): void {
	const normalized = paths.map(sharedPath);
	if (new Set(normalized).size !== normalized.length) throw new Error(`${SHARED_WORKTREE_PATHS_ENV} must not contain duplicate paths`);
	for (const path of normalized) {
		if (!existsSync(join(repoRoot, path))) throw new Error(`shared worktree path is not installed: ${path}`);
		const ignored = spawnSync("git", ["-c", "core.fsmonitor=false", "check-ignore", "-q", "--", path], { cwd: repoRoot });
		if (ignored.status !== 0) throw new Error(ignored.status === 1 ? `shared worktree path must be ignored by Git: ${path}` : `could not verify shared worktree path ${path}: ${ignored.error?.message ?? ignored.stderr?.toString("utf8").trim() ?? `exit ${ignored.status}`}`);
	}
}

export function prepareSharedWorktreePaths(repoRoot: string, worktreePath: string, paths: readonly string[]): void {
	validateSharedWorktreePaths(repoRoot, paths);
	for (const value of paths) {
		const path = sharedPath(value);
		const source = join(repoRoot, path);
		const target = join(worktreePath, path);
		if (existsSync(target)) throw new Error(`shared worktree path collides with reconstructed content: ${path}`);
		mkdirSync(dirname(target), { recursive: true });
		const directory = statSync(source).isDirectory();
		symlinkSync(source, target, process.platform === "win32" && directory ? "junction" : directory ? "dir" : "file");
	}
}

function sharedPath(value: string): string {
	const path = normalizeRepoPath(value);
	if (path.includes("/")) throw new Error(`${SHARED_WORKTREE_PATHS_ENV} entries must be top-level repository paths`);
	return path;
}
