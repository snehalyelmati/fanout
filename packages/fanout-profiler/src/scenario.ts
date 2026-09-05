import { deepFreeze } from "../../fanout-core/src/contract-value";
import { deriveAttemptMetricTotals } from "../../fanout-core/src/attempt-metrics";
import type { AttemptProjection, ExecutionRunProjection } from "../../fanout-core/src/execution-projection";
import type { StageFact } from "../../fanout-core/src/execution-attempt";
import type { AcceptedPatch } from "../../fanout-core/src/artifact-identity";
import { requireExecutionRun, type CatalogExecutionRun, type CatalogSnapshot, type SourceReference } from "./catalog";
import { buildProviderPlan, parseProviderProfiles, type ProviderAttemptInput, type ProviderCallSchedule, type ProviderCostSummary, type ProviderProfiles, type ProviderTierSchedule, type ProviderTurnSchedule } from "./provider-profile";
import { createEvidenceReceipt, executionArtifactGeneration, type EvidenceReceipt } from "./workspace";

export type { ProviderProfile, ProviderProfiles } from "./provider-profile";

export type ScenarioConcurrency =
	| { mode: "observed" }
	| { mode: "sequential" }
	| { mode: "custom"; limit: number }
	| { mode: "unlimited" };

export interface ScenarioRequest { runId?: string; concurrency: ScenarioConcurrency; providerProfiles?: ProviderProfiles }

interface RecordedAttempt {
	attempt: AttemptProjection;
	allocationEpochMs: number;
	allocationMs: number;
	completionMs: number | null;
}

interface RecordedNode {
	nodeId: string;
	allocationOrder: number;
	dependencies: string[];
	attempts: RecordedAttempt[];
	startMs: number;
	executionEndMs: number;
	completedMs: number;
	completionLagMs: number;
	acceptedAttemptId: string | null;
	complete: boolean;
}

interface ScheduledNode extends RecordedNode {
	attemptStarts: Record<string, number>;
	attemptEnds: Record<string, number>;
	attemptReadiness: Record<string, number>;
	attemptWaits: Record<string, number>;
	readinessMs: number;
	fanoutWaitMs: number;
	acceptanceGateWaitMs: number;
}

type ScenarioNodeSchedule = Omit<ScheduledNode, "attempts" | "attemptStarts" | "attemptEnds" | "attemptReadiness" | "attemptWaits" | "allocationOrder" | "completionLagMs">;
interface ScenarioProviderConstraint { id: string; completedMs: number }
interface ScenarioNodeRow extends ScenarioNodeSchedule {
	providerWaitMs?: number; ttftMs?: number; generationMs?: number; toolMs?: number; scenarioCostUsd?: number | null; uncoveredMs?: number; providerConstraint?: ScenarioProviderConstraint;
}
interface ScenarioAttemptRow {
	nodeId: string; attemptId: string; tier: "tier1" | "tier2"; kind: AttemptProjection["allocation"]["kind"]; sourceAttemptId: string | null; action: NonNullable<AttemptProjection["outcome"]>["action"] | null;
	readinessMs: number | null; fanoutWaitMs: number | null; startMs: number; endMs: number | null; durationMs: number | null; coveredEndMs: number; coveredDurationMs: number; uncoveredMs: number; terminalFact: StageFact | null;
	providerWaitMs?: number; ttftMs?: number; generationMs?: number; toolMs?: number; localMs?: number | null; scenarioCostUsd?: number | null;
}
interface ScenarioTurnRow extends ProviderTurnSchedule { startMs: number; endMs: number }
interface ScenarioResponseRow extends ProviderCallSchedule { startMs: number; endMs: number }
interface ScenarioToolRow { nodeId: string; attemptId: string; toolCallId: string; name: string; startMs: number; endMs: number; durationMs: number }
interface ScenarioAcceptanceRow { ledgerIndex: number; attemptId: string; readyMs: number | null; acceptedMs: number | null; waitMs: number | null; patch: AcceptedPatch }
interface ScenarioSchedule {
	nodes: ScenarioNodeRow[];
	attempts: ScenarioAttemptRow[];
	turns: ScenarioTurnRow[];
	responses: ScenarioResponseRow[];
	tools: ScenarioToolRow[];
	validations: Array<{ attemptId: string | null; terminalFact: StageFact | { stage: "final-validation"; code: string } | null }>;
	acceptanceGate: ScenarioAcceptanceRow[];
	finalValidation: { startMs: number; endMs: number; durationMs: number; outcome: string; complete: boolean } | null;
	fanout: { capacityWaitMs: number; acceptanceGateWaitMs: number };
	provider?: { capacityWaitMs: number };
	tiers: ProviderTierSchedule[];
	uncoveredMs: number;
}
interface CompletionChainEntry { kind: "node" | "fanout-capacity" | "provider-capacity" | "acceptance" | "final-validation" | "recorded-prefix" | "run"; id: string; completedMs?: number }
interface PreservedScenarioEvidence { packetEdges: string[][]; nodeIds: string[]; attemptIds: string[]; turnIds: string[]; toolCallIds: string[]; outcomeActions: string[]; acceptedLedgerAttemptIds: string[]; acceptedTransitions: ExecutionRunProjection["acceptedLedger"][number]["transition"][]; tierAssignments: Array<"tier1" | "tier2">; responseIds: string[] }
interface ScenarioResult {
	status: "available" | "partial" | "dry-run"; statement: string; configuration: { mode: ScenarioConcurrency["mode"]; limit: number | null; providerProfiles: ProviderProfiles };
	observedBoundaryMs: number | null; scenarioBoundaryMs: number | null; deltaMs: number | null; cost: ProviderCostSummary;
	coverage: { kind: "complete" | "recorded-prefix" | "dry-run"; lastEventSequence: number }; preserved: PreservedScenarioEvidence; schedule: ScenarioSchedule; completionChain: CompletionChainEntry[]; receipt: EvidenceReceipt;
}

const STATEMENT = "Under these fixed assumptions, the calculated result is deterministic schedule arithmetic over fixed recorded behavior and outcomes; it is not a forecast, quality claim, routing claim, or recommendation.";

