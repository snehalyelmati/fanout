import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createAssistantMessageEventStream, type Api, type AssistantMessageEventStream, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ASYNC_SERVICE_TIER, BATCHING_DISCIPLINE_MARKER, envInt, sleep } from "./config.ts";
import { emptyMessage, usageFor } from "./messages.ts";
import { durationMs, getDoublewordActiveTurnIndex, writeJsonl } from "./observability.ts";

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
		const turnIndex = getDoublewordActiveTurnIndex();
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
				usageSource: "synthetic-stub",
				pricingSource: "doubleword-stub-model-metadata",
			});
			stream.end();
		} catch (error) {
			const reason = options?.signal?.aborted ? "aborted" : "error";
			output.stopReason = reason;
			output.errorMessage = error instanceof Error ? error.message : String(error);
			writeJsonl("provider_error", { tier, provider: model.provider, model: model.id, responseId, turnIndex, reason, failureCode: reason === "aborted" ? "abort" : "protocol", durationMs: durationMs(started), error: output.errorMessage });
			stream.push({ type: "error", reason, error: output });
			stream.end();
		}
	})();

	return stream;
}

export function streamRealtimeStub(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	return streamStub("realtime", model, context, options);
}

export function streamAsyncStub(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	return streamStub("async", model, context, options);
}
