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
        { id: "mock-provider/Capabilities-Reasoning", name: "Capabilities Reasoning", capabilities: ["reasoning"] },
        { id: "mock-provider/Capabilities-Plain", name: "Capabilities Plain", capabilities: ["text"] },
        {
          id: "mock-provider/Metadata-Model",
          name: "Metadata Model",
          reasoning: true,
          thinking_level_map: { off: null, high: "catalog-high" },
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

  const { discoverLiveModels, REALTIME_STUB_MODELS, DOUBLEWORD_THINKING_LEVEL_MAP, tierPricingSource } = await import("../packages/doubleword-provider/src/models.ts");
  const { responsesRequestBody } = await import("../packages/doubleword-provider/src/live.ts");

  const models = await discoverLiveModels();
  const gen = models.find((model) => model.id === "deepseek-ai/DeepSeek-V4-Flash");
  const capabilityReasoning = models.find((model) => model.id === "mock-provider/Capabilities-Reasoning");
  const capabilityPlain = models.find((model) => model.id === "mock-provider/Capabilities-Plain");
  const metadataModel = models.find((model) => model.id === "mock-provider/Metadata-Model");
  const ocr = models.find((model) => model.id === "doubleword/OCR-Pro");
  const embedding = models.find((model) => model.id === "doubleword/text-embedding");

  assert(gen?.reasoning === true, `generation model not reasoning-capable: ${JSON.stringify(gen)}`);
  assert(gen.thinkingLevelMap?.off === "none" && gen.thinkingLevelMap?.xhigh === "xhigh", `bad thinking map: ${JSON.stringify(gen.thinkingLevelMap)}`);
  assert(!("fanout" in gen), `standalone provider leaked Fanout metadata: ${JSON.stringify(gen.fanout)}`);
  assert(capabilityReasoning?.reasoning === true, `reasoning capability was not honored: ${JSON.stringify(capabilityReasoning)}`);
  assert(capabilityPlain?.reasoning === false, `capabilities without reasoning should not fall back to name heuristic: ${JSON.stringify(capabilityPlain)}`);
  assert(metadataModel?.thinkingLevelMap?.off === null, `explicit null thinking level was not preserved: ${JSON.stringify(metadataModel?.thinkingLevelMap)}`);
  assert(metadataModel?.thinkingLevelMap?.high === "catalog-high" && metadataModel?.thinkingLevelMap?.low === "low", `catalog/default thinking map merge failed: ${JSON.stringify(metadataModel?.thinkingLevelMap)}`);
  assert(!("fanout" in metadataModel), `catalog Fanout metadata crossed the standalone provider boundary: ${JSON.stringify(metadataModel?.fanout)}`);
  assert(ocr?.reasoning === false, `OCR should not be reasoning-capable: ${JSON.stringify(ocr)}`);
  assert(embedding?.reasoning === false, `embedding should not be reasoning-capable: ${JSON.stringify(embedding)}`);
  assert(REALTIME_STUB_MODELS.every((model) => !("fanout" in model)), `stub models leaked Fanout metadata: ${JSON.stringify(REALTIME_STUB_MODELS)}`);
  assert(tierPricingSource("deepseek-ai/DeepSeek-V4-Flash", "async") === "doubleword-model-metadata", "known tier pricing provenance is missing");
  assert(tierPricingSource("mock-provider/Metadata-Model", "async") === undefined, "unknown model falsely claimed Doubleword pricing metadata");

  const piModel = { ...gen, api: "doubleword-api", provider: "doubleword", baseUrl: process.env.DOUBLEWORD_BASE_URL };
  const context = { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] };
  assert(responsesRequestBody(piModel, context, { reasoning: "high" }, {}).reasoning_effort === "high", "reasoning_effort high was not sent");
  assert(responsesRequestBody(piModel, context, undefined, {}).reasoning_effort === DOUBLEWORD_THINKING_LEVEL_MAP.medium, "default should map to medium");
  assert(responsesRequestBody(piModel, context, { reasoning: "off" }, {}).reasoning_effort === DOUBLEWORD_THINKING_LEVEL_MAP.off, "off should map to none");
  assert(!("reasoning_effort" in responsesRequestBody({ ...piModel, reasoning: false }, context, { reasoning: "high" }, {})), "non-reasoning model should omit reasoning_effort");
  const metadataPiModel = { ...metadataModel, api: "doubleword-api", provider: "doubleword", baseUrl: process.env.DOUBLEWORD_BASE_URL };
  assert(!("reasoning_effort" in responsesRequestBody(metadataPiModel, context, { reasoning: "off" }, {})), "explicit off:null should omit reasoning_effort");
  assert(responsesRequestBody(metadataPiModel, context, { reasoning: "high" }, {}).reasoning_effort === "catalog-high", "catalog thinking override was not used");

  delete process.env.DOUBLEWORD_API_KEY;
  const cached = await discoverLiveModels();
  const cachedGen = cached.find((model) => model.id === gen.id);
  assert(!("fanout" in cachedGen), `cached provider model leaked Fanout metadata: ${JSON.stringify(cachedGen?.fanout)}`);

  console.log("doubleword metadata test passed");
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`temp dir: ${dir}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
