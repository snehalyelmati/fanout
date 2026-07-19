import { deepFreeze } from "../../fanout-core/src/contract-value";
import type { ExecutionRunProjection } from "../../fanout-core/src/execution-projection";
import { sameArtifact, type CatalogExecutionRun, type CatalogSnapshot, type CatalogWorkflowLineage, type SourceReference } from "./catalog";
import { createEvidenceReceipt, executionArtifactGeneration, type EvidenceClass } from "./workspace";

export interface ComparisonRequest { runAId: string; runBId?: string }

interface ReadinessQueue {
	complete: boolean;
	totalMs: number | null;
	contributors: Array<{ nodeId: string; readyAt: string | null; allocatedAt: string | null; durationMs: number | null }>;
	missingInputs: string[];
}

interface ComparisonContext {
	run: CatalogExecutionRun;
	projection: ExecutionRunProjection;
	lineage: CatalogWorkflowLineage | undefined;
	queue: ReadinessQueue;
}

interface MetricDefinition {
	id: string;
	label: string;
	unit: string;
	value: (context: ComparisonContext) => number;
	complete: (context: ComparisonContext) => boolean;
	missingReason?: (left: ComparisonContext, right: ComparisonContext) => string;
}

interface PairSuppression { reason: string; evidenceClass: EvidenceClass; missingInputs: string[] }

