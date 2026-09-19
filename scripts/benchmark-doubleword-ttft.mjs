import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  let workloadName;
  let requestFile;
  const models = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--workload") {
      workloadName = args[++index];
      if (!workloadName) throw new Error("--workload requires a value");
    } else if (args[index] === "--request-file") {
      requestFile = args[++index];
      if (!requestFile) throw new Error("--request-file requires a value");
    } else if (args[index].startsWith("--")) throw new Error(`unknown option ${args[index]}`);
    else models.push(args[index]);
  }
  if (requestFile) {
    if (models.length || workloadName) throw new Error("--request-file cannot be combined with models or --workload");
    const source = readFileSync(requestFile, "utf8");
    const body = JSON.parse(source);
    if (!body || typeof body.model !== "string" || !body.model || body.input === undefined || body.stream !== true) throw new Error("request file requires model, input, and stream: true");
    if (!Number.isSafeInteger(body.max_output_tokens) || body.max_output_tokens <= 0) throw new Error("request file requires a positive max_output_tokens limit");
    if (body.service_tier != null && body.service_tier !== SERVICE_TIER) throw new Error("this realtime probe only supports priority service");
    return { models: [body.model], requestBody: { ...body, service_tier: body.service_tier ?? SERVICE_TIER }, workload: { id: "request-file", sourcePath: requestFile, sourceSha256: createHash("sha256").update(source).digest("hex"), expectedOutput: null } };
  }
  workloadName ??= "short-ok";
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
    count: values.length,
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
    reasoning: Number.isFinite(raw.output_tokens_details?.reasoning_tokens) ? raw.output_tokens_details.reasoning_tokens : null,
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
  const reasoned = used.filter((record) => Number.isFinite(record.usage.reasoning));
  const metrics = (items) => Object.fromEntries(
    ["headersMs", "firstBodyBytesMs", "firstEventMs", "firstReasoningMs", "lastReasoningMs", "firstTextDeltaMs", "lastTextDeltaMs", "firstEventToTextMs", "firstReasoningToTextMs", "reasoningDeliverySpanMs", "ttftMs", "completedMs", "streamClosedMs", "totalMs"].map((field) => [field, roundStatistics(statistics(items.map((item) => item[field]).filter(Number.isFinite)))]),
  );
  const observedCostUsd = costed.reduce((sum, record) => sum + record.cost.total, 0);
  return {
    calls: records.length,
    successes: successful.length,
    failures: records.length - successful.length,
    outputCheckCoverage: `${successful.filter((record) => typeof record.outputCorrect === "boolean").length}/${successful.length}`,
    outputMismatches: successful.filter((record) => record.outputCorrect === false).length,
    streamedServiceTierMismatches: successful.filter((record) => record.serviceTierActual !== SERVICE_TIER).length,
    usageCoverage: `${used.length}/${successful.length}`,
    reasoningTokenCoverage: `${reasoned.length}/${successful.length}`,
    tokens: {
      ...Object.fromEntries(["input", "cacheRead", "cacheWrite", "output", "total"].map((field) => [field, used.reduce((sum, record) => sum + record.usage[field], 0)])),
      reasoning: reasoned.length > 0 && reasoned.length === successful.length ? reasoned.reduce((sum, record) => sum + record.usage.reasoning, 0) : null,
    },
    costCoverage: `${costed.length}/${successful.length}`,
    observedCostUsd,
    totalCostUsd: costed.length === successful.length ? observedCostUsd : null,
    all: metrics(successful),
    excludingFirstCall: metrics(successful.filter((record) => record.call > 1)),
  };
}

