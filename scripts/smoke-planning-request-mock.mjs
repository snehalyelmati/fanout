// Exercise the installed Pi CLI, not just this checkout's (possibly older) SDK.
// Only synthetic content is used; diagnostics contain lengths/hashes, never prompts or credentials.
// FANOUT_TEST_PI=/absolute/path/to/pi selects another installed runtime without installing one.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { publishProjectExecutionProfile } from "../packages/fanout-pi/src/project-execution-profile.ts";
import { validProfile, validSubmission } from "./planning-boundary-fixtures.mjs";

const root = realpathSync(mkdtempSync(join(tmpdir(), "fanout-request-mock-")));
const cwd = join(root, "repo");
const agentDir = join(root, "agent");
const artifacts = join(root, "artifacts");
const model = "moonshotai/kimi-k3";
const objective = "Read ../TASK.md and implement that feature request exactly.";
const metadata = (text = "") => ({ bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") });
const requests = [];
let failure;
const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/models") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ data: [{ id: model, reasoning: true }] }));
    }
    assert.equal(req.url, "/responses");
    assert.equal(req.method, "POST");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const system = body.input.filter((item) => item.role === "system").flatMap((item) => item.content).map((part) => part.text ?? "").join("\n\n");
    const summary = {
      boundary: "http", model: body.model, system: { present: Boolean(system), ...metadata(system) },
      users: body.input.filter((item) => item.role === "user").map((item) => metadata(JSON.stringify(item.content))),
      tools: (body.tools ?? []).map((tool) => tool.name), reasoning: body.reasoning_effort,
    };
    console.log(JSON.stringify(summary));
    requests.push(summary);
    assert.equal(body.model, model);
    assert(system.includes(objective), "outbound request lost Fanout objective");
    assert(system.includes("fanout.plan.orchestration.v1"), "outbound request lost planning instructions");
    assert(system.includes('"phase":"implementation"'), "fixture did not reuse its approved profile");
    assert.deepEqual(summary.tools.toSorted(), ["read", "grep", "find", "ls", "fanout_submit_artifact"].toSorted());
    assert.equal(body.reasoning_effort, "medium");
    if (requests.length === 2) {
      assert(body.input.some((item) => item.type === "function_call_output" && item.output.includes("Synthetic task")), "task read result missing from replay");
    }
    assert(requests.length <= 2, "unexpected additional provider request");
    const output = requests.length === 1
      ? [{ type: "function_call", call_id: "read-task", name: "read", arguments: JSON.stringify({ path: "../TASK.md" }) }]
      : [{ type: "function_call", call_id: "submit-plan", name: "fanout_submit_artifact", arguments: JSON.stringify({ artifact: validSubmission() }) }];
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`event: response.completed\ndata: ${JSON.stringify({ response: { id: `mock-${requests.length}`, status: "completed", output, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } })}\n\ndata: [DONE]\n\n`);
  } catch (error) {
    failure ??= error;
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "offline request assertion failed" }));
  }
});

try {
  mkdirSync(cwd);
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  writeFileSync(join(root, "TASK.md"), "Synthetic task: update the Test section in README.md.\n");
  writeFileSync(join(cwd, "README.md"), "# Test\n");
  for (const args of [["init", "-q"], ["add", "README.md"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]]) execFileSync("git", args, { cwd });
  const projectId = `${basename(cwd)}-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}`;
  const projectRoot = join(artifacts, projectId);
  publishProjectExecutionProfile({ schema: "fanout.project-execution-profile", version: 1, profileId: "mock", createdAt: new Date(0).toISOString(), ...validProfile() }, projectRoot, join(projectRoot, "active-profile.json"));
  const extension = join(root, "probe.ts");
  writeFileSync(extension, `
import fanout from ${JSON.stringify(resolve("packages/fanout-pi/src/index.ts"))};
import { createHash } from 'node:crypto';
export default async function(pi) {
  const register = pi.registerProvider.bind(pi);
  pi.registerProvider = (name, config) => register(name, { ...config, streamSimple: (model, context, options) => {
    const systems = context.messages.filter(m => m.role === 'system');
    console.error(JSON.stringify({ boundary: 'provider-context', keys: Object.keys(context), systems: systems.map(m => ({ contentBytes: Buffer.byteLength(m.content || ''), sections: Object.keys(m.sections || {}), tools: (m.toolsAdded || []).map(t => t.name) })) }));
    return config.streamSimple(model, context, options);
  }});
  await fanout(pi);
  pi.on('before_agent_start', (event) => {
    console.error(JSON.stringify({ boundary: 'before-agent-start', bytes: Buffer.byteLength(event.systemPrompt), sha256: createHash('sha256').update(event.systemPrompt).digest('hex'), hasObjective: event.systemPrompt.includes(${JSON.stringify(objective)}) }));
  });
  pi.on('agent_settled', () => console.error(JSON.stringify({ boundary: 'settled' })));
}
`);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  // Deliberately do not inherit credentials, NODE_OPTIONS, proxies, or provider URLs.
  const env = {
    PATH: process.env.PATH, HOME: root, TMPDIR: root, PI_OFFLINE: "1", PI_TELEMETRY: "0",
    PI_CODING_AGENT_DIR: agentDir, FANOUT_ARTIFACT_DIR: artifacts,
    DOUBLEWORD_API_KEY: "offline-mock-only", DOUBLEWORD_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    DOUBLEWORD_MODEL_CACHE_FILE: join(root, "models.json"), DOUBLEWORD_EXECUTION_MODE: "realtime",
    DOUBLEWORD_OBSERVABILITY_FILE: join(root, "observability.jsonl"),
  };
  const command = process.env.FANOUT_TEST_PI ?? "pi";
  const args = ["--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "-e", extension, "--model", `doubleword/${model}`, "--thinking", "medium", "--mode", "rpc"];
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  createInterface({ input: child.stderr }).on("line", (line) => {
    if (line === '{"boundary":"settled"}') child.stdin.end();
  });
  child.stdin.write(`${JSON.stringify({ type: "prompt", message: `/fanout-plan ${objective}` })}\n`);
  const timer = setTimeout(() => child.kill("SIGTERM"), 20_000);
  const status = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); }).finally(() => clearTimeout(timer));
  // Only print explicitly tagged metadata, not arbitrary runtime errors or request bodies.
  for (const line of stderr.split("\n")) if (line.startsWith('{"boundary":')) console.log(line);
  if (failure) throw failure;
  assert.equal(status, 0, "Pi CLI failed (raw output intentionally not logged)");
  assert.equal(requests.length, 2, "planning did not read task and submit plan");
  const injected = stderr.split("\n").filter((line) => line.startsWith('{"boundary":"before-agent-start"')).map(JSON.parse);
  assert.equal(injected.length, 1, "missing prompt injection receipt");
  for (const request of requests) {
    assert.equal(request.system.sha256, injected[0].sha256, "serialized prompt differs from injected prompt");
    assert.equal(request.system.bytes, injected[0].bytes);
  }
  const events = readFileSync(join(root, "observability.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert(events.some((event) => event.event === "fanout_plan_end"), "mock planning artifact was not accepted");
  assert(!events.some((event) => event.event === "fanout_plan_failed"), "mock planning failed");
  console.log("planning request mock passed (task read, submission accepted; loopback only)");
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
