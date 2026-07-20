import { expect, test } from "bun:test";
import { resolveExecutionEvidence, type ExecutionRunProjection } from "../../fanout-core/src/execution-projection";
import type { CatalogSnapshot } from "./catalog";
import { queryWorkspace } from "./workspace";

const source = { id: "source-7-1", path: "packet/executions/run-1/events.jsonl", kind: "execution" as const, byteLength: 123, modifiedAtMs: 1 };
const packetSource = { id: "source-7-2", path: "packet/execution-packet.json", kind: "planning" as const, byteLength: 456, modifiedAtMs: 1 };
const packet = {
	version: 6,
	objective: "Keep <script>alert('no')</script> as evidence text",
	nodes: [
		{ id: "work", kind: "implement", tier: { preferred: "tier2", assigned: "tier2", fallback: "tier1", provider: "planned-provider", model: "planned-model", thinking: "off", reason: "approved background worker" }, workContract: { goals: [{ statement: "Do work" }] } },
		{ id: "final-validation", kind: "final-validation", tier: { preferred: "tier1", assigned: "tier1", fallback: "tier1", provider: "validator", model: "control", thinking: "off", reason: "controller tier" }, workContract: { goals: [{ statement: "Validate" }] } },
	],
};
const projection = {
	runId: "run-1", startedAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:01.000Z", finishedAt: "2026-07-20T00:00:01.000Z",
	terminalOutcome: { outcome: "completed", durationMs: 1_000 }, mode: "live", finalValidation: { disposition: "passed", durationMs: 100 },
	nodes: [{ id: "work", status: "succeeded", attemptIds: ["work:000001"] }],
	attempts: [{
		allocationSequence: 4, completionSequence: 5,
		allocation: { nodeId: "work", attemptId: "work:000001", kind: "original", assignment: { tier: "tier1", provider: "observed-provider", model: "observed-model" } },
		outcome: {
			attemptId: "work:000001", nodeId: "work", kind: "original", startedAt: "2026-07-20T00:00:00.100Z", finishedAt: "2026-07-20T00:00:00.900Z", durationMs: 800,
			action: "accept", terminalFact: { stage: "apply", code: "applied" }, evidenceRefs: ["attempt-outcome.json"],
			metrics: {
				compatibility: "generic", complete: true, workerDurationMs: 700,
				turns: [{ turnId: "turn-1", requestedAt: "2026-07-20T00:00:00.200Z", firstOutputAt: "2026-07-20T00:00:00.300Z", finishedAt: "2026-07-20T00:00:00.800Z", durationMs: 600, provider: "observed-provider", model: "observed-model", tier: "tier1", inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 5, costUsd: 0.1, pricingSource: "fixture", responseIds: [], toolCallIds: ["tool-1"] }],
				responses: [], polls: [{ pollId: "poll-1", turnId: "turn-1", durationMs: 25, status: "completed" }],
				tools: [{ toolCallId: "tool-1", turnId: "turn-1", name: "<b>read</b>", startedAt: "2026-07-20T00:00:00.400Z", finishedAt: "2026-07-20T00:00:00.450Z", durationMs: 50 }],
			},
		},
	}],
};
const events = [
	{ sequence: 1, occurredAt: "2026-07-20T00:00:00.000Z", event: "run-started", payload: {} },
	{ sequence: 4, occurredAt: "2026-07-20T00:00:00.100Z", event: "attempt-allocated", payload: { allocation: { nodeId: "work", attemptId: "work:000001" } } },
	{ sequence: 5, occurredAt: "2026-07-20T00:00:00.900Z", event: "attempt-completed", payload: { outcome: { nodeId: "work", attemptId: "work:000001" } } },
	{ sequence: 6, occurredAt: "2026-07-20T00:00:00.901Z", event: "node-completed", payload: { nodeId: "work", cause: { attemptId: "work:000001" } } },
];
const snapshot = {
	generation: 7, refreshedAt: "2026-07-20T00:01:00.000Z", selectedExecutionRunId: "packet/executions/run-1",
	executionRuns: [{ id: "run-1", selectionId: "packet/executions/run-1", planningRunId: "packet", admission: "Current", label: "completed", reason: "authoritative", createdAt: projection.startedAt, updatedAt: projection.updatedAt, projection, events, sources: [source] }],
	lineages: [{ id: "packet", admission: "Current", reason: "authoritative", planningRun: { objective: packet.objective, sources: [packetSource] }, packet, graph: { nodes: ["work", "final-validation"], edges: [["work", "final-validation"]], topologicalOrder: ["work", "final-validation"], parallelGroups: [["work"], ["final-validation"]], criticalPath: ["work", "final-validation"] }, executionRuns: [] }],
	planningRuns: [], supportingEvidence: [], activePointer: null,
} as unknown as CatalogSnapshot;

