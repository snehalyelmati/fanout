import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPLEMENTATION_PLAN_SCHEMA, IMPLEMENTATION_PLAN_VERSION, type ImplementationPlan, type RequiredReadClassification } from "../../fanout-core/src/fanout-compiler.ts";
import type { ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import type { WorkContractIssue } from "../../fanout-core/src/work-contract.ts";
import type { PlanningMetrics } from "./planning-observability.ts";

export const FANOUT_ORCHESTRATION_MARKER = "fanout.plan.orchestration.v1";
export { IMPLEMENTATION_PLAN_SCHEMA, IMPLEMENTATION_PLAN_VERSION };

export interface FanoutPlanRun {
	runId: string;
	artifactDir: string;
	implementationPlanPath: string;
	implementationDetailsPath: string;
}

export interface FanoutPhaseState extends FanoutPlanRun {
	phase: "implementation" | "details";
	systemPrompt?: string;
	acceptedSubmission?: { runId: string; phase: "implementation" | "details"; path: string; identity: ArtifactIdentity };
	planIdentity?: ArtifactIdentity;
	acceptedPlan?: ImplementationPlan;
	invocation: string;
	objective: string;
	context: Record<string, unknown>;
	metrics: PlanningMetrics;
	repairAttempted?: boolean;
	requiredReadClassifications?: RequiredReadClassification[];
}

export function createFanoutPlanRun(objective: string, context: { projectArtifactRoot: string }, now = new Date()): FanoutPlanRun {
	const runId = `${timestamp(now)}-${slug(objective)}`;
	const artifactDir = join(context.projectArtifactRoot, runId);
	return { runId, artifactDir, implementationPlanPath: join(artifactDir, "implementation-plan.json"), implementationDetailsPath: join(artifactDir, "implementation-details.json") };
}

export function buildImplementationPlanPrompt(objective: string, context: unknown, run: FanoutPlanRun): string {
	return buildPrompt("fanout-implementation-plan.md", "implementation", objective, context, run);
}

export function buildImplementationDetailsPrompt(objective: string, context: unknown, run: FanoutPlanRun, requiredReadClassifications: RequiredReadClassification[] = []): string {
	return buildPrompt("fanout-implementation-details.md", "details", objective, context, run, phaseBInput(run, requiredReadClassifications));
}

export function buildImplementationDetailsRepairPrompt(objective: string, context: unknown, run: FanoutPlanRun, issues: WorkContractIssue[], requiredReadClassifications: RequiredReadClassification[] = []): string {
	return `${buildImplementationDetailsPrompt(objective, context, run, requiredReadClassifications)}

Repair instructions:

You are repairing implementation-details.json only.
Do not change Phase A.
Do not edit repo files.
For each reported Phase A typed read-classification gap:
- add baseline-context if old/current file is enough
- add post-change-required if changed file is needed
Preserve existing anchors, ownership, validations, and forbidden changes.
Submit only implementation-details.json with fanout_submit_artifact.

Structured compiler issues to repair:

\`\`\`json
${JSON.stringify(issues, null, 2)}
\`\`\`
`;
}

function buildPrompt(templateName: string, phase: FanoutPhaseState["phase"], objective: string, context: unknown, run: FanoutPlanRun, phaseInput?: unknown): string {
	const template = readFileSync(new URL(`../prompts/${templateName}`, import.meta.url), "utf8").replace(/^---[\s\S]*?---\s*/, "");
	const orchestration = { marker: FANOUT_ORCHESTRATION_MARKER, runId: run.runId, phase };
	const detailsInput = phaseInput === undefined ? "" : `\n\nPhase B input:\n\n\`\`\`json\n${JSON.stringify(phaseInput, null, 2)}\n\`\`\`\n`;
	const defaultInput = phaseInput === undefined ? `\n\nResolved artifact targets:\n\n\`\`\`json\n${JSON.stringify(run, null, 2)}\n\`\`\`\n\nResolved preflight context (adapter-authored source of truth):\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n` : "";
	return `${template.replace("$ARGUMENTS", objective).trim()}\n\nFanout orchestration marker:\n\n\`\`\`json\n${JSON.stringify(orchestration)}\n\`\`\`${detailsInput}${defaultInput}`;
}

function phaseBInput(run: FanoutPlanRun, requiredReadClassifications: RequiredReadClassification[]): unknown {
	const accepted = run as FanoutPhaseState;
	return {
		artifactTargets: { runId: run.runId, artifactDir: run.artifactDir, implementationPlanPath: run.implementationPlanPath, implementationDetailsPath: run.implementationDetailsPath },
		planIdentity: accepted.planIdentity,
		acceptedPlan: accepted.acceptedPlan,
		requiredReadClassifications,
	};
}

function timestamp(date: Date): string {
	const base = date.toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 15);
	return `${base}${date.getUTCMilliseconds().toString().padStart(3, "0")}`;
}

function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "current-context";
}
