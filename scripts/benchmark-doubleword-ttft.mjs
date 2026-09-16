import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { DOUBLEWORD_PRICING_PROVENANCE, DOUBLEWORD_TIER_PRICING } from "../packages/doubleword-provider/src/pricing.ts";

const DEFAULT_CALLS_PER_MODEL = 50;
const SERVICE_TIER = "priority";
const REASONING_EFFORT = "medium";
const MAX_OUTPUT_TOKENS = 16_384;

function longContextQaWorkload() {
  const records = Array.from({ length: 12_000 }, (_, index) => `Record ${String(index + 1).padStart(5, "0")} says ${index === 5_999 ? "access code COBALT" : "status normal"}.`);
  const prompt = `Context:\n${records.join("\n")}\n\nQuestion: What is the access code in record 06000? Answer with only the uppercase access code.`;
  return { id: "long-context-qa", prompt, expectedOutput: "COBALT", recordCount: records.length, targetRecord: "06000" };
}

function selectedRun() {
  const args = process.argv.slice(2);
  let workloadName = "short-ok";
  const models = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--workload") {
      workloadName = args[++index];
      if (!workloadName) throw new Error("--workload requires a value");
    } else if (args[index].startsWith("--")) throw new Error(`unknown option ${args[index]}`);
    else models.push(args[index]);
  }
  if (!models.length) throw new Error("provide at least one Doubleword model ID");
  if (new Set(models).size !== models.length) throw new Error("Doubleword model IDs must be unique");
  for (const model of models) if (!DOUBLEWORD_TIER_PRICING[model]?.realtime) throw new Error(`missing committed realtime pricing for ${model}`);
  const workload = workloadName === "short-ok" ? { id: "short-ok", prompt: 'Reply with exactly "OK" and nothing else.', expectedOutput: "OK" } : workloadName === "long-context-qa" ? longContextQaWorkload() : undefined;
  if (!workload) throw new Error(`unknown workload ${workloadName}`);
  return { models, workload };
}

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function sseEvents(chunk, buffer) {
  buffer.text += chunk;
  const events = [];
  for (;;) {
    const splitAt = buffer.text.search(/\r?\n\r?\n/);
    if (splitAt < 0) return events;
    const raw = buffer.text.slice(0, splitAt);
    buffer.text = buffer.text.slice(splitAt + (buffer.text[splitAt] === "\r" ? 4 : 2));
    let event;
    const data = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ event, data: data.join("\n") });
  }
}

function percentile(sorted, percent) {
  return sorted[Math.max(0, Math.ceil(sorted.length * percent / 100) - 1)];
}

function statistics(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: percentile(sorted, 50),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    max: sorted.at(-1),
  };
}

function rounded(value) {
  return typeof value === "number" ? Math.round(value * 100) / 100 : value;
}

function responseOutputText(response) {
  if (!Array.isArray(response?.output)) return "";
  return response.output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).filter((item) => item?.type === "output_text").map((item) => String(item.text ?? "")).join("");
}

function nativeUsage(raw) {
  if (!raw || !Number.isFinite(raw.input_tokens) || !Number.isFinite(raw.output_tokens)) return null;
  const cacheRead = Number.isFinite(raw.input_tokens_details?.cached_tokens) ? raw.input_tokens_details.cached_tokens : 0;
  const cacheWrite = Number.isFinite(raw.input_tokens_details?.cache_write_tokens) ? raw.input_tokens_details.cache_write_tokens : 0;
  return {
    input: Math.max(0, raw.input_tokens - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: raw.output_tokens,
    reasoning: Number.isFinite(raw.output_tokens_details?.reasoning_tokens) ? raw.output_tokens_details.reasoning_tokens : 0,
    total: Number.isFinite(raw.total_tokens) ? raw.total_tokens : raw.input_tokens + raw.output_tokens,
  };
}

function usageCost(model, usage) {
  const prices = DOUBLEWORD_TIER_PRICING[model]?.realtime;
  if (!usage || !prices || usage.cacheWrite) return null;
  const cost = {
    input: usage.input * prices.input / 1_000_000,
    cacheRead: usage.cacheRead * prices.cacheRead / 1_000_000,
    output: usage.output * prices.output / 1_000_000,
  };
  return { ...cost, total: cost.input + cost.cacheRead + cost.output };
}

function roundStatistics(value) {
  return value && Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)]));
}

