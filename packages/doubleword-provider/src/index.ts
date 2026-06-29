import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type Usage,
} from "@earendil-works/pi-ai";

const REALTIME_PROVIDER = "doubleword-realtime-stub";
const ASYNC_PROVIDER = "doubleword-async-stub";
const LIVE_REALTIME_PROVIDER = "doubleword-realtime";
const LIVE_ASYNC_PROVIDER = "doubleword-async";
const DOUBLEWORD_API_BASE_URL = process.env.DOUBLEWORD_BASE_URL ?? "https://api.doubleword.ai/v1";
const LIVE_GLM_MODEL_ID = "zai-org/GLM-5.2-FP8";
const LIVE_DEEPSEEK_MODEL_ID = "deepseek-ai/DeepSeek-V4-Flash";
const ASYNC_SERVICE_TIER = "flex";
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const DEFAULT_ASYNC_TIMEOUT_MS = 600_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 10_000;
const MODEL_CACHE_FILE = process.env.DOUBLEWORD_MODEL_CACHE_FILE ?? join(homedir(), ".pi", "agent", "doubleword-models.json");
const BATCHING_DISCIPLINE_MARKER = "## Think-ahead batching";
type ModelCost = Model<Api>["cost"];

const ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
let runId = process.env.DOUBLEWORD_RUN_ID ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;

let activeTurnIndex: number | undefined;

type TierCosts = { realtime: ModelCost; async: ModelCost; batch?: ModelCost };
type ProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
};

class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly retryAfterMs: number | undefined,
		readonly body: Record<string, any>,
	) {
		super(message);
	}
}

class AsyncTimeoutError extends Error {}

export function setDoublewordActiveTurnIndex(turnIndex: number | undefined): void {
	activeTurnIndex = turnIndex;
}

export function setDoublewordRunId(nextRunId: string): void {
	runId = nextRunId;
}

function readFixtureText(): string {
	try {
		const path = fileURLToPath(new URL("../fixtures/tiny-response.json", import.meta.url));
		const fixture = JSON.parse(readFileSync(path, "utf8")) as { text?: string };
		return fixture.text ?? "Doubleword stub response.";
	} catch {
		return "Doubleword stub response.";
	}
}

const FIXTURE_TEXT = readFixtureText();

function durationMs(start: number): number {
	return Math.round((performance.now() - start) * 1000) / 1000;
}

