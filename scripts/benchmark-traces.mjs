#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const DEFAULT_OUT = join("runs", "phase6");
const DEFAULT_MODEL = "glm-5-2";
const DEFAULT_TIER2_MIN_MS = 5 * 60 * 1000;
const DEFAULT_TIER2_MAX_MS = 10 * 60 * 1000;
const REPORT_SCHEMA = "doubleword.benchmark-summary";
const REPORT_VERSION = 1;
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

const HYBRID_SCHEMA = "doubleword.hybrid-workflow";
const HYBRID_VERSION = 1;
const REQUIRED_SCENARIOS = [
  "linear-critical-path",
  "wide-fanout",
  "serial-rpe",
  "sharded-rpe",
  "speculative-branch-race",
  "deadline-miss",
  "budget-constrained-routing",
  "conflict-stale-output",
  "validation-failure-fallback",
];

function hybridContext(row, field) {
  const workflow = typeof row.workflowId === "string" ? ` workflow ${row.workflowId}` : "";
  const node = typeof row.nodeId === "string" ? ` node ${row.nodeId}` : "";
  return `${row.sourceFile}:${row.sourceLine}:${workflow}${node}${field ? ` field ${field}` : ""}`;
}

function hybridError(row, field, message) {
  throw new Error(`${hybridContext(row, field)}: ${message}`);
}

function requireString(row, field) {
  if (typeof row[field] !== "string" || !row[field].trim()) hybridError(row, field, "must be a non-empty string");
  return row[field];
}

function requireBoolean(row, field) {
  if (typeof row[field] !== "boolean") hybridError(row, field, "must be a boolean");
  return row[field];
}

function requireNumber(row, field, { positive = false } = {}) {
  if (typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field] < 0 || (positive && row[field] <= 0)) {
    hybridError(row, field, `must be a ${positive ? "positive" : "non-negative"} finite number`);
  }
  return row[field];
}

function requireStringArray(row, field) {
  if (!Array.isArray(row[field]) || row[field].some((item) => typeof item !== "string" || !item.trim())) {
    hybridError(row, field, "must be an array of non-empty strings");
  }
  return row[field];
}

function validateHybridBase(row) {
  if (row.schema !== HYBRID_SCHEMA) hybridError(row, "schema", `must be ${HYBRID_SCHEMA}`);
  if (row.version !== HYBRID_VERSION) hybridError(row, "version", `unsupported hybrid workflow schema version ${row.version}`);
  if (row.kind !== "workflow" && row.kind !== "node") hybridError(row, "kind", "must be workflow or node");
  requireString(row, "workflowId");
}

function normalizeWorkflowRow(row) {
  validateHybridBase(row);
  if (row.kind !== "workflow") hybridError(row, "kind", "expected workflow metadata row");
  const workflow = {
    workflowId: requireString(row, "workflowId"),
    scenarioId: requireString(row, "scenarioId"),
    sourceType: requireString(row, "sourceType"),
    targetActiveTatRatio: requireNumber(row, "targetActiveTatRatio", { positive: true }),
    budgetUsd: row.budgetUsd === undefined ? null : requireNumber(row, "budgetUsd", { positive: true }),
    deadlineOrigin: requireString(row, "deadlineOrigin"),
    tier2Concurrency: requireNumber(row, "tier2Concurrency", { positive: true }),
    activeBoundaryNodeId: requireString(row, "activeBoundaryNodeId"),
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {},
    sourceLine: row.sourceLine,
  };
  if (!["synthetic", "observed", "trace-derived"].includes(workflow.sourceType)) hybridError(row, "sourceType", "must be synthetic, observed, or trace-derived");
  return workflow;
}

