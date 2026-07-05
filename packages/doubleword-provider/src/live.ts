import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createAssistantMessageEventStream, type Api, type AssistantMessageEventStream, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ASYNC_SERVICE_TIER, DEFAULT_ASYNC_TIMEOUT_MS, DEFAULT_CANCEL_TIMEOUT_MS, DOUBLEWORD_API_BASE_URL, elapsedMs, envInt, envString, formatSeconds, maxOutputTokensFor, sleep, withTimeout } from "./config.ts";
import { fetchJson, fetchJsonWithPollRetry } from "./http.ts";
import { assertCompletedResponse, emitResponseContent, emitResponseToolCalls, emptyMessage, endText, guardRepeatedOutput, pushTextDelta, responsesInput, responsesTools, startText, usageFromResponse } from "./messages.ts";
import { DOUBLEWORD_THINKING_LEVEL_MAP } from "./models.ts";
import { durationMs, getDoublewordActiveTurnIndex, writeJsonl } from "./observability.ts";

class AsyncTimeoutError extends Error {}

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

function sseEvents(chunk: string, buffer: { text: string }): Array<{ event?: string; data: string }> {
	buffer.text += chunk;
	const events: Array<{ event?: string; data: string }> = [];
	for (;;) {
		const splitAt = buffer.text.search(/\r?\n\r?\n/);
		if (splitAt < 0) break;
		const raw = buffer.text.slice(0, splitAt);
		buffer.text = buffer.text.slice(buffer.text[splitAt] === "\r" ? splitAt + 4 : splitAt + 2);
		let event: string | undefined;
		const data: string[] = [];
		for (const line of raw.split(/\r?\n/)) {
			if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
		}
		if (data.length) events.push({ event, data: data.join("\n") });
	}
	return events;
}

function streamError(data: any): string {
	return String(data?.error?.message ?? data?.message ?? data?.response?.error?.message ?? JSON.stringify(data));
}

export function doublewordReasoningEffort(model: Model<Api>, options?: SimpleStreamOptions): string | undefined {
	if (!model.reasoning) return undefined;
	const level = options?.reasoning ?? "medium";
	const effort = model.thinkingLevelMap && Object.hasOwn(model.thinkingLevelMap, level) ? model.thinkingLevelMap[level] : DOUBLEWORD_THINKING_LEVEL_MAP[level];
	return effort === null ? undefined : effort;
}

export function responsesRequestBody(model: Model<Api>, context: Context, options: SimpleStreamOptions | undefined, body: Record<string, any>): Record<string, any> {
	const tools = responsesTools(context.tools);
	const reasoningEffort = doublewordReasoningEffort(model, options);
	return {
		model: model.id,
		input: responsesInput(context),
		...(tools ? { tools } : {}),
		...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
		...body,
		max_output_tokens: maxOutputTokensFor(model, options),
	};
}

