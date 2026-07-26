import { expect, test } from "bun:test";
import { createToolDetailLoader, extractToolDetails, summarizeToolCall } from "./tool-detail.js";

test("tool summaries expose bounded targets without edit bodies", () => {
	expect(summarizeToolCall({ name: "read", arguments: { path: "index.js", offset: 10 } })).toBe("index.js");
	expect(summarizeToolCall({ name: "grep", arguments: { path: "test.js", pattern: "pMapIterable|AbortController" } })).toBe("“pMapIterable|AbortController” in test.js");
	expect(summarizeToolCall({ name: "find", arguments: { path: "..", pattern: "TASK.md" } })).toBe("TASK.md under ..");
	expect(summarizeToolCall({ name: "edit", arguments: { path: "index.js", edits: [{ oldText: "secret", newText: "replacement" }] } })).toBe("index.js");
	expect(extractToolDetails(["not json", JSON.stringify({ message: { content: [{ type: "toolCall", id: "tool-1", name: "write", arguments: { path: "result.ts", content: "hidden" } }] } })])).toEqual(new Map([["tool-1", "result.ts"]]));
});

test("tool details load lazily from matching session evidence", async () => {
	const workspace = {
		projectId: "project", selection: { id: "run" }, recentRuns: [{ id: "run", selected: true }],
		supportingEvidence: [{ label: "session/run.jsonl", source: { id: "source", path: "packet/executions/run/workers/node-a-deadbeef/attempts/001-original/session/run.jsonl" } }],
	};
	const row = { kind: "tool", nodeId: "node-a", selection: { id: "tool-1" } }, requests: string[] = [];
	const loader = createToolDetailLoader((path: string, params: Record<string, unknown>) => `${path}?${new URLSearchParams(params as Record<string, string>)}`, async (url: string) => {
		requests.push(url);
		return new Response(JSON.stringify({ status: "Current", rows: [JSON.stringify({ message: { content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "index.js" } }] } })], nextOffset: null }));
	});
	expect(loader.get(workspace, row)).toBeNull();
	expect(await loader.load(workspace, [row])).toBe(true);
	expect(loader.get(workspace, row)).toBe("index.js");
	expect(await loader.load(workspace, [row])).toBe(false);
	expect(requests).toHaveLength(1);
});
