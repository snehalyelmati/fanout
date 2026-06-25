#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const DEFAULT_OUT = join("runs", "phase6");
const DEFAULT_MODEL = "glm-5-2";
const DEFAULT_TIER2_MIN_MS = 5 * 60 * 1000;
const DEFAULT_TIER2_MAX_MS = 10 * 60 * 1000;
const MODEL_COSTS = {
  "glm-5-2": {
    realtime: { input: 1.4, output: 4.4 },
    tier1: { input: 1.4, output: 4.4 },
    tier2: { input: 1.05, output: 3.3 },
  },
  "deepseek-v4-flash": {
    realtime: { input: 0.14, output: 0.28 },
    tier1: { input: 0.14, output: 0.28 },
    tier2: { input: 0.1, output: 0.2 },
  },
};

function parseArgs(argv) {
  const paths = [];
  let out = DEFAULT_OUT;
  let model = DEFAULT_MODEL;
  let tier2MinMs = DEFAULT_TIER2_MIN_MS;
  let tier2MaxMs = DEFAULT_TIER2_MAX_MS;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--out") {
      out = argv[++index];
      if (!out) throw new Error("--out requires a directory");
    } else if (arg === "--model") {
      model = argv[++index];
      if (!model) throw new Error("--model requires a model id");
    } else if (arg === "--tier2-min-ms") {
      tier2MinMs = Number(argv[++index]);
    } else if (arg === "--tier2-max-ms") {
      tier2MaxMs = Number(argv[++index]);
    } else {
      paths.push(arg);
    }
  }

  if (!MODEL_COSTS[model]) throw new Error(`unsupported model for comparison: ${model}`);
  if (!Number.isFinite(tier2MinMs) || !Number.isFinite(tier2MaxMs) || tier2MinMs < 0 || tier2MaxMs < tier2MinMs) {
    throw new Error("tier2 SLA must satisfy 0 <= --tier2-min-ms <= --tier2-max-ms");
  }

  return { paths: paths.length ? paths : ["runs"], explicitPaths: paths.length > 0, out, model, tier2MinMs, tier2MaxMs };
}

function collectJsonl(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return path.endsWith(".jsonl") ? [path] : [];
  if (!stat.isDirectory()) return [];

  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => collectJsonl(join(path, entry.name)))
    .sort();
}

function readRows(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        return [{ ...JSON.parse(line), sourceFile: file, sourceLine: index + 1 }];
      } catch (error) {
        throw new Error(`${file}:${index + 1}: invalid JSONL: ${error instanceof Error ? error.message : error}`);
      }
    });
}

function number(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values, digits = 3) {
  return round(values.reduce((total, value) => total + value, 0), digits);
}

function stat(values) {
  const clean = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!clean.length) return { count: 0, total: 0, avg: 0, min: 0, max: 0 };
  const total = sum(clean);
  return { count: clean.length, total, avg: round(total / clean.length), min: Math.min(...clean), max: Math.max(...clean) };
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function addUsage(totals, raw = {}) {
  const input = number(raw.input ?? raw.input_tokens ?? raw.prompt_tokens, 0);
  const output = number(raw.output ?? raw.output_tokens ?? raw.completion_tokens, 0);
  const cacheRead = number(raw.cacheRead ?? raw.input_tokens_details?.cached_tokens ?? raw.prompt_tokens_details?.cached_tokens, 0);
  const cacheWrite = number(raw.cacheWrite ?? raw.input_tokens_details?.cache_write_tokens ?? raw.prompt_tokens_details?.cache_write_tokens, 0);
  totals.input += input;
  totals.output += output;
  totals.cacheRead += cacheRead;
  totals.cacheWrite += cacheWrite;
  totals.totalTokens += number(raw.totalTokens ?? raw.total_tokens, input + output + cacheRead + cacheWrite);
  totals.cost.input += number(raw.cost?.input, 0);
  totals.cost.output += number(raw.cost?.output, 0);
  totals.cost.cacheRead += number(raw.cost?.cacheRead, 0);
  totals.cost.cacheWrite += number(raw.cost?.cacheWrite, 0);
  totals.cost.total += number(raw.cost?.total, 0);
}

function finalizeUsage(totals) {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) totals[key] = round(totals[key]);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) totals.cost[key] = round(totals.cost[key], 12);
  return totals;
}

