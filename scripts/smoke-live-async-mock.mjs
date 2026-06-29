import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-live-async-mock-"));
const successLogFile = join(dir, "success-observability.jsonl");
const timeoutLogFile = join(dir, "timeout-observability.jsonl");
const agentDir = join(dir, "agent");
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
const successResponseId = "resp_mock_1";
const timeoutResponseId = "resp_timeout_1";
const requests = [];
let submitCount = 0;
let successRetrieveCount = 0;
let timeoutRetrieveCount = 0;

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
      const responseId = submitCount === 1 ? successResponseId : timeoutResponseId;
      requests.push({ method: req.method, path: url.pathname, body, responseId });
      return sendJson(res, 200, { id: responseId, status: "queued", service_tier: "flex" });
    }
    if (req.method === "GET" && url.pathname === `/responses/${successResponseId}`) {
      successRetrieveCount++;
      requests.push({ method: req.method, path: url.pathname, retrieveCount: successRetrieveCount });
      if (successRetrieveCount === 1) return sendJson(res, 503, { error: "temporary" });
      return sendJson(res, 200, {
        id: successResponseId,
        status: "completed",
        service_tier: "flex",
        output_text: "Doubleword live async mock response.",
        usage: { input_tokens: 2, output_tokens: 5, total_tokens: 7 },
      });
    }
    if (req.method === "GET" && url.pathname === `/responses/${timeoutResponseId}`) {
      timeoutRetrieveCount++;
      requests.push({ method: req.method, path: url.pathname, retrieveCount: timeoutRetrieveCount });
      return sendJson(res, 200, { id: timeoutResponseId, status: "queued", service_tier: "flex" });
    }
    if (req.method === "POST" && url.pathname === `/responses/${timeoutResponseId}/cancel`) {
      await readBody(req);
      requests.push({ method: req.method, path: url.pathname });
      return sendJson(res, 200, { id: timeoutResponseId, status: "cancelled" });
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

function runPi(baseUrl, { logFile, runId, pollMs = "0", asyncTimeoutMs = "30000", processTimeoutMs } = {}) {
  const timeout = Number(processTimeoutMs ?? process.env.DOUBLEWORD_LIVE_ASYNC_MOCK_TIMEOUT_MS ?? 60_000);
  return new Promise((resolve) => {
    const child = spawn("pi", ["-e", ".", "--model", "doubleword-async/deepseek-ai/DeepSeek-V4-Flash", "-p", "Respond 'hello', do not say anything else."], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOUBLEWORD_API_KEY: "mock-key",
        DOUBLEWORD_BASE_URL: baseUrl,
        DOUBLEWORD_OBSERVABILITY_FILE: logFile,
        DOUBLEWORD_RUN_ID: runId,
        DOUBLEWORD_LIVE_ASYNC_POLL_MS: pollMs,
        DOUBLEWORD_LIVE_ASYNC_TIMEOUT_MS: asyncTimeoutMs,
        DOUBLEWORD_CANCEL_TIMEOUT_MS: "1000",
        PI_CODING_AGENT_DIR: agentDir,
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
      resolve({ ...result, logFile });
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

function readEvents(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

try {
  const port = await listen();
  const baseUrl = `http://127.0.0.1:${port}`;
  const result = await runPi(baseUrl, { logFile: successLogFile, runId: "smoke-live-async-mock" });
  assert(result.status === 0, `mock live async smoke failed${result.timedOut ? " (timeout)" : ""}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert(result.stdout.includes("Doubleword live async mock response."), `missing mock output\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const submit = requests.find((request) => request.method === "POST" && request.path === "/responses" && request.responseId === successResponseId);
  assert(submit, `POST /responses was not called: ${JSON.stringify(requests)}`);
  assert(submit.body.service_tier === "flex", `POST /responses missing service_tier flex: ${JSON.stringify(submit.body)}`);
  assert(submit.body.background === true, `POST /responses missing background true: ${JSON.stringify(submit.body)}`);
  assert(submit.body.max_output_tokens === 16384, `POST /responses wrong max_output_tokens: ${JSON.stringify(submit.body)}`);
  assert(requests.filter((request) => request.method === "GET" && request.path === `/responses/${successResponseId}`).length === 2, `GET /responses/${successResponseId} retry did not happen: ${JSON.stringify(requests)}`);

  const events = readEvents(successLogFile);
  const has = (name, predicate = () => true) => events.some((event) => event.event === name && predicate(event));
  const liveEvent = (event) => event.provider === "doubleword-async" && event.turnIndex === 0 && event.serviceTierRequested === "flex";
  assert(has("async_submit", liveEvent), `missing live async_submit event\n${readFileSync(successLogFile, "utf8")}`);
  assert(has("async_poll_retry", liveEvent), `missing live async_poll_retry event\n${readFileSync(successLogFile, "utf8")}`);
  assert(has("async_poll", liveEvent), `missing live async_poll event\n${readFileSync(successLogFile, "utf8")}`);
  assert(has("provider_end", (event) => event.provider === "doubleword-async" && event.model === "deepseek-ai/DeepSeek-V4-Flash"), `missing provider_end for doubleword-async/deepseek-ai/DeepSeek-V4-Flash\n${readFileSync(successLogFile, "utf8")}`);

  const timeoutResult = await runPi(baseUrl, {
    logFile: timeoutLogFile,
    runId: "smoke-live-async-mock-timeout",
    pollMs: "1000",
    asyncTimeoutMs: "250",
    processTimeoutMs: 10_000,
  });
  assert(!timeoutResult.timedOut, `timeout scenario hit harness timeout\nstdout:\n${timeoutResult.stdout}\nstderr:\n${timeoutResult.stderr}`);
  assert(timeoutResult.status !== 0, `timeout scenario unexpectedly succeeded\nstdout:\n${timeoutResult.stdout}\nstderr:\n${timeoutResult.stderr}`);

  const timeoutPostIndex = requests.findIndex((request) => request.method === "POST" && request.path === "/responses" && request.responseId === timeoutResponseId);
  const timeoutGetIndex = requests.findIndex((request) => request.method === "GET" && request.path === `/responses/${timeoutResponseId}`);
  const timeoutCancelIndex = requests.findIndex((request) => request.method === "POST" && request.path === `/responses/${timeoutResponseId}/cancel`);
  assert(timeoutPostIndex >= 0, `timeout POST /responses was not called: ${JSON.stringify(requests)}`);
  assert(timeoutGetIndex > timeoutPostIndex, `timeout final GET did not happen after submit: ${JSON.stringify(requests)}`);
  assert(timeoutCancelIndex > timeoutGetIndex, `timeout cancel did not happen after final GET: ${JSON.stringify(requests)}`);
  assert(requests.filter((request) => request.method === "GET" && request.path === `/responses/${timeoutResponseId}`).length === 1, `timeout scenario should only use the final GET: ${JSON.stringify(requests)}`);

  const timeoutEvents = readEvents(timeoutLogFile);
  const timeoutHas = (name, predicate = () => true) => timeoutEvents.some((event) => event.event === name && predicate(event));
  const timeoutEvent = (event) => event.provider === "doubleword-async" && event.model === "deepseek-ai/DeepSeek-V4-Flash" && event.responseId === timeoutResponseId;
  assert(timeoutHas("provider_timeout", timeoutEvent), `missing provider_timeout event\n${readFileSync(timeoutLogFile, "utf8")}`);
  assert(timeoutHas("provider_cancel_requested", (event) => timeoutEvent(event) && event.reason === "timeout"), `missing provider_cancel_requested event\n${readFileSync(timeoutLogFile, "utf8")}`);
  assert(
    timeoutHas("provider_cancel_end", (event) => timeoutEvent(event) && event.status === "cancelled"),
    `missing successful provider_cancel_end event\n${readFileSync(timeoutLogFile, "utf8")}`,
  );

  console.log(`live async mock smoke passed (${requests.length} requests, ${events.length + timeoutEvents.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability logs: ${successLogFile}, ${timeoutLogFile}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
