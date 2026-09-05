import { resourceOwnerIndexes, resourcesOverlap } from "./repository-resource.ts";
import { contractWriteResources, validateWorkContract, type WorkContractIssue, type WorkContractNode } from "./work-contract.ts";

export interface WorkContractGraph {
	nodes: string[];
	edges: Array<[string, string]>;
	topologicalOrder: string[];
	parallelGroups: string[][];
	criticalPath: string[];
}

export const FINAL_VALIDATION_NODE_ID = "final-validation";

export function validateWorkContractNodes(value: unknown): { ok: boolean; errors: WorkContractIssue[]; nodes?: WorkContractNode[]; graph?: WorkContractGraph } {
	const errors: WorkContractIssue[] = [];
	if (!Array.isArray(value)) return { ok: false, errors: [{ code: "invalid-node-list", message: "work-contract nodes must be an array", path: "nodes" }] };
	const nodes = value.flatMap((node, index) => {
		const path = `nodes[${index}]`;
		if (!isRecord(node)) { add(errors, "invalid-node", "node must be an object", path); return []; }
		for (const field of Object.keys(node)) if (!["id", "kind", "workContract"].includes(field)) add(errors, "unknown-field", `unknown field ${field}`, `${path}.${field}`);
		const id = canonical(node.id, `${path}.id`, errors);
		const kind = canonical(node.kind, `${path}.kind`, errors);
		const validation = validateWorkContract(node.workContract, { finalValidation: kind === "final-validation", allowEmptyValidation: kind === "final-validation" });
		for (const issue of validation.errors) errors.push({ ...issue, path: issue.path ? `${path}.workContract.${issue.path}` : `${path}.workContract` });
		return validation.contract ? [{ id, kind, workContract: validation.contract }] : [];
	});
	if (errors.length) return { ok: false, errors };
	const derived = deriveWorkContractGraph(nodes);
	return derived.graph ? { ok: true, errors: [], nodes, graph: derived.graph } : { ok: false, errors: derived.errors, nodes };
}

export function deriveWorkContractWarnings(nodes: readonly WorkContractNode[]): WorkContractIssue[] {
	return nodes.flatMap((node) => node.workContract.readDependencies.flatMap((read, index) => read.timingSource === "sequential-fallback"
		? [{ code: "sequential-fallback", message: `${node.id} conservatively waits for ${read.resource.kind}:${read.resource.path}: ${read.reason}`, path: `nodes.${node.id}.workContract.readDependencies[${index}]` }]
		: []));
}

