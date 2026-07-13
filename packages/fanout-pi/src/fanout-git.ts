import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { FanoutWorkUnit } from "../../fanout-core/src/execution-packet.ts";
import type { AcceptedPatch } from "../../fanout-core/src/artifact-identity.ts";
import { parseResource, resourceCovers as canonicalResourceCovers } from "../../fanout-core/src/repository-resource.ts";
import { contractWriteResources, type WorkContract } from "../../fanout-core/src/work-contract.ts";

export interface ProcessResult {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	firstOutputMs?: number;
	timedOut: boolean;
	spawnError?: string;
}

export interface CapturedPatch {
	patchPath: string;
	changedFilesPath: string;
	patchStatPath: string;
	patch: string;
	changedFiles: string[];
	stats: {
		filesChanged: number;
		insertions: number;
		deletions: number;
	};
	workerCommitted: boolean;
}

export interface ValidationCommandResult {
	command: string;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	timedOut: boolean;
}

export interface ValidationResult {
	status: "passed" | "failed";
	commandCount: number;
	durationMs: number;
	commands: ValidationCommandResult[];
}

export interface ApplyResult {
	ok: boolean;
	check: { exitCode: number | null; stdout: string; stderr: string; durationMs: number };
	apply?: { exitCode: number | null; stdout: string; stderr: string; durationMs: number };
}

export type FileOverlay =
	| { path: string; type: "deleted" }
	| { path: string; type: "file"; content: Buffer; mode: number }
	| { path: string; type: "symlink"; target: string };

export type IntegratedChange = { type: "patch"; patchPath: string } | { type: "overlay"; files: FileOverlay[] };

export async function runProcess(
	command: string,
	args: string[],
	options: {
		cwd: string;
		env?: NodeJS.ProcessEnv;
		timeoutMs?: number;
		isFirstOutput?: (line: string) => boolean;
	} = { cwd: process.cwd() },
): Promise<ProcessResult> {
	const started = performance.now();
	return await new Promise((finish) => {
		let stdout = "";
		let stderr = "";
		let lineBuffer = "";
		let firstOutputMs: number | undefined;
		let timedOut = false;
		let spawnError: string | undefined;
		let settled = false;
		let closeResult: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined;
		let forceKill: ReturnType<typeof setTimeout> | undefined;
		let forceKillElapsed = false;
		const detached = process.platform !== "win32";
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached,
		});
		const killTree = (signal: NodeJS.Signals) => {
			try {
				if (detached && child.pid) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch {
				// The process group may already have exited.
			}
		};
		const complete = (exitCode: number | null, signal: NodeJS.Signals | null) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			if (forceKill) clearTimeout(forceKill);
			if (firstOutputMs === undefined && lineBuffer && options.isFirstOutput?.(lineBuffer)) firstOutputMs = roundMs(performance.now() - started);
			finish({ exitCode, signal, stdout, stderr, durationMs: roundMs(performance.now() - started), firstOutputMs, timedOut, spawnError });
		};
		const timeout = options.timeoutMs
			? setTimeout(() => {
					timedOut = true;
					killTree("SIGTERM");
					forceKill = setTimeout(() => {
						forceKillElapsed = true;
						killTree("SIGKILL");
						if (closeResult) complete(closeResult.exitCode, closeResult.signal);
					}, 2_000);
				}, options.timeoutMs)
			: undefined;

		child.stdout?.on("data", (chunk: Buffer | string) => {
			const text = String(chunk);
			stdout += text;
			if (!options.isFirstOutput || firstOutputMs !== undefined) return;
			lineBuffer += text;
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!options.isFirstOutput(line)) continue;
				firstOutputMs = roundMs(performance.now() - started);
				break;
			}
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			spawnError = error.message;
		});
		child.on("close", (exitCode, signal) => {
			if (timedOut && forceKill && !forceKillElapsed) {
				closeResult = { exitCode, signal };
				return;
			}
			if (!timedOut) killTree("SIGKILL");
			complete(exitCode, signal);
		});
	});
}

