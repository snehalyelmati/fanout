import { resolveExecutionEvidence, type ExecutionRunProjection } from "../../fanout-core/src/execution-projection";
import { FINAL_VALIDATION_NODE_ID } from "../../fanout-core/src/work-contract-graph";
import type { CatalogExecutionRun, CatalogSnapshot, SourceReference } from "./catalog";

export type SelectionKind = "run" | "node" | "attempt" | "turn" | "tool" | "event" | "stage";
export interface WorkspaceSelection { kind: SelectionKind; id: string; nodeId?: string; attemptId?: string; turnId?: string }
export interface WorkspaceRequest { runId?: string; selection?: WorkspaceSelection; sort?: "chronological" | "duration" }
export type EvidenceClass = "Observed" | "Derived" | "Partial" | "Legacy" | "Heterogeneous" | "Scenario" | "Unavailable";
export interface EvidenceReceipt {
	evidenceClass: EvidenceClass;
	artifactGeneration: string;
	sourceReferences: readonly SourceReference[];
	derivation: string;
	missingInputs: readonly string[];
	assumptions: readonly string[];
	limitations: readonly string[];
}
export interface TimingRow {
	id: string;
	parentId: string | null;
	depth: number;
	kind: "run" | "node" | "attempt" | "worker" | "turn" | "response" | "tool" | "poll" | "stage" | "final-validation";
	nodeId: string | null;
	attemptId: string | null;
	turnId: string | null;
	startMs: number | null;
	endMs: number | null;
	durationMs: number | null;
	placement: "absolute" | "unavailable";
	source: string;
	operation: string;
	outcome: string;
	selection: WorkspaceSelection;
}

const GENERATION = "Event v3 / Projection v4";

export function queryWorkspace(snapshot: CatalogSnapshot, request: WorkspaceRequest): Readonly<Record<string, any>> {
	const run = selectRun(snapshot, request.runId);
	const lineage = snapshot.lineages.find(({ id }) => id === run.planningRunId);
	const projection = run.projection;
	const selection = resolveSelection(run, request.selection ?? { kind: "run", id: run.selectionId });
	const artifactGeneration = run.admission === "Current" ? GENERATION : run.admission === "Legacy" ? "Legacy execution generation" : "Unverifiable execution generation";
	const receipt = (evidenceClass: EvidenceClass, derivation: string, missingInputs: string[] = [], limitations: string[] = [], sourceReferences: readonly SourceReference[] = run.sources): EvidenceReceipt => ({
		evidenceClass, artifactGeneration, sourceReferences, derivation, missingInputs, assumptions: [], limitations,
	});
	const rows = projection ? timingRows(projection, run) : [];
	const scopedRows = rows.filter((row) => rowInScope(row, selection));
	const ledger = [...scopedRows].sort(request.sort === "duration"
		? (a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1) || a.id.localeCompare(b.id)
		: (a, b) => (a.startMs ?? Number.POSITIVE_INFINITY) - (b.startMs ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id));
	const events = run.events.filter((event) => eventInScope(event, selection)).map((event) => ({
		sequence: event.sequence, occurredAt: event.occurredAt, event: event.event, summary: eventSummary(event.payload), fields: eventFields(event.payload), selection: { kind: "event", id: String(event.sequence) } satisfies WorkspaceSelection,
	}));
	const packetNodes = lineage?.packet?.nodes ?? [];
	const graph = lineage?.graph;
	const nodeStatus = new Map(projection?.nodes.map((node) => [node.id, node.status]) ?? []);
	if (projection) nodeStatus.set(FINAL_VALIDATION_NODE_ID, projection.finalValidation.disposition);
	const dagNodes = (graph?.topologicalOrder ?? packetNodes.map(({ id }) => id)).map((id, index) => {
		const level = graph?.parallelGroups.findIndex((group) => group.includes(id)) ?? index;
		const packetNode = packetNodes.find((node) => node.id === id);
		return { id, label: packetNode?.workContract.goals[0]?.statement ?? id, status: nodeStatus.get(id) ?? "pending", x: 24 + ((graph?.parallelGroups[level]?.indexOf(id) ?? 0) * 180), y: 24 + level * 84, selected: selectionNodeId(selection, projection) === id, selection: { kind: "node", id } satisfies WorkspaceSelection };
	});
	const scopedNodeIds = selection.kind === "run" || selection.kind === "event" && !selectionNodeId(selection, projection) ? packetNodes.map(({ id }) => id) : [selectionNodeId(selection, projection)].filter(Boolean);
	const routing = packetNodes.filter(({ id }) => scopedNodeIds.includes(id)).map((node) => ({
		nodeId: node.id,
		planned: { tier: node.tier.assigned, provider: node.tier.provider, model: node.tier.model },
		observed: (projection?.attempts ?? []).filter(({ allocation }) => allocation.nodeId === node.id).map(({ allocation }) => ({ attemptId: allocation.attemptId, tier: allocation.assignment.tier, provider: allocation.assignment.provider, model: allocation.assignment.model })),
	}));
	const breadcrumbs = breadcrumbsFor(run, projection, selection);
	const inspector = inspectorFor(run, projection, selection, receipt, lineage?.planningRun?.sources ?? []);
	return deepFreeze({
		generation: snapshot.generation,
		refreshedAt: snapshot.refreshedAt,
		objective: lineage?.packet?.objective ?? lineage?.planningRun?.objective ?? null,
		selection,
		breadcrumbs,
		recentRuns: snapshot.executionRuns.map((item) => ({ id: item.selectionId, runId: item.id, admission: item.admission, label: item.label, updatedAt: item.updatedAt, selected: item.selectionId === run.selectionId, selection: { kind: "run", id: item.selectionId } })),
		dag: { nodes: dagNodes, edges: (graph?.edges ?? []).map(([from, to]) => ({ from, to })) },
		waterfall: scopedRows,
		events,
		ledger,
		routing,
		metrics: projection ? metricViews(projection, scopedRows, selection, receipt) : [],
		inspector,
	});
}

