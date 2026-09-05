import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactIdentity } from "../../fanout-core/src/artifact-identity";
import { compileExecutionPacket } from "../../fanout-core/src/fanout-compiler";
import { ProfilerCatalog } from "./catalog";

const roots: string[] = [];
const profileIdentity = artifactIdentity("profiles/default.json", Buffer.from("{}\n"));
const profileValidationIdentity = artifactIdentity("profiles/default-validation.json", Buffer.from("{}\n"));
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const value = mkdtempSync(join(tmpdir(), "fanout-catalog-"));
	roots.push(value);
	return value;
}

function write(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
}

function plan(id: string, version = 4): Record<string, unknown> {
	const git = "1".repeat(40);
	return {
		schema: "fanout.implementation-plan",
		version,
		planId: id,
		createdAt: `2026-07-${id === "new" ? "20" : "19"}T00:00:00.000Z`,
		planningHost: { platform: process.platform },
		planningBase: { headCommit: git, tree: git },
		profile: profileIdentity,
		objective: `Objective ${id}`,
		userContext: [],
		discoveredRepoFacts: [],
		assumptions: [],
		implementationItems: [{
			id: "work",
			goals: ["Do work"],
			writeResources: [{ kind: "file", path: "src/work.ts" }],
			readResources: [],
			forbiddenWrites: [],
			semanticReviewCriteria: ["Work is visible"],
			advisoryNotes: [],
		}],
	};
}

function event(runId: string, occurredAt: string, version = 6): Record<string, unknown> {
	return { schema: "fanout.execution-event", version, runId, sequence: 1, occurredAt, event: "run-started", payload: {} };
}

function currentLineage(artifactRoot: string, id = "packet"): { packetIdentity: ReturnType<typeof artifactIdentity>; started: (runId: string, occurredAt: string) => Record<string, unknown> } {
	mkdirSync(join(artifactRoot, id), { recursive: true });
	const planValue = plan(id);
	const planBytes = Buffer.from(`${JSON.stringify(planValue)}\n`);
	writeFileSync(join(artifactRoot, id, "implementation-plan.json"), planBytes);
	const planIdentity = artifactIdentity("implementation-plan.json", planBytes);
	const command = { executable: "node", args: ["--version"] };
	const details = {
		schema: "fanout.implementation-details", version: 7, detailsId: id, createdAt: "2026-07-19T00:01:00.000Z", plan: planIdentity,
		items: [{ id: "work", kind: "implement", changes: [{ kind: "create", target: { resource: { kind: "file", path: "src/work.ts" }, sourcePlanIds: ["work"] }, contentIntent: "work" }], readDependencies: [], validationCommands: [command], advisoryNotes: [] }],
		finalValidationCommands: [command],
	};
	const detailsBytes = Buffer.from(`${JSON.stringify(details)}\n`);
	writeFileSync(join(artifactRoot, id, "implementation-details.json"), detailsBytes);
	const summary = { provider: "test", model: "model", thinking: "off", source: "fixture", status: "available" as const, reason: "fixture" };
	const compiled = compileExecutionPacket({
		implementationPlan: planValue, implementationDetails: details,
		planIdentity, detailsIdentity: artifactIdentity("implementation-details.json", detailsBytes),
		tierPlan: { tier1: summary, tier2: { ...summary, status: "unavailable" as const, fallback: "tier1" as const }, tier2Fallback: summary },
		runtimePolicy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false }, createdAt: "2026-07-19T00:02:00.000Z",
	});
	if (!compiled.packet) throw new Error(compiled.errors.join("; "));
	const packetBytes = Buffer.from(`${JSON.stringify(compiled.packet)}\n`);
	writeFileSync(join(artifactRoot, id, "execution-packet.json"), packetBytes);
	const packetIdentity = artifactIdentity(`${id}/execution-packet.json`, packetBytes);
	const evidence = {
		planningCommit: { expected: "1".repeat(40), actual: "1".repeat(40), status: "matched" },
		repositoryTree: { expected: "1".repeat(40), actual: "1".repeat(40), status: "matched" },
		platform: { expected: process.platform, actual: process.platform, status: "matched" },
		worker: {
			extension: { requested: "packages/fanout-pi/src/index.ts", resolved: "/repo/packages/fanout-pi/src/index.ts", status: "available" },
			launcher: { executable: process.execPath, args: ["--version"], resolvedExecutable: process.execPath, resolvedCwd: "/repo", version: process.version, status: "available" },
			modelCallableTools: ["read", "grep", "find", "ls", "edit", "write", "fanout_validate"],
		},
		commandCounts: { candidateNormalization: [0, 0], validation: [1, 1] },
		candidateNormalizationCommands: [],
		validationCommands: [0, 1].map((packetNodeIndex) => ({
			packetNodeIndex, nodeId: packetNodeIndex ? "final-validation" : "work", commandIndex: 0,
			manifest: { ...command, cwd: null }, resolution: { status: "available", resolvedExecutable: process.execPath, resolvedCwd: "/repo" },
		})),
	};
	return {
		packetIdentity,
		started: (runId, occurredAt) => ({
			schema: "fanout.execution-event", version: 6, runId, sequence: 1, occurredAt, event: "run-started",
			payload: { mode: "dry-run", packet: packetIdentity, profile: profileIdentity, profileValidation: profileValidationIdentity, planningBaseTree: "1".repeat(40), nodeIds: ["work"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false }, preflightEvidence: evidence },
		}),
	};
}