export function deriveWorkContractGraph(nodes: readonly WorkContractNode[]): { graph?: WorkContractGraph; errors: WorkContractIssue[] } {
	const errors: WorkContractIssue[] = [];
	const ids = new Set<string>();
	for (const [index, node] of nodes.entries()) {
		if (!canonicalValue(node.id)) add(errors, "invalid-node-id", "node id must be a non-empty canonical string", `nodes[${index}].id`);
		else if (ids.has(node.id)) add(errors, "duplicate-node-id", `duplicate node id ${node.id}`, `nodes[${index}].id`);
		else ids.add(node.id);
		if (node.kind === "final-validation" && node.id !== FINAL_VALIDATION_NODE_ID) add(errors, "invalid-final-validation-id", `final-validation node must use reserved id ${FINAL_VALIDATION_NODE_ID}`, `nodes[${index}].id`);
		if (node.kind !== "final-validation" && node.id === FINAL_VALIDATION_NODE_ID) add(errors, "reserved-node-id", `ordinary node cannot use reserved id ${FINAL_VALIDATION_NODE_ID}`, `nodes[${index}].id`);
		const validation = validateWorkContract(node.workContract, { finalValidation: node.kind === "final-validation", allowEmptyValidation: node.kind === "final-validation" });
		for (const issue of validation.errors) errors.push({ ...issue, path: issue.path ? `nodes.${node.id}.workContract.${issue.path}` : `nodes.${node.id}.workContract` });
	}
	const finals = nodes.filter((node) => node.kind === "final-validation");
	if (finals.length !== 1) add(errors, "final-validation-count", "exactly one final-validation node is required", "nodes");
	const ordinary = nodes.filter((node) => node.kind !== "final-validation");
	for (let left = 0; left < ordinary.length; left++) for (let right = left + 1; right < ordinary.length; right++) {
		if (contractWriteResources(ordinary[left].workContract).some((a) => contractWriteResources(ordinary[right].workContract).some((b) => resourcesOverlap(a, b)))) add(errors, "ownership-overlap", `${ordinary[left].id} and ${ordinary[right].id} have overlapping typed changes`, "nodes");
	}
	const edges: Array<[string, string]> = [];
	const edgeKeys = new Set<string>();
	for (const reader of ordinary) for (const [index, read] of reader.workContract.readDependencies.entries()) {
		if (read.timing === "baseline-context") continue;
		const owners = resourceOwnerIndexes(read.resource, ordinary.map((owner) => contractWriteResources(owner.workContract))).map((index) => ordinary[index]);
		if (owners.length === 0) add(errors, "ownerless-post-change-read", `${reader.id} post-change read ${read.resource.kind}:${read.resource.path} has no owner`, `nodes.${reader.id}.workContract.readDependencies[${index}]`);
		for (const owner of owners) if (owner.id !== reader.id) pushEdge(edges, edgeKeys, owner.id, reader.id);
	}
	if (finals.length === 1) for (const node of ordinary) pushEdge(edges, edgeKeys, node.id, finals[0].id);
	if (errors.length) return { errors };
	const graph = graphFromEdges(nodes.map((node) => node.id), edges);
	if (graph.topologicalOrder.length !== nodes.length) add(errors, "cycle", "derived work-contract graph contains a cycle", "nodes");
	return errors.length ? { errors } : { graph, errors };
}

function graphFromEdges(nodes: string[], edges: Array<[string, string]>): WorkContractGraph {
	const outgoing = new Map(nodes.map((node) => [node, [] as string[]]));
	const indegree = new Map(nodes.map((node) => [node, 0]));
	for (const [from, to] of edges) { outgoing.get(from)?.push(to); indegree.set(to, (indegree.get(to) ?? 0) + 1); }
	let ready = nodes.filter((node) => indegree.get(node) === 0);
	const order: string[] = []; const groups: string[][] = []; const depth = new Map(nodes.map((node) => [node, 1]));
	while (ready.length) {
		const group = ready; groups.push(group); ready = [];
		for (const node of group) { order.push(node); for (const next of outgoing.get(node) ?? []) { depth.set(next, Math.max(depth.get(next) ?? 1, (depth.get(node) ?? 1) + 1)); indegree.set(next, (indegree.get(next) ?? 1) - 1); if (indegree.get(next) === 0) ready.push(next); } }
	}
	let tail = order.reduce((best, node) => (depth.get(node) ?? 0) > (depth.get(best) ?? 0) ? node : best, order[0]); const criticalPath: string[] = [];
	while (tail) { criticalPath.unshift(tail); const predecessor = edges.find(([from, to]) => to === tail && (depth.get(from) ?? 0) === (depth.get(tail) ?? 0) - 1)?.[0]; if (!predecessor) break; tail = predecessor; }
	return { nodes, edges, topologicalOrder: order, parallelGroups: groups, criticalPath };
}

function pushEdge(edges: Array<[string, string]>, keys: Set<string>, from: string, to: string): void { const key = `${from}\0${to}`; if (!keys.has(key)) { keys.add(key); edges.push([from, to]); } }
function canonical(value: unknown, path: string, errors: WorkContractIssue[]): string { if (!canonicalValue(value)) { add(errors, "invalid-canonical-text", "value must be a non-empty canonical string", path); return "invalid"; } return value; }
function canonicalValue(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value === value.trim() && !/\p{Cc}/u.test(value); }
function add(errors: WorkContractIssue[], code: string, message: string, path?: string): void { errors.push({ code, message, ...(path ? { path } : {}) }); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