function writeJsonl(event: string, data: Record<string, unknown> = {}, baseCwd = process.cwd()): void {
	try {
		const file = process.env.DOUBLEWORD_OBSERVABILITY_FILE ?? join(baseCwd, "runs", runId, "observability.jsonl");
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), runId, event, ...data })}\n`, "utf8");
	} catch {
		// Observability must not break provider streaming.
	}
}

function envInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envString(name: string, fallback: string): string {
	const value = process.env[name];
	return value && value.trim() ? value : fallback;
}

function maxOutputTokensFor(model: Model<Api>, options?: SimpleStreamOptions): number {
	const configured = options?.maxTokens ?? envInt("DOUBLEWORD_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS);
	return Math.max(1, Math.min(Math.floor(configured), model.maxTokens || configured));
}

function elapsedMs(start: number): number {
	return performance.now() - start;
}

function formatSeconds(ms: number): string {
	return `${Math.round(ms / 1000)}s`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

async function withTimeout<T>(ms: number, parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const scoped = withTimeoutSignal(ms, parent);
	try {
		return await run(scoped.signal);
	} finally {
		scoped.dispose();
	}
}

function countTokens(text: string): number {
	return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function textFrom(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const block = part as { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown };
			if (block.type === "text") return block.text ?? "";
			if (block.type === "thinking") return block.thinking ?? "";
			if (block.type === "toolCall") return `${block.name ?? "tool"} ${JSON.stringify(block.arguments ?? {})}`;
			return "";
		})
		.join("\n");
}

function costFor(model: Model<Api>, input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage["cost"] {
	const cost = {
		input: (model.cost.input / 1_000_000) * input,
		output: (model.cost.output / 1_000_000) * output,
		cacheRead: (model.cost.cacheRead / 1_000_000) * cacheRead,
		cacheWrite: (model.cost.cacheWrite / 1_000_000) * cacheWrite,
		total: 0,
	};
	cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
	return cost;
}

function usageFor(model: Model<Api>, context: Context, outputText: string): Usage {
	const input = countTokens([context.systemPrompt ?? "", ...context.messages.map((message) => textFrom(message.content))].join("\n"));
	const output = countTokens(outputText);
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: costFor(model, input, output),
	};
}

function numberFrom(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function usageFromResponse(model: Model<Api>, context: Context, outputText: string, response: Record<string, any>): Usage {
	const raw = response.usage ?? {};
	const input = numberFrom(raw.input_tokens ?? raw.prompt_tokens, countTokens([context.systemPrompt ?? "", ...context.messages.map((message) => textFrom(message.content))].join("\n")));
	const output = numberFrom(raw.output_tokens ?? raw.completion_tokens, countTokens(outputText));
	const cacheRead = numberFrom(raw.input_tokens_details?.cached_tokens ?? raw.prompt_tokens_details?.cached_tokens, 0);
	const cacheWrite = numberFrom(raw.input_tokens_details?.cache_write_tokens ?? raw.prompt_tokens_details?.cache_write_tokens, 0);
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: numberFrom(raw.total_tokens, input + output + cacheRead + cacheWrite),
		cost: costFor(model, input, output, cacheRead, cacheWrite),
	};
}

function responsesInput(context: Context): string {
	const parts: string[] = [];
	if (context.systemPrompt) parts.push(`[system]\n${context.systemPrompt}`);
	for (const message of context.messages) {
		const label = message.role === "toolResult" ? `tool:${message.toolName}` : message.role;
		parts.push(`[${label}]\n${textFrom(message.content)}`);
	}
	return parts.join("\n\n");
}

function messageText(item: any): string {
	if (!Array.isArray(item?.content)) return "";
	return item.content
		.map((part: any) => (part?.type === "output_text" || part?.type === "refusal" ? (part.text ?? part.refusal ?? "") : ""))
		.filter(Boolean)
		.join("");
}

function reasoningText(item: any): string {
	const parts = Array.isArray(item?.summary) && item.summary.length ? item.summary : item?.content;
	if (!Array.isArray(parts)) return "";
	return parts
		.map((part: any) => (part?.type === "summary_text" || part?.type === "reasoning_text" ? part.text ?? "" : ""))
		.filter(Boolean)
		.join("\n\n");
}

function emitText(stream: AssistantMessageEventStream, output: AssistantMessage, text: string): void {
	output.content.push({ type: "text", text: "" });
	const contentIndex = output.content.length - 1;
	stream.push({ type: "text_start", contentIndex, partial: output });
	const block = output.content[contentIndex];
	if (block.type === "text") block.text += text;
	stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
	stream.push({ type: "text_end", contentIndex, content: text, partial: output });
}

function emitThinking(stream: AssistantMessageEventStream, output: AssistantMessage, thinking: string, signature?: string): void {
	output.content.push({ type: "thinking", thinking: "", thinkingSignature: signature });
	const contentIndex = output.content.length - 1;
	stream.push({ type: "thinking_start", contentIndex, partial: output });
	const block = output.content[contentIndex];
	if (block.type === "thinking") block.thinking += thinking;
	stream.push({ type: "thinking_delta", contentIndex, delta: thinking, partial: output });
	stream.push({ type: "thinking_end", contentIndex, content: thinking, partial: output });
}

function finalResponseText(response: Record<string, any>): string {
	const items = Array.isArray(response.output) ? response.output : [];
	const finalText = items
		.filter((item: any) => item?.type === "message")
		.map(messageText)
		.filter(Boolean);
	return finalText.length ? finalText.join("\n") : typeof response.output_text === "string" ? response.output_text : "";
}

function emitResponseContent(response: Record<string, any>, stream: AssistantMessageEventStream, output: AssistantMessage): string {
	const items = Array.isArray(response.output) ? response.output : [];
	const finalText: string[] = [];
	for (const item of items) {
		if (item?.type === "reasoning") {
			const thinking = reasoningText(item);
			if (thinking) emitThinking(stream, output, thinking, JSON.stringify(item));
		} else if (item?.type === "message") {
			const text = messageText(item);
			if (text) {
				emitText(stream, output, text);
				finalText.push(text);
			}
		}
	}
	if (finalText.length) return finalText.join("\n");
	const fallback = typeof response.output_text === "string" ? response.output_text : "";
	if (fallback) emitText(stream, output, fallback);
	return fallback;
}

function repeatedOutputReason(text: string): string | undefined {
	const normalized = text.trim();
	if (normalized.length < 1000) return undefined;
	const blocks = normalized
		.split(/\n{2,}/)
		.map((block) => block.replace(/\s+/g, " ").trim())
		.filter((block) => block.length >= 100);
	const blockCounts = new Map<string, number>();
	for (const block of blocks) blockCounts.set(block, (blockCounts.get(block) ?? 0) + 1);
	for (const [block, count] of blockCounts) {
		if (count >= 4) return `repeated block ${count}x: ${block.slice(0, 80)}`;
	}
	const lines = normalized
		.split(/\n+/)
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter((line) => line.length >= 60);
	const lineCounts = new Map<string, number>();
	for (const line of lines) lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
	for (const [line, count] of lineCounts) {
		if (count >= 8) return `repeated line ${count}x: ${line.slice(0, 80)}`;
	}
	return undefined;
}

function guardRepeatedOutput(tier: "realtime" | "async", model: Model<Api>, responseId: string, turnIndex: number | undefined, response: Record<string, any>): void {
	const reason = repeatedOutputReason(finalResponseText(response));
	if (!reason) return;
	writeJsonl("provider_repetition_detected", { tier, provider: model.provider, model: model.id, responseId, turnIndex, reason });
	throw new Error(`Doubleword ${tier} response ${responseId} repeated output: ${reason}`);
}

function assertCompletedResponse(tier: "realtime" | "async", responseId: string, response: Record<string, any>): void {
	const status = String(response.status ?? "");
	if (["failed", "cancelled", "canceled", "incomplete", "expired"].includes(status)) throw new Error(`Doubleword ${tier} response ${responseId} ended with status ${status}`);
	if (status !== "completed") throw new Error(`Doubleword ${tier} response ${responseId} has unsupported/incomplete status ${status || "missing"}`);
}

function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const dateMs = Date.parse(value);
	return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, any>> {
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

async function fetchJsonWithPollRetry(
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

function emptyMessage(model: Model<Api>, responseId: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		responseId,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function simulateAsyncPolls(model: Model<Api>, responseId: string, turnIndex: number | undefined, options?: SimpleStreamOptions): Promise<void> {
	const submitStart = performance.now();
	writeJsonl("async_submit", {
		provider: model.provider,
		model: model.id,
		responseId,
		turnIndex,
		serviceTierRequested: ASYNC_SERVICE_TIER,
		durationMs: durationMs(submitStart),
	});

	const pollCount = envInt("DOUBLEWORD_ASYNC_STUB_POLLS", 2);
	const pollMs = envInt("DOUBLEWORD_ASYNC_STUB_POLL_MS", 100);
	for (let pollIndex = 1; pollIndex <= pollCount; pollIndex++) {
		const pollStart = performance.now();
		await sleep(pollMs, options?.signal);
		writeJsonl("async_poll", {
			provider: model.provider,
			model: model.id,
			responseId,
			turnIndex,
			serviceTierRequested: ASYNC_SERVICE_TIER,
			pollIndex,
			pollCount,
			status: pollIndex === pollCount ? "complete" : pollIndex === 1 ? "queued" : "in_progress",
			durationMs: durationMs(pollStart),
		});
	}
}

function streamStub(tier: "realtime" | "async", model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const started = performance.now();
		const turnIndex = activeTurnIndex;
		const responseId = `stub-${randomUUID()}`;
		const output = emptyMessage(model, responseId);

		try {
			writeJsonl("provider_start", {
				tier,
				provider: model.provider,
				model: model.id,
				api: model.api,
				responseId,
				turnIndex,
				batchingDiscipline: Boolean(context.systemPrompt?.includes(BATCHING_DISCIPLINE_MARKER)),
			});
			stream.push({ type: "start", partial: output });

			if (tier === "async") await simulateAsyncPolls(model, responseId, turnIndex, options);
			else await sleep(envInt("DOUBLEWORD_REALTIME_STUB_DELAY_MS", 0), options?.signal);

			output.content.push({ type: "text", text: "" });
			const contentIndex = output.content.length - 1;
			stream.push({ type: "text_start", contentIndex, partial: output });

			const block = output.content[contentIndex];
			if (block.type === "text") block.text += FIXTURE_TEXT;
			stream.push({ type: "text_delta", contentIndex, delta: FIXTURE_TEXT, partial: output });
			writeJsonl("provider_ttft", { tier, provider: model.provider, model: model.id, responseId, turnIndex, ttftMs: durationMs(started) });

			stream.push({ type: "text_end", contentIndex, content: FIXTURE_TEXT, partial: output });
			output.usage = usageFor(model, context, FIXTURE_TEXT);
			stream.push({ type: "done", reason: "stop", message: output });
			writeJsonl("provider_end", {
				tier,
				provider: model.provider,
				model: model.id,
				responseId,
				turnIndex,
				durationMs: durationMs(started),
				usage: output.usage,
			});
			stream.end();
		} catch (error) {
			const reason = options?.signal?.aborted ? "aborted" : "error";
			output.stopReason = reason;
			output.errorMessage = error instanceof Error ? error.message : String(error);
			writeJsonl("provider_error", { tier, provider: model.provider, model: model.id, responseId, turnIndex, reason, durationMs: durationMs(started), error: output.errorMessage });
			stream.push({ type: "error", reason, error: output });
			stream.end();
		}
	})();

	return stream;
}

function streamRealtimeStub(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	return streamStub("realtime", model, context, options);
}

function streamAsyncStub(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	return streamStub("async", model, context, options);
}

async function cancelResponse(
	baseUrl: string,
	headers: Headers,
	model: Model<Api>,
	responseId: string,
	turnIndex: number | undefined,
	reason: "aborted" | "timeout",
): Promise<void> {
	const cancelTimeoutMs = envInt("DOUBLEWORD_CANCEL_TIMEOUT_MS", DEFAULT_CANCEL_TIMEOUT_MS);
	writeJsonl("provider_cancel_requested", { tier: "async", provider: model.provider, model: model.id, responseId, turnIndex, reason, cancelTimeoutMs });
	try {
		const cancelResponse = await withTimeout(cancelTimeoutMs, undefined, (signal) =>
			fetchJson(`${baseUrl}/responses/${encodeURIComponent(responseId)}/cancel`, { method: "POST", headers: new Headers(headers), signal }),
		);
		writeJsonl("provider_cancel_end", { tier: "async", provider: model.provider, model: model.id, responseId, turnIndex, reason, status: cancelResponse.status });
	} catch (error) {
		writeJsonl("provider_cancel_error", {
			tier: "async",
			provider: model.provider,
			model: model.id,
			responseId,
			turnIndex,
			reason,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function streamLiveRealtime(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const started = performance.now();
		const turnIndex = activeTurnIndex;
		let responseId = `pending-${randomUUID()}`;
		const output = emptyMessage(model, responseId);

		try {
			writeJsonl("provider_start", { tier: "realtime", provider: model.provider, model: model.id, api: model.api, turnIndex, serviceTierRequested: "priority" });
			stream.push({ type: "start", partial: output });

			const configuredApiKey = options?.apiKey && options.apiKey !== "doubleword-live-placeholder" && !options.apiKey.startsWith("$") ? options.apiKey : undefined;
			const apiKey = process.env.DOUBLEWORD_API_KEY ?? configuredApiKey;
			if (!apiKey) throw new Error("DOUBLEWORD_API_KEY is required for doubleword-realtime live provider");

			const baseUrl = envString("DOUBLEWORD_BASE_URL", model.baseUrl ?? DOUBLEWORD_API_BASE_URL).replace(/\/$/, "");
			const headers = new Headers(options?.headers);
			headers.set("content-type", "application/json");
			headers.set("authorization", `Bearer ${apiKey}`);
			const response = await fetchJson(`${baseUrl}/responses`, {
				method: "POST",
				headers,
				signal: options?.signal,
				body: JSON.stringify({ model: model.id, input: responsesInput(context), service_tier: "priority", max_output_tokens: maxOutputTokensFor(model, options) }),
			});
			responseId = String(response.id ?? responseId);
			output.responseId = responseId;
			assertCompletedResponse("realtime", responseId, response);
			guardRepeatedOutput("realtime", model, responseId, turnIndex, response);
			writeJsonl("provider_ttft", { tier: "realtime", provider: model.provider, model: model.id, responseId, turnIndex, ttftMs: durationMs(started) });
			const text = emitResponseContent(response, stream, output);

			output.usage = usageFromResponse(model, context, text, response);
			stream.push({ type: "done", reason: "stop", message: output });
			writeJsonl("provider_end", {
				tier: "realtime",
				provider: model.provider,
				model: model.id,
				responseId,
				status: response.status,
				serviceTierRequested: "priority",
				serviceTierActual: response.service_tier,
				durationMs: durationMs(started),
				usage: output.usage,
			});
			stream.end();
		} catch (error) {
			const reason = options?.signal?.aborted ? "aborted" : "error";
			output.stopReason = reason;
			output.errorMessage = error instanceof Error ? error.message : String(error);
			writeJsonl("provider_error", { tier: "realtime", provider: model.provider, model: model.id, responseId, turnIndex, reason, serviceTierRequested: "priority", durationMs: durationMs(started), error: output.errorMessage });
			stream.push({ type: "error", reason, error: output });
			stream.end();
		}
	})();

	return stream;
}

function streamLiveAsync(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const started = performance.now();
		const turnIndex = activeTurnIndex;
		let responseId = `pending-${randomUUID()}`;
		let submitted = false;
		let cancelRequested = false;
		let lastStatus = "pending";
		let pollIndex = 0;
		let baseUrl = envString("DOUBLEWORD_BASE_URL", model.baseUrl ?? DOUBLEWORD_API_BASE_URL).replace(/\/$/, "");
		let headers = new Headers(options?.headers);
		const output = emptyMessage(model, responseId);
		const pollMs = envInt("DOUBLEWORD_LIVE_ASYNC_POLL_MS", 2000);
		const timeoutMs = envInt("DOUBLEWORD_LIVE_ASYNC_TIMEOUT_MS", DEFAULT_ASYNC_TIMEOUT_MS);
		const deadline = started + timeoutMs;
		let timeoutLogged = false;
		const remainingDeadlineMs = () => deadline - performance.now();
		function failTimeout(): never {
			if (!timeoutLogged) {
				timeoutLogged = true;
				writeJsonl("provider_timeout", {
					tier: "async",
					provider: model.provider,
					model: model.id,
					responseId,
					turnIndex,
					pollCount: pollIndex,
					lastStatus,
					timeoutMs,
					durationMs: durationMs(started),
				});
			}
			if (submitted && !cancelRequested) {
				cancelRequested = true;
				void cancelResponse(baseUrl, headers, model, responseId, turnIndex, "timeout");
			}
			throw new AsyncTimeoutError(`Timed out after ${formatSeconds(elapsedMs(started))} waiting for ${responseId}; last status=${lastStatus}; polls=${pollIndex}`);
		}
		async function withAsyncDeadline<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
			const remaining = remainingDeadlineMs();
			if (remaining <= 0) failTimeout();
			try {
				return await withTimeout(remaining, options?.signal, run);
			} catch (error) {
				if (!options?.signal?.aborted && remainingDeadlineMs() <= 0) failTimeout();
				throw error;
			}
		}

		try {
			writeJsonl("provider_start", { tier: "async", provider: model.provider, model: model.id, api: model.api, turnIndex, serviceTierRequested: ASYNC_SERVICE_TIER });
			stream.push({ type: "start", partial: output });

			const configuredApiKey = options?.apiKey && options.apiKey !== "doubleword-live-placeholder" && !options.apiKey.startsWith("$") ? options.apiKey : undefined;
			const apiKey = process.env.DOUBLEWORD_API_KEY ?? configuredApiKey;
			if (!apiKey) throw new Error("DOUBLEWORD_API_KEY is required for doubleword-async live provider");

			headers.set("content-type", "application/json");
			headers.set("authorization", `Bearer ${apiKey}`);
			const submitStart = performance.now();
			let response = await withAsyncDeadline((signal) =>
				fetchJson(`${baseUrl}/responses`, {
					method: "POST",
					headers,
					signal,
					body: JSON.stringify({
						model: model.id,
						input: responsesInput(context),
						service_tier: ASYNC_SERVICE_TIER,
						background: true,
						max_output_tokens: maxOutputTokensFor(model, options),
					}),
				}),
			);
			submitted = true;
			responseId = String(response.id ?? responseId);
			output.responseId = responseId;
			lastStatus = String(response.status ?? "");
			writeJsonl("async_submit", {
				provider: model.provider,
				model: model.id,
				responseId,
				turnIndex,
				status: response.status,
				serviceTierRequested: ASYNC_SERVICE_TIER,
				serviceTierActual: response.service_tier,
				durationMs: durationMs(submitStart),
			});

			while (["queued", "in_progress"].includes(String(response.status))) {
				if (options?.signal?.aborted) throw new Error("aborted");
				const remaining = remainingDeadlineMs();
				if (remaining <= 0) failTimeout();

				if (pollMs > 0 && remaining <= pollMs) {
					try {
						response = await withAsyncDeadline((signal) =>
							fetchJsonWithPollRetry(
								`${baseUrl}/responses/${encodeURIComponent(responseId)}`,
								{ method: "GET", headers, signal },
								{ deadline, pollIndex, model, responseId, turnIndex },
							),
						);
					} catch (error) {
						if (options?.signal?.aborted) throw error;
						await sleep(Math.max(0, remainingDeadlineMs()), options?.signal);
						failTimeout();
					}
					lastStatus = String(response.status ?? lastStatus);
					if (!["queued", "in_progress"].includes(lastStatus)) break;
					await sleep(Math.max(0, remainingDeadlineMs()), options?.signal);
					failTimeout();
				}

				const pollStart = performance.now();
				await sleep(Math.min(pollMs, remaining), options?.signal);
				pollIndex++;
				response = await withAsyncDeadline((signal) =>
					fetchJsonWithPollRetry(
						`${baseUrl}/responses/${encodeURIComponent(responseId)}`,
						{ method: "GET", headers, signal },
						{ deadline, pollIndex, model, responseId, turnIndex },
					),
				);
				lastStatus = String(response.status ?? lastStatus);
				writeJsonl("async_poll", {
					provider: model.provider,
					model: model.id,
					responseId,
					turnIndex,
					serviceTierRequested: ASYNC_SERVICE_TIER,
					serviceTierActual: response.service_tier,
					pollIndex,
					status: response.status,
					durationMs: durationMs(pollStart),
				});
			}

			assertCompletedResponse("async", responseId, response);
			guardRepeatedOutput("async", model, responseId, turnIndex, response);

			writeJsonl("provider_ttft", { tier: "async", provider: model.provider, model: model.id, responseId, turnIndex, ttftMs: durationMs(started) });
			const text = emitResponseContent(response, stream, output);

			output.usage = usageFromResponse(model, context, text, response);
			stream.push({ type: "done", reason: "stop", message: output });
			writeJsonl("provider_end", {
				tier: "async",
				provider: model.provider,
				model: model.id,
				responseId,
				turnIndex,
				status: response.status,
				serviceTierRequested: ASYNC_SERVICE_TIER,
				serviceTierActual: response.service_tier,
				durationMs: durationMs(started),
				pollCount: pollIndex,
				usage: output.usage,
			});
			stream.end();
		} catch (error) {
			const reason = options?.signal?.aborted ? "aborted" : "error";
			if (reason === "aborted" && submitted && !cancelRequested) {
				cancelRequested = true;
				void cancelResponse(baseUrl, headers, model, responseId, turnIndex, "aborted");
			}
			output.stopReason = reason;
			output.errorMessage = error instanceof Error ? error.message : String(error);
			writeJsonl("provider_error", {
				tier: "async",
				provider: model.provider,
				model: model.id,
				responseId,
				turnIndex,
				reason,
				serviceTierRequested: ASYNC_SERVICE_TIER,
				durationMs: durationMs(started),
				pollCount: pollIndex,
				lastStatus,
				error: output.errorMessage,
			});
			stream.push({ type: "error", reason, error: output });
			stream.end();
		}
	})();

	return stream;
}

const stubModel = (id: string, name: string, cost: ModelCost = ZERO_COST, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS): ProviderModel => ({
	id,
	name,
	reasoning: false,
	input: ["text"],
	cost,
	contextWindow: 128000,
	maxTokens,
});

const REALTIME_STUB_MODELS = [
	stubModel("glm-5-2", "GLM-5.2-FP8", { input: 1.4, output: 4.4, cacheRead: 0, cacheWrite: 0 }),
	stubModel("deepseek-v4-flash", "DeepSeek-V4-Flash", { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 }),
];

const FALLBACK_LIVE_MODELS = [
	stubModel(LIVE_GLM_MODEL_ID, "GLM-5.2-FP8"),
	stubModel(LIVE_DEEPSEEK_MODEL_ID, "DeepSeek-V4-Flash"),
];

const KNOWN_TIER_COSTS: Record<string, TierCosts> = {
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

function withTierCost(model: ProviderModel, tier: "realtime" | "async"): ProviderModel {
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

async function discoverLiveModels(): Promise<ProviderModel[]> {
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
			writeJsonl("model_discovery_error", { provider: LIVE_REALTIME_PROVIDER, baseUrl, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return readCachedModels(baseUrl) ?? FALLBACK_LIVE_MODELS;
}

export async function registerDoublewordProviders(pi: ExtensionAPI): Promise<void> {
	const liveModels = await discoverLiveModels();
	pi.registerProvider(REALTIME_PROVIDER, {
		name: "Doubleword Realtime Stub",
		baseUrl: "http://localhost/doubleword-realtime-stub",
		apiKey: "doubleword-stub",
		api: "doubleword-realtime-stub-api",
		models: REALTIME_STUB_MODELS,
		streamSimple: streamRealtimeStub,
	});

	pi.registerProvider(LIVE_REALTIME_PROVIDER, {
		name: "Doubleword Realtime",
		baseUrl: DOUBLEWORD_API_BASE_URL,
		apiKey: "doubleword-live-placeholder",
		api: "doubleword-realtime-api",
		models: liveModels.map((model) => withTierCost(model, "realtime")),
		streamSimple: streamLiveRealtime,
	});

	pi.registerProvider(ASYNC_PROVIDER, {
		name: "Doubleword Async Stub",
		baseUrl: "http://localhost/doubleword-async-stub",
		apiKey: "doubleword-stub",
		api: "doubleword-async-stub-api",
		models: [stubModel(ASYNC_PROVIDER, "Doubleword async stub")],
		streamSimple: streamAsyncStub,
	});

	pi.registerProvider(LIVE_ASYNC_PROVIDER, {
		name: "Doubleword Async",
		baseUrl: DOUBLEWORD_API_BASE_URL,
		apiKey: "doubleword-live-placeholder",
		api: "doubleword-async-api",
		models: liveModels.map((model) => withTierCost(model, "async")),
		streamSimple: streamLiveAsync,
	});
}

export default async function (pi: ExtensionAPI): Promise<void> {
	await registerDoublewordProviders(pi);
}
