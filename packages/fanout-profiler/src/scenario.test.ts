import { expect, test } from "bun:test";
import type { CatalogSnapshot } from "./catalog";
import { queryScenario } from "./scenario";

const origin = Date.parse("2026-07-20T00:00:00.000Z");
const at = (ms: number) => new Date(origin + ms).toISOString();
const source = (id: string, path: string, kind: "planning" | "execution") => ({ id, path, kind, byteLength: 1, modifiedAtMs: 1 });

function fixture(): CatalogSnapshot {
	const attempt = (nodeId: string, attemptId: string, allocationSequence: number, completionSequence: number, start: number, end: number, action = "accept", kind = "original", sourceAttemptId?: string, tier: "tier1" | "tier2" = "tier2") => ({
		allocationSequence, completionSequence,
		allocation: { nodeId, attemptId, attemptNumber: sourceAttemptId ? 2 : 1, kind, ...(sourceAttemptId ? { sourceAttemptId } : {}), assignment: { tier } },
		outcome: {
			nodeId, attemptId, action, startedAt: at(start), finishedAt: at(end), durationMs: end - start,
			terminalFact: { stage: "apply", code: action === "accept" ? "applied" : "failed" },
			metrics: {
				complete: true,
				turns: [{ attemptId, turnId: `${attemptId}:turn`, terminal: "completed", provider: "provider", model: "model", tier, requestedAt: at(start + 5), firstOutputAt: at(start + 15), finishedAt: at(end - 5), durationMs: end - start - 10, inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30, totalTokens: 110, costUsd: 0.1, pricingSource: "fixture", responseIds: [], toolCallIds: [`${attemptId}:tool`] }],
				responses: [], polls: [],
				tools: [{ turnId: `${attemptId}:turn`, toolCallId: `${attemptId}:tool`, name: "edit", startedAt: at(start + 20), finishedAt: at(start + 30), durationMs: 10 }],
			},
		},
	});
	const attempts = [
		attempt("a", "a:1", 4, 6, 0, 100),
		attempt("b", "b:1", 5, 8, 0, 100),
		attempt("c", "c:1", 10, 11, 100, 120, "validation-repair", "original", undefined, "tier1"),
		attempt("c", "c:2", 12, 13, 120, 140, "accept", "validation-repair", "c:1", "tier1"),
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
	const profile = { path: "profiles/default.json", sha256: "a".repeat(64), byteLength: 10 };
	const projection = {
		runId: "run", lastEventSequence: 17, mode: "live", startedAt: at(-40), updatedAt: at(160), finishedAt: at(160), policy: { maxConcurrency: 2 }, confirmation: "accepted", confirmationEventSequence: 3,
		profile,
		terminalOutcome: { outcome: "completed", durationMs: 200, cleanupDurationMs: 0 },
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
	const packet = { runtimePolicy: { maxConcurrency: 2 }, profile, nodes: ["a", "b", "c"].map((id) => ({ id, kind: "implement" })), planningBase: { tree: "0" } };
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
	expect(observed.receipt).toMatchObject({ evidenceClass: "Scenario", artifactGeneration: "Event v4 / Projection v5", profileIdentity: { path: "profiles/default.json" }, sourceReferences: expect.arrayContaining([expect.objectContaining({ id: "packet" }), expect.objectContaining({ id: "events" })]) });

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
	const includesPreEventProfileValidation = fixture();
	(includesPreEventProfileValidation.executionRuns[0]!.projection!.terminalOutcome as any).durationMs = 240;
	expect(queryScenario(includesPreEventProfileValidation, { concurrency: { mode: "observed" } }).observedBoundaryMs).toBe(160);
	const impossibleDuration = fixture();
	(impossibleDuration.executionRuns[0]!.projection!.terminalOutcome as any).durationMs = 199;
	expect(() => queryScenario(impossibleDuration, { concurrency: { mode: "sequential" } })).toThrow("observed baseline");
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
	expect(prefix.cost.status).toBe("available");
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

const prices = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };

test("Provider Profiles independently apply fixed timing, FIFO capacity, and cache-aware cost", () => {
	const result = queryScenario(fixture(), {
		concurrency: { mode: "custom", limit: 2 },
		providerProfiles: {
			tier1: { mode: "observed" },
			tier2: { mode: "fixed", name: "Fixed Tier 2", capacity: 1, ttftMs: 20, outputTokensPerSecond: 1_000, pricesPerMillion: prices },
		},
	});
	expect(result.configuration.providerProfiles).toEqual({ tier1: { mode: "observed" }, tier2: expect.objectContaining({ mode: "fixed", name: "Fixed Tier 2" }) });
	expect(result.schedule.turns).toContainEqual(expect.objectContaining({ attemptId: "a:1", tier: "tier2", providerWaitMs: 0, ttftMs: 20, generationMs: 10, scenarioCostUsd: 0.0003 }));
	expect(result.schedule.turns).toContainEqual(expect.objectContaining({ attemptId: "b:1", tier: "tier2", providerWaitMs: 30, ttftMs: 20, generationMs: 10, scenarioCostUsd: 0.0003 }));
	expect(result.schedule.turns).toContainEqual(expect.objectContaining({ attemptId: "c:1", tier: "tier1", providerWaitMs: 0, ttftMs: 10, generationMs: 0, scenarioCostUsd: 0.1 }));
	expect(result.schedule.tiers).toContainEqual(expect.objectContaining({ tier: "tier2", providerWaitMs: 30, ttftMs: 40, generationMs: 20, costStatus: "available", scenarioCostUsd: 0.0006 }));
	expect(result.cost).toMatchObject({ status: "available", observedUsd: 0.4, scenarioUsd: 0.2006, deltaUsd: -0.1994 });
	expect(result.preserved).toMatchObject({ tierAssignments: ["tier2", "tier2", "tier1", "tier1"] });
	expect(result.receipt.assumptions.join(" ")).toContain("Fixed Tier 2");
	expect(result.statement).toContain("Under these fixed assumptions");
});

test("Provider Profiles schedule every Response, shift interleaved Tools, and identify the FIFO constraint", () => {
	const state = fixture();
	const attempt = state.executionRuns[0]!.projection!.attempts.find(({ allocation }) => allocation.attemptId === "a:1")!.outcome!.metrics as any;
	attempt.complete = false; // Cost strength depends on usage fields, not unrelated envelope completeness.
	attempt.responses = [
		{ turnId: "a:1:turn", responseId: "a:r1", requestedAt: at(5), firstTokenAt: at(10), finishedAt: at(25), durationMs: 20, inputTokens: 40, outputTokens: 4, cacheReadTokens: 10, cacheWriteTokens: 5, costUsd: 0.04 },
		{ turnId: "a:1:turn", responseId: "a:r2", requestedAt: at(35), firstTokenAt: at(40), finishedAt: at(65), durationMs: 30, inputTokens: 60, outputTokens: 6, cacheReadTokens: 10, cacheWriteTokens: 25, costUsd: 0.06 },
	];
	Object.assign(attempt.tools[0], { startedAt: at(26), finishedAt: at(34), durationMs: 8 });
	const fixed = { mode: "fixed" as const, name: "Response FIFO", capacity: 1, ttftMs: 10, outputTokensPerSecond: 1_000, pricesPerMillion: prices };
	const result = queryScenario(state, { concurrency: { mode: "custom", limit: 2 }, providerProfiles: { tier1: { mode: "observed" }, tier2: fixed } });
	expect(result.schedule.responses).toEqual(expect.arrayContaining([
		expect.objectContaining({ responseId: "a:r1", issueMs: 5, providerStartMs: 5, providerEndMs: 19, providerWaitMs: 0 }),
		expect.objectContaining({ responseId: null, turnId: "b:1:turn", providerStartMs: 19, providerEndMs: 39, capacityPredecessorId: "a:r1" }),
		expect.objectContaining({ responseId: "a:r2", issueMs: 29, providerStartMs: 39, providerEndMs: 55, providerWaitMs: 10, capacityPredecessorId: "b:1:turn:provider" }),
	]));
	expect(result.schedule.turns.find(({ turnId }: any) => turnId === "a:1:turn")).toMatchObject({ responseIds: ["a:r1", "a:r2"], providerWaitMs: 10, ttftMs: 20, generationMs: 10, scenarioCostUsd: 0.0003 });
	expect(result.schedule.tools.find(({ toolCallId }: any) => toolCallId === "a:1:tool")).toMatchObject({ startMs: 20, endMs: 28, durationMs: 8 });
	expect(result.completionChain).toContainEqual(expect.objectContaining({ kind: "provider-capacity", id: "a:r2 waiting for b:1:turn:provider", completedMs: 39 }));
	expect(result.cost.status).toBe("available");
});

test("cold/warm classification uses issue-time scope and approved reset controls", () => {
	const state = fixture();
	const attempts = state.executionRuns[0]!.projection!.attempts;
	const a = attempts.find(({ allocation }) => allocation.attemptId === "a:1")!.outcome!.metrics.turns[0]! as any;
	const b = attempts.find(({ allocation }) => allocation.attemptId === "b:1")!.outcome!.metrics.turns[0]! as any;
	Object.assign(a, { requestedAt: at(5), firstOutputAt: at(15), finishedAt: at(25), durationMs: 20 });
	Object.assign(b, { requestedAt: at(35), firstOutputAt: at(40), finishedAt: at(45), durationMs: 10 });
	const profile = (warmthScope: "attempt" | "run", reset?: Record<string, number>) => ({
		mode: "cold-warm" as const, name: "Warm Tier 2", capacity: "unlimited" as const, warmthScope,
		coldTtftMs: 20, warmTtftMs: 5, outputTokensPerSecond: 1_000, pricesPerMillion: prices, ...(reset ? { reset } : {}),
	});
	for (const [label, selected, expected] of [
		["per-Attempt", profile("attempt"), 20],
		["shared-run", profile("run"), 5],
		["idle expiry", profile("run", { idleExpiryMs: 0 }), 20],
		["response duration", profile("run", { previousResponseDurationResetMs: 30 }), 20],
	] as const) {
		const result = queryScenario(state, { concurrency: { mode: "custom", limit: 2 }, providerProfiles: { tier1: { mode: "observed" }, tier2: selected } });
		expect(result.schedule.turns.find(({ attemptId }: any) => attemptId === "b:1")?.ttftMs, label).toBe(expected);
	}
	const c = attempts.find(({ allocation }) => allocation.attemptId === "c:1")! as any;
	c.allocation.assignment.tier = "tier2";
	c.outcome.metrics.turns[0].tier = "tier2";
	const limited = queryScenario(state, { concurrency: { mode: "custom", limit: 2 }, providerProfiles: { tier1: { mode: "observed" }, tier2: profile("run", { warmCallLimit: 1 }) } });
	expect(limited.schedule.turns.find(({ attemptId }: any) => attemptId === "c:1")).toMatchObject({ warmth: "cold", ttftMs: 20 });
});

test("scenario cost remains Partial or Unavailable when required provider-call usage is missing", () => {
	const fixed = { mode: "fixed" as const, name: "Fixed", capacity: 1, ttftMs: 0, outputTokensPerSecond: 1_000, pricesPerMillion: prices };
	const request = { concurrency: { mode: "observed" as const }, providerProfiles: { tier1: fixed, tier2: fixed } };
	const partial = fixture();
	delete (partial.executionRuns[0]!.projection!.attempts[0]!.outcome!.metrics.turns[0] as any).cacheReadTokens;
	expect(queryScenario(partial, request).cost.status).toBe("partial");
	const unavailable = fixture();
	for (const attempt of unavailable.executionRuns[0]!.projection!.attempts) for (const turn of attempt.outcome?.metrics.turns ?? []) delete (turn as any).inputTokens;
	expect(queryScenario(unavailable, request).cost).toMatchObject({ status: "unavailable", scenarioUsd: null, deltaUsd: null });
});

test("Provider Profile input is tier-wide, closed, and bounded", () => {
	const fixed = { mode: "fixed", name: "Fixed", capacity: 1, ttftMs: 0, outputTokensPerSecond: 1, pricesPerMillion: prices };
	for (const providerProfiles of [
		{ tier1: { mode: "observed" } },
		{ tier1: { mode: "observed" }, tier2: { ...fixed, capacity: 0 } },
		{ tier1: { mode: "observed" }, tier2: { ...fixed, warmthScope: "attempt" } },
		{ tier1: { mode: "observed" }, tier2: { ...fixed, perCallOverrides: [] } },
		{ tier1: { mode: "observed" }, tier2: { ...fixed, pricesPerMillion: { ...prices, cacheRead: -1 } } },
		{ tier1: { mode: "observed" }, tier2: { mode: "cold-warm", name: "Warm", capacity: 1, warmthScope: "run", coldTtftMs: 1, warmTtftMs: 0, outputTokensPerSecond: 1, pricesPerMillion: prices, reset: { warmCallLimit: 0 } } },
	] as any[]) expect(() => queryScenario(fixture(), { concurrency: { mode: "observed" }, providerProfiles })).toThrow();
});
