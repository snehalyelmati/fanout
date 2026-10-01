import { expect, test } from "bun:test";
import type { ExecutionRunProjection, ExecutionTotals } from "../../fanout-core/src/execution-projection";
import type { CatalogExecutionRun, CatalogSnapshot, SourceReference } from "./catalog";
import { queryComparison } from "./comparison";

const packet = { path: "packet/execution-packet.json", sha256: "a".repeat(64), byteLength: 10 };
const otherPacket = { path: "other/execution-packet.json", sha256: "b".repeat(64), byteLength: 10 };
const profile = { path: "profiles/default.json", sha256: "c".repeat(64), byteLength: 10 };
const otherProfile = { path: "profiles/other.json", sha256: "d".repeat(64), byteLength: 10 };
const packetSource: SourceReference = { id: "packet-source", path: packet.path, kind: "planning", byteLength: 10, modifiedAtMs: 1 };
const base = { headCommit: "1".repeat(40), tree: "2".repeat(40) };
const contract = { schema: "fanout.work-contract", version: 6, goals: [{ sourcePlanId: "goal", statement: "Do exact work" }], changes: [], readDependencies: [], forbiddenWrites: [], validationCommands: [], advisoryValidationMode: "fail-fast", capabilities: { modelCallableTools: ["read", "grep", "find", "ls", "edit", "write", "fanout_validate"], validationExecution: "worker-advisory-controller-authoritative", shell: "unavailable", extensionTools: "fanout-validate-only" }, semanticReviewCriteria: [{ sourcePlanId: "criterion", statement: "It works" }], advisoryNotes: [] };

function totals(runDurationMs: number, totalTokens: number, estimatedCostUsd: number): ExecutionTotals {
	return {
		attempts: 1,
		attemptKinds: { original: 1, retry: 0, fallback: 0, "validation-repair": 0, "integration-repair": 0 },
		actions: { accept: 1, retry: 0, fallback: 0, "validation-repair": 0, "integration-repair": 0, fail: 0, abort: 0 },
		inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens,
		estimatedCostUsd, workerDurationMs: 20, toolDurationMs: 5, pollDurationMs: 0, pollCount: 0,
		filesChanged: 1, insertions: 2, deletions: 0, finalValidationDurationMs: 10, runDurationMs,
	};
}

