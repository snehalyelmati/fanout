import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { artifactIdentity } from "../packages/fanout-core/src/artifact-identity.ts";
import { correlateAttemptMetrics } from "../packages/fanout-core/src/attempt-metrics.ts";
import { allocateAttempt, completeAttempt, createNodeAttemptState } from "../packages/fanout-core/src/execution-attempt.ts";
import { compileExecutionPacket } from "../packages/fanout-core/src/fanout-compiler.ts";
import { queryComparison } from "../packages/fanout-profiler/src/comparison.ts";
import { ProjectRegistry } from "../packages/fanout-profiler/src/project-registry.ts";
import { queryScenario } from "../packages/fanout-profiler/src/scenario.ts";
import { queryWorkspace } from "../packages/fanout-profiler/src/workspace.ts";

const LINEAGES = 100;
const RUNS_PER_LINEAGE = 5;
const NODES_PER_PACKET = 64;
const EVENTS_PER_RUN = 200;
const LARGE_LOG_BYTES = 128 * 1024 * 1024;
const LARGE_LOG_PAYLOAD = "benchmark-evidence".padEnd(113, "x");
const LARGE_LOG_ROW = `${JSON.stringify({ message: LARGE_LOG_PAYLOAD })}\n`;
const PROJECT_DIRECTORIES = 50;
const ADMITTED_PROJECTS = 3;
const BASE_TREE = "1".repeat(40);
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const storageRoot = mkdtempSync(join(tmpdir(), "fanout-profiler-benchmark-"));
const projectId = "benchmark-project";
const root = join(storageRoot, projectId);

try {
	const generatedAt = performance.now();
	mkdirSync(root);
	for (let index = 1; index < ADMITTED_PROJECTS; index++) write(join(storageRoot, `benchmark-peer-${index}`, "packet", "executions", `peer-run-${index}`, "execution-run.json"), `${JSON.stringify({ schema: "fanout.execution-run", version: 4, runId: `peer-run-${index}`, startedAt: `2026-07-2${index}T00:00:00.000Z` })}\n`);
	for (let index = ADMITTED_PROJECTS; index < PROJECT_DIRECTORIES; index++) write(join(storageRoot, `runtime-only-${String(index).padStart(2, "0")}`, "runtime-context.json"), "{}\n");
	const fixture = createFixture();
	write(join(root, fixture.profileIdentity.path), fixture.profileBytes);
	for (let lineage = 0; lineage < LINEAGES; lineage++) writeLineage(lineage, fixture);
	const evidencePath = join(root, "observability", "benchmark", "observability.jsonl");
	writeLargeLog(evidencePath);
	const generationMs = performance.now() - generatedAt;

	const initial = measure(() => new ProjectRegistry({ storageRoot, preferredProjectId: projectId }));
	const registry = initial.value;
	const catalog = registry.require().catalog;
	const snapshot = catalog.snapshot();
	assert(registry.overview().projects.length === ADMITTED_PROJECTS, "multi-project discovery did not admit only evidence projects");
	assert(snapshot.lineages.length === LINEAGES, `expected ${LINEAGES} Workflow Lineages`);
	assert(snapshot.executionRuns.length === LINEAGES * RUNS_PER_LINEAGE, `expected ${LINEAGES * RUNS_PER_LINEAGE} Execution Runs`);
	assert(LINEAGES * RUNS_PER_LINEAGE * EVENTS_PER_RUN === 100_000, "expected 100,000 generated events");

	const selected = snapshot.executionRuns.find((run) => run.planningRunId === "lineage-000" && run.admission === "Current");
	const peer = snapshot.executionRuns.find((run) => run.planningRunId === "lineage-000" && run.admission === "Current" && run.selectionId !== selected?.selectionId);
	assert(selected && peer, "benchmark query runs are unavailable");
	const workspace = measure(() => queryWorkspace(snapshot, { runId: selected.selectionId }));
	const comparison = measure(() => queryComparison(snapshot, { runAId: selected.selectionId, runBId: peer.selectionId }));
	const scenario = measure(() => queryScenario(snapshot, { runId: selected.selectionId, concurrency: { mode: "observed" } }));
	const refresh = await measureAsync(() => registry.refresh(projectId));
	assert(refresh.value.selection, "selected benchmark project disappeared during refresh");
	const refreshedSnapshot = refresh.value.selection.catalog.snapshot();
	const refreshedReference = refreshedSnapshot.supportingEvidence[0]?.source;
	assert(refreshedReference?.byteLength === LARGE_LOG_BYTES, "128 MB supporting log metadata was not admitted");
	assert(catalog.loadStatistics().supportingEvidenceBytesRead === 0, "supporting log bytes were eagerly read during refresh");
	const evidence = await measureAsync(() => catalog.readEvidencePage(refreshedReference.id, { limit: 500 }));
	assert(evidence.value.rows.length === 500 && evidence.value.nextOffset === 500, "evidence page cap was not preserved");
	const snapshotJson = JSON.stringify(refreshedSnapshot);
	assert(!snapshotJson.includes(LARGE_LOG_PAYLOAD), "supporting log content was retained in the catalog snapshot");

	console.log(JSON.stringify({
		environment: {
			measuredAt: new Date().toISOString(),
			platform: process.platform,
			architecture: process.arch,
			bun: Bun.version,
			cpu: cpus()[0]?.model ?? "unknown",
		},
		dataset: {
			projectDirectories: PROJECT_DIRECTORIES,
			admittedProjects: registry.overview().projects.length,
			workflowLineages: snapshot.lineages.length,
			executionRuns: snapshot.executionRuns.length,
			events: LINEAGES * RUNS_PER_LINEAGE * EVENTS_PER_RUN,
			currentExecutionRuns: snapshot.executionRuns.filter((run) => run.admission === "Current").length,
			currentReplayEvents: snapshot.executionRuns.reduce((sum, run) => sum + run.events.length, 0),
			legacyExecutionRuns: snapshot.executionRuns.filter((run) => run.admission === "Legacy").length,
			legacyEnvelopeEvents: LINEAGES * RUNS_PER_LINEAGE * EVENTS_PER_RUN - snapshot.executionRuns.reduce((sum, run) => sum + run.events.length, 0),
			supportingLogBytes: refreshedReference.byteLength,
		},
		measurementsMs: {
			fixtureGeneration: round(generationMs),
			initialStorageCatalog: round(initial.durationMs),
			storageRefresh: round(refresh.durationMs),
			workspace: round(workspace.durationMs),
			comparison: round(comparison.durationMs),
			scenario: round(scenario.durationMs),
			evidencePage500Rows: round(evidence.durationMs),
		},
		structuralChecks: {
			largeLogCatalogRepresentation: "metadata-only",
			supportingEvidenceBytesReadDuringRefresh: catalog.loadStatistics().supportingEvidenceBytesRead,
			largeLogContentRetained: false,
			evidenceRowsReturned: evidence.value.rows.length,
			evidenceNextOffset: evidence.value.nextOffset,
		},
	}, null, 2));
} finally {
	rmSync(storageRoot, { recursive: true, force: true });
}