test("catalog narrowly discovers planning, legacy, invalid, and unverifiable evidence", async () => {
	const artifactRoot = root();
	const planningPath = join(artifactRoot, "planning-only", "implementation-plan.json");
	write(planningPath, plan("old"));
	const planningBytes = readFileSync(planningPath);
	write(join(artifactRoot, "legacy", "implementation-plan.json"), plan("old", 1));
	const legacyDetailsPlanPath = join(artifactRoot, "legacy-details", "implementation-plan.json");
	write(legacyDetailsPlanPath, plan("legacy-details"));
	const legacyDetailsPlanIdentity = artifactIdentity("implementation-plan.json", readFileSync(legacyDetailsPlanPath));
	write(join(artifactRoot, "legacy-details", "implementation-details.json"), { schema: "fanout.implementation-details", version: 5, detailsId: "legacy-details", createdAt: new Date(0).toISOString(), plan: legacyDetailsPlanIdentity, items: [], finalValidationCommands: [] });
	currentLineage(artifactRoot, "legacy-packet");
	const legacyPacketPath = join(artifactRoot, "legacy-packet", "execution-packet.json");
	const legacyPacket = JSON.parse(readFileSync(legacyPacketPath, "utf8"));
	write(legacyPacketPath, { ...legacyPacket, version: 7 });
	write(join(artifactRoot, "invalid", "implementation-plan.json"), "{");
	write(join(artifactRoot, "invalid", "implementation-details.json"), { schema: "fanout.implementation-details", version: 3 });
	write(join(artifactRoot, "projection-only", "executions", "run-projection", "execution-run.json"), {
		schema: "fanout.execution-run", version: 4, runId: "run-projection", startedAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z",
	});
	write(join(artifactRoot, "legacy-run", "executions", "run-v2", "events.jsonl"), event("run-v2", "2026-07-18T00:00:00.000Z", 2));
	write(join(artifactRoot, "unknown.json"), { schema: "not-fanout" });
	write(join(artifactRoot, "random", "nested", "execution-run.json"), { schema: "fanout.execution-run", version: 4 });
	write(join(artifactRoot, "active-packet.json"), {
		schema: "fanout.active-packet", version: 2, publishedAt: "2026-07-20T00:00:00.000Z",
		packet: { path: "planning-only/execution-packet.json", sha256: "a".repeat(64), byteLength: 1 },
	});

	const outside = root();
	write(join(outside, "implementation-plan.json"), plan("new"));
	symlinkSync(outside, join(artifactRoot, "escaped"));

	const catalog = new ProfilerCatalog(artifactRoot);
	const snapshot = catalog.snapshot();
	expect(snapshot.planningRuns.map(({ id, admission }) => [id, admission])).toEqual([
		["escaped", "Invalid"],
		["invalid", "Invalid"],
		["legacy", "Legacy"],
		["legacy-details", "Legacy"],
		["legacy-packet", "Legacy"],
		["planning-only", "Planning-only"],
	]);
	expect(snapshot.executionRuns.map(({ id, admission }) => [id, admission])).toEqual([
		["run-projection", "Legacy"],
		["run-v2", "Legacy"],
	]);
	expect(snapshot.executionRuns[0]?.updatedAt).toBe("2026-07-21T00:00:00.000Z");
	expect(JSON.stringify(snapshot)).not.toContain("unknown.json");
	expect(JSON.stringify(snapshot)).not.toContain("random/nested");
	expect(snapshot.activePointer?.admission).toBe("Current");
	expect(readFileSync(planningPath)).toEqual(planningBytes);
	expect(Object.isFrozen(snapshot)).toBe(true);
	expect(Object.isFrozen(snapshot.planningRuns)).toBe(true);
});

