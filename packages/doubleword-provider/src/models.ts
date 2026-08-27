import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_OUTPUT_TOKENS, DOUBLEWORD_API_BASE_URL, envInt, envString, LIVE_DEEPSEEK_MODEL_ID, LIVE_GLM_MODEL_ID, UNIFIED_LIVE_PROVIDER, withTimeout } from "./config.ts";
import { fetchJson } from "./http.ts";
import { numberFrom } from "./messages.ts";
import { writeJsonl } from "./observability.ts";
import { DOUBLEWORD_PRICING_PROVENANCE, DOUBLEWORD_TIER_PRICING, type DoublewordPricingTier, type DoublewordTokenPrices } from "./pricing.ts";

export type ModelCost = Model<Api>["cost"];
export type TierCosts = Partial<Record<DoublewordPricingTier, ModelCost>>;
export type TierPricingProvenance = {
	pricingSource: "doubleword-model-metadata";
	pricingSourceUrl: string;
	pricingRetrievedAt: string;
	pricingSnapshotSha256: string;
};
export type ProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	pricingId?: string;
	pricingEvidenceEligible?: boolean;
	thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
	input: Array<"text" | "image">;
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
};

const MODEL_CACHE_FILE = process.env.DOUBLEWORD_MODEL_CACHE_FILE ?? join(homedir(), ".pi", "agent", "doubleword-models.json");
export const ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
export const DOUBLEWORD_THINKING_LEVEL_MAP = { off: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" } satisfies NonNullable<Model<Api>["thinkingLevelMap"]>;

function isGenerationModel(id: string, name = id): boolean {
	return !/(ocr|embed|embedding|embeddings)/i.test(`${id} ${name}`);
}

export const stubModel = (id: string, name: string, cost: ModelCost = ZERO_COST, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS): ProviderModel => ({
	id,
	name,
	reasoning: true,
	thinkingLevelMap: DOUBLEWORD_THINKING_LEVEL_MAP,
	input: ["text"],
	cost,
	contextWindow: 128000,
	maxTokens,
});

function modelCost(prices: DoublewordTokenPrices | undefined): ModelCost {
	return prices ? { ...prices, cacheWrite: 0 } : ZERO_COST;
}

function tierCost(id: string, tier: "realtime" | "async"): ModelCost {
	return modelCost(DOUBLEWORD_TIER_PRICING[id]?.[tier]);
}

export const REALTIME_STUB_MODELS = [
	{ ...stubModel("glm-5-2", "GLM-5.2-FP8", tierCost(LIVE_GLM_MODEL_ID, "realtime")), pricingId: LIVE_GLM_MODEL_ID, pricingEvidenceEligible: false },
	{ ...stubModel("deepseek-v4-flash", "DeepSeek-V4-Flash", tierCost("deepseek-ai/DeepSeek-V4-Flash-0731", "realtime")), pricingId: "deepseek-ai/DeepSeek-V4-Flash-0731", pricingEvidenceEligible: false },
];

const fallbackLiveModels = (): ProviderModel[] => [
	{ ...stubModel(LIVE_GLM_MODEL_ID, "GLM-5.2-FP8", ZERO_COST, DEFAULT_MAX_OUTPUT_TOKENS), pricingEvidenceEligible: false },
	{ ...stubModel(LIVE_DEEPSEEK_MODEL_ID, "DeepSeek-V4-Flash", ZERO_COST, DEFAULT_MAX_OUTPUT_TOKENS), pricingEvidenceEligible: false },
];

export function tierPricingSource(id: string, tier: "realtime" | "async"): string | undefined {
	return DOUBLEWORD_TIER_PRICING[id]?.[tier] ? "doubleword-model-metadata" : undefined;
}

export function tierPricingProvenance(model: Pick<ProviderModel, "id" | "pricingId" | "pricingEvidenceEligible">, tier: "realtime" | "async", cacheWriteTokens = 0): TierPricingProvenance | undefined {
	if (model.pricingEvidenceEligible === false || !tierPricingSource(model.pricingId ?? model.id, tier) || cacheWriteTokens !== 0) return undefined;
	return {
		pricingSource: "doubleword-model-metadata",
		pricingSourceUrl: DOUBLEWORD_PRICING_PROVENANCE.sourceUrl,
		pricingRetrievedAt: DOUBLEWORD_PRICING_PROVENANCE.retrievedAt,
		pricingSnapshotSha256: DOUBLEWORD_PRICING_PROVENANCE.snapshotSha256,
	};
}

export function withTierCost<T extends Model<Api> | ProviderModel>(model: T, tier: "realtime" | "async"): T {
	const pricingId = (model as T & { pricingId?: string }).pricingId ?? model.id;
	return { ...model, cost: tierCost(pricingId, tier) };
}

function modelFromCatalogEntry(entry: any): ProviderModel | undefined {
	const id = typeof entry?.id === "string" ? entry.id : undefined;
	if (!id) return undefined;
	const name = typeof entry.name === "string" ? entry.name : id;
	const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities.map(String) : undefined;
	const reasoning = typeof entry.reasoning === "boolean" ? entry.reasoning : capabilities ? capabilities.includes("reasoning") : isGenerationModel(id, name);
	const rawThinkingLevelMap = entry.thinkingLevelMap ?? entry.thinking_level_map;
	const catalogThinkingLevelMap = typeof rawThinkingLevelMap === "object" && rawThinkingLevelMap ? rawThinkingLevelMap : {};
	return {
		id,
		name,
		reasoning,
		...(reasoning ? { thinkingLevelMap: { ...DOUBLEWORD_THINKING_LEVEL_MAP, ...catalogThinkingLevelMap } } : {}),
		input: ["text"],
		cost: ZERO_COST,
		contextWindow: numberFrom(entry.context_window ?? entry.contextWindow, 128000),
		maxTokens: numberFrom(entry.max_output_tokens ?? entry.max_tokens ?? entry.maxTokens, DEFAULT_MAX_OUTPUT_TOKENS),
	};
}

function readCachedModels(baseUrl: string): ProviderModel[] | undefined {
	try {
		const cache = JSON.parse(readFileSync(MODEL_CACHE_FILE, "utf8")) as { baseUrl?: string; models?: any[] };
		if (cache.baseUrl && cache.baseUrl !== baseUrl) return undefined;
		const models = (cache.models ?? []).map(modelFromCatalogEntry).filter(Boolean) as ProviderModel[];
		return models.length ? models : undefined;
	} catch {
		return undefined;
	}
}

function writeCachedModels(baseUrl: string, models: ProviderModel[]): void {
	try {
		mkdirSync(dirname(MODEL_CACHE_FILE), { recursive: true });
		writeFileSync(MODEL_CACHE_FILE, JSON.stringify({ cachedAt: new Date().toISOString(), baseUrl, models }, null, 2), "utf8");
	} catch {
		// Model discovery cache must not break provider registration.
	}
}

export async function discoverLiveModels(): Promise<ProviderModel[]> {
	const baseUrl = envString("DOUBLEWORD_BASE_URL", DOUBLEWORD_API_BASE_URL).replace(/\/$/, "");
	const apiKey = process.env.DOUBLEWORD_API_KEY;
	if (apiKey) {
		try {
			const headers = new Headers({ authorization: `Bearer ${apiKey}` });
			const timeoutMs = envInt("DOUBLEWORD_MODEL_DISCOVERY_TIMEOUT_MS", 10_000);
			const payload = await withTimeout(timeoutMs, undefined, (signal) => fetchJson(`${baseUrl}/models`, { method: "GET", headers, signal }));
			const models = (Array.isArray(payload.data) ? payload.data : []).map(modelFromCatalogEntry).filter(Boolean) as ProviderModel[];
			if (models.length) {
				writeCachedModels(baseUrl, models);
				return models;
			}
		} catch (error) {
			writeJsonl("model_discovery_error", { provider: UNIFIED_LIVE_PROVIDER, baseUrl, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return readCachedModels(baseUrl) ?? fallbackLiveModels();
}