function normalizeHybridNode(row) {
  validateHybridBase(row);
  if (row.kind !== "node") hybridError(row, "kind", "expected node row");
  const node = {
    workflowId: requireString(row, "workflowId"),
    nodeId: requireString(row, "nodeId"),
    dependencies: requireStringArray(row, "dependencies"),
    phase: requireString(row, "phase"),
    tierEligibility: requireStringArray(row, "tierEligibility"),
    userBlocking: requireBoolean(row, "userBlocking"),
    mandatory: requireBoolean(row, "mandatory"),
    active: row.active === undefined ? (row.userBlocking ? "active" : "background") : requireString(row, "active"),
    durationsMs: row.durationsMs,
    cost: row.cost,
    deadlineMs: row.deadlineMs === undefined ? null : requireNumber(row, "deadlineMs"),
    outcome: row.outcome ?? {},
    groupId: row.groupId ?? null,
    shardId: row.shardId ?? null,
    branchId: row.branchId ?? null,
    portfolioGroup: row.portfolioGroup ?? null,
    conflictGroup: row.conflictGroup ?? null,
    staleOf: row.staleOf ?? null,
    fallbackTo: row.fallbackTo ?? null,
    reviewOf: row.reviewOf ?? null,
    validationOf: row.validationOf ?? null,
    sourceLine: row.sourceLine,
  };
  if (!["active", "background"].includes(node.active)) hybridError(row, "active", "must be active or background");
  if (!node.tierEligibility.every((tier) => tier === "tier1" || tier === "tier2")) hybridError(row, "tierEligibility", "must only include tier1 or tier2");
  if (!node.durationsMs || typeof node.durationsMs !== "object" || Array.isArray(node.durationsMs)) hybridError(row, "durationsMs", "must be an object");
  for (const tier of ["tier1", "tier2"]) {
    if (typeof node.durationsMs[tier] !== "number" || !Number.isFinite(node.durationsMs[tier]) || node.durationsMs[tier] < 0) {
      hybridError(row, `durationsMs.${tier}`, "must be a non-negative finite number");
    }
  }
  if (!node.cost || typeof node.cost !== "object" || Array.isArray(node.cost)) hybridError(row, "cost", "must be an object");
  for (const field of ["inputTokens", "outputTokens"]) {
    if (typeof node.cost[field] !== "number" || !Number.isFinite(node.cost[field]) || node.cost[field] < 0) {
      hybridError(row, `cost.${field}`, "must be a non-negative finite number");
    }
  }
  for (const field of ["groupId", "shardId", "branchId", "portfolioGroup", "conflictGroup", "staleOf", "fallbackTo", "reviewOf", "validationOf"]) {
    if (node[field] !== null && (typeof node[field] !== "string" || !node[field].trim())) hybridError(row, field, "must be a non-empty string when present");
  }
  if (!node.outcome || typeof node.outcome !== "object" || Array.isArray(node.outcome)) hybridError(row, "outcome", "must be an object when present");
  return node;
}

function topologicalHybridNodes(workflow, nodes, source) {
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.nodeId)) throw new Error(`${source}:${node.sourceLine}: workflow ${workflow.workflowId} node ${node.nodeId} field nodeId: duplicate node id`);
    byId.set(node.nodeId, node);
  }
  if (!byId.size) throw new Error(`${source}:${workflow.sourceLine}: workflow ${workflow.workflowId} field nodes: workflow must contain at least one node`);
  if (!byId.has(workflow.activeBoundaryNodeId)) throw new Error(`${source}:${workflow.sourceLine}: workflow ${workflow.workflowId} field activeBoundaryNodeId: missing boundary node ${workflow.activeBoundaryNodeId}`);

  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (dependency.includes(":")) throw new Error(`${source}:${node.sourceLine}: workflow ${workflow.workflowId} node ${node.nodeId} field dependencies: cross-workflow dependency ${dependency} is not supported`);
      if (dependency === node.nodeId) throw new Error(`${source}:${node.sourceLine}: workflow ${workflow.workflowId} node ${node.nodeId} field dependencies: self dependency is not allowed`);
      if (!byId.has(dependency)) throw new Error(`${source}:${node.sourceLine}: workflow ${workflow.workflowId} node ${node.nodeId} field dependencies: missing dependency ${dependency}`);
    }
  }

  const sorted = [];
  const temporary = new Set();
  const permanent = new Set();
  function visit(node) {
    if (permanent.has(node.nodeId)) return;
    if (temporary.has(node.nodeId)) throw new Error(`${source}:${node.sourceLine}: workflow ${workflow.workflowId} node ${node.nodeId} field dependencies: dependency cycle detected`);
    temporary.add(node.nodeId);
    for (const dependency of [...node.dependencies].sort()) visit(byId.get(dependency));
    temporary.delete(node.nodeId);
    permanent.add(node.nodeId);
    sorted.push(node);
  }
  for (const node of [...nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) visit(node);
  return sorted;
}

function hybridGraphMetrics(workflow, nodes) {
  const completion = {};
  let edgeCount = 0;
  let activeNodeCount = 0;
  let backgroundNodeCount = 0;
  for (const node of nodes) {
    edgeCount += node.dependencies.length;
    if (node.active === "background" || !node.userBlocking) backgroundNodeCount++;
    else activeNodeCount++;
    const start = node.dependencies.length ? Math.max(...node.dependencies.map((id) => completion[id] ?? 0)) : 0;
    completion[node.nodeId] = start + node.durationsMs.tier1;
  }
  const criticalPathMs = Math.max(...Object.values(completion), 0);
  return {
    nodeCount: nodes.length,
    edgeCount,
    activeNodeCount,
    backgroundNodeCount,
    criticalPathMs,
    activeBoundaryNodeId: workflow.activeBoundaryNodeId,
    activeBoundaryTier1Ms: completion[workflow.activeBoundaryNodeId] ?? 0,
  };
}

const HYBRID_POLICY_IDS = [
  "all_tier1_baseline",
  "all_tier2_blocking",
  "critical_path_slack",
  "deadline_synthesis",
  "rpe_background",
  "sharded_rpe",
  "speculative_portfolio",
  "budget_constrained_routing",
];

function hybridNodeCost(node, tier, model) {
  return comparisonCost(model, tier, node.cost.inputTokens, node.cost.outputTokens);
}