function selectRun(snapshot: CatalogSnapshot, requested?: string): CatalogExecutionRun {
	const id = requested ?? snapshot.selectedExecutionRunId;
	const run = snapshot.executionRuns.find((candidate) => candidate.selectionId === id);
	if (!run) throw new TypeError("execution run is not in the active snapshot");
	return run;
}

function resolveSelection(run: CatalogExecutionRun, requested: WorkspaceSelection): WorkspaceSelection {
	if (requested.kind === "run") {
		if (requested.id !== run.selectionId && requested.id !== run.id) throw new TypeError("run selection is stale");
		return { kind: "run", id: run.selectionId };
	}
	const projection = run.projection;
	if (!projection) throw new TypeError("selection is unavailable for non-current evidence");
	if (requested.kind === "node") {
		resolveExecutionEvidence(projection, { nodeId: requested.id });
		return requested;
	}
	if (requested.kind === "event") {
		const event = run.events.find(({ sequence }) => String(sequence) === requested.id);
		if (!event) throw new TypeError("Event selection is stale");
		return { ...requested, ...eventIdentity(event.payload) };
	}
	if (requested.kind === "attempt" || requested.kind === "stage") {
		const context = resolveExecutionEvidence(projection, { attemptId: requested.id });
		return { ...requested, nodeId: context.node.id, attemptId: requested.id };
	}
	const context = resolveExecutionEvidence(projection, { attemptId: requested.attemptId, turnId: requested.kind === "turn" ? requested.id : requested.turnId, ...(requested.kind === "tool" ? { toolCallId: requested.id } : {}) });
	return { ...requested, nodeId: context.node.id, attemptId: context.attempt!.allocation.attemptId, turnId: context.turn!.turnId };
}

