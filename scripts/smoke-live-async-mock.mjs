import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-live-async-mock-"));
const logFile = join(dir, "observability.jsonl");
const responseId = "resp_mock_1";
const requests = [];

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
      requests.push({ method: req.method, path: url.pathname, body });
      return sendJson(res, 200, { id: responseId, status: "queued", service_tier: "flex" });
    }
    if (req.method === "GET" && url.pathname === `/responses/${responseId}`) {
      requests.push({ method: req.method, path: url.pathname });
      return sendJson(res, 200, {
        id: responseId,
        status: "completed",
        service_tier: "flex",
        output_text: "Doubleword live async mock response.",
        usage: { input_tokens: 2, output_tokens: 5, total_tokens: 7 },
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
  const timeout = Number(process.env.DOUBLEWORD_LIVE_ASYNC_MOCK_TIMEOUT_MS ?? 60_000);
  return new Promise((resolve) => {
    const child = spawn("pi", ["-e", ".", "--model", "doubleword-async/deepseek-v4-flash", "-p", "Say hello in one short sentence."], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOUBLEWORD_API_KEY: "mock-key",
        DOUBLEWORD_BASE_URL: baseUrl,
        DOUBLEWORD_OBSERVABILITY_FILE: logFile,
        DOUBLEWORD_RUN_ID: "smoke-live-async-mock",
        DOUBLEWORD_LIVE_ASYNC_POLL_MS: "0",
        DOUBLEWORD_LIVE_ASYNC_MAX_POLLS: "3",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ status: 1, stdout, stderr: `${stderr}${error.message}`, timedOut }));
    child.on("close", (status, signal) => finish({ status, signal, stdout, stderr, timedOut }));
  });
}

try {
  const port = await listen();
  const result = await runPi(`http://127.0.0.1:${port}`);
  assert(result.status === 0, `mock live async smoke failed${result.timedOut ? " (timeout)" : ""}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert(result.stdout.includes("Doubleword live async mock response."), `missing mock output\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const submit = requests.find((request) => request.method === "POST" && request.path === "/responses");
  assert(submit, `POST /responses was not called: ${JSON.stringify(requests)}`);
  assert(submit.body.service_tier === "flex", `POST /responses missing service_tier flex: ${JSON.stringify(submit.body)}`);
  assert(submit.body.background === true, `POST /responses missing background true: ${JSON.stringify(submit.body)}`);
  assert(requests.some((request) => request.method === "GET" && request.path === `/responses/${responseId}`), `GET /responses/${responseId} was not called: ${JSON.stringify(requests)}`);

  const events = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const has = (name, predicate = () => true) => events.some((event) => event.event === name && predicate(event));
  const liveEvent = (event) => event.provider === "doubleword-async" && event.turnIndex === 0 && event.serviceTierRequested === "flex";
  assert(has("async_submit", liveEvent), `missing live async_submit event\n${readFileSync(logFile, "utf8")}`);
  assert(has("async_poll", liveEvent), `missing live async_poll event\n${readFileSync(logFile, "utf8")}`);
  assert(has("provider_end", (event) => event.provider === "doubleword-async" && event.model === "deepseek-v4-flash"), `missing provider_end for doubleword-async/deepseek-v4-flash\n${readFileSync(logFile, "utf8")}`);

  console.log(`live async mock smoke passed (${requests.length} requests, ${events.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability log: ${logFile}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
