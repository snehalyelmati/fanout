import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = "datasets/fixtures/phase6-observability.jsonl";
const piSessionFixture = "datasets/fixtures/pi-session-trace.jsonl";
const hybridFixture = "datasets/fixtures/hybrid-workflows.jsonl";
const hybridOutOfOrderFixture = "datasets/fixtures/hybrid-workflows-out-of-order.jsonl";
const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-bench-"));
const out = join(dir, "phase6");

function fail(message) {
  throw new Error(`${message}\noutput: ${out}`);
}

function run(args, expectedStatus = 0, env = {}) {
  const result = spawnSync(process.execPath, ["scripts/benchmark-traces.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== expectedStatus) {
    throw new Error(`benchmark command expected status ${expectedStatus}, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

try {
  run([fixture, "--out", out]);

  const summaryPath = join(out, "summary.json");
  const markdownPath = join(out, "summary.md");
  if (!existsSync(summaryPath)) fail("summary.json was not written");
  if (!existsSync(markdownPath)) fail("summary.md was not written");

  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const md = readFileSync(markdownPath, "utf8");

  if (summary.traceCount !== 2) fail(`expected 2 traces, got ${summary.traceCount}`);
  if (summary.totals.turnCount !== 2) fail(`expected 2 turns, got ${summary.totals.turnCount}`);
  if (summary.totals.toolCallCount !== 3) fail(`expected 3 tool calls, got ${summary.totals.toolCallCount}`);
  if (summary.totals.provider.calls !== 2) fail(`expected 2 provider calls, got ${summary.totals.provider.calls}`);
  if (summary.totals.async.pollCount !== 2) fail(`expected 2 async polls, got ${summary.totals.async.pollCount}`);
  if (summary.totals.async.pollDurationMs.total !== 200) fail(`expected 200ms async poll time, got ${summary.totals.async.pollDurationMs.total}`);
  if (summary.totals.usage.cost.total <= 0) fail(`expected positive total cost, got ${summary.totals.usage.cost.total}`);
  if (!md.includes("# Phase 6 Trace Benchmark Summary")) fail("summary.md is missing title");

  const mixed = join(dir, "mixed.jsonl");
  writeFileSync(mixed, [
    { runId: "mixed", event: "turn_end", turnIndex: 0, toolCallCount: 2 },
    { runId: "mixed", event: "agent_end", turnCount: 1, toolCallCount: 2 },
    { runId: "mixed", event: "turn_end", turnIndex: 1, toolCallCount: 3 },
    { runId: "mixed", event: "turn_end", turnIndex: 2, toolCallCount: 4 },
  ].map((event) => JSON.stringify(event)).join("\n"));
  const mixedOut = join(dir, "mixed-out");
  run([mixed, "--out", mixedOut]);
  const mixedSummary = JSON.parse(readFileSync(join(mixedOut, "summary.json"), "utf8"));
  if (mixedSummary.totals.turnCount !== 3) fail(`expected mixed totals to include partial turns, got ${mixedSummary.totals.turnCount}`);
  if (mixedSummary.totals.toolCallCount !== 9) fail(`expected mixed totals to include partial tools, got ${mixedSummary.totals.toolCallCount}`);

  const piOut = join(dir, "pi-session-out");
  run([piSessionFixture, "--out", piOut, "--tier2-min-ms", "100", "--tier2-max-ms", "100"]);
  const piSummary = JSON.parse(readFileSync(join(piOut, "summary.json"), "utf8"));
  const piTrace = piSummary.traces[0];
  if (piSummary.traceCount !== 1) fail(`expected one pi-session trace, got ${piSummary.traceCount}`);
  if (piTrace.format !== "pi-session") fail(`expected pi-session format, got ${piTrace.format}`);
  if (piTrace.turnCount !== 2) fail(`expected 2 pi-session turns, got ${piTrace.turnCount}`);
  if (piTrace.toolCallCount !== 1) fail(`expected 1 pi-session tool call, got ${piTrace.toolCallCount}`);
  if (piTrace.usage.input !== 30 || piTrace.usage.cacheRead !== 5 || piTrace.usage.cacheWrite !== 1 || piTrace.usage.output !== 10) fail(`unexpected pi-session usage: ${JSON.stringify(piTrace.usage)}`);
  if (piTrace.comparison.effectiveInput !== 36) fail(`expected 36 effective input tokens, got ${piTrace.comparison.effectiveInput}`);
  if (piTrace.comparison.normalRealtime.cost !== 0.0000944) fail(`unexpected realtime GLM comparison cost: ${piTrace.comparison.normalRealtime.cost}`);
  if (piTrace.comparison.doublewordTier1.cost !== 0.0000944) fail(`unexpected tier1 GLM comparison cost: ${piTrace.comparison.doublewordTier1.cost}`);
  if (piTrace.comparison.doublewordTier2.cost !== 0.0000708) fail(`unexpected tier2 GLM comparison cost: ${piTrace.comparison.doublewordTier2.cost}`);
  if (piTrace.comparison.normalRealtime.durationMs !== 2000) fail(`expected 2000ms pi-session duration proxy, got ${piTrace.comparison.normalRealtime.durationMs}`);
  if (piTrace.comparison.doublewordTier2.durationMs !== 200) fail(`expected 200ms tier2 simulated duration, got ${piTrace.comparison.doublewordTier2.durationMs}`);

  const hybridOut = join(dir, "hybrid-out");
  run([hybridFixture, "--out", hybridOut], 0, { DOUBLEWORD_API_KEY: "", DOUBLEWORD_BASE_URL: "" });
  const hybridSummary = JSON.parse(readFileSync(join(hybridOut, "summary.json"), "utf8"));
  const hybridMd = readFileSync(join(hybridOut, "summary.md"), "utf8");
  const requiredScenarios = [
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
  if (hybridSummary.workflowCount !== 9) fail(`expected 9 hybrid workflows, got ${hybridSummary.workflowCount}`);
  if (hybridSummary.hybrid.requiredScenarioCoverage.missing.length) fail(`missing hybrid scenarios: ${hybridSummary.hybrid.requiredScenarioCoverage.missing.join(", ")}`);
  for (const scenario of requiredScenarios) {
    if (!hybridSummary.hybrid.requiredScenarioCoverage.present.includes(scenario)) fail(`hybrid summary missing scenario ${scenario}`);
    if (!hybridMd.includes(scenario)) fail(`hybrid markdown missing scenario ${scenario}`);
  }
  const wide = hybridSummary.traces.find((trace) => trace.traceId === "hybrid-wide-fanout");
  if (!wide || wide.format !== "hybrid-workflow") fail("wide fanout hybrid workflow was not detected");
  if (wide.provenance.sourceType !== "synthetic" || wide.provenance.synthetic !== true) fail(`hybrid provenance was not preserved: ${JSON.stringify(wide?.provenance)}`);
  if (wide.graph.backgroundNodeCount !== 3) fail(`expected wide fanout background node count 3, got ${wide.graph.backgroundNodeCount}`);
  if (!wide.nodes.some((node) => node.active === "background" && node.mandatory === false && node.deadlineMs === 6000 && node.outcome.late === true)) fail("wide fanout optional deadline metadata was not preserved");
  const branchRace = hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "speculative-branch-race");
  if (!branchRace.nodes.some((node) => node.branchId && node.portfolioGroup)) fail("branch/portfolio metadata was not preserved");
  const conflict = hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "conflict-stale-output");
  if (!conflict.nodes.some((node) => node.conflictGroup && node.staleOf)) fail("conflict/stale metadata was not preserved");
  const fallback = hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "validation-failure-fallback");
  if (!fallback.nodes.some((node) => node.fallbackTo) || !fallback.nodes.some((node) => node.reviewOf || node.validationOf)) fail("fallback/review metadata was not preserved");
  const requiredPolicies = [
    "all_tier1_baseline",
    "all_tier2_blocking",
    "critical_path_slack",
    "deadline_synthesis",
    "rpe_background",
    "sharded_rpe",
    "speculative_portfolio",
    "budget_constrained_routing",
  ];
  const policyFor = (trace, policyId) => trace.policyResults?.find((result) => result.policyId === policyId);
  if (hybridSummary.hybrid.policyResultCount !== hybridSummary.workflowCount * requiredPolicies.length) fail(`unexpected hybrid policy result count ${hybridSummary.hybrid.policyResultCount}`);
  for (const trace of hybridSummary.traces.filter((item) => item.format === "hybrid-workflow")) {
    const policyIds = trace.policyResults?.map((result) => result.policyId) ?? [];
    if (JSON.stringify(policyIds) !== JSON.stringify(requiredPolicies)) fail(`${trace.traceId} emitted unexpected policy matrix ${policyIds.join(",")}`);
    const baseline = policyFor(trace, "all_tier1_baseline");
    if (!baseline || baseline.tier2CallCount !== 0 || baseline.activeTatRatio !== 1 || baseline.tier1BaselineTatMs !== baseline.optimizedActiveTatMs) {
      fail(`${trace.traceId} baseline policy did not establish a tier1 reference`);
    }
    for (const result of trace.policyResults) {
      const expectedRatio = result.tier1BaselineTatMs ? Math.round((result.optimizedActiveTatMs / result.tier1BaselineTatMs) * 1000) / 1000 : null;
      if (result.activeTatRatio !== expectedRatio) fail(`${trace.traceId}/${result.policyId} active ratio ${result.activeTatRatio} did not match ${expectedRatio}`);
      if (result.backgroundCompletionMs < result.optimizedActiveTatMs) fail(`${trace.traceId}/${result.policyId} background completion was less than active TAT`);
      if (result.tier2Concurrency > result.tier2ConcurrencyCap) fail(`${trace.traceId}/${result.policyId} exceeded tier2 concurrency cap`);
      if (result.targetStatus === "pass" && result.optimizedActiveTatMs > result.tier1BaselineTatMs * trace.workflow.targetActiveTatRatio) fail(`${trace.traceId}/${result.policyId} passed while violating the 3x target`);
      if (result.targetStatus !== "pass" && !result.infeasibleReason) fail(`${trace.traceId}/${result.policyId} non-pass result did not include a reason`);
      const byId = new Map(result.schedule.map((node) => [node.nodeId, node]));
      for (const scheduled of result.schedule) {
        for (const dependency of scheduled.dependencies) {
          if (scheduled.startMs < byId.get(dependency).endMs) fail(`${trace.traceId}/${result.policyId}/${scheduled.nodeId} started before dependency ${dependency}`);
        }
        if (scheduled.assignedTier === "tier2" && !scheduled.tierEligibility.includes("tier2")) fail(`${trace.traceId}/${result.policyId}/${scheduled.nodeId} violated tier2 eligibility`);
      }
    }
  }
  const linearTier2 = policyFor(hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "linear-critical-path"), "all_tier2_blocking");
  if (linearTier2.targetStatus !== "infeasible" || !linearTier2.infeasibleReason.includes("linear critical path")) fail(`linear mandatory tier2 path was not marked infeasible: ${JSON.stringify(linearTier2)}`);
  const wideSlack = policyFor(wide, "critical_path_slack");
  if (wideSlack.tier2CallCount !== 3 || wideSlack.optimizedActiveTatMs !== 1500 || wideSlack.backgroundCompletionMs <= wideSlack.optimizedActiveTatMs || wideSlack.deadlineMissCount !== 1) fail(`wide fanout slack policy did not separate active/background timing: ${JSON.stringify(wideSlack)}`);
  const serialRpe = policyFor(hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "serial-rpe"), "rpe_background");
  if (serialRpe.tier2CallCount !== 1 || serialRpe.optimizedActiveTatMs !== 1800 || serialRpe.backgroundCompletionMs !== 9800) fail(`serial RPE background timing unexpected: ${JSON.stringify(serialRpe)}`);
  const sharded = policyFor(hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "sharded-rpe"), "sharded_rpe");
  if (sharded.tier2CallCount !== 2 || sharded.tier2Concurrency !== 2 || sharded.backgroundCompletionMs !== 8100) fail(`sharded RPE did not run independent shards concurrently: ${JSON.stringify(sharded)}`);
  const speculative = policyFor(branchRace, "speculative_portfolio");
  if (speculative.acceptedResultCount < 3 || speculative.lateResultCount !== 1 || speculative.wastedSpeculativeCost <= 0 || speculative.portfolio["portfolio-a"].acceptedBranchId !== "fast") fail(`speculative portfolio evidence unexpected: ${JSON.stringify(speculative)}`);
  const budgetPolicy = policyFor(hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "budget-constrained-routing"), "budget_constrained_routing");
  if (budgetPolicy.targetStatus !== "fail" || !budgetPolicy.budgetExceeded || budgetPolicy.costTotal <= budgetPolicy.budgetUsd) fail(`budget policy did not enforce budget failure: ${JSON.stringify(budgetPolicy)}`);
  const fallbackPolicy = policyFor(fallback, "critical_path_slack");
  if (fallbackPolicy.validationFailureCount !== 1 || fallbackPolicy.fallbackToTier1Count !== 1 || fallbackPolicy.targetStatus !== "pass") fail(`fallback policy did not count validation failure and tier1 fallback: ${JSON.stringify(fallbackPolicy)}`);

  const outOfOrderOut = join(dir, "hybrid-out-of-order");
  run([hybridOutOfOrderFixture, "--out", outOfOrderOut]);
  const outOfOrderTrace = JSON.parse(readFileSync(join(outOfOrderOut, "summary.json"), "utf8")).traces[0];
  const orderedIds = outOfOrderTrace.nodes.map((node) => node.nodeId).join(",");
  if (orderedIds !== "prompt,research-a,research-b,synthesis") fail(`out-of-order DAG was not normalized topologically: ${orderedIds}`);
  if (outOfOrderTrace.graph.criticalPathMs !== 2400) fail(`unexpected out-of-order critical path: ${outOfOrderTrace.graph.criticalPathMs}`);
  const sortedHybrid = join(dir, "hybrid-sorted-dag.jsonl");
  const sortedRows = readFileSync(hybridOutOfOrderFixture, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .sort((a, b) => {
      const rank = (row) => row.kind === "workflow" ? "0" : `1-${row.nodeId}`;
      return rank(a).localeCompare(rank(b));
    });
  writeFileSync(sortedHybrid, sortedRows.map((row) => JSON.stringify(row)).join("\n"));
  const sortedOut = join(dir, "hybrid-sorted");
  run([sortedHybrid, "--out", sortedOut]);
  const sortedTrace = JSON.parse(readFileSync(join(sortedOut, "summary.json"), "utf8")).traces[0];
  if (JSON.stringify(outOfOrderTrace.graph) !== JSON.stringify(sortedTrace.graph)) fail("out-of-order DAG graph metrics differed from sorted fixture metrics");
  if (JSON.stringify(outOfOrderTrace.nodes.map((node) => node.nodeId)) !== JSON.stringify(sortedTrace.nodes.map((node) => node.nodeId))) fail("out-of-order DAG node order differed from sorted fixture normalization");
  if (JSON.stringify(outOfOrderTrace.policyResults) !== JSON.stringify(sortedTrace.policyResults)) fail("out-of-order DAG policy results differed from sorted fixture normalization");

  const mixedOut2 = join(dir, "mixed-legacy-hybrid");
  run([fixture, piSessionFixture, hybridFixture, "--out", mixedOut2]);
  const mixedLegacyHybrid = JSON.parse(readFileSync(join(mixedOut2, "summary.json"), "utf8"));
  const formats = new Set(mixedLegacyHybrid.traces.map((trace) => trace.format));
  if (!formats.has("observability") || !formats.has("pi-session") || !formats.has("hybrid-workflow")) fail(`mixed run did not preserve formats: ${[...formats].join(", ")}`);
  if (!mixedLegacyHybrid.traces.every((trace) => trace.source)) fail("mixed run did not preserve source paths");

  const invalidJsonl = join(dir, "invalid-json.jsonl");
  writeFileSync(invalidJsonl, "{\"schema\":\"doubleword.hybrid-workflow\"\n");
  const malformed = run([invalidJsonl, "--out", join(dir, "invalid-json-out")], 1);
  if (!malformed.stderr.includes(`${invalidJsonl}:1`) || !malformed.stderr.includes("invalid JSONL")) fail("malformed JSONL error did not include source path, line, and parse reason");

  const validWorkflow = { schema: "doubleword.hybrid-workflow", version: 1, kind: "workflow", workflowId: "invalid", scenarioId: "linear-critical-path", sourceType: "synthetic", targetActiveTatRatio: 3, budgetUsd: 0.1, deadlineOrigin: "workflow-start", tier2Concurrency: 1, activeBoundaryNodeId: "a" };
  const validNode = { schema: "doubleword.hybrid-workflow", version: 1, kind: "node", workflowId: "invalid", nodeId: "a", dependencies: [], phase: "plan", tierEligibility: ["tier1"], userBlocking: true, mandatory: true, durationsMs: { tier1: 1, tier2: 0 }, cost: { inputTokens: 1, outputTokens: 1 }, active: "active" };
  const invalidCases = [
    { name: "missing-field", rows: [validWorkflow, { ...validNode, nodeId: undefined }], expect: "field nodeId" },
    { name: "unsupported-version", rows: [{ ...validWorkflow, version: 99 }, validNode], expect: "field version" },
    { name: "node-less", rows: [validWorkflow], expect: "field nodes" },
    { name: "unknown-kind", rows: [{ ...validWorkflow, kind: "metadata" }], expect: "field kind" },
    { name: "duplicate-node", rows: [validWorkflow, validNode, validNode], expect: "duplicate node id" },
    { name: "self-dependency", rows: [validWorkflow, { ...validNode, dependencies: ["a"] }], expect: "self dependency" },
    { name: "missing-dependency", rows: [validWorkflow, { ...validNode, dependencies: ["missing"] }], expect: "missing dependency" },
    { name: "cycle", rows: [validWorkflow, { ...validNode, nodeId: "a", dependencies: ["b"] }, { ...validNode, nodeId: "b", dependencies: ["a"] }], expect: "dependency cycle" },
    { name: "cross-workflow", rows: [validWorkflow, { ...validNode, dependencies: ["other:a"] }], expect: "cross-workflow dependency" },
  ];
  for (const item of invalidCases) {
    const file = join(dir, `${item.name}.jsonl`);
    writeFileSync(file, item.rows.map((row) => JSON.stringify(row)).join("\n"));
    const result = run([file, "--out", join(dir, `${item.name}-out`)], 1);
    if (!result.stderr.includes(file) || !result.stderr.includes("workflow invalid") || !result.stderr.includes(item.expect)) {
      fail(`${item.name} diagnostic was not source-aware and field-specific:\n${result.stderr}`);
    }
  }

  const noJsonl = run([join(dir, "missing"), "--out", join(dir, "missing-out")], 1);
  if (!noJsonl.stderr.includes("no JSONL files found")) fail("missing input did not fail with no JSONL message");
  const emptyJsonl = join(dir, "empty.jsonl");
  writeFileSync(emptyJsonl, "");
  const empty = run([emptyJsonl, "--out", join(dir, "empty-out")], 1);
  if (!empty.stderr.includes("no events found")) fail("empty JSONL did not fail with no events message");

  console.log(`benchmark smoke passed (${summary.traceCount} traces, ${summary.totals.turnCount} turns)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`benchmark output: ${out}`);
  process.exit(1);
}
