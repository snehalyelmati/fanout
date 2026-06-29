import { performance } from "node:perf_hooks";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ASYNC_SERVICE_TIER, envInt, sleep } from "./config.ts";
import { writeJsonl } from "./observability.ts";

export class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly retryAfterMs: number | undefined,
		readonly body: Record<string, any>,
	) {
		super(message);
	}
}

function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const dateMs = Date.parse(value);
	return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

export async function fetchJson(url: string, init: RequestInit): Promise<Record<string, any>> {
	const response = await fetch(url, init);
	const body = await response.text();
	let json: Record<string, any> = {};
	if (body.trim()) {
		try {
			json = JSON.parse(body);
		} catch {
			json = { text: body };
		}
	}
	if (!response.ok) {
		throw new HttpError(
			`Doubleword API error ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
			response.status,
			parseRetryAfter(response.headers.get("retry-after")),
			json,
		);
	}
	return json;
}

function isTransientPollError(error: unknown): error is HttpError {
	return error instanceof HttpError && [429, 500, 502, 503, 504].includes(error.status);
}

export async function fetchJsonWithPollRetry(
	url: string,
	init: RequestInit,
	args: {
		deadline: number;
		pollIndex: number;
		model: Model<Api>;
		responseId: string;
		turnIndex: number | undefined;
	},
): Promise<Record<string, any>> {
	let attempt = 0;
	while (true) {
		try {
			return await fetchJson(url, init);
		} catch (error) {
			if (!isTransientPollError(error) || init.signal instanceof AbortSignal && init.signal.aborted) throw error;
			attempt++;
			const remaining = args.deadline - performance.now();
			if (remaining <= 0) throw error;
			const retryCap = envInt("DOUBLEWORD_POLL_MAX_RETRY_DELAY_MS", 60_000);
			const backoff = Math.min(error.retryAfterMs ?? 1000 * 2 ** Math.min(attempt - 1, 3), retryCap, remaining);
			writeJsonl("async_poll_retry", {
				provider: args.model.provider,
				model: args.model.id,
				responseId: args.responseId,
				turnIndex: args.turnIndex,
				serviceTierRequested: ASYNC_SERVICE_TIER,
				pollIndex: args.pollIndex,
				attempt,
				status: error.status,
				retryAfterMs: backoff,
			});
			await sleep(backoff, init.signal as AbortSignal | undefined);
		}
	}
}
