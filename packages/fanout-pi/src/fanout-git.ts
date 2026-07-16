import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { isAbsolute, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { AcceptedPatch } from "../../fanout-core/src/artifact-identity.ts";
import { parseResource, resourceCovers as canonicalResourceCovers } from "../../fanout-core/src/repository-resource.ts";
import { contractWriteResources, type WorkContract } from "../../fanout-core/src/work-contract.ts";

export interface ProcessResult {
	exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; durationMs: number; firstOutputMs?: number; timedOut: boolean; spawnError?: string;
}

export interface OwnershipViolation {
	file: string;
	code: "forbidden-change" | "unauthorized-change";
	reason: string;
}

export async function runProcess(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; isFirstOutput?: (line: string) => boolean; signal?: AbortSignal } = { cwd: process.cwd() }): Promise<ProcessResult> {
	options.signal?.throwIfAborted();
	const started = performance.now();
	return await new Promise((finish) => {
		let stdout = "", stderr = "", lineBuffer = "", firstOutputMs: number | undefined, timedOut = false, spawnError: string | undefined, settled = false;
		let closeResult: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined, forceKill: ReturnType<typeof setTimeout> | undefined, forceKillElapsed = false;
		const detached = process.platform !== "win32";
		const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], detached });
		const killTree = (signal: NodeJS.Signals) => { try { if (detached && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch {} };
		const complete = (exitCode: number | null, signal: NodeJS.Signals | null) => {
			if (settled) return; settled = true; if (timeout) clearTimeout(timeout); if (forceKill) clearTimeout(forceKill);
			options.signal?.removeEventListener("abort", abort);
			if (firstOutputMs === undefined && lineBuffer && options.isFirstOutput?.(lineBuffer)) firstOutputMs = roundMs(performance.now() - started);
			finish({ exitCode, signal, stdout, stderr, durationMs: roundMs(performance.now() - started), firstOutputMs, timedOut, spawnError });
		};
		const abort = () => { killTree("SIGTERM"); forceKill = setTimeout(() => killTree("SIGKILL"), 2_000); };
		const timeout = options.timeoutMs ? setTimeout(() => { timedOut = true; killTree("SIGTERM"); forceKill = setTimeout(() => { forceKillElapsed = true; killTree("SIGKILL"); if (closeResult) complete(closeResult.exitCode, closeResult.signal); }, 2_000); }, options.timeoutMs) : undefined;
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) abort();
		child.stdout?.on("data", (chunk: Buffer | string) => { const text = String(chunk); stdout += text; if (!options.isFirstOutput || firstOutputMs !== undefined) return; lineBuffer += text; const lines = lineBuffer.split("\n"); lineBuffer = lines.pop() ?? ""; if (lines.some(options.isFirstOutput)) firstOutputMs = roundMs(performance.now() - started); });
		child.stderr?.on("data", (chunk: Buffer | string) => { stderr += String(chunk); });
		child.on("error", (error) => { spawnError = error.message; });
		child.on("close", (exitCode, signal) => { if (timedOut && forceKill && !forceKillElapsed) { closeResult = { exitCode, signal }; return; } if (!timedOut) killTree("SIGKILL"); complete(exitCode, signal); });
	});
}

