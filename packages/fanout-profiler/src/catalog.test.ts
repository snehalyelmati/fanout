import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfilerCatalog } from "./catalog";

const roots: string[] = [];
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

function plan(id: string, version = 2): Record<string, unknown> {
	const git = "1".repeat(40);
	return {
		schema: "fanout.implementation-plan",
		version,
		planId: id,
		createdAt: `2026-07-${id === "new" ? "20" : "19"}T00:00:00.000Z`,
		planningHost: { platform: process.platform },
		planningBase: { headCommit: git, tree: git },
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

function event(runId: string, occurredAt: string, version = 3): Record<string, unknown> {
	return { schema: "fanout.execution-event", version, runId, sequence: 1, occurredAt, event: "run-started", payload: {} };
}

test("catalog narrowly discovers planning, legacy, invalid, and unverifiable evidence", async () => {
	const artifactRoot = root();
	const planningPath = join(artifactRoot, "planning-only", "implementation-plan.json");
	write(planningPath, plan("old"));
	const planningBytes = readFileSync(planningPath);
	write(join(artifactRoot, "legacy", "implementation-plan.json"), plan("old", 1));
	write(join(artifactRoot, "invalid", "implementation-plan.json"), "{");
	write(join(artifactRoot, "invalid", "implementation-details.json"), { schema: "fanout.implementation-details", version: 3 });
	write(join(artifactRoot, "projection-only", "executions", "run-projection", "execution-run.json"), {
		schema: "fanout.execution-run", version: 4, runId: "run-projection", startedAt: "2026-07-20T00:00:00.000Z",
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
		["planning-only", "Planning-only"],
	]);
	expect(snapshot.executionRuns.map(({ id, admission }) => [id, admission])).toEqual([
		["run-projection", "Unverifiable"],
		["run-v2", "Legacy"],
	]);
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
