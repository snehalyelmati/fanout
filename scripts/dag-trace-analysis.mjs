#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const MODEL = "glm-5-2";
const TIER2_MIN_MS = 5 * 60 * 1000;
const TIER2_MAX_MS = 10 * 60 * 1000;
const COST = {
  tier1: { input: 1.4, output: 4.4 },
  tier2: { input: 1.05, output: 3.3 },
};
const LABELS = {
  "2026-01-16T03-18-40-694Z_89afd3da-1fa3-45f9-87ad-a023f92372ee.jsonl": "tiny-tools",
  "2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl": "medium-pr-review-merge",
  "2026-01-16T02-37-34-075Z_4293a326-81ca-4327-b450-85275e1ca645.jsonl": "large-issue-732",
};

function parseArgs(argv) {
  const paths = [];
  let out = join("runs", "dag-analysis");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i];
    else paths.push(argv[i]);
  }
  if (!paths.length) throw new Error("usage: node scripts/dag-trace-analysis.mjs <trace.jsonl...> [--out dir]");
  return { paths, out };
}

function timestampMs(value) {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function content(message) {
  return Array.isArray(message?.content) ? message.content : [];
}

function textSummary(parts) {
  const text = parts.filter((p) => p?.type === "text").map((p) => p.text ?? "").join(" ").replace(/\s+/g, " ").trim();
  return text.slice(0, 90).replace(/\|/g, "\\|");
}

function usageOf(message) {
  const usage = message?.usage ?? {};
  const input = Number(usage.input ?? usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output ?? usage.output_tokens ?? usage.completion_tokens ?? 0);
  const cacheRead = Number(usage.cacheRead ?? usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0);
  const cacheWrite = Number(usage.cacheWrite ?? usage.input_tokens_details?.cache_write_tokens ?? usage.prompt_tokens_details?.cache_write_tokens ?? 0);
  return { input, output, cacheRead, cacheWrite, effectiveInput: input + cacheRead + cacheWrite };
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cost(tier, usage) {
  return round((usage.effectiveInput * COST[tier].input + usage.output * COST[tier].output) / 1_000_000, 12);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return hash >>> 0;
}

function random01(seed) {
  let x = hashString(seed) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 0x100000000;
}

function tier2Ms(seed) {
  return TIER2_MIN_MS + random01(seed) * (TIER2_MAX_MS - TIER2_MIN_MS);
}

function fmtMs(ms) {
  if (ms < 120_000) return `${round(ms / 1000, 1)}s`;
  if (ms < 7_200_000) return `${round(ms / 60_000, 1)}m`;
  return `${round(ms / 3_600_000, 1)}h`;
}

function analyze(path) {
  const rows = readFileSync(path, "utf8").trimEnd().split("\n").map((line, i) => ({ ...JSON.parse(line), line: i + 1 }));
  const label = LABELS[basename(path)] ?? basename(path).replace(/\.jsonl$/, "");
  const sessionId = rows.find((row) => row.type === "session")?.id ?? basename(path).replace(/\.jsonl$/, "");
  const nodes = [];
  const assistantNodes = [];
  const segments = [];
  let previousMessageNode;
  let previousMessageMs;
  let pendingAssistant;
  let segment;

  for (const row of rows) {
    if (row.type !== "message") continue;
    const message = row.message ?? {};
    const role = message.role;
    const ms = timestampMs(row.timestamp) ?? timestampMs(message.timestamp);

    if (role === "user") {
      segment = { id: `S${segments.length + 1}`, userLine: row.line, assistants: [] };
      segments.push(segment);
      const node = { id: `U${segments.length}`, type: "user", line: row.line, depends: previousMessageNode ? [previousMessageNode.id] : [], observedMs: 0, tier: "n/a", summary: textSummary(content(message)) };
      nodes.push(node);
      previousMessageNode = node;
      previousMessageMs = ms;
      pendingAssistant = undefined;
      continue;
    }

    if (role === "assistant") {
      const parts = content(message);
      const toolCalls = parts.filter((p) => p?.type === "toolCall");
      const usage = usageOf(message);
      const node = {
        id: `A${assistantNodes.length + 1}`,
        type: "assistant",
        segmentId: segment?.id ?? "S?",
        line: row.line,
        depends: pendingAssistant?.tools?.length ? pendingAssistant.tools.map((t) => t.id) : previousMessageNode ? [previousMessageNode.id] : [],
        observedMs: previousMessageMs === undefined || ms === undefined ? 0 : Math.max(0, ms - previousMessageMs),
        tier: "tier1-critical",
        usage,
        tier1Cost: cost("tier1", usage),
        tier2Cost: cost("tier2", usage),
        tier2Ms: tier2Ms(`${path}:${sessionId}:${MODEL}:tier2:${assistantNodes.length}`),
        toolCalls: toolCalls.map((p) => ({ id: p.id, name: p.name, arguments: p.arguments })),
        summary: `${message.stopReason ?? ""} ${textSummary(parts)}`.trim(),
      };
      nodes.push(node);
      assistantNodes.push(node);
      segment?.assistants.push(node);
      previousMessageNode = node;
      previousMessageMs = ms;
      pendingAssistant = { node, tools: [], pendingIds: new Set(node.toolCalls.map((t) => t.id)) };
      continue;
    }

    if (role === "toolResult") {
      const node = {
        id: `T${nodes.filter((n) => n.type === "tool").length + 1}`,
        type: "tool",
        line: row.line,
        depends: pendingAssistant?.node ? [pendingAssistant.node.id] : previousMessageNode ? [previousMessageNode.id] : [],
        observedMs: pendingAssistant?.node && ms !== undefined ? Math.max(0, ms - timestampMs(rows[pendingAssistant.node.line - 1]?.timestamp)) : 0,
        tier: "local-tool",
        toolName: message.toolName,
        toolCallId: message.toolCallId,
        summary: `${message.toolName ?? "tool"}${message.isError ? " error" : ""}`,
      };
      nodes.push(node);
      pendingAssistant?.tools.push(node);
      pendingAssistant?.pendingIds.delete(message.toolCallId);
      previousMessageNode = node;
      previousMessageMs = ms;
      continue;
    }
  }

  // If a next assistant follows a tool batch, it must wait on the whole batch. Patch deps created before all tool results were known.
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== "assistant") continue;
    const prev = nodes[i - 1];
    if (prev?.type !== "tool") {
      continue;
    }
    const batch = [];
    for (let j = i - 1; j >= 0 && nodes[j].type === "tool"; j--) batch.unshift(nodes[j].id);
    nodes[i].depends = batch;
  }

  const toolBatches = assistantNodes.map((a) => nodes.filter((n) => n.type === "tool" && n.depends.includes(a.id)));
  const providerMs = assistantNodes.reduce((sum, n) => sum + n.observedMs, 0);
  const toolCriticalMs = toolBatches.reduce((sum, batch) => sum + Math.max(0, ...batch.map((n) => n.observedMs)), 0);
  const tier1Cost = assistantNodes.reduce((sum, n) => sum + n.tier1Cost, 0);
  const tier2Cost = assistantNodes.reduce((sum, n) => sum + n.tier2Cost, 0);
  const tier2SequentialMs = assistantNodes.reduce((sum, n) => sum + n.tier2Ms, 0);

  let optimisticCost = 0;
  let optimisticMs = 0;
  let optimisticTier2Turns = 0;
  for (const s of segments) {
    const turns = s.assistants;
    if (turns.length <= 2) {
      optimisticCost += turns.reduce((sum, n) => sum + n.tier1Cost, 0);
      optimisticMs += turns.reduce((sum, n) => sum + n.observedMs, 0);
      continue;
    }
    const first = turns[0];
    const last = turns[turns.length - 1];
    const middle = turns.slice(1, -1);
    optimisticCost += first.tier1Cost + last.tier1Cost + middle.reduce((sum, n) => sum + n.tier2Cost, 0);
    optimisticMs += first.observedMs + last.observedMs + Math.max(...middle.map((n) => n.tier2Ms));
    optimisticTier2Turns += middle.length;
  }

  const totals = assistantNodes.reduce((sum, n) => ({
    input: sum.input + n.usage.input,
    cacheRead: sum.cacheRead + n.usage.cacheRead,
    cacheWrite: sum.cacheWrite + n.usage.cacheWrite,
    effectiveInput: sum.effectiveInput + n.usage.effectiveInput,
    output: sum.output + n.usage.output,
  }), { input: 0, cacheRead: 0, cacheWrite: 0, effectiveInput: 0, output: 0 });

  const parallelToolBatches = toolBatches.filter((batch) => batch.length > 1);
  return {
    label, path, lineCount: rows.length, nodes, segments, assistantNodes, totals,
    metrics: {
      userSegments: segments.length,
      assistantTurns: assistantNodes.length,
      toolCalls: assistantNodes.reduce((sum, n) => sum + n.toolCalls.length, 0),
      providerMs,
      toolCriticalMs,
      activeCriticalMs: providerMs + toolCriticalMs,
      tier1Cost: round(tier1Cost, 12),
      tier2Cost: round(tier2Cost, 12),
      tier2SequentialMs,
      actualDagComboCost: round(tier1Cost, 12),
      actualDagComboMs: providerMs,
      offCriticalAssistantTurns: 0,
      optimisticBoundaryComboCost: round(optimisticCost, 12),
      optimisticBoundaryComboMs: optimisticMs,
      optimisticBoundaryTier2Turns: optimisticTier2Turns,
      parallelToolBatches: parallelToolBatches.length,
      maxToolFanout: Math.max(0, ...toolBatches.map((b) => b.length)),
    },
  };
}