function createFixture() {
	const lineageId = "lineage-template";
	const baseTime = Date.UTC(2026, 6, 20);
	const command = { executable: "bun", args: ["--version"] };
	const profile = { schema: "fanout.project-execution-profile", version: 1, profileId: "benchmark", createdAt: isoTimestamp(baseTime), preparation: [], readiness: [], candidateNormalization: [], requiredFinalGates: [] };
	const profileBytes = bytes(profile);
	const profileIdentity = artifactIdentity("profiles/benchmark.json", profileBytes);
	const implementationItems = Array.from({ length: NODES_PER_PACKET }, (_, node) => ({
		id: nodeId(node), goals: [`Implement benchmark work ${node}`], writeResources: [{ kind: "file", path: `src/work-${String(node).padStart(2, "0")}.ts` }], readResources: [], forbiddenWrites: [], semanticReviewCriteria: ["Work is visible"], advisoryNotes: [],
	}));
	const plan = {
		schema: "fanout.implementation-plan", version: 4, planId: lineageId, createdAt: isoTimestamp(baseTime), planningHost: { platform: process.platform }, planningBase: { headCommit: BASE_TREE, tree: BASE_TREE }, profile: profileIdentity, objective: `Benchmark ${lineageId}`, userContext: [], discoveredRepoFacts: [], assumptions: [], implementationItems,
	};
	const planBytes = bytes(plan);
	const planIdentity = artifactIdentity("implementation-plan.json", planBytes);
	const details = {
		schema: "fanout.implementation-details", version: 8, detailsId: lineageId, createdAt: isoTimestamp(baseTime + 1), plan: planIdentity,
		items: implementationItems.map((item) => ({ id: item.id, kind: "implement", changes: [{ kind: "create", target: { resource: item.writeResources[0], sourcePlanIds: [item.id] }, contentIntent: "benchmark work" }], readDependencies: [], validationCommands: [command], advisoryValidationMode: "fail-fast", advisoryNotes: [] })),
		finalValidationCommands: [command],
	};
	const detailsBytes = bytes(details);
	const summary = { provider: "benchmark", model: "worker", thinking: "off", source: "fixture", status: "available", reason: "fixture" };
	const compiled = compileExecutionPacket({
		implementationPlan: plan, implementationDetails: details, planIdentity, detailsIdentity: artifactIdentity("implementation-details.json", detailsBytes),
		tierPlan: { tier1: summary, tier2: summary, tier2Fallback: summary }, runtimePolicy: { maxConcurrency: 1, failFast: false, fallbackAllowed: true }, createdAt: isoTimestamp(baseTime + 2),
	});
	if (!compiled.packet) throw new Error(compiled.errors.join("; "));
	const packetBytes = bytes(compiled.packet);
	const packetIdentity = artifactIdentity(`${lineageId}/execution-packet.json`, packetBytes);
	const events = executionEvents(compiled.packet, packetIdentity, lineageId, "run-template", baseTime + 10_000);
	assert(events.length === EVENTS_PER_RUN, `template generated ${events.length} events`);
	const legacyJsonl = `${Array.from({ length: EVENTS_PER_RUN }, (_, index) => JSON.stringify({ schema: "fanout.execution-event", version: 2, runId: "run-template", sequence: index + 1, occurredAt: isoTimestamp(baseTime + 10_000 + index), event: index ? "legacy-observation" : "run-started", payload: {} })).join("\n")}\n`;
	return { profileBytes, profileIdentity, planBytes, detailsBytes, packetBytes, eventsJsonl: `${events.map(JSON.stringify).join("\n")}\n`, legacyJsonl };
}

