import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RequiredReadClassification } from "../../fanout-core/src/fanout-compiler.ts";
import type { PlanningMetrics } from "./planning-observability.ts";

export const FANOUT_ORCHESTRATION_MARKER = "fanout.plan.orchestration.v1";
export const IMPLEMENTATION_PLAN_SCHEMA = "fanout.implementation-plan";
export const IMPLEMENTATION_PLAN_VERSION = 1;

export interface FanoutPlanRun {
	runId: string;
	artifactDir: string;
	implementationPlanPath: string;
	implementationDetailsPath: string;
}

export interface FanoutPhaseState extends FanoutPlanRun {
	phase: "implementation" | "details";
	invocation: string;
	objective: string;
	context: Record<string, unknown>;
	metrics: PlanningMetrics;
	repairAttempted?: boolean;
	repairDetailsMtimeMs?: number;
	requiredReadClassifications?: RequiredReadClassification[];
}

export interface ImplementationPlanValidation {
	ok: boolean;
	errors: string[];
	itemCount: number;
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

export function buildImplementationDetailsRepairPrompt(objective: string, context: unknown, run: FanoutPlanRun, errors: string[], requiredReadClassifications: RequiredReadClassification[] = []): string {
	return `${buildImplementationDetailsPrompt(objective, context, run, requiredReadClassifications)}

Repair instructions:

You are repairing implementation-details.json only.
Do not change Phase A.
Do not edit repo files.
For each ambiguous Phase A filesToRead overlap:
- add baseline-context if old/current file is enough
- add post-change-required if changed file is needed
Preserve existing anchors, ownership, validations, and forbidden changes.
Write only implementation-details.json.

Compiler errors to repair:

\`\`\`json
${JSON.stringify(errors, null, 2)}
\`\`\`
`;
}

export function isFanoutPhasePrompt(prompt: string, state: FanoutPhaseState): boolean {
	return prompt.includes(FANOUT_ORCHESTRATION_MARKER) && prompt.includes(`"runId":"${state.runId}"`) && prompt.includes(`"phase":"${state.phase}"`);
}

export function validateImplementationPlanArtifact(path: string, expected?: { artifactDir?: string }): ImplementationPlanValidation {
	const errors: string[] = [];
	if (!existsSync(path)) return { ok: false, errors: [`missing ${path}`], itemCount: 0 };

	let plan: unknown;
	try {
		plan = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return { ok: false, errors: [error instanceof Error ? error.message : String(error)], itemCount: 0 };
	}

	if (!isRecord(plan)) return { ok: false, errors: ["implementation plan must be an object"], itemCount: 0 };
	if (plan.schema !== IMPLEMENTATION_PLAN_SCHEMA) errors.push(`schema must be ${IMPLEMENTATION_PLAN_SCHEMA}`);
	if (plan.version !== IMPLEMENTATION_PLAN_VERSION) errors.push(`version must be ${IMPLEMENTATION_PLAN_VERSION}`);
	if (plan.status !== "ready") errors.push("status must be ready");
	for (const key of ["objective", "createdAt", "artifactDir"] as const) if (!nonEmptyString(plan[key])) errors.push(`${key} is required`);
	if (expected?.artifactDir !== undefined && plan.artifactDir !== expected.artifactDir) errors.push("artifactDir does not match current run");
	for (const key of ["userContext", "discoveredRepoFacts", "assumptions", "validationPlan", "risks"] as const) stringArray(plan[key], key, errors);

	const items = Array.isArray(plan.implementationItems) ? plan.implementationItems : [];
	if (!Array.isArray(plan.implementationItems)) errors.push("implementationItems must be an array");
	if (items.length === 0) errors.push("implementationItems must not be empty");

	const ids = new Set<string>();
	for (const [index, item] of items.entries()) {
		if (!isRecord(item)) {
			errors.push(`implementationItems[${index}] must be an object`);
			continue;
		}
		for (const key of ["id", "goal", "rationale"] as const) if (!nonEmptyString(item[key])) errors.push(`implementationItems[${index}].${key} is required`);
		if (nonEmptyString(item.id)) {
			const id = String(item.id);
			if (ids.has(id)) errors.push(`implementationItems[${index}].id is duplicate`);
			ids.add(id);
		}
		for (const key of ["filesToChange", "filesToRead"] as const) {
			const paths = stringArray(item[key], `implementationItems[${index}].${key}`, errors);
			for (const [pathIndex, path] of paths.entries()) if (path.includes("`")) errors.push(`implementationItems[${index}].${key}[${pathIndex}] must be a bare repository path without Markdown backticks`);
		}
		for (const key of ["dependencies", "validation", "acceptanceCriteria", "risks"] as const) stringArray(item[key], `implementationItems[${index}].${key}`, errors);
	}

	for (const [index, item] of items.entries()) {
		if (!isRecord(item) || !Array.isArray(item.dependencies)) continue;
		for (const dependency of item.dependencies) {
			if (typeof dependency !== "string") continue;
			if (dependency === item.id) errors.push(`implementationItems[${index}].dependencies references itself`);
			else if (!ids.has(dependency)) errors.push(`implementationItems[${index}].dependencies references unknown id ${dependency}`);
		}
	}

	return { ok: errors.length === 0, errors, itemCount: items.length };
}

function buildPrompt(templateName: string, phase: FanoutPhaseState["phase"], objective: string, context: unknown, run: FanoutPlanRun, phaseInput?: unknown): string {
	const template = readFileSync(new URL(`../prompts/${templateName}`, import.meta.url), "utf8").replace(/^---[\s\S]*?---\s*/, "");
	const orchestration = { marker: FANOUT_ORCHESTRATION_MARKER, runId: run.runId, phase };
	const detailsInput = phaseInput === undefined ? "" : `\n\nPhase B input:\n\n\`\`\`json\n${JSON.stringify(phaseInput, null, 2)}\n\`\`\`\n`;
	const defaultInput = phaseInput === undefined ? `\n\nResolved artifact targets:\n\n\`\`\`json\n${JSON.stringify(run, null, 2)}\n\`\`\`\n\nResolved preflight context (adapter-authored source of truth):\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n` : "";
	return `${template.replace("$ARGUMENTS", objective).trim()}\n\nFanout orchestration marker:\n\n\`\`\`json\n${JSON.stringify(orchestration)}\n\`\`\`${detailsInput}${defaultInput}`;
}

function phaseBInput(run: FanoutPlanRun, requiredReadClassifications: RequiredReadClassification[]): unknown {
	return { artifactTargets: run, requiredReadClassifications };
}

function timestamp(date: Date): string {
	const base = date.toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 15);
	return `${base}${date.getUTCMilliseconds().toString().padStart(3, "0")}`;
}

function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "current-context";
}

function stringArray(value: unknown, path: string, errors: string[]): string[] {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array`);
		return [];
	}
	for (const [index, item] of value.entries()) if (typeof item !== "string") errors.push(`${path}[${index}] must be a string`);
	return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}