function timingRows(projection: ExecutionRunProjection, run: CatalogExecutionRun): TimingRow[] {
	const origin = Date.parse(projection.startedAt);
	const rows: TimingRow[] = [{ id: `run:${run.selectionId}`, parentId: null, depth: 0, kind: "run", nodeId: null, attemptId: null, turnId: null, startMs: 0, endMs: projection.terminalOutcome?.durationMs ?? null, durationMs: projection.terminalOutcome?.durationMs ?? null, placement: projection.terminalOutcome ? "absolute" : "unavailable", source: "Event Log", operation: "Execution Run wall-clock boundary", outcome: projection.terminalOutcome?.outcome ?? projection.phase, selection: { kind: "run", id: run.selectionId } }];
	const appendAttempt = (attempt: ExecutionRunProjection["attempts"][number], parentId: string) => {
		const { allocation, outcome } = attempt;
		const attemptId = `attempt:${allocation.attemptId}`;
		rows.push(row(attemptId, parentId, "attempt", allocation.nodeId, allocation.attemptId, null, origin, outcome?.startedAt, outcome?.finishedAt, outcome?.durationMs, "Attempt Outcome", `${allocation.kind} Attempt envelope`, outcome?.action ?? "incomplete", { kind: "attempt", id: allocation.attemptId }));
		if (!outcome) return;
		const metrics = outcome.metrics;
		rows.push(row(`stage:${allocation.attemptId}`, attemptId, "stage", allocation.nodeId, allocation.attemptId, null, origin, undefined, undefined, undefined, "Attempt Outcome", `${outcome.terminalFact.stage}/${outcome.terminalFact.code}`, outcome.action, { kind: "stage", id: allocation.attemptId }));
		rows.push(row(`worker:${allocation.attemptId}`, attemptId, "worker", allocation.nodeId, allocation.attemptId, null, origin, undefined, undefined, metrics.workerDurationMs, "Attempt metrics", "Worker measured work", "completed", { kind: "attempt", id: allocation.attemptId }));
		for (const turn of metrics.turns) {
			const turnId = `turn:${allocation.attemptId}:${turn.turnId}`;
			rows.push(row(turnId, attemptId, "turn", allocation.nodeId, allocation.attemptId, turn.turnId, origin, turn.requestedAt, turn.finishedAt, turn.durationMs, "Worker Turn metrics", `${turn.provider}/${turn.model}`, turn.terminal, { kind: "turn", id: turn.turnId, attemptId: allocation.attemptId }));
			for (const response of metrics.responses.filter((item) => item.turnId === turn.turnId)) rows.push(row(`response:${response.responseId}`, turnId, "response", allocation.nodeId, allocation.attemptId, turn.turnId, origin, response.requestedAt, response.finishedAt, response.durationMs, "Provider Response metrics", `${response.provider}/${response.model}`, response.terminal, { kind: "turn", id: turn.turnId, attemptId: allocation.attemptId }));
			for (const tool of metrics.tools.filter((item) => item.turnId === turn.turnId)) rows.push(row(`tool:${tool.toolCallId}`, turnId, "tool", allocation.nodeId, allocation.attemptId, turn.turnId, origin, tool.startedAt, tool.finishedAt, tool.durationMs, "Tool Invocation metrics", tool.name, tool.terminal, { kind: "tool", id: tool.toolCallId, attemptId: allocation.attemptId, turnId: turn.turnId }));
			for (const poll of metrics.polls.filter((item) => item.turnId === turn.turnId)) rows.push(row(`poll:${poll.pollId}`, turnId, "poll", allocation.nodeId, allocation.attemptId, turn.turnId, origin, undefined, undefined, poll.durationMs, "Provider Poll metrics", poll.status, poll.status, { kind: "turn", id: turn.turnId, attemptId: allocation.attemptId }));
		}
	};
	for (const node of projection.nodes) {
		const nodeAttempts = projection.attempts.filter(({ allocation }) => allocation.nodeId === node.id);
		const outcomes = nodeAttempts.flatMap(({ outcome }) => outcome ? [outcome] : []);
		const complete = outcomes.length === nodeAttempts.length && outcomes.length > 0;
		const startedAt = complete ? outcomes.reduce((earliest, outcome) => Date.parse(outcome.startedAt) < Date.parse(earliest) ? outcome.startedAt : earliest, outcomes[0]!.startedAt) : undefined;
		const finishedAt = complete ? outcomes.reduce((latest, outcome) => Date.parse(outcome.finishedAt) > Date.parse(latest) ? outcome.finishedAt : latest, outcomes[0]!.finishedAt) : undefined;
		const nodeRowId = `node:${node.id}`;
		rows.push(row(nodeRowId, `run:${run.selectionId}`, "node", node.id, null, null, origin, startedAt, finishedAt, undefined, "Derived from Attempt envelopes", node.id, node.status, { kind: "node", id: node.id }));
		for (const attempt of nodeAttempts) appendAttempt(attempt, nodeRowId);
	}
	const started = run.events.find(({ event }) => event === "final-validation-started");
	const completed = run.events.find(({ event }) => event === "final-validation-completed");
	rows.push(row(FINAL_VALIDATION_NODE_ID, `run:${run.selectionId}`, "final-validation", FINAL_VALIDATION_NODE_ID, null, null, origin, started?.occurredAt, completed?.occurredAt, projection.finalValidation.disposition === "passed" || projection.finalValidation.disposition === "failed" ? projection.finalValidation.durationMs : undefined, "Event Log", "Final Validation", projection.finalValidation.disposition, { kind: "node", id: FINAL_VALIDATION_NODE_ID }));
	for (const attempt of projection.attempts.filter(({ allocation }) => allocation.nodeId === FINAL_VALIDATION_NODE_ID)) appendAttempt(attempt, FINAL_VALIDATION_NODE_ID);
	return rows;
}