export function queryScenario(snapshot: CatalogSnapshot, request: ScenarioRequest): Readonly<ScenarioResult> {
	const selectedConfiguration = configurationFor(request.concurrency);
	const providerProfiles = parseProviderProfiles(request.providerProfiles);
	const run = requireExecutionRun(snapshot, request.runId);
	const projection = run.projection;
	const lineage = snapshot.lineages.find(({ id }) => id === run.planningRunId);
	if (run.admission !== "Current" || !projection || !lineage?.graph || !lineage.packet) throw new TypeError("scenario requires one current admitted Event Log, Execution Packet, and replayed projection");
	const configuration = { ...(selectedConfiguration.mode === "observed" ? { ...selectedConfiguration, limit: projection.policy.maxConcurrency } : selectedConfiguration), providerProfiles };
	const sources = uniqueSources([...(lineage.planningRun?.sources ?? []), ...run.sources]);
	const receipt = (missing: string[] = [], limitations: string[] = []) => createEvidenceReceipt(
		"Scenario",
		"Recorded post-confirmation work is held fixed; selected Fanout concurrency and per-tier Provider Profiles change deterministic scheduling and cost arithmetic",
		sources,
		missing,
		["Recorded packet dependencies, Attempts, Turns, tokens, tools, outcomes, and Accepted Ledger order remain fixed", `Fanout concurrency mode is ${configuration.mode}${configuration.limit === null ? "" : ` with limit ${configuration.limit}`}`, `Tier 1 mapping is ${JSON.stringify(providerProfiles.tier1)}`, `Tier 2 mapping is ${JSON.stringify(providerProfiles.tier2)}`, "Profile call duration is TTFT plus output tokens divided by output tokens per second; cost applies displayed per-million rates"],
		["No work, quality, routing, conflict, or provider behavior is predicted", ...limitations],
		executionArtifactGeneration([run.admission]),
		projection.profile,
	);
	const preserved = preservedEvidence(projection, lineage.graph.edges);
	if (projection.mode === "dry-run") return deepFreeze({
		status: "dry-run", statement: STATEMENT, configuration, observedBoundaryMs: null, scenarioBoundaryMs: null, deltaMs: null, cost: { status: "unavailable", observedUsd: null, scenarioUsd: null, deltaUsd: null },
		coverage: { kind: "dry-run", lastEventSequence: projection.lastEventSequence }, preserved,
		schedule: emptySchedule(), completionChain: [], receipt: receipt([], ["Dry runs contain no post-confirmation work and have no meaningful schedule delta"]),
	});
	const confirmation = confirmationEvent(run, projection);
	const observedBoundaryMs = authoritativeBoundary(run, projection, confirmation);
	const partialAttempts = projection.attempts.filter(({ outcome }) => outcome && !outcome.metrics.complete);
	if (partialAttempts.length) {
		const knownCosts = projection.attempts.flatMap(({ outcome }) => outcome && outcome.metrics.turns.some((turn) => turn.costUsd !== undefined || outcome.metrics.responses.some((response) => response.turnId === turn.turnId && response.costUsd !== undefined)) ? [deriveAttemptMetricTotals(outcome.metrics).observedCostUsd] : []);
		return deepFreeze({ status: "partial", statement: STATEMENT, configuration, observedBoundaryMs, scenarioBoundaryMs: null, deltaMs: null,
			cost: { status: knownCosts.length ? "partial" : "unavailable", observedUsd: knownCosts.length ? Math.round(knownCosts.reduce((total, cost) => total + cost, 0) * 1e12) / 1e12 : null, scenarioUsd: null, deltaUsd: null },
			coverage: { kind: "recorded-prefix", lastEventSequence: projection.lastEventSequence }, preserved, schedule: emptySchedule(), completionChain: [],
			receipt: receipt(partialAttempts.map(({ allocation }) => `complete Attempt measurements: ${allocation.attemptId}`), ["Partial measurements do not support schedule alternatives or comparable totals; recorded evidence remains inspectable"]),
		});
	}
	const complete = projection.terminalOutcome?.outcome === "completed";
	const recorded = recordedNodes(run, projection, lineage.graph.edges, confirmation, observedBoundaryMs);
	const observed = observedSchedule(recorded, run, projection, confirmation);
	validateObservedBaseline(recorded, observed, run, projection, confirmation, observedBoundaryMs);
	const capacity = configuration.mode === "unlimited" ? Math.max(1, projection.attempts.length) : configuration.limit!;
	let simulated = configuration.mode === "observed" ? observed : simulate(recorded, run, projection, confirmation, capacity, observedBoundaryMs, complete);
	let providerPlan = buildProviderPlan(providerInputs(recorded, simulated.schedule, observedBoundaryMs), providerProfiles);
	if (providerProfiles.tier1.mode !== "observed" || providerProfiles.tier2.mode !== "observed") {
		const maxRounds = projection.attempts.length + projection.attempts.reduce((total, attempt) => total + (attempt.outcome?.metrics.turns.length ?? 0), 0) + 2;
		for (let round = 0; round < maxRounds; round++) {
			const next = simulate(recorded, run, projection, confirmation, capacity, observedBoundaryMs, complete, providerPlan.durationOverrides);
			const nextPlan = buildProviderPlan(providerInputs(recorded, next.schedule, observedBoundaryMs), providerProfiles);
			simulated = next;
			if (sameDurations(providerPlan.durationOverrides, nextPlan.durationOverrides)) { providerPlan = nextPlan; break; }
			providerPlan = nextPlan;
			if (round === maxRounds - 1) throw new TypeError("Provider Profile schedule did not reach a deterministic fixed point");
		}
	}
	simulated.schedule.turns = providerPlan.turns.map((turn) => ({ ...turn, startMs: turn.issueMs, endMs: turn.providerEndMs }));
	simulated.schedule.responses = providerPlan.responses.map((call) => ({ ...call, startMs: call.issueMs, endMs: call.providerEndMs }));
	const toolSchedule = new Map(providerPlan.tools.map((tool) => [tool.toolCallId, tool]));
	simulated.schedule.tools = simulated.schedule.tools.map((tool) => ({ ...tool, ...(toolSchedule.has(tool.toolCallId) ? { startMs: toolSchedule.get(tool.toolCallId)!.startMs, endMs: toolSchedule.get(tool.toolCallId)!.endMs } : {}) }));
	simulated.schedule.tiers = providerPlan.tiers;
	addProviderBreakdowns(simulated.schedule);
	const status = complete ? "available" : "partial";
	const scenarioBoundaryMs = complete ? simulated.boundaryMs : simulated.coveredBoundaryMs;
	const missing = [
		...(complete ? [] : ["terminal post-confirmation execution boundary"]),
		...(providerPlan.cost.status === "available" ? [] : ["complete recorded provider-call usage for scenario cost"]),
	];
	return deepFreeze({
		status, statement: STATEMENT, configuration, observedBoundaryMs, scenarioBoundaryMs,
		deltaMs: complete ? scenarioBoundaryMs - observedBoundaryMs : null,
		coverage: complete
			? { kind: "complete", lastEventSequence: projection.lastEventSequence }
			: { kind: "recorded-prefix", lastEventSequence: projection.lastEventSequence },
		preserved, cost: providerPlan.cost,
		schedule: simulated.schedule,
		completionChain: complete ? completionChain(simulated.schedule.nodes, simulated.schedule.finalValidation, run.id) : prefixCompletionChain(simulated.schedule.nodes, simulated.schedule.finalValidation, projection.lastEventSequence),
		receipt: receipt(missing, complete ? [] : ["The calculation covers only the admitted recorded prefix; no missing work or duration was invented"]),
	});
}

