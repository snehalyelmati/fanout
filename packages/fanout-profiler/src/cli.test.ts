import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const cli = join(import.meta.dir, "cli.ts");
const artifactRoot = mkdtempSync(join(tmpdir(), "fanout-profiler-"));
let process: ReturnType<typeof Bun.spawn>;
let url: string;

beforeAll(async () => {
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
	expect(await page.text()).toMatch(/<header[\s>].*<main[\s>].*<footer[\s>]/s);

	for (const path of ["catalog", "workspace", "evidence"]) {
		expect((await fetch(`${url}/api/${path}`)).status).toBe(501);
	}
	for (const path of ["comparison", "scenario", "refresh"]) {
		expect((await fetch(`${url}/api/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: "{}" })).status).toBe(501);
	}

	expect((await fetch(`${url}/api/evidence?path=/etc/passwd`)).status).toBe(400);
	expect((await fetch(`${url}/api/refresh`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ path: "/etc/passwd" }) })).status).toBe(400);
	expect((await fetch(url, { headers: { host: "example.com" } })).status).toBe(403);
	expect((await fetch(url, { headers: { origin: "https://example.com" } })).status).toBe(403);
	expect((await fetch(`${url}/api/scenario`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: "x".repeat(65_537) })).status).toBe(413);
	expect((await fetch(`${url}/etc/passwd`)).status).toBe(404);
});