function row(id: string, parentId: string, kind: TimingRow["kind"], nodeId: string | null, attemptId: string | null, turnId: string | null, origin: number, start: string | undefined, end: string | undefined, duration: number | undefined, source: string, operation: string, outcome: string, selection: WorkspaceSelection): TimingRow {
	const startMs = start === undefined ? null : Date.parse(start) - origin;
	const endMs = end === undefined ? null : Date.parse(end) - origin;
	const depth = kind === "node" || kind === "final-validation" ? 1 : kind === "attempt" ? 2 : kind === "worker" || kind === "turn" || kind === "stage" ? 3 : 4;
	return { id, parentId, depth, kind, nodeId, attemptId, turnId, startMs, endMs, durationMs: duration ?? (startMs !== null && endMs !== null ? endMs - startMs : null), placement: startMs === null || endMs === null ? "unavailable" : "absolute", source, operation, outcome, selection };
}

function rowInScope(row: TimingRow, selection: WorkspaceSelection): boolean {
	if (selection.kind === "run") return true;
	if (selection.kind === "event") return selection.attemptId ? row.attemptId === selection.attemptId : selection.nodeId ? row.nodeId === selection.nodeId : true;
	if (selection.kind === "node") return row.nodeId === selection.id;
	if (selection.kind === "attempt" || selection.kind === "stage") return row.attemptId === selection.id;
	if (selection.kind === "turn") return row.attemptId === selection.attemptId && row.turnId === selection.id;
	return row.kind === "tool" && row.attemptId === selection.attemptId && row.turnId === selection.turnId && row.selection.id === selection.id;
}

function eventInScope(event: CatalogExecutionRun["events"][number], selection: WorkspaceSelection): boolean {
	if (selection.kind === "run") return true;
	if (selection.kind === "event") return String(event.sequence) === selection.id;
	const identity = eventIdentity(event.payload);
	const nodeId = selection.kind === "node" ? selection.id : selection.nodeId;
	const attemptId = selection.kind === "attempt" || selection.kind === "stage" ? selection.id : selection.attemptId;
	return attemptId ? identity.attemptId === attemptId : nodeId ? identity.nodeId === nodeId : false;
}

