import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = "datasets/fixtures/phase6-observability.jsonl";
const piSessionFixture = "datasets/fixtures/pi-session-trace.jsonl";
const piMonoSampleFixture = "datasets/traces/pi-mono-sample/2026-01-16T11-12-35-796Z_105b45a9-be31-4997-95c3-c95ab814daf8.jsonl";
const hybridFixture = "datasets/fixtures/hybrid-workflows.jsonl";
const hybridOutOfOrderFixture = "datasets/fixtures/hybrid-workflows-out-of-order.jsonl";
const safeWorkUnitPredictions = "datasets/fixtures/safe-work-unit-predictions.jsonl";
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

function runSafeEval(args, expectedStatus = 0, env = {}) {
  const result = spawnSync(process.execPath, ["scripts/eval-safe-work-units.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== expectedStatus) {
    throw new Error(`safe work unit eval expected status ${expectedStatus}, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function normalizeReport(report) {
  return JSON.stringify({
    ...report,
    generatedAt: "<generated>",
    inputs: report.inputs.map(() => "<input>"),
    files: report.files.map(() => "<file>"),
    inputFiles: report.inputFiles.map((file) => ({ ...file, path: "<file>" })),
    workflowResults: report.workflowResults.map((workflow) => ({ ...workflow, source: "<file>" })),
    policyResults: report.policyResults.map((policy) => ({ ...policy, source: "<file>" })),
    traces: report.traces.map((trace) => ({ ...trace, source: "<file>" })),
    totals: { ...report.totals, source: "<file>" },
  }, null, 2);
}

function requireFiniteMetric(result, field) {
  if (typeof result[field] !== "number" || !Number.isFinite(result[field])) fail(`${result.workflowId}/${result.policyId} ${field} was not finite`);
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
  run([hybridFixture, "--out", hybridOut], 0, { DOUBLEWORD_API_KEY: "placeholder-offline-key", DOUBLEWORD_BASE_URL: "https://example.invalid/doubleword" });
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
  if (hybridSummary.workflowCount !== 11) fail(`expected 11 hybrid workflows, got ${hybridSummary.workflowCount}`);
  if (hybridSummary.reportSchema !== "doubleword.benchmark-summary" || hybridSummary.reportVersion !== 1 || hybridSummary.schemaVersion !== 1) fail("hybrid report was missing stable top-level schema fields");
  if (!Array.isArray(hybridSummary.inputFiles) || hybridSummary.inputFiles.length !== 1 || !hybridSummary.inputFiles[0].formats.includes("hybrid-workflow")) fail("hybrid report was missing input file provenance");
  if (hybridSummary.policyResultCount !== hybridSummary.hybrid.policyResultCount) fail("top-level policy result count did not match hybrid count");
  if (hybridSummary.workflowResults.length !== hybridSummary.workflowCount) fail("top-level workflow results did not include every workflow");
  if (hybridSummary.policyResults.length !== hybridSummary.policyResultCount) fail("top-level policy results did not include every policy");
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
      for (const field of ["tier1BaselineTatMs", "optimizedActiveTatMs", "backgroundCompletionMs", "criticalPathMs", "tier1CallCount", "tier2CallCount", "tier2Concurrency", "deadlineMissCount", "lateResultCount", "acceptedResultCount", "validationFailureCount", "fallbackToTier1Count", "costTotal", "costSavedVsTier1", "wastedSpeculativeCost"]) {
        requireFiniteMetric({ ...result, workflowId: trace.workflow.workflowId }, field);
      }
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
  if (!hybridMd.includes(`| ${wide.traceId} | critical_path_slack | 1.5s (${wideSlack.optimizedActiveTatMs} ms) | 7.5s (${wideSlack.backgroundCompletionMs} ms) | ${wideSlack.activeTatRatio} | ${wideSlack.targetStatus} | $${wideSlack.costTotal} | $${wideSlack.costSavedVsTier1} | ${wideSlack.lateResultCount}/${wideSlack.deadlineMissCount} | $${wideSlack.wastedSpeculativeCost} |`)) {
    fail("hybrid markdown did not agree with representative wide fanout JSON values");
  }
  if (!hybridMd.includes("### Hybrid schedule evidence") || !hybridMd.includes(wideSlack.activeNodeIds.join(", "))) fail("hybrid markdown was missing schedule evidence");
  const serialRpe = policyFor(hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "serial-rpe"), "rpe_background");
  if (serialRpe.tier2CallCount !== 1 || serialRpe.optimizedActiveTatMs !== 1800 || serialRpe.backgroundCompletionMs !== 9800) fail(`serial RPE background timing unexpected: ${JSON.stringify(serialRpe)}`);
  const sharded = policyFor(hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "sharded-rpe"), "sharded_rpe");
  if (sharded.tier2CallCount !== 2 || sharded.tier2Concurrency !== 2 || sharded.backgroundCompletionMs !== 8100) fail(`sharded RPE did not run independent shards concurrently: ${JSON.stringify(sharded)}`);
  const speculative = policyFor(branchRace, "speculative_portfolio");
  if (speculative.acceptedResultCount < 3 || speculative.lateResultCount !== 1 || speculative.wastedSpeculativeCost <= 0 || speculative.portfolio["portfolio-a"].acceptedBranchId !== "fast") fail(`speculative portfolio evidence unexpected: ${JSON.stringify(speculative)}`);
  const invalidFastestTrace = hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "speculative-invalid-fastest-branch");
  const invalidFastestPolicy = policyFor(invalidFastestTrace, "speculative_portfolio");
  const invalidFastestPortfolio = invalidFastestPolicy.portfolio["portfolio-invalid-fastest"];
  if (invalidFastestPolicy.targetStatus !== "pass" || invalidFastestPortfolio.acceptedBranchId !== "valid-slower" || !invalidFastestPortfolio.rejectedNodeIds.includes("branch-invalid-fast") || !invalidFastestPortfolio.rejectedNodeIds.includes("branch-stale-slowest") || invalidFastestPolicy.validationFailureCount !== 1 || invalidFastestPolicy.wastedSpeculativeCost <= 0) {
    fail(`invalid fastest speculative branch was not rejected before accepting the next valid branch: ${JSON.stringify(invalidFastestPolicy)}`);
  }
  const structuralLinear = policyFor(hybridSummary.traces.find((trace) => trace.workflow.scenarioId === "renamed-mandatory-critical-path"), "all_tier2_blocking");
  if (structuralLinear.targetStatus !== "infeasible" || !structuralLinear.infeasibleReason.includes("linear critical path")) fail(`structural mandatory tier2 path was not marked infeasible: ${JSON.stringify(structuralLinear)}`);
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
  if (!mixedLegacyHybrid.inputFiles.some((file) => file.formats.includes("observability")) || !mixedLegacyHybrid.inputFiles.some((file) => file.formats.includes("pi-session")) || !mixedLegacyHybrid.inputFiles.some((file) => file.formats.includes("hybrid-workflow"))) fail("mixed run input file provenance did not preserve formats");

  const deterministicOutA = join(dir, "deterministic-a");
  const deterministicOutB = join(dir, "deterministic-b");
  run([hybridFixture, "--out", deterministicOutA]);
  run([hybridFixture, "--out", deterministicOutB]);
  const deterministicA = JSON.parse(readFileSync(join(deterministicOutA, "summary.json"), "utf8"));
  const deterministicB = JSON.parse(readFileSync(join(deterministicOutB, "summary.json"), "utf8"));
  if (normalizeReport(deterministicA) !== normalizeReport(deterministicB)) fail("hybrid repeated runs differed after normalizing timestamps and paths");
  const deterministicMdA = readFileSync(join(deterministicOutA, "summary.md"), "utf8").replace(/^Generated: .+$/m, "Generated: <generated>");
  const deterministicMdB = readFileSync(join(deterministicOutB, "summary.md"), "utf8").replace(/^Generated: .+$/m, "Generated: <generated>");
  if (deterministicMdA !== deterministicMdB) fail("hybrid markdown repeated runs differed after normalizing timestamps");

  const invalidJsonl = join(dir, "invalid-json.jsonl");
  writeFileSync(invalidJsonl, "{\"schema\":\"doubleword.hybrid-workflow\"\n");
  const malformed = run([invalidJsonl, "--out", join(dir, "invalid-json-out")], 1);
  if (!malformed.stderr.includes(`${invalidJsonl}:1`) || !malformed.stderr.includes("invalid JSONL")) fail("malformed JSONL error did not include source path, line, and parse reason");

  const validWorkflow = { schema: "doubleword.hybrid-workflow", version: 1, kind: "workflow", workflowId: "invalid", scenarioId: "linear-critical-path", sourceType: "synthetic", targetActiveTatRatio: 3, budgetUsd: 0.1, deadlineOrigin: "workflow-start", tier2Concurrency: 1, activeBoundaryNodeId: "a" };
  const validNode = { schema: "doubleword.hybrid-workflow", version: 1, kind: "node", workflowId: "invalid", nodeId: "a", dependencies: [], phase: "plan", tierEligibility: ["tier1"], userBlocking: true, mandatory: true, durationsMs: { tier1: 1, tier2: 0 }, cost: { inputTokens: 1, outputTokens: 1 }, active: "active" };
  const invalidCases = [
    { name: "missing-field", rows: [validWorkflow, { ...validNode, nodeId: undefined }], expect: "field nodeId" },
    { name: "empty-tier-eligibility", rows: [validWorkflow, { ...validNode, tierEligibility: [] }], expect: "field tierEligibility", expectLine: 2, expectNode: "node a" },
    { name: "malformed-workflow-metadata", rows: [{ ...validWorkflow, metadata: "not-an-object" }, validNode], expect: "field metadata", expectLine: 1 },
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
    const expectedLine = item.expectLine ? `${file}:${item.expectLine}` : file;
    if (!result.stderr.includes(expectedLine) || !result.stderr.includes("workflow invalid") || !result.stderr.includes(item.expect) || (item.expectNode && !result.stderr.includes(item.expectNode))) {
      fail(`${item.name} diagnostic was not source-aware and field-specific:\n${result.stderr}`);
    }
  }

  const safeEvalOut = join(dir, "safe-work-unit-eval");
  runSafeEval([piMonoSampleFixture, "--predictions", safeWorkUnitPredictions, "--out", safeEvalOut], 0, {
    DOUBLEWORD_API_KEY: "placeholder-offline-key",
    DOUBLEWORD_BASE_URL: "https://example.invalid/doubleword",
  });
  const safeEvalSummary = JSON.parse(readFileSync(join(safeEvalOut, "summary.json"), "utf8"));
  const safeEvalMd = readFileSync(join(safeEvalOut, "summary.md"), "utf8");
  if (safeEvalSummary.reportSchema !== "doubleword.safe-work-unit-eval" || safeEvalSummary.reportVersion !== 1 || safeEvalSummary.offline !== true || safeEvalSummary.deterministic !== true) fail("safe work unit report missing stable offline metadata");
  if (!safeEvalSummary.evidenceScope.includes("retrospective_trace_derived") || !safeEvalMd.includes("does not prove live runtime TAT improvement")) fail("safe work unit report did not scope evidence as retrospective reliability");
  if (safeEvalSummary.traceCount !== 1 || safeEvalSummary.predictionCount !== 1) fail(`unexpected safe eval input counts: ${JSON.stringify({ traceCount: safeEvalSummary.traceCount, predictionCount: safeEvalSummary.predictionCount })}`);
  const safeEval = safeEvalSummary.evaluations[0];
  if (safeEval.traceId !== "105b45a9-be31-4997-95c3-c95ab814daf8" || safeEval.prefixBoundary.line !== 5 || safeEval.prefixContext.rowCount !== 5 || safeEval.suffixEvidence.rowCount <= 0) fail(`safe eval did not separate prefix/suffix evidence: ${JSON.stringify(safeEval?.prefixBoundary)}`);
  if (safeEval.predictionSource !== safeWorkUnitPredictions || safeEval.retrospectiveEvidenceSource !== piMonoSampleFixture) fail("safe eval did not preserve prediction and evidence sources");
  const unitById = new Map(safeEval.unitResults.map((unit) => [unit.unitId, unit]));
  const expectedVerdicts = {
    "safe-doc-note": "safe_independent",
    "shared-package-a": "safe_after_dependency",
    "shared-package-b": "safe_after_dependency",
    "hidden-file-dependency": "unsafe",
    "missing-validation-review": "unsafe",
    "wrong-active-boundary": "unsafe",
    "speculative-stale-no-cancel": "unsafe",
    "unknown-surface": "inconclusive",
  };
  for (const [unitId, verdict] of Object.entries(expectedVerdicts)) {
    if (unitById.get(unitId)?.verdict !== verdict) fail(`expected ${unitId} verdict ${verdict}, got ${JSON.stringify(unitById.get(unitId))}`);
  }
  const reasonChecks = {
    "shared-package-a": "ownership_overlap_with_declared_dependency",
    "hidden-file-dependency": "hidden_suffix_dependency",
    "missing-validation-review": "missing_validation",
    "wrong-active-boundary": "active_boundary_mistake",
    "speculative-stale-no-cancel": "missing_cancellation_rule",
    "unknown-surface": "insufficient_evidence",
  };
  for (const [unitId, reason] of Object.entries(reasonChecks)) {
    if (!unitById.get(unitId)?.reasons.some((item) => item.code === reason)) fail(`expected ${unitId} reason ${reason}, got ${JSON.stringify(unitById.get(unitId)?.reasons)}`);
  }
  if (safeEvalSummary.metrics.primaryMetric !== "safetyPrecision" || safeEvalSummary.metrics.safetyPrecision !== 1 || safeEvalSummary.metrics.unsafeFalsePositiveCount !== 0 || safeEvalSummary.metrics.recall !== 1) fail(`safe eval primary metrics unexpected: ${JSON.stringify(safeEvalSummary.metrics)}`);
  for (const verdict of ["safe_independent", "safe_after_dependency", "unsafe", "inconclusive"]) {
    if (!safeEvalMd.includes(verdict)) fail(`safe eval markdown missing verdict ${verdict}`);
  }
  const safeEvalUnlabeledPredictions = join(dir, "safe-work-unit-unlabeled.jsonl");
  const unlabeledRow = JSON.parse(readFileSync(safeWorkUnitPredictions, "utf8").trim());
  unlabeledRow.proposedUnits = unlabeledRow.proposedUnits.map(({ label, ...unit }) => unit);
  writeFileSync(safeEvalUnlabeledPredictions, `${JSON.stringify(unlabeledRow)}\n`);
  const safeEvalUnlabeledOut = join(dir, "safe-work-unit-unlabeled-out");
  runSafeEval([piMonoSampleFixture, "--predictions", safeEvalUnlabeledPredictions, "--out", safeEvalUnlabeledOut]);
  const safeEvalUnlabeled = JSON.parse(readFileSync(join(safeEvalUnlabeledOut, "summary.json"), "utf8"));
  if (safeEvalUnlabeled.metrics.recallAvailable !== false || safeEvalUnlabeled.metrics.recall !== null || !readFileSync(join(safeEvalUnlabeledOut, "summary.md"), "utf8").includes("| Recall | unavailable |")) fail("unlabeled safe eval did not mark recall unavailable");
  const safeEvalOutB = join(dir, "safe-work-unit-eval-b");
  runSafeEval([piMonoSampleFixture, "--predictions", safeWorkUnitPredictions, "--out", safeEvalOutB]);
  const normalizedSafeA = JSON.stringify({
    ...safeEvalSummary,
    traceInputs: ["<trace>"],
    predictionInput: "<prediction>",
    evaluations: safeEvalSummary.evaluations.map((evaluation) => ({ ...evaluation, predictionSource: "<prediction>", retrospectiveEvidenceSource: "<trace>" })),
  }, null, 2);
  const safeEvalSummaryB = JSON.parse(readFileSync(join(safeEvalOutB, "summary.json"), "utf8"));
  const normalizedSafeB = JSON.stringify({
    ...safeEvalSummaryB,
    traceInputs: ["<trace>"],
    predictionInput: "<prediction>",
    evaluations: safeEvalSummaryB.evaluations.map((evaluation) => ({ ...evaluation, predictionSource: "<prediction>", retrospectiveEvidenceSource: "<trace>" })),
  }, null, 2);
  if (normalizedSafeA !== normalizedSafeB) fail("safe work unit eval repeated runs differed after normalizing paths");
  const invalidSafePredictions = join(dir, "invalid-safe-work-unit.jsonl");
  writeFileSync(invalidSafePredictions, `${JSON.stringify({ ...unlabeledRow, proposedUnits: [{ ...unlabeledRow.proposedUnits[0], ownedFiles: "README.md" }] })}\n`);
  const invalidSafe = runSafeEval([piMonoSampleFixture, "--predictions", invalidSafePredictions, "--out", join(dir, "invalid-safe-out")], 1);
  if (!invalidSafe.stderr.includes(`${invalidSafePredictions}:1`) || !invalidSafe.stderr.includes("trace 105b45a9-be31-4997-95c3-c95ab814daf8") || !invalidSafe.stderr.includes("unit safe-doc-note") || !invalidSafe.stderr.includes("field ownedFiles")) fail(`safe work unit invalid artifact diagnostic was not source-aware:\n${invalidSafe.stderr}`);

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
