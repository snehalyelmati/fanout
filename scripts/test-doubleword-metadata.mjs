import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-metadata-test-"));
process.env.DOUBLEWORD_API_KEY = "mock-key";
process.env.DOUBLEWORD_MODEL_CACHE_FILE = join(dir, "models.json");

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
    return sendJson(res, 200, {
      data: [
        { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
        {
          id: "mock-provider/Metadata-Model",
          name: "Metadata Model",
          reasoning: true,
          thinkingLevelMap: { off: null, high: "catalog-high" },
          fanout: { tiers: ["async"], async: false, authReady: false },
        },
        { id: "doubleword/OCR-Pro", name: "OCR Pro" },
        { id: "doubleword/text-embedding", name: "Text Embedding" },
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

try {
  const port = await listen();
  process.env.DOUBLEWORD_BASE_URL = `http://127.0.0.1:${port}`;

  const { discoverLiveModels, REALTIME_STUB_MODELS, DOUBLEWORD_THINKING_LEVEL_MAP } = await import("../packages/doubleword-provider/src/models.ts");
  const { responsesRequestBody } = await import("../packages/doubleword-provider/src/live.ts");

  const models = await discoverLiveModels();
  const gen = models.find((model) => model.id === "deepseek-ai/DeepSeek-V4-Flash");
  const metadataModel = models.find((model) => model.id === "mock-provider/Metadata-Model");
  const ocr = models.find((model) => model.id === "doubleword/OCR-Pro");
  const embedding = models.find((model) => model.id === "doubleword/text-embedding");

  assert(gen?.reasoning === true, `generation model not reasoning-capable: ${JSON.stringify(gen)}`);
  assert(gen.thinkingLevelMap?.off === "none" && gen.thinkingLevelMap?.xhigh === "xhigh", `bad thinking map: ${JSON.stringify(gen.thinkingLevelMap)}`);
  assert(gen.fanout?.tiers?.join(",") === "realtime,async,batch" && gen.fanout?.authReady === true, `bad fanout metadata: ${JSON.stringify(gen.fanout)}`);
  assert(metadataModel?.thinkingLevelMap?.off === null, `explicit null thinking level was not preserved: ${JSON.stringify(metadataModel?.thinkingLevelMap)}`);
  assert(metadataModel?.thinkingLevelMap?.high === "catalog-high" && metadataModel?.thinkingLevelMap?.low === "low", `catalog/default thinking map merge failed: ${JSON.stringify(metadataModel?.thinkingLevelMap)}`);
  assert(metadataModel?.fanout?.tiers?.join(",") === "async" && metadataModel?.fanout?.async === false, `catalog fanout fields were not preserved: ${JSON.stringify(metadataModel?.fanout)}`);
  assert(metadataModel?.fanout?.background === true && metadataModel?.fanout?.batch === true && metadataModel?.fanout?.authReady === true, `fanout defaults/authReady failed: ${JSON.stringify(metadataModel?.fanout)}`);
  assert(ocr?.reasoning === false, `OCR should not be reasoning-capable: ${JSON.stringify(ocr)}`);
  assert(embedding?.reasoning === false, `embedding should not be reasoning-capable: ${JSON.stringify(embedding)}`);
  assert(REALTIME_STUB_MODELS.every((model) => model.fanout?.authReady === true), `stub authReady should be true: ${JSON.stringify(REALTIME_STUB_MODELS)}`);

  const piModel = { ...gen, api: "doubleword-api", provider: "doubleword", baseUrl: process.env.DOUBLEWORD_BASE_URL };
  const context = { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] };
  assert(responsesRequestBody(piModel, context, { reasoning: "high" }, {}).reasoning_effort === "high", "reasoning_effort high was not sent");
  assert(responsesRequestBody(piModel, context, undefined, {}).reasoning_effort === DOUBLEWORD_THINKING_LEVEL_MAP.off, "off should map to none");
  assert(!("reasoning_effort" in responsesRequestBody({ ...piModel, reasoning: false }, context, { reasoning: "high" }, {})), "non-reasoning model should omit reasoning_effort");
  const metadataPiModel = { ...metadataModel, api: "doubleword-api", provider: "doubleword", baseUrl: process.env.DOUBLEWORD_BASE_URL };
  assert(!("reasoning_effort" in responsesRequestBody(metadataPiModel, context, undefined, {})), "explicit off:null should omit reasoning_effort");
  assert(responsesRequestBody(metadataPiModel, context, { reasoning: "high" }, {}).reasoning_effort === "catalog-high", "catalog thinking override was not used");

  delete process.env.DOUBLEWORD_API_KEY;
  const cached = await discoverLiveModels();
  const cachedGen = cached.find((model) => model.id === gen.id);
  assert(cachedGen?.fanout?.authReady === false, `cached live authReady should follow env: ${JSON.stringify(cachedGen?.fanout)}`);

  console.log("doubleword metadata test passed");
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`temp dir: ${dir}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