function eventIdentity(payload: Record<string, unknown>): { nodeId?: string; attemptId?: string } {
	const nested = (payload.allocation ?? payload.outcome ?? payload) as Record<string, unknown>;
	const cause = typeof payload.cause === "object" && payload.cause !== null ? payload.cause as Record<string, unknown> : {};
	return { ...(typeof nested.nodeId === "string" ? { nodeId: nested.nodeId } : typeof cause.nodeId === "string" ? { nodeId: cause.nodeId } : {}), ...(typeof nested.attemptId === "string" ? { attemptId: nested.attemptId } : typeof cause.attemptId === "string" ? { attemptId: cause.attemptId } : {}) };
}

function eventSummary(payload: Record<string, unknown>): string {
	const identity = eventIdentity(payload);
	return [identity.nodeId, identity.attemptId].filter(Boolean).join(" · ") || "Run-wide transition";
}

function eventFields(payload: Record<string, unknown>): Array<[string, string]> {
	return Object.entries(payload).map(([name, value]) => [name, typeof value === "string" ? value : JSON.stringify(value)]);
}

function selectionNodeId(selection: WorkspaceSelection, projection: ExecutionRunProjection | null): string | null {
	if (selection.kind === "node") return selection.id;
	if (selection.nodeId) return selection.nodeId;
	const attemptId = selection.kind === "attempt" || selection.kind === "stage" ? selection.id : selection.attemptId;
	if (attemptId) return projection?.attempts.find(({ allocation }) => allocation.attemptId === attemptId)?.allocation.nodeId ?? null;
	return null;
}

function breadcrumbsFor(run: CatalogExecutionRun, projection: ExecutionRunProjection | null, selection: WorkspaceSelection): Array<WorkspaceSelection & { label: string }> {
	const crumbs: Array<WorkspaceSelection & { label: string }> = [{ kind: "run", id: run.selectionId, label: run.id }];
	if (selection.kind === "run") return crumbs;
	if (selection.kind === "event") {
		if (selection.nodeId) crumbs.push({ kind: "node", id: selection.nodeId, label: selection.nodeId });
		if (selection.attemptId) crumbs.push({ kind: "attempt", id: selection.attemptId, label: selection.attemptId });
		return [...crumbs, { ...selection, label: `Event ${selection.id}` }];
	}
	const nodeId = selectionNodeId(selection, projection);
	if (nodeId) crumbs.push({ kind: "node", id: nodeId, label: nodeId });
	const attemptId = selection.kind === "attempt" || selection.kind === "stage" ? selection.id : selection.attemptId;
	if (attemptId) crumbs.push({ kind: "attempt", id: attemptId, label: attemptId });
	if (selection.kind === "turn" || selection.kind === "tool") crumbs.push({ kind: "turn", id: selection.kind === "turn" ? selection.id : selection.turnId!, attemptId, label: selection.kind === "turn" ? selection.id : selection.turnId! });
	if (selection.kind === "tool") crumbs.push({ ...selection, label: selection.id });
	if (selection.kind === "stage") crumbs.push({ ...selection, label: "Stage Fact" });
	return crumbs;
}

