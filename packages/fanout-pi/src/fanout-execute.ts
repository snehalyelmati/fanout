import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadActiveExecutionPacket } from "../../fanout-core/src/active-packet.ts";
import { runDag, type DagRunResult } from "../../fanout-core/src/dag-scheduler.ts";
import type { FanoutExecutionPacket } from "../../fanout-core/src/execution-packet.ts";
import type { ExecutionRunSnapshot, ExecutionRunStatus } from "../../fanout-core/src/execution-run.ts";
import { createExecutionRecorder, type ExecutionRecorderPaths } from "./execution-recorder.ts";
import { normalizeRepoPath, runValidationCommands, writeJson, type ValidationResult } from "./fanout-git.ts";
import { createFanoutNodeExecutor } from "./fanout-node-executor.ts";

export interface ExecuteFanoutOptions {
	cwd: string;
	activePointerPath: string;
	projectArtifactRoot: string;
	extensionEntry: string;
	confirm?: (title: string, message: string) => boolean | Promise<boolean>;
	dryRun?: boolean;
	maxConcurrency?: number;
	failFast?: boolean;
	piCommand?: string;
	runId?: string;
	workerTimeoutMs?: number;
	validationTimeoutMs?: number;
}

export interface ExecuteFanoutResult {
	status: Exclude<ExecutionRunStatus, "running">;
	runId: string;
	packetPath: string;
	paths: ExecutionRecorderPaths;
	snapshot: Readonly<ExecutionRunSnapshot>;
	dag?: DagRunResult;
	finalValidation?: ValidationResult;
	error?: string;
	dryRun?: boolean;
}

export async function executeFanout(options: ExecuteFanoutOptions): Promise<ExecuteFanoutResult> {
	const loaded = loadActiveExecutionPacket(options.activePointerPath, options.projectArtifactRoot);
	rejectArtifactStorageInsideWorktree(options.cwd, loaded.projectArtifactRoot, loaded.artifactDir);
	const runId = options.runId ?? executionRunId();
	const releaseExecutionLock = acquireExecutionLock(executionLockPath(options.cwd, loaded.projectArtifactRoot), runId);
	try {
		return await executeLoadedFanout(options, loaded, runId);
	} finally {
		releaseExecutionLock();
	}
}

