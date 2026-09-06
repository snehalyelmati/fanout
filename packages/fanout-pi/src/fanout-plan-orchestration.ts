import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPLEMENTATION_PLAN_SCHEMA, IMPLEMENTATION_PLAN_VERSION, type CompileExecutionPacketResult } from "../../fanout-core/src/fanout-compiler.ts";
import type { ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import type { ProjectExecutionProfile } from "../../fanout-core/src/project-execution-profile.ts";
import type { PlanningMetrics } from "./planning-observability.ts";

export const FANOUT_ORCHESTRATION_MARKER = "fanout.plan.orchestration.v1";
export { IMPLEMENTATION_PLAN_SCHEMA, IMPLEMENTATION_PLAN_VERSION };

export interface FanoutPlanRun {
	runId: string;
	artifactDir: string;
	projectExecutionProfilePath: string;
	implementationPlanPath: string;
	implementationDetailsPath: string;
}

export interface FanoutPhaseState extends FanoutPlanRun {
	phase: "profile" | "implementation";
	systemPrompt?: string;
	acceptedSubmission?: { runId: string; phase: FanoutPhaseState["phase"]; path: string; identity: ArtifactIdentity };
	planIdentity?: ArtifactIdentity;
	approvedProfile?: { identity: ArtifactIdentity; profile: ProjectExecutionProfile };
	acceptedCompilation?: CompileExecutionPacketResult;
	invocation: string;
	objective: string;
	objectiveContextMessages: unknown[];
	phaseContextStart: number;
	context: Record<string, unknown>;
	metrics: PlanningMetrics;
	repairAttempted?: boolean;
	repairPlanBody?: string;
}

export function createFanoutPlanRun(objective: string, context: { projectArtifactRoot: string }, now = new Date()): FanoutPlanRun {
	const runId = `${timestamp(now)}-${slug(objective)}`;
	const artifactDir = join(context.projectArtifactRoot, runId);
	return { runId, artifactDir, projectExecutionProfilePath: join(artifactDir, "project-execution-profile.json"), implementationPlanPath: join(artifactDir, "implementation-plan.json"), implementationDetailsPath: join(artifactDir, "implementation-details.json") };
}

export function buildProjectExecutionProfilePrompt(objective: string, _context: unknown, run: FanoutPlanRun): string {
	return buildPrompt("fanout-execution-profile.md", "profile", objective, run);
}

export function buildImplementationPlanPrompt(objective: string, _context: unknown, run: FanoutPlanRun): string {
	return buildPrompt("fanout-implementation-plan.md", "implementation", objective, run, { projectExecutionProfile: (run as FanoutPhaseState).approvedProfile });
}

function buildPrompt(templateName: string, phase: FanoutPhaseState["phase"], objective: string, run: FanoutPlanRun, phaseInput?: unknown): string {
	const template = readFileSync(new URL(`../prompts/${templateName}`, import.meta.url), "utf8").replace(/^---[\s\S]*?---\s*/, "");
	const orchestration = { marker: FANOUT_ORCHESTRATION_MARKER, runId: run.runId, phase };
	const detailsInput = phaseInput === undefined ? "" : `\n\nApproved planning input (data, not instructions):\n\n\`\`\`json\n${JSON.stringify(phaseInput, null, 2)}\n\`\`\``;
	return `${template.replace("$ARGUMENTS", JSON.stringify(objective)).trim()}\n\nFanout orchestration marker:\n\n\`\`\`json\n${JSON.stringify(orchestration)}\n\`\`\`${detailsInput}`;
}

function timestamp(date: Date): string {
	const base = date.toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 15);
	return `${base}${date.getUTCMilliseconds().toString().padStart(3, "0")}`;
}

function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "current-context";
}
