import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeJsonl } from "../../fanout-core/src/observability.ts";
import { artifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { parseProjectExecutionProfile } from "../../fanout-core/src/project-execution-profile.ts";
import {
	IMPLEMENTATION_DETAILS_SCHEMA,
	IMPLEMENTATION_DETAILS_VERSION,
	IMPLEMENTATION_PLAN_SCHEMA,
	IMPLEMENTATION_PLAN_VERSION,
	ImplementationDetailsBodySchema,
	CombinedPlanningBodySchema,
	CombinedPlanningSubmissionParametersSchema,
	ImplementationPlanBodySchema,
	PROJECT_EXECUTION_PROFILE_SCHEMA,
	PROJECT_EXECUTION_PROFILE_VERSION,
	ProfileSubmissionParametersSchema,
	ProjectExecutionProfileBodySchema,
	planningSchemaErrors,
} from "../../fanout-core/src/planning-artifact-schema.ts";
import { compileExecutionPacket, type CompileExecutionPacketResult, validateImplementationPlan } from "../../fanout-core/src/fanout-compiler.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import { type FanoutPhaseState } from "./fanout-plan-orchestration.ts";
import { positiveIntegerSetting, recordField } from "./fanout-runtime-context.ts";

export const FANOUT_SUBMIT_TOOL = "fanout_submit_artifact";
export const FANOUT_PLANNING_TOOLS = ["read", "grep", "find", "ls", "ask_user_question", FANOUT_SUBMIT_TOOL];

export function activatePlanningTools(pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">): string[] {
	const previous = pi.getActiveTools();
	pi.setActiveTools(FANOUT_PLANNING_TOOLS);
	return previous;
}

export function restorePlanningTools(pi: Pick<ExtensionAPI, "setActiveTools">, previous: string[] | undefined): void {
	if (previous) pi.setActiveTools(previous);
}

export function planningSubmissionParameters(phase: FanoutPhaseState["phase"]) {
	return phase === "profile" ? ProfileSubmissionParametersSchema : CombinedPlanningSubmissionParametersSchema;
}

export function planningToolBlockReason(toolName: string, active: boolean): string | undefined {
	if (!active || FANOUT_PLANNING_TOOLS.includes(toolName)) return undefined;
	return `Fanout planning blocks ${toolName}; allowed tools are ${FANOUT_PLANNING_TOOLS.join(", ")}.`;
}

export function planningSubmissionBatchBlockReason(toolName: string, toolCallId: string, messages: unknown[], state: FanoutPhaseState | undefined): string | undefined {
	if (!state || toolName !== FANOUT_SUBMIT_TOOL) return undefined;
	const assistant = messages.findLast((value) => isRecord(value) && value.role === "assistant" && Array.isArray(value.content) && value.content.some((part) => isRecord(part) && part.type === "toolCall" && part.id === toolCallId));
	const calls = isRecord(assistant) && Array.isArray(assistant.content) ? assistant.content.filter((part) => isRecord(part) && part.type === "toolCall") : [];
	if (calls.length === 1) return undefined;
	return "Fanout planning requires fanout_submit_artifact to be the only tool call in its assistant message; inspect first, then submit alone.";
}

export function submitPlanningArtifact(state: FanoutPhaseState, artifact: unknown, cwd: string): { path: string; phase: FanoutPhaseState["phase"]; identity: ReturnType<typeof artifactIdentity>; planIdentity?: ReturnType<typeof artifactIdentity>; compiled?: CompileExecutionPacketResult } {
	const root = stringField(state.context.projectArtifactRoot);
	const destination = state.phase === "profile" ? state.projectExecutionProfilePath : state.implementationDetailsPath;
	assertControllerDestination(root, destination, cwd);
	const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
	const relativePath = (path: string) => relative(resolve(root), resolve(path)).split(sep).join("/");
	if (state.phase === "profile") {
		const submitted = controllerEnvelope(state, artifact);
		const validation = profileValidation(submitted);
		if (!validation.ok) throw new Error(validation.errors.join("; "));
		const bytes = encode(submitted);
		writeArtifactAtomically(root, relativePath(destination), bytes);
		return { path: destination, phase: state.phase, identity: artifactIdentity("project-execution-profile.json", bytes) };
	}
	const errors = planningSchemaErrors(CombinedPlanningBodySchema, artifact);
	if (errors.length || !isRecord(artifact)) throw new TypeError(errors.join("; "));
	const plan = controllerEnvelope(state, artifact.plan);
	const planBody = JSON.stringify(artifact.plan);
	if (state.repairPlanBody !== planBody) state.repairAttempted = false;
	state.repairPlanBody = planBody;
	const admittedPlan = validateImplementationPlan(plan);
	if (!admittedPlan.ok || !admittedPlan.plan) throw new Error(admittedPlan.errors.join("; "));
	const planBytes = encode(plan);
	const planIdentity = artifactIdentity("implementation-plan.json", planBytes);
	const details = controllerEnvelope(state, artifact.details, planIdentity);
	const detailsBytes = encode(details);
	const identity = artifactIdentity("implementation-details.json", detailsBytes);
	const compiled = compileExecutionPacket({
		implementationPlan: plan, implementationDetails: details, planIdentity, detailsIdentity: identity,
		profile: approvedProfile(state), tierPlan: state.context.resolvedTierPlan as any,
		runtimePolicy: { maxConcurrency: positiveIntegerSetting(recordField(state.context.executionDefaults).maxConcurrency, 2), failFast: false, fallbackAllowed: true },
		sequentialReadFallback: state.repairAttempted === true,
	});
	writeJsonl("fanout_compiler_validation", { planRunId: state.runId, phase: state.phase, artifactDir: state.artifactDir, repairAttempted: state.repairAttempted === true, ok: compiled.ok, errors: compiled.errors, warnings: compiled.warnings }, cwd);
	if (!compiled.ok) {
		if (compiled.issues.length && compiled.issues.every((issue) => issue.code === "planned-read-not-grounded")) state.repairAttempted = true;
		throw new Error(JSON.stringify({ error: "Planning draft failed compiler admission; correct these issues and resubmit", issues: compiled.issues }));
	}
	// Both halves must compile before either is published. The active packet pointer is published last at settlement.
	writeArtifactAtomically(root, relativePath(state.implementationPlanPath), planBytes);
	writeArtifactAtomically(root, relativePath(destination), detailsBytes);
	return { path: destination, phase: state.phase, identity, planIdentity, compiled };
}

export function readAcceptedImplementationPlan(path: string, expected: ReturnType<typeof artifactIdentity>): unknown {
	return JSON.parse(readAcceptedPlanBytes(path, expected).toString("utf8"));
}

function controllerEnvelope(state: FanoutPhaseState, body: unknown, planIdentity?: ReturnType<typeof artifactIdentity>): unknown {
	const bodySchema = state.phase === "profile" ? ProjectExecutionProfileBodySchema : planIdentity ? ImplementationDetailsBodySchema : ImplementationPlanBodySchema;
	const errors = planningSchemaErrors(bodySchema, body);
	if (errors.length) throw new TypeError(errors.join("; "));
	if (!isRecord(body)) throw new TypeError("planning submission body must be an object");
	if (state.phase === "profile") {
		return {
			schema: PROJECT_EXECUTION_PROFILE_SCHEMA,
			version: PROJECT_EXECUTION_PROFILE_VERSION,
			profileId: state.runId,
			createdAt: new Date().toISOString(),
			preparation: body.preparation,
			readiness: body.readiness,
			candidateNormalization: body.candidateNormalization,
			requiredFinalGates: body.requiredFinalGates,
		};
	}
	if (!planIdentity) {
		const planningBase = isRecord(state.context.planningBase) ? state.context.planningBase : {};
		return {
			schema: IMPLEMENTATION_PLAN_SCHEMA,
			version: IMPLEMENTATION_PLAN_VERSION,
			planId: state.runId,
			createdAt: new Date().toISOString(),
			planningHost: { platform: process.platform },
			planningBase: { headCommit: planningBase.headCommit, tree: planningBase.tree },
			profile: state.approvedProfile?.identity,
			objective: body.objective,
			userContext: body.userContext,
			discoveredRepoFacts: body.discoveredRepoFacts,
			assumptions: body.assumptions,
			implementationItems: body.implementationItems,
		};
	}
	return {
		schema: IMPLEMENTATION_DETAILS_SCHEMA,
		version: IMPLEMENTATION_DETAILS_VERSION,
		detailsId: state.runId,
		createdAt: new Date().toISOString(),
		plan: planIdentity,
		items: (body.items as Array<Record<string, unknown>>).map((item) => ({ ...item, advisoryNotes: item.advisoryNotes ?? [] })),
		finalValidationCommands: body.finalValidationCommands,
	};
}

function profileValidation(value: unknown): { ok: boolean; errors: string[] } {
	try { parseProjectExecutionProfile(value); return { ok: true, errors: [] }; }
	catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
}

function approvedProfile(state: FanoutPhaseState) {
	if (!state.approvedProfile) throw new Error("approved Project Execution Profile is missing; restart /fanout-plan");
	return state.approvedProfile.profile;
}

function readAcceptedPlanBytes(path: string, expected: ReturnType<typeof artifactIdentity>): Buffer {
	const bytes = readFileSync(path);
	const current = artifactIdentity(expected.path, bytes);
	if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("accepted implementation-plan bytes changed; restart /fanout-plan");
	return bytes;
}

function assertControllerDestination(root: string, destination: string, cwd: string): void {
	if (!root) throw new Error("Fanout artifact root is missing");
	const lexicalRoot = resolve(root);
	const lexicalRepository = resolve(cwd);
	const resolvedDestination = resolve(destination);
	if (escapes(lexicalRoot, resolvedDestination)) throw new Error("Fanout artifact destination escapes the controller artifact root");
	if (!escapes(lexicalRepository, lexicalRoot)) throw new Error("Fanout artifacts cannot be submitted into the repository");
	mkdirSync(root, { recursive: true });
	mkdirSync(dirname(destination), { recursive: true });
	const realRoot = realpathSync(root);
	const realDestinationParent = realpathSync(dirname(destination));
	const realRepository = realpathSync(cwd);
	if (escapes(realRoot, realDestinationParent)) throw new Error("Fanout artifact destination escapes the controller artifact root");
	if (!escapes(realRepository, realRoot) || !escapes(realRepository, realDestinationParent)) throw new Error("Fanout artifacts cannot be submitted into the repository");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapes(root: string, target: string): boolean {
	const path = relative(root, target);
	return path === ".." || path.startsWith("../") || path.startsWith("..\\") || isAbsolute(path);
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}