test("serialized refresh atomically preserves or predictably replaces selection", async () => {
	const artifactRoot = root();
	write(join(artifactRoot, "packet", "implementation-plan.json"), plan("new"));
	write(join(artifactRoot, "packet", "executions", "run-old", "execution-run.json"), { schema: "fanout.execution-run", version: 4, runId: "run-old", startedAt: "2026-07-19T00:00:00.000Z" });
	write(join(artifactRoot, "packet", "executions", "run-new", "execution-run.json"), { schema: "fanout.execution-run", version: 4, runId: "run-new", startedAt: "2026-07-20T00:00:00.000Z" });
	write(join(artifactRoot, "packet-duplicate", "executions", "run-old", "execution-run.json"), { schema: "fanout.execution-run", version: 4, runId: "run-old", startedAt: "2026-07-18T00:00:00.000Z" });

	const catalog = new ProfilerCatalog(artifactRoot);
	expect(catalog.snapshot().selectedExecutionRunId).toBe("packet/executions/run-new");
	catalog.selectExecutionRun("packet/executions/run-old");
	const [first, second] = await Promise.all([catalog.refresh(), catalog.refresh()]);
	expect(first.generation).toBe(2);
	expect(second.generation).toBe(3);
	expect(catalog.snapshot().selectedExecutionRunId).toBe("packet/executions/run-old");

	rmSync(join(artifactRoot, "packet", "executions", "run-old"), { recursive: true });
	await catalog.refresh();
	expect(catalog.snapshot().selectedExecutionRunId).toBe("packet/executions/run-new");

	const prior = catalog.snapshot();
	const moved = `${artifactRoot}-moved`;
	renameSync(artifactRoot, moved);
	roots.push(moved);
	mkdirSync(artifactRoot);
	await expect(catalog.refresh()).rejects.toThrow();
	expect(catalog.snapshot()).toBe(prior);
});

