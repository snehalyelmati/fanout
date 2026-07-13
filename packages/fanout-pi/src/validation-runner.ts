import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { parseValidationCommands, type ValidationCommand } from "../../fanout-core/src/validation-command.ts";

export type ValidationCommandOutcome = "passed" | "nonzero" | "spawn" | "signal" | "timeout" | "aborted" | "unexecuted";

export interface ValidationCommandResult {
	id: string;
	index: number;
	command: ValidationCommand;
	outcome: ValidationCommandOutcome;
	resolvedExecutable?: string;
	resolvedCwd: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	spawnError?: string;
	stdout: string;
	stderr: string;
	durationMs: number;
}

export interface ValidationRunResult {
	status: "passed" | "failed";
	executedCount: number;
	durationMs: number;
	commands: ValidationCommandResult[];
}

export interface ValidationRunnerOptions {
	checkoutRoot: string;
	expectedPlatform: NodeJS.Platform;
	scopeId?: string;
	timeoutMs?: number;
	inheritedEnv?: NodeJS.ProcessEnv;
	controllerEnv?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
}

export interface PreparedValidationCommand {
	command: ValidationCommand;
	resolvedExecutable: string;
	resolvedCwd: string;
	env: Record<string, string>;
}

export function preflightValidationCommands(value: unknown, options: ValidationRunnerOptions): PreparedValidationCommand[] {
	if (options.expectedPlatform !== process.platform) throw new Error(`validation platform mismatch: planned ${options.expectedPlatform}, running ${process.platform}; replan on this host`);
	const commands = parseValidationCommands(value, options.expectedPlatform);
	const root = validationRoot(options.checkoutRoot);
	return commands.map((command, index) => {
		try {
			return prepareCommand(command, root, options);
		} catch (error) {
			throw new Error(`validation command ${index} failed preflight: ${errorMessage(error)}`);
		}
	});
}

export async function runValidationCommands(value: unknown, options: ValidationRunnerOptions): Promise<ValidationRunResult> {
	const timeoutMs = positiveInteger(options.timeoutMs ?? 600_000, "timeoutMs");
	const prepared = preflightValidationCommands(value, options);
	const root = validationRoot(options.checkoutRoot);
	const scopeId = options.scopeId ?? "validation";
	const commands: ValidationCommandResult[] = prepared.map((item, index) => ({
		id: `${scopeId}/${index}`,
		index,
		command: item.command,
		outcome: "unexecuted",
		resolvedExecutable: item.resolvedExecutable,
		resolvedCwd: item.resolvedCwd,
		exitCode: null,
		signal: null,
		stdout: "",
		stderr: "",
		durationMs: 0,
	}));

	for (const [index, initial] of prepared.entries()) {
		if (options.signal?.aborted) {
			commands[index] = { ...commands[index], outcome: "aborted" };
			break;
		}
		let current: PreparedValidationCommand;
		try {
			current = prepareCommand(initial.command, root, options);
		} catch (error) {
			commands[index] = { ...commands[index], outcome: "spawn", spawnError: errorMessage(error) };
			break;
		}
		commands[index] = await runCommand(commands[index], current, timeoutMs, options.signal);
		if (commands[index].outcome !== "passed") break;
	}

	const executedCount = commands.filter((command) => command.outcome !== "unexecuted").length;
	return {
		status: executedCount === commands.length && commands.every((command) => command.outcome === "passed") ? "passed" : "failed",
		executedCount,
		durationMs: roundMs(commands.reduce((total, command) => total + command.durationMs, 0)),
		commands,
	};
}

function prepareCommand(command: ValidationCommand, root: string, options: ValidationRunnerOptions): PreparedValidationCommand {
	const candidateCwd = command.cwd === undefined ? root : resolve(root, command.cwd);
	const resolvedCwd = realpathSync(candidateCwd);
	if (!statSync(resolvedCwd).isDirectory()) throw new Error(`validation cwd is not a directory: ${command.cwd ?? "."}`);
	if (!contains(root, resolvedCwd)) throw new Error(`validation cwd escapes checkout through a symlink: ${command.cwd ?? "."}`);
	const env = mergeEnvironment(options.inheritedEnv ?? process.env, command.env, options.controllerEnv, options.expectedPlatform);
	return { command, resolvedCwd, env, resolvedExecutable: resolveExecutable(command.executable, resolvedCwd, env, options.expectedPlatform) };
}

function validationRoot(value: string): string {
	const root = realpathSync(resolve(value));
	if (!statSync(root).isDirectory()) throw new Error(`validation checkout is not a directory: ${value}`);
	return root;
}

