import { spawnSync } from "node:child_process";
import { parseRepoPath, resourcesOverlap, type Resource } from "../../fanout-core/src/repository-resource.ts";
import {
	FIXED_WORKER_CAPABILITIES,
	WORK_CONTRACT_SCHEMA,
	WORK_CONTRACT_VERSION,
	validateWorkContract,
	type WorkContract,
} from "../../fanout-core/src/work-contract.ts";
import type { FanoutWorkUnit } from "../../fanout-core/src/execution-packet.ts";

export function legacyWorkContract(unit: FanoutWorkUnit, repoRoot: string, workUnits: readonly FanoutWorkUnit[]): WorkContract {
	if (unit.workerPacket.forbiddenChanges.length) throw new Error(`legacy forbidden-change prose is not executable for ${unit.id}; replan with typed forbidden resources`);
	const sourcePlanIds = [...unit.workerPacket.sourcePlanIds];
	const resources = unit.ownedFiles.map((value) => legacyResource(value, repoRoot));
	const readResources = unit.readOnlyFiles.map((value) => legacyResource(value, repoRoot).resource);
	const dependencyResources = workUnits.filter((candidate) => unit.dependencies.includes(candidate.id)).flatMap((candidate) => candidate.ownedFiles.map((value) => legacyResource(value, repoRoot).resource));
	const shell = process.env.SHELL || "/bin/sh";
	const candidate = {
		schema: WORK_CONTRACT_SCHEMA,
		version: WORK_CONTRACT_VERSION,
		goals: sourcePlanIds.map((sourcePlanId) => ({ sourcePlanId, statement: unit.goal })),
		changes: resources.map(({ resource, exists }) => exists ? {
			kind: "modify",
			target: { resource, sourcePlanIds },
			intent: unit.goal,
			anchors: resource.kind === "file" ? [{ kind: "stable-text", text: unit.workerPacket.targetAnchors.join("; ") || unit.goal }] : [],
		} : {
			kind: "create",
			target: { resource, sourcePlanIds },
			contentIntent: unit.goal,
		}),
		readDependencies: readResources.map((resource) => ({
			resource,
			timing: dependencyResources.some((candidate) => resourcesOverlap(candidate, resource)) ? "post-change-required" : "baseline-context",
			timingSource: dependencyResources.some((candidate) => resourcesOverlap(candidate, resource)) ? "sequential-fallback" : "phase-b",
			sourcePlanIds,
			reason: `Approved read dependency for ${unit.id}`,
		})),
		forbiddenWrites: [],
		validationCommands: unit.validationCommands.map((command) => ({ executable: shell, args: ["-lc", command] })),
		capabilities: FIXED_WORKER_CAPABILITIES,
		semanticReviewCriteria: sourcePlanIds.flatMap((sourcePlanId) => unit.acceptanceCriteria.map((statement) => ({ sourcePlanId, statement }))),
		advisoryNotes: [{ kind: "context", source: { phase: "compiler", reference: unit.id }, text: "Legacy packet adapter; removed by the coordinated packet-v5 cutover." }],
	};
	const admitted = validateWorkContract(candidate);
	if (!admitted.ok || !admitted.contract) throw new Error(`cannot adapt ${unit.id} to a canonical work contract: ${admitted.errors.map((error) => error.message).join("; ")}`);
	return admitted.contract;
}

function legacyResource(value: string, repoRoot: string): { resource: Resource; exists: boolean } {
	const directory = value.endsWith("/");
	const path = parseRepoPath(directory ? value.slice(0, -1) : value);
	const result = spawnSync("git", ["-c", "core.fsmonitor=false", "cat-file", "-t", `HEAD:${path}`], { cwd: repoRoot, encoding: "utf8" });
	const observedType = result.status === 0 ? result.stdout.trim() : undefined;
	return { resource: { kind: directory || observedType === "tree" ? "directory" : "file", path }, exists: observedType !== undefined };
}
