import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
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
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const RUN_ID = process.env.DOUBLEWORD_RUN_ID ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;

let cwd = process.cwd();

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

function envInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function durationMs(start: number): number {
	return Math.round((performance.now() - start) * 1000) / 1000;
}

function writeJsonl(event: string, data: Record<string, unknown> = {}, baseCwd = cwd): void {
	try {
		const file = process.env.DOUBLEWORD_OBSERVABILITY_FILE ?? join(baseCwd, "runs", RUN_ID, "observability.jsonl");
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), runId: RUN_ID, event, ...data })}\n`, "utf8");
	} catch {
		// Observability must not break provider streaming.
	}
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

function usageFor(context: Context, outputText: string): Usage {
	const input = countTokens([context.systemPrompt ?? "", ...context.messages.map((message) => textFrom(message.content))].join("\n"));
	const output = countTokens(outputText);
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
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

async function simulateAsyncPolls(responseId: string, options?: SimpleStreamOptions): Promise<void> {
	const submitStart = performance.now();
	writeJsonl("async_submit", { provider: ASYNC_PROVIDER, responseId, durationMs: durationMs(submitStart) });

	const pollCount = envInt("DOUBLEWORD_ASYNC_STUB_POLLS", 2);
	const pollMs = envInt("DOUBLEWORD_ASYNC_STUB_POLL_MS", 100);
	for (let pollIndex = 1; pollIndex <= pollCount; pollIndex++) {
		const pollStart = performance.now();
		await sleep(pollMs, options?.signal);
		writeJsonl("async_poll", {
			provider: ASYNC_PROVIDER,
			responseId,
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
		const responseId = `stub-${randomUUID()}`;
		const output = emptyMessage(model, responseId);

		try {
			writeJsonl("provider_start", { tier, provider: model.provider, model: model.id, api: model.api, responseId });
			stream.push({ type: "start", partial: output });

			if (tier === "async") await simulateAsyncPolls(responseId, options);
			else await sleep(envInt("DOUBLEWORD_REALTIME_STUB_DELAY_MS", 0), options?.signal);

			output.content.push({ type: "text", text: "" });
			const contentIndex = output.content.length - 1;
			stream.push({ type: "text_start", contentIndex, partial: output });

			const block = output.content[contentIndex];
			if (block.type === "text") block.text += FIXTURE_TEXT;
			stream.push({ type: "text_delta", contentIndex, delta: FIXTURE_TEXT, partial: output });
			writeJsonl("provider_ttft", { tier, provider: model.provider, model: model.id, responseId, ttftMs: durationMs(started) });

			stream.push({ type: "text_end", contentIndex, content: FIXTURE_TEXT, partial: output });
			output.usage = usageFor(context, FIXTURE_TEXT);
			stream.push({ type: "done", reason: "stop", message: output });
			writeJsonl("provider_end", {
				tier,
				provider: model.provider,
				model: model.id,
				responseId,
				durationMs: durationMs(started),
				usage: output.usage,
			});
			stream.end();
		} catch (error) {
			const reason = options?.signal?.aborted ? "aborted" : "error";
			output.stopReason = reason;
			output.errorMessage = error instanceof Error ? error.message : String(error);
			writeJsonl("provider_error", { tier, provider: model.provider, model: model.id, responseId, reason, durationMs: durationMs(started), error: output.errorMessage });
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

const stubModel = (id: string, name: string) => ({
	id,
	name,
	reasoning: false,
	input: ["text" as const],
	cost: ZERO_COST,
	contextWindow: 128000,
	maxTokens: 4096,
});

export default function (pi: ExtensionAPI) {
	const toolStarts = new Map<string, number>();

	pi.registerProvider(REALTIME_PROVIDER, {
		name: "Doubleword Realtime Stub",
		baseUrl: "http://localhost/doubleword-realtime-stub",
		apiKey: "doubleword-stub",
		api: "doubleword-realtime-stub-api",
		models: [stubModel(REALTIME_PROVIDER, "Doubleword realtime stub")],
		streamSimple: streamRealtimeStub,
	});

	pi.registerProvider(ASYNC_PROVIDER, {
		name: "Doubleword Async Stub",
		baseUrl: "http://localhost/doubleword-async-stub",
		apiKey: "doubleword-stub",
		api: "doubleword-async-stub-api",
		models: [stubModel(ASYNC_PROVIDER, "Doubleword async stub")],
		streamSimple: streamAsyncStub,
	});

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		writeJsonl("session_start", { cwd, mode: ctx.mode }, cwd);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		toolStarts.set(event.toolCallId, performance.now());
		writeJsonl("tool_start", { toolCallId: event.toolCallId, toolName: event.toolName }, ctx.cwd);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const started = toolStarts.get(event.toolCallId);
		toolStarts.delete(event.toolCallId);
		writeJsonl(
			"tool_end",
			{
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				isError: event.isError,
				durationMs: started === undefined ? undefined : durationMs(started),
			},
			ctx.cwd,
		);
	});
}
