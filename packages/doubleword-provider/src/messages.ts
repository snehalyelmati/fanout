import type { Api, AssistantMessage, AssistantMessageEventStream, Context, Model, StopReason, Tool, Usage } from "@earendil-works/pi-ai";
import { writeJsonl } from "./observability.ts";

export function textFrom(value: unknown): string {
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

function countTokens(text: string): number {
	return text.trim() ? text.trim().split(/\s+/).length : 0;
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

export function usageFor(model: Model<Api>, context: Context, outputText: string): Usage {
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

export function numberFrom(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function usageFromResponse(model: Model<Api>, context: Context, outputText: string, response: Record<string, any>): Usage {
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

function inputContent(content: unknown): any[] {
	if (typeof content === "string") return [{ type: "input_text", text: content }];
	if (!Array.isArray(content)) return [];
	return content
		.map((part: any) => {
			if (part?.type === "text") return { type: "input_text", text: part.text ?? "" };
			if (part?.type === "image") return { type: "input_image", detail: "auto", image_url: `data:${part.mimeType};base64,${part.data}` };
			return undefined;
		})
		.filter(Boolean);
}

function splitToolCallId(id: string | undefined): [string, string | undefined] {
	if (!id) return ["call_unknown", undefined];
	const [callId, itemId] = id.split("|");
	return [callId || id, itemId];
}

export function responsesInput(context: Context): any[] {
	const input: any[] = [];
	if (context.systemPrompt) input.push({ role: "system", content: [{ type: "input_text", text: context.systemPrompt }] });

	context.messages.forEach((message, messageIndex) => {
		if (message.role === "user") {
			const content = inputContent(message.content);
			if (content.length) input.push({ role: "user", content });
			return;
		}

		if (message.role === "assistant") {
			let textIndex = 0;
			for (const block of message.content) {
				if (block.type === "text" && block.text.trim()) {
					input.push({
						type: "message",
						role: "assistant",
						status: "completed",
						id: `msg_dw_${messageIndex}_${textIndex++}`,
						content: [{ type: "output_text", text: block.text, annotations: [] }],
					});
				} else if (block.type === "thinking" && block.thinkingSignature?.startsWith("{")) {
					try {
						input.push(JSON.parse(block.thinkingSignature));
					} catch {
						// Ignore invalid opaque reasoning replay data.
					}
				} else if (block.type === "toolCall") {
					const [callId, itemId] = splitToolCallId(block.id);
					input.push({
						type: "function_call",
						id: itemId,
						call_id: callId,
						name: block.name,
						arguments: JSON.stringify(block.arguments ?? {}),
					});
				}
			}
			return;
		}

		if (message.role === "toolResult") {
			const [callId] = splitToolCallId(message.toolCallId);
			const output = textFrom(message.content) || "(see attached image)";
			input.push({ type: "function_call_output", call_id: callId, output });
		}
	});

	return input;
}

export function responsesTools(tools: Tool[] | undefined): any[] | undefined {
	return tools?.length
		? tools.map((tool) => ({
				type: "function",
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				strict: false,
			}))
		: undefined;
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

export function emitText(stream: AssistantMessageEventStream, output: AssistantMessage, text: string): void {
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

function parseArgs(value: unknown): Record<string, any> {
	if (!value) return {};
	if (typeof value === "object") return value as Record<string, any>;
	try {
		return JSON.parse(String(value));
	} catch {
		return {};
	}
}

function emitToolCall(stream: AssistantMessageEventStream, output: AssistantMessage, item: any): void {
	const callId = String(item.call_id ?? item.id ?? `call_${output.content.length}`);
	const itemId = String(item.id ?? `fc_${callId}`);
	const rawArgs = typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {});
	const toolCall = { type: "toolCall" as const, id: `${callId}|${itemId}`, name: String(item.name ?? "unknown"), arguments: parseArgs(item.arguments) };
	output.content.push(toolCall);
	const contentIndex = output.content.length - 1;
	stream.push({ type: "toolcall_start", contentIndex, partial: output });
	if (rawArgs) stream.push({ type: "toolcall_delta", contentIndex, delta: rawArgs, partial: output });
	stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
}

function finalResponseText(response: Record<string, any>): string {
	const items = Array.isArray(response.output) ? response.output : [];
	const finalText = items
		.filter((item: any) => item?.type === "message")
		.map(messageText)
		.filter(Boolean);
	return finalText.length ? finalText.join("\n") : typeof response.output_text === "string" ? response.output_text : "";
}

export function emitResponseContent(response: Record<string, any>, stream: AssistantMessageEventStream, output: AssistantMessage): { text: string; stopReason: Extract<StopReason, "stop" | "length" | "toolUse"> } {
	const items = Array.isArray(response.output) ? response.output : [];
	const finalText: string[] = [];
	let hasToolCall = false;
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
		} else if (item?.type === "function_call") {
			emitToolCall(stream, output, item);
			hasToolCall = true;
		}
	}
	if (finalText.length) return { text: finalText.join("\n"), stopReason: hasToolCall ? "toolUse" : "stop" };
	const fallback = typeof response.output_text === "string" ? response.output_text : "";
	if (fallback) emitText(stream, output, fallback);
	return { text: fallback, stopReason: hasToolCall ? "toolUse" : "stop" };
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

export function guardRepeatedOutput(tier: "realtime" | "async", model: Model<Api>, responseId: string, turnIndex: number | undefined, response: Record<string, any>): void {
	const reason = repeatedOutputReason(finalResponseText(response));
	if (!reason) return;
	writeJsonl("provider_repetition_detected", { tier, provider: model.provider, model: model.id, responseId, turnIndex, reason });
	throw new Error(`Doubleword ${tier} response ${responseId} repeated output: ${reason}`);
}

export function assertCompletedResponse(tier: "realtime" | "async", responseId: string, response: Record<string, any>): void {
	const status = String(response.status ?? "");
	if (["failed", "cancelled", "canceled", "incomplete", "expired"].includes(status)) throw new Error(`Doubleword ${tier} response ${responseId} ended with status ${status}`);
	if (status !== "completed") throw new Error(`Doubleword ${tier} response ${responseId} has unsupported/incomplete status ${status || "missing"}`);
}

export function emptyMessage(model: Model<Api>, responseId: string): AssistantMessage {
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