function configurationFor(concurrency: ScenarioConcurrency): { mode: ScenarioConcurrency["mode"]; limit: number | null } {
	if (!concurrency || typeof concurrency !== "object" || !["observed", "sequential", "custom", "unlimited"].includes(concurrency.mode)) throw new TypeError("concurrency mode must be observed, sequential, custom, or unlimited");
	if (concurrency.mode === "custom" && (!Number.isSafeInteger(concurrency.limit) || concurrency.limit < 1)) throw new TypeError("custom concurrency must be a positive safe integer");
	return { mode: concurrency.mode, limit: concurrency.mode === "sequential" ? 1 : concurrency.mode === "custom" ? concurrency.limit : null };
}

function confirmationEvent(run: CatalogExecutionRun, projection: ExecutionRunProjection): CatalogExecutionRun["events"][number] {
	if (projection.confirmation !== "accepted" || projection.confirmationEventSequence === null) throw new TypeError("scenario requires accepted post-confirmation execution evidence");
	const event = run.events.find(({ sequence }) => sequence === projection.confirmationEventSequence);
	if (event?.event !== "confirmation-decided" || event.payload.decision !== "accepted") throw new TypeError("accepted confirmation Event is unavailable");
	return event;
}

function authoritativeBoundary(run: CatalogExecutionRun, projection: ExecutionRunProjection, confirmation: CatalogExecutionRun["events"][number]): number {
	const end = projection.terminalOutcome ? run.events.at(-1) : run.events.find(({ sequence }) => sequence === projection.lastEventSequence);
	if (!end || projection.terminalOutcome && end.event !== "run-finished") throw new TypeError("observed baseline has no authoritative execution boundary");
	const boundary = Date.parse(end.occurredAt) - Date.parse(confirmation.occurredAt);
	const runDuration = Date.parse(end.occurredAt) - Date.parse(projection.startedAt);
	if (boundary < 0 || projection.terminalOutcome && (projection.terminalOutcome.durationMs < runDuration || projection.finishedAt !== end.occurredAt)) throw new TypeError("observed baseline does not reproduce the authoritative observed execution boundary exactly");
	return boundary;
}

function validateObservedBaseline(nodes: RecordedNode[], observed: SimulationResult, run: CatalogExecutionRun, projection: ExecutionRunProjection, confirmation: CatalogExecutionRun["events"][number], authoritative: number): void {
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	for (const node of nodes) {
		const dependencyEnd = node.dependencies.reduce((latest, id) => Math.max(latest, byId.get(id)?.completedMs ?? 0), 0);
		if (node.startMs < dependencyEnd) throw new TypeError("observed baseline violates recorded packet dependencies");
	}
	const attemptIntervals = nodes.flatMap((node) => node.attempts.map(({ allocationMs, completionMs }) => ({ startMs: allocationMs, endMs: completionMs ?? authoritative })));
	const boundaries = [...new Set(attemptIntervals.flatMap(({ startMs, endMs }) => [startMs, endMs]))].sort((left, right) => left - right);
	for (let index = 0; index < boundaries.length - 1; index++) if (attemptIntervals.filter(({ startMs, endMs }) => startMs <= boundaries[index]! && endMs > boundaries[index]!).length > projection.policy.maxConcurrency) throw new TypeError("observed baseline exceeds recorded Fanout concurrency");
	let priorLedgerTime = Number.NEGATIVE_INFINITY;
	for (const entry of projection.acceptedLedger) {
		const event = run.events.find(({ sequence }) => sequence === entry.eventSequence);
		if (event?.event !== "attempt-completed" || event.payload.outcome && (event.payload.outcome as Record<string, unknown>).attemptId !== entry.attemptId) throw new TypeError("observed baseline Accepted Ledger evidence is unavailable");
		const time = Date.parse(event.occurredAt) - Date.parse(confirmation.occurredAt);
		if (time < priorLedgerTime) throw new TypeError("observed baseline Accepted Ledger chronology is not ordered");
		priorLedgerTime = time;
	}
	if (projection.terminalOutcome?.outcome === "completed" && nodes.filter(({ complete }) => complete).length !== projection.nodes.length || observed.boundaryMs !== authoritative) throw new TypeError("observed baseline does not reproduce the authoritative observed execution boundary exactly");
}

