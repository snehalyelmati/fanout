import { deepFreeze } from "../../fanout-core/src/contract-value";
import { requireExecutionRun, type CatalogExecutionRun, type CatalogSnapshot, type SourceReference } from "./catalog";
import { createEvidenceReceipt, executionArtifactGeneration, type EvidenceReceipt } from "./workspace";

type DiagnosticRule = "ready-work-waited-with-free-capacity" | "attempt-causally-replaced";
export type DiagnosticSort = "duration" | "cost" | "frequency" | "chronology";
export interface DiagnosticRequest { runId?: string; sort?: DiagnosticSort }

interface DiagnosticObservation {
	id: string;
	rule: DiagnosticRule;
	subjectId: string;
	relatedId: string | null;
	title: string;
	occurredAt: string;
	chronologyMs: number;
	durationMs: number;
	costUsd: number | null;
	frequency: number;
	evidence: Readonly<Record<string, unknown>>;
	receipt: EvidenceReceipt;
}

interface DiagnosticSuppression { rule: DiagnosticRule; subjectId: string; reason: string }

const WAIT_RULE: DiagnosticRule = "ready-work-waited-with-free-capacity";
const REPLACEMENT_RULE: DiagnosticRule = "attempt-causally-replaced";
const RECOVERY_ACTIONS = new Set(["retry", "fallback", "validation-repair", "integration-repair"]);
const MINIMUM_WAIT_MS = 100;

export function queryDiagnostics(snapshot: CatalogSnapshot, request: DiagnosticRequest): Readonly<Record<string, any>> {
	const run = requireExecutionRun(snapshot, request.runId);
	const sort = request.sort ?? "chronology";
	const observations: DiagnosticObservation[] = [];
	const suppressions: DiagnosticSuppression[] = [];
	if (run.admission !== "Current" || !run.projection) {
		const reason = `${run.admission} execution evidence cannot support Diagnostic Observations.`;
		return deepFreeze({ runId: run.selectionId, sort, observations, suppressions: [{ rule: WAIT_RULE, subjectId: run.id, reason }, { rule: REPLACEMENT_RULE, subjectId: run.id, reason }] });
	}
	const lineage = snapshot.lineages.find(({ id }) => id === run.planningRunId);
	const sourceReferences = [...(lineage?.planningRun?.sources ?? []), ...run.sources];
	if (run.projection.mode !== "live") {
		const reason = "Dry-run evidence contains no admitted execution allocation.";
		return deepFreeze({ runId: run.selectionId, sort, observations, suppressions: [{ rule: WAIT_RULE, subjectId: run.id, reason }, { rule: REPLACEMENT_RULE, subjectId: run.id, reason }] });
	}
	if (lineage?.graph) readinessObservations(run, lineage.graph.edges, sourceReferences, observations, suppressions);
	else suppressions.push({ rule: WAIT_RULE, subjectId: run.id, reason: "Execution Packet dependency evidence is unavailable." });
	replacementObservations(run, sourceReferences, observations, suppressions);
	observations.sort(sorter(sort));
	return deepFreeze({ runId: run.selectionId, sort, observations, suppressions });
}

