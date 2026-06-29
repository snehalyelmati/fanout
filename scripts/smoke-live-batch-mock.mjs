import { spawn } from "node:child_process";
import { createServer } from "node:http";

const requests = [];
const fileId = "file_batch_mock_1";
const batchId = "batch_mock_1";

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
    if (req.method === "POST" && url.pathname === "/files") {
      const body = await readBody(req);
      requests.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization, body });
      return sendJson(res, 200, { id: fileId, purpose: "batch" });
    }
    if (req.method === "POST" && url.pathname === "/batches") {
      const body = JSON.parse(await readBody(req));
      requests.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization, body });
      return sendJson(res, 200, { id: batchId, status: "validating", input_file_id: body.input_file_id });
    }
    if (req.method === "GET" && url.pathname === `/batches/${batchId}`) {
      requests.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization });
      return sendJson(res, 200, { id: batchId, status: "in_progress" });
    }
    if (req.method === "POST" && url.pathname === `/batches/${batchId}/cancel`) {
      requests.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization });
      return sendJson(res, 200, { id: batchId, status: "cancelling" });
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

function runScript(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn("node", ["scripts/smoke-live-batch.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOUBLEWORD_API_KEY: "mock-key",
        DOUBLEWORD_BASE_URL: baseUrl,
        DOUBLEWORD_LIVE_BATCH: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), Number(process.env.DOUBLEWORD_LIVE_BATCH_MOCK_TIMEOUT_MS ?? 60_000));
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
  const result = await runScript(`http://127.0.0.1:${port}`);
  assert(result.status === 0, `mock live batch smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert(result.stdout.includes(`file=${fileId} batch=${batchId}`), `missing mock batch output\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const upload = requests.find((request) => request.method === "POST" && request.path === "/files");
  assert(upload, `POST /files was not called: ${JSON.stringify(requests)}`);
  assert(upload.authorization === "Bearer mock-key", `POST /files missing auth: ${upload.authorization}`);
  assert(upload.body.includes('name="purpose"') && upload.body.includes("batch"), "POST /files missing purpose=batch");
  assert(upload.body.includes("deepseek-ai/DeepSeek-V4-Flash"), "batch input missing DeepSeek model");
  assert(upload.body.includes("Respond 'hello', do not say anything else."), "batch input missing smoke prompt");

  const create = requests.find((request) => request.method === "POST" && request.path === "/batches");
  assert(create, `POST /batches was not called: ${JSON.stringify(requests)}`);
  assert(create.authorization === "Bearer mock-key", `POST /batches missing auth: ${create.authorization}`);
  assert(create.body.input_file_id === fileId, `POST /batches wrong input_file_id: ${JSON.stringify(create.body)}`);
  assert(create.body.endpoint === "/v1/chat/completions", `POST /batches wrong endpoint: ${JSON.stringify(create.body)}`);
  assert(create.body.completion_window === "24h", `POST /batches wrong completion_window: ${JSON.stringify(create.body)}`);
  assert(requests.some((request) => request.method === "GET" && request.path === `/batches/${batchId}`), `GET /batches/${batchId} was not called: ${JSON.stringify(requests)}`);
  assert(requests.some((request) => request.method === "POST" && request.path === `/batches/${batchId}/cancel`), `POST /batches/${batchId}/cancel was not called: ${JSON.stringify(requests)}`);

  console.log(`live batch mock smoke passed (${requests.length} requests)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