function usageTotals(events) {
  const totals = emptyUsage();
  for (const event of events.filter((item) => item.event === "provider_end")) addUsage(totals, event.usage ?? {});
  return finalizeUsage(totals);
}

function tierOf(event) {
  if (typeof event.tier === "string" && event.tier) return event.tier;
  if (typeof event.provider === "string" && event.provider.includes("async")) return "async";
  if (typeof event.provider === "string" && event.provider.includes("realtime")) return "realtime";
  return "unknown";
}

function providerSummary(events) {
  const ends = events.filter((event) => event.event === "provider_end");
  const ttft = events.filter((event) => event.event === "provider_ttft").map((event) => number(event.ttftMs)).filter((value) => value !== undefined);
  const duration = ends.map((event) => number(event.durationMs)).filter((value) => value !== undefined);
  const byTier = {};

  for (const event of ends) {
    const tier = tierOf(event);
    byTier[tier] ??= { calls: 0, durationMs: 0, cost: 0 };
    byTier[tier].calls++;
    byTier[tier].durationMs = round(byTier[tier].durationMs + (number(event.durationMs, 0)));
    byTier[tier].cost = round(byTier[tier].cost + number(event.usage?.cost?.total, 0), 12);
  }

  for (const tier of Object.keys(byTier)) byTier[tier].avgDurationMs = byTier[tier].calls ? round(byTier[tier].durationMs / byTier[tier].calls) : 0;

  return {
    calls: events.filter((event) => event.event === "provider_start").length,
    completed: ends.length,
    errors: events.filter((event) => event.event === "provider_error").length,
    ttftMs: stat(ttft),
    durationMs: stat(duration),
    byTier,
  };
}

function asyncSummary(events) {
  const polls = events.filter((event) => event.event === "async_poll");
  const statuses = {};
  for (const event of polls) statuses[event.status ?? "unknown"] = (statuses[event.status ?? "unknown"] ?? 0) + 1;

  return {
    submits: events.filter((event) => event.event === "async_submit").length,
    pollCount: polls.length,
    pollDurationMs: stat(polls.map((event) => number(event.durationMs)).filter((value) => value !== undefined)),
    statuses,
  };
}