function recordedNodes(run: CatalogExecutionRun, projection: ExecutionRunProjection, edges: readonly (readonly [string, string])[], confirmation: CatalogExecutionRun["events"][number], prefixBoundaryMs: number): RecordedNode[] {
	const origin = Date.parse(confirmation.occurredAt);
	const eventBySequence = new Map(run.events.map((event) => [event.sequence, event]));
	const ledgerAttempts = new Set(projection.acceptedLedger.map(({ attemptId }) => attemptId));
	return projection.nodes.flatMap((node) => {
		const attempts = projection.attempts.filter(({ allocation }) => allocation.nodeId === node.id).map((attempt): RecordedAttempt => {
			const allocation = eventBySequence.get(attempt.allocationSequence);
			const completion = attempt.completionSequence === null ? null : eventBySequence.get(attempt.completionSequence);
			if (allocation?.event !== "attempt-allocated" || completion && completion.event !== "attempt-completed") throw new TypeError(`recorded Attempt chronology is unavailable for ${attempt.allocation.attemptId}`);
			return { attempt, allocationEpochMs: Date.parse(allocation.occurredAt), allocationMs: Date.parse(allocation.occurredAt) - origin, completionMs: completion ? Date.parse(completion.occurredAt) - origin : null };
		});
		const completedAttempts = attempts.filter((attempt): attempt is RecordedAttempt & { completionMs: number } => attempt.completionMs !== null);
		const nodeCompletion = node.completionSequence === null ? null : eventBySequence.get(node.completionSequence);
		if (!attempts.length || nodeCompletion && nodeCompletion.event !== "node-completed") return [];
		const startMs = attempts[0]!.allocationMs;
		const executionEndMs = attempts.some(({ completionMs }) => completionMs === null) ? prefixBoundaryMs : completedAttempts.at(-1)?.completionMs ?? attempts.at(-1)!.allocationMs;
		const completedMs = nodeCompletion ? Date.parse(nodeCompletion.occurredAt) - origin : executionEndMs;
		if (startMs < 0 || executionEndMs < startMs || completedMs < executionEndMs) throw new TypeError(`recorded Node chronology is unavailable for ${node.id}`);
		return [{
			nodeId: node.id, allocationOrder: attempts[0]!.attempt.allocationSequence,
			dependencies: edges.filter(([, to]) => to === node.id).map(([from]) => from).filter((id) => projection.nodes.some((item) => item.id === id)),
			attempts, startMs, executionEndMs, completedMs, completionLagMs: completedMs - executionEndMs,
			acceptedAttemptId: completedAttempts.map(({ attempt }) => attempt.allocation.attemptId).findLast((id) => ledgerAttempts.has(id)) ?? null,
			complete: Boolean(nodeCompletion),
		}];
	}).sort((left, right) => left.allocationOrder - right.allocationOrder || left.nodeId.localeCompare(right.nodeId));
}

function observedSchedule(nodes: RecordedNode[], run: CatalogExecutionRun, projection: ExecutionRunProjection, confirmation: CatalogExecutionRun["events"][number]): SimulationResult {
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	const scheduled: ScheduledNode[] = nodes.map((node) => {
		const readinessMs = node.dependencies.reduce((latest, id) => Math.max(latest, byId.get(id)?.completedMs ?? 0), 0);
		const accepted = node.acceptedAttemptId ? node.attempts.find(({ attempt }) => attempt.allocation.attemptId === node.acceptedAttemptId) : undefined;
		const acceptedCandidateMs = accepted?.attempt.outcome ? Date.parse(accepted.attempt.outcome.finishedAt) - Date.parse(confirmation.occurredAt) : node.executionEndMs;
		const attemptStarts = Object.fromEntries(node.attempts.map(({ attempt, allocationMs }) => [attempt.allocation.attemptId, allocationMs]));
		const attemptEnds = Object.fromEntries(node.attempts.flatMap(({ attempt, completionMs }) => completionMs === null ? [] : [[attempt.allocation.attemptId, completionMs]]));
		const attemptReadiness = Object.fromEntries(node.attempts.map(({ attempt }, index) => [attempt.allocation.attemptId, index === 0 ? readinessMs : node.attempts[index - 1]!.completionMs ?? node.attempts[index - 1]!.allocationMs]));
		const attemptWaits = Object.fromEntries(node.attempts.map(({ attempt, allocationMs }) => [attempt.allocation.attemptId, Math.max(0, allocationMs - attemptReadiness[attempt.allocation.attemptId]!) ]));
		const acceptanceGateWaitMs = node.acceptedAttemptId ? Math.max(0, (attemptEnds[node.acceptedAttemptId] ?? acceptedCandidateMs) - acceptedCandidateMs) : 0;
		return { ...node, executionEndMs: acceptedCandidateMs, attemptStarts, attemptEnds, attemptReadiness, attemptWaits, readinessMs, fanoutWaitMs: Object.values(attemptWaits).reduce((sum, wait) => sum + wait, 0), acceptanceGateWaitMs };
	});
	const nodeEnd = scheduled.reduce((latest, node) => Math.max(latest, node.completedMs), 0);
	const end = run.events.at(-1)!;
	const tailMs = Date.parse(end.occurredAt) - Date.parse(confirmation.occurredAt) - nodeEnd;
	if (tailMs < 0) throw new TypeError("observed baseline completion chronology exceeds the authoritative boundary");
	return resultFor(scheduled, run, projection, confirmation, nodeEnd + tailMs, nodeEnd);
}

interface SimulationResult { boundaryMs: number; coveredBoundaryMs: number; schedule: ScenarioSchedule }