function summarize(records) {
  const successful = records.filter((record) => record.ok);
  const costed = successful.filter((record) => record.cost);
  const used = successful.filter((record) => record.usage);
  const metrics = (items) => Object.fromEntries(
    ["headersMs", "firstEventMs", "firstEventToTextMs", "ttftMs", "totalMs"].map((field) => [field, roundStatistics(statistics(items.map((item) => item[field]).filter(Number.isFinite)))]),
  );
  const observedCostUsd = costed.reduce((sum, record) => sum + record.cost.total, 0);
  return {
    calls: records.length,
    successes: successful.length,
    failures: records.length - successful.length,
    outputMismatches: successful.filter((record) => !record.outputCorrect).length,
    streamedServiceTierMismatches: successful.filter((record) => record.serviceTierActual !== SERVICE_TIER).length,
    usageCoverage: `${used.length}/${successful.length}`,
    tokens: Object.fromEntries(["input", "cacheRead", "cacheWrite", "output", "reasoning", "total"].map((field) => [field, used.reduce((sum, record) => sum + record.usage[field], 0)])),
    costCoverage: `${costed.length}/${successful.length}`,
    observedCostUsd,
    totalCostUsd: costed.length === successful.length ? observedCostUsd : null,
    all: metrics(successful),
    excludingFirstCall: metrics(successful.filter((record) => record.call > 1)),
  };
}

