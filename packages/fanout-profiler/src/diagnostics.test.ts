import { expect, test } from "bun:test";
import type { CatalogSnapshot } from "./catalog";
import { queryDiagnostics } from "./diagnostics";

const source = { id: "events", path: "packet/executions/run/events.jsonl", kind: "execution" as const, byteLength: 1, modifiedAtMs: 1 };
const packetSource = { id: "packet", path: "packet/execution-packet.json", kind: "planning" as const, byteLength: 1, modifiedAtMs: 1 };
const profile = { path: "profiles/default.json", sha256: "a".repeat(64), byteLength: 10 };
const at = (ms: number) => new Date(Date.parse("2026-07-20T00:00:00.000Z") + ms).toISOString();
const event = (sequence: number, occurredMs: number, name: string, payload: Record<string, unknown>) => ({ sequence, occurredAt: at(occurredMs), event: name, payload });
const allocation = (nodeId: string, attemptId: string, sequence: number, kind = "original", sourceAttemptId?: string) => ({
	allocationSequence: sequence,
	completionSequence: null,
	allocation: { nodeId, attemptId, kind, ...(sourceAttemptId ? { sourceAttemptId } : {}) },
	outcome: null,
});

function snapshot(options: { capacity?: number; dependentDelay?: number; busyUntil?: number } = {}): CatalogSnapshot {
	const capacity = options.capacity ?? 2;
	const dependentDelay = options.dependentDelay ?? 100;
	const busyUntil = options.busyUntil ?? 20;
	const attempts = [
		allocation("busy", "busy:000001", 4),
		allocation("root", "root:000001", 7),
		allocation("dependent", "dependent:000001", 10),
	];
	const events = [
		event(1, 0, "run-started", { policy: { maxConcurrency: capacity } }),
		event(2, 1, "preflight-completed", { status: "passed" }),
		event(3, 10, "confirmation-decided", { decision: "accepted" }),
		event(4, 10, "attempt-allocated", { allocation: { nodeId: "busy", attemptId: "busy:000001" } }),
		event(5, busyUntil, "attempt-completed", { outcome: { nodeId: "busy", attemptId: "busy:000001" } }),
		event(6, busyUntil, "node-completed", { nodeId: "busy", status: "succeeded", cause: { attemptId: "busy:000001" } }),
		event(7, 110, "attempt-allocated", { allocation: { nodeId: "root", attemptId: "root:000001" } }),
		event(8, 200, "attempt-completed", { outcome: { nodeId: "root", attemptId: "root:000001" } }),
		event(9, 200, "node-completed", { nodeId: "root", status: "succeeded", cause: { attemptId: "root:000001" } }),
		event(10, 200 + dependentDelay, "attempt-allocated", { allocation: { nodeId: "dependent", attemptId: "dependent:000001" } }),
	];
	return {
		generation: 1,
		refreshedAt: at(1_000),
		selectedExecutionRunId: "packet/executions/run",
		executionRuns: [{ id: "run", selectionId: "packet/executions/run", planningRunId: "packet", admission: "Current", label: "nonterminal", reason: "fixture", createdAt: at(0), updatedAt: at(300), projection: {
			runId: "run", mode: "live", startedAt: at(0), profile, policy: { maxConcurrency: capacity }, confirmation: "accepted",
			nodes: ["busy", "root", "dependent"].map((id) => ({ id, status: "pending" })), attempts,
		} as any, events: events as any, sources: [source] }],
		planningRuns: [], supportingEvidence: [], activePointer: null,
		lineages: [{ id: "packet", admission: "Current", reason: "fixture", planningRun: { sources: [packetSource] }, packet: {} as any, graph: { nodes: ["busy", "root", "dependent"], edges: [["root", "dependent"]], topologicalOrder: ["busy", "root", "dependent"], parallelGroups: [["busy", "root"], ["dependent"]], criticalPath: ["root", "dependent"] }, executionRuns: [] }],
	} as unknown as CatalogSnapshot;
}

test("ready-work observation uses confirmation for roots, predecessor completion for dependencies, and the inclusive free-capacity threshold", () => {
	const atThreshold = queryDiagnostics(snapshot(), { sort: "chronology" });
	expect(atThreshold.observations.filter(({ rule }) => rule === "ready-work-waited-with-free-capacity")).toEqual([
		expect.objectContaining({ subjectId: "root", durationMs: 100, chronologyMs: 10, frequency: 1, costUsd: null }),
		expect.objectContaining({ subjectId: "dependent", durationMs: 100, chronologyMs: 200, frequency: 1, costUsd: null }),
	]);
	expect(atThreshold.observations[0]).toMatchObject({
		evidence: { readiness: { kind: "accepted-confirmation", eventSequence: 3 }, firstAllocationEventSequence: 7, capacity: { maxConcurrency: 2 } },
		receipt: { evidenceClass: "Derived", artifactGeneration: "Event v6 / Projection v7", profileIdentity: profile, sourceReferences: [packetSource, source] },
	});
	expect(atThreshold.observations[1]).toMatchObject({ evidence: { readiness: { kind: "successful-predecessors", predecessorNodeIds: ["root"], eventSequences: [9] } } });

	const below = queryDiagnostics(snapshot({ dependentDelay: 99 }), {});
	expect(below.observations.some(({ subjectId }) => subjectId === "dependent")).toBe(false);
	expect(below.suppressions).toContainEqual(expect.objectContaining({ subjectId: "dependent", reason: "Recorded free-capacity overlap was 99 ms, below the inclusive 100 ms threshold." }));
});

