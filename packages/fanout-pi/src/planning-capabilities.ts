import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateImplementationDetailsArtifact } from "../../fanout-core/src/fanout-compiler.ts";
import { writeArtifactAtomically } from "./artifact-store.ts";
import { validateImplementationPlan, type FanoutPhaseState } from "./fanout-plan-orchestration.ts";

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

export function planningToolBlockReason(toolName: string, active: boolean): string | undefined {
	if (!active || FANOUT_PLANNING_TOOLS.includes(toolName)) return undefined;
	return `Fanout planning blocks ${toolName}; allowed tools are ${FANOUT_PLANNING_TOOLS.join(", ")}.`;
}

export function submitPlanningArtifact(state: FanoutPhaseState, artifact: unknown, cwd: string): { path: string; phase: FanoutPhaseState["phase"] } {
	const root = stringField(state.context.projectArtifactRoot);
	const destination = state.phase === "implementation" ? state.implementationPlanPath : state.implementationDetailsPath;
	assertControllerDestination(root, destination, cwd);
	const validation = state.phase === "implementation"
		? validateImplementationPlan(artifact, { artifactDir: state.artifactDir })
		: validateImplementationDetailsArtifact(artifact, {
			objective: state.objective,
			artifactDir: state.artifactDir,
			sourcePlanPath: state.implementationPlanPath,
			planIds: implementationPlanIds(state.implementationPlanPath),
		});
	if (!validation.ok) throw new Error(validation.errors.join("; "));

	const relativePath = relative(resolve(root), resolve(destination)).split(sep).join("/");
	writeArtifactAtomically(root, relativePath, Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`));
	return { path: destination, phase: state.phase };
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

function implementationPlanIds(path: string): string[] {
	try {
		const plan = JSON.parse(readFileSync(path, "utf8"));
		return Array.isArray(plan?.implementationItems) ? plan.implementationItems.map((item: any) => item?.id).filter((id: unknown): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function escapes(root: string, target: string): boolean {
	const path = relative(root, target);
	return path === ".." || path.startsWith("../") || path.startsWith("..\\") || isAbsolute(path);
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}