test("snapshot-issued references page supporting evidence lazily and reject changed bytes", async () => {
	const artifactRoot = root();
	const evidence = join(artifactRoot, "observability", "session-1", "observability.jsonl");
	write(evidence, "one\ntwo\nthree\n");
	const before = readFileSync(evidence);
	const catalog = new ProfilerCatalog(artifactRoot);
	const reference = catalog.snapshot().supportingEvidence[0]?.source;
	expect(reference).toBeDefined();
	expect(await catalog.readEvidencePage(reference!.id, { offset: 1, limit: 2 })).toEqual({
		status: "Current", rows: ["two", "three"], nextOffset: null,
	});
	expect(readFileSync(evidence)).toEqual(before);

	const session = join(artifactRoot, "observability", "session-1");
	const movedSession = `${session}-moved`;
	const escapedSession = root();
	write(join(escapedSession, "observability.jsonl"), "outside\n");
	renameSync(session, movedSession);
	symlinkSync(escapedSession, session);
	expect(await catalog.readEvidencePage(reference!.id)).toEqual({ status: "Changed since refresh", rows: [], nextOffset: null });
	rmSync(session);
	renameSync(movedSession, session);

	const openedEvidence = `${evidence}-opened`;
	renameSync(evidence, openedEvidence);
	writeFileSync(evidence, "replacement\n");
	expect(await catalog.readEvidencePage(reference!.id, { limit: 1 })).toEqual({ status: "Changed since refresh", rows: [], nextOffset: null });
	rmSync(evidence);
	renameSync(openedEvidence, evidence);
	renameSync(evidence, openedEvidence);
	expect(await catalog.readEvidencePage(reference!.id)).toEqual({ status: "Changed since refresh", rows: [], nextOffset: null });
	renameSync(openedEvidence, evidence);

	const times = statSync(evidence);
	writeFileSync(evidence, "xxx\nyyy\nzzzzz\n");
	utimesSync(evidence, times.atime, times.mtime);
	expect(await catalog.readEvidencePage(reference!.id)).toEqual({ status: "Changed since refresh", rows: [], nextOffset: null });
	await expect(catalog.readEvidencePage("unknown-reference")).rejects.toThrow("active snapshot");
	await expect(catalog.readEvidencePage(reference!.id, { limit: 501 })).rejects.toThrow("500");
});

test("catalog references only bounded execution supporting evidence without reading it", async () => {
	const artifactRoot = root();
	write(join(artifactRoot, "packet", "executions", "run", "execution-run.json"), { schema: "fanout.execution-run", version: 4, runId: "run", startedAt: "2026-07-20T00:00:00.000Z" });
	const attempt = join(artifactRoot, "packet", "executions", "run", "workers", "work", "attempts", "work-000001");
	for (const [name, contents] of [
		["stdout.log", "worker output\n"], ["stderr.log", "worker error\n"], ["observability.jsonl", "observed\n"],
		["validation.json", "validation\n"], ["ownership-check.json", "ownership\n"], ["unknown.json", "ignored\n"],
	] as const) write(join(attempt, name), contents);
	write(join(attempt, "session", "session.jsonl"), "session row\n");
	write(join(attempt, "session", "unknown.txt"), "ignored\n");
	write(join(artifactRoot, "packet", "executions", "run", "final-validation", "rounds", "initial.json"), "final validation\n");
	write(join(artifactRoot, "packet", "executions", "run", "final-validation", "rounds", "unknown.json"), "ignored\n");
	write(join(artifactRoot, "packet", "executions", "run", "unknown", "stdout.log"), "ignored\n");

	const catalog = new ProfilerCatalog(artifactRoot);
	const evidence = catalog.snapshot().supportingEvidence.filter(({ executionRunId }) => executionRunId === "packet/executions/run");
	expect(evidence.map(({ label }) => label)).toEqual(["final-validation/rounds/initial.json", "observability.jsonl", "ownership-check.json", "session/session.jsonl", "stderr.log", "stdout.log", "validation.json"]);
	expect(evidence.every(({ admission, source }) => admission === "Legacy" && source?.kind === "supporting-evidence")).toBe(true);
	expect(evidence.find(({ label }) => label.startsWith("final-validation"))?.attemptId).toBeNull();
	expect(evidence.filter(({ label }) => !label.startsWith("final-validation")).every(({ attemptId }) => attemptId === "work-000001")).toBe(true);
	expect(JSON.stringify(evidence)).not.toContain("worker output");
	expect(JSON.stringify(evidence)).not.toContain("unknown");
	expect(catalog.loadStatistics().supportingEvidenceBytesRead).toBe(0);
	expect(await catalog.readEvidencePage(evidence.find(({ label }) => label === "stdout.log")!.source!.id)).toEqual({ status: "Current", rows: ["worker output"], nextOffset: null });
});