const terminal = ({ projection }: ComparisonContext) => projection.terminalOutcome !== null;
const telemetry = ({ projection }: ComparisonContext) => terminalProjection(projection) && projection.attempts.every(({ outcome }) => outcome?.metrics.complete === true);
const providerTelemetry = (context: ComparisonContext) => telemetry(context) && context.projection.attempts.every(({ outcome }) => outcome?.metrics.compatibility === "instrumented");
const validation = ({ projection }: ComparisonContext) => projection.finalValidation.disposition === "passed" || projection.finalValidation.disposition === "failed";
const METRICS: readonly MetricDefinition[] = [
	{ id: "run-duration", label: "Run duration", unit: "ms", value: ({ projection }) => projection.totals.runDurationMs, complete: terminal },
	{ id: "attempt-envelope-duration", label: "Attempt envelopes", unit: "ms", value: ({ projection }) => projection.attempts.reduce((total, { outcome }) => total + outcome!.durationMs, 0), complete: terminal },
	{ id: "readiness-queue-duration", label: "Readiness to first allocation", unit: "ms", value: ({ queue }) => queue.totalMs!, complete: ({ queue }) => queue.complete, missingReason: (left, right) => [...left.queue.missingInputs, ...right.queue.missingInputs].join("; ") || "readiness or allocation evidence is incomplete" },
	{ id: "attempts", label: "Attempts", unit: "attempts", value: ({ projection }) => projection.totals.attempts, complete: terminal },
	{ id: "attempt-original", label: "Original Attempts", unit: "attempts", value: ({ projection }) => projection.totals.attemptKinds.original, complete: terminal },
	{ id: "attempt-retry", label: "Retry Attempts", unit: "attempts", value: ({ projection }) => projection.totals.attemptKinds.retry, complete: terminal },
	{ id: "attempt-fallback", label: "Fallback Attempts", unit: "attempts", value: ({ projection }) => projection.totals.attemptKinds.fallback, complete: terminal },
	{ id: "attempt-validation-repair", label: "Validation-repair Attempts", unit: "attempts", value: ({ projection }) => projection.totals.attemptKinds["validation-repair"], complete: terminal },
	{ id: "attempt-integration-repair", label: "Integration-repair Attempts", unit: "attempts", value: ({ projection }) => projection.totals.attemptKinds["integration-repair"], complete: terminal },
	{ id: "action-accept", label: "Accepted Attempts", unit: "attempts", value: ({ projection }) => projection.totals.actions.accept, complete: terminal },
	{ id: "action-retry", label: "Retry actions", unit: "actions", value: ({ projection }) => projection.totals.actions.retry, complete: terminal },
	{ id: "action-fallback", label: "Fallback actions", unit: "actions", value: ({ projection }) => projection.totals.actions.fallback, complete: terminal },
	{ id: "action-validation-repair", label: "Validation-repair actions", unit: "actions", value: ({ projection }) => projection.totals.actions["validation-repair"], complete: terminal },
	{ id: "action-integration-repair", label: "Integration-repair actions", unit: "actions", value: ({ projection }) => projection.totals.actions["integration-repair"], complete: terminal },
	{ id: "action-fail", label: "Failed Attempts", unit: "attempts", value: ({ projection }) => projection.totals.actions.fail, complete: terminal },
	{ id: "action-abort", label: "Aborted Attempts", unit: "attempts", value: ({ projection }) => projection.totals.actions.abort, complete: terminal },
	{ id: "input-tokens", label: "Input tokens", unit: "tokens", value: ({ projection }) => projection.totals.inputTokens, complete: telemetry },
	{ id: "output-tokens", label: "Output tokens", unit: "tokens", value: ({ projection }) => projection.totals.outputTokens, complete: telemetry },
	{ id: "cache-read-tokens", label: "Cache-read tokens", unit: "tokens", value: ({ projection }) => projection.totals.cacheReadTokens, complete: telemetry },
	{ id: "cache-write-tokens", label: "Cache-write tokens", unit: "tokens", value: ({ projection }) => projection.totals.cacheWriteTokens, complete: telemetry },
	{ id: "tokens", label: "Tokens", unit: "tokens", value: ({ projection }) => projection.totals.totalTokens, complete: telemetry },
	{ id: "estimated-cost", label: "Estimated cost", unit: "USD", value: ({ projection }) => projection.totals.estimatedCostUsd, complete: telemetry },
	{ id: "worker-duration", label: "Worker duration", unit: "ms", value: ({ projection }) => projection.totals.workerDurationMs, complete: telemetry },
	{ id: "provider-duration", label: "Provider duration", unit: "ms", value: ({ projection }) => projection.attempts.flatMap(({ outcome }) => outcome!.metrics.responses).reduce((total, response) => total + response.durationMs!, 0), complete: providerTelemetry, missingReason: () => "one or more contributors lack instrumented Provider Response timing" },
	{ id: "tool-duration", label: "Tool duration", unit: "ms", value: ({ projection }) => projection.totals.toolDurationMs, complete: telemetry },
	{ id: "poll-duration", label: "Poll duration", unit: "ms", value: ({ projection }) => projection.totals.pollDurationMs, complete: telemetry },
	{ id: "poll-count", label: "Poll count", unit: "polls", value: ({ projection }) => projection.totals.pollCount, complete: telemetry },
	{ id: "files-changed", label: "Files changed", unit: "files", value: ({ projection }) => projection.totals.filesChanged, complete: terminal },
	{ id: "insertions", label: "Insertions", unit: "lines", value: ({ projection }) => projection.totals.insertions, complete: terminal },
	{ id: "deletions", label: "Deletions", unit: "lines", value: ({ projection }) => projection.totals.deletions, complete: terminal },
	{ id: "accepted-transitions", label: "Accepted transitions", unit: "transitions", value: ({ projection }) => projection.acceptedLedger.length, complete: terminal },
	{ id: "final-validation-duration", label: "Final Validation duration", unit: "ms", value: ({ projection }) => projection.totals.finalValidationDurationMs, complete: validation, missingReason: () => "one or more contributors lack terminal Final Validation timing" },
];

export function queryComparison(snapshot: CatalogSnapshot, request: ComparisonRequest): Readonly<Record<string, any>> {
	const runA = selectRun(snapshot, request.runAId);
	const contextA = contextFor(snapshot, runA);
	const exactPacketRuns = contextA ? snapshot.executionRuns.filter((run) => run.projection && sameArtifact(run.projection.packet, contextA.projection.packet)) : [runA];
	return deepFreeze({
		generation: snapshot.generation,
		planningRunId: runA.planningRunId,
		pair: request.runBId ? comparePair(snapshot, runA, selectRun(snapshot, request.runBId)) : null,
		cohorts: cohortViews(snapshot, runA, exactPacketRuns),
	});
}