function readinessObservations(run: CatalogExecutionRun, edges: readonly (readonly [string, string])[], sourceReferences: readonly SourceReference[], observations: DiagnosticObservation[], suppressions: DiagnosticSuppression[]): void {
	const projection = run.projection!;
	const origin = Date.parse(projection.startedAt);
	const confirmation = run.events.find(({ event, payload }) => event === "confirmation-decided" && payload.decision === "accepted");
	const policyEvent = run.events.find(({ event }) => event === "run-started");
	const maxConcurrency = projection.policy.maxConcurrency;
	const suppressAll = (reason: string) => { for (const node of projection.nodes) suppressions.push({ rule: WAIT_RULE, subjectId: node.id, reason }); };
	if (!confirmation) return suppressAll("Accepted confirmation evidence is unavailable.");
	if (!policyEvent) return suppressAll("The run-started capacity policy Event is unavailable.");
	if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) return suppressAll("Recorded maxConcurrency evidence is unavailable.");
	const eventBySequence = new Map(run.events.map((event) => [event.sequence, event]));
	const predecessorsByNode = new Map(projection.nodes.map(({ id }) => [id, [] as string[]]));
	for (const [from, to] of edges) predecessorsByNode.get(to)?.push(from);
	const firstAllocations = new Map<string, { sequence: number; occurredAt: string; time: number }>();
	const seenNodes = new Set<string>();
	for (const attempt of projection.attempts) {
		if (seenNodes.has(attempt.allocation.nodeId)) continue;
		seenNodes.add(attempt.allocation.nodeId);
		const allocationEvent = eventBySequence.get(attempt.allocationSequence);
		if (allocationEvent?.event !== "attempt-allocated") return suppressAll(`The first allocation Event is unavailable for Node ${attempt.allocation.nodeId}.`);
		firstAllocations.set(attempt.allocation.nodeId, timed(allocationEvent));
	}
	const completedNodes = run.events.filter(({ event }) => event === "node-completed");
	const capacityCompletions = new Map(completedNodes.map((event) => [String(event.payload.nodeId), { ...timed(event), sequence: event.sequence }]));
	const successfulCompletions = new Map(completedNodes.filter(({ payload }) => payload.status === "succeeded").map((event) => [String(event.payload.nodeId), { ...timed(event), sequence: event.sequence }]));
	const occupancy = [...firstAllocations].map(([nodeId, start]) => ({ start, end: capacityCompletions.get(nodeId) ?? null }));
	if (Date.parse(confirmation.occurredAt) < origin || occupancy.some(({ start, end }) => end && end.time < start.time)) {
		for (const node of projection.nodes) suppressions.push({ rule: WAIT_RULE, subjectId: node.id, reason: "Recorded readiness or capacity chronology is unavailable." });
		return;
	}

	for (const node of projection.nodes) {
		const allocation = firstAllocations.get(node.id);
		if (!allocation) {
			suppressions.push({ rule: WAIT_RULE, subjectId: node.id, reason: `Node ${node.id} has no recorded first allocation.` });
			continue;
		}
		const predecessors = predecessorsByNode.get(node.id) ?? [];
		let readiness: { kind: "accepted-confirmation" | "successful-predecessors"; occurredAt: string; time: number; eventSequence?: number; predecessorNodeIds?: string[]; eventSequences?: number[] };
		if (!predecessors.length) readiness = { kind: "accepted-confirmation", ...timed(confirmation), eventSequence: confirmation.sequence };
		else {
			const evidence = predecessors.map((id) => successfulCompletions.get(id));
			if (evidence.some((item) => !item)) {
				suppressions.push({ rule: WAIT_RULE, subjectId: node.id, reason: `Successful completion evidence is unavailable for predecessor ${predecessors[evidence.findIndex((item) => !item)]}.` });
				continue;
			}
			const latest = evidence.reduce((left, right) => right!.time > left!.time ? right : left)!;
			if (latest.time < Date.parse(confirmation.occurredAt)) {
				suppressions.push({ rule: WAIT_RULE, subjectId: node.id, reason: "Recorded predecessor completion chronology precedes accepted confirmation." });
				continue;
			}
			readiness = { kind: "successful-predecessors", occurredAt: latest.occurredAt, time: latest.time, predecessorNodeIds: predecessors, eventSequences: evidence.map((item) => item!.sequence) };
		}
		if (allocation.time < readiness.time) {
			suppressions.push({ rule: WAIT_RULE, subjectId: node.id, reason: `Node ${node.id} was allocated before its recorded readiness evidence.` });
			continue;
		}
		const free = freeCapacity(readiness.time, allocation.time, maxConcurrency, occupancy);
		if (free.durationMs < MINIMUM_WAIT_MS) {
			suppressions.push({ rule: WAIT_RULE, subjectId: node.id, reason: `Recorded free-capacity overlap was ${free.durationMs} ms, below the inclusive ${MINIMUM_WAIT_MS} ms threshold.` });
			continue;
		}
		const evidence = {
			readiness: readiness.kind === "accepted-confirmation"
				? { kind: readiness.kind, eventSequence: readiness.eventSequence }
				: { kind: readiness.kind, predecessorNodeIds: readiness.predecessorNodeIds, eventSequences: readiness.eventSequences },
			firstAllocationEventSequence: allocation.sequence,
			capacity: { maxConcurrency, policyEventSequence: policyEvent.sequence, eventSequences: free.eventSequences },
		};
		observations.push({
			id: `${WAIT_RULE}:${node.id}`, rule: WAIT_RULE, subjectId: node.id, relatedId: null,
			title: `Runnable Node ${node.id} waited with recorded free Fanout capacity`, occurredAt: readiness.occurredAt, chronologyMs: readiness.time - origin,
			durationMs: free.durationMs, costUsd: null, frequency: free.windows, evidence,
			receipt: createEvidenceReceipt("Derived", "Free-capacity overlap is the intersection of Node readiness through first allocation with recorded Node occupancy below run maxConcurrency", sourceReferences, [], [], ["Descriptive observation only"], executionArtifactGeneration([run.admission])),
		});
	}
}