function run(
	id: string,
	options: {
		outcome?: "completed" | "failed" | "aborted" | "dry-run-completed";
		mode?: "live" | "dry-run";
		duration?: number;
		tokens?: number;
		cost?: number;
		complete?: boolean;
		packet?: typeof packet;
		profile?: typeof profile;
		admission?: CatalogExecutionRun["admission"];
		nodeId?: string;
	} = {},
): CatalogExecutionRun {
	const nodeId = options.nodeId ?? "work";
	const outcome = options.outcome === undefined ? null : { outcome: options.outcome, durationMs: options.duration ?? 100, cause: {} };
	const attemptId = `${id}:attempt`;
	const metrics = {
		status: options.complete === false ? "partial" : "complete", issues: [], complete: options.complete ?? true, compatibility: "instrumented", workerDurationMs: 20,
		turns: [{ inputTokens: options.tokens ?? 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: options.tokens ?? 10, costUsd: options.cost ?? 1 }],
		responses: [{ durationMs: 4 }], polls: [], tools: [{ durationMs: 5 }],
	};
	const projection = {
		runId: id,
		mode: options.mode ?? "live",
		terminalOutcome: outcome,
		packet: options.packet ?? packet,
		profile: options.profile ?? profile,
		totals: totals(options.duration ?? 100, options.tokens ?? 10, options.cost ?? 1),
		nodes: [{ id: nodeId, status: outcome?.outcome === "completed" ? "succeeded" : "failed", causalAttemptId: attemptId, causalUpstreamNodeId: null }],
		attempts: [{ allocation: { attemptId, nodeId, kind: "original", assignment: { tier: "tier1", provider: "provider", model: "model" } }, outcome: { durationMs: 20, action: outcome?.outcome === "completed" ? "accept" : "fail", disposition: "ordinary", terminalFact: { stage: "apply", code: outcome?.outcome === "completed" ? "applied" : "apply-failure" }, metrics } }],
		acceptedLedger: outcome?.outcome === "completed" ? [{ eventSequence: 5, attemptId, transition: { patch: { baseTree: "1".repeat(40), resultTree: "2".repeat(40), changedPaths: ["file.ts"], stats: { filesChanged: 1, insertions: 2, deletions: 0 } } } }] : [],
		finalValidation: outcome?.outcome === "completed" ? { disposition: "passed", durationMs: 10 } : { disposition: "not-run" },
	} as unknown as ExecutionRunProjection;
	const source = { id: `${id}-source`, path: `packet/executions/${id}/events.jsonl`, kind: "execution" as const, byteLength: 10, modifiedAtMs: 1 };
	const events = [
		{ event: "confirmation-decided", occurredAt: "2026-07-20T00:00:00.000Z", payload: { decision: "accepted" } },
		{ event: "attempt-allocated", occurredAt: "2026-07-20T00:00:00.010Z", payload: { allocation: { nodeId } } },
		{ event: "node-completed", occurredAt: "2026-07-20T00:00:00.030Z", payload: { nodeId } },
	] as any;
	return {
		id, selectionId: `packet/executions/${id}`, planningRunId: options.packet === otherPacket ? "other" : "packet",
		admission: options.admission ?? "Current", label: outcome?.outcome ?? "nonterminal", reason: "fixture",
		createdAt: null, updatedAt: null, projection, events, sources: [source],
	};
}

function packetView(nodes: Array<{ id: string; workContract: unknown }>, planningBase = base, profileIdentity = profile): any {
	return { planningBase, profile: profileIdentity, nodes: nodes.map((node) => ({ ...node, kind: "implement" })) };
}

function snapshot(runs: CatalogExecutionRun[]): CatalogSnapshot {
	return {
		generation: 3, refreshedAt: "2026-07-20T00:00:00.000Z", selectedExecutionRunId: runs[0]?.selectionId ?? null,
		executionRuns: runs, planningRuns: [], supportingEvidence: [], activePointer: null,
		lineages: [
			{ id: "packet", admission: "Current", reason: "fixture", planningRun: { sources: [packetSource] }, packet: {} as any, graph: { nodes: ["work"], edges: [], topologicalOrder: ["work"], parallelGroups: [["work"]], criticalPath: ["work"] }, executionRuns: runs.filter((item) => item.planningRunId === "packet") },
			{ id: "other", admission: "Current", reason: "fixture", planningRun: { sources: [] }, packet: {} as any, graph: null, executionRuns: runs.filter((item) => item.planningRunId === "other") },
		],
	} as unknown as CatalogSnapshot;
}