function canRunOn(node, tier) {
  return node.tierEligibility.includes(tier);
}

function isHybridNodeAccepted(node) {
  return node.outcome.accepted === true && node.outcome.failed !== true && node.outcome.stale !== true && node.outcome.conflict !== true;
}

function isHybridNodeInvalid(node) {
  return node.outcome.failed === true || node.outcome.stale === true || node.outcome.conflict === true;
}

function desiredHybridTier(policyId, node) {
  if (policyId === "all_tier1_baseline") return "tier1";
  if (policyId === "all_tier2_blocking") return canRunOn(node, "tier2") ? "tier2" : "tier1";
  if (policyId === "rpe_background" || policyId === "sharded_rpe") {
    if (node.phase === "execute" && canRunOn(node, "tier2")) return "tier2";
    return "tier1";
  }
  if (policyId === "speculative_portfolio") {
    if ((node.portfolioGroup || node.branchId || node.phase === "execute") && canRunOn(node, "tier2")) return "tier2";
    return "tier1";
  }
  if (policyId === "critical_path_slack" || policyId === "deadline_synthesis") {
    if ((node.active === "background" || !node.userBlocking || !node.mandatory) && canRunOn(node, "tier2")) return "tier2";
    return "tier1";
  }
  return "tier1";
}

function routeHybridBudgetPolicy(nodes, workflow, model) {
  const assignments = {};
  let total = 0;
  for (const node of nodes) {
    const tier = canRunOn(node, "tier1") ? "tier1" : "tier2";
    assignments[node.nodeId] = tier;
    total = round(total + hybridNodeCost(node, tier, model), 12);
  }

  const budget = workflow.budgetUsd ?? Number.POSITIVE_INFINITY;
  const candidates = nodes
    .filter((node) => canRunOn(node, "tier2") && assignments[node.nodeId] !== "tier2")
    .sort((a, b) => {
      const priorityA = a.active === "background" || !a.mandatory ? 0 : 1;
      const priorityB = b.active === "background" || !b.mandatory ? 0 : 1;
      return priorityA - priorityB || a.nodeId.localeCompare(b.nodeId);
    });

  for (const node of candidates) {
    const tier1Cost = hybridNodeCost(node, "tier1", model);
    const tier2Cost = hybridNodeCost(node, "tier2", model);
    const nextTotal = round(total - tier1Cost + tier2Cost, 12);
    if (nextTotal <= budget) {
      assignments[node.nodeId] = "tier2";
      total = nextTotal;
    }
  }
  return assignments;
}

function hybridPolicyAssignments(policyId, workflow, nodes, model) {
  if (policyId === "budget_constrained_routing") return routeHybridBudgetPolicy(nodes, workflow, model);
  const assignments = {};
  for (const node of nodes) {
    let tier = desiredHybridTier(policyId, node);
    if (policyId !== "all_tier1_baseline" && !canRunOn(node, tier)) tier = canRunOn(node, "tier1") ? "tier1" : "tier2";
    assignments[node.nodeId] = tier;
  }
  return assignments;
}

function hybridActiveNodeSet(policyId, nodes) {
  const active = new Set();
  for (const node of nodes) {
    const blocking = policyId === "all_tier2_blocking" ? (node.userBlocking || node.mandatory) : (node.active === "active" || node.userBlocking || (node.mandatory && node.active !== "background"));
    if (blocking) active.add(node.nodeId);
  }
  return active;
}

function scheduleHybridNodes(policyId, workflow, nodes, assignments) {
  const activeIds = hybridActiveNodeSet(policyId, nodes);
  activeIds.add(workflow.activeBoundaryNodeId);
  const completion = {};
  const tier2Slots = Array.from({ length: Math.max(1, Math.trunc(workflow.tier2Concurrency)) }, () => 0);
  const schedule = [];

  for (const node of nodes) {
    const assignedTier = assignments[node.nodeId];
    const dependencyReadyMs = node.dependencies.length ? Math.max(...node.dependencies.map((id) => completion[id] ?? 0)) : 0;
    let startMs = dependencyReadyMs;
    if (assignedTier === "tier2") {
      let slot = 0;
      for (let index = 1; index < tier2Slots.length; index++) {
        if (tier2Slots[index] < tier2Slots[slot]) slot = index;
      }
      startMs = Math.max(dependencyReadyMs, tier2Slots[slot]);
      tier2Slots[slot] = startMs + node.durationsMs.tier2;
    }
    const durationMs = assignedTier === "tier2" ? node.durationsMs.tier2 : node.durationsMs.tier1;
    const endMs = startMs + durationMs;
    completion[node.nodeId] = endMs;
    const deadlineMiss = node.deadlineMs !== null && endMs > node.deadlineMs;
    schedule.push({
      nodeId: node.nodeId,
      dependencies: node.dependencies,
      phase: node.phase,
      assignedTier,
      startMs,
      endMs,
      durationMs,
      activePath: activeIds.has(node.nodeId),
      background: !activeIds.has(node.nodeId),
      mandatory: node.mandatory,
      userBlocking: node.userBlocking,
      tierEligibility: node.tierEligibility,
      accepted: isHybridNodeAccepted(node),
      late: node.outcome.late === true || deadlineMiss,
      failed: node.outcome.failed === true,
      stale: node.outcome.stale === true,
      conflict: node.outcome.conflict === true || false,
      deadlineMs: node.deadlineMs,
      deadlineMiss,
      groupId: node.groupId,
      shardId: node.shardId,
      branchId: node.branchId,
      portfolioGroup: node.portfolioGroup,
      conflictGroup: node.conflictGroup,
      staleOf: node.staleOf,
      fallbackTo: node.fallbackTo,
      reviewOf: node.reviewOf,
      validationOf: node.validationOf,
    });
  }

  return schedule;
}

