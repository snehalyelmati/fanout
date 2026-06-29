import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_OUTPUT_TOKENS, DOUBLEWORD_API_BASE_URL, envInt, envString, LIVE_DEEPSEEK_MODEL_ID, LIVE_GLM_MODEL_ID, UNIFIED_LIVE_PROVIDER, withTimeout } from "./config.ts";
import { fetchJson } from "./http.ts";
import { numberFrom } from "./messages.ts";
import { writeJsonl } from "./observability.ts";

export type ModelCost = Model<Api>["cost"];
export type TierCosts = { realtime: ModelCost; async: ModelCost; batch?: ModelCost };
export type ProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
};

const MODEL_CACHE_FILE = process.env.DOUBLEWORD_MODEL_CACHE_FILE ?? join(homedir(), ".pi", "agent", "doubleword-models.json");
export const ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const stubModel = (id: string, name: string, cost: ModelCost = ZERO_COST, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS): ProviderModel => ({
	id,
	name,
	reasoning: false,
	input: ["text"],
	cost,
	contextWindow: 128000,
	maxTokens,
});

export const REALTIME_STUB_MODELS = [
	stubModel("glm-5-2", "GLM-5.2-FP8", { input: 1.4, output: 4.4, cacheRead: 0, cacheWrite: 0 }),
	stubModel("deepseek-v4-flash", "DeepSeek-V4-Flash", { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 }),
];

const FALLBACK_LIVE_MODELS = [
	stubModel(LIVE_GLM_MODEL_ID, "GLM-5.2-FP8"),
	stubModel(LIVE_DEEPSEEK_MODEL_ID, "DeepSeek-V4-Flash"),
];

const KNOWN_TIER_COSTS: Record<string, TierCosts> = {
	["glm-5-2"]: {
		realtime: { input: 1.4, output: 4.4, cacheRead: 0, cacheWrite: 0 },
		async: { input: 1.05, output: 3.3, cacheRead: 0, cacheWrite: 0 },
	},
	["deepseek-v4-flash"]: {
		realtime: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 },
		async: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
	},
	[LIVE_GLM_MODEL_ID.toLowerCase()]: {
		realtime: { input: 1.4, output: 4.4, cacheRead: 0, cacheWrite: 0 },
		async: { input: 1.05, output: 3.3, cacheRead: 0, cacheWrite: 0 },
		batch: { input: 0.7, output: 2.2, cacheRead: 0, cacheWrite: 0 },
	},
	["zai-org/glm-5.1-fp8"]: {
		realtime: { input: 1.4, output: 4.4, cacheRead: 0, cacheWrite: 0 },
		async: { input: 1.05, output: 3.3, cacheRead: 0, cacheWrite: 0 },
		batch: { input: 0.7, output: 2.2, cacheRead: 0, cacheWrite: 0 },
	},
	[LIVE_DEEPSEEK_MODEL_ID.toLowerCase()]: {
		realtime: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 },
		async: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
		batch: { input: 0.07, output: 0.14, cacheRead: 0, cacheWrite: 0 },
	},
	["deepseek-ai/deepseek-v4-pro"]: {
		realtime: { input: 1.74, output: 3.48, cacheRead: 0, cacheWrite: 0 },
		async: { input: 1.31, output: 2.75, cacheRead: 0, cacheWrite: 0 },
		batch: { input: 0.87, output: 1.74, cacheRead: 0, cacheWrite: 0 },
	},
};

function tierCost(id: string, tier: "realtime" | "async"): ModelCost {
	return KNOWN_TIER_COSTS[id.toLowerCase()]?.[tier] ?? ZERO_COST;
}

export function withTierCost<T extends Model<Api> | ProviderModel>(model: T, tier: "realtime" | "async"): T {
	return { ...model, cost: tierCost(model.id, tier) };
}

function modelFromCatalogEntry(entry: any): ProviderModel | undefined {
	const id = typeof entry?.id === "string" ? entry.id : undefined;
	if (!id) return undefined;
	return {
		id,
		name: typeof entry.name === "string" ? entry.name : id,
		reasoning: false,
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
	return readCachedModels(baseUrl) ?? FALLBACK_LIVE_MODELS;
}
