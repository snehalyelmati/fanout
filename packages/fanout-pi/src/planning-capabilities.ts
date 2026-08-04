import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { artifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { parseProjectExecutionProfile } from "../../fanout-core/src/project-execution-profile.ts";
import {
	IMPLEMENTATION_DETAILS_SCHEMA,
	IMPLEMENTATION_DETAILS_VERSION,
	IMPLEMENTATION_PLAN_SCHEMA,
	IMPLEMENTATION_PLAN_VERSION,
	ImplementationDetailsBodySchema,
	ImplementationDetailsSubmissionParametersSchema,
	ImplementationPlanBodySchema,
	ImplementationPlanSubmissionParametersSchema,
	PROJECT_EXECUTION_PROFILE_SCHEMA,
	PROJECT_EXECUTION_PROFILE_VERSION,
	ProfileSubmissionParametersSchema,
	ProjectExecutionProfileBodySchema,
	planningSchemaErrors,
} from "../../fanout-core/src/planning-artifact-schema.ts";
import { validateImplementationDetailsArtifact, validateImplementationPlan } from "../../fanout-core/src/fanout-compiler.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import { type FanoutPhaseState } from "./fanout-plan-orchestration.ts";

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
	return phase === "profile" ? ProfileSubmissionParametersSchema : phase === "implementation" ? ImplementationPlanSubmissionParametersSchema : ImplementationDetailsSubmissionParametersSchema;
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

export function submitPlanningArtifact(state: FanoutPhaseState, artifact: unknown, cwd: string): { path: string; phase: FanoutPhaseState["phase"]; identity: ReturnType<typeof artifactIdentity> } {
	const root = stringField(state.context.projectArtifactRoot);
	const destination = state.phase === "profile" ? state.projectExecutionProfilePath : state.phase === "implementation" ? state.implementationPlanPath : state.implementationDetailsPath;
	assertControllerDestination(root, destination, cwd);
	const planIdentity = state.phase === "details" ? acceptedPlanIdentity(state) : undefined;
	const submitted = controllerEnvelope(state, artifact, planIdentity);
	if (state.phase === "profile") {
		const validation = profileValidation(submitted);
		if (!validation.ok) throw new Error(validation.errors.join("; "));
	} else if (state.phase === "implementation") {
		const validation = validateImplementationPlan(submitted);
		if (!validation.ok) throw new Error(validation.errors.join("; "));
	} else {
		const validation = validateImplementationDetailsArtifact(submitted, { planIdentity, plan: acceptedPlan(state), profile: approvedProfile(state) });
		if (!validation.ok || !validation.details) throw new Error(validation.errors.join("; "));
	}

	const relativePath = relative(resolve(root), resolve(destination)).split(sep).join("/");
	const bytes = Buffer.from(`${JSON.stringify(submitted, null, 2)}\n`);
	writeArtifactAtomically(root, relativePath, bytes);
	return { path: destination, phase: state.phase, identity: artifactIdentity(relativePath.split("/").at(-1)!, bytes) };
}

export function readAcceptedImplementationPlan(path: string, expected: ReturnType<typeof artifactIdentity>): unknown {
	return JSON.parse(readAcceptedPlanBytes(path, expected).toString("utf8"));
}

function controllerEnvelope(state: FanoutPhaseState, body: unknown, planIdentity?: ReturnType<typeof artifactIdentity>): unknown {
	const bodySchema = state.phase === "profile" ? ProjectExecutionProfileBodySchema : state.phase === "implementation" ? ImplementationPlanBodySchema : ImplementationDetailsBodySchema;
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
	if (state.phase === "implementation") {
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

function acceptedPlanIdentity(state: FanoutPhaseState) {
	if (!state.planIdentity) throw new Error("accepted implementation-plan identity is missing; restart /fanout-plan");
	readAcceptedPlanBytes(state.implementationPlanPath, state.planIdentity);
	return state.planIdentity;
}

function readAcceptedPlanBytes(path: string, expected: ReturnType<typeof artifactIdentity>): Buffer {
	const bytes = readFileSync(path);
	const current = artifactIdentity(expected.path, bytes);
	if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("accepted implementation-plan bytes changed; restart /fanout-plan");
	return bytes;
}

function acceptedPlan(state: FanoutPhaseState) {
	if (!state.acceptedPlan) throw new Error("accepted implementation plan is missing; restart /fanout-plan");
	return state.acceptedPlan;
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