function peakTier2Concurrency(schedule) {
  const changes = [];
  for (const item of schedule.filter((node) => node.assignedTier === "tier2")) {
    changes.push([item.startMs, 1], [item.endMs, -1]);
  }
  changes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of changes) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

function speculativePortfolioEvidence(schedule, nodes, model) {
  const groups = {};
  for (const node of schedule.filter((item) => item.portfolioGroup)) {
    groups[node.portfolioGroup] ??= { acceptedBranchId: null, acceptedNodeId: null, rejectedNodeIds: [], loserNodeIds: [], wastedSpeculativeCost: 0 };
    const original = nodes.find((candidate) => candidate.nodeId === node.nodeId);
    if (node.accepted && !node.failed && !node.stale && !node.conflict && !groups[node.portfolioGroup].acceptedNodeId) {
      groups[node.portfolioGroup].acceptedBranchId = node.branchId;
      groups[node.portfolioGroup].acceptedNodeId = node.nodeId;
    } else {
      if (node.failed || node.stale || node.conflict) groups[node.portfolioGroup].rejectedNodeIds.push(node.nodeId);
      else groups[node.portfolioGroup].loserNodeIds.push(node.nodeId);
      groups[node.portfolioGroup].wastedSpeculativeCost = round(groups[node.portfolioGroup].wastedSpeculativeCost + hybridNodeCost(original, node.assignedTier, model), 12);
    }
  }
  return groups;
}