export function checkContractOwnership(contract: WorkContract, patch: AcceptedPatch, attemptDir: string, repoRoot: string): { ok: boolean; violations: OwnershipViolation[] } {
	const violations = pathAuthorityViolations(patch, contractWriteResources(contract), contract.forbiddenWrites.map((entry) => entry.resource), "outside typed work-contract ownership");
	for (const change of contract.changes) {
		const before = change.kind === "move" ? treeHasResource(repoRoot, patch.baseTree, change.from.resource) : treeHasResource(repoRoot, patch.baseTree, change.target.resource);
		const after = change.kind === "move" ? treeHasResource(repoRoot, patch.resultTree, change.to.resource) : treeHasResource(repoRoot, patch.resultTree, change.target.resource);
		if (change.kind === "modify" && (!before || !after)) violations.push({ file: change.target.resource.path, code: "unauthorized-change", reason: "typed modify intent cannot create, delete, or move its endpoint" });
		if (change.kind === "create" && (before || !after)) violations.push({ file: change.target.resource.path, code: "unauthorized-change", reason: "typed create intent does not match the exact pre/post trees" });
		if (change.kind === "delete" && (!before || after)) violations.push({ file: change.target.resource.path, code: "unauthorized-change", reason: "typed delete intent does not match the exact pre/post trees" });
		if (change.kind === "move" && (!before || !after || treeHasResource(repoRoot, patch.resultTree, change.from.resource) || treeHasResource(repoRoot, patch.baseTree, change.to.resource))) violations.push({ file: change.to.resource.path, code: "unauthorized-change", reason: "typed move intent does not match the exact pre/post trees" });
	}
	const result = { ok: violations.length === 0, violations }; writeJson(resolve(attemptDir, "ownership-check.json"), result); return result;
}

export function checkFinalRepairOwnership(contract: WorkContract, patch: AcceptedPatch, attemptDir: string): { ok: boolean; violations: OwnershipViolation[] } {
	const violations = pathAuthorityViolations(patch, contractWriteResources(contract), contract.forbiddenWrites.map((entry) => entry.resource), "outside derived upstream final-repair authority");
	const result = { ok: violations.length === 0, violations }; writeJson(resolve(attemptDir, "ownership-check.json"), result); return result;
}

export function ownershipViolationFactCode(violations: readonly OwnershipViolation[]): OwnershipViolation["code"] {
	return violations.some((violation) => violation.code === "forbidden-change") ? "forbidden-change" : "unauthorized-change";
}

function pathAuthorityViolations(patch: AcceptedPatch, owned: ReturnType<typeof contractWriteResources>, forbidden: ReturnType<typeof contractWriteResources>, outsideReason: string) {
	return patch.changedPaths.flatMap((path): OwnershipViolation[] => { const candidate = parseResource({ kind: "file", path }); return [...(owned.some((resource) => canonicalResourceCovers(resource, candidate)) ? [] : [{ file: path, code: "unauthorized-change", reason: outsideReason } as const]), ...(forbidden.some((resource) => canonicalResourceCovers(resource, candidate)) ? [{ file: path, code: "forbidden-change", reason: "typed forbidden resource" } as const] : [])]; });
}

function treeHasResource(repoRoot: string, tree: string, resource: { path: string; kind: "file" | "directory" }): boolean { const result = runGit(repoRoot, ["cat-file", "-t", `${tree}:${resource.path}`]); return result.status === 0 && (resource.kind === "directory" ? result.stdout.trim() === "tree" : result.stdout.trim() !== "tree"); }
export function normalizeRepoPath(value: string): string { let normalized = value.trim().replace(/\\/g, "/"); while (normalized.startsWith("./")) normalized = normalized.slice(2); normalized = normalized.replace(/\/+$/, ""); if (!normalized || /[\0-\x1f\x7f]/.test(normalized) || isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) throw new Error(`unsafe repository path: ${value}`); if (normalized.split("/").some((segment) => segment === ".." || segment === "")) throw new Error(`unsafe repository path: ${value}`); normalized = posix.normalize(normalized).replace(/\/$/, ""); if (!normalized || normalized === "." || normalized === ".git" || normalized.startsWith(".git/") || normalized.startsWith("../")) throw new Error(`unsafe repository path: ${value}`); return normalized; }
export function artifactSegment(value: string): string { const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "node"; return `${slug}-${createHash("sha256").update(value).digest("hex").slice(0, 8)}`; }
export function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function runGit(cwd: string, args: string[]) { const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.error ? `${result.stderr ?? ""}\n${result.error.message}`.trim() : result.stderr ?? "" }; }
function roundMs(value: number): number { return Math.round(value * 1000) / 1000; }
