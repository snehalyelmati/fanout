import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDoublewordDevProviders } from "../../doubleword-provider/src/dev.ts";
import { setDoublewordActiveTurnIndex, setDoublewordRunId } from "../../doubleword-provider/src/index.ts";
import { BATCHING_DISCIPLINE, BATCHING_DISCIPLINE_MARKER, PLANNING_BATCHING_DISCIPLINE } from "../../fanout-core/src/batching-discipline.ts";
import { durationMs, RUN_ID, writeJsonl } from "../../fanout-core/src/observability.ts";
import { configureFanoutTier } from "./fanout-config.ts";
import { executeFanout } from "./fanout-execute.ts";
import {
	augmentRegistryModels,
	configureMainObservability,
	fanoutRuntimeContext,
	globalSettingsPath,
	isRecord,
	rememberDoublewordModels,
	writeFanoutRuntimeContext,
} from "./fanout-runtime-context.ts";
import { FanoutPlanningController } from "./fanout-planning-controller.ts";
import { roundedDuration } from "./planning-observability.ts";
import { displayFanoutExecutionReport, registerFanoutReportPresentation } from "./report-presentation.ts";
import { workerToolBlockReason } from "./worker-capabilities.ts";
import { loadWorkerValidationContext, registerWorkerValidationTool, workerValidationBatchBlockReason } from "./worker-validation.ts";