async function benchmarkCall({ baseUrl, apiKey, model, call, timeoutMs, workload }) {
  const started = performance.now();
  let headersMs;
  let firstEventMs;
  let ttftMs;
  let responseId;
  let status;
  let serviceTierActual;
  let rawUsage;
  let outputText = "";
  let sawTextDelta = false;
  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: workload.prompt }] }],
        service_tier: SERVICE_TIER,
        stream: true,
        reasoning_effort: REASONING_EFFORT,
        max_output_tokens: MAX_OUTPUT_TOKENS,
      }),
    });
    headersMs = performance.now() - started;
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 1_000)}`);
    if (!response.body) throw new Error("response had no body");

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const buffer = { text: "" };
    let completed = false;
    for (;;) {
      const { done, value } = await reader.read();
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (const event of sseEvents(chunk, buffer)) {
        if (event.data === "[DONE]") continue;
        if (firstEventMs === undefined) firstEventMs = performance.now() - started;
        const data = JSON.parse(event.data);
        const type = event.event ?? data.type;
        const responseData = data.response ?? data;
        responseId = responseData.id ?? responseId;
        status = responseData.status ?? status;
        serviceTierActual = responseData.service_tier ?? serviceTierActual;
        if (type === "response.output_text.delta" && data.delta) {
          sawTextDelta = true;
          outputText += String(data.delta);
          if (ttftMs === undefined) ttftMs = performance.now() - started;
        } else if (type === "response.output_text.done" && data.text) {
          if (!sawTextDelta) outputText = String(data.text);
          if (ttftMs === undefined) ttftMs = performance.now() - started;
        }
        if (type === "response.completed") {
          completed = true;
          rawUsage = responseData.usage;
          if (!outputText) outputText = responseOutputText(responseData);
          if (ttftMs === undefined) ttftMs = performance.now() - started;
        }
        if (["response.failed", "response.incomplete", "error"].includes(type)) throw new Error(JSON.stringify(data.error ?? data));
      }
      if (done) break;
    }
    if (!completed) throw new Error("stream ended without response.completed");
    const usage = nativeUsage(rawUsage);
    const cost = usageCost(model, usage);
    return { model, call, ok: true, responseId, status, serviceTierActual, outputText, outputCorrect: outputText.trim() === workload.expectedOutput, usage, cost, headersMs: rounded(headersMs), firstEventMs: rounded(firstEventMs), firstEventToTextMs: rounded(ttftMs - firstEventMs), ttftMs: rounded(ttftMs), totalMs: rounded(performance.now() - started) };
  } catch (error) {
    return { model, call, ok: false, responseId, status, serviceTierActual, headersMs: rounded(headersMs), firstEventMs: rounded(firstEventMs), ttftMs: rounded(ttftMs), totalMs: rounded(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
  }
}

function selfTest() {
  const buffer = { text: "" };
  const chunks = [
    "event: response.created\ndata: {\"type\":\"response.created\"}",
    "\n\nevent: response.output_text.delta\r\ndata: {\"delta\":\"OK\"}\r",
    "\n\r\ndata: [DONE]\n\n",
  ];
  const events = chunks.flatMap((chunk) => sseEvents(chunk, buffer));
  if (events.length !== 3 || events[1].event !== "response.output_text.delta" || JSON.parse(events[1].data).delta !== "OK" || events[2].data !== "[DONE]") throw new Error("SSE parser self-test failed");
  const stats = statistics([1, 2, 3, 4, 100]);
  if (stats.median !== 3 || stats.p90 !== 100 || stats.mean !== 22) throw new Error("statistics self-test failed");
  const usage = nativeUsage({ input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 1 } });
  const cost = usageCost("Qwen/Qwen3.8-27B-FP8", usage);
  if (usage.input !== 8 || usage.cacheRead !== 2 || usage.reasoning !== 1 || Math.abs(cost.total - 0.00001268) > 1e-12 || nativeUsage({}) !== null || usageCost("deepseek-ai/DeepSeek-V4-Flash-0731", null) !== null) throw new Error("usage/cost self-test failed");
  if (responseOutputText({ output: [{ content: [{ type: "output_text", text: "OK" }] }] }) !== "OK") throw new Error("output self-test failed");
  const longContext = longContextQaWorkload();
  if (longContext.recordCount !== 12_000 || !longContext.prompt.includes("Record 06000 says access code COBALT.") || !longContext.prompt.endsWith("Answer with only the uppercase access code.")) throw new Error("long-context workload self-test failed");
  console.log("Doubleword TTFT benchmark self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const apiKey = process.env.DOUBLEWORD_API_KEY;
  if (!apiKey) throw new Error("DOUBLEWORD_API_KEY is required");
  const { models, workload } = selectedRun();
  const baseUrl = (process.env.DOUBLEWORD_BASE_URL ?? "https://api.doubleword.ai/v1").replace(/\/$/, "");
  const callsPerModel = positiveInteger("DOUBLEWORD_TTFT_CALLS", DEFAULT_CALLS_PER_MODEL);
  const timeoutMs = positiveInteger("DOUBLEWORD_TTFT_CALL_TIMEOUT_MS", 300_000);
  const records = [];

  for (let round = 1; round <= callsPerModel; round++) {
    const order = round % 2 === 1 ? models : [...models].reverse();
    for (const model of order) {
      const record = await benchmarkCall({ baseUrl, apiKey, model, call: round, timeoutMs, workload });
      records.push(record);
      console.log(`${model} #${round}: ${record.ok ? `TTFT ${record.ttftMs} ms, total ${record.totalMs} ms, tier ${record.serviceTierActual ?? "missing"}, output ${record.outputCorrect ? "OK" : "MISMATCH"}, cost ${record.cost ? `$${record.cost.total.toFixed(8)}` : "unavailable"}` : `FAILED after ${record.totalMs} ms: ${record.error}`}`);
    }
  }

  const summary = Object.fromEntries(models.map((model) => [model, summarize(records.filter((record) => record.model === model))]));
  const result = {
    benchmark: "doubleword-realtime-ttft",
    createdAt: new Date().toISOString(),
    request: { models, callsPerModel, scheduling: "sequential-alternating", workload: { id: workload.id, expectedOutput: workload.expectedOutput, inputCharacters: workload.prompt.length, recordCount: workload.recordCount, targetRecord: workload.targetRecord }, serviceTier: SERVICE_TIER, reasoningEffort: REASONING_EFFORT, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs },
    pricing: { tier: "realtime", ...DOUBLEWORD_PRICING_PROVENANCE },
    records,
    summary,
  };
  const outputDir = join(process.cwd(), "runs", "doubleword-ttft");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${result.createdAt.replaceAll(":", "-")}.json`);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\n${JSON.stringify(summary, null, 2)}\n\nSaved ${outputPath}`);
  if (records.some((record) => !record.ok || !record.outputCorrect)) process.exitCode = 1;
}
