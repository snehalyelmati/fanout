import { existsSync, readFileSync } from "node:fs";
import { convertToLlm, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { artifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { buildRequiredReadClassifications, validateImplementationPlan } from "../../fanout-core/src/fanout-compiler.ts";
import { writeJsonl } from "../../fanout-core/src/observability.ts";
import { invalidateActiveSelection } from "./artifact-store.ts";
import {
	buildImplementationDetailsPrompt,
	buildImplementationPlanPrompt,
	buildProjectExecutionProfilePrompt,
	createFanoutPlanRun,
	type FanoutPhaseState,
} from "./fanout-plan-orchestration.ts";
import { activatePlanningTools, FANOUT_SUBMIT_TOOL, planningSubmissionBatchBlockReason, planningSubmissionParameters, planningToolBlockReason, readAcceptedImplementationPlan, restorePlanningTools, submitPlanningArtifact } from "./planning-capabilities.ts";
import {
	createPlanningMetrics,
	finishPlanningPhase,
	planningMetricsSummary,
	recordPlanningAssistant,
	recordPlanningToolInterval,
	startPlanningPhase,
} from "./planning-observability.ts";
import { publishExecutionPacket } from "./planning-publication.ts";
import {
	loadActiveProjectExecutionProfile,
	loadProjectExecutionProfile,
	publishProjectExecutionProfile,
	validateProjectExecutionProfile,
} from "./project-execution-profile.ts";
import { captureCleanPlanningBase } from "./repository-identity.ts";
import { displayFanoutPlanReport } from "./report-presentation.ts";
import { fanoutRuntimeContext, isRecord, recordField, relativeArtifact, stringField, tier1Resolved, writeFanoutRuntimeContext } from "./fanout-runtime-context.ts";

export interface FanoutPlanningControllerOptions {
	reportPresentationAvailable: boolean;
	activeModel: () => unknown;
	activeThinking: () => unknown;
}

export class FanoutPlanningController {
	readonly #pi: ExtensionAPI;
	readonly #options: FanoutPlanningControllerOptions;
	#pending: FanoutPhaseState | undefined;
	#started: FanoutPhaseState | undefined;
	#toolsBefore: string[] | undefined;
	#phaseTrigger: unknown;
	#compactionContext: { messages: unknown[]; phaseStart: number } | undefined;
	#compactedPrefix: unknown[] | undefined;
	#toolStarts = new Map<string, { started: number; metrics: FanoutPhaseState["metrics"] }>();

	constructor(pi: ExtensionAPI, options: FanoutPlanningControllerOptions) {
		this.#pi = pi;
		this.#options = options;
	}

	get active(): FanoutPhaseState | undefined { return this.#started; }

	register(): void {
		this.#registerSubmissionTool("profile");

		this.#pi.registerCommand("fanout-plan", {
			description: "Prepare a decision-complete Fanout execution packet",
			handler: async (args, ctx) => {
				if (this.#pending) {
					ctx.ui.notify("A Fanout plan is already in progress. Wait for it to finish, then retry /fanout-plan.", "warning");
					return;
				}
				const parsedInvocation = planningInvocation(args);
				const invocation = parsedInvocation.objective;
				const priorMessages = contextMessages(ctx);
				const model = this.#options.activeModel() ?? ctx.model;
				const thinking = this.#options.activeThinking() ?? this.#pi.getThinkingLevel();
				const models = ctx.modelRegistry?.getAll?.();
				const runtimeContext = fanoutRuntimeContext(ctx.cwd, model, thinking, models);
				invalidateActiveSelection(runtimeContext.projectArtifactRoot, relativeArtifact(runtimeContext.projectArtifactRoot, runtimeContext.activePointerPath));
				writeFanoutRuntimeContext(ctx.cwd, model, thinking, models, runtimeContext);
				let planningBase: ReturnType<typeof captureCleanPlanningBase>;
				try {
					planningBase = captureCleanPlanningBase(ctx.cwd);
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
				let approvedProfile;
				if (!parsedInvocation.refreshProfile && existsSync(context.activeProfilePointerPath)) {
					try {
						const loaded = loadActiveProjectExecutionProfile(context.activeProfilePointerPath, context.projectArtifactRoot);
						approvedProfile = { identity: loaded.identity, profile: loaded.profile };
					} catch (error) {
						ctx.ui.notify(`Active Project Execution Profile is invalid: ${message(error)}\nRerun with /fanout-plan --refresh-profile <objective>.`, "error");
						return;
					}
				}
				const phase = approvedProfile ? "implementation" as const : "profile" as const;
				const state = { phase, invocation, objective: invocation, context, metrics: createPlanningMetrics(), approvedProfile, objectiveContextMessages: parsedInvocation.implicitObjective ? implicitObjectiveMessages(priorMessages) : [], phaseContextStart: priorMessages.length, ...run };
				this.#pending = { ...state, systemPrompt: approvedProfile ? buildImplementationPlanPrompt(invocation, context, state) : buildProjectExecutionProfilePrompt(invocation, context, state) };
				const trigger = approvedProfile ? "Prepare and submit the Fanout implementation plan." : "Build and submit the Fanout Project Execution Profile.";
				writeJsonl("fanout_plan_start", { planRunId: run.runId, invocation, phase, refreshProfile: parsedInvocation.refreshProfile, artifactRoot: context.artifactRoot, artifactDir: run.artifactDir, projectExecutionProfilePath: run.projectExecutionProfilePath, implementationPlanPath: run.implementationPlanPath, implementationDetailsPath: run.implementationDetailsPath, tierDefaults: context.tierDefaults }, ctx.cwd);
				writeJsonl("fanout_plan_preflight", { planRunId: run.runId, phase, profileIdentity: approvedProfile?.identity, tierPlan: context.resolvedTierPlan, tier2Availability: context.tier2Availability }, ctx.cwd);
				if (!ctx.isIdle()) {
					ctx.ui.notify("Queued /fanout-plan after the current turn.", "info");
					return;
				}
				this.#pi.sendUserMessage(trigger);
			},
		});
	}

	beginTurn(): string | undefined {
		if (!this.#pending?.systemPrompt) return undefined;
		const prompt = this.#pending.systemPrompt;
		if (this.#started) return prompt;
		this.#started = this.#pending;
		this.#phaseTrigger = undefined;
		this.#compactionContext = undefined;
		this.#compactedPrefix = undefined;
		this.#pending = this.#started;
		this.#registerSubmissionTool(this.#started.phase);
		this.#toolsBefore = activatePlanningTools(this.#pi);
		return prompt;
	}

	async finishTurn(ctx: any): Promise<void> {
		if (!this.#started) {
			if (this.#pending) {
				try {
					const base = captureCleanPlanningBase(ctx.cwd);
					if (JSON.stringify(base) !== JSON.stringify(this.#pending.context.planningBase)) throw new Error("repository changed while planning was queued; restart /fanout-plan");
				} catch (error) { return this.#fail(ctx, this.#pending, "preflight", [message(error)]); }
				this.#pending.phaseContextStart = contextMessages(ctx).length;
				this.#startTurn(this.#pending, this.#pending.phase === "profile" ? "Build and submit the Fanout Project Execution Profile." : "Prepare and submit the Fanout implementation plan.");
			}
			return;
		}
		restorePlanningTools(this.#pi, this.#toolsBefore);
		this.#toolsBefore = undefined;
		const finished = this.#pending;
		const phaseTurnStarted = finished !== undefined && this.#started?.runId === finished.runId && this.#started.phase === finished.phase;
		const expectedSubmissionPath = finished?.phase === "profile" ? finished.projectExecutionProfilePath : finished?.phase === "implementation" ? finished.implementationPlanPath : finished?.implementationDetailsPath;
		const phaseSubmitted = phaseTurnStarted && finished?.acceptedSubmission?.runId === finished.runId && finished.acceptedSubmission.phase === finished.phase && finished.acceptedSubmission.path === expectedSubmissionPath;
		this.#started = undefined;
		if (finished?.phase === "profile") {
			if (!phaseSubmitted) return this.#fail(ctx, finished, "profile", ["project execution profile was not accepted by fanout_submit_artifact"]);
			try {
				const profile = readAcceptedImplementationPlan(finished.projectExecutionProfilePath, finished.acceptedSubmission.identity);
				const approved = await ctx.ui.confirm("Approve Project Execution Profile", profileSummary(profile));
				if (!approved) return this.#fail(ctx, finished, "profile", ["project execution profile approval declined"]);
				const validation = await validateProjectExecutionProfile(profile, { repoRoot: ctx.cwd, runDir: finished.artifactDir, planningBase: recordField(finished.context.planningBase) as any, profileIdentity: finished.acceptedSubmission.identity });
				writeJsonl("fanout_profile_validation", { planRunId: finished.runId, phase: "profile", evidence: validation.artifact, ...validation.evidence }, ctx.cwd);
				if (validation.evidence.status !== "passed") return this.#fail(ctx, finished, "profile", [validation.evidence.error ?? "profile validation failed"]);
				const published = publishProjectExecutionProfile(profile, stringField(finished.context.projectArtifactRoot), stringField(finished.context.activeProfilePointerPath));
				finishPlanningPhase(finished.metrics, "profile");
				startPlanningPhase(finished.metrics);
				const implementationState = { ...finished, phase: "implementation" as const, acceptedSubmission: undefined, approvedProfile: { identity: published.identity, profile: published.profile }, phaseContextStart: contextMessages(ctx).length };
				this.#pending = { ...implementationState, systemPrompt: buildImplementationPlanPrompt(finished.objective, finished.context, implementationState) };
				ctx.ui.notify("Project Execution Profile approved; planning implementation.", "info");
				this.#startTurn(this.#pending, "Prepare and submit the Fanout implementation plan.");
				return;
			} catch (error) {
				return this.#fail(ctx, finished, "profile", [message(error)]);
			}
		}
		if (finished?.phase === "implementation") {
			if (!existsSync(finished.implementationPlanPath) && !phaseTurnStarted) return;
			if (!phaseSubmitted) return this.#fail(ctx, finished, "implementation", ["implementation plan was not accepted by fanout_submit_artifact"]);
			let implementationPlan: unknown;
			const planIdentity = finished.acceptedSubmission.identity;
			try { implementationPlan = readAcceptedImplementationPlan(finished.implementationPlanPath, planIdentity); }
			catch (error) { return this.#fail(ctx, finished, "implementation", [message(error)]); }
			const validation = validateImplementationPlan(implementationPlan);
			writeJsonl("fanout_implementation_plan_validation", { planRunId: finished.runId, phase: "implementation", artifactDir: finished.artifactDir, ...validation }, ctx.cwd);
			if (!validation.ok) return this.#fail(ctx, finished, "implementation", validation.errors);
			const objective = isRecord(implementationPlan) ? stringField(implementationPlan.objective) : "unknown";
			const requiredReadClassifications = buildRequiredReadClassifications(implementationPlan);
			finishPlanningPhase(finished.metrics, "implementation");
			startPlanningPhase(finished.metrics);
			const detailsState = { ...finished, phase: "details" as const, acceptedSubmission: undefined, planIdentity, acceptedPlan: validation.plan, objective, objectiveContextMessages: [], requiredReadClassifications, phaseContextStart: contextMessages(ctx).length };
			this.#pending = { ...detailsState, systemPrompt: buildImplementationDetailsPrompt(objective, finished.context, detailsState, requiredReadClassifications) };
			writeJsonl("fanout_required_read_classifications", { planRunId: finished.runId, phase: "implementation", objective, artifactDir: finished.artifactDir, count: requiredReadClassifications.length, requiredReadClassifications }, ctx.cwd);
			ctx.ui.notify("Implementation plan validated; grounding edit details.", "info");
			this.#startTurn(this.#pending, "Ground the accepted Phase A plan without changing the repository; submit implementation details with `fanout_submit_artifact`.");
			return;
		}
		if (finished?.phase !== "details") return;
		if (!phaseSubmitted) {
			if (!phaseTurnStarted) return;
			return this.#fail(ctx, finished, "details", ["implementation details were not accepted by fanout_submit_artifact"]);
		}
		if (!existsSync(finished.implementationDetailsPath)) {
			const errors = [`missing ${finished.implementationDetailsPath}`];
			writeJsonl("fanout_implementation_details_validation", { planRunId: finished.runId, phase: "details", artifactDir: finished.artifactDir, ok: false, errors }, ctx.cwd);
			return this.#fail(ctx, finished, "details", errors);
		}
		try {
			const planBytes = readFileSync(finished.implementationPlanPath);
			const detailsBytes = readFileSync(finished.implementationDetailsPath);
			const planIdentity = artifactIdentity("implementation-plan.json", planBytes);
			const detailsIdentity = artifactIdentity("implementation-details.json", detailsBytes);
			if (JSON.stringify(planIdentity) !== JSON.stringify(finished.planIdentity) || JSON.stringify(detailsIdentity) !== JSON.stringify(finished.acceptedSubmission?.identity)) throw new Error("accepted planning artifact bytes changed; restart /fanout-plan");
			if (!finished.approvedProfile) throw new Error("approved Project Execution Profile is missing");
			loadProjectExecutionProfile(finished.approvedProfile.identity, stringField(finished.context.projectArtifactRoot));
			const compiled = finished.acceptedCompilation;
			if (!compiled) throw new Error("accepted details have no bound compiler result; restart /fanout-plan");
			if (JSON.stringify(compiled.packet?.sourceArtifacts) !== JSON.stringify({ plan: planIdentity, details: detailsIdentity }) || JSON.stringify(compiled.packet?.profile) !== JSON.stringify(finished.approvedProfile.identity)) throw new Error("accepted compiler artifact identities changed; restart /fanout-plan");
			if (!compiled.ok || !compiled.packet) return this.#fail(ctx, finished, "compiler", compiled.errors);
			const artifacts = publishExecutionPacket(compiled.packet, stringField(finished.context.projectArtifactRoot), finished.artifactDir, stringField(finished.context.activePointerPath));
			finishPlanningPhase(finished.metrics, "details");
			writeJsonl("fanout_plan_end", { planRunId: finished.runId, invocation: finished.invocation, objective: finished.objective, phase: "complete", artifactDir: finished.artifactDir, packetPath: artifacts.packetPath, activePointerPath: artifacts.activePointerPath, warnings: compiled.warnings, ...planningMetricsSummary(finished.metrics, this.#options.activeThinking()) }, ctx.cwd);
			displayFanoutPlanReport(this.#pi, this.#options.reportPresentationAvailable, ctx.cwd, finished.runId, finished.artifactDir, artifacts);
			ctx.ui.notify(`Fanout plan ready ✅\nArtifacts: ${finished.artifactDir}`, "info");
			this.#pending = undefined;
		} catch (error) {
			writeJsonl("fanout_compiler_error", { planRunId: finished.runId, phase: "compiler", artifactDir: finished.artifactDir, error: message(error) }, ctx.cwd);
			this.#fail(ctx, finished, "compiler", [message(error)]);
		}
	}

	recordTtft(value: number): void { if (this.#started && this.#started.metrics.ttftMs === undefined) this.#started.metrics.ttftMs = value; }
	recordAssistant(messageValue: unknown, turnIndex: number | undefined, cwd: string): void {
		if (!this.#started) return;
		const usage = recordPlanningAssistant(this.#started.metrics, messageValue);
		if (usage) writeJsonl("assistant_usage", { planRunId: this.#started.runId, phase: this.#started.phase, turnIndex, ...usage }, cwd);
	}
	recordTurnStart(): void { if (this.#started) this.#started.metrics.turnCount++; }
	recordToolStart(toolCallId: string, started: number): void {
		if (!this.#started) return;
		this.#started.metrics.toolCallCount++;
		this.#toolStarts.set(toolCallId, { started, metrics: this.#started.metrics });
	}
	recordToolEnd(toolCallId: string, ended: number): void {
		const started = this.#toolStarts.get(toolCallId);
		this.#toolStarts.delete(toolCallId);
		if (started) recordPlanningToolInterval(started.metrics, started.started, ended);
	}
	captureCompactionContext(messages: unknown[]): void {
		if (this.#started) this.#compactionContext = { messages: structuredClone(messages), phaseStart: this.#started.phaseContextStart };
	}
	compactContext(messages: unknown[]): void {
		if (this.#started) {
			// Pi keeps a suffix of the whole branch; only its overlap with this phase is attributable.
			const before = this.#compactionContext;
			let kept = 0;
			while (before && kept < messages.length && kept < before.messages.length && JSON.stringify(messages.at(-1 - kept)) === JSON.stringify(before.messages.at(-1 - kept))) kept++;
			const keptPhase = Math.min(kept, before ? Math.max(0, before.messages.length - before.phaseStart) : 0);
			this.#compactedPrefix = messages.slice(0, messages.length - keptPhase);
			this.#compactionContext = undefined;
		} else if (this.#pending) this.#pending.phaseContextStart = messages.length;
	}
	filterContext(messages: unknown[]): unknown[] {
		const state = this.#started;
		if (!state) return messages;
		if (this.#compactedPrefix) {
			// A retry may remove a trailing error and append new continuations after session_compact.
			let prefixLength = 0;
			while (prefixLength < this.#compactedPrefix.length && prefixLength < messages.length && JSON.stringify(this.#compactedPrefix[prefixLength]) === JSON.stringify(messages[prefixLength])) prefixLength++;
			state.phaseContextStart = prefixLength;
			this.#compactedPrefix = undefined;
		}
		const phaseMessages = messages.slice(state.phaseContextStart);
		this.#phaseTrigger ??= phaseMessages.find((value) => isRecord(value) && value.role === "user");
		const trigger = this.#phaseTrigger && !phaseMessages.some((value) => JSON.stringify(value) === JSON.stringify(this.#phaseTrigger)) ? [this.#phaseTrigger] : [];
		return [...state.objectiveContextMessages, ...trigger, ...phaseMessages];
	}
	blockReason(toolName: string, toolCallId: string, messages: unknown[]): string | undefined {
		return planningToolBlockReason(toolName, Boolean(this.#started)) ?? planningSubmissionBatchBlockReason(toolName, toolCallId, messages, this.#started);
	}
	reset(): void {
		restorePlanningTools(this.#pi, this.#toolsBefore);
		this.#toolsBefore = undefined;
		this.#pending = undefined;
		this.#started = undefined;
		this.#toolStarts.clear();
		this.#phaseTrigger = undefined;
		this.#compactionContext = undefined;
		this.#compactedPrefix = undefined;
	}

	#registerSubmissionTool(phase: FanoutPhaseState["phase"]): void {
		this.#pi.registerTool({
			name: FANOUT_SUBMIT_TOOL,
			label: "Submit Fanout planning artifact",
			description: "Validate and atomically submit the artifact expected by the active Fanout planning phase. The controller selects the run and destination.",
			parameters: planningSubmissionParameters(phase),
			executionMode: "sequential",
			execute: async (_toolCallId, params: { artifact: unknown }, _signal, _onUpdate, ctx) => {
				const state = this.#started;
				if (!state || this.#pending?.runId !== state.runId || this.#pending.phase !== state.phase || this.#pending.acceptedSubmission) throw new Error("No matching Fanout planning phase is awaiting submission");
				const submitted = submitPlanningArtifact(state, params.artifact, ctx.cwd);
				const acceptedSubmission = { runId: state.runId, phase: state.phase, path: submitted.path, identity: submitted.identity };
				this.#started = { ...state, acceptedSubmission, acceptedCompilation: submitted.compiled };
				this.#pending = this.#started;
				return { content: [{ type: "text" as const, text: `${submitted.phase} artifact accepted: ${submitted.path}` }], details: { path: submitted.path, phase: submitted.phase, identity: submitted.identity }, terminate: true };
			},
		});
	}

	#startTurn(state: FanoutPhaseState, trigger: string): void {
		setTimeout(() => { if (this.#pending?.runId === state.runId && this.#pending.phase === state.phase && this.#pending.systemPrompt) this.#pi.sendUserMessage(trigger); }, 0);
	}

	#fail(ctx: any, state: FanoutPhaseState, phase: string, errors: string[]): void {
		finishPlanningPhase(state.metrics, state.phase);
		this.#pending = undefined;
		const concreteErrors = errors.length ? errors : ["unknown planning failure"];
		writeJsonl("fanout_plan_failed", { planRunId: state.runId, invocation: state.invocation, objective: state.objective, phase, errors: concreteErrors, artifactDir: state.artifactDir, activePacketChanged: true, activePacketInvalidated: true, ...planningMetricsSummary(state.metrics, this.#options.activeThinking()) }, ctx.cwd);
		ctx.ui.notify(`Fanout plan rejected: ${concreteErrors.join("; ")}\nArtifacts: ${state.artifactDir}\nRerun /fanout-plan after correcting the issue.\nThe prior active packet selection remains invalidated.`, "warning");
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function planningInvocation(args: string): { objective: string; refreshProfile: boolean; implicitObjective: boolean } {
	const value = args.trim();
	if (!value.startsWith("--refresh-profile")) return { objective: value || "Use the current conversation context.", refreshProfile: false, implicitObjective: !value };
	const remainder = value.slice("--refresh-profile".length);
	if (remainder && !/^\s/.test(remainder)) throw new Error("Usage: /fanout-plan [--refresh-profile] <objective>");
	return { objective: remainder.trim() || "Use the current conversation context.", refreshProfile: true, implicitObjective: !remainder.trim() };
}

function contextMessages(ctx: any): unknown[] {
	const messages = ctx.sessionManager?.buildSessionContext?.().messages;
	return Array.isArray(messages) ? messages : [];
}

function implicitObjectiveMessages(messages: unknown[]): unknown[] {
	const supported = messages.flatMap((value) => {
		if (!isRecord(value)) return [];
		if (value.role === "compactionSummary" || value.role === "branchSummary" || value.role === "user") return [value];
		if (value.role !== "assistant" || !Array.isArray(value.content)) return [];
		const content = value.content.filter((part) => isRecord(part) && part.type !== "toolCall");
		return content.length ? [{ ...value, content }] : [];
	});
	return convertToLlm(structuredClone(supported) as any);
}

function profileSummary(value: unknown): string {
	const profile = recordField(value);
	const rows = ["preparation", "readiness", "candidateNormalization", "requiredFinalGates"].flatMap((field) =>
		Array.isArray(profile[field]) ? profile[field].map((entry, index) => `${field}[${index}]: ${JSON.stringify(entry)}`) : [],
	);
	return [`Profile: ${stringField(profile.profileId)}`, ...rows].join("\n");
}
