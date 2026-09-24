import { existsSync, readFileSync } from "node:fs";
import { convertToLlm, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { artifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { PlanningRepairSubmissionParametersSchema } from "../../fanout-core/src/planning-artifact-schema.ts";
import { writeJsonl } from "../../fanout-core/src/observability.ts";
import { invalidateActiveSelection } from "./artifact-store.ts";
import {
	buildImplementationPlanPrompt,
	buildProjectExecutionProfilePrompt,
	createFanoutPlanRun,
	type FanoutPhaseState,
} from "./fanout-plan-orchestration.ts";
import { activatePlanningTools, FANOUT_SUBMIT_TOOL, planningSubmissionBatchBlockReason, planningSubmissionParameters, planningToolBlockReason, readAcceptedImplementationPlan, repairPlanningDraft, restorePlanningTools, retainPlanningDraft, submitPlanningArtifact, type PlanningDraft } from "./planning-capabilities.ts";
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

const MAX_PLANNING_CORRECTIONS = 2;

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
	#draft: PlanningDraft | undefined;
	#repairCalls = new Set<string>();
	#repairAttempts = 0;

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
		this.#repairAttempts = 0;
		this.#repairCalls.clear();
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
		const expectedSubmissionPath = finished?.phase === "profile" ? finished.projectExecutionProfilePath : finished?.implementationDetailsPath;
		const phaseSubmitted = phaseTurnStarted && finished?.acceptedSubmission?.runId === finished.runId && finished.acceptedSubmission.phase === finished.phase && finished.acceptedSubmission.path === expectedSubmissionPath;
		this.#started = undefined;
		if (finished?.phase === "profile") {
			const acceptedSubmission = finished.acceptedSubmission;
			if (!phaseSubmitted || !acceptedSubmission) return this.#fail(ctx, finished, "profile", ["project execution profile was not accepted by fanout_submit_artifact"]);
			try {
				const profile = readAcceptedImplementationPlan(finished.projectExecutionProfilePath, acceptedSubmission.identity);
				const approved = await ctx.ui.confirm("Approve Project Execution Profile", profileSummary(profile));
				if (this.#pending !== finished) return;
				if (!approved) return this.#fail(ctx, finished, "profile", ["project execution profile approval declined"]);
				const validation = await validateProjectExecutionProfile(profile, { repoRoot: ctx.cwd, runDir: finished.artifactDir, planningBase: recordField(finished.context.planningBase) as any, profileIdentity: acceptedSubmission.identity });
				if (this.#pending !== finished) return;
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
				if (this.#pending !== finished) return;
				return this.#fail(ctx, finished, "profile", [message(error)]);
			}
		}
		if (!finished || !phaseSubmitted) {
			if (finished) this.#fail(ctx, finished, "implementation", ["combined planning artifacts were not accepted by fanout_submit_artifact"]);
			return;
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
			finishPlanningPhase(finished.metrics, "implementation");
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
		// message_end precedes SDK tool argument validation, which can bypass execute entirely.
		if (this.#draft && isRecord(messageValue) && messageValue.role === "assistant" && Array.isArray(messageValue.content)) {
			for (const part of messageValue.content) {
				if (isRecord(part) && part.type === "toolCall" && part.name === FANOUT_SUBMIT_TOOL && typeof part.id === "string") {
					this.#repairCalls.add(part.id);
					this.#repairAttempts++;
				}
			}
			writeJsonl("fanout_planning_repair_attempts", { planRunId: this.#started.runId, revision: this.#draft.revision, attempts: this.#repairAttempts }, cwd);
		}
		const usage = recordPlanningAssistant(this.#started.metrics, messageValue);
		if (usage) writeJsonl("assistant_usage", { planRunId: this.#started.runId, phase: this.#started.phase, turnIndex, ...usage }, cwd);
	}
	finishResponse(ctx: any): void {
		if (!this.#started || this.#started.acceptedSubmission || this.#repairAttempts < MAX_PLANNING_CORRECTIONS) return;
		this.#fail(ctx, this.#started, "implementation", [`Planning correction budget exhausted (${MAX_PLANNING_CORRECTIONS} attempts); restart /fanout-plan`]);
		this.reset();
		ctx.abort();
	}
	recordTurnStart(): void {
		this.#repairCalls.clear();
		if (this.#started) this.#started.metrics.turnCount++;
	}
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
		if (this.#started) this.#compactionContext = { messages: structuredClone(conversationMessages(messages)), phaseStart: this.#started.phaseContextStart };
	}
	compactContext(messages: unknown[]): void {
		messages = conversationMessages(messages);
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
		this.#draft = undefined;
		this.#repairCalls.clear();
		this.#repairAttempts = 0;
	}

	#registerSubmissionTool(phase: FanoutPhaseState["phase"]): void {
		const registeredState = this.#started;
		this.#pi.registerTool({
			name: FANOUT_SUBMIT_TOOL,
			label: "Submit Fanout planning artifact",
			description: "Validate and atomically submit the artifact expected by the active Fanout planning phase. The controller selects the run and destination.",
			parameters: this.#draft ? PlanningRepairSubmissionParametersSchema : planningSubmissionParameters(phase),
			executionMode: "sequential",
			execute: async (toolCallId, params: { artifact: unknown }, signal, _onUpdate, ctx) => {
				const state = this.#started;
				if (signal?.aborted || !state || state !== registeredState || this.#pending !== state || state.acceptedSubmission) throw new Error("No matching Fanout planning phase is awaiting submission");
				let submitted;
				try {
					if (state.phase === "implementation") {
						if (this.#draft) {
							if (!this.#repairCalls.delete(toolCallId)) this.#repairAttempts++;
							if (this.#repairAttempts > MAX_PLANNING_CORRECTIONS) throw new Error("Planning correction budget exhausted");
							this.#draft = repairPlanningDraft(this.#draft, params.artifact);
						} else this.#draft = retainPlanningDraft(params.artifact);
					}
					submitted = submitPlanningArtifact(state, this.#draft?.body ?? params.artifact, ctx.cwd);
				} catch (error) {
					if (!this.#draft) throw error;
					this.#registerSubmissionTool(state.phase);
					writeJsonl("fanout_planning_correction", { planRunId: state.runId, revision: this.#draft.revision, attempts: this.#repairAttempts, error: message(error) }, ctx.cwd);
					throw new Error(`${message(error)}\nRetained draft revision ${this.#draft.revision}. ${Math.max(0, MAX_PLANNING_CORRECTIONS - this.#repairAttempts)} correction attempts remain. Submit only typed whole-record replacements by existing IDs using the updated tool schema. Header and inventory changes require restarting /fanout-plan.`);
				}
				this.#draft = undefined;
				const acceptedSubmission = { runId: state.runId, phase: state.phase, path: submitted.path, identity: submitted.identity };
				this.#started = { ...state, acceptedSubmission, planIdentity: submitted.planIdentity, acceptedCompilation: submitted.compiled };
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
		this.#draft = undefined;
		this.#repairCalls.clear();
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
	return Array.isArray(messages) ? conversationMessages(messages) : [];
}

function conversationMessages(messages: unknown[]): unknown[] {
	// Pi 0.87's context hook excludes system messages; phase offsets and compaction
	// comparisons must use that same projection of the canonical session context.
	return messages.filter((message) => !isRecord(message) || message.role !== "system");
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