function comparePair(snapshot: CatalogSnapshot, runA: CatalogExecutionRun, runB: CatalogExecutionRun): Record<string, any> {
	const sources = comparisonSources(snapshot, [runA, runB]);
	const suppression = pairSuppression(runA, runB);
	if (suppression) return {
		status: "unavailable", direction: "Run B minus Run A", runAId: runA.selectionId, runBId: runB.selectionId, reason: suppression.reason, catalogue: null, deltas: [], omittedMetrics: [],
		receipt: createEvidenceReceipt(suppression.evidenceClass, "Pairwise deltas were suppressed because their exact admission requirements were not met", sources, suppression.missingInputs, [], ["No performance delta was calculated"], generationFor([runA, runB])),
	};
	const contextA = contextFor(snapshot, runA)!;
	const contextB = contextFor(snapshot, runB)!;
	const omittedMetrics = METRICS.filter((metric) => !metric.complete(contextA) || !metric.complete(contextB)).map((metric) => ({ id: metric.id, reason: metric.missingReason?.(contextA, contextB) ?? "one or more compared values are incomplete" }));
	const deltas = METRICS.flatMap((metric) => {
		if (!metric.complete(contextA) || !metric.complete(contextB)) return [];
		const a = metric.value(contextA);
		const b = metric.value(contextB);
		const percentage = a === 0 ? null : ((b - a) / a) * 100;
		return [{
			id: metric.id, label: metric.label, unit: metric.unit, runA: a, runB: b, delta: b - a, percentage,
			receipt: createEvidenceReceipt("Derived", `${metric.label}: Run B (${b}) - Run A (${a})`, sources, [], ["Exact Execution Packet identity", "completed live runs", "complete compared metric scope"], ["Direction is Run B minus Run A", ...(percentage === null ? ["Percentage unavailable because Run A is zero"] : [])]),
		}];
	});
	const evidenceClass: EvidenceClass = omittedMetrics.length ? "Partial" : "Derived";
	return {
		status: omittedMetrics.length ? "partial" : "available", direction: "Run B minus Run A", runAId: runA.selectionId, runBId: runB.selectionId, reason: "Exact same-packet completed-live comparison",
		catalogue: { runA: catalogue(contextA), runB: catalogue(contextB) }, deltas, omittedMetrics,
		receipt: createEvidenceReceipt(evidenceClass, "Fixed same-packet catalogue with each emitted numeric delta calculated as Run B minus Run A", sources, omittedMetrics.map(({ id }) => id), ["Exact Execution Packet identity", "completed live runs"], ["Descriptive arithmetic only"]),
	};
}

function pairSuppression(runA: CatalogExecutionRun, runB: CatalogExecutionRun): PairSuppression | null {
	if (runA.selectionId === runB.selectionId) return unavailable("pairwise deltas require two distinct runs", "distinct Run B");
	if (!runA.projection || !runB.projection || runA.admission !== "Current" || runB.admission !== "Current") return unavailable("both runs require current admitted Event Log replay", "two current admitted Event Logs");
	if (!sameArtifact(runA.projection.packet, runB.projection.packet)) return unavailable("runs do not share the exact same Execution Packet", "exact shared Execution Packet identity");
	if (runA.projection.mode !== "live" || runB.projection.mode !== "live" || runA.projection.terminalOutcome?.outcome !== "completed" || runB.projection.terminalOutcome?.outcome !== "completed") return unavailable("pairwise deltas require two completed live runs", "two completed live runs");
	if (!terminalProjection(runA.projection) || !terminalProjection(runB.projection) || !runA.projection.attempts.every(({ outcome }) => outcome?.metrics.complete) || !runB.projection.attempts.every(({ outcome }) => outcome?.metrics.complete)) return { reason: "pairwise deltas require complete compared scope", evidenceClass: "Partial", missingInputs: ["complete Attempt metric coverage"] };
	return null;
}

