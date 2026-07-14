import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { getSupportedThinkingLevels, type ThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDoublewordDevProviders } from "../../doubleword-provider/src/dev.ts";
import { setDoublewordActiveTurnIndex, setDoublewordObservabilityFile, setDoublewordRunId } from "../../doubleword-provider/src/index.ts";
import { artifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { BATCHING_DISCIPLINE, BATCHING_DISCIPLINE_MARKER } from "../../fanout-core/src/batching-discipline.ts";
import { buildRequiredReadClassifications, compileExecutionPacket, validateImplementationDetailsArtifact, validateImplementationPlan } from "../../fanout-core/src/fanout-compiler.ts";
import { durationMs, RUN_ID, setObservabilityCwd, setObservabilityFile, writeJsonl } from "../../fanout-core/src/observability.ts";
import { configureFanoutTier } from "./fanout-config.ts";
import { executeFanout, type ExecuteFanoutResult } from "./fanout-execute.ts";
import {
	buildImplementationDetailsPrompt,
	buildImplementationDetailsRepairPrompt,
	buildImplementationPlanPrompt,
	createFanoutPlanRun,
	type FanoutPhaseState,
} from "./fanout-plan-orchestration.ts";
import { activatePlanningTools, FANOUT_SUBMIT_TOOL, planningToolBlockReason, readAcceptedImplementationPlan, restorePlanningTools, submitPlanningArtifact } from "./planning-capabilities.ts";
import {
	createPlanningMetrics,
	finishPlanningPhase,
	planningMetricsSummary,
	recordPlanningAssistant,
	recordPlanningToolInterval,
	roundedDuration,
	startPlanningPhase,
	type PlanningMetrics,
} from "./planning-observability.ts";
import { appendFanoutReport, registerFanoutReportPresentation } from "./report-presentation.ts";
import { invalidateActiveSelection } from "./artifact-store.ts";
import { publishExecutionPacket } from "./planning-publication.ts";
import { capturePlanningBase } from "./repository-identity.ts";
import { workerToolBlockReason } from "./worker-capabilities.ts";

const FANOUT_CONTEXT_MARKER = "## Fanout runtime context";
const TIER2_DEFAULT = { provider: "doubleword", model: "zai-org/GLM-5.2-FP8", thinking: "medium" };
const doublewordModelMetadata = new Map<string, Record<string, unknown>>();

export default async function (pi: ExtensionAPI) {
	let agentStarted: number | undefined;
	let agentTurnCount = 0;
	let agentToolCallCount = 0;
	let activeTurnIndex: number | undefined;
	let activeModel: unknown;
	let activeThinking: unknown;
	const turnStats = new Map<number, { started: number; toolCallCount: number; firstAssistantUpdateMs?: number }>();
	const toolStarts = new Map<string, { started: number; turnIndex?: number; planRunId?: string; phase?: "implementation" | "details"; planningMetrics?: PlanningMetrics }>();
	let pendingFanoutPlan: FanoutPhaseState | undefined;
	let startedFanoutPlan: FanoutPhaseState | undefined;
	let planningToolsBefore: string[] | undefined;
	let fanoutExecutionInProgress = false;
	const reportPresentationAvailable = registerFanoutReportPresentation(pi);
	const resetPlanningState = () => {
		restorePlanningTools(pi, planningToolsBefore);
		planningToolsBefore = undefined;
		pendingFanoutPlan = undefined;
		startedFanoutPlan = undefined;
	};
	const startPlanningTurn = (state: FanoutPhaseState, message: string) => setTimeout(() => {
		if (pendingFanoutPlan?.runId === state.runId && pendingFanoutPlan.phase === state.phase && pendingFanoutPlan.systemPrompt) pi.sendUserMessage(message);
	}, 0);

	setDoublewordRunId(RUN_ID);
	configureMainObservability(fanoutRuntimeContext(process.cwd(), undefined, undefined));
	await registerDoublewordDevProviders(pi, rememberDoublewordModels, { controls: false });

	pi.registerTool({
		name: FANOUT_SUBMIT_TOOL,
		label: "Submit Fanout planning artifact",
		description: "Validate and atomically submit the artifact expected by the active Fanout planning phase. The controller selects the run and destination.",
		parameters: { type: "object", properties: { artifact: {} }, required: ["artifact"], additionalProperties: false } as any,
		executionMode: "sequential",
		async execute(_toolCallId, params: { artifact: unknown }, _signal, _onUpdate, ctx) {
			const state = startedFanoutPlan;
			if (!state || pendingFanoutPlan?.runId !== state.runId || pendingFanoutPlan.phase !== state.phase || pendingFanoutPlan.acceptedSubmission) throw new Error("No matching Fanout planning phase is awaiting submission");
			const submitted = submitPlanningArtifact(state, params.artifact, ctx.cwd);
			const acceptedSubmission = { runId: state.runId, phase: state.phase, path: submitted.path, identity: submitted.identity };
			pendingFanoutPlan = { ...pendingFanoutPlan, acceptedSubmission };
			startedFanoutPlan = { ...state, acceptedSubmission };
			return { content: [{ type: "text", text: `${submitted.phase} artifact accepted: ${submitted.path}` }], details: submitted };
		},
	});

	pi.registerCommand("fanout-plan", {
		description: "Prepare a decision-complete Fanout execution packet",
		handler: async (args, ctx) => {
			if (pendingFanoutPlan) {
				ctx.ui.notify("A Fanout plan is already in progress. Wait for it to finish, then retry /fanout-plan.", "warning");
				return;
			}
			const invocation = args.trim() || "Use the current conversation context.";
			const model = activeModel ?? ctx.model;
			const thinking = activeThinking ?? pi.getThinkingLevel();
			const models = ctx.modelRegistry?.getAll?.();
			const runtimeContext = fanoutRuntimeContext(ctx.cwd, model, thinking, models);
			invalidateActiveSelection(runtimeContext.projectArtifactRoot, relativeArtifact(runtimeContext.projectArtifactRoot, runtimeContext.activePointerPath));
			writeFanoutRuntimeContext(ctx.cwd, model, thinking, models, runtimeContext);
			let planningBase: ReturnType<typeof capturePlanningBase>;
			try {
				planningBase = capturePlanningBase(ctx.cwd);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				writeJsonl("fanout_plan_rejected", { phase: "preflight", reason, activePacketChanged: true, activePacketInvalidated: true }, ctx.cwd);
				ctx.ui.notify(`Fanout planning preflight failed: ${reason}\nThe prior active packet selection remains invalidated.`, "error");
				return;
			}
			const context = { ...runtimeContext, planningBase };
			if (!tier1Resolved(context.resolvedTierPlan.tier1)) {
				writeJsonl("fanout_plan_rejected", { phase: "preflight", reason: "no active Pi model", activePacketChanged: true, activePacketInvalidated: true }, ctx.cwd);
				ctx.ui.notify("Fanout planning requires an active Pi model. Select one with /model, then retry /fanout-plan.\nThe prior active packet selection remains invalidated.", "error");
				return;
			}
			const run = createFanoutPlanRun(invocation, context);
			const prompt = buildImplementationPlanPrompt(invocation, context, run);
			pendingFanoutPlan = { phase: "implementation", systemPrompt: prompt, invocation, objective: invocation, context, metrics: createPlanningMetrics(), ...run };
			writeJsonl("fanout_plan_start", { planRunId: run.runId, invocation, phase: "implementation", artifactRoot: context.artifactRoot, artifactDir: run.artifactDir, implementationPlanPath: run.implementationPlanPath, implementationDetailsPath: run.implementationDetailsPath, tierDefaults: context.tierDefaults }, ctx.cwd);
			writeJsonl("fanout_plan_preflight", { planRunId: run.runId, phase: "implementation", tierPlan: context.resolvedTierPlan, tier2Availability: context.tier2Availability }, ctx.cwd);
			if (!ctx.isIdle()) {
				pi.sendUserMessage(`Run Fanout planning for: ${invocation}`, { deliverAs: "followUp" });
				ctx.ui.notify("Queued /fanout-plan after the current turn.", "info");
				return;
			}
			pi.sendUserMessage(`Run Fanout planning for: ${invocation}`);
		},
	});

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

	pi.on("before_agent_start", (event, ctx) => {
		let phasePrompt = "";
		const batchingPrompt = event.systemPrompt.includes(BATCHING_DISCIPLINE_MARKER) ? event.systemPrompt : `${event.systemPrompt}\n\n${BATCHING_DISCIPLINE}`;
		const runtimePrompt = batchingPrompt.includes(FANOUT_CONTEXT_MARKER) ? batchingPrompt : `${batchingPrompt}\n\n${fanoutRuntimePrompt(ctx.cwd, activeModel ?? ctx.model, activeThinking ?? pi.getThinkingLevel(), ctx.modelRegistry?.getAll?.())}`;
		if (pendingFanoutPlan?.systemPrompt) {
			phasePrompt = pendingFanoutPlan.systemPrompt;
			startedFanoutPlan = { ...pendingFanoutPlan, systemPrompt: undefined, acceptedSubmission: undefined };
			pendingFanoutPlan = startedFanoutPlan;
			planningToolsBefore = activatePlanningTools(pi);
		}
		return {
			systemPrompt: phasePrompt ? `${batchingPrompt}\n\n${phasePrompt}` : runtimePrompt,
		};
	});

	pi.on("agent_start", (_event, ctx) => {
		agentStarted = performance.now();
		agentTurnCount = 0;
		agentToolCallCount = 0;
		writeJsonl("agent_start", { planRunId: startedFanoutPlan?.runId, phase: startedFanoutPlan?.phase }, ctx.cwd);
	});

	pi.on("agent_end", (_event, ctx) => {
		const activePlan = startedFanoutPlan;
		restorePlanningTools(pi, planningToolsBefore);
		planningToolsBefore = undefined;
		writeJsonl(
			"agent_end",
			{
				planRunId: activePlan?.runId,
				phase: activePlan?.phase,
				durationMs: agentStarted === undefined ? undefined : durationMs(agentStarted),
				turnCount: agentTurnCount,
				toolCallCount: agentToolCallCount,
			},
			ctx.cwd,
		);
		agentStarted = undefined;

		const finishedFanoutPlan = pendingFanoutPlan;
		const phaseTurnStarted = finishedFanoutPlan !== undefined && startedFanoutPlan?.runId === finishedFanoutPlan.runId && startedFanoutPlan.phase === finishedFanoutPlan.phase;
		const expectedSubmissionPath = finishedFanoutPlan?.phase === "implementation" ? finishedFanoutPlan.implementationPlanPath : finishedFanoutPlan?.implementationDetailsPath;
		const phaseSubmitted = phaseTurnStarted && finishedFanoutPlan?.acceptedSubmission?.runId === finishedFanoutPlan.runId && finishedFanoutPlan.acceptedSubmission.phase === finishedFanoutPlan.phase && finishedFanoutPlan.acceptedSubmission.path === expectedSubmissionPath;
		startedFanoutPlan = undefined;
		if (finishedFanoutPlan?.phase === "implementation") {
			if (!existsSync(finishedFanoutPlan.implementationPlanPath) && !phaseTurnStarted) return;
			if (!phaseSubmitted) {
				finishPlanningPhase(finishedFanoutPlan.metrics, "implementation");
				pendingFanoutPlan = undefined;
				reportPlanFailure(ctx, finishedFanoutPlan, "implementation", ["implementation plan was not accepted by fanout_submit_artifact"], activeThinking);
				return;
			}
			let implementationPlan: unknown;
			const planIdentity = finishedFanoutPlan.acceptedSubmission.identity;
			try {
				implementationPlan = readAcceptedImplementationPlan(finishedFanoutPlan.implementationPlanPath, planIdentity);
			} catch (error) {
				finishPlanningPhase(finishedFanoutPlan.metrics, "implementation");
				pendingFanoutPlan = undefined;
				reportPlanFailure(ctx, finishedFanoutPlan, "implementation", [error instanceof Error ? error.message : String(error)], activeThinking);
				return;
			}
			const validation = validateImplementationPlan(implementationPlan);
			writeJsonl("fanout_implementation_plan_validation", { planRunId: finishedFanoutPlan.runId, phase: "implementation", artifactDir: finishedFanoutPlan.artifactDir, ...validation }, ctx.cwd);
			if (!validation.ok) {
				finishPlanningPhase(finishedFanoutPlan.metrics, "implementation");
				pendingFanoutPlan = undefined;
				reportPlanFailure(ctx, finishedFanoutPlan, "implementation", validation.errors, activeThinking);
				return;
			}
			const planObjective = isRecord(implementationPlan) ? stringField(implementationPlan.objective) : "unknown";
			const requiredReadClassifications = buildRequiredReadClassifications(implementationPlan);
			finishPlanningPhase(finishedFanoutPlan.metrics, "implementation");
			startPlanningPhase(finishedFanoutPlan.metrics);
			const detailsState = { ...finishedFanoutPlan, phase: "details" as const, acceptedSubmission: undefined, planIdentity, acceptedPlan: validation.plan, objective: planObjective, requiredReadClassifications };
			const systemPrompt = buildImplementationDetailsPrompt(planObjective, finishedFanoutPlan.context, detailsState, requiredReadClassifications);
			pendingFanoutPlan = { ...detailsState, systemPrompt };
			writeJsonl("fanout_required_read_classifications", { planRunId: finishedFanoutPlan.runId, phase: "implementation", objective: planObjective, artifactDir: finishedFanoutPlan.artifactDir, count: requiredReadClassifications.length, requiredReadClassifications }, ctx.cwd);
			ctx.ui.notify("Implementation plan validated; grounding edit details.", "info");
			startPlanningTurn(pendingFanoutPlan, `Continue Fanout planning details for: ${planObjective}`);
		} else if (finishedFanoutPlan?.phase === "details") {
			if (!phaseSubmitted) {
				if (!phaseTurnStarted) return;
				finishPlanningPhase(finishedFanoutPlan.metrics, "details");
				pendingFanoutPlan = undefined;
				reportPlanFailure(ctx, finishedFanoutPlan, "details", ["implementation details were not accepted by fanout_submit_artifact"], activeThinking);
				return;
			}
			if (!existsSync(finishedFanoutPlan.implementationDetailsPath)) {
				const errors = [`missing ${finishedFanoutPlan.implementationDetailsPath}`];
				writeJsonl("fanout_implementation_details_validation", { planRunId: finishedFanoutPlan.runId, phase: "details", artifactDir: finishedFanoutPlan.artifactDir, ok: false, errors }, ctx.cwd);
				finishPlanningPhase(finishedFanoutPlan.metrics, "details");
				pendingFanoutPlan = undefined;
				reportPlanFailure(ctx, finishedFanoutPlan, "details", errors, activeThinking);
				return;
			}
			try {
				const planBytes = readFileSync(finishedFanoutPlan.implementationPlanPath);
				const detailsBytes = readFileSync(finishedFanoutPlan.implementationDetailsPath);
				const planIdentity = artifactIdentity("implementation-plan.json", planBytes);
				const detailsIdentity = artifactIdentity("implementation-details.json", detailsBytes);
				if (JSON.stringify(planIdentity) !== JSON.stringify(finishedFanoutPlan.planIdentity) || JSON.stringify(detailsIdentity) !== JSON.stringify(finishedFanoutPlan.acceptedSubmission?.identity)) throw new Error("accepted planning artifact bytes changed; restart /fanout-plan");
				const implementationPlan = JSON.parse(planBytes.toString("utf8"));
				const implementationDetails = JSON.parse(detailsBytes.toString("utf8"));
				const detailsValidation = validateImplementationDetailsArtifact(implementationDetails, { planIdentity, plan: finishedFanoutPlan.acceptedPlan });
				writeJsonl("fanout_implementation_details_validation", { planRunId: finishedFanoutPlan.runId, phase: "details", artifactDir: finishedFanoutPlan.artifactDir, ...detailsValidation }, ctx.cwd);
				if (!detailsValidation.ok) {
					finishPlanningPhase(finishedFanoutPlan.metrics, "details");
					pendingFanoutPlan = undefined;
					reportPlanFailure(ctx, finishedFanoutPlan, "details", detailsValidation.errors, activeThinking);
					return;
				}
				const compiled = compileExecutionPacket({ implementationPlan, implementationDetails, planIdentity, detailsIdentity, tierPlan: finishedFanoutPlan.context.resolvedTierPlan as any, runtimePolicy: { maxConcurrency: positiveIntegerSetting(recordField(finishedFanoutPlan.context.executionDefaults).maxConcurrency, 2), failFast: false, fallbackAllowed: true }, sequentialReadFallback: finishedFanoutPlan.repairAttempted === true });
				writeJsonl("fanout_compiler_validation", { planRunId: finishedFanoutPlan.runId, phase: "details", artifactDir: finishedFanoutPlan.artifactDir, policy: "error", repairAttempted: finishedFanoutPlan.repairAttempted === true, ok: compiled.ok, errors: compiled.errors, warnings: compiled.warnings }, ctx.cwd);
				if (!compiled.ok && isReadClassificationFailure(compiled.issues) && !finishedFanoutPlan.repairAttempted) {
					const systemPrompt = buildImplementationDetailsRepairPrompt(finishedFanoutPlan.objective, finishedFanoutPlan.context, finishedFanoutPlan, compiled.issues, finishedFanoutPlan.requiredReadClassifications ?? []);
					pendingFanoutPlan = { ...finishedFanoutPlan, systemPrompt, acceptedSubmission: undefined, repairAttempted: true };
					writeJsonl("fanout_compiler_repair_requested", { planRunId: finishedFanoutPlan.runId, phase: "details", artifactDir: finishedFanoutPlan.artifactDir, issues: compiled.issues }, ctx.cwd);
					ctx.ui.notify("Fanout compiler found ambiguous read overlaps; repairing implementation details.", "info");
					startPlanningTurn(pendingFanoutPlan, `Repair Fanout planning details for: ${finishedFanoutPlan.objective}`);
					return;
				}
				if (!compiled.ok || !compiled.packet) {
					finishPlanningPhase(finishedFanoutPlan.metrics, "details");
					pendingFanoutPlan = undefined;
					reportPlanFailure(ctx, finishedFanoutPlan, "compiler", compiled.errors, activeThinking);
					return;
				}
				const artifacts = publishExecutionPacket(compiled.packet, stringField(finishedFanoutPlan.context.projectArtifactRoot), finishedFanoutPlan.artifactDir, stringField(finishedFanoutPlan.context.activePointerPath));
				finishPlanningPhase(finishedFanoutPlan.metrics, "details");
				writeJsonl("fanout_plan_end", { planRunId: finishedFanoutPlan.runId, invocation: finishedFanoutPlan.invocation, objective: finishedFanoutPlan.objective, phase: "complete", artifactDir: finishedFanoutPlan.artifactDir, packetPath: artifacts.packetPath, activePointerPath: artifacts.activePointerPath, warnings: compiled.warnings, ...planningMetricsSummary(finishedFanoutPlan.metrics, activeThinking) }, ctx.cwd);
				displayFanoutPlanReport(pi, reportPresentationAvailable, ctx.cwd, finishedFanoutPlan.runId, finishedFanoutPlan.artifactDir, artifacts);
				ctx.ui.notify(`Fanout plan ready ✅\nArtifacts: ${finishedFanoutPlan.artifactDir}`, "info");
				pendingFanoutPlan = undefined;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				finishPlanningPhase(finishedFanoutPlan.metrics, "details");
				pendingFanoutPlan = undefined;
				writeJsonl("fanout_compiler_error", { planRunId: finishedFanoutPlan.runId, phase: "compiler", artifactDir: finishedFanoutPlan.artifactDir, error: message }, ctx.cwd);
				reportPlanFailure(ctx, finishedFanoutPlan, "compiler", [message], activeThinking);
			}
		}
	});

	pi.on("message_update", (_event, ctx) => {
		if (activeTurnIndex === undefined) return;
		const stats = turnStats.get(activeTurnIndex);
		if (!stats || stats.firstAssistantUpdateMs !== undefined) return;
		stats.firstAssistantUpdateMs = roundedDuration(stats.started);
		const plan = startedFanoutPlan;
		if (plan && plan.metrics.ttftMs === undefined) plan.metrics.ttftMs = stats.firstAssistantUpdateMs;
		writeJsonl("assistant_ttft", {
			planRunId: plan?.runId,
			phase: plan?.phase,
			turnIndex: activeTurnIndex,
			ttftMs: stats.firstAssistantUpdateMs,
			ttftSource: "local-first-assistant-update",
		}, ctx.cwd);
	});

	pi.on("message_end", (event, ctx) => {
		const plan = startedFanoutPlan;
		if (!plan) return;
		const usage = recordPlanningAssistant(plan.metrics, event.message);
		if (usage) writeJsonl("assistant_usage", { planRunId: plan.runId, phase: plan.phase, turnIndex: activeTurnIndex, ...usage }, ctx.cwd);
	});

	pi.on("turn_start", (event, ctx) => {
		activeTurnIndex = event.turnIndex;
		setDoublewordActiveTurnIndex(event.turnIndex);
		agentTurnCount++;
		if (startedFanoutPlan) startedFanoutPlan.metrics.turnCount++;
		turnStats.set(event.turnIndex, { started: performance.now(), toolCallCount: 0 });
		writeJsonl("turn_start", { planRunId: startedFanoutPlan?.runId, phase: startedFanoutPlan?.phase, turnIndex: event.turnIndex }, ctx.cwd);
	});

	pi.on("turn_end", (event, ctx) => {
		const stats = turnStats.get(event.turnIndex);
		turnStats.delete(event.turnIndex);
		writeJsonl(
			"turn_end",
			{
				planRunId: startedFanoutPlan?.runId,
				phase: startedFanoutPlan?.phase,
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
		if (startedFanoutPlan) startedFanoutPlan.metrics.toolCallCount++;
		toolStarts.set(event.toolCallId, { started: performance.now(), turnIndex, planRunId: startedFanoutPlan?.runId, phase: startedFanoutPlan?.phase, planningMetrics: startedFanoutPlan?.metrics });
		writeJsonl("tool_start", { planRunId: startedFanoutPlan?.runId, phase: startedFanoutPlan?.phase, toolCallId: event.toolCallId, toolName: event.toolName, turnIndex }, ctx.cwd);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const started = toolStarts.get(event.toolCallId);
		toolStarts.delete(event.toolCallId);
		const ended = performance.now();
		const toolDurationMs = started === undefined ? undefined : Math.round((ended - started.started) * 1000) / 1000;
		if (started?.planningMetrics) recordPlanningToolInterval(started.planningMetrics, started.started, ended);
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

	pi.on("tool_call", (event) => {
		const reason = planningToolBlockReason(event.toolName, Boolean(startedFanoutPlan));
		if (reason) return { block: true, reason };
		const workerReason = workerToolBlockReason(event.toolName, event.input, process.env.FANOUT_WORKTREE_ROOT);
		if (workerReason) return { block: true, reason: workerReason };
	});

	pi.on("session_shutdown", resetPlanningState);
	for (const event of ["session_before_switch", "session_before_fork"] as const) pi.on(event, resetPlanningState);
}

function rememberDoublewordModels(provider: string, models: unknown[]): void {
	for (const model of models) if (isRecord(model)) doublewordModelMetadata.set(modelKey(provider, stringField(model.id ?? model.model)), { ...model, provider });
}

function augmentRegistryModels(models: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const seen = new Set<string>();
	const augmented = models.map((model) => {
		const key = modelKey(stringField(model.provider), stringField(model.id ?? model.model));
		seen.add(key);
		const metadata = doublewordModelMetadata.get(key);
		return metadata ? { ...metadata, ...model, fanout: metadata.fanout } : model;
	});
	for (const [key, metadata] of doublewordModelMetadata) if (!seen.has(key)) augmented.push(metadata);
	return augmented;
}

function modelKey(provider: string, model: string): string {
	return `${provider}/${model}`;
}

function fanoutRuntimePrompt(cwd: string, model: unknown, thinking: unknown, models?: unknown): string {
	const context = fanoutRuntimeContext(cwd, model, thinking, models);
	return `${FANOUT_CONTEXT_MARKER}\n\n- artifactRoot: ${context.artifactRoot}\n- projectArtifactRoot: ${context.projectArtifactRoot}\n- runtimeContextFile: ${context.runtimeContextFile}\n- activePointerPath: ${context.activePointerPath}\n- tier1: ${context.resolvedTierPlan.tier1.provider}/${context.resolvedTierPlan.tier1.model} (${context.resolvedTierPlan.tier1.thinking})\n- tier2: ${context.resolvedTierPlan.tier2.provider}/${context.resolvedTierPlan.tier2.model} (${context.resolvedTierPlan.tier2.status}; ${context.tier2Availability.reason})\n- tier2 fallback: ${context.resolvedTierPlan.tier2Fallback.provider}/${context.resolvedTierPlan.tier2Fallback.model} (${context.resolvedTierPlan.tier2Fallback.thinking})\n- question tool: ask_user_question is required for /fanout-plan clarification.\n`;
}

function writeFanoutRuntimeContext(cwd: string, model: unknown, thinking: unknown, models?: unknown, prepared?: ReturnType<typeof fanoutRuntimeContext>): ReturnType<typeof fanoutRuntimeContext> {
	const context = prepared ?? fanoutRuntimeContext(cwd, model, thinking, models);
	try {
		mkdirSync(context.projectArtifactRoot, { recursive: true });
		writeFileSync(context.runtimeContextFile, `${JSON.stringify(context, null, 2)}\n`, "utf8");
	} catch {
		// Fanout runtime context is advisory; normal agent operation should continue.
	}
	return context;
}

function configureMainObservability(context: { projectArtifactRoot: string }, cwd = process.cwd()): string {
	const observabilityPath = join(context.projectArtifactRoot, "observability", RUN_ID, "observability.jsonl");
	setObservabilityCwd(cwd);
	setObservabilityFile(observabilityPath);
	setDoublewordObservabilityFile(observabilityPath);
	return process.env.DOUBLEWORD_OBSERVABILITY_FILE ?? observabilityPath;
}

function fanoutRuntimeContext(cwd: string, model: unknown, thinking: unknown, models?: unknown) {
	const settings = fanoutSettings(cwd);
	const registryModels = augmentRegistryModels(Array.isArray(models) ? (models as Array<Record<string, unknown>>).filter(isRecord) : []);
	const artifactRoot = resolve(process.env.FANOUT_ARTIFACT_DIR || optionalString(settings.artifactDir) || join(getAgentDir(), "fanout"));
	const projectId = `${basename(cwd)}-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}`;
	const projectArtifactRoot = join(artifactRoot, projectId);
	const active = modelInfo(model);
	const activeThinking = optionalString(thinking) ?? "auto";
	const tier2Settings = recordField(settings.tiers?.tier2);
	const executionSettings = recordField(settings.execution);
	const tier2FallbackSettings = recordField(executionSettings.tier2Fallback);
	const tierDefaults = {
		tier1: { provider: "auto", model: "auto", thinking: "auto", reason: "current active Pi realtime model" },
		tier2: { provider: TIER2_DEFAULT.provider, model: TIER2_DEFAULT.model, thinking: TIER2_DEFAULT.thinking, enabled: "auto", reason: "async background worker model", ...tier2Settings },
		tier2Fallback: tier2FallbackSettings.inherit === "tier1" ? { inherit: "tier1" } : Object.keys(tier2FallbackSettings).length > 0 ? tier2FallbackSettings : { inherit: "tier1" },
	};
	const tier1 = resolveTier1(active, activeThinking);
	const tier2 = resolveTier2(tierDefaults.tier2, registryModels, Object.keys(tier2Settings).length > 0);
	const tier2Fallback = resolveTier2Fallback(tier2FallbackSettings, tier1.summary, registryModels);
	return {
		artifactRoot,
		projectId,
		projectArtifactRoot,
		activePointerPath: join(projectArtifactRoot, "active-packet.json"),
		runtimeContextFile: join(projectArtifactRoot, "runtime-context.json"),
		activeModel: active,
		activeThinking,
		tierDefaults,
		resolvedTierPlan: { tier1: tier1.summary, tier2: tier2.summary, tier2Fallback },
		tier2Availability: tier2.availability,
		executionDefaults: {
			maxConcurrency: executionSettings.maxConcurrency ?? 2,
			failFast: false,
			tier2MaxAttempts: 2,
			tier1CleanRerunMaxAttempts: 1,
			tier1FallbackMaxAttempts: 1,
			maxValidationRepairAttempts: 2,
			maxIntegrationRepairAttempts: 2,
			fallbackTier: "tier1",
			revalidateOnly: true,
		},
	};
}

function resolveTier1(active: ReturnType<typeof modelInfo>, activeThinking: string) {
	return { summary: { provider: active.provider, model: active.model, thinking: activeThinking, source: "current Pi active model", status: "available", reason: "realtime control plane for planning, safety, review, synthesis, and final decisions" } };
}

function tier1Resolved(summary: Record<string, unknown>): boolean {
	return optionalString(summary.provider) !== undefined && optionalString(summary.model) !== undefined;
}

function resolveTier2(config: Record<string, unknown>, models: Array<Record<string, unknown>>, configured: boolean) {
	const provider = optionalString(config.provider) ?? TIER2_DEFAULT.provider;
	const model = optionalString(config.model) ?? TIER2_DEFAULT.model;
	const modelRecord = findModel(models, provider, model);
	const enabled = config.enabled !== false && config.enabled !== "false" && config.enabled !== "off";
	const fanout = isRecord(modelRecord?.fanout) ? modelRecord.fanout : {};
	const available = enabled && fanout.async === true && fanout.background === true && fanout.authReady === true;
	const reason = tier2AvailabilityReason(enabled, modelRecord, fanout);
	const thinking = resolveThinking(modelRecord, optionalString(config.thinking) ?? TIER2_DEFAULT.thinking, TIER2_DEFAULT.thinking);
	const source = configured ? "fanout.tiers.tier2" : "default settings";
	return {
		availability: { available, reason, fanout: { async: fanout.async === true, background: fanout.background === true, authReady: fanout.authReady === true } },
		summary: { provider, model, thinking, source, status: available ? "available" : "unavailable", reason: available ? "parallel async worker nodes" : reason, fallback: available ? undefined : "tier1" },
	};
}

function resolveTier2Fallback(config: Record<string, unknown>, tier1: Record<string, unknown>, models: Array<Record<string, unknown>>) {
	const provider = optionalString(config.provider);
	const model = optionalString(config.model);
	const modelRecord = provider && model ? findModel(models, provider, model) : undefined;
	if (config.inherit === "tier1" || !provider || !model || !modelRecord) {
		return {
			provider: stringField(tier1.provider),
			model: stringField(tier1.model),
			thinking: stringField(tier1.thinking),
			source: "tier1 inheritance",
			status: "available",
			reason: config.inherit === "tier1" ? "realtime fallback for tier2 execution; explicit inheritance marker" : provider && model ? "configured fallback unavailable; inherited tier1" : "realtime fallback for tier2 execution; inherits tier1",
		};
	}
	return {
		provider,
		model,
		thinking: resolveThinking(modelRecord, optionalString(config.thinking) ?? "auto", "auto"),
		source: "fanout.execution.tier2Fallback",
		status: "available",
		reason: "realtime fallback for tier2 execution",
	};
}

function tier2AvailabilityReason(enabled: boolean, modelRecord: Record<string, unknown> | undefined, fanout: Record<string, unknown>): string {
	if (!enabled) return "tier2 disabled in fanout.tiers.tier2.enabled";
	if (!modelRecord) return "tier2 provider/model not found in Pi model registry";
	if (fanout.async !== true) return "model fanout.async is not true";
	if (fanout.background !== true) return "model fanout.background is not true";
	if (fanout.authReady !== true) return "model fanout.authReady is not true";
	return "model has async/background/authReady fanout metadata";
}

function resolveThinking(model: Record<string, unknown> | undefined, requested: string, fallback: string): string {
	const supported = thinkingOptions(model);
	if (supported.includes(requested)) return requested;
	if (supported.includes(fallback)) return fallback;
	if (supported.includes("medium")) return "medium";
	if (supported.includes("off")) return "off";
	return supported[0] ?? "auto";
}

function thinkingOptions(model: Record<string, unknown> | undefined): string[] {
	return model ? getSupportedThinkingLevels(model as any) : ["off"];
}

function findModel(models: Array<Record<string, unknown>>, provider: string, model: string): Record<string, unknown> | undefined {
	return models.find((entry) => stringField(entry.provider) === provider && stringField(entry.id ?? entry.model) === model);
}

function fanoutSettings(cwd: string): Record<string, any> {
	return mergeRecord(readFanoutSettings(globalSettingsPath()), readFanoutSettings(join(cwd, ".pi", "settings.json")));
}

function globalSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

function readJsonFile(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function isReadClassificationFailure(issues: Array<{ code: string }>): boolean {
	return issues.length > 0 && issues.every((issue) => issue.code === "planned-read-not-grounded");
}

function reportPlanFailure(ctx: any, state: FanoutPhaseState, phase: string, errors: string[], thinking: unknown): void {
	const concreteErrors = errors.length > 0 ? errors : ["unknown planning failure"];
	writeJsonl("fanout_plan_failed", {
		planRunId: state.runId,
		invocation: state.invocation,
		objective: state.objective,
		phase,
		errors: concreteErrors,
		artifactDir: state.artifactDir,
		activePacketChanged: true,
		activePacketInvalidated: true,
		...planningMetricsSummary(state.metrics, thinking),
	}, ctx.cwd);
	ctx.ui.notify(`Fanout plan rejected: ${concreteErrors.join("; ")}\nArtifacts: ${state.artifactDir}\nRerun /fanout-plan after correcting the issue.\nThe prior active packet selection remains invalidated.`, "warning");
}

function displayFanoutPlanReport(pi: ExtensionAPI, enabled: boolean, cwd: string, runId: string, artifactDir: string, artifacts: { packetPath: string; planPath: string; dagPath: string; activePointerPath?: string }): void {
	try {
		appendFanoutReport(pi, enabled, { kind: "planning", reportPath: artifacts.planPath });
	} catch (error) {
		writeJsonl("fanout_plan_report_display_error", { planRunId: runId, artifactDir, reportPath: artifacts.planPath, error: error instanceof Error ? error.message : String(error) }, cwd);
	}
}

function displayFanoutExecutionReport(pi: ExtensionAPI, enabled: boolean, cwd: string, result: ExecuteFanoutResult): void {
	try {
		appendFanoutReport(pi, enabled, { kind: "execution", reportPath: result.paths.summaryPath });
	} catch (error) {
		writeJsonl("fanout_execute_report_display_error", { executionRunId: result.runId, reportPath: result.paths.summaryPath, error: error instanceof Error ? error.message : String(error) }, cwd);
	}
}

function readFanoutSettings(path: string): Record<string, any> {
	try {
		if (!existsSync(path)) return {};
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return recordField(parsed?.fanout);
	} catch {
		return {};
	}
}

function mergeRecord(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
	const result = { ...base };
	for (const [key, value] of Object.entries(override)) {
		result[key] = isPlainRecord(result[key]) && isPlainRecord(value) ? mergeRecord(result[key], value) : value;
	}
	return result;
}

function recordField(value: unknown): Record<string, any> {
	return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelInfo(model: unknown) {
	if (!isRecord(model)) return { provider: "unknown", model: "unknown", id: "unknown", name: "unknown", reasoning: false };
	return {
		provider: stringField(model.provider),
		model: stringField(model.id ?? model.model),
		id: stringField(model.id ?? model.model),
		name: stringField(model.name ?? model.id ?? model.model),
		reasoning: model.reasoning === true,
	};
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed && trimmed !== "unknown" ? trimmed : undefined;
}

function relativeArtifact(root: string, path: string): string {
	return relative(resolve(root), resolve(path)).split(sep).join("/");
}

function stringField(value: unknown): string {
	return optionalString(value) ?? "unknown";
}

function positiveIntegerSetting(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
