import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { UNIFIED_LIVE_PROVIDER, UNIFIED_STUB_PROVIDER } from "../../doubleword-provider/src/config.ts";
import { setDoublewordObservabilityFile } from "../../doubleword-provider/src/index.ts";
import type { FanoutTierPlan, TierModelSummary } from "../../fanout-core/src/execution-packet.ts";
import { RUN_ID, setObservabilityCwd, setObservabilityFile } from "../../fanout-core/src/observability.ts";

export const TIER2_DEFAULT = { provider: "doubleword", model: "zai-org/GLM-5.3-Flash", thinking: "medium" };
const doublewordModelMetadata = new Map<string, Record<string, unknown>>();

export function fanoutDoublewordModel(provider: string, model: Record<string, unknown>): Record<string, unknown> & { fanout: { async: true; background: true; authReady: boolean } } {
	return {
		...model,
		provider,
		fanout: {
			async: true,
			background: true,
			authReady: provider === UNIFIED_STUB_PROVIDER || provider === UNIFIED_LIVE_PROVIDER && Boolean(process.env.DOUBLEWORD_API_KEY),
		},
	};
}

export function rememberDoublewordModels(provider: string, models: unknown[]): void {
	for (const model of models) if (isRecord(model)) {
		doublewordModelMetadata.set(modelKey(provider, stringField(model.id ?? model.model)), { ...model, provider });
	}
}

export function augmentRegistryModels(models: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const seen = new Set<string>();
	const augmented = models.map((model) => {
		const key = modelKey(stringField(model.provider), stringField(model.id ?? model.model));
		seen.add(key);
		const metadata = doublewordModelMetadata.get(key);
		if (!metadata) return model;
		const projected = fanoutDoublewordModel(stringField(metadata.provider), metadata);
		return { ...projected, ...model, fanout: projected.fanout };
	});
	for (const [key, metadata] of doublewordModelMetadata) if (!seen.has(key)) augmented.push(fanoutDoublewordModel(stringField(metadata.provider), metadata));
	return augmented;
}

function modelKey(provider: string, model: string): string {
	return `${provider}/${model}`;
}

export function writeFanoutRuntimeContext(cwd: string, model: unknown, thinking: unknown, models?: unknown, prepared?: ReturnType<typeof fanoutRuntimeContext>): ReturnType<typeof fanoutRuntimeContext> {
	const context = prepared ?? fanoutRuntimeContext(cwd, model, thinking, models);
	try {
		mkdirSync(context.projectArtifactRoot, { recursive: true });
		writeFileSync(context.runtimeContextFile, `${JSON.stringify(context, null, 2)}\n`, "utf8");
	} catch {
		// Fanout runtime context is advisory; normal agent operation should continue.
	}
	return context;
}

export function configureMainObservability(context: { projectArtifactRoot: string }, cwd = process.cwd()): string {
	const observabilityPath = join(context.projectArtifactRoot, "observability", RUN_ID, "observability.jsonl");
	setObservabilityCwd(cwd);
	setObservabilityFile(observabilityPath);
	setDoublewordObservabilityFile(observabilityPath);
	return process.env.DOUBLEWORD_OBSERVABILITY_FILE ?? observabilityPath;
}

export function fanoutProjectId(cwd: string): string {
	return `${basename(cwd)}-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}`;
}

export function fanoutRuntimeContext(cwd: string, model: unknown, thinking: unknown, models?: unknown) {
	const settings = fanoutSettings(cwd);
	const registryModels = augmentRegistryModels(Array.isArray(models) ? (models as Array<Record<string, unknown>>).filter(isRecord) : []);
	const artifactRoot = resolve(process.env.FANOUT_ARTIFACT_DIR || optionalString(settings.artifactDir) || join(getAgentDir(), "fanout"));
	const projectId = fanoutProjectId(cwd);
	const projectArtifactRoot = join(artifactRoot, projectId);
	const active = modelInfo(model);
	const activeThinking = optionalString(thinking) ?? "auto";
	const tier2Settings = recordField(settings.tiers?.tier2);
	const executionSettings = recordField(settings.execution);
	const tier2FallbackSettings = recordField(executionSettings.tier2Fallback);
	const tierDefaults = {
		tier1: { provider: "auto", model: "auto", thinking: "auto", reason: "current active Pi realtime model" },
		tier2: { provider: TIER2_DEFAULT.provider, model: TIER2_DEFAULT.model, thinking: TIER2_DEFAULT.thinking, enabled: "auto", reason: "async background worker model", ...tier2Settings },
		tier2Fallback: tier2FallbackSettings.inherit === "tier1" ? { inherit: "tier1" } : Object.keys(tier2FallbackSettings).length > 0 ? tier2FallbackSettings : { inherit: "tier1" },
	};
	const tier1 = resolveTier1(active, activeThinking);
	const tier2 = resolveTier2(tierDefaults.tier2, registryModels, Object.keys(tier2Settings).length > 0);
	const tier2Fallback = resolveTier2Fallback(tier2FallbackSettings, tier1.summary, registryModels);
	const resolvedTierPlan: FanoutTierPlan = { tier1: tier1.summary, tier2: tier2.summary, tier2Fallback };
	return {
		artifactRoot,
		projectId,
		projectArtifactRoot,
		activePointerPath: join(projectArtifactRoot, "active-packet.json"),
		activeProfilePointerPath: join(projectArtifactRoot, "active-profile.json"),
		runtimeContextFile: join(projectArtifactRoot, "runtime-context.json"),
		activeModel: active,
		activeThinking,
		tierDefaults,
		resolvedTierPlan,
		tier2Availability: tier2.availability,
		executionDefaults: {
			maxConcurrency: executionSettings.maxConcurrency ?? 2,
			failFast: false,
			tier2MaxAttempts: 2,
			tier1CleanRerunMaxAttempts: 1,
			tier1FallbackMaxAttempts: 1,
			maxValidationRepairAttempts: 2,
			maxIntegrationRepairAttempts: 2,
			fallbackTier: "tier1",
			revalidateOnly: true,
		},
	};
}