function simulateHybridPolicy(policyId, workflow, nodes, graph, model, baseline) {
  const assignments = hybridPolicyAssignments(policyId, workflow, nodes, model);
  const schedule = scheduleHybridNodes(policyId, workflow, nodes, assignments);
  const tier1BaselineTatMs = baseline?.optimizedActiveTatMs ?? schedule.find((node) => node.nodeId === workflow.activeBoundaryNodeId)?.endMs ?? 0;
  const activeTatMs = Math.max(
    schedule.find((node) => node.nodeId === workflow.activeBoundaryNodeId)?.endMs ?? 0,
    ...schedule.filter((node) => node.activePath).map((node) => node.endMs),
  );
  const backgroundCompletionMs = Math.max(activeTatMs, ...schedule.map((node) => node.endMs));
  const costTotal = round(schedule.reduce((total, item) => {
    const node = nodes.find((candidate) => candidate.nodeId === item.nodeId);
    return total + hybridNodeCost(node, item.assignedTier, model);
  }, 0), 12);
  const baselineCost = baseline?.costTotal ?? costTotal;
  const portfolioEvidence = policyId === "speculative_portfolio" ? speculativePortfolioEvidence(schedule, nodes, model) : {};
  const wastedSpeculativeCost = round(Object.values(portfolioEvidence).reduce((total, group) => total + group.wastedSpeculativeCost, 0), 12);
  const deadlineMissCount = schedule.filter((node) => node.deadlineMiss).length;
  const lateResultCount = schedule.filter((node) => node.late).length;
  const validationFailureCount = schedule.filter((node) => node.failed).length;
  const fallbackToTier1Count = nodes.filter((node) => node.fallbackTo && schedule.some((item) => item.nodeId === node.fallbackTo && item.assignedTier === "tier1")).length;
  const acceptedResultCount = policyId === "speculative_portfolio"
    ? schedule.filter((node) => node.accepted && (!node.portfolioGroup || Object.values(portfolioEvidence).some((group) => group.acceptedNodeId === node.nodeId))).length
    : schedule.filter((node) => node.accepted).length;
  const activeTatRatio = tier1BaselineTatMs > 0 ? round(activeTatMs / tier1BaselineTatMs) : null;
  const budgetExceeded = workflow.budgetUsd !== null && costTotal > workflow.budgetUsd;
  const unresolvedMandatory = schedule.filter((item) => {
    if (!item.mandatory) return false;
    if (item.deadlineMiss || item.stale || item.conflict) return true;
    if (item.failed) {
      const original = nodes.find((node) => node.nodeId === item.nodeId);
      return !original?.fallbackTo || !schedule.some((candidate) => candidate.nodeId === original.fallbackTo && candidate.accepted);
    }
    return false;
  });
  const activeMandatoryTier2 = schedule.some((item) => item.activePath && item.mandatory && item.assignedTier === "tier2");
  const targetMs = tier1BaselineTatMs * workflow.targetActiveTatRatio;
  let targetStatus = "pass";
  let infeasibleReason = "";
  if (policyId === "all_tier1_baseline") {
    targetStatus = "pass";
  } else if (workflow.scenarioId === "linear-critical-path" && activeMandatoryTier2) {
    targetStatus = "infeasible";
    infeasibleReason = "mandatory tier2 work is on the active linear critical path";
  } else if (budgetExceeded && policyId === "budget_constrained_routing") {
    targetStatus = "fail";
    infeasibleReason = `cost ${costTotal} exceeds budget ${workflow.budgetUsd}`;
  } else if (unresolvedMandatory.length) {
    targetStatus = "fail";
    infeasibleReason = `mandatory unresolved nodes: ${unresolvedMandatory.map((node) => node.nodeId).join(", ")}`;
  } else if (activeTatMs > targetMs) {
    targetStatus = "fail";
    infeasibleReason = `active TAT ${activeTatMs}ms exceeds ${workflow.targetActiveTatRatio}x baseline ${tier1BaselineTatMs}ms`;
  }

  return {
    policyId,
    tier1BaselineTatMs,
    optimizedActiveTatMs: activeTatMs,
    activeTatRatio,
    backgroundCompletionMs,
    criticalPathMs: graph.criticalPathMs,
    tier1CallCount: schedule.filter((node) => node.assignedTier === "tier1").length,
    tier2CallCount: schedule.filter((node) => node.assignedTier === "tier2").length,
    tier2Concurrency: peakTier2Concurrency(schedule),
    tier2ConcurrencyCap: workflow.tier2Concurrency,
    deadlineMissCount,
    lateResultCount,
    acceptedResultCount,
    validationFailureCount,
    fallbackToTier1Count,
    costTotal,
    costSavedVsTier1: round(baselineCost - costTotal, 12),
    wastedSpeculativeCost,
    budgetUsd: workflow.budgetUsd,
    budgetExceeded,
    targetStatus,
    infeasibleReason,
    schedule,
    activeNodeIds: schedule.filter((node) => node.activePath).map((node) => node.nodeId),
    backgroundNodeIds: schedule.filter((node) => node.background).map((node) => node.nodeId),
    acceptedNodeIds: schedule.filter((node) => node.accepted).map((node) => node.nodeId),
    lateNodeIds: schedule.filter((node) => node.late).map((node) => node.nodeId),
    rejectedNodeIds: schedule.filter((node) => node.failed || node.stale || node.conflict).map((node) => node.nodeId),
    portfolio: portfolioEvidence,
    targetRationale: targetStatus === "pass"
      ? `active TAT ${activeTatMs}ms is within ${workflow.targetActiveTatRatio}x baseline ${tier1BaselineTatMs}ms`
      : infeasibleReason,
  };
}

function addHybridPolicySimulation(summary, options) {
  if (summary.format !== "hybrid-workflow") return summary;
  const baseline = simulateHybridPolicy("all_tier1_baseline", summary.workflow, summary.nodes, summary.graph, options.model);
  const policyResults = [baseline];
  for (const policyId of HYBRID_POLICY_IDS.slice(1)) {
    policyResults.push(simulateHybridPolicy(policyId, summary.workflow, summary.nodes, summary.graph, options.model, baseline));
  }
  summary.policyResults = policyResults;
  summary.policyMatrix = HYBRID_POLICY_IDS;
  summary.tier1BaselineTatMs = baseline.optimizedActiveTatMs;
  return summary;
}