function summarizeObservability(traceId, events, source) {
  const agentEnds = events.filter((event) => event.event === "agent_end");
  const turnEnds = events.filter((event) => event.event === "turn_end");
  const agentTurnCounts = agentEnds.map((event) => number(event.turnCount)).filter((value) => value !== undefined);
  const agentToolCounts = agentEnds.map((event) => number(event.toolCallCount)).filter((value) => value !== undefined);
  const turnToolCounts = turnEnds.map((event) => number(event.toolCallCount)).filter((value) => value !== undefined);
  const turnCount = Math.max(sum(agentTurnCounts), turnEnds.length);
  const toolCallCount = Math.max(sum(agentToolCounts), sum(turnToolCounts));

  return {
    format: "observability",
    traceId,
    source,
    events: events.length,
    agents: agentEnds.length,
    turnCount,
    toolCallCount,
    avgToolCallsPerTurn: turnCount ? round(toolCallCount / turnCount) : 0,
    turnToolCallCount: stat(turnToolCounts),
    provider: providerSummary(events),
    async: asyncSummary(events),
    usage: usageTotals(events),
  };
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function contentParts(message) {
  return Array.isArray(message?.content) ? message.content : [];
}

function summarizePiSession(rows, source) {
  const session = rows.find((row) => row.type === "session");
  const messages = rows.filter((row) => row.type === "message");
  const usage = emptyUsage();
  const turnToolCounts = [];
  const durations = [];
  const models = {};
  let previousMessageMs;

  for (const row of messages) {
    const message = row.message ?? {};
    const currentMs = timestampMs(row.timestamp) ?? timestampMs(message.timestamp);
    const role = message.role;

    if (role === "assistant") {
      const toolCalls = contentParts(message).filter((part) => part?.type === "toolCall").length;
      turnToolCounts.push(toolCalls);
      addUsage(usage, message.usage ?? {});
      if (typeof message.model === "string") models[message.model] = (models[message.model] ?? 0) + 1;
      if (previousMessageMs !== undefined && currentMs !== undefined) durations.push(Math.max(0, currentMs - previousMessageMs));
    }

    if (currentMs !== undefined) previousMessageMs = currentMs;
  }

  finalizeUsage(usage);
  const turnCount = turnToolCounts.length;
  const toolCallCount = sum(turnToolCounts);
  const durationStats = stat(durations);
  const traceId = session?.id ?? basename(source).replace(/\.jsonl$/, "");

  return {
    format: "pi-session",
    traceId,
    source,
    events: rows.length,
    agents: session ? 1 : 0,
    turnCount,
    toolCallCount,
    avgToolCallsPerTurn: turnCount ? round(toolCallCount / turnCount) : 0,
    turnToolCallCount: stat(turnToolCounts),
    provider: {
      calls: turnCount,
      completed: turnCount,
      errors: 0,
      ttftMs: durationStats,
      durationMs: durationStats,
      byTier: {
        realtime: { calls: turnCount, durationMs: durationStats.total, cost: usage.cost.total, avgDurationMs: turnCount ? round(durationStats.total / turnCount) : 0 },
      },
    },
    async: { submits: 0, pollCount: 0, pollDurationMs: stat([]), statuses: {} },
    usage,
    models,
  };
}

function combineStats(stats) {
  const clean = stats.filter((item) => item.count > 0);
  if (!clean.length) return { count: 0, total: 0, avg: 0, min: 0, max: 0 };
  const count = sum(clean.map((item) => item.count));
  const total = sum(clean.map((item) => item.total));
  return { count, total, avg: count ? round(total / count) : 0, min: Math.min(...clean.map((item) => item.min)), max: Math.max(...clean.map((item) => item.max)) };
}

function combineUsage(summaries) {
  const totals = emptyUsage();
  for (const summary of summaries) addUsage(totals, summary.usage);
  return finalizeUsage(totals);
}

function combineSummaries(traceId, summaries, source) {
  const turnCount = sum(summaries.map((summary) => summary.turnCount));
  const toolCallCount = sum(summaries.map((summary) => summary.toolCallCount));
  const byTier = {};
  const statuses = {};
  const formats = [...new Set(summaries.map((summary) => summary.format))];

  for (const summary of summaries) {
    for (const [tier, tierSummary] of Object.entries(summary.provider.byTier)) {
      byTier[tier] ??= { calls: 0, durationMs: 0, cost: 0 };
      byTier[tier].calls += tierSummary.calls;
      byTier[tier].durationMs = round(byTier[tier].durationMs + tierSummary.durationMs);
      byTier[tier].cost = round(byTier[tier].cost + tierSummary.cost, 12);
    }
    for (const [status, count] of Object.entries(summary.async.statuses)) statuses[status] = (statuses[status] ?? 0) + count;
  }

  for (const tierSummary of Object.values(byTier)) tierSummary.avgDurationMs = tierSummary.calls ? round(tierSummary.durationMs / tierSummary.calls) : 0;

  return {
    format: formats.length === 1 ? formats[0] : "mixed",
    traceId,
    source,
    events: sum(summaries.map((summary) => summary.events)),
    agents: sum(summaries.map((summary) => summary.agents)),
    turnCount,
    toolCallCount,
    avgToolCallsPerTurn: turnCount ? round(toolCallCount / turnCount) : 0,
    turnToolCallCount: combineStats(summaries.map((summary) => summary.turnToolCallCount)),
    provider: {
      calls: sum(summaries.map((summary) => summary.provider.calls)),
      completed: sum(summaries.map((summary) => summary.provider.completed)),
      errors: sum(summaries.map((summary) => summary.provider.errors)),
      ttftMs: combineStats(summaries.map((summary) => summary.provider.ttftMs)),
      durationMs: combineStats(summaries.map((summary) => summary.provider.durationMs)),
      byTier,
    },
    async: {
      submits: sum(summaries.map((summary) => summary.async.submits)),
      pollCount: sum(summaries.map((summary) => summary.async.pollCount)),
      pollDurationMs: combineStats(summaries.map((summary) => summary.async.pollDurationMs)),
      statuses,
    },
    usage: combineUsage(summaries),
  };
}

function rowFormat(row) {
  if (typeof row.event === "string") return "observability";
  if (typeof row.type === "string") return "pi-session";
  return "unknown";
}

function groupByTrace(rows) {
  const groups = new Map();
  for (const row of rows) {
    const format = rowFormat(row);
    const runId = format === "observability" ? row.runId ?? `unknown-${basename(row.sourceFile)}` : basename(row.sourceFile).replace(/\.jsonl$/, "");
    const key = `${format}\0${row.sourceFile}\0${runId}`;
    if (!groups.has(key)) groups.set(key, { format, runId, source: row.sourceFile, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}

function summarizeGroup(group) {
  if (group.format === "observability") return summarizeObservability(String(group.runId), group.rows, group.source);
  if (group.format === "pi-session") return summarizePiSession(group.rows, group.source);
  throw new Error(`${group.source}: unsupported JSONL trace shape`);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  return hash >>> 0;
}

function random01(seed) {
  let x = hashString(seed) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 0x100000000;
}

function comparisonCost(model, tier, input, output) {
  const rates = MODEL_COSTS[model][tier];
  return round((input * rates.input) / 1_000_000 + (output * rates.output) / 1_000_000, 12);
}

function comparisonFor(summary, options) {
  const effectiveInput = summary.usage.input + summary.usage.cacheRead + summary.usage.cacheWrite;
  const output = summary.usage.output;
  const realtimeCost = comparisonCost(options.model, "realtime", effectiveInput, output);
  const tier1Cost = comparisonCost(options.model, "tier1", effectiveInput, output);
  const tier2Cost = comparisonCost(options.model, "tier2", effectiveInput, output);
  const realtimeMs = summary.provider.durationMs.total;
  const tier2Durations = Array.from({ length: summary.turnCount }, (_, index) => {
    const random = random01(`${summary.source}:${summary.traceId}:${options.model}:tier2:${index}`);
    return options.tier2MinMs + random * (options.tier2MaxMs - options.tier2MinMs);
  });
  const tier2Ms = sum(tier2Durations);

  return {
    model: options.model,
    effectiveInput,
    output,
    normalRealtime: { cost: realtimeCost, durationMs: realtimeMs },
    doublewordTier1: { cost: tier1Cost, durationMs: realtimeMs },
    doublewordTier2: {
      cost: tier2Cost,
      durationMs: tier2Ms,
      avgDurationMs: summary.turnCount ? round(tier2Ms / summary.turnCount) : 0,
      minSlaMs: options.tier2MinMs,
      maxSlaMs: options.tier2MaxMs,
    },
  };
}

function addComparison(summary, options) {
  summary.comparison = comparisonFor(summary, options);
  return summary;
}

function addCombinedComparison(total, summaries, options) {
  const effectiveInput = sum(summaries.map((summary) => summary.comparison.effectiveInput));
  const output = sum(summaries.map((summary) => summary.comparison.output));
  const realtimeCost = comparisonCost(options.model, "realtime", effectiveInput, output);
  const tier1Cost = comparisonCost(options.model, "tier1", effectiveInput, output);
  const tier2Cost = comparisonCost(options.model, "tier2", effectiveInput, output);
  const realtimeMs = sum(summaries.map((summary) => summary.comparison.normalRealtime.durationMs));
  const tier2Ms = sum(summaries.map((summary) => summary.comparison.doublewordTier2.durationMs));
  total.comparison = {
    model: options.model,
    effectiveInput,
    output,
    normalRealtime: { cost: realtimeCost, durationMs: realtimeMs },
    doublewordTier1: { cost: tier1Cost, durationMs: realtimeMs },
    doublewordTier2: {
      cost: tier2Cost,
      durationMs: tier2Ms,
      avgDurationMs: total.turnCount ? round(tier2Ms / total.turnCount) : 0,
      minSlaMs: options.tier2MinMs,
      maxSlaMs: options.tier2MaxMs,
    },
  };
  return total;
}

function formatDuration(ms) {
  if (ms < 120_000) return `${round(ms / 1000, 1)}s`;
  if (ms < 7_200_000) return `${round(ms / 60_000, 1)}m`;
  return `${round(ms / 3_600_000, 1)}h`;
}

function markdown(summary) {
  const total = summary.totals;
  const lines = [
    "# Phase 6 Trace Benchmark Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    `Input files: ${summary.files.length}`,
    `Traces: ${summary.traceCount}`,
    `Comparison model: ${summary.comparison.model}`,
    `Tier 2 SLA simulation: ${formatDuration(summary.comparison.tier2MinMs)}-${formatDuration(summary.comparison.tier2MaxMs)} per model turn`,
    "",
    "## Totals",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Agent runs | ${total.agents} |`,
    `| Model turns | ${total.turnCount} |`,
    `| Tool calls | ${total.toolCallCount} |`,
    `| Avg tools / turn | ${total.avgToolCallsPerTurn} |`,
    `| Provider calls | ${total.provider.calls} |`,
    `| Provider errors | ${total.provider.errors} |`,
    `| Avg TTFT ms | ${total.provider.ttftMs.avg} |`,
    `| Provider duration ms | ${total.provider.durationMs.total} |`,
    `| Async polls | ${total.async.pollCount} |`,
    `| Async poll duration ms | ${total.async.pollDurationMs.total} |`,
    `| Input tokens | ${total.usage.input} |`,
    `| Cache read tokens | ${total.usage.cacheRead} |`,
    `| Cache write tokens | ${total.usage.cacheWrite} |`,
    `| Output tokens | ${total.usage.output} |`,
    `| Recorded/estimated source cost | $${total.usage.cost.total} |`,
    "",
    `## ${summary.comparison.model} tier comparison`,
    "",
    "| Trace | Turns | Tools | Effective input | Output | Normal realtime cost/time | Doubleword tier 1 cost/time | Doubleword tier 2 cost/SLA |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const trace of summary.traces) {
    lines.push(`| ${trace.traceId} | ${trace.turnCount} | ${trace.toolCallCount} | ${trace.comparison.effectiveInput} | ${trace.comparison.output} | $${trace.comparison.normalRealtime.cost} / ${formatDuration(trace.comparison.normalRealtime.durationMs)} | $${trace.comparison.doublewordTier1.cost} / ${formatDuration(trace.comparison.doublewordTier1.durationMs)} | $${trace.comparison.doublewordTier2.cost} / ${formatDuration(trace.comparison.doublewordTier2.durationMs)} |`);
  }
  lines.push(`| **total** | **${total.turnCount}** | **${total.toolCallCount}** | **${total.comparison.effectiveInput}** | **${total.comparison.output}** | **$${total.comparison.normalRealtime.cost} / ${formatDuration(total.comparison.normalRealtime.durationMs)}** | **$${total.comparison.doublewordTier1.cost} / ${formatDuration(total.comparison.doublewordTier1.durationMs)}** | **$${total.comparison.doublewordTier2.cost} / ${formatDuration(total.comparison.doublewordTier2.durationMs)}** |`);

  lines.push(
    "",
    "## By trace",
    "",
    "| Trace | Format | Turns | Tools | Tools/turn | Provider calls | Avg TTFT ms | Async polls | Source cost |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const trace of summary.traces) {
    lines.push(`| ${trace.traceId} | ${trace.format} | ${trace.turnCount} | ${trace.toolCallCount} | ${trace.avgToolCallsPerTurn} | ${trace.provider.calls} | ${trace.provider.ttftMs.avg} | ${trace.async.pollCount} | $${trace.usage.cost.total} |`);
  }

  return `${lines.join("\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
const files = [...new Set(options.paths.flatMap(collectJsonl))];
if (options.explicitPaths && files.length === 0) throw new Error(`no JSONL files found for input: ${options.paths.join(", ")}`);
const rows = files.flatMap(readRows);
if (rows.length === 0) throw new Error(`no events found in JSONL input: ${files.length ? files.join(", ") : options.paths.join(", ")}`);
const traces = groupByTrace(rows).map(summarizeGroup).map((summary) => addComparison(summary, options));
const totals = addCombinedComparison(combineSummaries("all", traces, files.length === 1 ? files[0] : `${files.length} files`), traces, options);
const summary = {
  generatedAt: new Date().toISOString(),
  inputs: options.paths,
  files,
  traceCount: traces.length,
  comparison: { model: options.model, tier2MinMs: options.tier2MinMs, tier2MaxMs: options.tier2MaxMs },
  totals,
  traces,
};

mkdirSync(options.out, { recursive: true });
writeFileSync(join(options.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(options.out, "summary.md"), markdown(summary));
console.log(`wrote ${join(options.out, "summary.json")} and ${join(options.out, "summary.md")} (${traces.length} traces, ${rows.length} events)`);