function resolveTier1(active: ReturnType<typeof modelInfo>, activeThinking: string): { summary: TierModelSummary } {
	return { summary: { provider: active.provider, model: active.model, thinking: activeThinking, source: "current Pi active model", status: "available", reason: "realtime control plane for planning, safety, review, synthesis, and final decisions" } };
}

export function tier1Resolved(summary: Record<string, unknown>): boolean {
	return optionalString(summary.provider) !== undefined && optionalString(summary.model) !== undefined;
}

function resolveTier2(config: Record<string, unknown>, models: Array<Record<string, unknown>>, configured: boolean): { availability: { available: boolean; reason: string; fanout: { async: boolean; background: boolean; authReady: boolean } }; summary: FanoutTierPlan["tier2"] } {
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

function resolveTier2Fallback(config: Record<string, unknown>, tier1: Record<string, unknown>, models: Array<Record<string, unknown>>): TierModelSummary {
	const provider = optionalString(config.provider);
	const model = optionalString(config.model);
	const modelRecord = provider && model ? findModel(models, provider, model) : undefined;
	if (config.inherit === "tier1" || !provider || !model || !modelRecord) {
		return {
			provider: stringField(tier1.provider),
			model: stringField(tier1.model),
			thinking: stringField(tier1.thinking),
			source: "tier1 inheritance",
			status: "available",
			reason: config.inherit === "tier1" ? "realtime fallback for tier2 execution; explicit inheritance marker" : provider && model ? "configured fallback unavailable; inherited tier1" : "realtime fallback for tier2 execution; inherits tier1",
		};
	}
	return { provider, model, thinking: resolveThinking(modelRecord, optionalString(config.thinking) ?? "auto", "auto"), source: "fanout.execution.tier2Fallback", status: "available", reason: "realtime fallback for tier2 execution" };
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
	const supported = supportedThinkingLevels(model);
	if (supported.includes(requested)) return requested;
	if (supported.includes(fallback)) return fallback;
	if (supported.includes("medium")) return "medium";
	if (supported.includes("off")) return "off";
	return supported[0] ?? "auto";
}

export function supportedThinkingLevels(model: Record<string, unknown> | undefined): string[] {
	return model ? getSupportedThinkingLevels(model as any) : ["off"];
}

function findModel(models: Array<Record<string, unknown>>, provider: string, model: string): Record<string, unknown> | undefined {
	return models.find((entry) => stringField(entry.provider) === provider && stringField(entry.id ?? entry.model) === model);
}

function fanoutSettings(cwd: string): Record<string, any> {
	return mergeRecord(readFanoutSettings(globalSettingsPath()), readFanoutSettings(join(cwd, ".pi", "settings.json")));
}

export function globalSettingsPath(): string {
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
	for (const [key, value] of Object.entries(override)) result[key] = isPlainRecord(result[key]) && isPlainRecord(value) ? mergeRecord(result[key], value) : value;
	return result;
}

export function recordField(value: unknown): Record<string, any> {
	return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelInfo(model: unknown) {
	if (!isRecord(model)) return { provider: "unknown", model: "unknown", id: "unknown", name: "unknown", reasoning: false };
	return { provider: stringField(model.provider), model: stringField(model.id ?? model.model), id: stringField(model.id ?? model.model), name: stringField(model.name ?? model.id ?? model.model), reasoning: model.reasoning === true };
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed && trimmed !== "unknown" ? trimmed : undefined;
}

export function relativeArtifact(root: string, path: string): string {
	return relative(resolve(root), resolve(path)).split(sep).join("/");
}

export function stringField(value: unknown): string {
	return optionalString(value) ?? "unknown";
}

export function positiveIntegerSetting(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
