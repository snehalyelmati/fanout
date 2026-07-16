import { contractWriteResources, type WorkContractNode } from "./work-contract.ts";
import { deriveWorkContractGraph, type WorkContractGraph } from "./work-contract-graph.ts";

export interface WorkContractPacketContext {
	objective: string;
	userContext: string[];
	discoveredRepoFacts: string[];
	assumptions: string[];
}

export function renderWorkContractMermaid(nodes: readonly WorkContractNode[]): string {
	const graph = requireGraph(nodes);
	const aliases = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
	const lines = ["flowchart TD"];
	for (const node of nodes) lines.push(`  ${aliases.get(node.id)}["${escapeMermaid(node.id)}: ${escapeMermaid(node.workContract.goals.map((goal) => goal.statement).join("; "))}"]`);
	for (const [from, to] of graph.edges) lines.push(`  ${aliases.get(from)} --> ${aliases.get(to)}`);
	return `${lines.join("\n")}\n`;
}

export function renderWorkContractMarkdown(context: WorkContractPacketContext, nodes: readonly WorkContractNode[]): string {
	const graph = requireGraph(nodes);
	return `# Fanout Execution Plan\n\nObjective: ${context.objective}\n\n## Work contracts\n\n${nodes.map((node) => `### ${node.id}\n\n\`\`\`json\n${JSON.stringify(node.workContract, null, 2)}\n\`\`\``).join("\n\n")}\n\n## Derived graph\n\n- order: ${graph.topologicalOrder.join(" -> ")}\n- parallel groups: ${graph.parallelGroups.map((group) => `[${group.join(", ")}]`).join(" ")}\n- critical path: ${graph.criticalPath.join(" -> ")}\n\n## Context\n\n- user: ${context.userContext.join("; ") || "none"}\n- repo: ${context.discoveredRepoFacts.join("; ") || "none"}\n- assumptions: ${context.assumptions.join("; ") || "none"}\n`;
}

export function renderWorkContractLaunchSummary(context: Pick<WorkContractPacketContext, "objective">, nodes: readonly WorkContractNode[]): string {
	requireGraph(nodes);
	const writes = unique(nodes.flatMap((node) => contractWriteResources(node.workContract)).map((resource) => `${resource.kind}:${resource.path}`));
	const normalizationCommandCount = nodes.reduce((count, node) => count + node.workContract.candidateNormalizationCommands.length, 0);
	const commandCount = nodes.reduce((count, node) => count + node.workContract.validationCommands.length, 0);
	return [`Objective: ${context.objective}`, `Work nodes: ${nodes.length}`, `Typed write resources: ${writes.join(", ") || "none"}`, `Candidate normalization commands: ${normalizationCommandCount}`, `Validation commands: ${commandCount}`].join("\n");
}

function requireGraph(nodes: readonly WorkContractNode[]): WorkContractGraph { const result = deriveWorkContractGraph(nodes); if (!result.graph) throw new Error(result.errors.map((issue) => issue.message).join("; ")); return result.graph; }
function escapeMermaid(value: string): string { return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r?\n/g, " "); }
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
