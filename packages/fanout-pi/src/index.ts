import { performance } from "node:perf_hooks";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDoublewordProviders, setDoublewordActiveTurnIndex, setDoublewordRunId } from "../../doubleword-provider/src/index.ts";
import { BATCHING_DISCIPLINE, BATCHING_DISCIPLINE_MARKER } from "../../fanout-core/src/batching-discipline.ts";
import { durationMs, RUN_ID, setObservabilityCwd, writeJsonl } from "../../fanout-core/src/observability.ts";

export default async function (pi: ExtensionAPI) {
	let agentStarted: number | undefined;
	let agentTurnCount = 0;
	let agentToolCallCount = 0;
	let activeTurnIndex: number | undefined;
	const turnStats = new Map<number, { started: number; toolCallCount: number }>();
	const toolStarts = new Map<string, { started: number; turnIndex?: number }>();

	setDoublewordRunId(RUN_ID);
	await registerDoublewordProviders(pi);

	pi.on("session_start", (_event, ctx) => {
		setObservabilityCwd(ctx.cwd);
		writeJsonl("session_start", { cwd: ctx.cwd, mode: ctx.mode }, ctx.cwd);
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: event.systemPrompt.includes(BATCHING_DISCIPLINE_MARKER) ? event.systemPrompt : `${event.systemPrompt}\n\n${BATCHING_DISCIPLINE}`,
	}));

	pi.on("agent_start", (_event, ctx) => {
		agentStarted = performance.now();
		agentTurnCount = 0;
		agentToolCallCount = 0;
		writeJsonl("agent_start", {}, ctx.cwd);
	});

	pi.on("agent_end", (_event, ctx) => {
		writeJsonl(
			"agent_end",
			{
				durationMs: agentStarted === undefined ? undefined : durationMs(agentStarted),
				turnCount: agentTurnCount,
				toolCallCount: agentToolCallCount,
			},
			ctx.cwd,
		);
		agentStarted = undefined;
	});

	pi.on("turn_start", (event, ctx) => {
		activeTurnIndex = event.turnIndex;
		setDoublewordActiveTurnIndex(event.turnIndex);
		agentTurnCount++;
		turnStats.set(event.turnIndex, { started: performance.now(), toolCallCount: 0 });
		writeJsonl("turn_start", { turnIndex: event.turnIndex }, ctx.cwd);
	});

	pi.on("turn_end", (event, ctx) => {
		const stats = turnStats.get(event.turnIndex);
		turnStats.delete(event.turnIndex);
		writeJsonl(
			"turn_end",
			{
				turnIndex: event.turnIndex,
				durationMs: stats === undefined ? undefined : durationMs(stats.started),
				toolCallCount: stats?.toolCallCount ?? 0,
				toolResultCount: Array.isArray(event.toolResults) ? event.toolResults.length : undefined,
			},
			ctx.cwd,
		);
		if (activeTurnIndex === event.turnIndex) {
			activeTurnIndex = undefined;
			setDoublewordActiveTurnIndex(undefined);
		}
	});

	pi.on("tool_execution_start", (event, ctx) => {
		const turnIndex = activeTurnIndex;
		const stats = turnIndex === undefined ? undefined : turnStats.get(turnIndex);
		if (stats) stats.toolCallCount++;
		agentToolCallCount++;
		toolStarts.set(event.toolCallId, { started: performance.now(), turnIndex });
		writeJsonl("tool_start", { toolCallId: event.toolCallId, toolName: event.toolName, turnIndex }, ctx.cwd);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const started = toolStarts.get(event.toolCallId);
		toolStarts.delete(event.toolCallId);
		writeJsonl(
			"tool_end",
			{
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				turnIndex: started?.turnIndex,
				isError: event.isError,
				durationMs: started === undefined ? undefined : durationMs(started.started),
			},
			ctx.cwd,
		);
	});
}
