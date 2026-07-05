import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDoublewordDevProviders } from "../../doubleword-provider/src/dev.ts";
import { setDoublewordActiveTurnIndex, setDoublewordRunId } from "../../doubleword-provider/src/index.ts";
import { BATCHING_DISCIPLINE, BATCHING_DISCIPLINE_MARKER } from "../../fanout-core/src/batching-discipline.ts";
import { durationMs, RUN_ID, setObservabilityCwd, writeJsonl } from "../../fanout-core/src/observability.ts";
import { configureFanoutTier } from "./fanout-config.ts";

const FANOUT_CONTEXT_MARKER = "## Fanout runtime context";
const TIER2_DEFAULT = { provider: "doubleword", model: "zai-org/GLM-5.2-FP8", thinking: "medium" };
const TIER2_ELIGIBLE_KINDS = ["implement", "test", "docs", "inspect", "validate-shard", "review-shard"];
const TIER1_ONLY_KINDS = ["plan", "clarify", "packet-validation", "dag-safety", "final-review", "synthesis", "final-validation", "final-response"];
const doublewordModelMetadata = new Map<string, Record<string, unknown>>();

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
	await registerDoublewordDevProviders(pi, rememberDoublewordModels, { controls: false });

	pi.registerCommand("fanout-plan", {
		description: "Prepare a decision-complete Fanout execution packet",
		handler: async (args, ctx) => {
			const objective = args.trim() || "Use the current conversation context.";
			const context = writeFanoutRuntimeContext(ctx.cwd, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel(), ctx.modelRegistry?.getAll?.());
			writeJsonl("fanout_plan_start", { objective, artifactRoot: context.artifactRoot, tierDefaults: context.tierDefaults }, ctx.cwd);
			writeJsonl("fanout_plan_preflight", { tierPlan: context.resolvedTierPlan, tier2Availability: context.tier2Availability, nodeKindTierPolicy: context.nodeKindTierPolicy }, ctx.cwd);
			if (!ctx.isIdle()) {
				pi.sendUserMessage(fanoutPlanPrompt(objective, context), { deliverAs: "followUp" });
				ctx.ui.notify("Queued /fanout-plan after the current turn.", "info");
				return;
			}
			pi.sendUserMessage(fanoutPlanPrompt(objective, context));
		},
	});

	pi.registerCommand("fanout-config", {
		description: "Configure Fanout tier models",
		handler: async (args, ctx) => {
			const context = fanoutRuntimeContext(ctx.cwd, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel(), ctx.modelRegistry?.getAll?.());
			await configureFanoutTier(args, ctx, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel(), globalSettingsPath(), context.artifactRoot);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		activeModel = ctx.model;
		activeThinking = pi.getThinkingLevel();
		writeFanoutRuntimeContext(ctx.cwd, activeModel, activeThinking, ctx.modelRegistry?.getAll?.());
		setObservabilityCwd(ctx.cwd);
		writeJsonl("session_start", { cwd: ctx.cwd, mode: ctx.mode }, ctx.cwd);
	});

	pi.on("model_select", (event, ctx) => {
		activeModel = event.model;
		writeFanoutRuntimeContext(ctx.cwd, activeModel, activeThinking, ctx.modelRegistry?.getAll?.());
	});

	pi.on("thinking_level_select", (event, ctx) => {
		activeThinking = event.level;
		writeFanoutRuntimeContext(ctx.cwd, activeModel ?? ctx.model, activeThinking, ctx.modelRegistry?.getAll?.());
	});

	pi.on("before_agent_start", (event, ctx) => {
		const batchingPrompt = event.systemPrompt.includes(BATCHING_DISCIPLINE_MARKER) ? event.systemPrompt : `${event.systemPrompt}\n\n${BATCHING_DISCIPLINE}`;
		return {
			systemPrompt: batchingPrompt.includes(FANOUT_CONTEXT_MARKER) ? batchingPrompt : `${batchingPrompt}\n\n${fanoutRuntimePrompt(ctx.cwd, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel(), ctx.modelRegistry?.getAll?.())}`,
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

function rememberDoublewordModels(provider: string, models: unknown[]): void {
	for (const model of models) if (isRecord(model)) doublewordModelMetadata.set(modelKey(provider, stringField(model.id ?? model.model)), { ...model, provider });
}

function augmentRegistryModels(models: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const seen = new Set<string>();
	const augmented = models.map((model) => {
		const key = modelKey(stringField(model.provider), stringField(model.id ?? model.model));
		seen.add(key);
		const metadata = doublewordModelMetadata.get(key);
		return metadata ? { ...metadata, ...model, fanout: metadata.fanout } : model;
	});
	for (const [key, metadata] of doublewordModelMetadata) if (!seen.has(key)) augmented.push(metadata);
	return augmented;
}

function modelKey(provider: string, model: string): string {
	return `${provider}/${model}`;
}

function fanoutRuntimePrompt(cwd: string, model: unknown, thinking: unknown, models?: unknown): string {
	const context = fanoutRuntimeContext(cwd, model, thinking, models);
	return `${FANOUT_CONTEXT_MARKER}\n\n- artifactRoot: ${context.artifactRoot}\n- projectArtifactRoot: ${context.projectArtifactRoot}\n- runtimeContextFile: ${context.runtimeContextFile}\n- activePointerPath: ${context.activePointerPath}\n- tier1: ${context.resolvedTierPlan.tier1.provider}/${context.resolvedTierPlan.tier1.model} (${context.resolvedTierPlan.tier1.thinking})\n- tier2: ${context.resolvedTierPlan.tier2.provider}/${context.resolvedTierPlan.tier2.model} (${context.resolvedTierPlan.tier2.status}; ${context.tier2Availability.reason})\n- question tool: ask_user_question is required for /fanout-plan clarification.\n`;
}

function writeFanoutRuntimeContext(cwd: string, model: unknown, thinking: unknown, models?: unknown): ReturnType<typeof fanoutRuntimeContext> {
	const context = fanoutRuntimeContext(cwd, model, thinking, models);
	try {
		mkdirSync(context.projectArtifactRoot, { recursive: true });
		writeFileSync(context.runtimeContextFile, `${JSON.stringify(context, null, 2)}\n`, "utf8");
	} catch {
		// Fanout runtime context is advisory; normal agent operation should continue.
	}
	return context;
}

function fanoutRuntimeContext(cwd: string, model: unknown, thinking: unknown, models?: unknown) {
	const settings = fanoutSettings(cwd);
	const registryModels = augmentRegistryModels(Array.isArray(models) ? (models as Array<Record<string, unknown>>).filter(isRecord) : []);
	const artifactRoot = resolve(process.env.FANOUT_ARTIFACT_DIR || optionalString(settings.artifactDir) || join(getAgentDir(), "fanout"));
	const projectId = `${basename(cwd)}-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}`;
	const projectArtifactRoot = join(artifactRoot, projectId);
	const active = modelInfo(model);
	const activeThinking = optionalString(thinking) ?? "auto";
	const tier1Settings = recordField(settings.tiers?.tier1);
	const tier2Settings = recordField(settings.tiers?.tier2);
	const tierDefaults = {
		tier1: { provider: "auto", model: "auto", thinking: "auto", reason: "current active Pi realtime model", ...tier1Settings },
		tier2: { provider: TIER2_DEFAULT.provider, model: TIER2_DEFAULT.model, thinking: TIER2_DEFAULT.thinking, enabled: "auto", reason: "async background worker model", ...tier2Settings },
	};
	const tier1 = resolveTier1(tierDefaults.tier1, active, activeThinking, registryModels, Object.keys(tier1Settings).length > 0);
	const tier2 = resolveTier2(tierDefaults.tier2, registryModels, Object.keys(tier2Settings).length > 0);
	return {
		artifactRoot,
		projectId,
		projectArtifactRoot,
		activePointerPath: join(projectArtifactRoot, "active-packet.json"),
		runtimeContextFile: join(projectArtifactRoot, "runtime-context.json"),
		activeModel: active,
		activeThinking,
		tierDefaults,
		resolvedTierPlan: { tier1: tier1.summary, tier2: tier2.summary },
		tier2Availability: tier2.availability,
		nodeKindTierPolicy: { tier2Eligible: TIER2_ELIGIBLE_KINDS, tier1Only: TIER1_ONLY_KINDS, fallbackTier: "tier1" },
		packetHelper: {
			script: resolve(cwd, "scripts/fanout-packet-artifacts.mjs"),
			printRunDir: `rtk env FANOUT_ARTIFACT_DIR=${JSON.stringify(artifactRoot)} node --disable-warning=ExperimentalWarning scripts/fanout-packet-artifacts.mjs --print-run-dir <run-id>`,
			printActivePath: `rtk env FANOUT_ARTIFACT_DIR=${JSON.stringify(artifactRoot)} node --disable-warning=ExperimentalWarning scripts/fanout-packet-artifacts.mjs --print-active-path`,
			validatePacket: `rtk env FANOUT_ARTIFACT_DIR=${JSON.stringify(artifactRoot)} node --disable-warning=ExperimentalWarning scripts/fanout-packet-artifacts.mjs <artifact-dir>/execution-packet.json --out <artifact-dir> --active ${JSON.stringify(join(projectArtifactRoot, "active-packet.json"))}`,
		},
		executionDefaults: { tier2Retries: 2, fallbackTier: "tier1", revalidateOnly: true, ...recordField(settings.execution) },
	};
}

function resolveTier1(config: Record<string, unknown>, active: ReturnType<typeof modelInfo>, activeThinking: string, models: Array<Record<string, unknown>>, configured: boolean) {
	const configuredProvider = optionalString(config.provider);
	const configuredModel = optionalString(config.model);
	const useConfigured = configuredProvider && configuredProvider !== "auto" && configuredModel && configuredModel !== "auto";
	const modelRecord = useConfigured ? findModel(models, configuredProvider, configuredModel) : findModel(models, active.provider, active.model);
	const provider = useConfigured && modelRecord ? configuredProvider : active.provider;
	const model = useConfigured && modelRecord ? configuredModel : active.model;
	const requestedThinking = optionalString(config.thinking) && config.thinking !== "auto" ? String(config.thinking) : activeThinking;
	const thinking = resolveThinking(modelRecord ?? findModel(models, provider, model), requestedThinking, activeThinking);
	const source = configured && useConfigured && modelRecord ? "fanout.tiers.tier1" : "current Pi active model";
	return { summary: { provider, model, thinking, source, status: "available", reason: "control plane, review, synthesis, fallback" } };
}

function resolveTier2(config: Record<string, unknown>, models: Array<Record<string, unknown>>, configured: boolean) {
	const provider = optionalString(config.provider) ?? TIER2_DEFAULT.provider;
	const model = optionalString(config.model) ?? TIER2_DEFAULT.model;
	const modelRecord = findModel(models, provider, model);
	const enabled = config.enabled !== false && config.enabled !== "false" && config.enabled !== "off";
	const fanout = isRecord(modelRecord?.fanout) ? modelRecord.fanout : {};
	const available = enabled && fanout.async === true && fanout.background === true && fanout.authReady === true;
	const reason = tier2AvailabilityReason(enabled, modelRecord, fanout);
	const thinking = resolveThinking(modelRecord, optionalString(config.thinking) ?? TIER2_DEFAULT.thinking, TIER2_DEFAULT.thinking);
	const source = configured ? "fanout.tiers.tier2" : "default settings";
	return {
		availability: { available, reason, fanout: { async: fanout.async === true, background: fanout.background === true, authReady: fanout.authReady === true } },
		summary: { provider, model, thinking, source, status: available ? "available" : "unavailable", reason: available ? "parallel async worker nodes" : reason, fallback: available ? undefined : "tier1" },
	};
}

function tier2AvailabilityReason(enabled: boolean, modelRecord: Record<string, unknown> | undefined, fanout: Record<string, unknown>): string {
	if (!enabled) return "tier2 disabled in fanout.tiers.tier2.enabled";
	if (!modelRecord) return "tier2 provider/model not found in Pi model registry";
	if (fanout.async !== true) return "model fanout.async is not true";
	if (fanout.background !== true) return "model fanout.background is not true";
	if (fanout.authReady !== true) return "model fanout.authReady is not true";
	return "model has async/background/authReady fanout metadata";
}

function resolveThinking(model: Record<string, unknown> | undefined, requested: string, fallback: string): string {
	const supported = thinkingOptions(model);
	if (supported.includes(requested)) return requested;
	if (supported.includes(fallback)) return fallback;
	if (supported.includes("medium")) return "medium";
	if (supported.includes("off")) return "off";
	return supported[0] ?? "auto";
}

function thinkingOptions(model: Record<string, unknown> | undefined): string[] {
	if (!model || model.reasoning !== true) return ["off"];
	const map = model.thinkingLevelMap;
	if (isRecord(map)) {
		const supported = ["off", "minimal", "low", "medium", "high", "xhigh"].filter((level) => map[level] !== null && map[level] !== undefined);
		if (supported.length) return supported;
	}
	return ["off", "minimal", "low", "medium", "high", "xhigh"];
}

function findModel(models: Array<Record<string, unknown>>, provider: string, model: string): Record<string, unknown> | undefined {
	return models.find((entry) => stringField(entry.provider) === provider && stringField(entry.id ?? entry.model) === model);
}

function fanoutPlanPrompt(objective: string, context: ReturnType<typeof fanoutRuntimeContext>): string {
	const template = readFileSync(new URL("../prompts/fanout-plan.md", import.meta.url), "utf8").replace(/^---[\s\S]*?---\s*/, "");
	return `${template.replace("$ARGUMENTS", objective).trim()}\n\nResolved preflight context (adapter-authored source of truth):\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n`;
}

function fanoutSettings(cwd: string): Record<string, any> {
	return mergeRecord(readFanoutSettings(globalSettingsPath()), readFanoutSettings(join(cwd, ".pi", "settings.json")));
}

function globalSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelInfo(model: unknown) {
	if (!isRecord(model)) return { provider: "unknown", model: "unknown", id: "unknown", name: "unknown", reasoning: false };
	return {
		provider: stringField(model.provider),
		model: stringField(model.id ?? model.model),
		id: stringField(model.id ?? model.model),
		name: stringField(model.name ?? model.id ?? model.model),
		reasoning: model.reasoning === true,
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