test("exact completed live pair emits only B minus A deltas with auditable percentages", () => {
	const a = run("run-a", { outcome: "completed", duration: 100, tokens: 0, cost: 2 });
	const b = run("run-b", { outcome: "completed", duration: 130, tokens: 10, cost: 1 });
	const result = queryComparison(snapshot([a, b]), { runAId: a.selectionId, runBId: b.selectionId });

	expect(result.pair).toMatchObject({ status: "available", direction: "Run B minus Run A", runAId: a.selectionId, runBId: b.selectionId });
	expect(result.pair.deltas.find(({ id }) => id === "run-duration")).toMatchObject({ runA: 100, runB: 130, delta: 30, percentage: 30, unit: "ms" });
	expect(result.pair.deltas.find(({ id }) => id === "tokens")).toMatchObject({ runA: 0, runB: 10, delta: 10, percentage: null });
	expect(result.pair.deltas.find(({ id }) => id === "estimated-cost")).toMatchObject({ runA: 2, runB: 1, delta: -1, percentage: -50 });
	expect(result.pair.deltas.find(({ id }) => id === "readiness-queue-duration")).toMatchObject({ runA: 10, runB: 10, delta: 0 });
	expect(result.pair.catalogue.runA).toMatchObject({
		outcome: "completed", mode: "live",
		completedScope: { complete: true }, evidenceCoverage: { complete: true, completeAttempts: 1, attempts: 1 },
		attempts: [{ kind: "original", action: "accept", stage: "apply/applied" }],
		readinessQueue: { complete: true, totalMs: 10, contributors: [{ nodeId: "work", durationMs: 10 }] },
		structuralPaths: { criticalPath: ["work"] }, causalPaths: { nodes: [{ id: "work", causalAttemptId: "run-a:attempt" }] },
		observedRouting: [{ tier: "tier1", provider: "provider", model: "model" }],
		acceptedLedger: [{ changedPaths: ["file.ts"] }], perPathTransitionFrequency: { "file.ts": 1 },
	});
	expect(result.pair.deltas.every(({ receipt }) => receipt.sourceReferences.some(({ id }) => id === "packet-source") && receipt.sourceReferences.some(({ id }) => id === "run-a-source") && receipt.sourceReferences.some(({ id }) => id === "run-b-source"))).toBe(true);
	expect(result.pair.deltas.find(({ id }) => id === "tokens")?.receipt.limitations).toContain("Percentage unavailable because Run A is zero");
});

test("available exact pairs expose missing metric scopes as Partial instead of zero", () => {
	const a = run("run-a", { outcome: "completed" });
	const b = run("run-b", { outcome: "completed" });
	(b.projection!.attempts[0]!.outcome!.metrics as any).compatibility = "generic";
	(b as any).events = [];
	const pair = queryComparison(snapshot([a, b]), { runAId: a.selectionId, runBId: b.selectionId }).pair;

	expect(pair).toMatchObject({ status: "partial", receipt: { evidenceClass: "Partial" } });
	expect(pair.deltas.some(({ id }) => id === "provider-duration" || id === "readiness-queue-duration")).toBe(false);
	expect(pair.omittedMetrics.map(({ id }) => id)).toEqual(expect.arrayContaining(["provider-duration", "readiness-queue-duration"]));
	expect(pair.receipt.missingInputs).toEqual(expect.arrayContaining(["provider-duration", "readiness-queue-duration"]));
});

test("pairwise deltas are suppressed unless exact packet, completed live state, and compared telemetry are complete", () => {
	const a = run("run-a", { outcome: "completed" });
	for (const [candidate, reason] of [
		[a, "distinct"],
		[run("failed", { outcome: "failed" }), "completed live"],
		[run("dry", { outcome: "dry-run-completed", mode: "dry-run" }), "completed live"],
		[run("open"), "completed live"],
		[run("partial", { outcome: "completed", complete: false }), "complete compared scope"],
		[run("other", { outcome: "completed", packet: otherPacket }), "exact same Execution Packet"],
		[run("other-profile", { outcome: "completed", profile: otherProfile }), "exact same Project Execution Profile"],
	] as const) {
		const pair = queryComparison(snapshot([a, candidate]), { runAId: a.selectionId, runBId: candidate.selectionId }).pair;
		expect(pair).toMatchObject({ status: "unavailable", deltas: [] });
		expect(pair.reason).toContain(reason);
		expect(pair.receipt.evidenceClass).toBe(candidate.id === "partial" ? "Partial" : "Unavailable");
	}
});

