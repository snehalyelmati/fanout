import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-live-realtime-mock-"));
const logFile = join(dir, "observability.jsonl");
const requests = [];
const finalText = "Doubleword live realtime mock response.";
const reasoningText = "internal reasoning should not be printed";

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
      if (String(body.input).includes("Return queued status")) {
        return sendJson(res, 200, { id: "resp_realtime_mock_queued", status: "queued", service_tier: "priority" });
      }
      return sendJson(res, 200, {
        id: "resp_realtime_mock_1",
        status: "completed",
        service_tier: "priority",
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: reasoningText }] },
          { type: "message", content: [{ type: "output_text", text: finalText }] },
        ],
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

function runPi(baseUrl, prompt = "Respond 'hello', do not say anything else.") {
  return new Promise((resolve) => {
    const child = spawn("pi", ["-e", ".", "--model", "doubleword-realtime/deepseek-ai/DeepSeek-V4-Flash", "-p", prompt], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOUBLEWORD_API_KEY: "mock-key",
        DOUBLEWORD_BASE_URL: baseUrl,
        DOUBLEWORD_OBSERVABILITY_FILE: logFile,
        DOUBLEWORD_RUN_ID: "smoke-live-realtime-mock",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), Number(process.env.DOUBLEWORD_LIVE_REALTIME_MOCK_TIMEOUT_MS ?? 60_000));
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
  assert(result.status === 0, `mock live realtime smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert(result.stdout.includes(finalText), `missing mock output\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert(!result.stdout.includes(reasoningText), `reasoning leaked to stdout\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const queued = await runPi(`http://127.0.0.1:${port}`, "Return queued status");
  assert(queued.status !== 0, `queued realtime response unexpectedly passed\nstdout:\n${queued.stdout}\nstderr:\n${queued.stderr}`);
  assert(`${queued.stdout}\n${queued.stderr}`.includes("unsupported/incomplete status queued"), `queued realtime response did not report unsupported status\nstdout:\n${queued.stdout}\nstderr:\n${queued.stderr}`);

  const submit = requests.find((request) => request.method === "POST" && request.path === "/responses" && !String(request.body.input).includes("Return queued status"));
  assert(submit, `POST /responses was not called: ${JSON.stringify(requests)}`);
  assert(submit.body.service_tier === "priority", `POST /responses missing service_tier priority: ${JSON.stringify(submit.body)}`);
  assert(submit.body.background === undefined, `POST /responses should be blocking realtime: ${JSON.stringify(submit.body)}`);

  const events = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert(events.some((event) => event.event === "provider_end" && event.provider === "doubleword-realtime" && event.model === "deepseek-ai/DeepSeek-V4-Flash"), `missing provider_end\n${readFileSync(logFile, "utf8")}`);

  console.log(`live realtime mock smoke passed (${requests.length} requests, ${events.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability log: ${logFile}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