function simulate(nodes: RecordedNode[], run: CatalogExecutionRun, projection: ExecutionRunProjection, confirmation: CatalogExecutionRun["events"][number], limit: number, observedBoundaryMs: number, complete: boolean, durationOverrides: ReadonlyMap<string, number> = new Map()): SimulationResult {
	const terminalNodes = nodes;
	const completedNodes = new Map<string, number>();
	const nextAttempt = new Map(terminalNodes.map(({ nodeId }) => [nodeId, 0]));
	const nextReady = new Map<string, number>();
	const scheduled = terminalNodes.map((node): ScheduledNode => ({ ...node, attemptStarts: {}, attemptEnds: {}, attemptReadiness: {}, attemptWaits: {}, startMs: -1, executionEndMs: -1, completedMs: -1, readinessMs: -1, fanoutWaitMs: 0, acceptanceGateWaitMs: 0 }));
	const running: Array<{ node: ScheduledNode; recorded: RecordedAttempt; candidateMs: number; waitingForGate: boolean }> = [];
	const candidates = new Map<string, number>();
	const gate = projection.acceptedLedger.filter(({ attemptId }) => terminalNodes.some((node) => node.acceptedAttemptId === attemptId));
	const acceptedAttempts = new Map(terminalNodes.flatMap(({ attempts }) => attempts.map((attempt) => [attempt.attempt.allocation.attemptId, attempt] as const)));
	const gateLags = new Map(gate.map((entry, index) => [entry.attemptId, recordedGateLag(acceptedAttempts.get(entry.attemptId)!, acceptedAttempts.get(gate[index - 1]?.attemptId ?? ""))]));
	let gateIndex = 0;
	let now = 0;
	const readyAt = (node: ScheduledNode, index: number): number | null => {
		if (index > 0) return nextReady.get(node.nodeId) ?? null;
		if (!node.dependencies.every((id) => completedNodes.has(id) || !terminalNodes.some((item) => item.nodeId === id))) return null;
		return node.dependencies.reduce((latest, id) => Math.max(latest, completedNodes.get(id) ?? 0), 0);
	};
	while (scheduled.some((node) => nextAttempt.get(node.nodeId)! < node.attempts.length) || running.length) {
		const available = () => scheduled.flatMap((node) => {
			if (running.some((item) => item.node.nodeId === node.nodeId)) return [];
			const index = nextAttempt.get(node.nodeId)!;
			if (index >= node.attempts.length) return [];
			const readinessMs = readyAt(node, index);
			return readinessMs === null ? [] : [{ node, index, readinessMs, recorded: node.attempts[index]! }];
		}).sort((left, right) => left.readinessMs - right.readinessMs || left.recorded.attempt.allocationSequence - right.recorded.attempt.allocationSequence || left.node.nodeId.localeCompare(right.node.nodeId));
		let ready = available().filter(({ readinessMs }) => readinessMs <= now);
		while (running.length < limit && ready.length) {
			const item = ready.shift()!;
			const attemptId = item.recorded.attempt.allocation.attemptId;
			const accepted = attemptId === item.node.acceptedAttemptId;
			const durationMs = durationOverrides.get(attemptId) ?? (accepted && item.recorded.attempt.outcome ? Date.parse(item.recorded.attempt.outcome.finishedAt) - item.recorded.allocationEpochMs : (item.recorded.completionMs ?? observedBoundaryMs) - item.recorded.allocationMs);
			item.node.attemptStarts[attemptId] = now;
			item.node.attemptReadiness[attemptId] = item.readinessMs;
			item.node.attemptWaits[attemptId] = now - item.readinessMs;
			item.node.fanoutWaitMs += now - item.readinessMs;
			if (item.index === 0) { item.node.startMs = now; item.node.readinessMs = item.readinessMs; }
			running.push({ node: item.node, recorded: item.recorded, candidateMs: now + durationMs, waitingForGate: false });
			ready = available().filter(({ readinessMs }) => readinessMs <= now);
		}
		const nextExecution = Math.min(...running.filter(({ waitingForGate }) => !waitingForGate).map(({ candidateMs }) => candidateMs), Number.POSITIVE_INFINITY);
		const nextGate = gate[gateIndex];
		const gateItem = nextGate ? running.find(({ recorded, waitingForGate }) => waitingForGate && recorded.attempt.allocation.attemptId === nextGate.attemptId) : undefined;
		const gateReady = gateItem ? candidates.get(nextGate!.attemptId)! + gateLags.get(nextGate!.attemptId)! : Number.POSITIVE_INFINITY;
		const nextEligibility = running.length < limit ? available()[0]?.readinessMs ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
		const next = Math.min(nextExecution, nextEligibility, gateReady);
		if (!Number.isFinite(next)) {
			if (running.length) throw new TypeError("fixed recorded acceptance order cannot be scheduled under selected Fanout capacity");
			break;
		}
		now = Math.max(now, next);
		for (const item of running.filter(({ waitingForGate, candidateMs }) => !waitingForGate && candidateMs === now).sort((left, right) => left.recorded.attempt.allocationSequence - right.recorded.attempt.allocationSequence)) {
			const attemptId = item.recorded.attempt.allocation.attemptId;
			item.node.executionEndMs = now;
			if (attemptId === item.node.acceptedAttemptId) {
				item.waitingForGate = true;
				candidates.set(attemptId, now);
			}
			else {
				running.splice(running.indexOf(item), 1);
				item.node.attemptEnds[attemptId] = now;
				const index = nextAttempt.get(item.node.nodeId)! + 1;
				nextAttempt.set(item.node.nodeId, index);
				nextReady.set(item.node.nodeId, now);
				if (index === item.node.attempts.length) { item.node.completedMs = now + item.node.completionLagMs; completedNodes.set(item.node.nodeId, item.node.completedMs); }
			}
		}
		while (gateIndex < gate.length) {
			const entry = gate[gateIndex]!;
			const item = running.find(({ recorded }) => recorded.attempt.allocation.attemptId === entry.attemptId)!;
			const candidateMs = candidates.get(entry.attemptId);
			if (!item?.waitingForGate || candidateMs === undefined || candidateMs + gateLags.get(entry.attemptId)! > now) break;
			item.node.acceptanceGateWaitMs = now - candidateMs;
			item.node.attemptEnds[entry.attemptId] = now;
			item.node.completedMs = now + item.node.completionLagMs;
			completedNodes.set(item.node.nodeId, item.node.completedMs);
			nextAttempt.set(item.node.nodeId, nextAttempt.get(item.node.nodeId)! + 1);
			running.splice(running.indexOf(item), 1);
			gateIndex++;
		}
	}
	if (complete && scheduled.length !== projection.nodes.length) throw new TypeError("complete scenario is missing recorded Node work");
	const observedNodeEnd = terminalNodes.reduce((latest, node) => Math.max(latest, node.completedMs), 0);
	const scenarioNodeEnd = scheduled.reduce((latest, node) => Math.max(latest, node.completedMs), 0);
	const tailMs = Math.max(0, observedBoundaryMs - observedNodeEnd);
	const boundaryMs = scenarioNodeEnd + tailMs;
	return resultFor(scheduled, run, projection, confirmation, boundaryMs, boundaryMs);
}