function writeLineage(index, fixture) {
	const lineageId = `lineage-${String(index).padStart(3, "0")}`;
	write(join(root, lineageId, "implementation-plan.json"), fixture.planBytes);
	write(join(root, lineageId, "implementation-details.json"), fixture.detailsBytes);
	write(join(root, lineageId, "execution-packet.json"), fixture.packetBytes);
	for (let run = 0; run < RUNS_PER_LINEAGE; run++) {
		const runId = `run-${String(index).padStart(3, "0")}-${run}`;
		const template = index === 0 && run < 2 ? fixture.eventsJsonl : fixture.legacyJsonl;
		const eventsJsonl = template.replaceAll("lineage-template", lineageId).replaceAll("run-template", runId);
		write(join(root, lineageId, "executions", runId, "events.jsonl"), eventsJsonl);
	}
}

function executionEvents(packet, packetIdentity, lineageId, runId, baseTime) {
	const events = [];
	const emit = (event, payload) => events.push({ schema: "fanout.execution-event", version: 6, runId, sequence: events.length + 1, occurredAt: isoTimestamp(baseTime + events.length), event, payload });
	const commandEvidence = packet.nodes.map((node, packetNodeIndex) => ({ packetNodeIndex, nodeId: node.id, commandIndex: 0, manifest: { executable: "bun", args: ["--version"], cwd: null }, resolution: { status: "available", resolvedExecutable: process.execPath, resolvedCwd: process.cwd() } }));
	const preflightEvidence = {
		planningCommit: { expected: BASE_TREE, actual: BASE_TREE, status: "matched" }, repositoryTree: { expected: BASE_TREE, actual: BASE_TREE, status: "matched" }, platform: { expected: process.platform, actual: process.platform, status: "matched" },
		worker: { extension: { requested: "packages/fanout-pi/src/index.ts", resolved: join(process.cwd(), "packages/fanout-pi/src/index.ts"), status: "available" }, launcher: { executable: "bun", args: ["--version"], resolvedExecutable: process.execPath, resolvedCwd: process.cwd(), version: Bun.version, status: "available" }, modelCallableTools: ["read", "grep", "find", "ls", "edit", "write", "fanout_validate"] },
		commandCounts: { candidateNormalization: packet.nodes.map(() => 0), validation: packet.nodes.map(() => 1) }, candidateNormalizationCommands: [], validationCommands: commandEvidence,
	};
	emit("run-started", { mode: "live", packet: packetIdentity, profile: packet.profile, profileValidation: { path: `${lineageId}/executions/${runId}/profile-validation/evidence.json`, sha256: "b".repeat(64), byteLength: 1 }, planningBaseTree: BASE_TREE, nodeIds: packet.nodes.filter((node) => node.kind !== "final-validation").map((node) => node.id), policy: packet.runtimePolicy, preflightEvidence });
	emit("preflight-completed", { status: "passed", planningBaseTree: BASE_TREE, repositoryTree: BASE_TREE, issues: [] });
	emit("confirmation-decided", { decision: "accepted" });
	for (const [index, node] of packet.nodes.filter((candidate) => candidate.kind !== "final-validation").entries()) {
		let state = createNodeAttemptState(node.id);
		const original = allocateAttempt(state, { runId, nodeId: node.id, kind: "original", assignment: assignment(node), fallbackAllowed: true });
		state = original.state;
		emit("attempt-allocated", { allocation: original.allocation });
		const originalOutcome = completeFixtureAttempt(original.allocation, state, events.at(-1).occurredAt, isoTimestamp(baseTime + events.length), index === 0 ? { stage: "process", code: "timeout", durationMs: 1, timeoutMs: 1 } : { stage: "apply", code: "applied" });
		emit("attempt-completed", { outcome: originalOutcome, ...(index === 0 ? {} : { acceptedTransition: transition(lineageId, runId, original.allocation.attemptId) }) });
		let acceptedAttemptId = original.allocation.attemptId;
		if (index === 0) {
			const retry = allocateAttempt(state, { runId, nodeId: node.id, kind: "retry", assignment: assignment(node), sourceAttemptId: original.allocation.attemptId, fallbackAllowed: true });
			state = retry.state;
			emit("attempt-allocated", { allocation: retry.allocation });
			const retryOutcome = completeFixtureAttempt(retry.allocation, state, events.at(-1).occurredAt, isoTimestamp(baseTime + events.length), { stage: "apply", code: "applied" });
			emit("attempt-completed", { outcome: retryOutcome, acceptedTransition: transition(lineageId, runId, retry.allocation.attemptId) });
			acceptedAttemptId = retry.allocation.attemptId;
		}
		emit("node-completed", { nodeId: node.id, status: "succeeded", cause: { attemptId: acceptedAttemptId } });
	}
	emit("final-validation-started", { commandIdentities: ["final-validation:0"], expectedTree: BASE_TREE });
	emit("final-validation-completed", { status: "passed", totalCommandDurationMs: 1, lastRound: { status: "passed", commandCount: 1, durationMs: 1, evidence: { path: `${lineageId}/executions/${runId}/final-validation/rounds/000-initial.json`, sha256: "a".repeat(64), byteLength: 1 }, expectedTree: BASE_TREE, beforeTree: BASE_TREE, afterTree: BASE_TREE } });
	emit("run-finished", { outcome: "completed", durationMs: events.length, cleanupDurationMs: 0, cause: { kind: "event", eventSequence: events.length, code: "final-validation-passed" } });
	return events;
}

