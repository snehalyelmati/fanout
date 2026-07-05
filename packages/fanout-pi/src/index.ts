import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getAgentDir, getSettingsPath, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDoublewordDevProviders } from "../../doubleword-provider/src/dev.ts";
import { setDoublewordActiveTurnIndex, setDoublewordRunId } from "../../doubleword-provider/src/index.ts";
import { BATCHING_DISCIPLINE, BATCHING_DISCIPLINE_MARKER } from "../../fanout-core/src/batching-discipline.ts";
import { configureFanoutTier } from "./fanout-config.ts";
import { durationMs, RUN_ID, setObservabilityCwd, writeJsonl } from "../../fanout-core/src/observability.ts";

const FANOUT_CONTEXT_MARKER = "## Fanout runtime context";

export default async function (pi: ExtensionAPI) {
	let agentStarted: number | undefined;
	let agentTurnCount = 0;
	let agentToolCallCount = 0;
	let activeTurnIndex: number | undefined;
	let activeModel: unknown;
	let activeThinking: unknown;
	const turnStats = new Map<number, { started: number; toolCallCount: number }>();
	const toolStarts = new Map<string, { started: number; turnIndex?: number }>();

	setDoublewordRunId(RUN_ID);
	await registerDoublewordDevProviders(pi);

	pi.registerCommand("fanout-config", {
		description: "Configure Fanout tier models",
		handler: async (args, ctx) => {
			await configureFanoutTier(args, ctx, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel(), getSettingsPath());
		},
	});

	pi.on("session_start", (_event, ctx) => {
		activeModel = ctx.model;
		activeThinking = pi.getThinkingLevel();
		writeFanoutRuntimeContext(ctx.cwd, activeModel, activeThinking);
		setObservabilityCwd(ctx.cwd);
		writeJsonl("session_start", { cwd: ctx.cwd, mode: ctx.mode }, ctx.cwd);
	});

	pi.on("model_select", (event, ctx) => {
		activeModel = event.model;
		writeFanoutRuntimeContext(ctx.cwd, activeModel, activeThinking);
	});

	pi.on("thinking_level_select", (event, ctx) => {
		activeThinking = event.level;
		writeFanoutRuntimeContext(ctx.cwd, activeModel ?? ctx.model, activeThinking);
	});

	pi.on("before_agent_start", (event, ctx) => {
		const batchingPrompt = event.systemPrompt.includes(BATCHING_DISCIPLINE_MARKER) ? event.systemPrompt : `${event.systemPrompt}\n\n${BATCHING_DISCIPLINE}`;
		return {
			systemPrompt: batchingPrompt.includes(FANOUT_CONTEXT_MARKER) ? batchingPrompt : `${batchingPrompt}\n\n${fanoutRuntimePrompt(ctx.cwd, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel())}`,
		};
	});

	pi.on("agent_start", (_event, ctx) => {
		agentStarted = performance.now();
		agentTurnCount = 0;
		agentToolCallCount = 0;
		writeJsonl("agent_start", {}, ctx.cwd);
	});

	pi.on("agent_end", (_event, ctx) => {
		writeJsonl(
			"agent_end",
			{
				durationMs: agentStarted === undefined ? undefined : durationMs(agentStarted),
				turnCount: agentTurnCount,
				toolCallCount: agentToolCallCount,
			},
			ctx.cwd,
		);
		agentStarted = undefined;
	});

	pi.on("turn_start", (event, ctx) => {
		activeTurnIndex = event.turnIndex;
		setDoublewordActiveTurnIndex(event.turnIndex);
		agentTurnCount++;
		turnStats.set(event.turnIndex, { started: performance.now(), toolCallCount: 0 });
		writeJsonl("turn_start", { turnIndex: event.turnIndex }, ctx.cwd);
	});

	pi.on("turn_end", (event, ctx) => {
		const stats = turnStats.get(event.turnIndex);
		turnStats.delete(event.turnIndex);
		writeJsonl(
			"turn_end",
			{
				turnIndex: event.turnIndex,
				durationMs: stats === undefined ? undefined : durationMs(stats.started),
				toolCallCount: stats?.toolCallCount ?? 0,
				toolResultCount: Array.isArray(event.toolResults) ? event.toolResults.length : undefined,
			},
			ctx.cwd,
		);
		if (activeTurnIndex === event.turnIndex) {
			activeTurnIndex = undefined;
			setDoublewordActiveTurnIndex(undefined);
		}
	});

	pi.on("tool_execution_start", (event, ctx) => {
		const turnIndex = activeTurnIndex;
		const stats = turnIndex === undefined ? undefined : turnStats.get(turnIndex);
		if (stats) stats.toolCallCount++;
		agentToolCallCount++;
		toolStarts.set(event.toolCallId, { started: performance.now(), turnIndex });
		writeJsonl("tool_start", { toolCallId: event.toolCallId, toolName: event.toolName, turnIndex }, ctx.cwd);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const started = toolStarts.get(event.toolCallId);
		toolStarts.delete(event.toolCallId);
		writeJsonl(
			"tool_end",
			{
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				turnIndex: started?.turnIndex,
				isError: event.isError,
				durationMs: started === undefined ? undefined : durationMs(started.started),
			},
			ctx.cwd,
		);
	});
}