function resultFor(nodes: ScheduledNode[], run: CatalogExecutionRun | null, projection: ExecutionRunProjection, confirmation: CatalogExecutionRun["events"][number] | null, boundaryMs: number, coveredBoundaryMs: number): SimulationResult {
	const attemptRows = nodes.flatMap((node) => node.attempts.map(({ attempt, allocationEpochMs, allocationMs, completionMs }) => {
		const attemptId = attempt.allocation.attemptId;
		const startMs = node.attemptStarts[attemptId] ?? allocationMs;
		const endMs = completionMs === null ? null : node.attemptEnds[attemptId] ?? startMs + completionMs - allocationMs;
		const coveredEndMs = endMs ?? node.executionEndMs;
		const coveredDurationMs = coveredEndMs - startMs;
		return { nodeId: node.nodeId, attemptId, tier: attempt.allocation.assignment.tier, kind: attempt.allocation.kind, sourceAttemptId: attempt.allocation.sourceAttemptId ?? null, action: attempt.outcome?.action ?? null, readinessMs: node.attemptReadiness[attemptId] ?? null, fanoutWaitMs: node.attemptWaits[attemptId] ?? null, startMs, endMs, durationMs: endMs === null ? null : endMs - startMs, coveredEndMs, coveredDurationMs, uncoveredMs: Math.max(0, coveredDurationMs - coveredDuration(attempt, allocationEpochMs)), terminalFact: attempt.outcome?.terminalFact ?? null };
	})).sort((left, right) => projection.attempts.findIndex(({ allocation }) => allocation.attemptId === left.attemptId) - projection.attempts.findIndex(({ allocation }) => allocation.attemptId === right.attemptId));
	const attemptStart = new Map(attemptRows.map((attempt) => [attempt.attemptId, attempt.startMs]));
	const turnRows = nodes.flatMap((node) => node.attempts.flatMap(({ attempt, allocationEpochMs }) => (attempt.outcome?.metrics.turns ?? []).map((turn): ScenarioTurnRow => ({
		nodeId: node.nodeId, attemptId: attempt.allocation.attemptId, turnId: turn.turnId, tier: turn.tier, responseIds: [...turn.responseIds],
		issueMs: attemptStart.get(attempt.allocation.attemptId)! + Date.parse(turn.requestedAt) - allocationEpochMs,
		providerStartMs: attemptStart.get(attempt.allocation.attemptId)! + Date.parse(turn.requestedAt) - allocationEpochMs,
		providerEndMs: attemptStart.get(attempt.allocation.attemptId)! + Date.parse(turn.finishedAt) - allocationEpochMs,
		providerWaitMs: 0, ttftMs: Date.parse(turn.firstOutputAt) - Date.parse(turn.requestedAt), generationMs: Date.parse(turn.finishedAt) - Date.parse(turn.firstOutputAt), durationMs: turn.durationMs, warmth: "observed",
		observedCostUsd: turn.costUsd, scenarioCostUsd: turn.costUsd, costStatus: "available", capacityPredecessorIds: [],
		startMs: attemptStart.get(attempt.allocation.attemptId)! + Date.parse(turn.requestedAt) - allocationEpochMs, endMs: attemptStart.get(attempt.allocation.attemptId)! + Date.parse(turn.finishedAt) - allocationEpochMs,
	}))));
	const toolRows = nodes.flatMap((node) => node.attempts.flatMap(({ attempt, allocationEpochMs }) => (attempt.outcome?.metrics.tools ?? []).map((tool): ScenarioToolRow => ({
		nodeId: node.nodeId, attemptId: attempt.allocation.attemptId, toolCallId: tool.toolCallId, name: tool.name,
		startMs: attemptStart.get(attempt.allocation.attemptId)! + Date.parse(tool.startedAt) - allocationEpochMs,
		endMs: attemptStart.get(attempt.allocation.attemptId)! + Date.parse(tool.finishedAt) - allocationEpochMs, durationMs: tool.durationMs,
	}))));
	const acceptedReady = new Map(nodes.filter(({ acceptedAttemptId }) => acceptedAttemptId).map((node) => [node.acceptedAttemptId!, node.executionEndMs]));
	const acceptedCompleted = new Map(nodes.filter(({ acceptedAttemptId }) => acceptedAttemptId).map((node) => [node.acceptedAttemptId!, node.completedMs - node.completionLagMs]));
	const acceptanceGate = projection.acceptedLedger.map((entry, ledgerIndex) => ({ ledgerIndex, attemptId: entry.attemptId, readyMs: acceptedReady.get(entry.attemptId) ?? null, acceptedMs: acceptedCompleted.get(entry.attemptId) ?? null, waitMs: acceptedReady.has(entry.attemptId) ? acceptedCompleted.get(entry.attemptId)! - acceptedReady.get(entry.attemptId)! : null, patch: entry.transition.patch }));
	const observedFinalStart = run?.events.find(({ event }) => event === "final-validation-started");
	const observedFinalEnd = run?.events.find(({ event }) => event === "final-validation-completed");
	const nodeEnd = nodes.reduce((latest, node) => Math.max(latest, node.completedMs), 0);
	const confirmationMs = confirmation ? Date.parse(confirmation.occurredAt) : 0;
	const recordedNodeEnd = run && confirmation ? Math.max(0, ...run.events.filter(({ event }) => event === "node-completed").map(({ occurredAt }) => Date.parse(occurredAt) - confirmationMs)) : nodeEnd;
	const finalWaitMs = observedFinalStart ? Math.max(0, Date.parse(observedFinalStart.occurredAt) - confirmationMs - recordedNodeEnd) : 0;
	const finalRecordedEnd = observedFinalEnd ?? (observedFinalStart ? run?.events.at(-1) : undefined);
	const finalDuration = observedFinalStart && finalRecordedEnd ? Date.parse(finalRecordedEnd.occurredAt) - Date.parse(observedFinalStart.occurredAt) : null;
	const finalValidation = finalDuration === null ? null : { startMs: nodeEnd + finalWaitMs, endMs: nodeEnd + finalWaitMs + finalDuration, durationMs: finalDuration, outcome: observedFinalEnd ? projection.finalValidation.disposition : "recorded-prefix", complete: Boolean(observedFinalEnd) };
	const validations: ScenarioSchedule["validations"] = attemptRows.map(({ attemptId, terminalFact }) => ({ attemptId, terminalFact }));
	if (finalValidation) validations.push({ attemptId: null, terminalFact: { stage: "final-validation", code: finalValidation.outcome } });
	const schedule: ScenarioSchedule = {
		nodes: nodes.map(({ attempts: _attempts, attemptStarts: _attemptStarts, attemptEnds: _attemptEnds, attemptReadiness: _attemptReadiness, attemptWaits: _attemptWaits, allocationOrder: _allocationOrder, completionLagMs: _completionLagMs, ...node }) => node),
		attempts: attemptRows,
		turns: turnRows, responses: [], tools: toolRows,
		validations,
		acceptanceGate, finalValidation, tiers: [],
		fanout: { capacityWaitMs: nodes.reduce((sum, node) => sum + node.fanoutWaitMs, 0), acceptanceGateWaitMs: nodes.reduce((sum, node) => sum + node.acceptanceGateWaitMs, 0) },
		uncoveredMs: attemptRows.reduce((sum, attempt) => sum + (attempt.uncoveredMs ?? 0), 0),
	};
	return { boundaryMs, coveredBoundaryMs, schedule };
}

