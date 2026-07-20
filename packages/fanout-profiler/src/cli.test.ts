import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const cli = join(import.meta.dir, "cli.ts");
const artifactRoot = mkdtempSync(join(tmpdir(), "fanout-profiler-"));
let process: ReturnType<typeof Bun.spawn>;
let url: string;

beforeAll(async () => {
	mkdirSync(join(artifactRoot, "packet", "executions", "run-projection"), { recursive: true });
	writeFileSync(join(artifactRoot, "packet", "executions", "run-projection", "execution-run.json"), `${JSON.stringify({ schema: "fanout.execution-run", version: 4, runId: "run-projection", startedAt: "2026-07-20T00:00:00.000Z" })}\n`);
	const port = await new Promise<number>((resolve, reject) => {
		const listener = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
			const address = listener.address();
			listener.close(error => error ? reject(error) : resolve(typeof address === "object" && address ? address.port : 0));
		});
	});
	process = Bun.spawn([Bun.argv[0], cli, "--artifact-root", artifactRoot, "--port", String(port)], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const reader = process.stdout.getReader();
	const { value } = await reader.read();
	reader.releaseLock();
	if (!value) throw new Error(await new Response(process.stderr).text());
	url = new TextDecoder().decode(value).trim();
});

afterAll(() => {
	process?.kill();
	rmSync(artifactRoot, { recursive: true, force: true });
});

test("startup requires one fixed artifact root", async () => {
	const missing = Bun.spawn([Bun.argv[0], cli], { stdout: "ignore", stderr: "pipe" });
	expect(await missing.exited).not.toBe(0);
	expect(await new Response(missing.stderr).text()).toContain("--artifact-root");
});

test("local profiler exposes only the bounded same-origin HTTP shell", async () => {
	expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

	const page = await fetch(url);
	expect(page.status).toBe(200);
	expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
	expect(page.headers.has("access-control-allow-origin")).toBe(false);
	expect(await page.text()).toMatch(/<header[\s>].*Packet DAG.*Recent Runs.*Trace Evidence.*Counterfactual Scenario.*Observed.*Sequential.*Custom.*Unlimited.*Diagnostic Observations.*Duration.*Cost.*Frequency.*Chronology.*Run and cross-packet Node comparison.*Comparison Node A.*Comparison Node B.*Inspector.*<footer[\s>]/s);
	const app = await (await fetch(`${url}/assets/app.js`)).text();
	expect(app).toContain("nodePair");
	expect(app).toContain("loadDiagnostics");
	expect(app).toContain("runScenario");

	const catalog = await fetch(`${url}/api/catalog`);
	expect(catalog.status).toBe(200);
	expect((await catalog.json() as any).recentRuns[0]).toMatchObject({ runId: "run-projection", admission: "Unverifiable" });
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

	expect((await fetch(`${url}/api/evidence?path=/etc/passwd`)).status).toBe(400);
	expect((await fetch(`${url}/api/refresh`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ path: "/etc/passwd" }) })).status).toBe(400);
	expect((await fetch(url, { headers: { host: "example.com" } })).status).toBe(403);
	expect((await fetch(url, { headers: { origin: "https://example.com" } })).status).toBe(403);
	expect((await fetch(`${url}/api/scenario`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: "x".repeat(65_537) })).status).toBe(413);
	expect((await fetch(`${url}/etc/passwd`)).status).toBe(404);
});
