#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const DEFAULT_OUT = join("runs", "phase6");

function parseArgs(argv) {
  const paths = [];
  let out = DEFAULT_OUT;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--out") {
      out = argv[++index];
      if (!out) throw new Error("--out requires a directory");
    } else {
      paths.push(arg);
    }
  }

  return { paths: paths.length ? paths : ["runs"], explicitPaths: paths.length > 0, out };
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

function readEvents(file) {
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

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values) {
  return round(values.reduce((total, value) => total + value, 0));
}

function stat(values) {
  const clean = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!clean.length) return { count: 0, total: 0, avg: 0, min: 0, max: 0 };
  const total = sum(clean);
  return { count: clean.length, total, avg: round(total / clean.length), min: Math.min(...clean), max: Math.max(...clean) };
}

function usageTotals(events) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

  for (const event of events.filter((item) => item.event === "provider_end")) {
    const usage = event.usage ?? {};
    totals.input += number(usage.input) ?? 0;
    totals.output += number(usage.output) ?? 0;
    totals.cacheRead += number(usage.cacheRead) ?? 0;
    totals.cacheWrite += number(usage.cacheWrite) ?? 0;
    totals.totalTokens += number(usage.totalTokens) ?? 0;
    totals.cost.input += number(usage.cost?.input) ?? 0;
    totals.cost.output += number(usage.cost?.output) ?? 0;
    totals.cost.cacheRead += number(usage.cost?.cacheRead) ?? 0;
    totals.cost.cacheWrite += number(usage.cost?.cacheWrite) ?? 0;
    totals.cost.total += number(usage.cost?.total) ?? 0;
  }

  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) totals[key] = round(totals[key]);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) totals.cost[key] = round(totals.cost[key], 12);
  return totals;
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
    byTier[tier].durationMs = round(byTier[tier].durationMs + (number(event.durationMs) ?? 0));
    byTier[tier].cost = round(byTier[tier].cost + (number(event.usage?.cost?.total) ?? 0), 12);
  }

  for (const tier of Object.keys(byTier)) {
    byTier[tier].avgDurationMs = byTier[tier].calls ? round(byTier[tier].durationMs / byTier[tier].calls) : 0;
  }

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

function summarize(traceId, events, source) {
  const agentEnds = events.filter((event) => event.event === "agent_end");
  const turnEnds = events.filter((event) => event.event === "turn_end");
  const agentTurnCounts = agentEnds.map((event) => number(event.turnCount)).filter((value) => value !== undefined);
  const agentToolCounts = agentEnds.map((event) => number(event.toolCallCount)).filter((value) => value !== undefined);
  const turnToolCounts = turnEnds.map((event) => number(event.toolCallCount)).filter((value) => value !== undefined);
  const turnCount = Math.max(sum(agentTurnCounts), turnEnds.length);
  const toolCallCount = Math.max(sum(agentToolCounts), sum(turnToolCounts));

  return {
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

function combineStats(stats) {
  const clean = stats.filter((item) => item.count > 0);
  if (!clean.length) return { count: 0, total: 0, avg: 0, min: 0, max: 0 };
  const count = sum(clean.map((item) => item.count));
  const total = sum(clean.map((item) => item.total));
  return { count, total, avg: count ? round(total / count) : 0, min: Math.min(...clean.map((item) => item.min)), max: Math.max(...clean.map((item) => item.max)) };
}

function combineUsage(summaries) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  for (const summary of summaries) {
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) totals[key] += summary.usage[key];
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) totals.cost[key] += summary.usage.cost[key];
  }
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) totals[key] = round(totals[key]);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) totals.cost[key] = round(totals.cost[key], 12);
  return totals;
}

function combineSummaries(traceId, summaries, source) {
  const turnCount = sum(summaries.map((summary) => summary.turnCount));
  const toolCallCount = sum(summaries.map((summary) => summary.toolCallCount));
  const byTier = {};
  const statuses = {};

  for (const summary of summaries) {
    for (const [tier, tierSummary] of Object.entries(summary.provider.byTier)) {
      byTier[tier] ??= { calls: 0, durationMs: 0, cost: 0 };
      byTier[tier].calls += tierSummary.calls;
      byTier[tier].durationMs = round(byTier[tier].durationMs + tierSummary.durationMs);
      byTier[tier].cost = round(byTier[tier].cost + tierSummary.cost, 12);
    }
    for (const [status, count] of Object.entries(summary.async.statuses)) statuses[status] = (statuses[status] ?? 0) + count;
  }

  for (const tierSummary of Object.values(byTier)) {
    tierSummary.avgDurationMs = tierSummary.calls ? round(tierSummary.durationMs / tierSummary.calls) : 0;
  }

  return {
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

function groupByRun(events) {
  const groups = new Map();
  for (const event of events) {
    const runId = event.runId ?? `unknown-${basename(event.sourceFile)}`;
    const key = `${event.sourceFile}\0${runId}`;
    if (!groups.has(key)) groups.set(key, { runId, source: event.sourceFile, events: [] });
    groups.get(key).events.push(event);
  }
  return [...groups.values()];
}

function markdown(summary) {
  const total = summary.totals;
  const lines = [
    "# Phase 6 Trace Benchmark Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    `Input files: ${summary.files.length}`,
    `Traces: ${summary.traceCount}`,
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
    `| Output tokens | ${total.usage.output} |`,
    `| Estimated cost | $${total.usage.cost.total} |`,
    "",
    "## By trace",
    "",
    "| Trace | Turns | Tools | Tools/turn | Provider calls | Avg TTFT ms | Async polls | Cost |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const trace of summary.traces) {
    lines.push(`| ${trace.traceId} | ${trace.turnCount} | ${trace.toolCallCount} | ${trace.avgToolCallsPerTurn} | ${trace.provider.calls} | ${trace.provider.ttftMs.avg} | ${trace.async.pollCount} | $${trace.usage.cost.total} |`);
  }

  return `${lines.join("\n")}\n`;
}

const { paths, explicitPaths, out } = parseArgs(process.argv.slice(2));
const files = [...new Set(paths.flatMap(collectJsonl))];
if (explicitPaths && files.length === 0) throw new Error(`no JSONL files found for input: ${paths.join(", ")}`);
const events = files.flatMap(readEvents);
if (events.length === 0) throw new Error(`no events found in JSONL input: ${files.length ? files.join(", ") : paths.join(", ")}`);
const traces = groupByRun(events).map((group) => summarize(String(group.runId), group.events, group.source));
const summary = {
  generatedAt: new Date().toISOString(),
  inputs: paths,
  files,
  traceCount: traces.length,
  totals: combineSummaries("all", traces, files.length === 1 ? files[0] : `${files.length} files`),
  traces,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(out, "summary.md"), markdown(summary));
console.log(`wrote ${join(out, "summary.json")} and ${join(out, "summary.md")} (${traces.length} traces, ${events.length} events)`);