async function benchmarkCall({ baseUrl, apiKey, model, call, timeoutMs, workload, requestBody, fetchImpl = fetch, now = () => performance.now(), onObservation = () => {} }) {
  const startedAt = new Date().toISOString();
  const started = now();
  const timing = { headersMs: null, firstBodyBytesMs: null, firstEventMs: null, firstReasoningMs: null, lastReasoningMs: null, firstTextDeltaMs: null, lastTextDeltaMs: null, ttftMs: null, completedMs: null, streamClosedMs: null };
  const observe = (observation) => onObservation({ model, call, ...observation });
  let ttftSource = null;
  let responseId;
  let status;
  let serviceTierActual;
  let rawUsage = null;
  let outputText = "";
  let sawTextDelta = false;
  let failure;
  let reader;
  observe({ kind: "request_start", startedAt, receivedMs: 0 });
  try {
    const response = await fetchImpl(`${baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      body: JSON.stringify(requestBody ?? {
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: workload.prompt }] }],
        service_tier: SERVICE_TIER,
        stream: true,
        reasoning_effort: REASONING_EFFORT,
        max_output_tokens: MAX_OUTPUT_TOKENS,
      }),
    });
    timing.headersMs = now() - started;
    observe({ kind: "headers", receivedMs: timing.headersMs, httpStatus: response.status });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 1_000)}`);
    if (!response.body) throw new Error("response had no body");

    const decoder = new TextDecoder();
    reader = response.body.getReader();
    const buffer = { text: "" };
    let completed = false;
    let chunkIndex = 0;
    for (;;) {
      const { done, value } = await reader.read();
      // Stamp once, before decoding, parsing, or writing evidence. Coalesced events
      // share this timestamp; split events use the read that completes the frame.
      const receivedMs = now() - started;
      if (done) timing.streamClosedMs = receivedMs;
      else if (value.byteLength > 0) timing.firstBodyBytesMs ??= receivedMs;
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      observe({ kind: done ? "stream_closed" : "stream_chunk", chunkIndex, receivedMs, bytes: value?.byteLength ?? 0, text: chunk });
      for (const event of sseEvents(chunk, buffer)) {
        observe({ kind: "sse", chunkIndex, receivedMs, event: event.event ?? null, data: event.data });
        if (event.data === "[DONE]") continue;
        timing.firstEventMs ??= receivedMs;
        const data = JSON.parse(event.data);
        const type = event.event ?? data.type;
        const responseData = data.response ?? data;
        responseId = responseData.id ?? responseId;
        status = responseData.status ?? status;
        serviceTierActual = responseData.service_tier ?? serviceTierActual;
        if (["response.reasoning_summary_text.delta", "response.reasoning_text.delta"].includes(type) && typeof data.delta === "string" && data.delta.length > 0) {
          timing.firstReasoningMs ??= receivedMs;
          timing.lastReasoningMs = receivedMs;
        }
        if (type === "response.output_text.delta" && data.delta) {
          sawTextDelta = true;
          outputText += String(data.delta);
          timing.firstTextDeltaMs ??= receivedMs;
          timing.lastTextDeltaMs = receivedMs;
          if (timing.ttftMs === null) { timing.ttftMs = receivedMs; ttftSource = "text-delta"; }
        } else if (type === "response.output_text.done" && data.text) {
          if (!sawTextDelta) outputText = String(data.text);
          if (timing.ttftMs === null) { timing.ttftMs = receivedMs; ttftSource = "text-done"; }
        }
        if (["response.completed", "response.failed", "response.incomplete"].includes(type)) rawUsage = responseData.usage ?? null;
        if (type === "response.completed") {
          completed = true;
          timing.completedMs = receivedMs;
          if (!outputText) outputText = responseOutputText(responseData);
          if (timing.ttftMs === null && outputText) { timing.ttftMs = receivedMs; ttftSource = "completed-output"; }
        }
        if (["response.failed", "response.incomplete", "error"].includes(type)) throw new Error(JSON.stringify(data.error ?? data));
      }
      if (done) break;
      chunkIndex++;
    }
    if (!completed) throw new Error("stream ended without response.completed");
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    // Stop reading failed/incomplete streams rather than leaving the connection open.
    await reader?.cancel?.().catch(() => {});
  }
  const interval = (from, to) => from !== null && to !== null && to >= from ? to - from : null;
  const usage = nativeUsage(rawUsage);
  const record = {
    model, call, startedAt, ok: failure === undefined, responseId, status, serviceTierActual,
    outputText, outputCorrect: workload.expectedOutput === null ? null : outputText.trim() === workload.expectedOutput, rawUsage, usage, cost: usageCost(model, usage),
    ...Object.fromEntries(Object.entries(timing).map(([key, value]) => [key, rounded(value)])), ttftSource,
    firstEventToTextMs: rounded(interval(timing.firstEventMs, timing.ttftMs)),
    firstReasoningToTextMs: rounded(interval(timing.firstReasoningMs, timing.firstTextDeltaMs)),
    reasoningDeliverySpanMs: rounded(interval(timing.firstReasoningMs, timing.lastReasoningMs)),
    totalMs: rounded(now() - started), ...(failure === undefined ? {} : { error: failure }),
  };
  observe({ kind: "request_end", receivedMs: record.totalMs, record });
  return record;
}

