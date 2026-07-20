import { expect, test } from "bun:test";
import type { CatalogSnapshot } from "./catalog";
import { queryScenario } from "./scenario";

const origin = Date.parse("2026-07-20T00:00:00.000Z");
const at = (ms: number) => new Date(origin + ms).toISOString();
const source = (id: string, path: string, kind: "planning" | "execution") => ({ id, path, kind, byteLength: 1, modifiedAtMs: 1 });

function fixture(): CatalogSnapshot {
	const attempt = (nodeId: string, attemptId: string, allocationSequence: number, completionSequence: number, start: number, end: number, action = "accept", kind = "original", sourceAttemptId?: string) => ({
		allocationSequence, completionSequence,
		allocation: { nodeId, attemptId, attemptNumber: sourceAttemptId ? 2 : 1, kind, ...(sourceAttemptId ? { sourceAttemptId } : {}), assignment: { tier: "tier2" } },
		outcome: {
			nodeId, attemptId, action, startedAt: at(start), finishedAt: at(end), durationMs: end - start,
			terminalFact: { stage: "apply", code: action === "accept" ? "applied" : "failed" },
			metrics: {
				complete: true,
				turns: [{ turnId: `${attemptId}:turn`, requestedAt: at(start + 5), finishedAt: at(end - 5), durationMs: end - start - 10, costUsd: 0.1 }],
				responses: [], polls: [],
				tools: [{ turnId: `${attemptId}:turn`, toolCallId: `${attemptId}:tool`, name: "edit", startedAt: at(start + 20), finishedAt: at(start + 30), durationMs: 10 }],
			},
		},
	});
	const attempts = [
		attempt("a", "a:1", 4, 6, 0, 100),
		attempt("b", "b:1", 5, 8, 0, 100),
		attempt("c", "c:1", 10, 11, 100, 120, "validation-repair"),
		attempt("c", "c:2", 12, 13, 120, 140, "accept", "validation-repair", "c:1"),
	];
	(attempts[1]!.outcome as any).finishedAt = at(50);
	(attempts[1]!.outcome as any).durationMs = 50;
	(attempts[1]!.outcome.metrics.turns[0] as any).finishedAt = at(45);
	(attempts[1]!.outcome.metrics.turns[0] as any).durationMs = 40;
	const events = [
		{ sequence: 1, occurredAt: at(-40), event: "run-started", payload: { policy: { maxConcurrency: 2 } } },
		{ sequence: 2, occurredAt: at(-30), event: "preflight-completed", payload: { status: "passed" } },
		{ sequence: 3, occurredAt: at(0), event: "confirmation-decided", payload: { decision: "accepted" } },
		{ sequence: 4, occurredAt: at(0), event: "attempt-allocated", payload: { allocation: { nodeId: "a", attemptId: "a:1" } } },
		{ sequence: 5, occurredAt: at(0), event: "attempt-allocated", payload: { allocation: { nodeId: "b", attemptId: "b:1" } } },
		{ sequence: 6, occurredAt: at(100), event: "attempt-completed", payload: { outcome: { nodeId: "a", attemptId: "a:1" } } },
		{ sequence: 7, occurredAt: at(100), event: "node-completed", payload: { nodeId: "a", status: "succeeded", cause: { attemptId: "a:1" } } },
		{ sequence: 8, occurredAt: at(100), event: "attempt-completed", payload: { outcome: { nodeId: "b", attemptId: "b:1" } } },
		{ sequence: 9, occurredAt: at(100), event: "node-completed", payload: { nodeId: "b", status: "succeeded", cause: { attemptId: "b:1" } } },
		{ sequence: 10, occurredAt: at(100), event: "attempt-allocated", payload: { allocation: { nodeId: "c", attemptId: "c:1" } } },
		{ sequence: 11, occurredAt: at(120), event: "attempt-completed", payload: { outcome: { nodeId: "c", attemptId: "c:1" } } },
		{ sequence: 12, occurredAt: at(120), event: "attempt-allocated", payload: { allocation: { nodeId: "c", attemptId: "c:2", kind: "validation-repair", sourceAttemptId: "c:1" } } },
		{ sequence: 13, occurredAt: at(140), event: "attempt-completed", payload: { outcome: { nodeId: "c", attemptId: "c:2" } } },
		{ sequence: 14, occurredAt: at(140), event: "node-completed", payload: { nodeId: "c", status: "succeeded", cause: { attemptId: "c:2" } } },
		{ sequence: 15, occurredAt: at(140), event: "final-validation-started", payload: {} },
		{ sequence: 16, occurredAt: at(155), event: "final-validation-completed", payload: { status: "passed" } },
		{ sequence: 17, occurredAt: at(160), event: "run-finished", payload: { outcome: "completed" } },
	];
	const packetSource = source("packet", "planning/execution-packet.json", "planning");
	const eventSource = source("events", "planning/executions/run/events.jsonl", "execution");
	const projection = {
		runId: "run", lastEventSequence: 17, mode: "live", startedAt: at(-40), updatedAt: at(160), finishedAt: at(160), policy: { maxConcurrency: 2 }, confirmation: "accepted", confirmationEventSequence: 3,
		terminalOutcome: { outcome: "completed", durationMs: 200 },
		nodes: [
			{ id: "a", status: "succeeded", completionSequence: 7, attemptIds: ["a:1"] },
			{ id: "b", status: "succeeded", completionSequence: 9, attemptIds: ["b:1"] },
			{ id: "c", status: "succeeded", completionSequence: 14, attemptIds: ["c:1", "c:2"] },
		],
		attempts,
		acceptedLedger: [
			{ eventSequence: 6, attemptId: "a:1", transition: { patch: { artifact: { sha256: "a" }, baseTree: "0", resultTree: "1" } } },
			{ eventSequence: 8, attemptId: "b:1", transition: { patch: { artifact: { sha256: "b" }, baseTree: "1", resultTree: "2" } } },
			{ eventSequence: 13, attemptId: "c:2", transition: { patch: { artifact: { sha256: "c" }, baseTree: "2", resultTree: "3" } } },
		],
		finalValidation: { disposition: "passed", durationMs: 15 }, totals: { estimatedCostUsd: 0.3 },
	};
	const run = { id: "run", selectionId: "planning/executions/run", planningRunId: "planning", admission: "Current", label: "completed", reason: "fixture", createdAt: at(-40), updatedAt: at(160), projection, events, sources: [eventSource] };
	const packet = { runtimePolicy: { maxConcurrency: 2 }, nodes: ["a", "b", "c"].map((id) => ({ id, kind: "implement" })), planningBase: { tree: "0" } };
	return {
		generation: 1, refreshedAt: at(200), selectedExecutionRunId: run.selectionId,
		planningRuns: [], executionRuns: [run], supportingEvidence: [], activePointer: null,
		lineages: [{ id: "planning", admission: "Current", reason: "fixture", planningRun: { sources: [packetSource] }, packet, graph: { nodes: ["a", "b", "c"], edges: [["a", "c"]], topologicalOrder: ["a", "b", "c"], parallelGroups: [["a", "b"], ["c"]], criticalPath: ["a", "c"] }, executionRuns: [run] }],
	} as unknown as CatalogSnapshot;
}

