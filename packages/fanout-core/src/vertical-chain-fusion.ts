import { createHash } from "node:crypto";
import type { FanoutPacketNode } from "./execution-packet.ts";
import { resourceCovers, resourcesOverlap } from "./repository-resource.ts";
import type { ValidationCommand } from "./validation-command.ts";
import { FIXED_WORKER_CAPABILITIES, WORK_CONTRACT_SCHEMA, WORK_CONTRACT_VERSION, contractWriteResources, validateWorkContract, type WorkContract } from "./work-contract.ts";
import { deriveWorkContractGraph, FINAL_VALIDATION_NODE_ID, type WorkContractGraph } from "./work-contract-graph.ts";

export function fuseVerticalSerialChains(initialNodes: readonly FanoutPacketNode[], initialGraph: WorkContractGraph): FanoutPacketNode[] {
	let nodes = initialNodes.map((node) => structuredClone(node));
	let graph = initialGraph;
	const sources = new Map(nodes.map((node) => [node.id, [node.id]]));
	for (;;) {
		const ordinaryEdges = graph.edges.filter(([from, to]) => from !== FINAL_VALIDATION_NODE_ID && to !== FINAL_VALIDATION_NODE_ID);
		const pair = nodes.flatMap((left) => {
			if (left.kind === "final-validation") return [];
			const successors = ordinaryEdges.filter(([from]) => from === left.id).map(([, to]) => to);
			if (successors.length !== 1) return [];
			const right = nodes.find((node) => node.id === successors[0]);
			const predecessors = ordinaryEdges.filter(([, to]) => to === right?.id).map(([from]) => from);
			return right && predecessors.length === 1 && fuseCompatible(left, right) ? [[left, right] as const] : [];
		})[0];
		if (!pair) return nodes;
		const [left, right] = pair;
		const sourceIds = [...sources.get(left.id)!, ...sources.get(right.id)!];
		const fused = fusePair(left, right, sourceIds);
		const indexes = [nodes.findIndex(({ id }) => id === left.id), nodes.findIndex(({ id }) => id === right.id)];
		nodes = nodes.filter(({ id }) => id !== left.id && id !== right.id);
		nodes.splice(Math.min(...indexes), 0, fused);
		sources.delete(left.id);
		sources.delete(right.id);
		sources.set(fused.id, sourceIds);
		const derived = deriveWorkContractGraph(nodes);
		if (!derived.graph) throw new Error(`vertical fusion produced an invalid graph: ${derived.errors.map(({ message }) => message).join("; ")}`);
		graph = derived.graph;
	}
}

function fuseCompatible(left: FanoutPacketNode, right: FanoutPacketNode): boolean {
	if (left.kind !== right.kind || left.active !== right.active || JSON.stringify(left.tier) !== JSON.stringify(right.tier)) return false;
	if (!right.workContract.readDependencies.some((read) => read.timing === "post-change-required" && contractWriteResources(left.workContract).some((write) => resourcesOverlap(write, read.resource)))) return false;
	if (JSON.stringify(resourceClosure(left.workContract)) !== JSON.stringify(resourceClosure(right.workContract))) return false;
	return coveringValidation(left.workContract.validationCommands, right.workContract.validationCommands) !== undefined;
}

function fusePair(left: FanoutPacketNode, right: FanoutPacketNode, sourceIds: readonly string[]): FanoutPacketNode {
	const contract: WorkContract = {
		schema: WORK_CONTRACT_SCHEMA,
		version: WORK_CONTRACT_VERSION,
		goals: exactUnion(left.workContract.goals, right.workContract.goals),
		changes: exactUnion(left.workContract.changes, right.workContract.changes),
		readDependencies: exactUnion(left.workContract.readDependencies, right.workContract.readDependencies),
		forbiddenWrites: exactUnion(left.workContract.forbiddenWrites, right.workContract.forbiddenWrites),
		validationCommands: coveringValidation(left.workContract.validationCommands, right.workContract.validationCommands)!,
		advisoryValidationMode: "fail-fast",
		capabilities: FIXED_WORKER_CAPABILITIES,
		semanticReviewCriteria: exactUnion(left.workContract.semanticReviewCriteria, right.workContract.semanticReviewCriteria),
		advisoryNotes: exactUnion(left.workContract.advisoryNotes, right.workContract.advisoryNotes),
	};
	const validated = validateWorkContract(contract);
	if (!validated.contract) throw new Error(`vertical fusion produced an invalid work contract: ${validated.errors.map(({ message }) => message).join("; ")}`);
	const id = `fused-${createHash("sha256").update(JSON.stringify(sourceIds)).digest("hex").slice(0, 16)}`;
	return { id, kind: left.kind, tier: structuredClone(left.tier), active: left.active, workContract: validated.contract };
}

function resourceClosure(contract: WorkContract): string[] {
	const values = [...contractWriteResources(contract), ...contract.readDependencies.map(({ resource }) => resource)];
	return values
		.filter((candidate, index) => !values.some((authority, other) => other !== index && resourceCovers(authority, candidate) && (authority.kind !== candidate.kind || authority.path !== candidate.path || other < index)))
		.map(({ kind, path }) => `${kind}:${path}`)
		.sort();
}

function coveringValidation(left: readonly ValidationCommand[], right: readonly ValidationCommand[]): ValidationCommand[] | undefined {
	if (containsManifest(left, right)) return structuredClone([...left]);
	if (containsManifest(right, left)) return structuredClone([...right]);
	return undefined;
}

function containsManifest(covering: readonly ValidationCommand[], candidate: readonly ValidationCommand[]): boolean {
	if (candidate.length > covering.length) return false;
	const candidateBytes = candidate.map((command) => JSON.stringify(command));
	for (let start = 0; start <= covering.length - candidate.length; start++) {
		if (candidateBytes.every((bytes, offset) => JSON.stringify(covering[start + offset]) === bytes)) return true;
	}
	return false;
}

function exactUnion<T>(left: readonly T[], right: readonly T[]): T[] {
	const seen = new Set<string>();
	return [...left, ...right].filter((entry) => {
		const key = JSON.stringify(entry);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}).map((entry) => structuredClone(entry));
}