function cohortViews(snapshot: CatalogSnapshot, anchor: CatalogExecutionRun, runs: CatalogExecutionRun[]): Record<string, any>[] {
	const byOutcome = new Map<string, CatalogExecutionRun[]>();
	for (const run of runs) {
		if (run.admission !== "Current" || !run.projection) continue;
		const key = outcome(run);
		const group = byOutcome.get(key) ?? [];
		group.push(run);
		byOutcome.set(key, group);
	}
	return [...byOutcome].flatMap(([outcomeName, contributors]) => {
		if (contributors.length < 2) return [];
		const contexts = contributors.map((run) => contextFor(snapshot, run)!);
		const sources = comparisonSources(snapshot, contributors, anchor.planningRunId);
		const aggregates = METRICS.flatMap((metric) => {
			if (contexts.some((context) => !metric.complete(context))) return [];
			const values = contexts.map((context) => ({ runId: context.run.selectionId, value: metric.value(context) }));
			const ordered = values.map(({ value }) => value).sort((a, b) => a - b);
			const middle = Math.floor(ordered.length / 2);
			const median = ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
			return [{
				id: metric.id, label: metric.label, unit: metric.unit, count: values.length, minimum: ordered[0]!, median, maximum: ordered.at(-1)!, contributors: values,
				receipt: createEvidenceReceipt("Derived", `${metric.label}: sort contributor values; use the middle value for an odd count or the sum of the two middle values divided by two for an even count; minimum is first and maximum is last`, sources, [], ["Exact Execution Packet identity", `Outcome is ${outcomeName}`], ["Descriptive same-outcome aggregate only"]),
			}];
		});
		const omittedMetrics = METRICS.filter((metric) => contexts.some((context) => !metric.complete(context))).map(({ id }) => ({ id, reason: "one or more contributor values are incomplete" }));
		const partial = omittedMetrics.length > 0;
		return [{
			status: partial ? "partial" : "available", evidenceClass: partial ? "Partial" : "Derived", outcome: outcomeName, count: contributors.length,
			contributors: contributors.map(({ selectionId }) => selectionId), aggregates, omittedMetrics,
			receipt: createEvidenceReceipt(partial ? "Partial" : "Derived", `Exact same-packet runs grouped only by the ${outcomeName} outcome`, sources, omittedMetrics.map(({ id }) => id), ["Exact Execution Packet identity", `Outcome is ${outcomeName}`], ["At least two contributors are required"]),
		}];
	});
}

function catalogue(context: ComparisonContext): Record<string, unknown> {
	const { projection } = context;
	const attempts = projection.attempts.map(({ allocation, outcome }) => ({
		attemptId: allocation.attemptId, nodeId: allocation.nodeId, durationMs: outcome?.durationMs ?? null, kind: allocation.kind,
		action: outcome?.action ?? null, stage: outcome ? `${outcome.terminalFact.stage}/${outcome.terminalFact.code}` : null,
		metricsComplete: outcome?.metrics.complete ?? false,
	}));
	const pathFrequency = new Map<string, number>();
	for (const { transition } of projection.acceptedLedger) for (const path of transition.patch.changedPaths) pathFrequency.set(path, (pathFrequency.get(path) ?? 0) + 1);
	return {
		outcome: projection.terminalOutcome?.outcome ?? "incomplete",
		mode: projection.mode,
		completedScope: { complete: projection.terminalOutcome?.outcome === "completed" && projection.nodes.every(({ status }) => status === "succeeded") && projection.finalValidation.disposition === "passed", nodes: projection.nodes.map(({ id, status }) => ({ id, status })), finalValidation: projection.finalValidation.disposition },
		evidenceCoverage: { complete: telemetry(context), completeAttempts: projection.attempts.filter(({ outcome }) => outcome?.metrics.complete).length, attempts: projection.attempts.length },
		attempts,
		readinessQueue: context.queue,
		structuralPaths: { edges: context.lineage?.graph?.edges ?? null, criticalPath: context.lineage?.graph?.criticalPath ?? null },
		causalPaths: { nodes: projection.nodes.map(({ id, causalAttemptId, causalUpstreamNodeId }) => ({ id, causalAttemptId, causalUpstreamNodeId })), terminalCause: projection.terminalOutcome?.cause ?? null },
		observedRouting: projection.attempts.map(({ allocation }) => ({ attemptId: allocation.attemptId, nodeId: allocation.nodeId, tier: allocation.assignment.tier, provider: allocation.assignment.provider, model: allocation.assignment.model })),
		acceptedLedger: projection.acceptedLedger.map(({ eventSequence, attemptId, transition }) => ({ eventSequence, attemptId, baseTree: transition.patch.baseTree, resultTree: transition.patch.resultTree, changedPaths: transition.patch.changedPaths, stats: transition.patch.stats })),
		patchStatistics: { filesChanged: projection.totals.filesChanged, insertions: projection.totals.insertions, deletions: projection.totals.deletions },
		perPathTransitionFrequency: Object.fromEntries([...pathFrequency].sort(([left], [right]) => left.localeCompare(right))),
	};
}