test("fixed-behavior scenarios preserve evidence while varying only bounded Fanout concurrency", () => {
	const state = fixture();
	const observed = queryScenario(state, { concurrency: { mode: "observed" } });
	expect(observed).toMatchObject({ status: "available", configuration: { mode: "observed", limit: 2 }, observedBoundaryMs: 160, scenarioBoundaryMs: 160, deltaMs: 0, statement: expect.stringContaining("fixed recorded behavior") });
	expect(observed.schedule.nodes).toContainEqual(expect.objectContaining({ nodeId: "b", executionEndMs: 50, completedMs: 100, acceptanceGateWaitMs: 50 }));
	expect(observed.receipt).toMatchObject({ evidenceClass: "Scenario", artifactGeneration: "Event v3 / Projection v4", sourceReferences: expect.arrayContaining([expect.objectContaining({ id: "packet" }), expect.objectContaining({ id: "events" })]) });

	const sequential = queryScenario(state, { concurrency: { mode: "sequential" } });
	expect(sequential).toMatchObject({ status: "available", observedBoundaryMs: 160, scenarioBoundaryMs: 210, deltaMs: 50, configuration: { mode: "sequential", limit: 1 } });
	expect(sequential.schedule.nodes).toEqual([
		expect.objectContaining({ nodeId: "a", startMs: 0, executionEndMs: 100, completedMs: 100, fanoutWaitMs: 0, acceptanceGateWaitMs: 0 }),
		expect.objectContaining({ nodeId: "b", startMs: 100, executionEndMs: 150, completedMs: 150, fanoutWaitMs: 100, acceptanceGateWaitMs: 0 }),
		expect.objectContaining({ nodeId: "c", startMs: 150, executionEndMs: 190, completedMs: 190, fanoutWaitMs: 50, acceptanceGateWaitMs: 0 }),
	]);
	expect(sequential.schedule.acceptanceGate.map(({ attemptId }: any) => attemptId)).toEqual(["a:1", "b:1", "c:2"]);
	expect(sequential.schedule.attempts.map(({ attemptId }: any) => attemptId)).toEqual(["a:1", "b:1", "c:1", "c:2"]);
	expect(sequential.schedule.attempts).toContainEqual(expect.objectContaining({ attemptId: "c:2", sourceAttemptId: "c:1", startMs: 170, endMs: 190, fanoutWaitMs: 0 }));
	expect(sequential.schedule.turns[0]).toMatchObject({ turnId: "a:1:turn", startMs: 5, endMs: 95 });
	expect(sequential.schedule.tools[0]).toMatchObject({ toolCallId: "a:1:tool", startMs: 20, endMs: 30 });
	expect(sequential.preserved).toMatchObject({ nodeIds: ["a", "b", "c"], attemptIds: ["a:1", "b:1", "c:1", "c:2"], acceptedLedgerAttemptIds: ["a:1", "b:1", "c:2"], outcomeActions: ["accept", "accept", "validation-repair", "accept"] });
	expect(sequential.completionChain.map(({ kind, id }: any) => `${kind}:${id}`)).toEqual(["node:a", "fanout-capacity:c", "node:c", "final-validation:final-validation", "run:run"]);
	expect(Object.keys(sequential)).not.toEqual(expect.arrayContaining(["prediction", "forecast", "savings", "recommendation"]));

	for (const concurrency of [{ mode: "custom", limit: 2 }, { mode: "unlimited" }] as const) {
		const result = queryScenario(state, { concurrency });
		expect(result.scenarioBoundaryMs).toBe(160);
		expect(result.schedule.nodes).toContainEqual(expect.objectContaining({ nodeId: "b", executionEndMs: 50, completedMs: 100, acceptanceGateWaitMs: 50 }));
	}
	for (const limit of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) expect(() => queryScenario(state, { concurrency: { mode: "custom", limit } })).toThrow("positive safe integer");
});

