import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-live-realtime-mock-"));
const logFile = join(dir, "observability.jsonl");
const agentDir = join(dir, "agent");
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
const requests = [];
const modelId = "deepseek-ai/DeepSeek-V4-Flash-0731";
const finalText = "Doubleword live realtime mock response.";
const toolCallFinalText = "Doubleword live realtime mock tool call response.";
const toolCallPromptText = "Read README.md and then answer with one line.";
const reasoningText = "internal reasoning should not be printed";
const toolResponseId = "resp_realtime_mock_tool_1";
const toolReplayResponseId = "resp_realtime_mock_tool_2";
let toolCallRequestCount = 0;

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

function sendSse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [event, data] of events) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/models") {
      return sendJson(res, 200, { data: [{ id: modelId, name: "DeepSeek V4 Flash 0731", reasoning: true }] });
    }
    if (req.method === "POST" && url.pathname === "/responses") {
      const body = JSON.parse(await readBody(req));
      requests.push({ method: req.method, path: url.pathname, body });

      const inputText = JSON.stringify(body.input);
      if (inputText.includes("Return queued status")) {
        return sendSse(res, [["response.completed", { response: { id: "resp_realtime_mock_queued", status: "queued", service_tier: "priority" } }]]);
      }

      if (inputText.includes(toolCallPromptText)) {
        toolCallRequestCount++;
        if (toolCallRequestCount === 1) {
          return sendSse(res, [["response.completed", {
            response: {
              id: toolResponseId,
              status: "completed",
              service_tier: "priority",
              output: [
                { type: "function_call", id: "fc_read_1", call_id: "call_read_1", name: "read", arguments: JSON.stringify({ path: "README.md" }) },
              ],
              usage: { input_tokens: 2, output_tokens: 5, total_tokens: 7 },
            },
          }]]);
        }
        return sendSse(res, [
          ["response.created", { response: { id: toolReplayResponseId } }],
          ["response.output_text.delta", { delta: toolCallFinalText }],
          ["response.output_text.done", { text: toolCallFinalText }],
          ["response.completed", {
            response: {
              id: toolReplayResponseId,
              status: "completed",
              service_tier: "priority",
              output: [
                { type: "message", content: [{ type: "output_text", text: toolCallFinalText }] },
              ],
              usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
            },
          }],
        ]);
      }

      return sendSse(res, [
        ["response.created", { response: { id: "resp_realtime_mock_1" } }],
        ["response.output_text.delta", { delta: "Doubleword live " }],
        ["response.output_text.delta", { delta: "realtime mock response." }],
        ["response.output_text.done", { text: finalText }],
        ["response.completed", {
          response: {
            id: "resp_realtime_mock_1",
            status: "completed",
            service_tier: "priority",
            output: [
              { type: "reasoning", summary: [{ type: "summary_text", text: reasoningText }] },
              { type: "message", content: [{ type: "output_text", text: finalText }] },
            ],
            usage: { input_tokens: 2, output_tokens: 5, total_tokens: 7, input_tokens_details: { cached_tokens: 1 } },
          },
        }],
      ]);
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
    const child = spawn("pi", ["--no-extensions", "-e", process.env.DOUBLEWORD_TEST_EXTENSION ?? "./packages/doubleword-provider", "--model", `doubleword/${modelId}`, "-p", prompt], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOUBLEWORD_API_KEY: "mock-key",
        DOUBLEWORD_BASE_URL: baseUrl,
        DOUBLEWORD_MAX_OUTPUT_TOKENS: "16384",
        DOUBLEWORD_EXECUTION_MODE: "realtime",
        DOUBLEWORD_OBSERVABILITY_FILE: logFile,
        DOUBLEWORD_MODEL_CACHE_FILE: join(dir, "models.json"),
        DOUBLEWORD_RUN_ID: "smoke-live-realtime-mock",
        PI_CODING_AGENT_DIR: agentDir,
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

  const toolCallResult = await runPi(`http://127.0.0.1:${port}`, toolCallPromptText);
  assert(toolCallResult.status === 0, `tool-call realtime smoke failed\nstdout:\n${toolCallResult.stdout}\nstderr:\n${toolCallResult.stderr}`);
  assert(toolCallResult.stdout.includes(toolCallFinalText), `missing mock tool-call output\nstdout:\n${toolCallResult.stdout}\nstderr:\n${toolCallResult.stderr}`);
  assert(!toolCallResult.stdout.includes("function_call"), `raw function call leaked\nstdout:\n${toolCallResult.stdout}\nstderr:\n${toolCallResult.stderr}`);

  const toolSubmits = requests.filter((request) => request.method === "POST" && request.path === "/responses" && JSON.stringify(request.body.input).includes(toolCallPromptText));
  assert(toolSubmits.length === 2, `expected two tool-call submits, got ${toolSubmits.length}: ${JSON.stringify(requests)}`);
  const toolFirstSubmit = toolSubmits[0];
  assert(Array.isArray(toolFirstSubmit.body.tools), `tool call submit missing tools: ${JSON.stringify(toolFirstSubmit.body)}`);
  const toolReadSchema = toolFirstSubmit.body.tools.find((tool) => tool?.name === "read");
  assert(toolReadSchema, `read tool was not sent: ${JSON.stringify(toolFirstSubmit.body.tools)}`);
  assert(toolReadSchema.parameters !== undefined && toolReadSchema.parameters !== null, `read tool parameters missing: ${JSON.stringify(toolReadSchema)}`);
  assert(toolReadSchema.strict === false, `read tool strict must be false: ${JSON.stringify(toolReadSchema)}`);
  const replayInput = toolSubmits[1].body.input;
  assert(Array.isArray(replayInput), `tool-call replay input should be structured array: ${JSON.stringify(toolSubmits[1].body.input)}`);
  assert(replayInput.some((item) => item?.type === "function_call"), `second submit missing prior function_call: ${JSON.stringify(replayInput)}`);
  assert(replayInput.some((item) => item?.type === "function_call_output"), `second submit missing function_call_output: ${JSON.stringify(replayInput)}`);

  const queued = await runPi(`http://127.0.0.1:${port}`, "Return queued status");
  assert(queued.status !== 0, `queued realtime response unexpectedly passed\nstdout:\n${queued.stdout}\nstderr:\n${queued.stderr}`);
  assert(`${queued.stdout}\n${queued.stderr}`.includes("unsupported/incomplete status queued"), `queued realtime response did not report unsupported status\nstdout:\n${queued.stdout}\nstderr:\n${queued.stderr}`);

  const submit = requests.find((request) => request.method === "POST" && request.path === "/responses" && !JSON.stringify(request.body.input).includes("Return queued status"));
  assert(submit, `POST /responses was not called: ${JSON.stringify(requests)}`);
  assert(submit.body.service_tier === "priority", `POST /responses missing service_tier priority: ${JSON.stringify(submit.body)}`);
  assert(submit.body.stream === true, `POST /responses missing stream=true: ${JSON.stringify(submit.body)}`);
  assert(submit.body.max_output_tokens === 16384, `POST /responses wrong max_output_tokens: ${JSON.stringify(submit.body)}`);
  assert(submit.body.reasoning_effort === "medium", `POST /responses missing reasoning_effort medium: ${JSON.stringify(submit.body)}`);
  assert(submit.body.background === undefined, `POST /responses should be blocking realtime: ${JSON.stringify(submit.body)}`);

  const events = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const providerEnds = events.filter((event) => event.event === "provider_end" && event.provider === "doubleword" && event.model === modelId && event.tier === "realtime");
  assert(providerEnds.length >= 2, `missing realtime provider_end events\n${readFileSync(logFile, "utf8")}`);
  assert(providerEnds.every((event) => event.usageSource === "provider" && event.usageInputField === "input_tokens" && event.usageOutputField === "output_tokens" && event.pricingSource === "doubleword-model-metadata" && event.pricingSourceUrl === "https://docs.doubleword.ai/inference-api/models" && /^\d{4}-\d{2}-\d{2}$/.test(event.pricingRetrievedAt) && /^[a-f0-9]{64}$/.test(event.pricingSnapshotSha256)), `realtime provider_end missing native usage/pricing provenance\n${readFileSync(logFile, "utf8")}`);
  assert(providerEnds.every((event) => event.usage.cost.input === event.usage.input * 0.09 / 1_000_000 && event.usage.cost.cacheRead === event.usage.cacheRead * 0.02 / 1_000_000 && event.usage.cost.output === event.usage.output * 0.18 / 1_000_000), `realtime provider_end used wrong 0731 prices\n${readFileSync(logFile, "utf8")}`);
  assert(providerEnds.some((event) => event.usage.input === 1 && event.usage.cacheRead === 1 && event.usage.cost.input === 0.09 / 1_000_000 && event.usage.cost.cacheRead === 0.02 / 1_000_000), `realtime cached input was not normalized and priced separately\n${readFileSync(logFile, "utf8")}`);
  assert(providerEnds.some((event) => event.responseId === toolReplayResponseId), `missing tool-call final provider_end\n${readFileSync(logFile, "utf8")}`);

  console.log(`live realtime mock smoke passed (${requests.length} requests, ${events.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability log: ${logFile}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