test("waiting without recorded free Fanout capacity is suppressed", () => {
	const result = queryDiagnostics(snapshot({ capacity: 1, busyUntil: 110 }), {});
	expect(result.observations.some(({ subjectId }) => subjectId === "root")).toBe(false);
	expect(result.suppressions).toContainEqual(expect.objectContaining({ subjectId: "root", reason: "Recorded free-capacity overlap was 0 ms, below the inclusive 100 ms threshold." }));
});

test("failed Nodes release their recorded Fanout capacity", () => {
	const state = snapshot({ capacity: 1, busyUntil: 20 });
	const run = state.executionRuns[0]!;
	(run.events.find(({ sequence }) => sequence === 6)!.payload as any).status = "failed";
	(run.events.find(({ sequence }) => sequence === 7) as any).occurredAt = at(120);
	expect(queryDiagnostics(state, {}).observations).toContainEqual(expect.objectContaining({ subjectId: "root", durationMs: 100 }));
});

test("a non-accepted Attempt is replaced only by a later admitted causal recovery allocation", () => {
	const state = snapshot();
	const run = state.executionRuns[0]!;
	(run.projection!.attempts as any[]).push(
		{
			...allocation("repair", "repair:000001", 11), completionSequence: 12,
			outcome: { attemptId: "repair:000001", nodeId: "repair", action: "validation-repair", durationMs: 40, metrics: { complete: true, turns: [{ costUsd: 0.25 }] } },
		},
		allocation("repair", "repair:000002", 13, "validation-repair", "repair:000001"),
		{
			...allocation("orphan", "orphan:000001", 14), completionSequence: 15,
			outcome: { attemptId: "orphan:000001", nodeId: "orphan", action: "retry", durationMs: 30, metrics: { complete: true, turns: [{ costUsd: 0.1 }] } },
		},
	);
	(run.events as any[]).push(
		event(11, 310, "attempt-allocated", { allocation: { nodeId: "repair", attemptId: "repair:000001" } }),
		event(12, 350, "attempt-completed", { outcome: { nodeId: "repair", attemptId: "repair:000001" } }),
		event(13, 360, "attempt-allocated", { allocation: { nodeId: "repair", attemptId: "repair:000002", kind: "validation-repair", sourceAttemptId: "repair:000001" } }),
		event(14, 370, "attempt-allocated", { allocation: { nodeId: "orphan", attemptId: "orphan:000001" } }),
		event(15, 400, "attempt-completed", { outcome: { nodeId: "orphan", attemptId: "orphan:000001" } }),
	);

	const result = queryDiagnostics(state, { sort: "cost" });
	const replacement = result.observations.find(({ rule }) => rule === "attempt-causally-replaced");
	expect(result.observations[0]?.subjectId).toBe("repair:000001");
	expect(queryDiagnostics(state, { sort: "duration" }).observations[0]?.durationMs).toBe(100);
	expect(queryDiagnostics(state, { sort: "frequency" }).observations.map(({ chronologyMs }) => chronologyMs)).toEqual([10, 200, 360]);
	expect(replacement).toMatchObject({ subjectId: "repair:000001", relatedId: "repair:000002", durationMs: 40, costUsd: 0.25, frequency: 1, chronologyMs: 360 });
	expect(replacement.receipt).toMatchObject({ evidenceClass: "Derived", sourceReferences: [packetSource, source] });
	expect(result.suppressions).toContainEqual(expect.objectContaining({
		rule: "attempt-causally-replaced", subjectId: "orphan:000001",
		reason: "Attempt orphan:000001 recorded retry intent, but no later admitted retry allocation names it as source.",
	}));
	expect(Object.keys(replacement)).not.toEqual(expect.arrayContaining(["severity", "confidence", "remedy", "rootCause", "globalRank"]));
	const partialMetrics = ((run.projection!.attempts as any[]).find(({ allocation: item }) => item.attemptId === "repair:000001").outcome.metrics as any);
	partialMetrics.complete = false;
	partialMetrics.turns[0].costUsd = undefined;
	const incomplete = queryDiagnostics(state, {});
	expect(incomplete.observations.find(({ subjectId }) => subjectId === "repair:000001")).toMatchObject({
		costUsd: null, costStatus: "partial", receipt: { evidenceClass: "Partial", missingInputs: ["complete Attempt usage and cost telemetry"] },
	});
	expect(incomplete.suppressions.some(({ subjectId }) => subjectId === "repair:000001")).toBe(false);
});

test("unavailable evidence emits no observations and exposes one reason per rule", () => {
	const state = snapshot();
	(state.executionRuns[0] as any).admission = "Unverifiable";
	(state.executionRuns[0] as any).projection = null;
	const result = queryDiagnostics(state, {});
	expect(result.observations).toEqual([]);
	expect(result.suppressions).toEqual([
		expect.objectContaining({ rule: "ready-work-waited-with-free-capacity", reason: expect.stringContaining("Unverifiable") }),
		expect.objectContaining({ rule: "attempt-causally-replaced", reason: expect.stringContaining("Unverifiable") }),
	]);
	const missingConfirmation = snapshot();
	(missingConfirmation.executionRuns[0] as any).events = missingConfirmation.executionRuns[0]!.events.filter(({ event: name }) => name !== "confirmation-decided");
	expect(queryDiagnostics(missingConfirmation, {}).suppressions.filter(({ rule }) => rule === "ready-work-waited-with-free-capacity").every(({ reason }) => reason === "Accepted confirmation evidence is unavailable.")).toBe(true);
});