export function streamLiveRealtime(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const started = performance.now();
		const turnIndex = getDoublewordActiveTurnIndex();
		let responseId = `pending-${randomUUID()}`;
		const output = emptyMessage(model, responseId);

		try {
			writeJsonl("provider_start", { tier: "realtime", provider: model.provider, model: model.id, api: model.api, turnIndex, serviceTierRequested: "priority" });
			stream.push({ type: "start", partial: output });

			const configuredApiKey = options?.apiKey && options.apiKey !== "doubleword-live-placeholder" && !options.apiKey.startsWith("$") ? options.apiKey : undefined;
			const apiKey = process.env.DOUBLEWORD_API_KEY ?? configuredApiKey;
			if (!apiKey) throw new Error("DOUBLEWORD_API_KEY is required for doubleword live provider");

			const baseUrl = envString("DOUBLEWORD_BASE_URL", model.baseUrl ?? DOUBLEWORD_API_BASE_URL).replace(/\/$/, "");
			const headers = new Headers(options?.headers);
			headers.set("content-type", "application/json");
			headers.set("authorization", `Bearer ${apiKey}`);
			const httpResponse = await fetch(`${baseUrl}/responses`, {
				method: "POST",
				headers,
				signal: options?.signal,
				body: JSON.stringify(responsesRequestBody(model, context, options, { service_tier: "priority", stream: true })),
			});
			if (!httpResponse.ok) throw new Error(`Doubleword API error ${httpResponse.status}${httpResponse.statusText ? ` ${httpResponse.statusText}` : ""}: ${await httpResponse.text()}`);
			if (!httpResponse.body) throw new Error("Doubleword realtime stream response had no body");

			let response: Record<string, any> | undefined;
			let contentIndex: number | undefined;
			let text = "";
			let textEnded = false;
			let ttftLogged = false;
			const logTtft = () => {
				if (ttftLogged) return;
				ttftLogged = true;
				writeJsonl("provider_ttft", { tier: "realtime", provider: model.provider, model: model.id, responseId, turnIndex, ttftMs: durationMs(started) });
			};

			const decoder = new TextDecoder();
			const reader = httpResponse.body.getReader();
			const buffer = { text: "" };
			for (;;) {
				const { done, value } = await reader.read();
				for (const event of sseEvents(done ? decoder.decode() : decoder.decode(value, { stream: true }), buffer)) {
					if (event.data === "[DONE]") continue;
					const data = JSON.parse(event.data);
					const type = event.event ?? data.type;
					if (data.response?.id || data.id) {
						responseId = String(data.response?.id ?? data.id);
						output.responseId = responseId;
					}
					if (type === "response.output_text.delta") {
						const delta = String(data.delta ?? "");
						if (!delta) continue;
						if (contentIndex === undefined) contentIndex = startText(stream, output);
						pushTextDelta(stream, output, contentIndex, delta);
						text += delta;
						logTtft();
					} else if (type === "response.output_text.done") {
						if (contentIndex === undefined && data.text) {
							contentIndex = startText(stream, output);
							pushTextDelta(stream, output, contentIndex, String(data.text));
							text += String(data.text);
							logTtft();
						}
						if (contentIndex !== undefined && !textEnded) {
							endText(stream, output, contentIndex);
							textEnded = true;
						}
					} else if (type === "response.completed") {
						response = data.response ?? data;
					} else if (["response.failed", "response.incomplete", "error"].includes(type)) {
						throw new Error(streamError(data));
					}
				}
				if (done) break;
			}
			if (contentIndex !== undefined && !textEnded) endText(stream, output, contentIndex);
			response ??= { id: responseId, status: "completed", output_text: text };
			responseId = String(response.id ?? responseId);
			output.responseId = responseId;
			assertCompletedResponse("realtime", responseId, response);
			guardRepeatedOutput("realtime", model, responseId, turnIndex, response);
			let stopReason: "stop" | "length" | "toolUse" = "stop";
			if (!text) {
				logTtft();
				const emitted = emitResponseContent(response, stream, output);
				text = emitted.text;
				stopReason = emitted.stopReason;
			} else if (emitResponseToolCalls(response, stream, output)) {
				stopReason = "toolUse";
			}

			output.stopReason = stopReason;
			output.usage = usageFromResponse(model, context, text, response);
			stream.push({ type: "done", reason: stopReason, message: output });
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

export function streamLiveAsync(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const started = performance.now();
		const turnIndex = getDoublewordActiveTurnIndex();
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
			if (!apiKey) throw new Error("DOUBLEWORD_API_KEY is required for doubleword live provider");

			headers.set("content-type", "application/json");
			headers.set("authorization", `Bearer ${apiKey}`);
			const submitStart = performance.now();
			let response = await withAsyncDeadline((signal) =>
				fetchJson(`${baseUrl}/responses`, {
					method: "POST",
					headers,
					signal,
					body: JSON.stringify(responsesRequestBody(model, context, options, { service_tier: ASYNC_SERVICE_TIER, background: true })),
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
			const { text, stopReason } = emitResponseContent(response, stream, output);

			output.stopReason = stopReason;
			output.usage = usageFromResponse(model, context, text, response);
			stream.push({ type: "done", reason: stopReason, message: output });
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
