import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseArtifactIdentity, type ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { parseValidationCommands, type ValidationCommand } from "../../fanout-core/src/validation-command.ts";
import { readVerifiedArtifact, writeArtifactAtomically } from "./artifact-store.ts";
import { runValidationCommands, type ValidationCommandResult, type ValidationRunResult } from "./validation-runner.ts";

export const FANOUT_VALIDATE_TOOL = "fanout_validate";
export const WORKER_VALIDATION_MANIFEST_SCHEMA = "fanout.worker-validation-manifest";
export const WORKER_VALIDATION_MANIFEST_VERSION = 1;
const MANIFEST_PATH = "worker-validation-manifest.json";
const MODEL_VISIBLE_FAILURE_OUTPUT_LIMIT = 8_000;

export interface WorkerValidationManifest {
	schema: typeof WORKER_VALIDATION_MANIFEST_SCHEMA;
	version: typeof WORKER_VALIDATION_MANIFEST_VERSION;
	runId: string;
	nodeId: string;
	attemptId: string;
	attemptRoot: string;
	worktreeRoot: string;
	platform: NodeJS.Platform;
	commands: ValidationCommand[];
	timeoutMs: number;
}

export interface WorkerValidationContext {
	attemptRoot: string;
	worktreeRoot: string;
	identity: ArtifactIdentity;
	expected: Pick<WorkerValidationManifest, "runId" | "nodeId" | "attemptId">;
}