test("linked workspace keeps run, node, Attempt, Turn, Tool, Event, and Stage views in one scope", () => {
	const node = queryWorkspace(snapshot, { runId: "packet/executions/run-1", selection: { kind: "node", id: "work" }, sort: "duration" });
	expect(node.breadcrumbs.map(({ kind }) => kind)).toEqual(["run", "node"]);
	expect(node.dag.nodes.find(({ id }) => id === "work")?.selected).toBe(true);
	expect(node.dag.nodes.find(({ id }) => id === "final-validation")?.status).toBe("passed");
	expect(node.events.map(({ sequence }) => sequence)).toEqual([4, 5, 6]);
	expect(node.ledger.every(({ nodeId }) => nodeId === "work")).toBe(true);
	expect(node.routing).toEqual([{ nodeId: "work", planned: { tier: "tier2", provider: "planned-provider", model: "planned-model" }, observed: [{ attemptId: "work:000001", tier: "tier1", provider: "observed-provider", model: "observed-model" }] }]);
	expect(node.metrics.some(({ id }) => id === "run-duration")).toBe(false);
	expect(node.inspector.receipt.sourceReferences).toEqual([packetSource, source]);
	const attempt = queryWorkspace(snapshot, { selection: { kind: "attempt", id: "work:000001" } });
	expect(attempt.inspector.relatedSelections).toEqual([{ label: "Stage Fact", selection: { kind: "stage", id: "work:000001" } }]);

	const tool = queryWorkspace(snapshot, { selection: { kind: "tool", id: "tool-1" } });
	expect(tool.breadcrumbs.map(({ kind }) => kind)).toEqual(["run", "node", "attempt", "turn", "tool"]);
	expect(tool.ledger.map((row) => ({ id: row.id, startMs: row.startMs, durationMs: row.durationMs }))).toEqual([{ id: "tool:tool-1", startMs: 400, durationMs: 50 }]);
	expect(tool.inspector.title).toBe("<b>read</b>");
	expect(tool.inspector.receipt.sourceReferences).toEqual([packetSource, source]);

	const event = queryWorkspace(snapshot, { selection: { kind: "event", id: "5" } });
	expect(event.events).toHaveLength(1);
	expect(event.breadcrumbs.at(-1)).toMatchObject({ kind: "event", id: "5" });
	expect(event.inspector.fields).toContainEqual(["outcome", JSON.stringify({ nodeId: "work", attemptId: "work:000001" })]);
	const causalEvent = queryWorkspace(snapshot, { selection: { kind: "event", id: "6" } });
	expect(causalEvent.breadcrumbs.map(({ kind }) => kind)).toEqual(["run", "node", "attempt", "event"]);
	const stage = queryWorkspace(snapshot, { selection: { kind: "stage", id: "work:000001" } });
	expect(stage.inspector.fields).toContainEqual(["Controller action", "accept"]);
	expect(stage.inspector.fields).toContainEqual(["Stage Fact", "apply/applied"]);
	expect(stage.waterfall).toContainEqual(expect.objectContaining({ id: "stage:work:000001", depth: 3, kind: "stage" }));
	const finalValidation = queryWorkspace(snapshot, { selection: { kind: "node", id: "final-validation" } });
	expect(finalValidation.inspector.fields).toContainEqual(["Observed state", "passed"]);
});