async function executeLoadedFanout(
	options: ExecuteFanoutOptions,
	loaded: ReturnType<typeof loadActiveExecutionPacket>,
	runId: string,
): Promise<ExecuteFanoutResult> {
	const recorder = createExecutionRecorder({ runId, packetPath: loaded.packetPath, nodeIds: loaded.packet.workUnits.map((unit) => unit.id) });
	recorder.appendEvent("execution_start", { packetPath: loaded.packetPath, artifactDir: recorder.runDir, dryRun: options.dryRun === true });
	recorder.appendEvent("packet_loaded", {
		packetPath: loaded.packetPath,
		activePointerPath: loaded.activePointerPath,
		pointerUpdatedAt: loaded.pointer.updatedAt,
		workUnitCount: loaded.packet.workUnits.length,
	});

	let dag: DagRunResult | undefined;
	let finalValidation: ValidationResult | undefined;
	try {
		recorder.appendEvent("preflight_start");
		const preflight = runPreflight(options.cwd, loaded.artifactDir, options.extensionEntry, options.piCommand ?? process.env.FANOUT_PI_COMMAND ?? "pi", loaded.packet.workUnits.flatMap((unit) => [...unit.ownedFiles, ...unit.readOnlyFiles]));
		recorder.appendEvent("preflight_end", preflight);
		if (!preflight.ok || !preflight.repoRoot) throw new Error(`Fanout preflight failed: ${preflight.errors.join("; ")}`);

		if (options.dryRun) {
			recorder.appendEvent("execution_finished", { status: "succeeded", dryRun: true });
			const snapshot = recorder.finish("succeeded", { dryRun: true });
			return { status: "succeeded", runId, packetPath: loaded.packetPath, paths: recorder.paths, snapshot, dryRun: true };
		}

		const maxConcurrency = positiveInteger(options.maxConcurrency, 2, "maxConcurrency");
		const confirmationMessage = confirmationSummary(loaded.packet, maxConcurrency, recorder.runDir);
		recorder.appendEvent("confirmation_requested", { message: confirmationMessage });
		const confirmed = options.confirm ? await options.confirm("Execute Fanout packet", confirmationMessage) : false;
		if (!confirmed) {
			recorder.appendEvent("execution_finished", { status: "aborted", reason: "confirmation_not_accepted" });
			const snapshot = recorder.finish("aborted");
			return { status: "aborted", runId, packetPath: loaded.packetPath, paths: recorder.paths, snapshot };
		}
		recorder.appendEvent("confirmation_accepted");

		const executor = createFanoutNodeExecutor({
			packet: loaded.packet,
			repoRoot: preflight.repoRoot,
			runDir: recorder.runDir,
			runId,
			extensionEntry: options.extensionEntry,
			recorder,
			piCommand: options.piCommand,
			workerTimeoutMs: options.workerTimeoutMs,
			validationTimeoutMs: options.validationTimeoutMs,
		});
		dag = await runDag(loaded.packet, {
			maxConcurrency,
			failFast: options.failFast ?? false,
			runNode: (unit) => executor.runNode(unit),
			recorder,
		});
		if (!dag.ok) return finishFailed(recorder, loaded.packetPath, runId, "one or more DAG nodes failed", dag);

		recorder.appendEvent("final_validation_started", { commands: loaded.packet.finalValidationPlan });
		finalValidation = await runValidationCommands(loaded.packet.finalValidationPlan, preflight.repoRoot, positiveInteger(options.validationTimeoutMs, 600_000, "validationTimeoutMs"));
		writeJson(resolve(recorder.runDir, "final-validation.json"), finalValidation);
		recorder.setFinalValidationStats({ commandCount: finalValidation.commandCount, durationMs: finalValidation.durationMs, status: finalValidation.status });
		recorder.appendEvent("final_validation_finished", finalValidation as unknown as Record<string, unknown>);
		if (finalValidation.status !== "passed") return finishFailed(recorder, loaded.packetPath, runId, "final validation failed", dag, finalValidation);

		recorder.appendEvent("execution_finished", { status: "succeeded" });
		const snapshot = recorder.finish("succeeded");
		return { status: "succeeded", runId, packetPath: loaded.packetPath, paths: recorder.paths, snapshot, dag, finalValidation };
	} catch (error) {
		const message = errorMessage(error);
		if (recorder.snapshot().status === "running") return finishFailed(recorder, loaded.packetPath, runId, message, dag, finalValidation, options.dryRun === true);
		throw error;
	}
}

function finishFailed(
	recorder: ReturnType<typeof createExecutionRecorder>,
	packetPath: string,
	runId: string,
	error: string,
	dag?: DagRunResult,
	finalValidation?: ValidationResult,
	dryRun = false,
): ExecuteFanoutResult {
	recorder.appendEvent("execution_finished", { status: "failed", error });
	const snapshot = recorder.finish("failed", { dryRun });
	return { status: "failed", runId, packetPath, paths: recorder.paths, snapshot, dag, finalValidation, error, dryRun: dryRun || undefined };
}

function runPreflight(
	cwd: string,
	packetArtifactDir: string,
	extensionEntry: string,
	piCommand: string,
	packetPaths: string[],
): { ok: boolean; repoRoot?: string; errors: string[] } {
	const errors: string[] = [];
	const topLevel = command("git", ["rev-parse", "--show-toplevel"], cwd);
	const repoRoot = topLevel.status === 0 ? resolve(topLevel.stdout.trim()) : undefined;
	if (!repoRoot) errors.push(`not a git worktree: ${topLevel.stderr.trim() || cwd}`);
	if (repoRoot && isContained(resolve(packetArtifactDir), repoRoot)) errors.push("execution artifacts must be outside the active repository");
	if (!existsSync(resolve(extensionEntry))) errors.push(`Fanout extension entry does not exist: ${resolve(extensionEntry)}`);

	if (repoRoot) {
		const head = command("git", ["rev-parse", "--verify", "HEAD"], repoRoot);
		if (head.status !== 0) errors.push("active git worktree must have a committed HEAD");
		const status = command("git", ["status", "--porcelain=v1", "--untracked-files=normal"], repoRoot);
		if (status.status !== 0) errors.push(`cannot inspect git worktree: ${status.stderr.trim()}`);
		else if (status.stdout.trim()) errors.push("active git worktree must be clean before /fanout-execute");
	}

	for (const value of packetPaths) {
		try {
			normalizeRepoPath(value);
		} catch (error) {
			errors.push(errorMessage(error));
		}
	}

	const pi = command(piCommand, ["--version"], cwd);
	if (pi.status !== 0) errors.push(`Pi worker command is unavailable: ${pi.stderr.trim() || piCommand}`);
	return { ok: errors.length === 0, repoRoot, errors };
}