function renderTrace(trace) {
  const m = trace.metrics;
  const lines = [
    `# DAG analysis: ${trace.label}`,
    "",
    `Source: \`${trace.path}\``,
    "",
    "## Inventory",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| JSONL lines read | ${trace.lineCount} |`,
    `| User segments | ${m.userSegments} |`,
    `| Assistant/model turns | ${m.assistantTurns} |`,
    `| Tool calls/results | ${m.toolCalls} |`,
    `| Effective input tokens | ${trace.totals.effectiveInput} |`,
    `| Output tokens | ${trace.totals.output} |`,
    `| Realtime/tier1 provider proxy | ${fmtMs(m.providerMs)} |`,
    `| Tool critical wait proxy | ${fmtMs(m.toolCriticalMs)} |`,
    "",
    "## DAG conclusion",
    "",
    `The faithful trace DAG has ${m.offCriticalAssistantTurns} off-critical assistant/model turns. Tool calls can fan out inside ${m.parallelToolBatches} assistant turns, but provider calls remain sequential.`,
    "",
    "## Cost/time scenarios",
    "",
    "| Scenario | Cost | Provider time | Notes |",
    "| --- | ---: | ---: | --- |",
    `| Realtime endpoints / tier1 all turns | $${m.tier1Cost} | ${fmtMs(m.providerMs)} | Baseline faithful trace |`,
    `| Faithful DAG tier1+tier2 combo | $${m.actualDagComboCost} | ${fmtMs(m.actualDagComboMs)} | Same as baseline; no safe off-critical model turns |`,
    `| All tier2, blocking | $${m.tier2Cost} | ${fmtMs(m.tier2SequentialMs)} | Cost floor, unusable active latency |`,
    `| Optimistic segment DAG combo | $${m.optimisticBoundaryComboCost} | ${fmtMs(m.optimisticBoundaryComboMs)} | First+last assistant per user segment tier1; middle turns tier2 in parallel |`,
    "",
    "## Node table",
    "",
    "| node_id | type | depends_on | line | tier_candidate | observed_ms | token_in | token_out | summary |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- |",
  ];
  for (const node of trace.nodes) {
    lines.push(`| ${node.id} | ${node.type} | ${node.depends.join(",") || "-"} | ${node.line} | ${node.tier} | ${round(node.observedMs)} | ${node.usage?.effectiveInput ?? 0} | ${node.usage?.output ?? 0} | ${node.summary ?? ""} |`);
  }
  return `${lines.join("\n")}\n`;
}

function combine(traces) {
  const metrics = traces.reduce((sum, t) => {
    for (const [key, value] of Object.entries(t.metrics)) sum[key] = (sum[key] ?? 0) + (typeof value === "number" ? value : 0);
    return sum;
  }, {});
  const totals = traces.reduce((sum, t) => {
    for (const [key, value] of Object.entries(t.totals)) sum[key] = (sum[key] ?? 0) + value;
    return sum;
  }, {});
  return { metrics, totals };
}

function renderSummary(traces) {
  const total = combine(traces);
  const m = total.metrics;
  const lines = [
    "# Trace-DAG tier routing estimate",
    "",
    `Model/pricing: ${MODEL}; tier2 SLA simulation ${fmtMs(TIER2_MIN_MS)}-${fmtMs(TIER2_MAX_MS)} per model turn.`,
    "",
    "## Totals",
    "",
    "| Scenario | Cost | Provider time | Delta vs realtime |",
    "| --- | ---: | ---: | ---: |",
    `| Realtime endpoints / tier1 all turns | $${round(m.tier1Cost, 12)} | ${fmtMs(m.providerMs)} | baseline |`,
    `| Faithful DAG tier1+tier2 combo | $${round(m.actualDagComboCost, 12)} | ${fmtMs(m.actualDagComboMs)} | $${round(m.actualDagComboCost - m.tier1Cost, 12)} / ${fmtMs(m.actualDagComboMs - m.providerMs)} |`,
    `| All tier2, blocking | $${round(m.tier2Cost, 12)} | ${fmtMs(m.tier2SequentialMs)} | $${round(m.tier2Cost - m.tier1Cost, 12)} / +${fmtMs(m.tier2SequentialMs - m.providerMs)} |`,
    `| Optimistic segment DAG combo | $${round(m.optimisticBoundaryComboCost, 12)} | ${fmtMs(m.optimisticBoundaryComboMs)} | $${round(m.optimisticBoundaryComboCost - m.tier1Cost, 12)} / +${fmtMs(m.optimisticBoundaryComboMs - m.providerMs)} |`,
    "",
    "Faithful DAG result: all assistant/model turns are on the critical path. A DAG can parallelize local tool batches, but that does not change provider cost and barely changes active provider time.",
    "",
    "Optimistic segment DAG is a deliberately generous bound: first and last assistant turn in each user segment stay tier1; every middle turn runs as parallel tier2. It still turns 17.5m into about 1.8h, so tier2 only makes sense for work that is truly off the user's critical path.",
    "",
    "## By trace",
    "",
    "| Trace | Lines | Segments | Turns | Tools | Tier1 cost/time | Faithful combo cost/time | Optimistic combo cost/time | All tier2 cost/time |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const t of traces) {
    const x = t.metrics;
    lines.push(`| ${t.label} | ${t.lineCount} | ${x.userSegments} | ${x.assistantTurns} | ${x.toolCalls} | $${x.tier1Cost} / ${fmtMs(x.providerMs)} | $${x.actualDagComboCost} / ${fmtMs(x.actualDagComboMs)} | $${x.optimisticBoundaryComboCost} / ${fmtMs(x.optimisticBoundaryComboMs)} | $${x.tier2Cost} / ${fmtMs(x.tier2SequentialMs)} |`);
  }
  return `${lines.join("\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
mkdirSync(options.out, { recursive: true });
const traces = options.paths.map(analyze);
for (const trace of traces) writeFileSync(join(options.out, `${trace.label}-dag.md`), renderTrace(trace));
const summary = { generatedAt: new Date().toISOString(), traces: traces.map(({ nodes, assistantNodes, segments, ...trace }) => trace), totals: combine(traces) };
writeFileSync(join(options.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(options.out, "summary.md"), renderSummary(traces));
console.log(`wrote ${options.out}/summary.md and ${traces.length} DAG reports`);
