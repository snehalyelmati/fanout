import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createAssistantMessageEventStream, type Api, type AssistantMessageEventStream, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ASYNC_SERVICE_TIER, DEFAULT_ASYNC_TIMEOUT_MS, DEFAULT_CANCEL_TIMEOUT_MS, DOUBLEWORD_API_BASE_URL, elapsedMs, envInt, envString, formatSeconds, maxOutputTokensFor, sleep, withTimeout } from "./config.ts";
import { fetchJson, fetchJsonWithPollRetry } from "./http.ts";
import { assertCompletedResponse, emitResponseContent, emptyMessage, guardRepeatedOutput, responsesInput, usageFromResponse } from "./messages.ts";
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