function summarizeHybridWorkflow(rows, source) {
  const workflowRows = rows.filter((row) => row.kind === "workflow");
  if (workflowRows.length !== 1) {
    const row = rows[0];
    throw new Error(`${row.sourceFile}:${row.sourceLine}: workflow ${row.workflowId ?? basename(source)} field kind: expected exactly one workflow metadata row`);
  }
  const workflow = normalizeWorkflowRow(workflowRows[0]);
  const nodes = rows.filter((row) => row.kind === "node").map(normalizeHybridNode);
  const orderedNodes = topologicalHybridNodes(workflow, nodes, source);
  const usage = emptyUsage();
  for (const node of orderedNodes) addUsage(usage, { input: node.cost.inputTokens, output: node.cost.outputTokens });
  finalizeUsage(usage);
  const outcomeCounts = {};
  for (const node of orderedNodes) {
    for (const [key, value] of Object.entries(node.outcome)) {
      if (value === true) outcomeCounts[key] = (outcomeCounts[key] ?? 0) + 1;
    }
  }

  return {
    format: "hybrid-workflow",
    traceId: workflow.workflowId,
    source,
    events: rows.length,
    agents: 0,
    turnCount: orderedNodes.length,
    toolCallCount: 0,
    avgToolCallsPerTurn: 0,
    turnToolCallCount: stat([]),
    provider: {
      calls: 0,
      completed: 0,
      errors: 0,
      ttftMs: stat([]),
      durationMs: stat([]),
      byTier: {},
    },
    async: { submits: 0, pollCount: 0, pollDurationMs: stat([]), statuses: {} },
    usage,
    provenance: {
      sourceType: workflow.sourceType,
      synthetic: workflow.sourceType === "synthetic",
      schema: HYBRID_SCHEMA,
      version: HYBRID_VERSION,
    },
    workflow,
    graph: hybridGraphMetrics(workflow, orderedNodes),
    nodes: orderedNodes,
    outcomeCounts,
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
  if (row.schema === HYBRID_SCHEMA || row.kind === "workflow" || row.kind === "node") return "hybrid-workflow";
  if (typeof row.event === "string") return "observability";
  if (typeof row.type === "string") return "pi-session";
  return "unknown";
}

function groupByTrace(rows) {
  const groups = new Map();
  for (const row of rows) {
    const format = rowFormat(row);
    const runId = format === "observability" ? row.runId ?? `unknown-${basename(row.sourceFile)}` : format === "hybrid-workflow" ? row.workflowId ?? basename(row.sourceFile).replace(/\.jsonl$/, "") : basename(row.sourceFile).replace(/\.jsonl$/, "");
    const key = `${format}\0${row.sourceFile}\0${runId}`;
    if (!groups.has(key)) groups.set(key, { format, runId, source: row.sourceFile, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}

function summarizeGroup(group) {
  if (group.format === "observability") return summarizeObservability(String(group.runId), group.rows, group.source);
  if (group.format === "pi-session") return summarizePiSession(group.rows, group.source);
  if (group.format === "hybrid-workflow") return summarizeHybridWorkflow(group.rows, group.source);
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

function formatCost(value) {
  return `$${value}`;
}

function hybridWorkflowResults(traces) {
  return traces.filter((trace) => trace.format === "hybrid-workflow").map((trace) => ({
    workflowId: trace.workflow.workflowId,
    traceId: trace.traceId,
    scenarioId: trace.workflow.scenarioId,
    source: trace.source,
    provenance: trace.provenance,
    nodeCount: trace.graph.nodeCount,
    activeBoundaryNodeId: trace.graph.activeBoundaryNodeId,
    tier1BaselineTatMs: trace.tier1BaselineTatMs,
    policyResultCount: trace.policyResults?.length ?? 0,
    policyResults: (trace.policyResults ?? []).map((result) => result.policyId),
  }));
}

function hybridPolicyResults(traces) {
  return traces
    .filter((trace) => trace.format === "hybrid-workflow")
    .flatMap((trace) => (trace.policyResults ?? []).map((result) => ({
      workflowId: trace.workflow.workflowId,
      traceId: trace.traceId,
      scenarioId: trace.workflow.scenarioId,
      source: trace.source,
      sourceType: trace.provenance.sourceType,
      policyId: result.policyId,
      tier1BaselineTatMs: result.tier1BaselineTatMs,
      optimizedActiveTatMs: result.optimizedActiveTatMs,
      activeTatRatio: result.activeTatRatio,
      backgroundCompletionMs: result.backgroundCompletionMs,
      criticalPathMs: result.criticalPathMs,
      tier1CallCount: result.tier1CallCount,
      tier2CallCount: result.tier2CallCount,
      tier2Concurrency: result.tier2Concurrency,
      tier2ConcurrencyCap: result.tier2ConcurrencyCap,
      deadlineMissCount: result.deadlineMissCount,
      lateResultCount: result.lateResultCount,
      acceptedResultCount: result.acceptedResultCount,
      validationFailureCount: result.validationFailureCount,
      fallbackToTier1Count: result.fallbackToTier1Count,
      costTotal: result.costTotal,
      costSavedVsTier1: result.costSavedVsTier1,
      wastedSpeculativeCost: result.wastedSpeculativeCost,
      budgetUsd: result.budgetUsd,
      budgetExceeded: result.budgetExceeded,
      targetStatus: result.targetStatus,
      infeasibleReason: result.infeasibleReason || null,
      targetRationale: result.targetRationale,
      activeNodeIds: result.activeNodeIds,
      backgroundNodeIds: result.backgroundNodeIds,
      acceptedNodeIds: result.acceptedNodeIds,
      lateNodeIds: result.lateNodeIds,
      rejectedNodeIds: result.rejectedNodeIds,
      schedule: result.schedule,
      portfolio: result.portfolio,
    })));
}

function inputFileSummaries(files, traces) {
  return files.map((file) => {
    const fileTraces = traces.filter((trace) => trace.source === file);
    return {
      path: file,
      traceCount: fileTraces.length,
      formats: [...new Set(fileTraces.map((trace) => trace.format))].sort(),
      workflowIds: fileTraces.filter((trace) => trace.format === "hybrid-workflow").map((trace) => trace.workflow.workflowId).sort(),
    };
  });
}

function validateHybridMetricInvariants(summary) {
  const allowedStatuses = new Set(["pass", "fail", "infeasible"]);
  const numericFields = [
    "tier1BaselineTatMs",
    "optimizedActiveTatMs",
    "backgroundCompletionMs",
    "criticalPathMs",
    "tier1CallCount",
    "tier2CallCount",
    "tier2Concurrency",
    "tier2ConcurrencyCap",
    "deadlineMissCount",
    "lateResultCount",
    "acceptedResultCount",
    "validationFailureCount",
    "fallbackToTier1Count",
    "costTotal",
    "costSavedVsTier1",
    "wastedSpeculativeCost",
  ];
  const integerFields = [
    "tier1CallCount",
    "tier2CallCount",
    "tier2Concurrency",
    "tier2ConcurrencyCap",
    "deadlineMissCount",
    "lateResultCount",
    "acceptedResultCount",
    "validationFailureCount",
    "fallbackToTier1Count",
  ];

  for (const result of summary.policyResults) {
    for (const field of numericFields) {
      if (typeof result[field] !== "number" || !Number.isFinite(result[field])) throw new Error(`hybrid metric invariant failed for ${result.workflowId}/${result.policyId}: ${field} must be finite`);
    }
    for (const field of integerFields) {
      if (!Number.isInteger(result[field]) || result[field] < 0) throw new Error(`hybrid metric invariant failed for ${result.workflowId}/${result.policyId}: ${field} must be a non-negative integer`);
    }
    if (result.tier1BaselineTatMs < 0 || result.optimizedActiveTatMs < 0 || result.backgroundCompletionMs < 0 || result.criticalPathMs < 0 || result.costTotal < 0 || result.wastedSpeculativeCost < 0) {
      throw new Error(`hybrid metric invariant failed for ${result.workflowId}/${result.policyId}: durations and costs must be non-negative`);
    }
    if (result.backgroundCompletionMs < result.optimizedActiveTatMs) throw new Error(`hybrid metric invariant failed for ${result.workflowId}/${result.policyId}: background completion precedes active TAT`);
    const expectedRatio = result.tier1BaselineTatMs > 0 ? round(result.optimizedActiveTatMs / result.tier1BaselineTatMs) : null;
    if (result.activeTatRatio !== expectedRatio) throw new Error(`hybrid metric invariant failed for ${result.workflowId}/${result.policyId}: active ratio mismatch`);
    if (result.wastedSpeculativeCost > result.costTotal) throw new Error(`hybrid metric invariant failed for ${result.workflowId}/${result.policyId}: speculative waste exceeds total cost`);
    if (!allowedStatuses.has(result.targetStatus)) throw new Error(`hybrid metric invariant failed for ${result.workflowId}/${result.policyId}: unsupported target status ${result.targetStatus}`);
    if (result.targetStatus !== "pass" && !result.infeasibleReason) throw new Error(`hybrid metric invariant failed for ${result.workflowId}/${result.policyId}: non-pass result requires a reason`);
    for (const item of result.schedule) {
      for (const field of ["startMs", "endMs", "durationMs"]) {
        if (typeof item[field] !== "number" || !Number.isFinite(item[field]) || item[field] < 0) throw new Error(`hybrid schedule invariant failed for ${result.workflowId}/${result.policyId}/${item.nodeId}: ${field} must be non-negative finite`);
      }
      if (item.endMs < item.startMs) throw new Error(`hybrid schedule invariant failed for ${result.workflowId}/${result.policyId}/${item.nodeId}: end before start`);
    }
  }
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

  const hybridTraces = summary.traces.filter((trace) => trace.format === "hybrid-workflow");
  if (hybridTraces.length) {
    lines.push(
      "",
      "## Hybrid workflow fixtures",
      "",
      "Synthetic hybrid workflow inputs are fixture assumptions, not observed trace evidence.",
      "",
      "| Workflow | Scenario | Source type | Nodes | Edges | Active nodes | Background nodes | Critical path | Active boundary | Metadata |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    );
    for (const trace of hybridTraces) {
      const metadata = [
        trace.nodes.some((node) => node.mandatory === false) ? "optional" : "",
        trace.nodes.some((node) => node.deadlineMs !== null) ? "deadline" : "",
        trace.nodes.some((node) => node.shardId) ? "shard" : "",
        trace.nodes.some((node) => node.branchId) ? "branch" : "",
        trace.nodes.some((node) => node.portfolioGroup) ? "portfolio" : "",
        trace.nodes.some((node) => node.conflictGroup || node.staleOf) ? "conflict/stale" : "",
        trace.nodes.some((node) => node.fallbackTo) ? "fallback" : "",
        trace.nodes.some((node) => node.reviewOf || node.validationOf) ? "review/validation" : "",
      ].filter(Boolean).join(", ") || "none";
      lines.push(`| ${trace.traceId} | ${trace.workflow.scenarioId} | ${trace.provenance.sourceType} | ${trace.graph.nodeCount} | ${trace.graph.edgeCount} | ${trace.graph.activeNodeCount} | ${trace.graph.backgroundNodeCount} | ${formatDuration(trace.graph.criticalPathMs)} | ${trace.graph.activeBoundaryNodeId} | ${metadata} |`);
    }
    lines.push("", `Required scenario coverage: ${summary.hybrid.requiredScenarioCoverage.present.join(", ")}.`);

    lines.push(
      "",
      "## Hybrid policy simulation",
      "",
      "Active user-facing TAT is measured to the declared active boundary and mandatory active acceptance work. Background completion includes launched deferred work, optional late results, and speculative losers.",
      "",
      "| Workflow | Policy | Active TAT | Background completion | Active ratio | Target status | Total cost | Cost saved vs tier1 | Late/deadline | Speculative waste | Reason |",
      "| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |",
    );
    for (const trace of hybridTraces) {
      for (const result of trace.policyResults ?? []) {
        const lateDeadline = `${result.lateResultCount}/${result.deadlineMissCount}`;
        lines.push(`| ${trace.traceId} | ${result.policyId} | ${formatDuration(result.optimizedActiveTatMs)} (${result.optimizedActiveTatMs} ms) | ${formatDuration(result.backgroundCompletionMs)} (${result.backgroundCompletionMs} ms) | ${result.activeTatRatio ?? "n/a"} | ${result.targetStatus} | ${formatCost(result.costTotal)} | ${formatCost(result.costSavedVsTier1)} | ${lateDeadline} | ${formatCost(result.wastedSpeculativeCost)} | ${result.infeasibleReason || result.targetRationale} |`);
      }
    }

    lines.push(
      "",
      "### Hybrid schedule evidence",
      "",
      "Each policy result in `summary.json` includes per-node schedule evidence with dependencies, phase, assigned tier, start/end times, active/background classification, and accepted/late/failed status. The compact lists below show representative active, background, accepted, late, and rejected node ids used by the policy rationale.",
      "",
      "| Workflow | Policy | Active nodes | Background nodes | Accepted nodes | Late nodes | Rejected nodes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const trace of hybridTraces) {
      for (const result of trace.policyResults ?? []) {
        lines.push(`| ${trace.traceId} | ${result.policyId} | ${result.activeNodeIds.join(", ") || "none"} | ${result.backgroundNodeIds.join(", ") || "none"} | ${result.acceptedNodeIds.join(", ") || "none"} | ${result.lateNodeIds.join(", ") || "none"} | ${result.rejectedNodeIds.join(", ") || "none"} |`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
const files = [...new Set(options.paths.flatMap(collectJsonl))];
if (options.explicitPaths && files.length === 0) throw new Error(`no JSONL files found for input: ${options.paths.join(", ")}`);
const rows = files.flatMap(readRows);
if (rows.length === 0) throw new Error(`no events found in JSONL input: ${files.length ? files.join(", ") : options.paths.join(", ")}`);
const traces = groupByTrace(rows)
  .map(summarizeGroup)
  .map((summary) => addComparison(summary, options))
  .map((summary) => addHybridPolicySimulation(summary, options));
const totals = addCombinedComparison(combineSummaries("all", traces, files.length === 1 ? files[0] : `${files.length} files`), traces, options);
const hybridTraces = traces.filter((trace) => trace.format === "hybrid-workflow");
const hybridScenarioIds = [...new Set(hybridTraces.map((trace) => trace.workflow.scenarioId))].sort();
const summary = {
  reportSchema: REPORT_SCHEMA,
  reportVersion: REPORT_VERSION,
  schemaVersion: REPORT_VERSION,
  generatedAt: new Date().toISOString(),
  inputs: options.paths,
  files,
  inputFiles: inputFileSummaries(files, traces),
  traceCount: traces.length,
  workflowCount: hybridTraces.length,
  policyResultCount: sum(hybridTraces.map((trace) => trace.policyResults?.length ?? 0)),
  comparison: { model: options.model, tier2MinMs: options.tier2MinMs, tier2MaxMs: options.tier2MaxMs },
  hybrid: {
    schema: HYBRID_SCHEMA,
    version: HYBRID_VERSION,
    policyMatrix: HYBRID_POLICY_IDS,
    policyResultCount: sum(hybridTraces.map((trace) => trace.policyResults?.length ?? 0)),
    requiredScenarioCoverage: {
      required: REQUIRED_SCENARIOS,
      present: hybridScenarioIds,
      missing: REQUIRED_SCENARIOS.filter((scenario) => !hybridScenarioIds.includes(scenario)),
    },
  },
  workflowResults: hybridWorkflowResults(traces),
  policyResults: hybridPolicyResults(traces),
  totals,
  traces,
};

mkdirSync(options.out, { recursive: true });
validateHybridMetricInvariants(summary);
writeFileSync(join(options.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(options.out, "summary.md"), markdown(summary));
console.log(`wrote ${join(options.out, "summary.json")} and ${join(options.out, "summary.md")} (${traces.length} traces, ${rows.length} events)`);