export default async function (pi: ExtensionAPI) {
	let agentStarted: number | undefined;
	let agentTurnCount = 0;
	let agentToolCallCount = 0;
	let activeTurnIndex: number | undefined;
	let activeModel: unknown;
	let activeThinking: unknown;
	const turnStats = new Map<number, { started: number; toolCallCount: number; firstAssistantUpdateMs?: number }>();
	const toolStarts = new Map<string, { started: number; turnIndex?: number; planRunId?: string; phase?: "profile" | "implementation" | "details" }>();
	let fanoutExecutionInProgress = false;
	const reportPresentationAvailable = registerFanoutReportPresentation(pi);
	const planning = new FanoutPlanningController(pi, { reportPresentationAvailable, activeModel: () => activeModel, activeThinking: () => activeThinking });
	const workerValidation = loadWorkerValidationContext();
	planning.register();
	if (workerValidation) registerWorkerValidationTool(pi, workerValidation);

	setDoublewordRunId(RUN_ID);
	configureMainObservability(fanoutRuntimeContext(process.cwd(), undefined, undefined));
	await registerDoublewordDevProviders(pi, rememberDoublewordModels, { controls: false });

	pi.registerCommand("fanout-config", {
		description: "Configure Fanout tier models",
		handler: async (args, ctx) => {
			const context = fanoutRuntimeContext(ctx.cwd, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel(), ctx.modelRegistry?.getAll?.());
			const registryModels = augmentRegistryModels((ctx.modelRegistry?.getAll?.() ?? []).filter(isRecord));
			await configureFanoutTier(
				args,
				ctx,
				activeModel ?? ctx.model,
				activeThinking ?? pi.getThinkingLevel(),
				globalSettingsPath(),
				context.artifactRoot,
				context.resolvedTierPlan,
				registryModels,
				async (model, thinking) => {
					const changed = await pi.setModel(model as any);
					if (changed) pi.setThinkingLevel(thinking as ThinkingLevel);
					return changed;
				},
				join(ctx.cwd, ".pi", "settings.json"),
			);
		},
	});

	pi.registerCommand("fanout-execute", {
		description: "Execute the active accepted Fanout packet",
		handler: async (args, ctx) => {
			const argument = args.trim();
			if (argument && argument !== "--dry-run") {
				ctx.ui.notify("Usage: /fanout-execute [--dry-run]. Explicit packet paths are not supported.", "warning");
				return;
			}
			if (fanoutExecutionInProgress) {
				ctx.ui.notify("A Fanout execution is already in progress.", "warning");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish, then retry /fanout-execute.", "warning");
				return;
			}

			fanoutExecutionInProgress = true;
			ctx.ui.setStatus("fanout-execute", "fanout:executing");
			try {
				const context = fanoutRuntimeContext(ctx.cwd, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel(), ctx.modelRegistry?.getAll?.());
				ctx.ui.notify("Fanout invocation runs the previously approved profile validation, including during dry-run; commands may have external/network effects. Live confirmation gates workers and active apply.", "info");
				const result = await executeFanout({
					cwd: ctx.cwd,
					activePointerPath: context.activePointerPath,
					projectArtifactRoot: context.projectArtifactRoot,
					extensionEntry: fileURLToPath(import.meta.url),
					dryRun: argument === "--dry-run",
					confirm: (title, message) => ctx.ui.confirm(title, message),
				});
				displayFanoutExecutionReport(pi, reportPresentationAvailable, ctx.cwd, result);
				const message = result.status === "succeeded"
					? `${result.dryRun ? "Fanout dry run" : "Fanout execution"} succeeded. Artifacts: ${result.paths.runDir}`
					: result.status === "aborted"
						? `Fanout execution aborted. Artifacts: ${result.paths.runDir}`
						: `Fanout execution failed: ${result.error ?? "see execution artifacts"}. Artifacts: ${result.paths.runDir}`;
				ctx.ui.notify(message, result.status === "failed" ? "error" : "info");
			} catch (error) {
				writeJsonl("fanout_execute_error", { error: error instanceof Error ? error.message : String(error) }, ctx.cwd);
				ctx.ui.notify(`Fanout execution could not start: ${error instanceof Error ? error.message : String(error)}`, "error");
			} finally {
				fanoutExecutionInProgress = false;
				ctx.ui.setStatus("fanout-execute", undefined);
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		activeModel = ctx.model;
		activeThinking = pi.getThinkingLevel();
		const context = writeFanoutRuntimeContext(ctx.cwd, activeModel, activeThinking, ctx.modelRegistry?.getAll?.());
		const observabilityPath = configureMainObservability(context, ctx.cwd);
		writeJsonl("session_start", { cwd: ctx.cwd, mode: ctx.mode, observabilityPath }, ctx.cwd);
	});

	pi.on("model_select", (event, ctx) => {
		activeModel = event.model;
		writeFanoutRuntimeContext(ctx.cwd, activeModel, activeThinking, ctx.modelRegistry?.getAll?.());
	});

	pi.on("thinking_level_select", (event, ctx) => {
		activeThinking = event.level;
		writeFanoutRuntimeContext(ctx.cwd, activeModel ?? ctx.model, activeThinking, ctx.modelRegistry?.getAll?.());
	});

	pi.on("before_agent_start", (event) => {
		const phasePrompt = planning.beginTurn();
		if (!phasePrompt) return { systemPrompt: event.systemPrompt.includes(BATCHING_DISCIPLINE_MARKER) ? event.systemPrompt : `${event.systemPrompt}\n\n${BATCHING_DISCIPLINE}` };
		if (event.systemPrompt.includes(BATCHING_DISCIPLINE)) return { systemPrompt: event.systemPrompt.replace(BATCHING_DISCIPLINE, `${phasePrompt}\n\n${PLANNING_BATCHING_DISCIPLINE}`) };
		if (event.systemPrompt.includes(BATCHING_DISCIPLINE_MARKER)) return { systemPrompt: event.systemPrompt.replace(BATCHING_DISCIPLINE_MARKER, `${phasePrompt}\n\n${PLANNING_BATCHING_DISCIPLINE}`) };
		return { systemPrompt: `${event.systemPrompt}\n\n${phasePrompt}\n\n${PLANNING_BATCHING_DISCIPLINE}` };
	});

	pi.on("context", (event) => ({ messages: planning.filterContext(event.messages) as any }));

	pi.on("agent_start", (_event, ctx) => {
		agentStarted = performance.now();
		agentTurnCount = 0;
		agentToolCallCount = 0;
		writeJsonl("agent_start", { planRunId: planning.active?.runId, phase: planning.active?.phase }, ctx.cwd);
	});

	pi.on("agent_end", async (_event, ctx) => {
		const activePlan = planning.active;
		writeJsonl("agent_end", { planRunId: activePlan?.runId, phase: activePlan?.phase, durationMs: agentStarted === undefined ? undefined : durationMs(agentStarted), turnCount: agentTurnCount, toolCallCount: agentToolCallCount }, ctx.cwd);
		agentStarted = undefined;
	});

	pi.on("agent_settled", async (_event, ctx) => { await planning.finishTurn(ctx); });
	pi.on("session_before_compact", (_event, ctx) => { planning.captureCompactionContext(ctx.sessionManager.buildSessionContext().messages); });
	pi.on("session_compact", (_event, ctx) => planning.compactContext(ctx.sessionManager.buildSessionContext().messages));

	pi.on("message_update", (_event, ctx) => {
		if (activeTurnIndex === undefined) return;
		const stats = turnStats.get(activeTurnIndex);
		if (!stats || stats.firstAssistantUpdateMs !== undefined) return;
		stats.firstAssistantUpdateMs = roundedDuration(stats.started);
		planning.recordTtft(stats.firstAssistantUpdateMs);
		const plan = planning.active;
		writeJsonl("assistant_ttft", {
			planRunId: plan?.runId,
			phase: plan?.phase,
			turnIndex: activeTurnIndex,
			ttftMs: stats.firstAssistantUpdateMs,
			ttftSource: "local-first-assistant-update",
		}, ctx.cwd);
	});

	pi.on("message_end", (event, ctx) => {
		planning.recordAssistant(event.message, activeTurnIndex, ctx.cwd);
	});

	pi.on("turn_start", (event, ctx) => {
		activeTurnIndex = event.turnIndex;
		setDoublewordActiveTurnIndex(event.turnIndex);
		agentTurnCount++;
		planning.recordTurnStart();
		turnStats.set(event.turnIndex, { started: performance.now(), toolCallCount: 0 });
		writeJsonl("turn_start", { planRunId: planning.active?.runId, phase: planning.active?.phase, turnIndex: event.turnIndex }, ctx.cwd);
	});

	pi.on("turn_end", (event, ctx) => {
		planning.finishResponse(ctx);
		const stats = turnStats.get(event.turnIndex);
		turnStats.delete(event.turnIndex);
		writeJsonl(
			"turn_end",
			{
				planRunId: planning.active?.runId,
				phase: planning.active?.phase,
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
		const started = performance.now();
		planning.recordToolStart(event.toolCallId, started);
		toolStarts.set(event.toolCallId, { started, turnIndex, planRunId: planning.active?.runId, phase: planning.active?.phase });
		writeJsonl("tool_start", { planRunId: planning.active?.runId, phase: planning.active?.phase, toolCallId: event.toolCallId, toolName: event.toolName, turnIndex }, ctx.cwd);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const started = toolStarts.get(event.toolCallId);
		toolStarts.delete(event.toolCallId);
		const ended = performance.now();
		const toolDurationMs = started === undefined ? undefined : Math.round((ended - started.started) * 1000) / 1000;
		planning.recordToolEnd(event.toolCallId, ended);
		writeJsonl(
			"tool_end",
			{
				planRunId: started?.planRunId,
				phase: started?.phase,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				turnIndex: started?.turnIndex,
				isError: event.isError,
				durationMs: toolDurationMs,
			},
			ctx.cwd,
		);
	});

	pi.on("tool_call", (event, ctx) => {
		const sessionMessages = ctx.sessionManager?.buildSessionContext?.().messages;
		const messages = Array.isArray(sessionMessages) ? sessionMessages : [];
		const reason = planning.blockReason(event.toolName, event.toolCallId, messages)
			?? workerValidationBatchBlockReason(event.toolName, event.toolCallId, messages, Boolean(workerValidation));
		if (reason) return { block: true, reason };
		const workerReason = workerToolBlockReason(event.toolName, event.input, process.env.FANOUT_WORKTREE_ROOT, workerValidation);
		if (workerReason) return { block: true, reason: workerReason };
	});

	pi.on("session_shutdown", () => planning.reset());
	for (const event of ["session_before_switch", "session_before_fork"] as const) pi.on(event, () => planning.reset());
}
