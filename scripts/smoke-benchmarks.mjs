import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = "datasets/fixtures/phase6-observability.jsonl";
const piSessionFixture = "datasets/fixtures/pi-session-trace.jsonl";
const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-bench-"));
const out = join(dir, "phase6");

function fail(message) {
  throw new Error(`${message}\noutput: ${out}`);
}

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/benchmark-traces.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
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