function fanoutRuntimePrompt(cwd: string, model: unknown, thinking: unknown): string {
	const context = fanoutRuntimeContext(cwd, model, thinking);
	return `${FANOUT_CONTEXT_MARKER}\n\n- artifactRoot: ${context.artifactRoot}\n- projectArtifactRoot: ${context.projectArtifactRoot}\n- runtimeContextFile: ${context.runtimeContextFile}\n- tier1 default: current active Pi realtime model (${context.activeModel.provider}/${context.activeModel.model})\n- tier1 thinking: ${String(context.activeThinking ?? "auto")}\n- tier2 default: doubleword/zai-org/GLM-5.2-FP8 when provider/model/auth/async capability are proven; otherwise tier2 is unavailable and nodes fall back to tier1.\n- question tool: ask_user_question is required for /fanout-plan clarification.\n`;
}

function writeFanoutRuntimeContext(cwd: string, model: unknown, thinking: unknown): void {
	try {
		const context = fanoutRuntimeContext(cwd, model, thinking);
		mkdirSync(context.projectArtifactRoot, { recursive: true });
		writeFileSync(context.runtimeContextFile, `${JSON.stringify(context, null, 2)}\n`, "utf8");
	} catch {
		// Fanout runtime context is advisory; normal agent operation should continue.
	}
}

function fanoutRuntimeContext(cwd: string, model: unknown, thinking: unknown) {
	const settings = fanoutSettings(cwd);
	const artifactRoot = resolve(process.env.FANOUT_ARTIFACT_DIR || optionalString(settings.artifactDir) || join(getAgentDir(), "fanout"));
	const projectId = `${basename(cwd)}-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}`;
	const projectArtifactRoot = join(artifactRoot, projectId);
	return {
		artifactRoot,
		projectId,
		projectArtifactRoot,
		activePointerPath: join(projectArtifactRoot, "active-packet.json"),
		runtimeContextFile: join(projectArtifactRoot, "runtime-context.json"),
		activeModel: modelInfo(model),
		activeThinking: thinking ?? "auto",
		tierDefaults: {
			tier1: { provider: "auto", model: "auto", thinking: "auto", reason: "current active Pi realtime model", ...recordField(settings.tiers?.tier1) },
			tier2: { provider: "doubleword", model: "zai-org/GLM-5.2-FP8", thinking: "medium", enabled: "auto", reason: "async background worker model", ...recordField(settings.tiers?.tier2) },
		},
		executionDefaults: { tier2Retries: 2, fallbackTier: "tier1", revalidateOnly: true, ...recordField(settings.execution) },
	};
}

function fanoutSettings(cwd: string): Record<string, any> {
	return mergeRecord(readFanoutSettings(getSettingsPath()), readFanoutSettings(join(cwd, ".pi", "settings.json")));
}

function readFanoutSettings(path: string): Record<string, any> {
	try {
		if (!existsSync(path)) return {};
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return recordField(parsed?.fanout);
	} catch {
		return {};
	}
}

function mergeRecord(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
	const result = { ...base };
	for (const [key, value] of Object.entries(override)) {
		result[key] = isPlainRecord(result[key]) && isPlainRecord(value) ? mergeRecord(result[key], value) : value;
	}
	return result;
}

function recordField(value: unknown): Record<string, any> {
	return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelInfo(model: unknown) {
	if (typeof model !== "object" || model === null) return { provider: "unknown", model: "unknown", id: "unknown", name: "unknown", reasoning: false };
	const record = model as Record<string, unknown>;
	return {
		provider: stringField(record.provider),
		model: stringField(record.id ?? record.model),
		id: stringField(record.id ?? record.model),
		name: stringField(record.name ?? record.id ?? record.model),
		reasoning: record.reasoning === true,
	};
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed && trimmed !== "unknown" ? trimmed : undefined;
}

function stringField(value: unknown): string {
	return optionalString(value) ?? "unknown";
}