test("same-packet cohorts are outcome-stratified, require two runs, enumerate contributors, and omit partial metrics", () => {
	const completed = [
		run("run-a", { outcome: "completed", duration: 100, tokens: 10 }),
		run("run-b", { outcome: "completed", duration: 130, tokens: 20 }),
		run("run-c", { outcome: "completed", duration: 110, tokens: 30, complete: false }),
	];
	const failed = [run("failed-a", { outcome: "failed", duration: 70 }), run("failed-b", { outcome: "failed", duration: 90 })];
	const result = queryComparison(snapshot([...completed, ...failed, run("aborted", { outcome: "aborted" })]), { runAId: completed[0]!.selectionId });
	const completedCohort = result.cohorts.find(({ outcome }) => outcome === "completed")!;
	const duration = completedCohort.aggregates.find(({ id }) => id === "run-duration")!;

	expect(completedCohort).toMatchObject({ status: "partial", evidenceClass: "Partial", count: 3, contributors: completed.map(({ selectionId }) => selectionId) });
	expect(duration).toMatchObject({ count: 3, minimum: 100, median: 110, maximum: 130 });
	expect(duration.contributors).toEqual([
		{ runId: completed[0]!.selectionId, value: 100 },
		{ runId: completed[1]!.selectionId, value: 130 },
		{ runId: completed[2]!.selectionId, value: 110 },
	]);
	expect(completedCohort.aggregates.some(({ id }) => id === "tokens")).toBe(false);
	expect(completedCohort.omittedMetrics).toContainEqual({ id: "tokens", reason: "one or more contributor values are incomplete" });
	expect(completedCohort.receipt.missingInputs).toContain("tokens");
	expect(result.cohorts.find(({ outcome }) => outcome === "failed")).toMatchObject({ status: "partial", evidenceClass: "Partial", count: 2 });
	expect(result.cohorts.some(({ outcome }) => outcome === "aborted")).toBe(false);
	expect(JSON.stringify(result)).not.toMatch(/"(?:mean|significance|trend|regression|percentile|winner|standardDeviation)"/i);
	expect(duration.receipt.sourceReferences.map(({ id }) => id)).toEqual(expect.arrayContaining(["packet-source", "run-a-source", "run-b-source", "run-c-source"]));
});

test("cross-packet Nodes align only by identical Planning Base and a unique canonical Work Contract match", () => {
	const a = run("run-a", { outcome: "completed", tokens: 10, cost: 1, nodeId: "alpha" });
	const b = run("run-b", { outcome: "completed", tokens: 25, cost: 2, nodeId: "beta", packet: otherPacket });
	const state = snapshot([a, b]);
	(state.lineages[0] as any).packet = packetView([{ id: "alpha", workContract: contract }]);
	(state.lineages[1] as any).packet = packetView([{ id: "beta", workContract: Object.fromEntries(Object.entries(structuredClone(contract)).reverse()) }]);

	const result = queryComparison(state, { runAId: a.selectionId, runBId: b.selectionId, nodeAId: "alpha", nodeBId: "beta" });

	expect(result.nodePair).toMatchObject({ status: "aligned", warning: null, nodes: { runA: { nodeId: "alpha" }, runB: { nodeId: "beta" } }, receipt: { evidenceClass: "Derived" } });
	expect(result.nodePair.totals.find(({ id }) => id === "tokens")).toMatchObject({ runA: 10, runB: 25, receipt: { evidenceClass: "Derived" } });
	expect(result.nodePair.deltas.find(({ id }) => id === "tokens")).toMatchObject({ runA: 10, runB: 25, delta: 15, percentage: 150 });
	expect(result.nodePair.deltas.every(({ receipt }) => receipt.evidenceClass === "Derived")).toBe(true);
	expect(result.nodePair.receipt.derivation).toContain("unique one-to-one");
	expect(result.nodePair.receipt.limitations).toContain("The transient SHA-256 comparison key is not an Artifact Identity");
	expect(result.nodePair.receipt.profileIdentity).toEqual(profile);
	expect(result.nodePair.deltas.every(({ receipt }) => JSON.stringify(receipt.profileIdentity) === JSON.stringify(profile))).toBe(true);
});

