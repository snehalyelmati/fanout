import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-model-cache-test-"));
const agentDir = join(dir, "agent");
const cacheFile = join(dir, "models.json");
const logFile = join(dir, "observability.jsonl");
const discoveredModelId = "mock-provider/Mock-Model-1";
let modelRequests = 0;

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/models") {
    modelRequests++;
    return sendJson(res, 200, {
      data: [
        {
          id: discoveredModelId,
          name: "Mock Model 1",
          context_window: 64000,
          max_output_tokens: 12000,
        },
      ],
    });
  }
  sendJson(res, 404, { error: "not found" });
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function listModels(envPatch) {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
  return new Promise((resolve, reject) => {
    const child = spawn("pi", ["-e", ".", "--list-models"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        DOUBLEWORD_MODEL_CACHE_FILE: cacheFile,
        DOUBLEWORD_OBSERVABILITY_FILE: logFile,
        DOUBLEWORD_RUN_ID: "test-doubleword-model-cache",
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
        ...envPatch,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) reject(new Error(`pi --list-models failed\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      else resolve(stdout);
    });
  });
}

function hasPair(output, provider, model) {
  return output
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .some(([rowProvider, rowModel]) => rowProvider === provider && rowModel === model);
}

try {
  const port = await listen();
  const baseUrl = `http://127.0.0.1:${port}`;

  const discovered = await listModels({ DOUBLEWORD_API_KEY: "mock-key", DOUBLEWORD_BASE_URL: baseUrl });
  assert(modelRequests === 1, `expected one /models request, got ${modelRequests}`);
  assert(hasPair(discovered, "doubleword", discoveredModelId), `missing discovered unified model\n${discovered}`);
  assert(existsSync(cacheFile), "model cache was not written");
  const cache = JSON.parse(readFileSync(cacheFile, "utf8"));
  assert(cache.models?.some((model) => model.id === discoveredModelId), `cache missing discovered model\n${readFileSync(cacheFile, "utf8")}`);

  const cached = await listModels({ DOUBLEWORD_API_KEY: "", DOUBLEWORD_BASE_URL: baseUrl });
  assert(modelRequests === 1, `cache-only run should not request /models, got ${modelRequests}`);
  assert(hasPair(cached, "doubleword", discoveredModelId), `missing cached unified model\n${cached}`);

  console.log("doubleword model cache test passed");
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`temp dir: ${dir}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