function resolveExecutable(executable: string, cwd: string, env: Record<string, string>, platform: NodeJS.Platform): string {
	const hasSeparator = executable.includes("/") || (platform === "win32" && executable.includes("\\"));
	const candidates = isAbsolute(executable)
		? executableCandidates(executable, env, platform)
		: hasSeparator
			? executableCandidates(resolve(cwd, executable), env, platform)
			: pathDirectories(env, platform, cwd).flatMap((directory) => executableCandidates(resolve(directory || cwd, executable), env, platform));
	for (const candidate of candidates) {
		try {
			const path = realpathSync(candidate);
			if (!statSync(path).isFile()) continue;
			if (platform !== "win32") accessSync(path, constants.X_OK);
			return path;
		} catch {
			// Try the next PATH/PATHEXT candidate.
		}
	}
	throw new Error(`executable is missing or not launchable: ${executable}`);
}

function executableCandidates(path: string, env: Record<string, string>, platform: NodeJS.Platform): string[] {
	if (platform !== "win32") return [path];
	if (/\.[^\\/.]+$/.test(path)) return /\.(?:COM|EXE)$/i.test(path) ? [path] : [];
	const extensions = environmentValue(env, "PATHEXT", platform)?.split(";").filter((extension) => /^\.(?:COM|EXE)$/i.test(extension)) ?? [".COM", ".EXE"];
	return [path, ...extensions.map((extension) => `${path}${extension.toLowerCase()}`), ...extensions.map((extension) => `${path}${extension.toUpperCase()}`)];
}

function pathDirectories(env: Record<string, string>, platform: NodeJS.Platform, cwd: string): string[] {
	const path = environmentValue(env, "PATH", platform);
	return [...(platform === "win32" ? [cwd] : []), ...(path === undefined ? [] : path.split(platform === "win32" ? ";" : delimiter))];
}

function environmentValue(env: Record<string, string>, name: string, platform: NodeJS.Platform): string | undefined {
	const key = platform === "win32" ? Object.keys(env).find((candidate) => candidate.toUpperCase() === name) : name;
	return key === undefined ? undefined : env[key];
}

function mergeEnvironment(
	inherited: NodeJS.ProcessEnv,
	literal: Record<string, string> | undefined,
	controller: NodeJS.ProcessEnv | undefined,
	platform: NodeJS.Platform,
): Record<string, string> {
	const env: Record<string, string> = Object.create(null);
	for (const source of [inherited, literal, controller]) for (const [name, value] of Object.entries(source ?? {})) {
		if (value === undefined) continue;
		if (platform === "win32") for (const existing of Object.keys(env)) if (existing.toUpperCase() === name.toUpperCase()) delete env[existing];
		env[name] = value;
	}
	return env;
}

async function runCommand(
	base: ValidationCommandResult,
	prepared: PreparedValidationCommand,
	timeoutMs: number,
	abortSignal: AbortSignal | undefined,
): Promise<ValidationCommandResult> {
	const started = performance.now();
	return await new Promise((finish) => {
		let stdout = "";
		let stderr = "";
		let spawnError: string | undefined;
		let interrupted: "timeout" | "aborted" | undefined;
		let forceKill: ReturnType<typeof setTimeout> | undefined;
		const detached = process.platform !== "win32";
		const child = spawn(prepared.resolvedExecutable, prepared.command.args, {
			cwd: prepared.resolvedCwd,
			env: prepared.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached,
			shell: false,
		});
		const killTree = (signal: NodeJS.Signals) => {
			try {
				if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/t", ...(signal === "SIGKILL" ? ["/f"] : [])], { stdio: "ignore" });
				else if (detached && child.pid) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch {
				// The process may already have exited.
			}
		};
		const interrupt = (outcome: "timeout" | "aborted") => {
			if (interrupted) return;
			interrupted = outcome;
			killTree("SIGTERM");
			forceKill = setTimeout(() => killTree("SIGKILL"), 250);
		};
		const timeout = setTimeout(() => interrupt("timeout"), timeoutMs);
		const abort = () => interrupt("aborted");
		abortSignal?.addEventListener("abort", abort, { once: true });
		if (abortSignal?.aborted) abort();
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => { stdout += chunk; });
		child.stderr.on("data", (chunk: string) => { stderr += chunk; });
		child.on("error", (error) => { spawnError = error.message; });
		child.on("close", (exitCode, signal) => {
			clearTimeout(timeout);
			if (interrupted) killTree("SIGKILL");
			if (forceKill) clearTimeout(forceKill);
			abortSignal?.removeEventListener("abort", abort);
			const outcome: ValidationCommandOutcome = interrupted ?? (spawnError ? "spawn" : signal ? "signal" : exitCode === 0 ? "passed" : "nonzero");
			finish({
				...base,
				outcome,
				resolvedExecutable: prepared.resolvedExecutable,
				resolvedCwd: prepared.resolvedCwd,
				exitCode,
				signal,
				...(spawnError === undefined ? {} : { spawnError }),
				stdout,
				stderr,
				durationMs: roundMs(performance.now() - started),
			});
		});
	});
}

function contains(root: string, path: string): boolean {
	const child = relative(root, path);
	return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
	return value;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function roundMs(value: number): number {
	return Math.round(value * 1000) / 1000;
}
