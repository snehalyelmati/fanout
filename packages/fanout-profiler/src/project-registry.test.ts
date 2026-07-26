import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry } from "./project-registry";

function execution(root: string, project: string, runId: string, startedAt: string): void {
	const run = join(root, project, "packet", "executions", runId);
	mkdirSync(run, { recursive: true });
	writeFileSync(join(run, "execution-run.json"), `${JSON.stringify({ schema: "fanout.execution-run", version: 4, runId, startedAt })}\n`);
}

test("storage registry discovers evidence projects, isolates catalogs, and rescans safely", async () => {
	const root = mkdtempSync(join(tmpdir(), "fanout-project-registry-"));
	const outside = mkdtempSync(join(tmpdir(), "fanout-project-outside-"));
	try {
		execution(root, "alpha-111", "alpha-run", "2026-07-24T00:00:00.000Z");
		execution(root, "beta-222", "beta-run", "2026-07-25T00:00:00.000Z");
		for (const project of ["alpha-111", "beta-222"]) { const evidence = join(root, project, "observability", "session"); mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, "observability.jsonl"), `${project}\n`); }
		mkdirSync(join(root, "runtime-only", "observability", "session"), { recursive: true });
		writeFileSync(join(root, "runtime-only", "observability", "session", "observability.jsonl"), "runtime only\n");
		mkdirSync(join(root, "symlink-only")); writeFileSync(join(outside, "active-packet.json"), "{}\n"); symlinkSync(join(outside, "active-packet.json"), join(root, "symlink-only", "active-packet.json"));
		symlinkSync(outside, join(root, "escaped"));

		const registry = new ProjectRegistry({ storageRoot: root, preferredProjectId: "alpha-111" });
		expect(registry.overview()).toEqual({
			selectedProjectId: "alpha-111",
			projects: [
				expect.objectContaining({ id: "beta-222", executionRuns: 1 }),
				expect.objectContaining({ id: "alpha-111", executionRuns: 1 }),
			],
		});
		expect(() => registry.overview("missing")).toThrow("project is not in the active storage root");
		expect(registry.overview().projects.map(({ id }) => id)).not.toContain("symlink-only");
		const alpha = registry.require("alpha-111").catalog, beta = registry.require("beta-222").catalog;
		expect(alpha.snapshot().executionRuns[0]?.id).toBe("alpha-run");
		const alphaReference = alpha.snapshot().supportingEvidence[0].source!.id;
		expect(beta.snapshot().supportingEvidence[0].source!.id).not.toBe(alphaReference);
		await expect(beta.readEvidencePage(alphaReference)).rejects.toThrow("Source Reference was not issued by the active snapshot");
		expect(() => registry.require("escaped")).toThrow("project is not in the active storage root");

		const oldBeta = join(outside, "old-beta"); renameSync(join(root, "beta-222"), oldBeta); execution(root, "beta-222", "beta-new", "2026-07-25T01:00:00.000Z");
		await registry.refresh("alpha-111");
		expect(registry.require("beta-222").catalog.snapshot().executionRuns[0]?.id).toBe("beta-new");

		execution(root, "gamma-333", "gamma-run", "2026-07-26T00:00:00.000Z");
		const refreshed = await registry.refresh("gamma-333");
		expect(refreshed.selection?.project).toMatchObject({ id: "gamma-333", executionRuns: 1 });
		expect(registry.overview().projects.map(({ id }) => id)).toEqual(["gamma-333", "beta-222", "alpha-111"]);

		rmSync(join(root, "gamma-333"), { recursive: true });
		const disappeared = await registry.refresh("gamma-333");
		expect(disappeared).toMatchObject({ selection: null, selectedProjectId: "alpha-111", disappearedProjectId: "gamma-333" });
		expect(() => registry.overview("gamma-333")).toThrow("project is not in the active storage root");

		const moved = `${root}-moved`;
		renameSync(root, moved);
		mkdirSync(root);
		await expect(registry.refresh("alpha-111")).rejects.toThrow("artifact root must remain one canonical directory");
		expect(registry.overview().projects.map(({ id }) => id)).toEqual(["beta-222", "alpha-111"]);
		rmSync(root, { recursive: true });
		renameSync(moved, root);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("empty storage root exposes an explicit empty state", async () => {
	const root = mkdtempSync(join(tmpdir(), "fanout-project-empty-"));
	try {
		const registry = new ProjectRegistry({ storageRoot: root });
		expect(registry.overview()).toEqual({ projects: [], selectedProjectId: null });
		expect(await registry.refresh()).toEqual({ selection: null, projects: [], selectedProjectId: null, disappearedProjectId: null });
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("explicit artifact root remains a single-project registry", () => {
	const root = mkdtempSync(join(tmpdir(), "fanout-project-single-"));
	try {
		const registry = new ProjectRegistry({ artifactRoot: root });
		expect(registry.overview()).toEqual({ projects: [expect.objectContaining({ id: root.split("/").at(-1), planningRuns: 0, executionRuns: 0 })], selectedProjectId: root.split("/").at(-1) });
	} finally { rmSync(root, { recursive: true, force: true }); }
});