export function publishWorkerValidationManifest(
	attemptRoot: string,
	input: Omit<WorkerValidationManifest, "schema" | "version" | "attemptRoot" | "worktreeRoot" | "commands"> & { worktreeRoot: string; commands: unknown },
): ArtifactIdentity {
	const manifest: WorkerValidationManifest = {
		schema: WORKER_VALIDATION_MANIFEST_SCHEMA,
		version: WORKER_VALIDATION_MANIFEST_VERSION,
		runId: canonicalText(input.runId, "runId"),
		nodeId: canonicalText(input.nodeId, "nodeId"),
		attemptId: canonicalText(input.attemptId, "attemptId"),
		attemptRoot: realpathSync(resolve(attemptRoot)),
		worktreeRoot: realpathSync(resolve(input.worktreeRoot)),
		platform: input.platform,
		commands: parseValidationCommands(input.commands, input.platform),
		timeoutMs: positiveInteger(input.timeoutMs, "timeoutMs"),
	};
	return writeArtifactAtomically(manifest.attemptRoot, MANIFEST_PATH, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
}

export function loadWorkerValidationContext(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): WorkerValidationContext | undefined {
	if (!env.FANOUT_VALIDATION_MANIFEST) return undefined;
	const attemptRoot = requiredPath(env.FANOUT_WORKER_DIR, "FANOUT_WORKER_DIR");
	const worktreeRoot = requiredPath(env.FANOUT_WORKTREE_ROOT, "FANOUT_WORKTREE_ROOT");
	const identity = parseArtifactIdentity(JSON.parse(env.FANOUT_VALIDATION_MANIFEST));
	const expected = {
		runId: requiredText(env.FANOUT_RUN_ID, "FANOUT_RUN_ID"),
		nodeId: requiredText(env.FANOUT_NODE_ID, "FANOUT_NODE_ID"),
		attemptId: requiredText(env.FANOUT_ATTEMPT_ID, "FANOUT_ATTEMPT_ID"),
	};
	if (realpathSync(resolve(cwd)) !== worktreeRoot) throw new Error("worker validation process cwd does not match the verified worktree");
	const context = { attemptRoot, worktreeRoot, identity, expected };
	readManifest(context);
	return context;
}

export function registerWorkerValidationTool(pi: Pick<ExtensionAPI, "registerTool">, context: WorkerValidationContext): void {
	pi.registerTool({
		name: FANOUT_VALIDATE_TOOL,
		label: "Fanout Validate",
		description: "Run only this worker attempt's immutable contract-declared validation commands. Call alone after edits; controller validation remains authoritative.",
		parameters: { type: "object", properties: {}, additionalProperties: false } as any,
		execute: async (toolCallId, _params, signal, _onUpdate, ctx) => runWorkerValidation(context, toolCallId, signal, ctx.cwd),
	});
}

export function workerValidationBatchBlockReason(toolName: string, toolCallId: string, messages: unknown[], active: boolean): string | undefined {
	if (toolName !== FANOUT_VALIDATE_TOOL) return undefined;
	if (!active) return "fanout_validate is available only inside a verified Fanout worker attempt.";
	const matching = messages.filter((message) => isRecord(message)
		&& message.role === "assistant"
		&& Array.isArray(message.content)
		&& message.content.some((part) => isRecord(part) && part.type === "toolCall" && callId(part) === toolCallId));
	const calls = matching.length === 1 && isRecord(matching[0]) && Array.isArray(matching[0].content)
		? matching[0].content.filter((part) => isRecord(part) && part.type === "toolCall")
		: [];
	if (calls.length === 1 && isRecord(calls[0]) && callId(calls[0]) === toolCallId) return undefined;
	return "Fanout workers require fanout_validate to be the only tool call in its assistant message; edit or inspect first, then validate alone.";
}

export async function runWorkerValidation(
	context: WorkerValidationContext,
	toolCallId: string,
	signal: AbortSignal | undefined,
	cwd: string,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: { evidence?: ArtifactIdentity; result?: ValidationRunResult; error?: string }; isError?: true }> {
	const startedAt = new Date().toISOString();
	let result: ValidationRunResult | undefined;
	let error: string | undefined;
	try {
		if (realpathSync(resolve(cwd)) !== context.worktreeRoot) throw new Error("fanout_validate cwd does not match the verified worker worktree");
		const manifest = readManifest(context);
		result = await runValidationCommands(manifest.commands, {
			checkoutRoot: manifest.worktreeRoot,
			expectedPlatform: manifest.platform,
			scopeId: `${manifest.attemptId}/worker-validation`,
			timeoutMs: manifest.timeoutMs,
			inheritedEnv: validationEnvironment(),
			signal,
		});
	} catch (caught) {
		error = errorMessage(caught);
	}

	let evidence: ArtifactIdentity | undefined;
	try {
		const bytes = Buffer.from(`${JSON.stringify({
			schema: "fanout.worker-validation-evidence",
			version: 1,
			manifest: context.identity,
			...context.expected,
			toolCallId,
			startedAt,
			finishedAt: new Date().toISOString(),
			...(result ? { result } : { error }),
		}, null, 2)}\n`);
		evidence = writeArtifactAtomically(context.attemptRoot, `worker-validation/${randomUUID()}.json`, bytes);
	} catch (caught) {
		error = [error, `validation evidence publication failed: ${errorMessage(caught)}`].filter(Boolean).join("; ");
	}

	const failed = Boolean(error) || result?.status !== "passed";
	return {
		content: [{ type: "text", text: error ? `fanout_validate failed: ${error}` : formatResult(result as ValidationRunResult) }],
		details: { ...(evidence ? { evidence } : {}), ...(result ? { result } : {}), ...(error ? { error } : {}) },
		...(failed ? { isError: true as const } : {}),
	};
}

function readManifest(context: WorkerValidationContext): WorkerValidationManifest {
	const manifest = parseManifest(JSON.parse(readVerifiedArtifact(context.attemptRoot, context.identity).toString("utf8")));
	if (manifest.attemptRoot !== context.attemptRoot || manifest.worktreeRoot !== context.worktreeRoot) throw new Error("worker validation manifest path identity mismatch");
	if (manifest.runId !== context.expected.runId || manifest.nodeId !== context.expected.nodeId || manifest.attemptId !== context.expected.attemptId) throw new Error("worker validation manifest attempt identity mismatch");
	if (manifest.platform !== process.platform) throw new Error(`worker validation platform mismatch: ${manifest.platform}`);
	return manifest;
}

function parseManifest(value: unknown): WorkerValidationManifest {
	const fields = ["schema", "version", "runId", "nodeId", "attemptId", "attemptRoot", "worktreeRoot", "platform", "commands", "timeoutMs"];
	if (!isRecord(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) throw new TypeError("worker validation manifest has unknown or missing fields");
	if (value.schema !== WORKER_VALIDATION_MANIFEST_SCHEMA || value.version !== WORKER_VALIDATION_MANIFEST_VERSION) throw new TypeError("unsupported worker validation manifest generation");
	const platform = value.platform as NodeJS.Platform;
	const attemptRoot = requiredPath(value.attemptRoot, "attemptRoot");
	const worktreeRoot = requiredPath(value.worktreeRoot, "worktreeRoot");
	if (attemptRoot !== value.attemptRoot || worktreeRoot !== value.worktreeRoot) throw new TypeError("worker validation manifest paths must be canonical");
	return {
		schema: WORKER_VALIDATION_MANIFEST_SCHEMA,
		version: WORKER_VALIDATION_MANIFEST_VERSION,
		runId: canonicalText(value.runId, "runId"),
		nodeId: canonicalText(value.nodeId, "nodeId"),
		attemptId: canonicalText(value.attemptId, "attemptId"),
		attemptRoot,
		worktreeRoot,
		platform,
		commands: parseValidationCommands(value.commands, platform),
		timeoutMs: positiveInteger(value.timeoutMs, "timeoutMs"),
	};
}

function formatResult(result: ValidationRunResult): string {
	const lines = [`fanout_validate ${result.status}: ${result.executedCount}/${result.commands.length} commands executed in ${result.durationMs}ms.`];
	for (const command of result.commands) {
		lines.push(`[${command.index}] ${command.outcome} (exit ${command.exitCode ?? "none"}, ${command.durationMs}ms)`);
		if (command.outcome !== "passed" && command.outcome !== "unexecuted") {
			const diagnostics = formatFailureDiagnostics(command);
			if (diagnostics) lines.push(diagnostics);
		}
	}
	lines.push("Advisory only: the controller will rerun authoritative validation.");
	return lines.join("\n");
}

function formatFailureDiagnostics(command: ValidationCommandResult): string {
	const output = [
		command.spawnError ? `spawn error: ${command.spawnError}` : "",
		command.stdout ? `stdout:\n${command.stdout}` : "",
		command.stderr ? `stderr:\n${command.stderr}` : "",
	].filter(Boolean).join("\n");
	if (output.length <= MODEL_VISIBLE_FAILURE_OUTPUT_LIMIT) return output;
	const marker = "\n... [fanout_validate output truncated; head and tail shown] ...\n";
	const retained = MODEL_VISIBLE_FAILURE_OUTPUT_LIMIT - marker.length;
	return `${output.slice(0, Math.ceil(retained / 2))}${marker}${output.slice(-Math.floor(retained / 2))}`;
}

function validationEnvironment(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const name of [
		"FANOUT_OBSERVABILITY_FILE", "FANOUT_RUN_ID", "FANOUT_NODE_ID", "FANOUT_ATTEMPT_ID", "FANOUT_WORKER_DIR", "FANOUT_WORKTREE_ROOT", "FANOUT_VALIDATION_MANIFEST",
		"DOUBLEWORD_OBSERVABILITY_FILE", "DOUBLEWORD_RUN_ID", "DOUBLEWORD_EXECUTION_MODE",
	]) delete env[name];
	return env;
}

function requiredPath(value: unknown, name: string): string {
	if (typeof value !== "string" || !value) throw new TypeError(`${name} is required`);
	return realpathSync(resolve(value));
}

function requiredText(value: unknown, name: string): string {
	if (typeof value !== "string" || !value) throw new TypeError(`${name} is required`);
	return value;
}

function canonicalText(value: unknown, name: string): string {
	const text = requiredText(value, name);
	if (text !== text.trim() || /\p{Cc}/u.test(text)) throw new TypeError(`${name} must be canonical text`);
	return text;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError(`${name} must be a positive safe integer`);
	return Number(value);
}

function callId(value: Record<string, unknown>): unknown {
	return value.id ?? value.toolCallId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