test("timing views distinguish boundaries, overlapping measured work, unavailable placement, and unknown values", () => {
	const workspace = queryWorkspace(snapshot, {});
	expect(workspace.metrics.find(({ id }) => id === "run-duration")).toMatchObject({ value: 1_000, category: "wall-clock-boundary", evidenceClass: "Observed" });
	expect(workspace.metrics.find(({ id }) => id === "worker-duration")).toMatchObject({ value: 700, category: "overlapping-measured-work" });
	expect(workspace.metrics.find(({ id }) => id === "worker-duration")).toMatchObject({ evidenceClass: "Derived", receipt: { evidenceClass: "Derived" } });
	expect(workspace.metrics.find(({ id }) => id === "provider-duration")).toMatchObject({ value: null, evidenceClass: "Unavailable" });
	expect(workspace.metrics.every(({ receipt }) => receipt.artifactGeneration === "Event v3 / Projection v4")).toBe(true);
	expect(workspace.ledger.find(({ id }) => id === "poll:poll-1")).toMatchObject({ startMs: null, endMs: null, durationMs: 25, placement: "unavailable" });
	expect(workspace.inspector.receipt).toMatchObject({ evidenceClass: "Observed", derivation: expect.any(String), missingInputs: expect.any(Array), assumptions: expect.any(Array), limitations: expect.any(Array) });
	expect(workspace.objective).toContain("<script>");
	expect(workspace.waterfall.find(({ id }) => id === "node:work")).toMatchObject({ parentId: "run:packet/executions/run-1", depth: 1, kind: "node" });
	expect(workspace.waterfall.find(({ id }) => id === "attempt:work:000001")).toMatchObject({ parentId: "node:work", depth: 2 });
	expect(workspace.waterfall.find(({ id }) => id === "tool:tool-1")?.depth).toBe(4);
	const turn = queryWorkspace(snapshot, { selection: { kind: "turn", id: "turn-1" } });
	expect(turn.metrics.find(({ id }) => id === "tokens")).toMatchObject({ value: 5, evidenceClass: "Derived" });
	const tool = queryWorkspace(snapshot, { selection: { kind: "tool", id: "tool-1" } });
	expect(tool.metrics.find(({ id }) => id === "tool-duration")).toMatchObject({ value: 50, evidenceClass: "Derived" });
	expect(tool.metrics.find(({ id }) => id === "tokens")).toMatchObject({ value: null, evidenceClass: "Unavailable" });
});

test("fanout-core resolves already-correlated evidence identities once", () => {
	const context = resolveExecutionEvidence(projection as unknown as ExecutionRunProjection, { toolCallId: "tool-1" });
	expect({ node: context.node.id, attempt: context.attempt?.allocation.attemptId, turn: context.turn?.turnId, tool: context.tool?.toolCallId }).toEqual({ node: "work", attempt: "work:000001", turn: "turn-1", tool: "tool-1" });
	expect(() => resolveExecutionEvidence(projection as unknown as ExecutionRunProjection, { nodeId: "other", attemptId: "work:000001" })).toThrow("contradictory Node");
});

test("non-current workspace receipts do not claim the current generation", () => {
	const legacyRun = { ...snapshot.executionRuns[0]!, admission: "Legacy" as const, label: "Legacy", projection: null, events: [] };
	const legacy = {
		...snapshot,
		executionRuns: [legacyRun],
	} as unknown as CatalogSnapshot;
	const workspace = queryWorkspace(legacy, {});
	expect(workspace.inspector.receipt).toMatchObject({ evidenceClass: "Legacy", artifactGeneration: "Legacy execution generation" });
});

test("planning-only Workflow Lineages are openable without invented execution state", () => {
	const planning = {
		generation: 3, refreshedAt: "2026-07-20T00:00:00.000Z", selectedExecutionRunId: null,
		executionRuns: [], supportingEvidence: [], activePointer: null,
		planningRuns: [{ id: "planning-only", admission: "Planning-only", reason: "Planning Run has no Execution Packet or Execution Run", createdAt: "2026-07-20T00:00:00.000Z", objective: "Plan safely", plan: {}, details: null, packet: null, graph: null, sources: [packetSource] }],
		lineages: [{ id: "planning-only", admission: "Planning-only", reason: "Planning Run has no Execution Packet or Execution Run", planningRun: { objective: "Plan safely", plan: {}, details: null, sources: [packetSource] }, packet: null, graph: null, executionRuns: [] }],
	} as unknown as CatalogSnapshot;
	const workspace = queryWorkspace(planning, { selection: { kind: "lineage", id: "planning-only" } });
	expect(workspace.selection).toEqual({ kind: "lineage", id: "planning-only" });
	expect(workspace.objective).toBe("Plan safely");
	expect(workspace.recentLineages).toEqual([expect.objectContaining({ id: "planning-only", admission: "Planning-only", selected: true })]);
	expect(workspace.dag.nodes).toEqual([]);
	expect(workspace.events).toEqual([]);
	expect(workspace.metrics).toEqual([]);
	expect(workspace.inspector).toMatchObject({ kind: "Workflow Lineage", fields: [["Admission", "Planning-only"], ["Execution state", "Unavailable — no admitted Execution Run"]], receipt: { evidenceClass: "Partial", sourceReferences: [packetSource] } });
	expect(workspace.inspector.receipt.artifactGeneration).toBe("Planning v2");

	const currentLineage = queryWorkspace(snapshot, { selection: { kind: "lineage", id: "packet" } });
	expect(currentLineage.inspector.fields).toContainEqual(["Execution state", "1 admitted Execution Run available; none selected"]);
	expect(currentLineage.inspector.receipt).toMatchObject({ artifactGeneration: "Planning v2 / Details v4 / Packet v6", missingInputs: ["selected Execution Run"] });
});