function command(executable: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
	const result = spawnSync(executable, executable === "git" ? ["-c", "core.fsmonitor=false", ...args] : args, { cwd, encoding: "utf8", timeout: 30_000 });
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.error ? `${result.stderr ?? ""}\n${result.error.message}`.trim() : result.stderr ?? "",
	};
}

function confirmationSummary(packet: FanoutExecutionPacket, maxConcurrency: number, runDir: string): string {
	const ownedFiles = unique(packet.workUnits.flatMap((unit) => unit.ownedFiles));
	const validationCommands = unique([...packet.workUnits.flatMap((unit) => unit.validationCommands), ...packet.finalValidationPlan]);
	return [
		`Objective: ${packet.objective}`,
		`Work units: ${packet.workUnits.length}`,
		`Maximum concurrency: ${maxConcurrency}`,
		`Owned files/resources: ${ownedFiles.length ? ownedFiles.join(", ") : "none"}`,
		`Validation commands: ${validationCommands.length ? validationCommands.join(" | ") : "none"}`,
		"Accepted patches will be applied to the active worktree after ownership and validation gates pass.",
		`Audit artifacts: ${runDir}`,
	].join("\n");
}

function executionRunId(): string {
	return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function rejectArtifactStorageInsideWorktree(cwd: string, projectArtifactRoot: string, packetArtifactDir: string): void {
	const topLevel = command("git", ["rev-parse", "--show-toplevel"], cwd);
	if (topLevel.status !== 0 || !topLevel.stdout.trim()) return;
	const repoRoot = resolve(topLevel.stdout.trim());
	const realRepoRoot = realPath(repoRoot);
	for (const artifactPath of [projectArtifactRoot, packetArtifactDir]) {
		if (isContained(resolve(artifactPath), repoRoot) || isContained(realPath(artifactPath), realRepoRoot)) {
			throw new Error("execution artifacts must be outside the active repository");
		}
	}
}

function acquireExecutionLock(lockPath: string, runId: string): () => void {
	mkdirSync(dirname(lockPath), { recursive: true });
	const owner = { runId, pid: process.pid };
	try {
		writeFileSync(lockPath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			let existing: { runId?: string; pid?: number } = {};
			try {
				existing = JSON.parse(readFileSync(lockPath, "utf8"));
			} catch {
				// The existing lock is authoritative even when its owner cannot be read.
			}
			throw new Error(`Fanout execution is already locked by ${existing.runId || "another execution"} at ${lockPath}`);
		}
		throw error;
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		try {
			const existing = JSON.parse(readFileSync(lockPath, "utf8"));
			if (existing.runId === runId && existing.pid === process.pid) unlinkSync(lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	};
}

function executionLockPath(cwd: string, projectArtifactRoot: string): string {
	const gitDir = command("git", ["rev-parse", "--absolute-git-dir"], cwd);
	if (gitDir.status === 0 && gitDir.stdout.trim()) {
		const path = resolve(gitDir.stdout.trim());
		try {
			return join(realpathSync(path), "fanout-execution.lock");
		} catch {
			return join(path, "fanout-execution.lock");
		}
	}
	return join(projectArtifactRoot, "execution.lock");
}

function realPath(path: string): string {
	try {
		return realpathSync(resolve(path));
	} catch {
		return resolve(path);
	}
}

function isContained(path: string, root: string): boolean {
	const value = relative(root, path);
	return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`);
	return result;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values));
}