function providerInputs(nodes: RecordedNode[], schedule: ScenarioSchedule, observedBoundaryMs: number): ProviderAttemptInput[] {
	const starts = new Map(schedule.attempts.map((attempt) => [attempt.attemptId, attempt.startMs]));
	return nodes.flatMap((node) => node.attempts.map(({ attempt, allocationEpochMs, allocationMs, completionMs }) => {
		const accepted = attempt.allocation.attemptId === node.acceptedAttemptId;
		const recordedDurationMs = accepted && attempt.outcome
			? Date.parse(attempt.outcome.finishedAt) - allocationEpochMs
			: (completionMs ?? observedBoundaryMs) - allocationMs;
		return {
			nodeId: node.nodeId, attemptId: attempt.allocation.attemptId, allocationSequence: attempt.allocationSequence,
			allocationEpochMs, scenarioStartMs: Number(starts.get(attempt.allocation.attemptId) ?? allocationMs), recordedDurationMs,
			tier: attempt.allocation.assignment.tier, turns: attempt.outcome?.metrics.turns ?? [], responses: attempt.outcome?.metrics.responses ?? [], tools: attempt.outcome?.metrics.tools ?? [],
		};
	}));
}

function sameDurations(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
	return left.size === right.size && [...left].every(([id, duration]) => right.get(id) === duration);
}

function addProviderBreakdowns(schedule: ScenarioSchedule): void {
	const turnsByAttempt = new Map<string, ScenarioTurnRow[]>();
	for (const turn of schedule.turns) turnsByAttempt.set(turn.attemptId, [...(turnsByAttempt.get(turn.attemptId) ?? []), turn]);
	for (const attempt of schedule.attempts) {
		const turns = turnsByAttempt.get(attempt.attemptId) ?? [];
		attempt.providerWaitMs = turns.reduce((total, turn) => total + turn.providerWaitMs, 0);
		attempt.ttftMs = turns.reduce((total, turn) => total + turn.ttftMs, 0);
		attempt.generationMs = turns.reduce((total, turn) => total + turn.generationMs, 0);
		attempt.toolMs = schedule.tools.filter((tool) => tool.attemptId === attempt.attemptId).reduce((total, tool) => total + tool.durationMs, 0);
		attempt.localMs = attempt.durationMs === null ? null : Math.max(0, attempt.durationMs - attempt.providerWaitMs - attempt.ttftMs - attempt.generationMs - attempt.toolMs);
		attempt.scenarioCostUsd = turns.every((turn) => turn.scenarioCostUsd !== null) ? turns.reduce((total, turn) => total + turn.scenarioCostUsd, 0) : null;
		const intervals = [...schedule.responses.filter((call) => call.attemptId === attempt.attemptId).map((call) => [call.issueMs, call.providerEndMs]), ...schedule.tools.filter((tool) => tool.attemptId === attempt.attemptId).map((tool) => [tool.startMs, tool.endMs])];
		attempt.uncoveredMs = Math.max(0, attempt.coveredDurationMs - intervalUnionMs(intervals));
	}
	for (const node of schedule.nodes) {
		const attempts = schedule.attempts.filter((attempt) => attempt.nodeId === node.nodeId);
		for (const field of ["providerWaitMs", "ttftMs", "generationMs", "toolMs"] as const) node[field] = attempts.reduce((total, attempt) => total + (attempt[field] ?? 0), 0);
		node.scenarioCostUsd = attempts.every((attempt) => attempt.scenarioCostUsd !== null) ? attempts.reduce((total, attempt) => total + attempt.scenarioCostUsd, 0) : null;
		node.uncoveredMs = attempts.reduce((total, attempt) => total + attempt.uncoveredMs, 0);
		const constraint = schedule.responses.filter((call) => call.nodeId === node.nodeId && call.capacityPredecessorId).sort((left, right) => right.providerEndMs - left.providerEndMs)[0];
		if (constraint) node.providerConstraint = { id: `${constraint.responseId ?? constraint.turnId} waiting for ${constraint.capacityPredecessorId}`, completedMs: constraint.providerStartMs };
	}
	schedule.provider = { capacityWaitMs: schedule.responses.reduce((total, call) => total + call.providerWaitMs, 0) };
	schedule.uncoveredMs = schedule.attempts.reduce((total, attempt) => total + attempt.uncoveredMs, 0);
}

