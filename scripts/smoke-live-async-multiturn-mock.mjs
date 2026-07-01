import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-live-async-multiturn-mock-"));
const logFile = join(dir, "observability.jsonl");
const agentDir = join(dir, "agent");
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));

const toolResponseId = "resp_tool_1";
const finalResponseId = "resp_final_1";
const finalText = "Doubleword async multi-turn final answer.";
const requests = [];
let submitCount = 0;

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function readBody(req) {
  req.setEncoding("utf8");
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/responses") {
      const body = JSON.parse(await readBody(req));
      submitCount++;
      const responseId = submitCount === 1 ? toolResponseId : finalResponseId;
      requests.push({ method: req.method, path: url.pathname, responseId, body });
      return sendJson(res, 200, { id: responseId, status: "queued", service_tier: "flex" });
    }
    if (req.method === "GET" && url.pathname === `/responses/${toolResponseId}`) {
      requests.push({ method: req.method, path: url.pathname });
      return sendJson(res, 200, {
        id: toolResponseId,
        status: "completed",
        service_tier: "flex",
        output: [
          {
            type: "function_call",
            id: "fc_read_1",
            call_id: "call_read_1",
            name: "read",
            arguments: JSON.stringify({ path: "README.md", limit: 1 }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });
    }
    if (req.method === "GET" && url.pathname === `/responses/${finalResponseId}`) {
      requests.push({ method: req.method, path: url.pathname });
      return sendJson(res, 200, {
        id: finalResponseId,
        status: "completed",
        service_tier: "flex",
        output_text: finalText,
        usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 },
      });
    }
    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function runPi(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn("pi", ["-e", ".", "--model", "doubleword/deepseek-ai/DeepSeek-V4-Flash", "-p", "Use a tool to inspect README, then answer."], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOUBLEWORD_API_KEY: "mock-key",
        DOUBLEWORD_BASE_URL: baseUrl,
        DOUBLEWORD_MAX_OUTPUT_TOKENS: "16384",
        DOUBLEWORD_OBSERVABILITY_FILE: logFile,
        DOUBLEWORD_RUN_ID: "smoke-live-async-multiturn-mock",
        DOUBLEWORD_EXECUTION_MODE: "async",
        DOUBLEWORD_LIVE_ASYNC_POLL_MS: "0",
        DOUBLEWORD_LIVE_ASYNC_TIMEOUT_MS: "30000",
        PI_CODING_AGENT_DIR: agentDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), Number(process.env.DOUBLEWORD_LIVE_ASYNC_MULTITURN_MOCK_TIMEOUT_MS ?? 60_000));
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ status: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (status, signal) => finish({ status, signal, stdout, stderr }));
  });
}

try {
  const port = await listen();
  const result = await runPi(`http://127.0.0.1:${port}`);
  assert(result.status === 0, `mock live async multi-turn failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert(result.stdout.includes(finalText), `missing final answer\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert(!result.stdout.includes("function_call"), `raw function call leaked\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const posts = requests.filter((request) => request.method === "POST" && request.path === "/responses");
  assert(posts.length === 2, `expected two provider submits, got ${posts.length}: ${JSON.stringify(requests)}`);
  assert(posts[0].body.background === true && posts[0].body.service_tier === "flex", `first submit missing async tier: ${JSON.stringify(posts[0].body)}`);
  const readTool = Array.isArray(posts[0].body.tools) ? posts[0].body.tools.find((tool) => tool?.name === "read") : undefined;
  assert(readTool, `read tool was not sent: ${JSON.stringify(posts[0].body.tools)}`);
  assert(readTool.parameters !== undefined && readTool.parameters !== null, `read tool parameters missing: ${JSON.stringify(readTool)}`);
  assert(readTool.strict === false, `read tool strict must be false: ${JSON.stringify(readTool)}`);
  assert(Array.isArray(posts[0].body.input), `input should be structured array: ${JSON.stringify(posts[0].body.input)}`);
  const replay = JSON.stringify(posts[1].body.input);
  assert(replay.includes("function_call"), `second request missing assistant tool call replay: ${replay}`);
  assert(replay.includes("function_call_output"), `second request missing tool result replay: ${replay}`);
  assert(replay.includes("README"), `second request missing read output: ${replay}`);

  const events = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert(events.filter((event) => event.event === "provider_end" && event.provider === "doubleword").length >= 2, `missing provider_end events\n${readFileSync(logFile, "utf8")}`);

  console.log(`live async multi-turn mock passed (${requests.length} requests, ${events.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability log: ${logFile}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