test("ambiguous and different-work Node selections stay heterogeneous with raw totals and no deltas", () => {
	const a = run("run-a", { outcome: "completed", tokens: 10, nodeId: "alpha" });
	const b = run("run-b", { outcome: "completed", tokens: 25, nodeId: "beta", packet: otherPacket });
	for (const [packetA, packetB, reason] of [
		[packetView([{ id: "alpha", workContract: contract }]), packetView([{ id: "beta", workContract: contract }, { id: "duplicate", workContract: structuredClone(contract) }]), "not unique"],
		[packetView([{ id: "alpha", workContract: contract }]), packetView([{ id: "beta", workContract: { ...contract, goals: [{ sourcePlanId: "goal", statement: "Approximately the same work" }] } }]), "not exactly equal"],
		[packetView([{ id: "alpha", workContract: contract }]), packetView([{ id: "beta", workContract: contract }], { ...base, tree: "3".repeat(40) }), "Planning Base"],
		[packetView([{ id: "alpha", workContract: contract }]), packetView([{ id: "beta", workContract: contract }], base, otherProfile), "Project Execution Profile"],
	] as const) {
		const state = snapshot([a, b]);
		(state.lineages[0] as any).packet = packetA;
		(state.lineages[1] as any).packet = packetB;
		const nodePair = queryComparison(state, { runAId: a.selectionId, runBId: b.selectionId, nodeAId: "alpha", nodeBId: "beta" }).nodePair;
		expect(nodePair).toMatchObject({
			status: "unaligned",
			warning: "Different work; this delta is descriptive, not a performance or causal claim.",
			deltas: [], receipt: { evidenceClass: "Heterogeneous" },
		});
		expect(nodePair.totals.find(({ id }) => id === "tokens")).toMatchObject({ runA: 10, runB: 25, receipt: { evidenceClass: "Heterogeneous" } });
		expect(nodePair.totals.every(({ receipt }) => receipt.evidenceClass === "Heterogeneous")).toBe(true);
		expect(nodePair.reason).toContain(reason);
		expect(nodePair.totals.every(({ receipt }) => receipt.assumptions.includes(nodePair.reason))).toBe(true);
		expect(nodePair.receipt.limitations).toContain("No calculated delta or Diagnostic Observation was produced");
	}
});

test("aligned incomplete Node evidence remains unknown and emits no performance delta", () => {
	const a = run("run-a", { outcome: "completed", nodeId: "alpha" });
	const b = run("run-b", { outcome: "failed", nodeId: "beta", packet: otherPacket });
	(b.projection!.nodes[0] as any).status = "succeeded";
	(b.projection as any).attempts = [];
	const state = snapshot([a, b]);
	(state.lineages[0] as any).packet = packetView([{ id: "alpha", workContract: contract }]);
	(state.lineages[1] as any).packet = packetView([{ id: "beta", workContract: contract }]);

	const nodePair = queryComparison(state, { runAId: a.selectionId, runBId: b.selectionId, nodeAId: "alpha", nodeBId: "beta" }).nodePair;

	expect(nodePair).toMatchObject({ status: "aligned", deltas: [], receipt: { evidenceClass: "Partial" } });
	expect(nodePair.totals.find(({ id }) => id === "tokens")).toMatchObject({ runA: 10, runB: null, receipt: { evidenceClass: "Partial" } });
	expect(nodePair.receipt.assumptions).not.toContain("Completed live Node evidence");
	expect(nodePair.receipt.missingInputs).toContain("two completed live runs with succeeded selected Nodes");
});


test("unverifiable all-round command totals are omitted from comparisons", () => {
	const a = run("a", { outcome: "completed" }), b = run("b", { outcome: "completed" });
	b.projection!.totals.finalValidationDurationMs = null;
	const result = queryComparison(snapshot([a, b]), { runAId: a.selectionId, runBId: b.selectionId });
	expect(result.pair.deltas.some(({ id }) => id === "final-validation-duration")).toBe(false);
	expect(result.pair.omittedMetrics).toContainEqual(expect.objectContaining({ id: "final-validation-duration" }));
});