function intervalUnionMs(intervals: number[][]): number {
	let covered = 0, end = Number.NEGATIVE_INFINITY;
	for (const [start, finish] of intervals.sort((left, right) => left[0]! - right[0]!)) { covered += Math.max(0, finish! - Math.max(start!, end)); end = Math.max(end, finish!); }
	return covered;
}

function coveredDuration(attempt: AttemptProjection, allocationEpochMs: number): number {
	const intervals = [...(attempt.outcome?.metrics.turns ?? []).map(({ requestedAt, finishedAt }) => [Date.parse(requestedAt), Date.parse(finishedAt)]), ...(attempt.outcome?.metrics.tools ?? []).map(({ startedAt, finishedAt }) => [Date.parse(startedAt), Date.parse(finishedAt)])]
		.map(([start, end]) => [start - allocationEpochMs, end - allocationEpochMs] as const).sort((left, right) => left[0] - right[0]);
	let covered = 0;
	let end = Number.NEGATIVE_INFINITY;
	for (const [start, finish] of intervals) { covered += Math.max(0, finish - Math.max(start, end)); end = Math.max(end, finish); }
	return covered;
}

function recordedGateLag(recorded: RecordedAttempt, previous: RecordedAttempt | undefined): number {
	if (recorded.completionMs === null || !recorded.attempt.outcome) return 0;
	const confirmationEpochMs = recorded.allocationEpochMs - recorded.allocationMs;
	const candidateMs = Date.parse(recorded.attempt.outcome.finishedAt) - confirmationEpochMs;
	return Math.max(0, recorded.completionMs - Math.max(candidateMs, previous?.completionMs ?? 0));
}

function preservedEvidence(projection: ExecutionRunProjection, edges: readonly (readonly [string, string])[]): PreservedScenarioEvidence {
	return {
		packetEdges: edges.map(([from, to]) => [from, to]),
		nodeIds: projection.nodes.map(({ id }) => id),
		attemptIds: projection.attempts.map(({ allocation }) => allocation.attemptId),
		turnIds: projection.attempts.flatMap(({ outcome }) => outcome?.metrics.turns.map(({ turnId }) => turnId) ?? []),
		toolCallIds: projection.attempts.flatMap(({ outcome }) => outcome?.metrics.tools.map(({ toolCallId }) => toolCallId) ?? []),
		outcomeActions: projection.attempts.flatMap(({ outcome }) => outcome ? [outcome.action] : []),
		acceptedLedgerAttemptIds: projection.acceptedLedger.map(({ attemptId }) => attemptId),
		acceptedTransitions: projection.acceptedLedger.map(({ transition }) => transition),
		tierAssignments: projection.attempts.map(({ allocation }) => allocation.assignment.tier),
		responseIds: projection.attempts.flatMap(({ outcome }) => outcome?.metrics.responses.map(({ responseId }) => responseId) ?? []),
	};
}

function completionChain(nodes: readonly ScenarioNodeRow[], finalValidation: ScenarioSchedule["finalValidation"], runId: string): CompletionChainEntry[] {
	if (!nodes.length) return finalValidation ? [{ kind: "final-validation", id: "final-validation", completedMs: finalValidation.endMs }, { kind: "run", id: runId }] : [{ kind: "run", id: runId }];
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	const terminal = [...nodes].sort((left, right) => right.completedMs - left.completedMs || left.nodeId.localeCompare(right.nodeId))[0]!;
	const chain: CompletionChainEntry[] = [];
	const append = (node: ScenarioNodeRow) => {
		const predecessor = [...byId.values()].filter((candidate) => node.dependencies.includes(candidate.nodeId) && candidate.completedMs === node.readinessMs).sort((left, right) => left.nodeId.localeCompare(right.nodeId))[0];
		if (predecessor) append(predecessor);
		if (node.fanoutWaitMs > 0) chain.push({ kind: "fanout-capacity", id: node.nodeId, completedMs: node.startMs });
		if (node.providerConstraint) chain.push({ kind: "provider-capacity", ...node.providerConstraint });
		chain.push({ kind: "node", id: node.nodeId, completedMs: node.executionEndMs });
		if (node.acceptanceGateWaitMs > 0) chain.push({ kind: "acceptance", id: node.acceptedAttemptId ?? `${node.nodeId}:accepted`, completedMs: node.completedMs });
	};
	append(terminal);
	if (finalValidation) chain.push({ kind: "final-validation", id: "final-validation", completedMs: finalValidation.endMs });
	chain.push({ kind: "run", id: runId });
	return chain;
}

function prefixCompletionChain(nodes: readonly ScenarioNodeRow[], finalValidation: ScenarioSchedule["finalValidation"], lastEventSequence: number): CompletionChainEntry[] {
	const chain = completionChain(nodes, finalValidation, "recorded-prefix").filter(({ kind }) => kind !== "run");
	chain.push({ kind: "recorded-prefix", id: String(lastEventSequence), completedMs: Math.max(nodes.reduce((latest, node) => Math.max(latest, node.executionEndMs), 0), finalValidation?.endMs ?? 0) });
	return chain;
}

function emptySchedule(): ScenarioSchedule { return { nodes: [], attempts: [], turns: [], responses: [], tools: [], validations: [], acceptanceGate: [], finalValidation: null, fanout: { capacityWaitMs: 0, acceptanceGateWaitMs: 0 }, tiers: [], uncoveredMs: 0 }; }

function uniqueSources(sources: readonly SourceReference[]): SourceReference[] {
	return [...new Map(sources.map((source) => [source.id, source])).values()];
}