function contextFor(snapshot: CatalogSnapshot, run: CatalogExecutionRun): ComparisonContext | null {
	if (!run.projection) return null;
	const lineage = snapshot.lineages.find(({ id }) => id === run.planningRunId);
	return { run, projection: run.projection, lineage, queue: readinessQueue(run, lineage) };
}

function readinessQueue(run: CatalogExecutionRun, lineage: CatalogWorkflowLineage | undefined): ReadinessQueue {
	const nodeIds = run.projection?.nodes.map(({ id }) => id) ?? [];
	const accepted = run.events.find(({ event, payload }) => event === "confirmation-decided" && payload.decision === "accepted")?.occurredAt ?? null;
	const contributors = nodeIds.map((nodeId) => {
		const predecessors = lineage?.graph?.edges.filter(([, to]) => to === nodeId).map(([from]) => from).filter((id) => nodeIds.includes(id)) ?? [];
		const predecessorTimes = predecessors.map((id) => run.events.find(({ event, payload }) => event === "node-completed" && payload.nodeId === id)?.occurredAt ?? null);
		const readyAt = predecessors.length ? predecessorTimes.every(Boolean) ? predecessorTimes.reduce((latest, value) => Date.parse(value!) > Date.parse(latest!) ? value : latest, predecessorTimes[0]) : null : accepted;
		const allocatedAt = run.events.find(({ event, payload }) => event === "attempt-allocated" && record(payload.allocation)?.nodeId === nodeId)?.occurredAt ?? null;
		const durationMs = readyAt && allocatedAt && Date.parse(allocatedAt) >= Date.parse(readyAt) ? Date.parse(allocatedAt) - Date.parse(readyAt) : null;
		return { nodeId, readyAt, allocatedAt, durationMs };
	});
	const missingInputs = contributors.flatMap(({ nodeId, readyAt, allocatedAt, durationMs }) => durationMs !== null ? [] : [`${nodeId}: ${readyAt ? "first allocation" : allocatedAt ? "readiness boundary" : "readiness boundary and first allocation"}`]);
	return { complete: nodeIds.length > 0 && missingInputs.length === 0, totalMs: missingInputs.length || !nodeIds.length ? null : contributors.reduce((total, { durationMs }) => total + durationMs!, 0), contributors, missingInputs };
}

function outcome(run: CatalogExecutionRun): string { return run.projection?.terminalOutcome?.outcome ?? "incomplete"; }
function terminalProjection(projection: ExecutionRunProjection): boolean { return projection.terminalOutcome !== null && projection.attempts.every(({ outcome }) => outcome !== null); }
function unavailable(reason: string, missingInput: string): PairSuppression { return { reason, evidenceClass: "Unavailable", missingInputs: [missingInput] }; }
function record(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }

function selectRun(snapshot: CatalogSnapshot, id: string): CatalogExecutionRun {
	const run = snapshot.executionRuns.find((candidate) => candidate.selectionId === id);
	if (!run) throw new TypeError("comparison run is not in the active snapshot");
	return run;
}

function comparisonSources(snapshot: CatalogSnapshot, runs: readonly CatalogExecutionRun[], planningRunId = runs[0]?.planningRunId): SourceReference[] {
	const lineageSources = snapshot.lineages.find(({ id }) => id === planningRunId)?.planningRun?.sources ?? [];
	return [...new Map([...lineageSources, ...runs.flatMap(({ sources }) => sources)].map((source) => [source.id, source])).values()];
}

function generationFor(runs: readonly CatalogExecutionRun[]): string {
	return executionArtifactGeneration(runs.map(({ admission }) => admission));
}