function completeFixtureAttempt(allocation, state, startedAt, finishedAt, terminalFact) {
	const evidence = { attemptId: allocation.attemptId, compatibility: "generic", turns: [{ attemptId: allocation.attemptId, turnId: `${allocation.attemptId}:turn`, terminal: "completed", provider: allocation.assignment.provider, model: allocation.assignment.model, tier: allocation.assignment.tier, requestedAt: startedAt, firstOutputAt: startedAt, finishedAt, durationMs: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2, costUsd: 0.001, pricingSource: "fixture", responseIds: [], toolCallIds: [] }], responses: [], polls: [], tools: [], workerFirstOutputMs: 0, workerDurationMs: 1 };
	const correlated = correlateAttemptMetrics(evidence);
	if (!correlated.ok) throw new Error(JSON.stringify(correlated.errors));
	return completeAttempt(allocation, { state, startedAt, finishedAt, terminalFact, fallbackAllowed: true, metrics: correlated.metrics, evidenceRefs: [`${allocation.attemptId}/result.json`] });
}

function transition(lineageId, runId, attemptId) {
	return { patch: { artifact: { path: `${lineageId}/executions/${runId}/workers/${attemptId}/patch.bin`, sha256: EMPTY_SHA256, byteLength: 0 }, headCommit: BASE_TREE, changedPaths: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 }, baseTree: BASE_TREE, resultTree: BASE_TREE } };
}

function assignment(node) { return { tier: node.tier.assigned, provider: node.tier.provider, model: node.tier.model }; }
function nodeId(index) { return `work-${String(index).padStart(2, "0")}`; }
function isoTimestamp(time) { return new Date(time).toISOString(); }
function bytes(value) { return Buffer.from(`${JSON.stringify(value)}\n`); }
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
function writeLargeLog(path) {
	assert(Buffer.byteLength(LARGE_LOG_ROW) === 128, "supporting log rows must be exactly 128 bytes");
	mkdirSync(dirname(path), { recursive: true });
	const chunk = Buffer.from(LARGE_LOG_ROW.repeat(512));
	const fd = openSync(path, "w");
	try {
		for (let written = 0; written < LARGE_LOG_BYTES; written += chunk.length) assert(writeSync(fd, chunk) === chunk.length, "supporting log write was incomplete");
	} finally { closeSync(fd); }
}
function measure(operation) { const start = performance.now(); const value = operation(); return { value, durationMs: performance.now() - start }; }
async function measureAsync(operation) { const start = performance.now(); const value = await operation(); return { value, durationMs: performance.now() - start }; }
function round(value) { return Math.round(value * 100) / 100; }
function assert(value, message) { if (!value) throw new Error(message); }