test("128 MB supporting evidence stays metadata-only and pages remain capped", async () => {
	const artifactRoot = root();
	const evidence = join(artifactRoot, "observability", "large", "observability.jsonl");
	write(evidence, `${Array.from({ length: 501 }, (_, index) => `row-${index}`).join("\n")}\n`);
	truncateSync(evidence, 128 * 1024 * 1024);

	const catalog = new ProfilerCatalog(artifactRoot);
	const snapshot = catalog.snapshot();
	const reference = snapshot.supportingEvidence[0]?.source;
	expect(reference?.byteLength).toBe(128 * 1024 * 1024);
	expect(reference).not.toHaveProperty("sha256");
	expect(catalog.loadStatistics().supportingEvidenceBytesRead).toBe(0);
	expect(JSON.stringify(snapshot)).not.toContain("row-500");
	expect(await catalog.readEvidencePage(reference!.id, { limit: 500 })).toMatchObject({
		status: "Current", rows: { length: 500 }, nextOffset: 500,
	});
});

test("special-file evidence is rejected without blocking catalog refresh", () => {
	const artifactRoot = root();
	const evidence = join(artifactRoot, "observability", "session-fifo", "observability.jsonl");
	mkdirSync(join(evidence, ".."), { recursive: true });
	expect(Bun.spawnSync(["mkfifo", evidence]).exitCode).toBe(0);
	const catalog = new ProfilerCatalog(artifactRoot);
	expect(catalog.snapshot().supportingEvidence).toEqual([
		expect.objectContaining({ id: "session-fifo", admission: "Invalid", source: null }),
	]);
});

test("current Event Logs replay through core and override replaceable views", () => {
	const artifactRoot = root();
	const lineage = currentLineage(artifactRoot);
	const started = lineage.started("run-current", "2026-07-20T00:00:00.000Z");
	const preflight = { ...started, sequence: 2, occurredAt: "2026-07-20T00:00:00.001Z", event: "preflight-completed", payload: { status: "passed", planningBaseTree: "1".repeat(40), repositoryTree: "1".repeat(40), issues: [] } };
	const finished = { ...started, sequence: 3, occurredAt: "2026-07-20T00:00:00.002Z", event: "run-finished", payload: { outcome: "dry-run-completed", durationMs: 2, cleanupDurationMs: 0, cause: { kind: "event", eventSequence: 2, code: "dry-run" } } };
	write(join(artifactRoot, "packet", "executions", "run-current", "events.jsonl"), `${[started, preflight, finished].map(JSON.stringify).join("\n")}\n`);
	write(join(artifactRoot, "packet", "executions", "run-current", "execution-run.json"), { schema: "fanout.execution-run", version: 4, runId: "stale", startedAt: "2000-01-01T00:00:00.000Z" });
	write(join(artifactRoot, "packet", "executions", "run-current", "summary.md"), "stale report\n");

	const before = readFileSync(join(artifactRoot, "packet", "executions", "run-current", "execution-run.json"));
	const snapshot = new ProfilerCatalog(artifactRoot).snapshot();
	const run = snapshot.executionRuns[0]!;
	expect(run.admission).toBe("Current");
	expect(run.label).toBe("dry-run-completed");
	expect(run.projection?.runId).toBe("run-current");
	expect(run.projection?.terminalOutcome?.outcome).toBe("dry-run-completed");
	expect(snapshot.lineages).toHaveLength(1);
	expect(snapshot.lineages[0]?.packet?.schema).toBe("fanout.execution-packet");
	expect(snapshot.lineages[0]?.graph?.edges).toEqual([["work", "final-validation"]]);
	expect(snapshot.lineages[0]?.executionRuns[0]).toBe(run);
	expect(readFileSync(join(artifactRoot, "packet", "executions", "run-current", "execution-run.json"))).toEqual(before);
});