async function selfTest() {
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
  assert.equal(nativeUsage({ input_tokens: 10, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 } }).reasoning, 0);
  if (responseOutputText({ output: [{ content: [{ type: "output_text", text: "OK" }] }] }) !== "OK") throw new Error("output self-test failed");
  const longContext = longContextQaWorkload();
  if (longContext.recordCount !== 12_000 || !longContext.prompt.includes("Record 06000 says access code COBALT.") || !longContext.prompt.endsWith("Answer with only the uppercase access code.")) throw new Error("long-context workload self-test failed");

  const frame = (type, data = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const terminal = { id: "response-test", status: "completed", usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, output_tokens_details: { reasoning_tokens: 5 } } };
  const mockCall = async (reads, requestBody) => {
    let clock = 0;
    let index = 0;
    const observations = [];
    const record = await benchmarkCall({
      baseUrl: "invalid:", apiKey: "test-only-secret", model: "Qwen/Qwen3.8-27B-FP8", call: 1, timeoutMs: 1_000,
      workload: { prompt: "Reply OK", expectedOutput: requestBody ? null : "OK" }, requestBody,
      now: () => clock++,
      onObservation: (observation) => observations.push(observation),
      fetchImpl: async (_url, options) => {
        if (requestBody) assert.deepEqual(JSON.parse(options.body), requestBody);
        clock = 10;
        return { ok: true, status: 200, body: { getReader: () => ({ read: async () => {
          const [at, text] = reads[index++];
          clock = at;
          return text === null ? { done: true } : { done: false, value: new TextEncoder().encode(text) };
        } }) } };
      },
    });
    return { record, observations };
  };
  const { record, observations } = await mockCall([
    [20, frame("response.created", { response: { id: "response-test" } }) + 'event: response.reasoning_summary_text.delta\ndata: {"delta":"par'],
    [50, 'tial"}\n\n' + frame("response.reasoning_summary_text.delta", { delta: " second" })],
    [180, frame("response.reasoning_summary_text.delta", { delta: " last" })],
    [230, frame("response.output_text.delta", { delta: "O" }) + frame("response.output_text.delta", { delta: "K" })],
    [300, frame("response.completed", { response: terminal })],
    [500, null],
  ]);
  assert.equal(record.ok, true);
  for (const [key, expected] of Object.entries({ headersMs: 10, firstBodyBytesMs: 20, firstEventMs: 20, firstReasoningMs: 50, lastReasoningMs: 180, firstTextDeltaMs: 230, lastTextDeltaMs: 230, ttftMs: 230, completedMs: 300, streamClosedMs: 500, firstEventToTextMs: 210, firstReasoningToTextMs: 180, reasoningDeliverySpanMs: 130 })) assert.equal(record[key], expected, key);
  assert.equal(record.ttftSource, "text-delta");
  assert.equal(record.outputText, "OK");
  assert.deepEqual(record.rawUsage, terminal.usage);
  assert.equal(record.usage.reasoning, 5);
  const reasonEvents = observations.filter((event) => event.kind === "sse" && event.event === "response.reasoning_summary_text.delta");
  assert.deepEqual(reasonEvents.map(({ receivedMs, chunkIndex }) => [receivedMs, chunkIndex]), [[50, 1], [50, 1], [180, 2]]);
  assert.equal(JSON.parse(reasonEvents[0].data).delta, "partial");
  assert.equal(JSON.stringify(observations).includes("test-only-secret"), false);

  const completedOnly = await mockCall([[80, frame("response.completed", { response: { id: "completed-only", output: [{ content: [{ type: "output_text", text: "OK" }] }], usage: { input_tokens: 11, output_tokens: 2 } } })], [90, null]]);
  assert.equal(completedOnly.record.ttftMs, 80);
  assert.equal(completedOnly.record.ttftSource, "completed-output");
  assert.equal(completedOnly.record.firstTextDeltaMs, null);
  assert.equal(completedOnly.record.firstReasoningMs, null);
  assert.equal(completedOnly.record.usage.reasoning, null);
  const empty = await mockCall([[80, frame("response.completed", { response: { id: "empty", output: [] } })], [90, null]]);
  assert.equal(empty.record.ttftMs, null);
  assert.equal(empty.record.ttftSource, null);
  assert.equal(empty.record.firstEventToTextMs, null);
  assert.equal(empty.record.outputCorrect, false);
  const failed = await mockCall([[20, frame("response.reasoning_text.delta", { delta: "partial reasoning" })], [80, frame("response.failed", { response: { id: "failed", status: "failed", usage: { input_tokens: 11, output_tokens: 1 } } })]]);
  assert.equal(failed.record.ok, false);
  assert.equal(failed.record.firstReasoningMs, 20);
  assert.equal(failed.record.completedMs, null);
  assert.equal(failed.record.streamClosedMs, null);
  assert.equal(failed.record.rawUsage.output_tokens, 1);
  assert.equal(failed.observations.at(-1).kind, "request_end");
  assert.equal(failed.observations.some(({ event }) => event === "response.failed"), true);
  const truncated = await mockCall([[20, frame("response.reasoning_text.delta", { delta: "partial reasoning" })], [80, null]]);
  assert.equal(truncated.record.ok, false);
  assert.equal(truncated.record.firstReasoningMs, 20);
  assert.equal(truncated.record.streamClosedMs, 80);
  assert.equal(truncated.record.completedMs, null);
  assert.equal(truncated.record.ttftMs, null);
  assert.equal(truncated.record.error, "stream ended without response.completed");
  const summary = summarize([record, completedOnly.record]);
  assert.equal(summary.tokens.reasoning, null);
  assert.equal(summary.reasoningTokenCoverage, "1/2");
  assert.equal(summary.all.firstReasoningMs.count, 1);
  const replay = await mockCall([[80, frame("response.completed", { response: terminal })], [90, null]], { model: "test-replay", input: [{ role: "user", content: "Keep this input" }], tools: [{ type: "function", name: "test_tool" }], reasoning_effort: "high", max_output_tokens: 65_536, stream: true });
  assert.equal(replay.record.ok, true);
  assert.equal(replay.record.outputCorrect, null);
  assert.equal(summarize([replay.record]).outputMismatches, 0);
  assert.equal(summarize([replay.record]).outputCheckCoverage, "0/1");
  console.log("Doubleword TTFT benchmark self-test passed");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const apiKey = process.env.DOUBLEWORD_API_KEY;
  if (!apiKey) throw new Error("DOUBLEWORD_API_KEY is required");
  const { models, workload, requestBody } = selectedRun();
  const baseUrl = (process.env.DOUBLEWORD_BASE_URL ?? "https://api.doubleword.ai/v1").replace(/\/$/, "");
  const callsPerModel = positiveInteger("DOUBLEWORD_TTFT_CALLS", DEFAULT_CALLS_PER_MODEL);
  const timeoutMs = positiveInteger("DOUBLEWORD_TTFT_CALL_TIMEOUT_MS", 300_000);
  const createdAt = new Date().toISOString();
  const outputDir = join(process.cwd(), "runs", "doubleword-ttft");
  mkdirSync(outputDir, { recursive: true });
  const fileStem = createdAt.replaceAll(":", "-");
  const observationsFile = `${fileStem}.events.jsonl`;
  const observationsPath = join(outputDir, observationsFile);
  writeFileSync(observationsPath, "", { mode: 0o600, flag: "wx" });
  const requestBodyFile = requestBody ? `${fileStem}.request.json` : null;
  if (requestBodyFile) writeFileSync(join(outputDir, requestBodyFile), `${JSON.stringify(requestBody, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Saving client stream observations to ${observationsPath}`);
  const records = [];

  for (let round = 1; round <= callsPerModel; round++) {
    const order = round % 2 === 1 ? models : [...models].reverse();
    for (const model of order) {
      const record = await benchmarkCall({ baseUrl, apiKey, model, call: round, timeoutMs, workload, requestBody, onObservation: (observation) => appendFileSync(observationsPath, `${JSON.stringify(observation)}\n`) });
      records.push(record);
      console.log(`${model} #${round}: ${record.ok ? `first reasoning ${record.firstReasoningMs ?? "unobserved"} ms, first text ${record.ttftMs ?? "unobserved"} ms, complete ${record.completedMs} ms, total ${record.totalMs} ms, tier ${record.serviceTierActual ?? "missing"}, output ${record.outputCorrect === null ? "NOT CHECKED" : record.outputCorrect ? "OK" : "MISMATCH"}, reasoning tokens ${record.usage?.reasoning ?? "unknown"}, cost ${record.cost ? `$${record.cost.total.toFixed(8)}` : "unavailable"}` : `FAILED after ${record.totalMs} ms: ${record.error}`}`);
    }
  }

  const summary = Object.fromEntries(models.map((model) => [model, summarize(records.filter((record) => record.model === model))]));
  const result = {
    benchmark: "doubleword-realtime-ttft",
    createdAt,
    observationsFile,
    timingSource: "client-monotonic-clock; SSE events timestamped at the body read completing their frame, not model token generation",
    request: { models, callsPerModel, scheduling: "sequential-alternating", requestBodyFile, workload: { id: workload.id, expectedOutput: workload.expectedOutput, inputCharacters: workload.prompt?.length, recordCount: workload.recordCount, targetRecord: workload.targetRecord, sourcePath: workload.sourcePath, sourceSha256: workload.sourceSha256 }, serviceTier: SERVICE_TIER, reasoningEffort: requestBody ? requestBody.reasoning_effort ?? null : REASONING_EFFORT, maxOutputTokens: requestBody?.max_output_tokens ?? MAX_OUTPUT_TOKENS, timeoutMs },
    pricing: { tier: "realtime", ...DOUBLEWORD_PRICING_PROVENANCE },
    records,
    summary,
  };
  const outputPath = join(outputDir, `${fileStem}.json`);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(`\n${JSON.stringify(summary, null, 2)}\n\nSaved ${outputPath}`);
  if (records.some((record) => !record.ok || record.outputCorrect === false)) process.exitCode = 1;
}
