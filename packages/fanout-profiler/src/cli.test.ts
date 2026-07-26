import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { fanoutProjectId } from "../../fanout-pi/src/fanout-runtime-context";

const cli = join(import.meta.dir, "cli.ts");
const launcher = join(import.meta.dir, "../../../scripts/start-profiler.ts");
const artifactRoot = mkdtempSync(join(tmpdir(), "fanout-profiler-"));
const outsideRoot = mkdtempSync(join(tmpdir(), "fanout-profiler-outside-"));
let profilerProcess: ReturnType<typeof Bun.spawn>;
let url: string;

function availablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const listener = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
			const address = listener.address();
			listener.close(error => error ? reject(error) : resolve(typeof address === "object" && address ? address.port : 0));
		});
	});
}

beforeAll(async () => {
	mkdirSync(join(artifactRoot, "packet", "executions", "run-projection"), { recursive: true });
	writeFileSync(join(artifactRoot, "packet", "executions", "run-projection", "execution-run.json"), `${JSON.stringify({ schema: "fanout.execution-run", version: 4, runId: "run-projection", startedAt: "2026-07-20T00:00:00.000Z" })}\n`);
	const git = "1".repeat(40);
	mkdirSync(join(artifactRoot, "planning-only"), { recursive: true });
	writeFileSync(join(artifactRoot, "planning-only", "implementation-plan.json"), `${JSON.stringify({
		schema: "fanout.implementation-plan", version: 2, planId: "planning-only", createdAt: "2026-07-20T00:00:00.000Z", planningHost: { platform: process.platform }, planningBase: { headCommit: git, tree: git },
		objective: "Keep <script>alert('artifact')</script> as text", userContext: [], discoveredRepoFacts: [], assumptions: [],
		implementationItems: [{ id: "work", goals: ["Do work"], writeResources: [{ kind: "file", path: "src/work.ts" }], readResources: [], forbiddenWrites: [], semanticReviewCriteria: ["Works"], advisoryNotes: [] }],
	})}\n`);
	mkdirSync(join(artifactRoot, "observability", "session"), { recursive: true });
	writeFileSync(join(artifactRoot, "observability", "session", "observability.jsonl"), "one\ntwo\n");
	writeFileSync(join(outsideRoot, "observability.jsonl"), "outside\n");
	const port = await availablePort();
	profilerProcess = Bun.spawn([Bun.argv[0], cli, "--artifact-root", artifactRoot, "--port", String(port)], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const reader = profilerProcess.stdout.getReader();
	const { value } = await reader.read();
	reader.releaseLock();
	if (!value) throw new Error(await new Response(profilerProcess.stderr).text());
	url = new TextDecoder().decode(value).trim();
});

afterAll(() => {
	profilerProcess?.kill();
	rmSync(artifactRoot, { recursive: true, force: true });
	rmSync(outsideRoot, { recursive: true, force: true });
});

test("startup requires one fixed artifact root", async () => {
	const missing = Bun.spawn([Bun.argv[0], cli], { stdout: "ignore", stderr: "pipe" });
	expect(await missing.exited).not.toBe(0);
	expect(await new Response(missing.stderr).text()).toContain("--artifact-root");
});

test("repository startup resolves the cwd project and preserves the explicit override", async () => {
	const project = realpathSync(mkdtempSync(join(tmpdir(), "fanout-profiler-project-")));
	const storage = mkdtempSync(join(tmpdir(), "fanout-profiler-storage-"));
	const projectId = fanoutProjectId(project);
	const runDir = join(storage, projectId, "packet", "executions", "cwd-run"), otherRunDir = join(storage, "other-project", "packet", "executions", "other-run");
	mkdirSync(runDir, { recursive: true }); mkdirSync(otherRunDir, { recursive: true });
	writeFileSync(join(runDir, "execution-run.json"), `${JSON.stringify({ schema: "fanout.execution-run", version: 4, runId: "cwd-run", startedAt: "2026-07-25T00:00:00.000Z" })}\n`);
	writeFileSync(join(otherRunDir, "execution-run.json"), `${JSON.stringify({ schema: "fanout.execution-run", version: 4, runId: "other-run", startedAt: "2026-07-26T00:00:00.000Z" })}\n`);
	const start = async (args: string[]) => {
		const process = Bun.spawn([Bun.argv[0], launcher, ...args], { cwd: project, env: { ...Bun.env, FANOUT_ARTIFACT_DIR: storage }, stdout: "pipe", stderr: "pipe" });
		const reader = process.stdout.getReader();
		const { value } = await reader.read();
		reader.releaseLock();
		if (!value) throw new Error(await new Response(process.stderr).text());
		return { process, url: new TextDecoder().decode(value).trim() };
	};
	try {
		const automatic = await start(["--port", String(await availablePort())]);
		try {
			const projects = await (await fetch(`${automatic.url}/api/projects`)).json() as any;
			expect(projects.selectedProjectId).toBe(projectId);
			expect(projects.projects.map(({ id }) => id)).toEqual(["other-project", projectId]);
			const catalog = await (await fetch(`${automatic.url}/api/catalog`)).json() as any;
			expect(catalog).toMatchObject({ projectId, recentRuns: [expect.objectContaining({ runId: "cwd-run" })] });
			const other = await (await fetch(`${automatic.url}/api/catalog?project=other-project`)).json() as any;
			expect(other).toMatchObject({ projectId: "other-project", recentRuns: [expect.objectContaining({ runId: "other-run" })] });
			expect((await fetch(`${automatic.url}/api/catalog?project=missing`)).status).toBe(400);
			expect((await fetch(`${automatic.url}/api/projects?project=missing`)).status).toBe(400);
			rmSync(join(storage, projectId), { recursive: true });
			const disappeared = await (await fetch(`${automatic.url}/api/refresh?project=${projectId}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json() as any;
			expect(disappeared).toMatchObject({ projectId: "other-project", selectedProjectId: "other-project", disappearedProjectId: projectId, projects: [expect.objectContaining({ id: "other-project" })] });
		} finally { automatic.process.kill(); }

		const explicit = await start(["--artifact-root", artifactRoot, "--port", String(await availablePort())]);
		try {
			const catalog = await (await fetch(`${explicit.url}/api/catalog`)).json() as any;
			expect(catalog.recentRuns).toContainEqual(expect.objectContaining({ runId: "run-projection" }));
			expect(catalog.recentRuns).not.toContainEqual(expect.objectContaining({ runId: "cwd-run" }));
		} finally { explicit.process.kill(); }
	} finally {
		rmSync(project, { recursive: true, force: true });
		rmSync(storage, { recursive: true, force: true });
	}
});

test("local profiler exposes only the bounded same-origin HTTP shell", async () => {
	expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
	const immutableSources = [
		join(artifactRoot, "packet", "executions", "run-projection", "execution-run.json"),
		join(artifactRoot, "planning-only", "implementation-plan.json"),
	].map((path) => [path, readFileSync(path)] as const);

	const page = await fetch(url);
	expect(page.status).toBe(200);
	expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
	expect(page.headers.has("access-control-allow-origin")).toBe(false);
	const html = await page.text();
	expect(html).not.toContain("<script>alert('artifact')</script>");
	expect(html).toMatch(/<select id="project" aria-label="Fanout project">.*id="refresh".*aria-label="Refresh project evidence".*title="Refresh project evidence"/s);
	expect(html).toMatch(/<header[\s>].*Packet DAG.*Workflow Lineages.*Recent Runs.*Execution Evidence.*Counterfactual Scenario.*Observed.*Sequential.*Custom.*Unlimited.*Tier 1 Provider Profile.*Tier 2 Provider Profile.*Fixed TTFT.*Cold\/warm TTFT.*Cache-read.*Cache-write.*Diagnostic Observations.*Duration.*Cost.*Frequency.*Chronology.*Run and cross-packet Node comparison.*Comparison Node A.*Comparison Node B.*Inspector.*<footer[\s>]/s);
	expect(html).toMatch(/data-pane="dag".*aria-label="Maximize DAG pane".*role="separator".*aria-label="Resize DAG and Execution Evidence panes".*data-pane="evidence".*aria-label="Maximize Execution Evidence pane".*role="separator".*aria-label="Resize Execution Evidence and Inspector panes".*data-pane="inspector".*aria-label="Maximize Inspector pane"/s);
	expect(html).toMatch(/id="waterfall".*id="breadcrumbs".*id="events"/s);
	expect((await fetch(`${url}/?run=packet%2Fexecutions%2Frun-projection&kind=run&id=packet%2Fexecutions%2Frun-projection`)).status).toBe(200);
	const app = await (await fetch(`${url}/assets/app.js`)).text();
	const comparisonRendering = await (await fetch(`${url}/assets/comparison-render.js`)).text();
	const scenarioRendering = await (await fetch(`${url}/assets/scenario-render.js`)).text();
	const workspaceRendering = await (await fetch(`${url}/assets/workspace-render.js`)).text();
	const interaction = await (await fetch(`${url}/assets/interaction.js`)).text();
	const formatting = await (await fetch(`${url}/assets/format.js`)).text();
	const toolDetail = await (await fetch(`${url}/assets/tool-detail.js`)).text();
	const styles = await (await fetch(`${url}/assets/app.css`)).text();
	const modulePaths = [["comparison-render.mjs", comparisonRendering], ["scenario-render.mjs", scenarioRendering], ["workspace-render.mjs", workspaceRendering]].map(([name, source]) => { const path = join(outsideRoot, name); writeFileSync(path, source); return pathToFileURL(path).href; });
	const [comparisonModule, scenarioModule, workspaceModule] = await Promise.all(modulePaths.map((path) => import(path)));
	expect(typeof comparisonModule.createComparisonController).toBe("function");
	expect(typeof scenarioModule.createScenarioController).toBe("function");
	expect(typeof workspaceModule.createWorkspaceRenderer).toBe("function");
	expect(app).toContain('from "/assets/comparison-render.js"');
	expect(app).toContain('from "/assets/scenario-render.js"');
	expect(app).toContain('from "/assets/workspace-render.js"');
	expect(app).toContain('from "/assets/format.js"');
	expect(app).toContain('from "/assets/tool-detail.js"');
	expect(app).toContain("receiptNode, formatDuration, formatValue, interaction");
	expect(formatting).toContain("formatDuration");
	expect(toolDetail).toContain("createToolDetailLoader");
	expect(comparisonRendering).toContain("nodePair");
	expect(app).toContain("loadDiagnostics");
	expect(app).toContain('fetch(api("/api/workspace"');
	expect(app).toContain("clearProjectWorkspace");
	expect(app).toContain("resetProjectState");
	expect(app).toContain("No Fanout project evidence found");
	expect(app).toContain("is no longer available");
	expect(scenarioRendering).toContain("runScenario");
	expect(scenarioRendering).toContain("profileValue");
	expect(scenarioRendering).toMatch(/Attempt.*Provider call.*Tool.*Validation scope.*Ledger/s);
	expect(app).toContain("history.pushState");
	expect(app).toContain("popstate");
	expect(workspaceRendering).toContain("aria-expanded");
	expect(workspaceRendering).toContain('choose.addEventListener("click", expandable ? expand');
	expect(workspaceRendering).toContain("Resize waterfall information column");
	expect(styles).toContain(".analysis-tools[open]");
	expect(styles).toContain("overflow-y: auto");
	expect(workspaceRendering).toContain("source-group");
	expect(interaction).toContain("Escape");
	expect(workspaceRendering).toContain("Planned routing");
	expect(workspaceRendering).toContain("Observed Attempt routing");

	const catalog = await fetch(`${url}/api/catalog`);
	expect(catalog.status).toBe(200);
	const catalogBody = await catalog.json() as any;
	expect(catalogBody.recentRuns[0]).toMatchObject({ runId: "run-projection", admission: "Unverifiable" });
	expect(catalogBody.lineages).toContainEqual(expect.objectContaining({ id: "planning-only", admission: "Planning-only", executionRunCount: 0 }));
	const planningWorkspace = await (await fetch(`${url}/api/workspace?kind=lineage&id=planning-only`)).json() as any;
	expect(planningWorkspace).toMatchObject({ selection: { kind: "lineage", id: "planning-only" }, objective: "Keep <script>alert('artifact')</script> as text", events: [], metrics: [] });
	expect(planningWorkspace.inspector.fields).toContainEqual(["Execution state", "Unavailable — no admitted Execution Run"]);
	const workspace = await fetch(`${url}/api/workspace`);
	expect(workspace.status).toBe(200);
	expect((await workspace.json() as any).inspector).toMatchObject({ kind: "Execution Run" });
	const diagnostics = await fetch(`${url}/api/diagnostics?sort=frequency`);
	expect(diagnostics.status).toBe(200);
	expect(await diagnostics.json()).toMatchObject({ sort: "frequency", observations: [], suppressions: [{ rule: "ready-work-waited-with-free-capacity" }, { rule: "attempt-causally-replaced" }] });
	expect((await fetch(`${url}/api/diagnostics?sort=severity`)).status).toBe(400);
	const refreshed = await fetch(`${url}/api/refresh`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: "{}" });
	expect(refreshed.status).toBe(200);
	expect((await refreshed.json() as any).generation).toBe(2);

	const comparison = await fetch(`${url}/api/comparison`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ runAId: "packet/executions/run-projection" }) });
	expect(comparison.status).toBe(200);
	expect(await comparison.json()).toMatchObject({ pair: null, cohorts: [] });
	expect((await fetch(`${url}/api/comparison`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ runAId: "missing" }) })).status).toBe(400);
	const nodeComparison = await fetch(`${url}/api/comparison`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ runAId: "packet/executions/run-projection", runBId: "packet/executions/run-projection", nodeAId: "a", nodeBId: "b" }) });
	expect(nodeComparison.status).toBe(400);
	expect(await nodeComparison.json()).toEqual({ error: "Node comparison requires two admitted packets and replayed runs" });
	expect((await fetch(`${url}/api/comparison`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ runAId: "packet/executions/run-projection", runBId: "packet/executions/run-projection", nodeAId: "a" }) })).status).toBe(400);
	const scenario = await fetch(`${url}/api/scenario`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ runId: "packet/executions/run-projection", concurrency: { mode: "observed" } }) });
	expect(scenario.status).toBe(400);
	expect(await scenario.json()).toEqual({ error: "scenario requires one current admitted Event Log, Execution Packet, and replayed projection" });
	expect((await fetch(`${url}/api/scenario`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ concurrency: { mode: "custom", limit: 0 } }) })).status).toBe(400);
	expect((await fetch(`${url}/api/scenario`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ concurrency: { mode: "observed" }, perCallOverrides: [] }) })).status).toBe(400);

	expect((await fetch(`${url}/api/evidence?path=/etc/passwd`)).status).toBe(400);
	expect((await fetch(`${url}/api/evidence?reference=unknown-reference`)).status).toBe(400);
	const refreshedPlanningWorkspace = await (await fetch(`${url}/api/workspace?kind=lineage&id=planning-only`)).json() as any;
	const evidenceReference = refreshedPlanningWorkspace.supportingEvidence[0].source.id;
	const evidenceBefore = readFileSync(join(artifactRoot, "observability", "session", "observability.jsonl"));
	const evidencePage = await fetch(`${url}/api/evidence?reference=${encodeURIComponent(evidenceReference)}&limit=1`);
	expect(await evidencePage.json()).toEqual({ status: "Current", rows: ["one"], nextOffset: 1 });
	const session = join(artifactRoot, "observability", "session"), movedSession = `${session}-moved`;
	renameSync(session, movedSession);
	symlinkSync(outsideRoot, session);
	expect(await (await fetch(`${url}/api/evidence?reference=${encodeURIComponent(evidenceReference)}`)).json()).toEqual({ status: "Changed since refresh", rows: [], nextOffset: null });
	rmSync(session);
	renameSync(movedSession, session);
	writeFileSync(join(session, "observability.jsonl"), "changed\n");
	expect(await (await fetch(`${url}/api/evidence?reference=${encodeURIComponent(evidenceReference)}`)).json()).toEqual({ status: "Changed since refresh", rows: [], nextOffset: null });
	writeFileSync(join(session, "observability.jsonl"), evidenceBefore);
	expect((await fetch(`${url}/api/refresh`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ path: "/etc/passwd" }) })).status).toBe(400);
	expect((await fetch(url, { headers: { host: "example.com" } })).status).toBe(403);
	expect((await fetch(url, { headers: { origin: "https://example.com" } })).status).toBe(403);
	expect((await fetch(`${url}/api/scenario`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: "x".repeat(65_537) })).status).toBe(413);
	expect((await fetch(`${url}/etc/passwd`)).status).toBe(404);

	const generationBeforeFailure = (await (await fetch(`${url}/api/catalog`)).json() as any).generation;
	const movedRoot = `${artifactRoot}-moved`;
	renameSync(artifactRoot, movedRoot);
	mkdirSync(artifactRoot);
	expect((await fetch(`${url}/api/refresh`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: "{}" })).status).toBe(500);
	rmSync(artifactRoot, { recursive: true });
	renameSync(movedRoot, artifactRoot);
	expect((await (await fetch(`${url}/api/catalog`)).json() as any).generation).toBe(generationBeforeFailure);
	expect(readFileSync(join(artifactRoot, "observability", "session", "observability.jsonl"))).toEqual(evidenceBefore);
	for (const [path, bytes] of immutableSources) expect(readFileSync(path)).toEqual(bytes);
});