test("catalog keeps nonterminal and rejected Event Log evidence honest and newest-first", () => {
	const artifactRoot = root();
	const lineage = currentLineage(artifactRoot);
	const current = lineage.started("run-open", "2026-07-20T00:00:00.000Z");
	write(join(artifactRoot, "packet", "executions", "run-open", "events.jsonl"), `${JSON.stringify(current)}\n`);
	write(join(artifactRoot, "packet", "executions", "run-gap", "events.jsonl"), `${JSON.stringify({ ...current, runId: "run-gap", occurredAt: "2026-07-19T00:00:00.000Z" })}\n${JSON.stringify({ ...current, runId: "run-gap", sequence: 3, occurredAt: "2026-07-19T00:00:00.001Z", event: "preflight-completed" })}\n`);
	write(join(artifactRoot, "packet", "executions", "run-mixed", "events.jsonl"), `${JSON.stringify({ ...current, runId: "run-mixed", occurredAt: "2026-07-18T00:00:00.000Z" })}\n${JSON.stringify({ ...current, runId: "run-mixed", version: 2, sequence: 2 })}\n`);
	write(join(artifactRoot, "packet", "executions", "run-identity", "events.jsonl"), `${JSON.stringify({ ...current, runId: "other", occurredAt: "2026-07-17T00:00:00.000Z" })}\n`);
	write(join(artifactRoot, "packet", "executions", "run-future", "events.jsonl"), event("run-future", "2026-07-16T00:00:00.000Z", 7));
	const legacy = event("run-legacy", "2026-07-15T00:00:00.000Z", 4);
	write(join(artifactRoot, "packet", "executions", "run-legacy", "events.jsonl"), `${JSON.stringify(legacy)}\n${JSON.stringify({ ...legacy, sequence: 2, occurredAt: "2026-07-15T00:00:00.001Z", event: "preflight-completed" })}\n`);
	const mismatched = lineage.started("run-packet-mismatch", "2026-07-14T00:00:00.000Z");
	(mismatched.payload as Record<string, unknown>).packet = { ...lineage.packetIdentity, sha256: "f".repeat(64) };
	write(join(artifactRoot, "packet", "executions", "run-packet-mismatch", "events.jsonl"), `${JSON.stringify(mismatched)}\n`);
	const reverseMixed = { ...lineage.started("run-reverse-mixed", "2026-07-13T00:00:00.000Z"), version: 4 };
	write(join(artifactRoot, "packet", "executions", "run-reverse-mixed", "events.jsonl"), `${JSON.stringify(reverseMixed)}\n${JSON.stringify({ ...reverseMixed, version: 5, sequence: 2, occurredAt: "2026-07-13T00:00:00.001Z" })}\n`);

	const runs = new ProfilerCatalog(artifactRoot).snapshot().executionRuns;
	expect(runs.map(({ id }) => id)).toEqual(["run-open", "run-gap", "run-mixed", "run-identity", "run-future", "run-legacy", "run-packet-mismatch", "run-reverse-mixed"]);
	expect(runs.map(({ admission, label }) => [admission, label])).toEqual([
		["Current", "Last admitted: run-started at 2026-07-20T00:00:00.000Z"],
		["Invalid", "Invalid"],
		["Invalid", "Invalid"],
		["Invalid", "Invalid"],
		["Unverifiable", "Unverifiable"],
		["Legacy", "Legacy"],
		["Unverifiable", "Unverifiable"],
		["Invalid", "Invalid"],
	]);
	expect(runs.slice(1).every(({ projection }) => projection === null)).toBe(true);
	expect(runs.find(({ id }) => id === "run-legacy")).toMatchObject({ admission: "Legacy", reason: "recognized older Execution Event generation", updatedAt: "2026-07-15T00:00:00.001Z" });
});


test("catalog browses ordered final rounds and historical round filenames", async () => {
	const artifactRoot = root();
	write(join(artifactRoot, "packet", "executions", "run", "execution-run.json"), { schema: "fanout.execution-run", version: 6, runId: "run" });
	const names = ["initial.json", "repair-abcdef123456-accepted.json", "000-initial.json", "001-repair-abcdef123456.json", "002-repair-abcdef123456-accepted.json"];
	for (const name of names) write(join(artifactRoot, "packet", "executions", "run", "final-validation", "rounds", name), `${name}\n`);
	const catalog = new ProfilerCatalog(artifactRoot);
	const evidence = catalog.snapshot().supportingEvidence;
	expect(evidence.map(({ label }) => label)).toEqual(names.sort().map((name) => `final-validation/rounds/${name}`));
	for (const item of evidence) expect((await catalog.readEvidencePage(item.source!.id)).rows).toEqual([item.label.split("/").at(-1)!]);
});