function replacementObservations(run: CatalogExecutionRun, sourceReferences: readonly SourceReference[], observations: DiagnosticObservation[], suppressions: DiagnosticSuppression[]): void {
	const projection = run.projection!;
	const origin = Date.parse(projection.startedAt);
	const eventBySequence = new Map(run.events.map((event) => [event.sequence, event]));
	const replacementBySource = new Map(projection.attempts.flatMap((attempt) => attempt.allocation.sourceAttemptId ? [[attempt.allocation.sourceAttemptId, attempt] as const] : []));
	const frequencies = new Map<string, number>();
	for (const { allocation } of projection.attempts) if (allocation.sourceAttemptId) {
		const key = `${allocation.nodeId}\0${allocation.kind}`;
		frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
	}
	for (const sourceAttempt of projection.attempts) {
		const action = sourceAttempt.outcome?.action;
		if (!action || !RECOVERY_ACTIONS.has(action)) continue;
		const replacement = replacementBySource.get(sourceAttempt.allocation.attemptId);
		if (!replacement || replacement.allocationSequence <= (sourceAttempt.completionSequence ?? Number.MAX_SAFE_INTEGER) || replacement.allocation.kind !== action) {
			suppressions.push({ rule: REPLACEMENT_RULE, subjectId: sourceAttempt.allocation.attemptId, reason: `Attempt ${sourceAttempt.allocation.attemptId} recorded ${action} intent, but no later admitted ${action} allocation names it as source.` });
			continue;
		}
		if (!sourceAttempt.outcome!.metrics.complete) {
			suppressions.push({ rule: REPLACEMENT_RULE, subjectId: sourceAttempt.allocation.attemptId, reason: `Attempt ${sourceAttempt.allocation.attemptId} has incomplete metrics, so sortable cost evidence is unavailable.` });
			continue;
		}
		const sourceEvent = eventBySequence.get(sourceAttempt.completionSequence!);
		const allocationEvent = eventBySequence.get(replacement.allocationSequence);
		if (sourceEvent?.event !== "attempt-completed" || allocationEvent?.event !== "attempt-allocated") {
			suppressions.push({ rule: REPLACEMENT_RULE, subjectId: sourceAttempt.allocation.attemptId, reason: `Attempt ${sourceAttempt.allocation.attemptId} lacks the admitted completion or causal allocation Event required to prove replacement.` });
			continue;
		}
		const frequency = frequencies.get(`${sourceAttempt.allocation.nodeId}\0${action}`)!;
		const costUsd = sourceAttempt.outcome!.metrics.turns.reduce((sum, turn) => sum + turn.costUsd, 0);
		observations.push({
			id: `${REPLACEMENT_RULE}:${sourceAttempt.allocation.attemptId}`, rule: REPLACEMENT_RULE, subjectId: sourceAttempt.allocation.attemptId, relatedId: replacement.allocation.attemptId,
			title: `Non-accepted Attempt ${sourceAttempt.allocation.attemptId} was causally replaced`, occurredAt: allocationEvent.occurredAt, chronologyMs: Date.parse(allocationEvent.occurredAt) - origin,
			durationMs: sourceAttempt.outcome!.durationMs, costUsd, frequency,
			evidence: { sourceCompletionEventSequence: sourceEvent.sequence, replacementAllocationEventSequence: allocationEvent.sequence, action, sourceAttemptId: sourceAttempt.allocation.attemptId, replacementAttemptId: replacement.allocation.attemptId },
			receipt: createEvidenceReceipt("Derived", "A later admitted recovery allocation names the non-accepted source Attempt and matches its recorded controller action", sourceReferences, [], [], ["Descriptive observation only"], executionArtifactGeneration([run.admission])),
		});
	}
}

function freeCapacity(start: number, end: number, limit: number, occupancy: readonly { start: { time: number; sequence: number }; end: { time: number; sequence: number } | null }[]): { durationMs: number; windows: number; eventSequences: number[] } {
	// ponytail: O(Node²) interval scans are bounded by packet size; replace with one run-wide sweep if the #59 query benchmark misses 250 ms.
	const overlapping = occupancy.filter((item) => item.start.time < end && (item.end?.time ?? Number.POSITIVE_INFINITY) > start);
	const boundaries = [...new Set([start, end, ...overlapping.flatMap((item) => [item.start.time, item.end?.time].filter((time): time is number => time !== undefined && time > start && time < end))])].sort((a, b) => a - b);
	let durationMs = 0;
	let windows = 0;
	let freeBefore = false;
	for (let index = 0; index < boundaries.length - 1; index++) {
		const segmentStart = boundaries[index]!;
		const segmentEnd = boundaries[index + 1]!;
		const free = overlapping.filter((item) => item.start.time <= segmentStart && (item.end?.time ?? Number.POSITIVE_INFINITY) > segmentStart).length < limit;
		if (free) { durationMs += segmentEnd - segmentStart; if (!freeBefore) windows++; }
		freeBefore = free;
	}
	return { durationMs, windows, eventSequences: [...new Set(overlapping.flatMap((item) => [item.start.sequence, item.end?.sequence].filter((sequence): sequence is number => sequence !== undefined)))].sort((a, b) => a - b) };
}

function sorter(sort: DiagnosticSort): (left: DiagnosticObservation, right: DiagnosticObservation) => number {
	const value = (item: DiagnosticObservation): number | null => sort === "duration" ? item.durationMs : sort === "cost" ? item.costUsd : sort === "frequency" ? item.frequency : item.chronologyMs;
	return (left, right) => {
		const a = value(left); const b = value(right);
		if (a === null) return b === null ? left.chronologyMs - right.chronologyMs || left.id.localeCompare(right.id) : 1;
		if (b === null) return -1;
		return (sort === "chronology" ? a - b : b - a) || left.chronologyMs - right.chronologyMs || left.id.localeCompare(right.id);
	};
}

function timed(event: { sequence: number; occurredAt: string }): { sequence: number; occurredAt: string; time: number } {
	return { sequence: event.sequence, occurredAt: event.occurredAt, time: Date.parse(event.occurredAt) };
}