test("baseline mismatches reject alternatives, while incomplete and dry evidence stay bounded", () => {
	const mismatched = fixture();
	(mismatched.executionRuns[0]!.projection!.terminalOutcome as any).durationMs = 201;
	expect(() => queryScenario(mismatched, { concurrency: { mode: "sequential" } })).toThrow("observed baseline");
	const dependencyMismatch = fixture();
	(dependencyMismatch.executionRuns[0]!.events.find(({ sequence }) => sequence === 10) as any).occurredAt = at(90);
	expect(() => queryScenario(dependencyMismatch, { concurrency: { mode: "observed" } })).toThrow("recorded packet dependencies");
	const gateConflict = fixture();
	const gateProjection = gateConflict.executionRuns[0]!.projection!;
	const attemptA = gateProjection.attempts.find(({ allocation }) => allocation.attemptId === "a:1")!;
	const attemptB = gateProjection.attempts.find(({ allocation }) => allocation.attemptId === "b:1")!;
	(attemptA as any).completionSequence = 8;
	(attemptB as any).completionSequence = 6;
	(attemptB.outcome as any).finishedAt = at(50);
	(attemptB.outcome as any).durationMs = 50;
	(gateProjection.nodes.find(({ id }) => id === "a") as any).completionSequence = 9;
	(gateProjection.nodes.find(({ id }) => id === "b") as any).completionSequence = 7;
	(gateConflict.executionRuns[0]!.events.find(({ sequence }) => sequence === 6) as any).occurredAt = at(50);
	(gateConflict.executionRuns[0]!.events.find(({ sequence }) => sequence === 6) as any).payload = { outcome: { nodeId: "b", attemptId: "b:1" } };
	(gateConflict.executionRuns[0]!.events.find(({ sequence }) => sequence === 7) as any).occurredAt = at(50);
	(gateConflict.executionRuns[0]!.events.find(({ sequence }) => sequence === 7) as any).payload = { nodeId: "b", status: "succeeded", cause: { attemptId: "b:1" } };
	(gateConflict.executionRuns[0]!.events.find(({ sequence }) => sequence === 8) as any).payload = { outcome: { nodeId: "a", attemptId: "a:1" } };
	(gateConflict.executionRuns[0]!.events.find(({ sequence }) => sequence === 9) as any).payload = { nodeId: "a", status: "succeeded", cause: { attemptId: "a:1" } };
	(gateProjection as any).acceptedLedger = [
		{ eventSequence: 6, attemptId: "b:1", transition: { patch: { artifact: { sha256: "b" }, baseTree: "0", resultTree: "1" } } },
		{ eventSequence: 8, attemptId: "a:1", transition: { patch: { artifact: { sha256: "a" }, baseTree: "1", resultTree: "2" } } },
		gateProjection.acceptedLedger[2],
	];
	expect(() => queryScenario(gateConflict, { concurrency: { mode: "sequential" } })).toThrow("acceptance order cannot be scheduled");

	const incomplete = fixture();
	const run = incomplete.executionRuns[0]!;
	(run.projection as any).terminalOutcome = null;
	(run.projection as any).finishedAt = null;
	(run.projection as any).updatedAt = at(100);
	(run.projection as any).lastEventSequence = 12;
	(run.projection!.nodes.find(({ id }) => id === "c") as any).completionSequence = null;
	(run.projection!.nodes.find(({ id }) => id === "c") as any).status = "pending";
	const openAttempt = run.projection!.attempts.find(({ allocation }) => allocation.attemptId === "c:2")!;
	(openAttempt as any).completionSequence = null;
	(openAttempt as any).outcome = null;
	(run.projection as any).acceptedLedger = run.projection!.acceptedLedger.filter(({ attemptId }) => attemptId !== "c:2");
	(run as any).events = run.events.filter(({ sequence }) => sequence <= 12);
	const prefix = queryScenario(incomplete, { concurrency: { mode: "sequential" } });
	expect(prefix).toMatchObject({ status: "partial", coverage: { kind: "recorded-prefix", lastEventSequence: 12 }, observedBoundaryMs: 120, scenarioBoundaryMs: 170, deltaMs: null });
	expect(prefix.schedule.nodes).toContainEqual(expect.objectContaining({ nodeId: "c", readinessMs: 100, startMs: 150, executionEndMs: 170, fanoutWaitMs: 50, complete: false }));
	expect(prefix.schedule.attempts).toContainEqual(expect.objectContaining({ attemptId: "c:2", endMs: null }));
	expect(prefix.completionChain.at(-1)).toMatchObject({ kind: "recorded-prefix", id: "12" });
	expect(prefix.receipt.limitations.join(" ")).toContain("recorded prefix");
	const elapsedPrefix = incomplete;
	(elapsedPrefix.executionRuns[0]!.projection as any).lastEventSequence = 13;
	(elapsedPrefix.executionRuns[0]!.projection as any).updatedAt = at(130);
	(elapsedPrefix.executionRuns[0]!.projection!.nodes as any[]).push({ id: "d", status: "pending", completionSequence: null, attemptIds: ["d:1"] });
	(elapsedPrefix.executionRuns[0]!.projection!.attempts as any[]).push({ allocationSequence: 13, completionSequence: null, allocation: { nodeId: "d", attemptId: "d:1", attemptNumber: 1, kind: "original", assignment: { tier: "tier2" } }, outcome: null });
	(elapsedPrefix.executionRuns[0]!.events as any[]).push({ sequence: 13, occurredAt: at(130), event: "attempt-allocated", payload: { allocation: { nodeId: "d", attemptId: "d:1" } } });
	(elapsedPrefix.lineages[0]!.graph!.nodes as any[]).push("d");
	const elapsed = queryScenario(elapsedPrefix, { concurrency: { mode: "sequential" } });
	expect(elapsed.schedule.attempts).toContainEqual(expect.objectContaining({ attemptId: "c:2", endMs: null, coveredDurationMs: 10, uncoveredMs: 10 }));
	expect(elapsed.schedule.uncoveredMs).toBeGreaterThanOrEqual(10);

	const failed = fixture();
	(failed.executionRuns[0]!.projection!.terminalOutcome as any).outcome = "failed";
	expect(queryScenario(failed, { concurrency: { mode: "sequential" } })).toMatchObject({ status: "partial", coverage: { kind: "recorded-prefix" }, deltaMs: null });
	const validating = fixture();
	const validatingRun = validating.executionRuns[0]!;
	(validatingRun.projection as any).terminalOutcome = null;
	(validatingRun.projection as any).finishedAt = null;
	(validatingRun.projection as any).lastEventSequence = 16;
	(validatingRun.projection as any).updatedAt = at(150);
	(validatingRun.projection as any).finalValidation = { disposition: "running", startedAt: at(140) };
	(validatingRun.projection!.attempts as any[]).push({ allocationSequence: 16, completionSequence: null, allocation: { nodeId: "final-validation", attemptId: "final:1", attemptNumber: 1, kind: "validation-repair", assignment: { tier: "tier1" } }, outcome: null });
	(validatingRun as any).events = validatingRun.events.filter(({ sequence }) => sequence <= 16);
	(validatingRun.events.find(({ sequence }) => sequence === 16) as any).occurredAt = at(150);
	(validatingRun.events.find(({ sequence }) => sequence === 16) as any).event = "attempt-allocated";
	(validatingRun.events.find(({ sequence }) => sequence === 16) as any).payload = { allocation: { nodeId: "final-validation", attemptId: "final:1" } };
	const validatingPrefix = queryScenario(validating, { concurrency: { mode: "sequential" } });
	expect(validatingPrefix).toMatchObject({ status: "partial", observedBoundaryMs: 150, scenarioBoundaryMs: 200, schedule: { finalValidation: { startMs: 190, endMs: 200, durationMs: 10, outcome: "recorded-prefix", complete: false } } });
	expect(validatingPrefix.preserved.attemptIds).toContain("final:1");
	expect(validatingPrefix.completionChain).toContainEqual(expect.objectContaining({ kind: "final-validation", completedMs: 200 }));

	const dry = fixture();
	(dry.executionRuns[0]!.projection as any).mode = "dry-run";
	const dryResult = queryScenario(dry, { concurrency: { mode: "unlimited" } });
	expect(dryResult).toMatchObject({ status: "dry-run", scenarioBoundaryMs: null, deltaMs: null, schedule: { nodes: [], attempts: [], acceptanceGate: [] } });
	expect(dryResult.receipt.limitations.join(" ")).toContain("no meaningful schedule delta");
});