function inspectorFor(run: CatalogExecutionRun, projection: ExecutionRunProjection | null, selection: WorkspaceSelection, receipt: (evidenceClass: EvidenceClass, derivation: string, missingInputs?: string[], limitations?: string[], sources?: readonly SourceReference[]) => EvidenceReceipt, packetSources: readonly SourceReference[]): Record<string, unknown> {
	const sources = [...packetSources, ...run.sources];
	if (selection.kind === "run") return { title: run.id, kind: "Execution Run", fields: [["Admission", run.admission], ["Outcome", run.label]], receipt: receipt(run.admission === "Current" ? "Observed" : run.admission === "Legacy" ? "Legacy" : "Unavailable", run.reason, run.projection ? [] : ["admitted current Event Log"], [], sources) };
	if (selection.kind === "event") {
		const event = run.events.find(({ sequence }) => String(sequence) === selection.id)!;
		return { title: event.event, kind: "Run Event", fields: [["Sequence", String(event.sequence)], ["Occurred", event.occurredAt], ...eventFields(event.payload)], receipt: receipt("Observed", "Validated immutable Run Event from the authoritative Event Log", [], [], sources) };
	}
	const attemptId = selection.kind === "attempt" || selection.kind === "stage" ? selection.id : selection.attemptId;
	const attempt = projection && attemptId ? resolveExecutionEvidence(projection, { attemptId }).attempt : null;
	if (selection.kind === "stage" && attempt?.outcome) return { title: `${attempt.outcome.terminalFact.stage}/${attempt.outcome.terminalFact.code}`, kind: "Stage Fact", fields: [["Controller action", attempt.outcome.action], ["Stage Fact", `${attempt.outcome.terminalFact.stage}/${attempt.outcome.terminalFact.code}`]], receipt: receipt("Observed", "Typed terminal Stage Fact and controller action from Attempt Outcome v3", [], [], sources) };
	if (selection.kind === "tool" && attempt?.outcome) {
		const tool = attempt.outcome.metrics.tools.find(({ toolCallId, turnId }) => toolCallId === selection.id && turnId === selection.turnId)!;
		return { title: tool.name, kind: "Tool Invocation", fields: [["Tool ID", tool.toolCallId], ["Duration", show(tool.durationMs)]], receipt: receipt("Observed", "Correlated Tool Invocation interval from Attempt Outcome v3", tool.durationMs === undefined ? ["tool duration"] : [], [], sources) };
	}
	if (selection.kind === "turn" && attempt?.outcome) {
		const turn = attempt.outcome.metrics.turns.find(({ turnId }) => turnId === selection.id)!;
		return { title: turn.turnId, kind: "Worker Turn", fields: [["Provider", turn.provider], ["Model", turn.model], ["Tier", turn.tier]], receipt: receipt("Observed", "Correlated Worker Turn from Attempt Outcome v3", [], [], sources) };
	}
	if (attempt) return { title: attempt.allocation.attemptId, kind: "Attempt", fields: [["Kind", attempt.allocation.kind], ["Observed routing", `${attempt.allocation.assignment.tier} · ${attempt.allocation.assignment.provider}/${attempt.allocation.assignment.model}`], ["Controller action", attempt.outcome?.action ?? "unknown"]], relatedSelections: attempt.outcome ? [{ label: "Stage Fact", selection: { kind: "stage", id: attempt.allocation.attemptId } }] : [], receipt: receipt(attempt.outcome ? "Observed" : "Partial", "Attempt allocation and admitted terminal outcome", attempt.outcome ? [] : ["terminal Attempt Outcome"], [], sources) };
	const node = projection?.nodes.find(({ id }) => id === selection.id);
	if (selection.id === FINAL_VALIDATION_NODE_ID && projection) return { title: selection.id, kind: "DAG Node", fields: [["Observed state", projection.finalValidation.disposition]], receipt: receipt("Derived", "Packet topology joined to Final Validation state replayed through fanout-core", [], ["Packet topology is structural; validation disposition is replay state"], sources) };
	return { title: selection.id, kind: "DAG Node", fields: [["Observed state", node?.status ?? "unknown"]], receipt: receipt(node ? "Derived" : "Unavailable", "Packet topology joined to Node state replayed through fanout-core", node ? [] : ["current replayed Node state"], ["Packet topology is structural; Node status is observed replay state"], sources) };
}

