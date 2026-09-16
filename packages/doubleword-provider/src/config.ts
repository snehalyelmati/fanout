import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

export const UNIFIED_STUB_PROVIDER = "doubleword-stub";
export const UNIFIED_LIVE_PROVIDER = "doubleword";
export const DOUBLEWORD_API_BASE_URL = process.env.DOUBLEWORD_BASE_URL ?? "https://api.doubleword.ai/v1";
export const LIVE_GLM_MODEL_ID = "zai-org/GLM-5.3-Flash";
export const LIVE_DEEPSEEK_MODEL_ID = "deepseek-ai/DeepSeek-V4-Flash";
export const ASYNC_SERVICE_TIER = "flex";
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
export const DEFAULT_ASYNC_TIMEOUT_MS = 600_000;
export const DEFAULT_CANCEL_TIMEOUT_MS = 10_000;
export const BATCHING_DISCIPLINE_MARKER = "Batch every independent tool call needed for the next decision into one assistant turn.";

export type ExecutionMode = "realtime" | "async";

export function envInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function envString(name: string, fallback: string): string {
	const value = process.env[name];
	return value && value.trim() ? value : fallback;
}

export function maxOutputTokensFor(model: Model<Api>, options?: SimpleStreamOptions): number {
	const configured = options?.maxTokens ?? envInt("DOUBLEWORD_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS);
	return Math.max(1, Math.min(Math.floor(configured), model.maxTokens || configured));
}

export function elapsedMs(start: number): number {
	return performance.now() - start;
}

export function formatSeconds(ms: number): string {
	return `${Math.round(ms / 1000)}s`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new Error("aborted"));
		const timeout = setTimeout(done, ms);
		const abort = () => {
			signal?.removeEventListener("abort", abort);
			clearTimeout(timeout);
			reject(new Error("aborted"));
		};
		function done() {
			signal?.removeEventListener("abort", abort);
			resolve();
		}
		signal?.addEventListener("abort", abort, { once: true });
	});
}

function withTimeoutSignal(ms: number, parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), Math.max(1, ms));
	const abort = () => controller.abort();
	if (parent?.aborted) abort();
	else parent?.addEventListener("abort", abort, { once: true });
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timeout);
			parent?.removeEventListener("abort", abort);
		},
	};
}

export async function withTimeout<T>(ms: number, parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const scoped = withTimeoutSignal(ms, parent);
	try {
		return await run(scoped.signal);
	} finally {
		scoped.dispose();
	}
}
