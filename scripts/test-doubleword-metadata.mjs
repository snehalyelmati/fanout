import { createHash } from "node:crypto";
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

// Official model-page prices reviewed on 2026-09-20; USD per 1M tokens,
// in input/cache-read/output order. Sources: docs/BENCHMARKS.md (2026-09-20 refresh).
const addedModelPrices = [
  { id: "deepseek-ai/DeepSeek-V4.1-Flash", realtime: [0.15, 0.01, 0.6], async: [0.12, 0.01, 0.48], batch: [0.08, 0.01, 0.3] },
  { id: "deepseek-ai/DeepSeek-V4-Pro-0813", realtime: [1.32, 0.13, 3.96], async: [0.99, 0.1, 2.97], batch: [0.66, 0.07, 1.98] },
  { id: "XiaomiMiMo/MiMo-V2.5-Pro", realtime: [0.44, 0.01, 0.87], async: [0.33, 0.01, 0.65], batch: [0.22, 0.01, 0.44] },
  { id: "zai-org/GLM-5.3", realtime: [1.4, 0.28, 4.4], async: [1.05, 0.21, 3.3], batch: [0.7, 0.14, 2.2] },
];

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/models") {
    return sendJson(res, 200, {
      data: [
        ...addedModelPrices.map(({ id }) => ({ id })),
        { id: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash 0731" },
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

  const { discoverLiveModels, REALTIME_STUB_MODELS, DOUBLEWORD_THINKING_LEVEL_MAP, tierPricingProvenance, tierPricingSource, withTierCost } = await import("../packages/doubleword-provider/src/models.ts");
  const { DOUBLEWORD_PRICING_PROVENANCE, DOUBLEWORD_TIER_PRICING } = await import("../packages/doubleword-provider/src/pricing.ts");
  const { responsesRequestBody } = await import("../packages/doubleword-provider/src/live.ts");
  const { responseUsageSource } = await import("../packages/doubleword-provider/src/messages.ts");
  const { modelPagePaths, parseModelPricing } = await import("./sync-doubleword-pricing.mjs");

  const models = await discoverLiveModels();
  const gen = models.find((model) => model.id === "deepseek-ai/DeepSeek-V4-Flash-0731");
  const capabilityReasoning = models.find((model) => model.id === "mock-provider/Capabilities-Reasoning");
  const capabilityPlain = models.find((model) => model.id === "mock-provider/Capabilities-Plain");
  const metadataModel = models.find((model) => model.id === "mock-provider/Metadata-Model");
  const ocr = models.find((model) => model.id === "doubleword/OCR-Pro");
  const embedding = models.find((model) => model.id === "doubleword/text-embedding");

  for (const expected of addedModelPrices) {
    const model = models.find((candidate) => candidate.id === expected.id);
    assert(model, `new model was not discovered: ${expected.id}`);
    for (const tier of ["realtime", "async", "batch"]) {
      const [input, cacheRead, output] = expected[tier];
      const prices = DOUBLEWORD_TIER_PRICING[expected.id]?.[tier];
      assert(prices?.input === input && prices.cacheRead === cacheRead && prices.output === output, `wrong ${expected.id} ${tier} snapshot prices: ${JSON.stringify(prices)}`);
      if (tier === "batch") continue;
      const { cost } = withTierCost(model, tier);
      assert(cost.input === input && cost.cacheRead === cacheRead && cost.output === output && cost.cacheWrite === 0, `wrong ${expected.id} ${tier} model cost: ${JSON.stringify(cost)}`);
      const evidence = tierPricingProvenance(model, tier);
      assert(evidence?.pricingSource === "doubleword-model-metadata" && evidence.pricingSourceUrl === DOUBLEWORD_PRICING_PROVENANCE.sourceUrl && evidence.pricingRetrievedAt === DOUBLEWORD_PRICING_PROVENANCE.retrievedAt && evidence.pricingSnapshotSha256 === DOUBLEWORD_PRICING_PROVENANCE.snapshotSha256, `missing ${expected.id} ${tier} provenance: ${JSON.stringify(evidence)}`);
    }
  }

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
  const glmStub = REALTIME_STUB_MODELS.find((model) => model.id === "glm-5-3-flash");
  assert(glmStub?.pricingId === "zai-org/GLM-5.3-Flash" && glmStub.cost.input === 0.15 && glmStub.cost.cacheRead === 0.03 && glmStub.cost.output === 0.5, `stub did not use exact GLM 5.3 Flash pricing: ${JSON.stringify(glmStub)}`);
  const asyncGlmStub = withTierCost(glmStub, "async");
  assert(asyncGlmStub.cost.input === 0.11 && asyncGlmStub.cost.cacheRead === 0.02 && asyncGlmStub.cost.output === 0.38, `stub lost exact GLM 5.3 Flash async pricing: ${JSON.stringify(asyncGlmStub.cost)}`);
  const deepseekStub = REALTIME_STUB_MODELS.find((model) => model.id === "deepseek-v4-flash");
  assert(deepseekStub?.cost.input === 0.09 && deepseekStub.cost.cacheRead === 0.02 && deepseekStub.cost.output === 0.18, `stub did not use exact 0731 pricing: ${JSON.stringify(deepseekStub?.cost)}`);
  const asyncDeepseekStub = withTierCost(deepseekStub, "async");
  assert(asyncDeepseekStub.cost.input === 0.07 && asyncDeepseekStub.cost.cacheRead === 0.01 && asyncDeepseekStub.cost.output === 0.14, `stub alias lost exact async pricing: ${JSON.stringify(asyncDeepseekStub.cost)}`);
  assert(tierPricingProvenance(asyncDeepseekStub, "async") === undefined, "synthetic stub usage received trusted pricing provenance");
  assert(tierPricingSource("deepseek-ai/DeepSeek-V4-Flash-0731", "async") === "doubleword-model-metadata", "exact 0731 pricing provenance is missing");
  assert(tierPricingSource("deepseek-ai/deepseek-v4-flash-0731", "async") === undefined, "non-exact model ID falsely joined trusted pricing");
  assert(tierPricingSource("mock-provider/Metadata-Model", "async") === undefined, "unknown model falsely claimed Doubleword pricing metadata");
  const priced = withTierCost(gen, "realtime");
  assert(priced.cost.input === 0.09 && priced.cost.cacheRead === 0.02 && priced.cost.output === 0.18 && priced.cost.cacheWrite === 0, `wrong 0731 realtime prices: ${JSON.stringify(priced.cost)}`);
  const provenance = tierPricingProvenance(gen, "realtime");
  assert(provenance?.pricingSourceUrl === "https://docs.doubleword.ai/inference-api/models" && provenance.pricingRetrievedAt === DOUBLEWORD_PRICING_PROVENANCE.retrievedAt && provenance.pricingSnapshotSha256 === DOUBLEWORD_PRICING_PROVENANCE.snapshotSha256, `wrong pricing provenance: ${JSON.stringify(provenance)}`);
  assert(tierPricingProvenance(gen, "realtime", 1) === undefined, "cache-write usage falsely received complete snapshot provenance");
  assert(createHash("sha256").update(JSON.stringify(DOUBLEWORD_TIER_PRICING)).digest("hex") === DOUBLEWORD_PRICING_PROVENANCE.snapshotSha256, "pricing snapshot identity does not match canonical rows");
  const parsed = parseModelPricing(`# Example\n\n## Pricing\n\n| Priority | Input Tokens (per 1M) | Cache Read Tokens (per 1M) | Output Tokens (per 1M) |\n|----------|------------------------|----------------------------|------------------------|\n| Realtime[^realtime-availability] | \\$0.09 | \\$0.02 | \\$0.18 |\n| Async | \\$0.07 | \\$0.01 | \\$0.14 |\n\n[^realtime-availability]: Realtime availability is limited.\n\n## Playground\n\nOpen in [Playground](https://app.doubleword.ai/playground?model=deepseek-ai%2FDeepSeek-V4-Flash-0731&from=%2Fmodels).`);
  assert(parsed.id === gen.id && parsed.tiers.async.cacheRead === 0.01, `pricing Markdown parser changed: ${JSON.stringify(parsed)}`);
  let malformedRejected = false;
  try { parseModelPricing("## Pricing\n\n| changed | format |\n"); } catch { malformedRejected = true; }
  assert(malformedRejected, "unexpected pricing documentation format was accepted");
  let malformedTierRejected = false;
  try { parseModelPricing(`# Example\n\n## Pricing\n\n| Priority | Input Tokens (per 1M) | Cache Read Tokens (per 1M) | Output Tokens (per 1M) |\n|----------|------------------------|----------------------------|------------------------|\n| Realtime | \\$0.09 | \\$0.02 | \\$0.18 |\nAsync malformed row\n| Batch | \\$0.05 | \\$0.01 | \\$0.09 |\n\n## Playground\n\n[Playground](https://app.doubleword.ai/playground?model=deepseek-ai%2FDeepSeek-V4-Flash-0731&from=%2Fmodels)`); } catch { malformedTierRejected = true; }
  assert(malformedTierRejected, "malformed pricing tier was silently omitted");
  assert(modelPagePaths("# Docs\n\n### Models\n\n- [A](/inference-api/models/a.md)\n- [B](/inference-api/models/b.md)\n").length === 2, "complete Models section was not parsed");
  let malformedIndexRejected = false;
  try { modelPagePaths("# Docs\n\n### Models\n\n- [A](/inference-api/models/a.md)\nmalformed model row\n"); } catch { malformedIndexRejected = true; }
  assert(malformedIndexRejected, "malformed model index row was silently skipped");
  assert(responseUsageSource({ usage: { input_tokens: 1, output_tokens: 2 } }) === "provider", "native Responses usage was not classified as provider usage");
  assert(responseUsageSource({ usage: { prompt_tokens: 1, completion_tokens: 2 } }) === "estimated", "compatibility usage aliases were falsely classified as native provider usage");

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
  rmSync(process.env.DOUBLEWORD_MODEL_CACHE_FILE, { force: true });
  const fallback = await discoverLiveModels();
  assert(fallback.length === 2 && fallback.every((model) => model.pricingEvidenceEligible === false), `hard-coded fallback models were not ordinary-only: ${JSON.stringify(fallback)}`);
  assert(fallback.every((model) => tierPricingProvenance(model, "realtime") === undefined), "hard-coded fallback received trusted pricing provenance");

  console.log("doubleword metadata test passed");
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`temp dir: ${dir}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
}