export function createAttemptWorktree(
	repoRoot: string,
	worktreePath: string,
	integratedChanges: IntegratedChange[],
	seedPatch?: string,
): { worktreePath: string; baseRef: string } {
	mkdirSync(dirname(worktreePath), { recursive: true });
	const hooksPath = emptyHooksPath(worktreePath);
	requireGit(repoRoot, ["-c", `core.hooksPath=${hooksPath}`, "worktree", "add", "--detach", worktreePath, "HEAD"]);
	for (const change of integratedChanges) {
		if (change.type === "patch") requireGit(worktreePath, ["apply", change.patchPath]);
		else applyFileOverlays(worktreePath, change.files);
	}
	if (integratedChanges.length) {
		requireGit(worktreePath, ["-c", `core.hooksPath=${hooksPath}`, "add", "-A"]);
		requireGit(worktreePath, [
			"-c",
			"user.name=Fanout",
			"-c",
			"user.email=fanout@local",
			"-c",
			`core.hooksPath=${hooksPath}`,
			"commit",
			"--no-gpg-sign",
			"--no-verify",
			"-m",
			"fanout integrated baseline",
		]);
	}
	const baseRef = requireGit(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();
	if (seedPatch) requireGit(worktreePath, ["apply", seedPatch]);
	return { worktreePath, baseRef };
}

export function captureFileOverlays(repoRoot: string, files: string[]): FileOverlay[] {
	const overlays: FileOverlay[] = [];
	for (const value of new Set(files)) {
		const path = normalizeRepoPath(value);
		const absolute = resolve(repoRoot, path);
		try {
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink()) overlays.push({ path, type: "symlink", target: readlinkSync(absolute) });
			else if (stat.isFile()) overlays.push({ path, type: "file", content: readFileSync(absolute), mode: stat.mode & 0o777 });
			else throw new Error(`cannot overlay non-file path: ${path}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") overlays.push({ path, type: "deleted" });
			else throw error;
		}
	}
	return overlays;
}

export function capturePatch(worktreePath: string, baseRef: string, attemptDir: string): CapturedPatch {
	markUntrackedForDiff(worktreePath);

	const currentHead = requireGit(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();
	const patch = worktreePatch(worktreePath, baseRef);
	const changedFiles = requireGit(worktreePath, ["diff", "--name-only", "--no-renames", "-z", baseRef, "--"]).stdout.split("\0").filter(Boolean).map(normalizeObservedRepoPath);
	const numstat = requireGit(worktreePath, ["diff", "--numstat", baseRef, "--"]).stdout;
	let insertions = 0;
	let deletions = 0;
	for (const line of numstat.split("\n")) {
		if (!line) continue;
		const [added, removed] = line.split("\t");
		if (/^\d+$/.test(added)) insertions += Number(added);
		if (/^\d+$/.test(removed)) deletions += Number(removed);
	}

	const patchPath = resolve(attemptDir, "patch.diff");
	const changedFilesPath = resolve(attemptDir, "changed-files.json");
	const patchStatPath = resolve(attemptDir, "patch-stat.json");
	const stats = { filesChanged: changedFiles.length, insertions, deletions };
	writeFileSync(patchPath, patch, "utf8");
	writeJson(changedFilesPath, changedFiles);
	writeJson(patchStatPath, stats);
	return { patchPath, changedFilesPath, patchStatPath, patch, changedFiles, stats, workerCommitted: currentHead !== baseRef };
}

export function worktreePatchMatches(worktreePath: string, baseRef: string, expectedPatch: string): boolean {
	markUntrackedForDiff(worktreePath);
	return requireGit(worktreePath, ["rev-parse", "HEAD"]).stdout.trim() === baseRef && worktreePatch(worktreePath, baseRef) === expectedPatch;
}

export function checkOwnership(
	unit: FanoutWorkUnit,
	patch: Pick<CapturedPatch, "changedFiles" | "workerCommitted">,
	worktreePath: string,
	baseRef: string,
	attemptDir: string,
): { ok: boolean; violations: Array<{ file: string; reason: string }> } {
	const owned = unit.ownedFiles.map((resource) => ({ path: normalizeRepoPath(resource), directory: /[\\/]$/.test(resource.trim()) }));
	const violations: Array<{ file: string; reason: string }> = [];
	if (unit.workerPacket.forbiddenChanges.length) violations.push({ file: "packet", reason: "legacy forbidden-change prose is not executable; replan with typed forbidden resources" });
	for (const file of patch.changedFiles) {
		if (!owned.some((resource) => resourceCovers(resource.path, file, worktreePath, baseRef, resource.directory))) violations.push({ file, reason: "outside owned files" });
	}
	if (patch.workerCommitted) violations.push({ file: "HEAD", reason: "worker commits are forbidden" });
	const result = { ok: violations.length === 0, violations };
	writeJson(resolve(attemptDir, "ownership-check.json"), result);
	return result;
}

export function checkContractOwnership(
	contract: WorkContract,
	patch: AcceptedPatch,
	attemptDir: string,
	repoRoot: string,
): { ok: boolean; violations: Array<{ file: string; reason: string }> } {
	const owned = contractWriteResources(contract);
	const forbidden = contract.forbiddenWrites.map((entry) => entry.resource);
	const violations: Array<{ file: string; reason: string }> = [];
	for (const path of patch.changedPaths) {
		const candidate = parseResource({ kind: "file", path });
		if (!owned.some((resource) => canonicalResourceCovers(resource, candidate))) violations.push({ file: path, reason: "outside typed work-contract ownership" });
		if (forbidden.some((resource) => canonicalResourceCovers(resource, candidate))) violations.push({ file: path, reason: "typed forbidden resource" });
	}
	for (const change of contract.changes) {
		const before = change.kind === "move" ? treeHasResource(repoRoot, patch.baseTree, change.from.resource) : treeHasResource(repoRoot, patch.baseTree, change.target.resource);
		const after = change.kind === "move" ? treeHasResource(repoRoot, patch.resultTree, change.to.resource) : treeHasResource(repoRoot, patch.resultTree, change.target.resource);
		if (change.kind === "modify" && (!before || !after)) violations.push({ file: change.target.resource.path, reason: "typed modify intent cannot create, delete, or move its endpoint" });
		if (change.kind === "create" && (before || !after)) violations.push({ file: change.target.resource.path, reason: "typed create intent does not match the exact pre/post trees" });
		if (change.kind === "delete" && (!before || after)) violations.push({ file: change.target.resource.path, reason: "typed delete intent does not match the exact pre/post trees" });
		if (change.kind === "move" && (!before || !after || treeHasResource(repoRoot, patch.resultTree, change.from.resource) || treeHasResource(repoRoot, patch.baseTree, change.to.resource))) violations.push({ file: change.to.resource.path, reason: "typed move intent does not match the exact pre/post trees" });
	}
	const result = { ok: violations.length === 0, violations };
	writeJson(resolve(attemptDir, "ownership-check.json"), result);
	return result;
}

function treeHasResource(repoRoot: string, tree: string, resource: { path: string; kind: "file" | "directory" }): boolean {
	const result = runGit(repoRoot, ["cat-file", "-t", `${tree}:${resource.path}`]);
	if (result.status !== 0) return false;
	return resource.kind === "directory" ? result.stdout.trim() === "tree" : result.stdout.trim() !== "tree";
}

export async function runValidationCommands(commands: string[], cwd: string, timeoutMs: number): Promise<ValidationResult> {
	const results: ValidationCommandResult[] = [];
	for (const command of commands) {
		const result = await runProcess(process.env.SHELL || "/bin/sh", ["-lc", command], { cwd, timeoutMs });
		results.push({ command, exitCode: result.exitCode, stdout: result.stdout, stderr: [result.stderr, result.spawnError].filter(Boolean).join("\n"), durationMs: result.durationMs, timedOut: result.timedOut });
		if (result.exitCode !== 0 || result.timedOut || result.spawnError) break;
	}
	return {
		status: results.length === commands.length && results.every((result) => result.exitCode === 0 && !result.timedOut) ? "passed" : "failed",
		commandCount: results.length,
		durationMs: roundMs(results.reduce((total, result) => total + result.durationMs, 0)),
		commands: results,
	};
}

export function writeValidationResult(attemptDir: string, validation: ValidationResult): void {
	writeJson(resolve(attemptDir, "validation.json"), validation);
}

export function checkAndApplyPatch(repoRoot: string, patchPath: string): ApplyResult {
	const checkStarted = performance.now();
	const check = runGit(repoRoot, ["apply", "--check", patchPath]);
	const checkResult = { exitCode: check.status, stdout: check.stdout, stderr: check.stderr, durationMs: roundMs(performance.now() - checkStarted) };
	if (check.status !== 0) return { ok: false, check: checkResult };
	const applyStarted = performance.now();
	const apply = runGit(repoRoot, ["apply", patchPath]);
	const applyResult = { exitCode: apply.status, stdout: apply.stdout, stderr: apply.stderr, durationMs: roundMs(performance.now() - applyStarted) };
	return { ok: apply.status === 0, check: checkResult, apply: applyResult };
}

export function reverseApplyPatch(repoRoot: string, patchPath: string): { ok: boolean; error?: string } {
	const check = runGit(repoRoot, ["apply", "--reverse", "--check", patchPath]);
	if (check.status !== 0) return { ok: false, error: check.stderr || check.stdout || "reverse apply check failed" };
	const apply = runGit(repoRoot, ["apply", "--reverse", patchPath]);
	return apply.status === 0 ? { ok: true } : { ok: false, error: apply.stderr || apply.stdout || "reverse apply failed" };
}

export function writeApplyResult(attemptDir: string, result: ApplyResult): void {
	writeJson(resolve(attemptDir, "apply-check.json"), result);
}

export function normalizeRepoPath(value: string): string {
	let normalized = value.trim().replace(/\\/g, "/");
	while (normalized.startsWith("./")) normalized = normalized.slice(2);
	normalized = normalized.replace(/\/+$/, "");
	if (!normalized || /[\0-\x1f\x7f]/.test(normalized) || isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) throw new Error(`unsafe repository path: ${value}`);
	const segments = normalized.split("/");
	if (segments.some((segment) => segment === ".." || segment === "")) throw new Error(`unsafe repository path: ${value}`);
	normalized = posix.normalize(normalized).replace(/\/$/, "");
	if (!normalized || normalized === "." || normalized === ".git" || normalized.startsWith(".git/") || normalized.startsWith("../")) throw new Error(`unsafe repository path: ${value}`);
	return normalized;
}

function normalizeObservedRepoPath(value: string): string {
	if (value !== value.trim() || value.includes("\\") || value.endsWith("/")) throw new Error(`unsafe observed Git path: ${JSON.stringify(value)}`);
	const normalized = normalizeRepoPath(value);
	if (normalized !== value) throw new Error(`lossy observed Git path normalization: ${JSON.stringify(value)}`);
	return normalized;
}

export function artifactSegment(value: string): string {
	const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "node";
	return `${slug}-${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

export function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resourceCovers(resource: string, file: string, worktreePath: string, baseRef: string, directoryIntent = false): boolean {
	if (resource === file) return true;
	if (!file.startsWith(`${resource}/`)) return false;
	if (directoryIntent) return true;
	const type = runGit(worktreePath, ["cat-file", "-t", `${baseRef}:${resource}`]);
	return type.status === 0 && type.stdout.trim() === "tree";
}

function markUntrackedForDiff(worktreePath: string): void {
	const untracked = requireGit(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]).stdout.split("\0").filter(Boolean);
	const hooksPath = emptyHooksPath(worktreePath);
	for (const file of untracked) requireGit(worktreePath, ["-c", `core.hooksPath=${hooksPath}`, "add", "-N", "--", file]);
}

function emptyHooksPath(worktreePath: string): string {
	return resolve(dirname(worktreePath), `empty-hooks-${randomUUID()}`);
}

function worktreePatch(worktreePath: string, baseRef: string): string {
	return requireGit(worktreePath, ["diff", "--binary", "--no-ext-diff", baseRef, "--"]).stdout;
}

function applyFileOverlays(worktreePath: string, files: FileOverlay[]): void {
	for (const file of files) {
		const path = resolve(worktreePath, normalizeRepoPath(file.path));
		rmSync(path, { recursive: true, force: true });
		if (file.type === "deleted") continue;
		mkdirSync(dirname(path), { recursive: true });
		if (file.type === "symlink") symlinkSync(file.target, path);
		else {
			writeFileSync(path, file.content);
			chmodSync(path, file.mode);
		}
	}
}

function requireGit(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
	const result = runGit(cwd, args);
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr.trim() || result.stdout.trim()}`);
	return result;
}

function runGit(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
	const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.error ? `${result.stderr ?? ""}\n${result.error.message}`.trim() : result.stderr ?? "",
	};
}

function roundMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}