function metricViews(projection: ExecutionRunProjection, scopedRows: TimingRow[], selection: WorkspaceSelection, receipt: (evidenceClass: EvidenceClass, derivation: string, missingInputs?: string[], limitations?: string[]) => EvidenceReceipt): Record<string, unknown>[] {
	const selectedAttemptId = selection.kind === "attempt" || selection.kind === "stage" ? selection.id : selection.attemptId;
	const attempts = projection.attempts.filter(({ allocation }) => selectedAttemptId ? allocation.attemptId === selectedAttemptId : selection.kind === "node" || selection.nodeId ? allocation.nodeId === (selection.kind === "node" ? selection.id : selection.nodeId) : true);
	const metrics = attempts.flatMap(({ outcome }) => outcome ? [outcome.metrics] : []);
	const sum = (values: Array<number | undefined>, required = true): number | null => values.length && (!required || values.every((value) => value !== undefined)) ? values.reduce((total, value) => total + (value ?? 0), 0) : null;
	const view = (id: string, label: string, value: number | null, unit: string, category: string, evidenceClass: "Observed" | "Derived", derivation: string, limitation?: string) => ({ id, label, value, unit, category, evidenceClass: value === null ? "Unavailable" : evidenceClass, receipt: receipt(value === null ? "Unavailable" : evidenceClass, derivation, value === null ? [label] : [], limitation ? [limitation] : []) });
	const turns = selection.kind === "tool" ? [] : metrics.flatMap(({ turns }) => turns.filter(({ turnId }) => selection.kind !== "turn" || turnId === selection.id));
	const views = [
		...(selection.kind === "run" || selection.kind === "event" && !selection.nodeId && !selection.attemptId ? [view("run-duration", "Run duration", projection.terminalOutcome?.durationMs ?? null, "ms", "wall-clock-boundary", "Observed", "Terminal Run Event duration is the authoritative execution boundary")] : []),
		view("attempt-envelopes", "Attempt envelopes", sum(scopedRows.filter(({ kind }) => kind === "attempt").map(({ durationMs }) => durationMs ?? undefined)), "ms", "overlapping-measured-work", "Derived", "Sum of selected Attempt Outcome envelopes", "Concurrent Attempt envelopes may overlap and are not a wall-clock partition"),
		view("worker-duration", "Worker duration", sum(scopedRows.filter(({ kind }) => kind === "worker").map(({ durationMs }) => durationMs ?? undefined)), "ms", "overlapping-measured-work", "Derived", "Sum of recorded worker durations", "Measured work may overlap other rows"),
		view("provider-duration", "Provider duration", sum(scopedRows.filter(({ kind }) => kind === "response").map(({ durationMs }) => durationMs ?? undefined)), "ms", "overlapping-measured-work", "Derived", "Sum of correlated Provider Response durations", "Measured work may overlap other rows"),
		view("tool-duration", "Tool duration", sum(scopedRows.filter(({ kind }) => kind === "tool").map(({ durationMs }) => durationMs ?? undefined)), "ms", "overlapping-measured-work", "Derived", "Sum of correlated Tool Invocation durations", "Measured work may overlap other rows"),
		view("poll-duration", "Poll duration", sum(scopedRows.filter(({ kind }) => kind === "poll").map(({ durationMs }) => durationMs ?? undefined)), "ms", "overlapping-measured-work", "Derived", "Sum of correlated Provider Poll durations", "Poll durations have no absolute placement"),
		view("tokens", "Tokens", turns.length ? turns.reduce((total, turn) => total + turn.totalTokens, 0) : null, "tokens", "usage", "Derived", "Sum of selected Worker Turn total tokens"),
		view("cost", "Estimated cost", turns.length ? turns.reduce((total, turn) => total + turn.costUsd, 0) : null, "USD", "usage", "Derived", "Sum of selected Worker Turn recorded cost"),
	];
	return views;
}

function show(value: number | undefined): string { return value === undefined ? "unknown" : String(value); }
function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
