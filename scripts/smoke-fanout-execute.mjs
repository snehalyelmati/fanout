import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadActiveExecutionPacket } from "../packages/fanout-core/src/active-packet.ts";
import { runDag } from "../packages/fanout-core/src/dag-scheduler.ts";
import { compileExecutionPacket } from "../packages/fanout-core/src/fanout-compiler.ts";
import {
  EXECUTION_PACKET_SCHEMA,
  EXECUTION_PACKET_VERSION,
  buildExecutionGraph,
  writeExecutionPacketArtifacts,
} from "../packages/fanout-core/src/execution-packet.ts";
import { validateWorkerMetrics } from "../packages/fanout-core/src/execution-run.ts";
import { createExecutionRecorder } from "../packages/fanout-pi/src/execution-recorder.ts";
import { executeFanout } from "../packages/fanout-pi/src/fanout-execute.ts";
import { artifactSegment, capturePatch, checkOwnership, createAttemptWorktree, runProcess } from "../packages/fanout-pi/src/fanout-git.ts";
import { createFanoutNodeExecutor } from "../packages/fanout-pi/src/fanout-node-executor.ts";
import { processStageFact } from "../packages/fanout-pi/src/attempt-evidence.ts";
import { buildWorkerPrompt, importWorkerMetrics } from "../packages/fanout-pi/src/fanout-worker-contract.ts";

const root = mkdtempSync(join(tmpdir(), "fanout-execute-smoke-"));
const repos = [];

try {
  testActivePacketLoader();
  testStrictMetrics();
  testMetricImporter();
  testProviderFailureCorrelation();
  await testScheduler();
  testRecorder();
  testWorkerPrompt();
  await testProcessTimeout();
  testGitPatchGate();
  await testArtifactRootGuard();
  await testDirtyWorktreeGuard();
  await testCompiledPacketExecution();
  await testEndToEnd();
  await testRetryAndRecovery();
  await testPostApplyRollback();
  console.log("fanout execute smoke passed");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const repo of repos.reverse()) cleanupWorktrees(repo);
  rmSync(root, { recursive: true, force: true });
}

function testActivePacketLoader() {
  const projectRoot = join(root, "loader", "project");
  const packetDir = join(projectRoot, "packet");
  const activePath = join(projectRoot, "active-packet.json");
  const packet = makePacket([makeUnit("loader")], packetDir);
  const paths = writeExecutionPacketArtifacts(packet, packetDir, { activePointerPath: activePath });
  const loaded = loadActiveExecutionPacket(activePath, projectRoot);
  assert(comparablePath(loaded.packetPath) === comparablePath(paths.packetPath), "active loader did not return the accepted packet");

  const malformedPath = join(projectRoot, "malformed-pointer.json");
  writeJson(malformedPath, { schema: "fanout.active-packet", version: 1, updatedAt: "", packetPath: "" });
  expectThrows(() => loadActiveExecutionPacket(malformedPath, projectRoot), /invalid active packet pointer/, "malformed pointer");

  const outsidePath = join(projectRoot, "outside-pointer.json");
  writeJson(outsidePath, {
    schema: "fanout.active-packet",
    version: 1,
    updatedAt: "2026-07-09T00:00:00.000Z",
    packetPath: join(root, "outside", "execution-packet.json"),
  });
  expectThrows(() => loadActiveExecutionPacket(outsidePath, projectRoot), /must stay under project artifact root/, "outside-root pointer");

  expectThrows(() => loadActiveExecutionPacket(join(projectRoot, "missing-pointer.json"), projectRoot), /failed to read active packet pointer/, "missing pointer");
  const symlinkTarget = join(root, "loader", "outside-packet.json");
  writeJson(symlinkTarget, packet);
  const symlinkPacketPath = join(projectRoot, "linked-packet.json");
  symlinkSync(symlinkTarget, symlinkPacketPath);
  const symlinkPointer = join(projectRoot, "symlink-pointer.json");
  writeJson(symlinkPointer, { schema: "fanout.active-packet", version: 1, updatedAt: "2026-07-09T00:00:00.000Z", packetPath: symlinkPacketPath });
  expectThrows(() => loadActiveExecutionPacket(symlinkPointer, projectRoot), /must stay under project artifact root/, "symlink packet escape");
  const malformedPacketPath = join(projectRoot, "malformed-packet.json");
  writeFileSync(malformedPacketPath, "{not-json\n");
  const malformedPacketPointer = join(projectRoot, "malformed-packet-pointer.json");
  writeJson(malformedPacketPointer, { schema: "fanout.active-packet", version: 1, updatedAt: "2026-07-09T00:00:00.000Z", packetPath: malformedPacketPath });
  expectThrows(() => loadActiveExecutionPacket(malformedPacketPointer, projectRoot), /failed to read active execution packet/, "malformed packet");

  const unsafePacket = makePacket([makeUnit("unsafe-loader")], join(projectRoot, "unsafe"));
  unsafePacket.finalValidationPlan = ["rm -rf ."];
  const unsafePacketPath = join(projectRoot, "unsafe", "execution-packet.json");
  writeJson(unsafePacketPath, unsafePacket);
  const unsafePointer = join(projectRoot, "unsafe-pointer.json");
  writeJson(unsafePointer, { schema: "fanout.active-packet", version: 1, updatedAt: "2026-07-09T00:00:00.000Z", packetPath: unsafePacketPath });
  expectThrows(() => loadActiveExecutionPacket(unsafePointer, projectRoot), /not executable/, "unsafe packet");
}

function testProviderFailureCorrelation() {
  const path = join(root, "provider-failure-correlation.jsonl");
  const processResult = { exitCode: 1, signal: null, timedOut: false, durationMs: 1 };
  writeFileSync(path, `${JSON.stringify({ event: "provider_error", runId: "other", provider: "fake", model: "worker", turnIndex: 0, responseId: "response", failureCode: "retryable-service" })}\n`);
  assert(processStageFact(processResult, path, { runId: "attempt", provider: "fake", model: "worker" }).stage === "process", "uncorrelated provider event authorized routing");
  writeFileSync(path, `${JSON.stringify({ event: "provider_error", runId: "attempt", provider: "fake", model: "worker", turnIndex: 0, responseId: "response", failureCode: "retryable-service" })}\n`);
  const correlated = processStageFact(processResult, path, { runId: "attempt", provider: "fake", model: "worker" });
  assert(correlated.stage === "provider" && correlated.code === "retryable-service", "correlated provider event did not authorize typed routing");
}

function testStrictMetrics() {
  const metrics = workerMetrics();
  for (const field of Object.keys(metrics)) {
    const incomplete = { ...metrics };
    delete incomplete[field];
    const result = validateWorkerMetrics(incomplete);
    assert(!result.ok && result.errors.some((error) => error.includes(field)), `missing worker metric ${field} was accepted`);
  }
}

function testMetricImporter() {
  const dir = join(root, "metric-import");
  mkdirSync(dir, { recursive: true });
  const stdoutPath = join(dir, "stdout.jsonl");
  const observabilityPath = join(dir, "observability.jsonl");
  writeFileSync(stdoutPath, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "fake", model: "worker", usage: { input: 4, output: 2, totalTokens: 6, cost: { total: 0.01 } } } })}\n`);
  writeFileSync(observabilityPath, `${JSON.stringify({ event: "provider_ttft", ttftMs: 3 })}\n`);
  const imported = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier1", workerDurationMs: 8, expectedProvider: "fake", expectedModel: "worker" });
  assert(imported.ok && imported.metrics?.pricingSource === "pi-json-usage", "generic Pi JSON metrics were not imported");

  const missingPolls = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier2", workerDurationMs: 8, expectedProvider: "fake", expectedModel: "worker" });
  assert(!missingPolls.ok && missingPolls.errors.some((error) => error.includes("poll provenance")) && missingPolls.partialMetrics.pollCount === undefined, "tier2 worker without poll provenance was accepted");
  writeFileSync(observabilityPath, [
    { event: "provider_ttft", ttftMs: 3 },
    { event: "provider_end", provider: "fake", model: "worker", pollCount: 0 },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  const explicitZeroPolls = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier2", workerDurationMs: 8, expectedProvider: "fake", expectedModel: "worker" });
  assert(explicitZeroPolls.ok && explicitZeroPolls.metrics?.pollCount === 0 && explicitZeroPolls.metrics.pollDurationMs === 0, "explicit tier2 zero-poll provenance was rejected");
  writeFileSync(observabilityPath, [
    { event: "provider_ttft", ttftMs: 3 },
    { event: "async_poll", provider: "fake", model: "worker", durationMs: 2 },
    { event: "async_poll", provider: "fake", model: "worker", durationMs: 3 },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  const observedPolls = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier2", workerDurationMs: 8, expectedProvider: "fake", expectedModel: "worker" });
  assert(observedPolls.ok && observedPolls.metrics?.pollCount === 2 && observedPolls.metrics.pollDurationMs === 5, "observed tier2 polls were not imported");

  writeFileSync(stdoutPath, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "fake", model: "worker", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }], usage: { input: 4, output: 2, totalTokens: 6, cost: { total: 0.01 } } } })}\n`);
  writeFileSync(observabilityPath, `${JSON.stringify({ event: "provider_ttft", ttftMs: 3 })}\n`);
  const missingToolTiming = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier1", workerDurationMs: 8, expectedProvider: "fake", expectedModel: "worker" });
  assert(!missingToolTiming.ok && missingToolTiming.errors.some((error) => error.includes("tool_end")), "proved tool call without tool timing was accepted");
  assert(missingToolTiming.partialMetrics.toolDurationMs === undefined, "missing tool timing was backfilled as a partial zero");

  const doublewordUsage = { input: 4, output: 2, totalTokens: 6, cost: { total: 0.01 } };
  writeFileSync(stdoutPath, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "doubleword", model: "model", usage: doublewordUsage } })}\n`);
  writeFileSync(observabilityPath, [
    { event: "provider_ttft", ttftMs: 3 },
    { event: "provider_end", provider: "doubleword", model: "model", tier: "realtime", usage: doublewordUsage, usageSource: "estimated", pricingSource: "doubleword-model-metadata" },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  const estimated = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier1", workerDurationMs: 8, expectedProvider: "doubleword", expectedModel: "model" });
  assert(!estimated.ok && estimated.errors.some((error) => error.includes("usageSource")), "estimated Doubleword tokens were accepted");
  assert(estimated.partialMetrics.workerDurationMs === 8 && estimated.partialMetrics.totalTokens === undefined, "known partial metrics retained guessed tokens");

  writeFileSync(observabilityPath, [
    { event: "provider_ttft", ttftMs: 3 },
    { event: "provider_end", provider: "doubleword", model: "model", tier: "realtime", usage: doublewordUsage, usageSource: "provider" },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  const unknownPricing = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier1", workerDurationMs: 8, expectedProvider: "doubleword", expectedModel: "model" });
  assert(!unknownPricing.ok && unknownPricing.errors.some((error) => error.includes("pricingSource")) && unknownPricing.partialMetrics.estimatedCostUsd === undefined, "missing Doubleword price provenance was accepted or counted");

  writeFileSync(observabilityPath, [
    { event: "provider_ttft", ttftMs: 3 },
    { event: "provider_end", provider: "doubleword", model: "model", tier: "realtime", usageSource: "provider", pricingSource: "doubleword-model-metadata" },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  const missingProviderUsage = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier1", workerDurationMs: 8, expectedProvider: "doubleword", expectedModel: "model" });
  assert(!missingProviderUsage.ok && missingProviderUsage.errors.some((error) => error.includes("missing usage")) && missingProviderUsage.partialMetrics.totalTokens === undefined, "Doubleword labels without provider usage were accepted");

  writeFileSync(observabilityPath, [
    { event: "provider_ttft", ttftMs: 3 },
    { event: "provider_end", provider: "doubleword", model: "model", tier: "realtime", usage: doublewordUsage, usageSource: "provider", pricingSource: "doubleword-model-metadata" },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  const mismatchedTier = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier2", workerDurationMs: 8, expectedProvider: "doubleword", expectedModel: "model" });
  assert(!mismatchedTier.ok && mismatchedTier.errors.some((error) => error.includes("tier must be async")), "Doubleword provider tier mismatch was accepted");
  const verifiedDoubleword = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier1", workerDurationMs: 8, expectedProvider: "doubleword", expectedModel: "model" });
  assert(verifiedDoubleword.ok && verifiedDoubleword.metrics?.pricingSource === "doubleword-model-metadata", "provider-reported Doubleword metrics with known pricing were rejected");
  writeFileSync(observabilityPath, [
    { event: "provider_ttft", ttftMs: 3 },
    { event: "provider_end", provider: "doubleword", model: "model", tier: "realtime", usage: { ...doublewordUsage, input: 5 }, usageSource: "provider", pricingSource: "doubleword-model-metadata" },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  const mismatchedUsage = importWorkerMetrics({ stdoutPath, observabilityPath, tier: "tier1", workerDurationMs: 8, expectedProvider: "doubleword", expectedModel: "model" });
  assert(!mismatchedUsage.ok && mismatchedUsage.errors.some((error) => error.includes("does not match assistant usage")) && mismatchedUsage.partialMetrics.totalTokens === undefined && mismatchedUsage.partialMetrics.estimatedCostUsd === undefined, "mismatched Doubleword provider usage was counted");
}

async function testScheduler() {
  const units = [
    makeUnit("a"),
    makeUnit("b", ["a"]),
    makeUnit("c"),
    makeUnit("d"),
  ];
  const packet = makePacket(units, join(root, "scheduler-success"));
  const events = [];
  const timeline = [];
  let running = 0;
  let maximumRunning = 0;
  const delays = { a: 25, b: 5, c: 5, d: 5 };
  const result = await runDag(packet, {
    maxConcurrency: 2,
    recorder: { appendEvent: (event, data = {}) => events.push({ event, ...data }) },
    runNode: async (workUnit) => {
      timeline.push(`start:${workUnit.id}`);
      running++;
      maximumRunning = Math.max(maximumRunning, running);
      await sleep(delays[workUnit.id]);
      running--;
      timeline.push(`finish:${workUnit.id}`);
      return { ok: true };
    },
  });
  assert(result.ok, "successful scheduler packet failed");
  assert(maximumRunning === 2, `scheduler concurrency was ${maximumRunning}, expected 2`);
  assert(timeline.slice(0, 2).join(",") === "start:a,start:c", `ready nodes did not start in packet order: ${timeline.join(",")}`);
  assert(timeline.indexOf("start:b") > timeline.indexOf("finish:a"), "dependent node started before its dependency succeeded");
  assert(events.at(-1)?.event === "scheduler_finished", "scheduler did not record completion");

  const failureUnits = [makeUnit("fail"), makeUnit("dependent", ["fail"]), makeUnit("independent")];
  const calls = [];
  const failure = await runDag(makePacket(failureUnits, join(root, "scheduler-failure")), {
    maxConcurrency: 1,
    recorder: { appendEvent() {} },
    runNode: async (workUnit) => {
      calls.push(workUnit.id);
      return workUnit.id === "fail" ? { ok: false, error: "expected failure" } : { ok: true };
    },
  });
  const states = Object.fromEntries(failure.nodes.map((node) => [node.id, node.status]));
  assert(!failure.ok && states.fail === "failed", "scheduler did not retain the failed node");
  assert(states.dependent === "skipped" && !calls.includes("dependent"), "scheduler executed a failed node's dependent");
  assert(states.independent === "succeeded" && calls.includes("independent"), "scheduler did not continue independent work");

  const failFastCalls = [];
  const failFast = await runDag(makePacket([makeUnit("first"), makeUnit("later")], join(root, "scheduler-fail-fast")), {
    maxConcurrency: 1,
    failFast: true,
    recorder: { appendEvent() {} },
    runNode: async (workUnit) => {
      failFastCalls.push(workUnit.id);
      throw new Error("expected thrown executor failure");
    },
  });
  assert(failFastCalls.join(",") === "first" && failFast.nodes.find((node) => node.id === "later")?.status === "skipped", "fail-fast scheduled work after a thrown node failure");

  let inFlightFinished = false;
  await expectRejects(() => runDag(makePacket([makeUnit("audit-fast"), makeUnit("audit-slow")], join(root, "scheduler-audit-failure")), {
    maxConcurrency: 2,
    recorder: { appendEvent(event) { if (event === "node_succeeded") throw new Error("recorder stopped"); } },
    runNode: async (workUnit) => {
      if (workUnit.id === "audit-slow") {
        await sleep(20);
        inFlightFinished = true;
      }
      return { ok: true };
    },
  }), /recorder stopped/, "scheduler recorder failure");
  assert(inFlightFinished, "scheduler returned before an in-flight worker settled after recorder failure");
}

function testRecorder() {
  const packetDir = join(root, "recorder", "packet");
  mkdirSync(packetDir, { recursive: true });
  const packetPath = join(packetDir, "execution-packet.json");
  writeJson(packetPath, {});
  let tick = 0;
  const recorder = createExecutionRecorder({
    runId: "recorder-smoke",
    packetPath,
    nodeIds: ["node"],
    now: () => new Date(Date.UTC(2026, 6, 9, 0, 0, 0, tick++ * 10)),
  });
  assert(existsSync(recorder.eventsPath) && existsSync(recorder.snapshotPath), "recorder artifacts were not created before execution");
  recorder.appendEvent("execution_start");
  recorder.appendEvent("node_ready", { nodeId: "node" });
  recorder.appendEvent("node_started", { nodeId: "node" });
  recorder.recordAttemptMetrics("node", "failed-attempt", {
    inputTokens: 2,
    outputTokens: 1,
    totalTokens: 3,
    estimatedCostUsd: 0.01,
    workerDurationMs: 4,
    toolDurationMs: 1,
    pollDurationMs: 2,
  });
  recorder.recordAttemptMetrics("node", "accepted-attempt", workerMetrics(), { accepted: true });
  recorder.setPatchStats("node", { filesChanged: 1, insertions: 2, deletions: 1, applyDurationMs: 4 });
  recorder.setValidationStats("node", { commandCount: 1, durationMs: 5, status: "passed" });
  recorder.appendEvent("node_succeeded", { nodeId: "node" });
  recorder.appendEvent("execution_finished", { status: "succeeded" });
  const snapshot = recorder.finish("succeeded");
  assert(snapshot.status === "succeeded" && snapshot.nodes[0].worker?.provider === "fake", "recorder did not accept complete metrics");
  assert(snapshot.totals.inputTokens === 12 && snapshot.totals.totalTokens === 18, "recorder totals omitted failed-attempt usage");
  assert(snapshot.totals.toolDurationMs === 4 && snapshot.totals.pollDurationMs === 6, "recorder timing totals are wrong");
  assert(snapshot.totals.filesChanged === 1 && snapshot.totals.validationDurationMs === 5, "recorder local totals are wrong");
  const recorderSummary = readFileSync(recorder.summaryPath, "utf8");
  assert(existsSync(recorder.summaryPath) && recorderSummary.includes("Fanout Execution Summary"), "recorder summary was not written");
  assert(!recorderSummary.includes("dry run") && recorderSummary.includes("Final validation: not reached"), "default execution summary changed to dry-run semantics");
  const recordedEvents = readJsonl(recorder.eventsPath);
  assert(recordedEvents.some((event) => event.event === "node_succeeded"), "recorder event log is incomplete");
}

function testWorkerPrompt() {
  const unit = makeUnit("prompt", [], ["owned.txt"], ["context.txt"]);
  unit.workerPacket.requiredChanges = ["required change sentinel"];
  unit.workerPacket.forbiddenChanges = ["forbidden sentinel"];
  unit.workerPacket.handoffContext = ["handoff sentinel"];
  unit.validationCommands = ["rtk node validation-sentinel.mjs"];
  unit.acceptanceCriteria = ["acceptance sentinel"];
  const packet = makePacket([unit], join(root, "prompt"), {
    objective: "objective sentinel",
    userContext: ["user-context sentinel"],
    discoveredRepoFacts: ["repo-fact sentinel"],
    stopRules: ["stop-rule sentinel"],
  });
  const prompt = buildWorkerPrompt(packet, unit);
  for (const value of [
    "parent session already received user approval",
    "Do not ask for confirmation",
    "Do not replan, broaden scope",
    "Edit only the owned files",
    "Do not commit",
    "Stop after completing this unit",
    "No main chat history is available",
    "objective sentinel",
    "user-context sentinel",
    "repo-fact sentinel",
    "required change sentinel",
    "forbidden sentinel",
    "handoff sentinel",
    "owned.txt",
    "context.txt",
    "validation-sentinel.mjs",
    "acceptance sentinel",
    "stop-rule sentinel",
  ]) assert(prompt.toLowerCase().includes(value.toLowerCase()), `worker prompt is missing ${value}`);
  assert(prompt === buildWorkerPrompt(packet, unit), "worker prompt is not deterministic");
  assert(!prompt.includes("Narrow recovery context"), "normal worker prompt contains recovery context");
  const recovery = buildWorkerPrompt(packet, unit, { kind: "validation", instructions: ["recovery sentinel"] });
  assert(recovery.includes("Narrow recovery context") && recovery.includes("recovery sentinel"), "worker recovery context was not rendered");
}

async function testProcessTimeout() {
  const marker = join(root, "orphaned-child.txt");
  const childCode = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 500); setInterval(() => {}, 1000);`;
  const parentCode = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: "ignore" }); setInterval(() => {}, 1000);`;
  const result = await runProcess(process.execPath, ["-e", parentCode], { cwd: root, timeoutMs: 50 });
  assert(result.timedOut && result.durationMs >= 1_900, "timed-out process group was not terminated and awaited");
  assert(!existsSync(marker), "timed-out worker left a child process modifying its worktree");

  const backgroundMarker = join(root, "background-child.txt");
  const backgroundChild = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(backgroundMarker)}, "late"), 300);`;
  const backgroundParent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(backgroundChild)}], { stdio: "ignore" }).unref();`;
  const completed = await runProcess(process.execPath, ["-e", backgroundParent], { cwd: root, timeoutMs: 5_000 });
  await sleep(500);
  assert(completed.exitCode === 0 && !existsSync(backgroundMarker), "completed worker left a background child modifying its worktree");
}

function testGitPatchGate() {
  const repo = join(root, "patch-repo");
  repos.push(repo);
  mkdirSync(join(repo, "owned"), { recursive: true });
  writeFileSync(join(repo, "owned", "modified.txt"), "before\n");
  writeFileSync(join(repo, "owned", "staged.txt"), "before\n");
  writeFileSync(join(repo, "owned", "deleted.txt"), "delete me\n");
  writeFileSync(join(repo, "outside.txt"), "outside\n");
  initRepo(repo);

  const attemptDir = join(root, "patch-attempt");
  const worktree = join(attemptDir, "worktree");
  const { baseRef } = createAttemptWorktree(repo, worktree, []);
  writeFileSync(join(worktree, "owned", "modified.txt"), "after\n");
  writeFileSync(join(worktree, "owned", "staged.txt"), "after staged\n");
  git(worktree, ["add", "owned/staged.txt"]);
  writeFileSync(join(worktree, "owned", "new.txt"), "new\n");
  rmSync(join(worktree, "owned", "deleted.txt"));

  const patch = capturePatch(worktree, baseRef, attemptDir);
  assert(
    patch.changedFiles.slice().sort().join(",") === ["owned/deleted.txt", "owned/modified.txt", "owned/new.txt", "owned/staged.txt"].join(","),
    `patch capture missed modified/staged/new/deleted files: ${patch.changedFiles.join(",")}`,
  );
  assert(patch.stats.filesChanged === 4 && patch.patch.includes("owned/new.txt"), "patch capture missed the untracked new file");
  const unit = makeUnit("patch", [], ["owned"]);
  assert(checkOwnership(unit, patch, worktree, baseRef, attemptDir).ok, "owned directory patch was rejected");
  const forbiddenUnit = structuredClone(unit);
  forbiddenUnit.workerPacket.forbiddenChanges = ["Do not change `owned/new.txt`."];
  assert(checkOwnership(forbiddenUnit, patch, worktree, baseRef, attemptDir).violations.some((violation) => violation.file === "packet" && violation.reason.includes("not executable")), "legacy forbidden prose did not fail closed");
  mkdirSync(join(worktree, "owned", "generated"));
  writeFileSync(join(worktree, "owned", "generated", "blocked.txt"), "blocked\n");
  mkdirSync(join(worktree, "owned", "generated files"));
  writeFileSync(join(worktree, "owned", "generated files", "blocked.txt"), "blocked\n");
  mkdirSync(join(worktree, "generated"));
  writeFileSync(join(worktree, "generated", "blocked.txt"), "blocked\n");
  mkdirSync(join(worktree, ".github"));
  writeFileSync(join(worktree, ".github", "blocked.txt"), "blocked\n");
  const directoryPatch = capturePatch(worktree, baseRef, attemptDir);
  const forbiddenDirectoryUnit = makeUnit("forbidden-directories", [], ["owned", "generated/", ".github/"]);
  for (const [constraint, file] of [
    ["Do not change owned/generated/.", "owned/generated/blocked.txt"],
    ["Do not change the owned/generated directory.", "owned/generated/blocked.txt"],
    ["Do not change anything under owned/generated.", "owned/generated/blocked.txt"],
    ["Do not change owned/generated/**.", "owned/generated/blocked.txt"],
    ["Do not change owned/generated files/.", "owned/generated files/blocked.txt"],
    ["Do not change `owned/generated files/**`.", "owned/generated files/blocked.txt"],
    ["Do not change the owned/generated files directory.", "owned/generated files/blocked.txt"],
    ["Do not change generated/.", "generated/blocked.txt"],
    ["Do not change generated directory.", "generated/blocked.txt"],
    ["Do not change anything under generated.", "generated/blocked.txt"],
    ["Do not change .github/.", ".github/blocked.txt"],
  ]) {
    forbiddenDirectoryUnit.workerPacket.forbiddenChanges = [constraint];
    assert(checkOwnership(forbiddenDirectoryUnit, directoryPatch, worktree, baseRef, attemptDir).violations.some((violation) => violation.file === "packet" && violation.reason.includes("not executable")), `legacy forbidden prose affected path authority: ${constraint} (${file})`);
  }
  for (const directory of [join(worktree, "owned", "generated"), join(worktree, "owned", "generated files"), join(worktree, "generated"), join(worktree, ".github")]) rmSync(directory, { recursive: true });

  const hookMarker = join(root, "managed-git-hook-ran.txt");
  const hooksDir = join(repo, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  for (const hook of ["post-checkout", "post-commit", "post-index-change"]) {
    const hookPath = join(hooksDir, hook);
    writeFileSync(hookPath, `#!/bin/sh\nprintf hook > ${JSON.stringify(hookMarker)}\n`);
    chmodSync(hookPath, 0o755);
  }
  const hookAttempt = join(root, "hook-free-attempt");
  const plantedHooks = join(hookAttempt, "empty-hooks");
  mkdirSync(plantedHooks, { recursive: true });
  writeFileSync(join(plantedHooks, "post-index-change"), `#!/bin/sh\nprintf planted > ${JSON.stringify(hookMarker)}\n`);
  chmodSync(join(plantedHooks, "post-index-change"), 0o755);
  const fsmonitorPath = join(root, "patch-fsmonitor");
  writeFileSync(fsmonitorPath, `#!/bin/sh\nprintf fsmonitor > ${JSON.stringify(hookMarker)}\n`);
  chmodSync(fsmonitorPath, 0o755);
  git(repo, ["config", "core.fsmonitor", fsmonitorPath]);
  const hookWorktree = join(hookAttempt, "worktree");
  const hookBaseRef = createAttemptWorktree(repo, hookWorktree, [{ type: "patch", patchPath: patch.patchPath }]).baseRef;
  assert(!existsSync(hookMarker), "managed worktree setup executed repository hooks");
  writeFileSync(join(hookWorktree, "owned", "hook-capture.txt"), "capture\n");
  capturePatch(hookWorktree, hookBaseRef, hookAttempt);
  assert(!existsSync(hookMarker), "patch capture executed repository hooks");
  git(repo, ["config", "--unset", "core.fsmonitor"]);
  for (const hook of ["post-checkout", "post-commit", "post-index-change"]) rmSync(join(hooksDir, hook));

  writeFileSync(join(worktree, "outside.txt"), "violation\n");
  const violatingPatch = capturePatch(worktree, baseRef, attemptDir);
  const ownership = checkOwnership(unit, violatingPatch, worktree, baseRef, attemptDir);
  assert(!ownership.ok && ownership.violations.some((violation) => violation.file === "outside.txt"), "outside-owned-file patch was accepted");

  rmSync(join(worktree, "outside.txt"));
  mkdirSync(join(worktree, "outside.txt"));
  writeFileSync(join(worktree, "outside.txt", "nested.txt"), "ownership widening\n");
  const widenedPatch = capturePatch(worktree, baseRef, attemptDir);
  const exactFileOwnership = checkOwnership(makeUnit("exact", [], ["outside.txt"]), widenedPatch, worktree, baseRef, attemptDir);
  assert(exactFileOwnership.violations.some((violation) => violation.file === "outside.txt/nested.txt"), "worker widened exact-file ownership by replacing it with a directory");

  const renameAttemptDir = join(root, "rename-attempt");
  const renameWorktree = join(renameAttemptDir, "worktree");
  const renameBase = createAttemptWorktree(repo, renameWorktree, []).baseRef;
  git(renameWorktree, ["mv", "outside.txt", "owned/moved.txt"]);
  const renamePatch = capturePatch(renameWorktree, renameBase, renameAttemptDir);
  assert(renamePatch.changedFiles.includes("outside.txt") && renamePatch.changedFiles.includes("owned/moved.txt"), "rename capture omitted its source or destination path");
  const renameOwnership = checkOwnership(makeUnit("rename", [], ["owned"]), renamePatch, renameWorktree, renameBase, renameAttemptDir);
  assert(renameOwnership.violations.some((violation) => violation.file === "outside.txt"), "rename moved an unowned source into owned scope");

  const generatedAttemptDir = join(root, "generated-directory-attempt");
  const generatedWorktree = join(generatedAttemptDir, "worktree");
  const generatedBase = createAttemptWorktree(repo, generatedWorktree, []).baseRef;
  mkdirSync(join(generatedWorktree, "generated"));
  writeFileSync(join(generatedWorktree, "generated", "file.txt"), "generated\n");
  const generatedPatch = capturePatch(generatedWorktree, generatedBase, generatedAttemptDir);
  assert(checkOwnership(makeUnit("generated-directory", [], ["generated/"]), generatedPatch, generatedWorktree, generatedBase, generatedAttemptDir).ok, "explicit new-directory ownership rejected a descendant");
  const generatedExact = checkOwnership(makeUnit("generated-exact", [], ["generated"]), generatedPatch, generatedWorktree, generatedBase, generatedAttemptDir);
  assert(generatedExact.violations.some((violation) => violation.file === "generated/file.txt"), "missing trailing slash widened a new exact-file token into directory ownership");

  const unusualAttemptDir = join(root, "patch-unusual-attempt");
  const unusualWorktree = join(unusualAttemptDir, "worktree");
  const unusualBaseRef = createAttemptWorktree(repo, unusualWorktree, []).baseRef;
  writeFileSync(join(unusualWorktree, "owned\\escape.txt"), "literal backslash\n");
  expectThrows(() => capturePatch(unusualWorktree, unusualBaseRef, unusualAttemptDir), /unsafe observed Git path/, "lossy Git path ownership bypass");

  const spacedAttemptDir = join(root, "patch-spaced-attempt");
  const spacedWorktree = join(spacedAttemptDir, "worktree");
  const spacedBaseRef = createAttemptWorktree(repo, spacedWorktree, []).baseRef;
  writeFileSync(join(spacedWorktree, " owned.txt "), "literal surrounding spaces\n");
  expectThrows(() => capturePatch(spacedWorktree, spacedBaseRef, spacedAttemptDir), /unsafe observed Git path/, "trimmed Git path ownership bypass");
}

async function testArtifactRootGuard() {
  const repo = join(root, "inside-artifacts-repo");
  repos.push(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "extension.ts"), "export default function fanoutSmokeExtension() {}\n");
  initRepo(repo);

  const projectRoot = join(repo, ".fanout-artifacts", "project");
  const packetDir = join(projectRoot, "packet");
  const activePointerPath = join(projectRoot, "active-packet.json");
  writeExecutionPacketArtifacts(makePacket([makeUnit("inside-artifacts")], packetDir), packetDir, { activePointerPath });
  await expectRejects(() => executeFanout({
    cwd: repo,
    activePointerPath,
    projectArtifactRoot: projectRoot,
    extensionEntry: join(repo, "extension.ts"),
    dryRun: true,
    runId: "inside-artifacts-smoke",
  }), /execution artifacts must be outside the active repository/, "in-repository artifact root");

  const gitDir = git(repo, ["rev-parse", "--absolute-git-dir"]).stdout.trim();
  assert(!existsSync(join(gitDir, "fanout-execution.lock")), "artifact-root rejection created the project execution lock");
  assert(!existsSync(join(packetDir, "executions")), "artifact-root rejection created execution recorder artifacts");
}

async function testDirtyWorktreeGuard() {
  const repo = join(root, "dirty-worktree-repo");
  repos.push(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "value.txt"), "clean\n");
  writeFileSync(join(repo, "extension.ts"), "export default function fanoutSmokeExtension() {}\n");
  initRepo(repo);
  writeFileSync(join(repo, "value.txt"), "dirty\n");
  const fsmonitorMarker = join(root, "preflight-fsmonitor-ran.txt");
  const fsmonitorPath = join(root, "preflight-fsmonitor");
  writeFileSync(fsmonitorPath, `#!/bin/sh\nprintf fsmonitor > ${JSON.stringify(fsmonitorMarker)}\n`);
  chmodSync(fsmonitorPath, 0o755);
  git(repo, ["config", "core.fsmonitor", fsmonitorPath]);

  const projectRoot = join(root, "dirty-worktree-artifacts", "project");
  const packetDir = join(projectRoot, "packet");
  const activePointerPath = join(projectRoot, "active-packet.json");
  writeExecutionPacketArtifacts(makePacket([makeUnit("dirty", [], ["value.txt"])], packetDir), packetDir, { activePointerPath });
  const result = await executeFanout({
    cwd: repo,
    activePointerPath,
    projectArtifactRoot: projectRoot,
    extensionEntry: join(repo, "extension.ts"),
    dryRun: true,
    piCommand: process.execPath,
    runId: "dirty-worktree-smoke",
  });
  assert(result.status === "failed" && result.error?.includes("must be clean"), "dirty active worktree was not rejected by preflight");
  const summary = readFileSync(result.paths.summaryPath, "utf8");
  assert(result.dryRun === true && summary.includes("Fanout Dry Run Summary") && summary.includes("Final validation: not run (dry run)"), "failed dry run was not labeled in its summary");
  assert(!readJsonl(result.paths.eventsPath).some((event) => event.event === "confirmation_requested"), "dirty-worktree rejection reached confirmation");
  assert(readFileSync(join(repo, "value.txt"), "utf8") === "dirty\n", "dirty-worktree rejection changed the user's file");
  assert(!existsSync(fsmonitorMarker), "preflight executed the repository fsmonitor command");
}

async function testCompiledPacketExecution() {
  const fakePi = join(root, "compiled-packet-fake-pi.mjs");
  writeFileSync(fakePi, compiledPacketFakePiSource(), "utf8");
  chmodSync(fakePi, 0o755);

  const succeeded = setupCompiledExecution("compiled-packet-success");
  const successResult = await executeFanout({ ...succeeded.options, piCommand: fakePi, runId: "compiled-packet-success" });
  assert(successResult.status === "succeeded", `compiled packet execution failed: ${successResult.error ?? "unknown error"}`);
  assert(readFileSync(join(succeeded.repo, "value.txt"), "utf8").trim() === "compiled", "compiled implementation patch was not applied");
  assert(successResult.finalValidation?.status === "passed", "compiled packet authoritative validation did not pass");
  const successFinalNode = successResult.snapshot.nodes.find((node) => node.id === "final-validation");
  assert(successFinalNode?.status === "succeeded" && successFinalNode.worker?.totalTokens === 15, "compiled no-write final-validation node did not record successful worker metrics");
  assert(successResult.snapshot.totals.totalTokens === 30 && successResult.snapshot.totals.filesChanged === 1, "compiled packet execution totals are wrong");
  const successEvents = readJsonl(successResult.paths.eventsPath);
  assert(successEvents.some((event) => event.event === "patch_applied" && event.nodeId === "final-validation" && event.noOp === true), "compiled final-validation node was not recorded as an accepted no-op");

  const failed = setupCompiledExecution("compiled-packet-final-failure", { authoritativeFailure: true });
  const failedResult = await executeFanout({ ...failed.options, piCommand: fakePi, runId: "compiled-packet-final-failure" });
  assert(failedResult.status === "failed" && failedResult.error === "final validation failed", `authoritative validation failure returned the wrong result: ${failedResult.error ?? failedResult.status}`);
  assert(failedResult.dag?.ok === true, "authoritative validation smoke failed before completing the compiled DAG");
  assert(failedResult.finalValidation?.status === "failed" && failedResult.snapshot.finalValidation?.status === "failed", "authoritative validation failure was not retained in the result and snapshot");
  assert(failedResult.snapshot.nodes.find((node) => node.id === "final-validation")?.status === "succeeded", "compiled final-validation worker did not succeed before the authoritative failure");
  assert(readFileSync(join(failed.repo, "value.txt"), "utf8").trim() === "compiled", "authoritative validation failure lost the accepted implementation patch");
  for (const path of [failedResult.paths.eventsPath, failedResult.paths.snapshotPath, failedResult.paths.summaryPath, join(failedResult.paths.runDir, "final-validation.json")]) {
    assert(existsSync(path), `authoritative validation failure artifact was not written: ${path}`);
  }
  const failedSummary = readFileSync(failedResult.paths.summaryPath, "utf8");
  assert(failedSummary.includes("Status: **failed**") && failedSummary.includes("Final validation: failed"), "authoritative validation failure summary is incomplete");
}

async function testEndToEnd() {
  const repo = join(root, "e2e-repo");
  repos.push(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "AGENTS.md"), "# Repository worker guidance\n\nfanout-repository-instruction-sentinel\n");
  writeFileSync(join(repo, "state.txt"), "initial\n");
  writeFileSync(join(repo, "extension.ts"), "export default function fanoutSmokeExtension() {}\n");
  writeFileSync(join(repo, "validate-upstream.mjs"), `import { readFileSync } from "node:fs";\nif (readFileSync("state.txt", "utf8").trim() !== "upstream") process.exit(1);\n`);
  writeFileSync(join(repo, "validate-final.mjs"), `import { readFileSync } from "node:fs";\nif (readFileSync("state.txt", "utf8").trim() !== "upstream") process.exit(1);\nif (readFileSync("result.txt", "utf8").trim() !== "saw:upstream") process.exit(1);\n`);
  initRepo(repo);

  const fakePi = join(root, "fake-pi.mjs");
  writeFileSync(fakePi, fakePiSource(), "utf8");
  chmodSync(fakePi, 0o755);

  const projectRoot = join(root, "e2e-artifacts", "project");
  const packetDir = join(projectRoot, "packet");
  const activePointerPath = join(projectRoot, "active-packet.json");
  const upstream = makeUnit("upstream", [], ["state.txt"], ["validate-upstream.mjs"]);
  upstream.validationCommands = ["rtk node validate-upstream.mjs"];
  const downstream = makeUnit("downstream", ["upstream"], ["result.txt"], ["state.txt", "validate-final.mjs"]);
  downstream.validationCommands = ["rtk node validate-final.mjs"];
  downstream.workerPacket.readDependencies = ["state.txt (post-change-required): upstream integrated state"];
  const packet = makePacket([upstream, downstream], packetDir, {
    objective: "Prove dependent worktrees inherit integrated upstream state",
    finalValidationPlan: ["rtk node validate-final.mjs"],
  });
  writeExecutionPacketArtifacts(packet, packetDir, { activePointerPath });

  const dryRun = await executeFanout({
    cwd: repo,
    activePointerPath,
    projectArtifactRoot: projectRoot,
    extensionEntry: join(repo, "extension.ts"),
    dryRun: true,
    confirm: () => { throw new Error("dry run must not confirm"); },
    piCommand: fakePi,
    runId: "dry-run-smoke",
  });
  assert(dryRun.status === "succeeded" && readFileSync(join(repo, "state.txt"), "utf8") === "initial\n", "dry run mutated the repository or failed");
  assert(dryRun.dryRun === true && !dryRun.finalValidation && dryRun.snapshot.nodes.every((node) => node.status === "pending") && !dryRun.snapshot.eventCounts.worker_attempt_started, "dry run executed work or lost its mode");
  const dryRunSummary = readFileSync(dryRun.paths.summaryPath, "utf8");
  for (const value of ["# Fanout Dry Run Summary", "Mode: **dry run**", "workers and final validation were not run", "Final validation: not run (dry run)"]) {
    assert(dryRunSummary.includes(value), `dry-run summary is missing ${value}`);
  }

  let releaseConfirmation;
  let confirmationReached;
  const reached = new Promise((resolvePromise) => { confirmationReached = resolvePromise; });
  const held = executeFanout({
    cwd: repo,
    activePointerPath,
    projectArtifactRoot: projectRoot,
    extensionEntry: join(repo, "extension.ts"),
    confirm: () => new Promise((resolvePromise) => {
      releaseConfirmation = resolvePromise;
      confirmationReached();
    }),
    piCommand: fakePi,
    runId: "lock-holder",
  });
  await reached;
  await expectRejects(() => executeFanout({
    cwd: repo,
    activePointerPath,
    projectArtifactRoot: projectRoot,
    extensionEntry: join(repo, "extension.ts"),
    dryRun: true,
    piCommand: fakePi,
    runId: "lock-contender",
  }), /already locked/, "project execution lock");
  const alternateProjectRoot = join(root, "e2e-artifacts-alternate", "project");
  const alternatePacketDir = join(alternateProjectRoot, "packet");
  const alternateActivePointerPath = join(alternateProjectRoot, "active-packet.json");
  writeExecutionPacketArtifacts({ ...structuredClone(packet), artifactDir: alternatePacketDir }, alternatePacketDir, { activePointerPath: alternateActivePointerPath });
  await expectRejects(() => executeFanout({
    cwd: repo,
    activePointerPath: alternateActivePointerPath,
    projectArtifactRoot: alternateProjectRoot,
    extensionEntry: join(repo, "extension.ts"),
    dryRun: true,
    piCommand: fakePi,
    runId: "alternate-root-lock-contender",
  }), /already locked/, "canonical worktree execution lock");
  releaseConfirmation(false);
  assert((await held).status === "aborted", "lock holder did not abort cleanly");

  const result = await executeFanout({
    cwd: repo,
    activePointerPath,
    projectArtifactRoot: projectRoot,
    extensionEntry: join(repo, "extension.ts"),
    confirm: () => true,
    maxConcurrency: 2,
    piCommand: fakePi,
    runId: "e2e-smoke",
    workerTimeoutMs: 10_000,
    validationTimeoutMs: 10_000,
  });
  assert(result.status === "succeeded", `end-to-end execution failed: ${result.error ?? "unknown error"}`);
  assert(readFileSync(join(repo, "state.txt"), "utf8").trim() === "upstream", "upstream patch was not applied");
  assert(readFileSync(join(repo, "result.txt"), "utf8").trim() === "saw:upstream", "dependent worker did not see upstream state");
  assert(result.finalValidation?.status === "passed", "final validation did not pass");
  assert(result.snapshot.nodes.every((node) => node.status === "succeeded"), "end-to-end node status is not succeeded");
  assert(result.snapshot.totals.totalTokens === 30 && result.snapshot.totals.estimatedCostUsd === 0.002, "end-to-end worker totals are wrong");
  assert(result.snapshot.totals.filesChanged === 2 && result.snapshot.totals.toolDurationMs === 4, "end-to-end patch/timing totals are wrong");
  for (const path of [result.paths.eventsPath, result.paths.snapshotPath, result.paths.summaryPath, join(result.paths.runDir, "final-validation.json")]) {
    assert(existsSync(path), `end-to-end artifact was not written: ${path}`);
  }
  const summary = readFileSync(result.paths.summaryPath, "utf8");
  for (const value of ["Fanout Execution Summary", "Execution outcomes", "Final validation: passed", "Changed files", "state.txt", "result.txt", "final-validation.json"]) assert(summary.includes(value), `execution summary is missing ${value}`);
  assert(!summary.includes("dry run"), "live execution summary used dry-run wording");
  const events = readJsonl(result.paths.eventsPath);
  assert(events.filter((event) => event.event === "patch_applied").length === 2, "end-to-end patches were not both recorded");
  assert(events.at(-1)?.event === "execution_finished", "end-to-end run did not record execution_finished");
}

async function testRetryAndRecovery() {
  const fakePi = join(root, "policy-fake-pi.mjs");
  writeFileSync(fakePi, policyFakePiSource(), "utf8");
  chmodSync(fakePi, 0o755);

  const fallback = setupPolicyRepo("fallback");
  const fallbackUnit = makeUnit("fallback", [], ["value.txt"], ["validate.mjs"]);
  fallbackUnit.tier = { ...fallbackUnit.tier, preferred: "tier2", assigned: "tier2", provider: "fake", model: "async-worker", fallback: "tier1" };
  fallbackUnit.validationCommands = ["rtk node validate.mjs"];
  const fallbackPacket = makePacket([fallbackUnit], fallback.packetDir, { finalValidationPlan: ["rtk node validate.mjs"] });
  fallbackPacket.tierPlan.tier2 = { provider: "fake", model: "async-worker", thinking: "off", source: "smoke", status: "available", reason: "retry smoke", fallback: "tier1" };
  fallbackPacket.tierPlan.tier2Fallback = { provider: "fake", model: "realtime-fallback", thinking: "off", source: "smoke", status: "available", reason: "realtime fallback smoke" };
  writeExecutionPacketArtifacts(fallbackPacket, fallback.packetDir, { activePointerPath: fallback.activePointerPath });
  const fallbackResult = await executeFanout({ ...fallback.options, piCommand: fakePi, runId: "fallback-smoke" });
  assert(fallbackResult.status === "succeeded" && readFileSync(join(fallback.repo, "value.txt"), "utf8").trim() === "good", `tier2 fallback failed: ${fallbackResult.error}`);
  assert(fallbackResult.snapshot.eventCounts.worker_attempt_started === 3 && fallbackResult.snapshot.eventCounts.worker_retry_scheduled === 1 && fallbackResult.snapshot.eventCounts.worker_fallback_started === 1, "tier2 retry/fallback counts are wrong");
  const fallbackEvents = readJsonl(fallbackResult.paths.eventsPath);
  assert(fallbackEvents.some((event) => event.event === "worker_fallback_started" && event.model === "realtime-fallback"), "tier2 exhaustion did not schedule the configured fallback model");
  assert(fallbackEvents.some((event) => event.event === "worker_attempt_started" && event.kind === "fallback" && event.model === "realtime-fallback"), "fallback attempt did not run the configured realtime model");
  const fallbackOutcomes = ["001-original", "002-retry", "003-fallback"].map((attempt) => readOutcome(fallbackResult.paths.runDir, "fallback", attempt));
  assert(fallbackOutcomes.map((outcome) => outcome.action).join(",") === "retry,fallback,accept", "typed fallback attempt outcomes did not drive the fixed sequence");
  assert(fallbackOutcomes.slice(0, 2).every((outcome) => outcome.terminalFact.stage === "provider" && outcome.terminalFact.code === "retryable-service"), "structured provider facts did not authorize retry/fallback");
  assert(fallbackOutcomes[2].metrics.turns[0]?.turnId.endsWith("/turn-0") && fallbackOutcomes[2].metrics.tools[0]?.toolCallId === "worker-tool", "accepted attempt metrics did not retain observed turn/tool identities");

  const repair = setupPolicyRepo("validation-repair");
  const repairUnit = makeUnit("validation-repair", [], ["value.txt"], ["validate.mjs"]);
  repairUnit.validationCommands = ["rtk node validate.mjs"];
  const repairPacket = makePacket([repairUnit], repair.packetDir, { finalValidationPlan: ["rtk node validate.mjs"] });
  repairPacket.tierPlan.tier2Fallback = { provider: "fake", model: "realtime-fallback", thinking: "off", source: "smoke", status: "available", reason: "must not run typed repair" };
  writeExecutionPacketArtifacts(repairPacket, repair.packetDir, { activePointerPath: repair.activePointerPath });
  const repairResult = await executeFanout({ ...repair.options, piCommand: fakePi, runId: "validation-repair-smoke" });
  assert(repairResult.status === "succeeded" && readFileSync(join(repair.repo, "value.txt"), "utf8").trim() === "good", `validation repair failed: ${repairResult.error}`);
  assert(repairResult.snapshot.eventCounts.validation_repair_started === 1 && repairResult.snapshot.eventCounts.validation_repair_finished === 1, "validation repair events are wrong");
  assert(repairResult.snapshot.totals.totalTokens === 30 && repairResult.snapshot.nodes[0].worker?.totalTokens === 15, "validation repair did not account for rejected worker usage");
  const repairEvents = readJsonl(repairResult.paths.eventsPath);
  assert(repairEvents.some((event) => event.event === "worker_attempt_started" && event.kind === "validation-repair" && event.model === "worker"), "typed validation repair did not retain tier1 control-plane model");
  const validationFailureOutcome = readOutcome(repairResult.paths.runDir, "validation-repair", "001-original");
  const validationRepairOutcome = readOutcome(repairResult.paths.runDir, "validation-repair", "002-validation-repair");
  assert(validationFailureOutcome.action === "validation-repair" && validationFailureOutcome.recovery?.kind === "validation", "validation repair was not allocated from typed recovery evidence");
  assert(validationRepairOutcome.action === "accept", "successful validation repair did not record one accepted terminal outcome");

  const integration = setupPolicyRepo("integration-repair");
  writeFileSync(join(integration.repo, "validate.mjs"), `import { readFileSync, realpathSync, writeFileSync } from "node:fs";\nimport { resolve } from "node:path";\nconst active = ${JSON.stringify(integration.repo)};\nif (readFileSync("value.txt", "utf8").trim() !== "good") process.exit(1);\nif (realpathSync(process.cwd()) !== realpathSync(active) && process.cwd().includes("/workers/integration-repair-")) writeFileSync(resolve(active, "value.txt"), "conflict\\n");\n`);
  writeFileSync(join(integration.repo, "validate-result.mjs"), `import { readFileSync } from "node:fs";\nif (readFileSync("value.txt", "utf8").trim() !== "good" || readFileSync("result.txt", "utf8").trim() !== "saw:good") process.exit(1);\n`);
  git(integration.repo, ["add", "validate.mjs", "validate-result.mjs"]);
  git(integration.repo, ["-c", "user.name=Fanout Smoke", "-c", "user.email=fanout-smoke@local", "commit", "-q", "-m", "integration conflict validator"]);
  const integrationUnit = makeUnit("integration-repair", [], ["value.txt"], ["validate.mjs"]);
  integrationUnit.validationCommands = ["rtk node validate.mjs"];
  const afterIntegration = makeUnit("after-integration", ["integration-repair"], ["result.txt"], ["value.txt", "validate-result.mjs"]);
  afterIntegration.validationCommands = ["rtk node validate-result.mjs"];
  const integrationPacket = makePacket([integrationUnit, afterIntegration], integration.packetDir, { finalValidationPlan: ["rtk node validate.mjs", "rtk node validate-result.mjs"] });
  integrationPacket.tierPlan.tier2Fallback = { provider: "fake", model: "realtime-fallback", thinking: "off", source: "smoke", status: "available", reason: "must not run integration repair" };
  writeExecutionPacketArtifacts(integrationPacket, integration.packetDir, { activePointerPath: integration.activePointerPath });
  const integrationResult = await executeFanout({ ...integration.options, piCommand: fakePi, runId: "integration-repair-smoke" });
  assert(integrationResult.status === "failed" && readFileSync(join(integration.repo, "value.txt"), "utf8").trim() === "conflict" && !existsSync(join(integration.repo, "result.txt")), `active drift was mutated or repaired: ${integrationResult.error}`);
  assert(!integrationResult.snapshot.eventCounts.integration_repair_started, "active drift incorrectly entered integration repair");
  const integrationEvents = readJsonl(integrationResult.paths.eventsPath);
  assert(integrationEvents.some((event) => event.event === "node_failed" && String(event.error).includes("active worktree drifted")), "active drift did not retain its hard-fail evidence");

  const combinedRepair = setupPolicyRepo("integration-validation-repair");
  writeFileSync(join(combinedRepair.repo, "validate.mjs"), `import { readFileSync, realpathSync, writeFileSync } from "node:fs";\nimport { resolve } from "node:path";\nconst active = ${JSON.stringify(combinedRepair.repo)};\nif (readFileSync("value.txt", "utf8").trim() !== "good") process.exit(1);\nif (realpathSync(process.cwd()) !== realpathSync(active) && process.cwd().includes("/001-original/worktree")) writeFileSync(resolve(active, "value.txt"), "conflict\\n");\n`);
  writeFileSync(join(combinedRepair.repo, "validate-result.mjs"), `import { readFileSync } from "node:fs";\nif (readFileSync("value.txt", "utf8").trim() !== "good" || readFileSync("result.txt", "utf8").trim() !== "saw:good") process.exit(1);\n`);
  git(combinedRepair.repo, ["add", "validate.mjs", "validate-result.mjs"]);
  git(combinedRepair.repo, ["-c", "user.name=Fanout Smoke", "-c", "user.email=fanout-smoke@local", "commit", "-q", "-m", "combined repair validator"]);
  const combinedUnit = makeUnit("integration-validation-repair", [], ["value.txt"], ["validate.mjs"]);
  combinedUnit.validationCommands = ["rtk node validate.mjs"];
  const afterCombined = makeUnit("after-combined-repair", ["integration-validation-repair"], ["result.txt"], ["value.txt", "validate-result.mjs"]);
  afterCombined.validationCommands = ["rtk node validate-result.mjs"];
  const combinedPacket = makePacket([combinedUnit, afterCombined], combinedRepair.packetDir, { finalValidationPlan: ["rtk node validate.mjs", "rtk node validate-result.mjs"] });
  writeExecutionPacketArtifacts(combinedPacket, combinedRepair.packetDir, { activePointerPath: combinedRepair.activePointerPath });
  const combinedResult = await executeFanout({ ...combinedRepair.options, piCommand: fakePi, runId: "integration-validation-repair-smoke" });
  assert(combinedResult.status === "failed" && readFileSync(join(combinedRepair.repo, "value.txt"), "utf8").trim() === "conflict", `combined active drift was mutated or repaired: ${combinedResult.error}`);
  assert(!combinedResult.snapshot.eventCounts.integration_repair_started, "combined active drift incorrectly entered repair");

  const missing = setupPolicyRepo("missing-metrics");
  const missingUnit = makeUnit("missing-metrics", [], ["value.txt"], ["validate.mjs"]);
  missingUnit.validationCommands = ["rtk node validate.mjs"];
  const missingPacket = makePacket([missingUnit], missing.packetDir, { finalValidationPlan: ["rtk node validate.mjs"] });
  writeExecutionPacketArtifacts(missingPacket, missing.packetDir, { activePointerPath: missing.activePointerPath });
  const missingResult = await executeFanout({ ...missing.options, piCommand: fakePi, runId: "missing-metrics-smoke" });
  assert(missingResult.status === "failed" && readFileSync(join(missing.repo, "value.txt"), "utf8").trim() === "initial", "missing-metrics worker changed the active worktree");
  assert(missingResult.snapshot.eventCounts.worker_attempt_started === 1 && missingResult.snapshot.eventCounts.metrics_missing === 1, "missing metrics triggered retry or was not recorded");

  const validationPreflight = setupPolicyRepo("validation-preflight");
  const validationPreflightUnit = makeUnit("validation-preflight", [], ["value.txt"], ["validate.mjs"]);
  validationPreflightUnit.validationCommands = ["rtk node validate.mjs"];
  const validationPreflightPacket = makePacket([validationPreflightUnit], validationPreflight.packetDir, { finalValidationPlan: ["rtk node validate.mjs"] });
  writeExecutionPacketArtifacts(validationPreflightPacket, validationPreflight.packetDir, { activePointerPath: validationPreflight.activePointerPath });
  const inheritedShell = process.env.SHELL;
  let validationPreflightResult;
  try {
    process.env.SHELL = join(root, "definitely-missing-validation-shell");
    validationPreflightResult = await executeFanout({ ...validationPreflight.options, piCommand: fakePi, runId: "validation-preflight-smoke" });
  } finally {
    if (inheritedShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = inheritedShell;
  }
  const validationPreflightOutcome = readOutcome(validationPreflightResult.paths.runDir, "validation-preflight", "001-original");
  assert(validationPreflightResult.status === "failed" && validationPreflightOutcome.terminalFact.stage === "validation" && validationPreflightOutcome.terminalFact.code === "spawn-failure", "validation preflight failure did not produce a typed terminal outcome");
  assert(!validationPreflightResult.snapshot.eventCounts.validation_repair_started, "validation preflight failure incorrectly launched a worker repair");

  const validationMutation = setupPolicyRepo("validation-mutation");
  writeFileSync(join(validationMutation.repo, "validate.mjs"), `import { readFileSync, writeFileSync } from "node:fs";\nif (readFileSync("value.txt", "utf8").trim() !== "good") process.exit(1);\nwriteFileSync("value.txt", "validation-mutated\\n");\n`);
  git(validationMutation.repo, ["add", "validate.mjs"]);
  git(validationMutation.repo, ["-c", "user.name=Fanout Smoke", "-c", "user.email=fanout-smoke@local", "commit", "-q", "-m", "mutating validator"]);
  const validationMutationUnit = makeUnit("validation-mutation", [], ["value.txt"], ["validate.mjs"]);
  validationMutationUnit.validationCommands = ["rtk node validate.mjs"];
  const validationMutationPacket = makePacket([validationMutationUnit], validationMutation.packetDir, { finalValidationPlan: ["rtk node validate.mjs"] });
  writeExecutionPacketArtifacts(validationMutationPacket, validationMutation.packetDir, { activePointerPath: validationMutation.activePointerPath });
  const validationMutationResult = await executeFanout({ ...validationMutation.options, piCommand: fakePi, runId: "validation-mutation-smoke" });
  assert(validationMutationResult.status === "failed" && readFileSync(join(validationMutation.repo, "value.txt"), "utf8").trim() === "initial", "validation-mutated patch reached the active worktree");
  assert(readJsonl(validationMutationResult.paths.eventsPath).some((event) => event.event === "patch_rejected" && event.reason === "validation_modified_patch"), "validation patch mutation was not recorded");

  const patchSubstitution = setupPolicyRepo("patch-substitution");
  const patchSubstitutionRunId = "patch-substitution-smoke";
  const patchSubstitutionPath = join(patchSubstitution.packetDir, "executions", patchSubstitutionRunId, "workers", artifactSegment("patch-substitution"), "attempts", "001-original", "patch.bin");
  writeFileSync(join(patchSubstitution.repo, "replace-patch.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(patchSubstitutionPath)}, "substituted patch bytes\\n");\n`);
  git(patchSubstitution.repo, ["add", "replace-patch.mjs"]);
  git(patchSubstitution.repo, ["-c", "user.name=Fanout Smoke", "-c", "user.email=fanout-smoke@local", "commit", "-q", "-m", "patch substitution validator"]);
  const patchSubstitutionUnit = makeUnit("patch-substitution", [], ["value.txt"], ["replace-patch.mjs"]);
  patchSubstitutionUnit.validationCommands = ["rtk node replace-patch.mjs"];
  const patchSubstitutionPacket = makePacket([patchSubstitutionUnit], patchSubstitution.packetDir, { finalValidationPlan: ["rtk node validate.mjs"] });
  writeExecutionPacketArtifacts(patchSubstitutionPacket, patchSubstitution.packetDir, { activePointerPath: patchSubstitution.activePointerPath });
  const patchSubstitutionResult = await executeFanout({ ...patchSubstitution.options, piCommand: fakePi, runId: patchSubstitutionRunId });
  assert(patchSubstitutionResult.status === "failed" && readFileSync(join(patchSubstitution.repo, "value.txt"), "utf8").trim() === "initial", "A8 substituted validator patch reached active");
  assert(readJsonl(patchSubstitutionResult.paths.eventsPath).some((event) => event.event === "patch_rejected" && event.reason === "validation_modified_patch"), "A8 substituted patch identity failure was not recorded");

  for (const nodeId of ["empty-patch", "worker-commit"]) {
    const hardStop = setupPolicyRepo(nodeId);
    const hardStopUnit = makeUnit(nodeId, [], ["value.txt"], ["validate.mjs"]);
    hardStopUnit.validationCommands = ["rtk node validate.mjs"];
    const hardStopPacket = makePacket([hardStopUnit], hardStop.packetDir, { finalValidationPlan: ["rtk node validate.mjs"] });
    writeExecutionPacketArtifacts(hardStopPacket, hardStop.packetDir, { activePointerPath: hardStop.activePointerPath });
    const hardStopResult = await executeFanout({ ...hardStop.options, piCommand: fakePi, runId: `${nodeId}-smoke` });
    assert(hardStopResult.status === "failed" && readFileSync(join(hardStop.repo, "value.txt"), "utf8").trim() === "initial", `${nodeId} worker changed the active worktree`);
    assert(hardStopResult.snapshot.eventCounts.worker_attempt_started === 1, `${nodeId} hard stop retried unexpectedly`);
  }
}

async function testPostApplyRollback() {
  const fakePi = join(root, "bookkeeping-fake-pi.mjs");
  writeFileSync(fakePi, policyFakePiSource(), "utf8");
  chmodSync(fakePi, 0o755);

  const setup = setupPolicyRepo("bookkeeping-rollback");
  const unit = makeUnit("bookkeeping-rollback", [], ["value.txt"], ["validate.mjs"]);
  unit.validationCommands = ["rtk node validate.mjs"];
  const packet = makePacket([unit], setup.packetDir, { finalValidationPlan: ["rtk node validate.mjs"] });
  const paths = writeExecutionPacketArtifacts(packet, setup.packetDir, { activePointerPath: setup.activePointerPath });
  const recorder = createExecutionRecorder({ runId: "bookkeeping-rollback", packetPath: paths.packetPath, nodeIds: [unit.id] });
  const appendEvent = recorder.appendEvent.bind(recorder);
  recorder.appendEvent = (event, data = {}) => {
    if (event === "patch_applied") throw new Error("injected audit write failure");
    return appendEvent(event, data);
  };
  const executor = createFanoutNodeExecutor({
    packet,
    repoRoot: setup.repo,
    runDir: recorder.runDir,
    runId: "bookkeeping-rollback",
    extensionEntry: join(setup.repo, "extension.ts"),
    recorder,
    piCommand: fakePi,
    workerTimeoutMs: 10_000,
    validationTimeoutMs: 10_000,
  });

  const result = await executor.runNode(unit);
  const snapshot = recorder.snapshot();
  assert(!result.ok && result.error?.includes("bookkeeping failed after active mutation"), "post-apply bookkeeping failure did not enter its distinct hard-fail state");
  assert(readFileSync(join(setup.repo, "value.txt"), "utf8").trim() === "good", "post-apply bookkeeping failure guessed a rollback after mutation");
  assert(snapshot.nodes[0].worker?.provider === "fake" && snapshot.nodes[0].patch?.filesChanged === 1, "post-apply bookkeeping failure erased already-recorded evidence");
  const outcome = readOutcome(recorder.runDir, "bookkeeping-rollback", "001-original");
  assert(outcome.action === "fail" && outcome.terminalFact.stage === "bookkeeping" && outcome.terminalFact.code === "failed-after-mutation", "post-mutation bookkeeping failure did not record its distinct typed terminal outcome");
}

function setupPolicyRepo(name) {
  const repo = join(root, `${name}-repo`);
  repos.push(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "value.txt"), "initial\n");
  writeFileSync(join(repo, "extension.ts"), "export default function fanoutSmokeExtension() {}\n");
  writeFileSync(join(repo, "validate.mjs"), `import { readFileSync } from "node:fs";\nif (readFileSync("value.txt", "utf8").trim() !== "good") process.exit(1);\n`);
  initRepo(repo);
  const projectRoot = join(root, `${name}-artifacts`, "project");
  const packetDir = join(projectRoot, "packet");
  const activePointerPath = join(projectRoot, "active-packet.json");
  return {
    repo,
    packetDir,
    activePointerPath,
    options: { cwd: repo, activePointerPath, projectArtifactRoot: projectRoot, extensionEntry: join(repo, "extension.ts"), confirm: () => true, workerTimeoutMs: 10_000, validationTimeoutMs: 10_000 },
  };
}

function readOutcome(runDir, nodeId, attempt) {
  return JSON.parse(readFileSync(join(runDir, "workers", artifactSegment(nodeId), "attempts", attempt, "attempt-outcome.json"), "utf8"));
}

function setupCompiledExecution(name, { authoritativeFailure = false } = {}) {
  const repo = join(root, `${name}-repo`);
  repos.push(repo);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "value.txt"), "initial\n");
  writeFileSync(join(repo, "extension.ts"), "export default function fanoutSmokeExtension() {}\n");
  writeFileSync(join(repo, "validate.mjs"), `import { readFileSync } from "node:fs";\nif (readFileSync("value.txt", "utf8").trim() !== "compiled") process.exit(1);\n`);
  if (authoritativeFailure) {
    writeFileSync(join(repo, "validate-authoritative.mjs"), `import { realpathSync } from "node:fs";\nconst activeRoot = realpathSync(${JSON.stringify(repo)});\nif (realpathSync(process.cwd()) === activeRoot) process.exit(1);\n`);
  }
  initRepo(repo);

  const projectRoot = join(root, `${name}-artifacts`, "project");
  const packetDir = join(projectRoot, "packet");
  const activePointerPath = join(projectRoot, "active-packet.json");
  const objective = "Execute a compiler-produced packet through the real Fanout executor";
  const validationCommand = "rtk node validate.mjs";
  const implementationPlan = {
    schema: "fanout.implementation-plan",
    version: 1,
    status: "ready",
    objective,
    createdAt: "2026-07-09T00:00:00.000Z",
    artifactDir: packetDir,
    userContext: ["Run the compiled execution smoke."],
    discoveredRepoFacts: ["value.txt contains the smoke state."],
    assumptions: ["The fake worker is deterministic."],
    implementationItems: [{
      id: "compiled-edit",
      goal: "Update the compiled smoke value",
      rationale: "The execution smoke needs an observable implementation patch.",
      filesToChange: ["value.txt"],
      filesToRead: [],
      dependencies: [],
      validation: [validationCommand],
      acceptanceCriteria: ["value.txt contains compiled."],
      risks: [],
    }],
    validationPlan: authoritativeFailure ? ["rtk node validate-authoritative.mjs"] : [validationCommand],
    risks: [],
  };
  const implementationDetails = {
    schema: "fanout.implementation-details",
    version: 2,
    status: "ready",
    objective,
    artifactDir: packetDir,
    sourcePlanPath: join(packetDir, "implementation-plan.json"),
    finalValidationCommands: authoritativeFailure ? ["rtk node validate-authoritative.mjs"] : [validationCommand],
    items: [{
      sourcePlanIds: ["compiled-edit"],
      ownedResources: ["value.txt"],
      existingFileEdits: [{ file: "value.txt", section: "entire file", anchorText: "initial", lineRangeHint: "1", editIntent: "Replace the smoke state with compiled." }],
      newFiles: [],
      readDependencies: [],
      forbiddenChanges: [],
      validationCommands: [validationCommand],
    }],
  };
  const tierPlan = {
    tier1: { provider: "fake", model: "worker", thinking: "off", source: "smoke", status: "available", reason: "compiler execution smoke" },
    tier2: { provider: "fake", model: "async-worker", thinking: "off", source: "smoke", status: "unavailable", reason: "compiler execution smoke uses fallback", fallback: "tier1" },
    tier2Fallback: { provider: "fake", model: "worker", thinking: "off", source: "tier1 inheritance", status: "available", reason: "realtime fallback for tier2 execution" },
  };
  const compiled = compileExecutionPacket({
    implementationPlan,
    implementationDetails,
    tierPlan,
    nodeKindTierPolicy: { tier2Eligible: ["implement"], tier1Only: ["final-validation"], fallbackTier: "tier1" },
    artifactDir: packetDir,
    createdAt: "2026-07-09T00:00:00.000Z",
  });
  assert(compiled.ok && compiled.packet, `compiler execution smoke did not compile: ${compiled.errors.join("; ")}`);
  const finalUnit = compiled.packet.workUnits.find((unit) => unit.id === "final-validation");
  assert(finalUnit?.kind === "final-validation" && finalUnit.ownedFiles.length === 0, "compiler did not emit the no-write final-validation node");
  assert(finalUnit.dependencies.join(",") === "compiled-edit", `compiled final-validation dependencies are wrong: ${finalUnit.dependencies.join(",")}`);
  writeExecutionPacketArtifacts(compiled.packet, packetDir, { activePointerPath });
  return {
    repo,
    options: { cwd: repo, activePointerPath, projectArtifactRoot: projectRoot, extensionEntry: join(repo, "extension.ts"), confirm: () => true, workerTimeoutMs: 10_000, validationTimeoutMs: 10_000 },
  };
}

function makePacket(workUnits, artifactDir, overrides = {}) {
  const graph = buildExecutionGraph(workUnits);
  return {
    schema: EXECUTION_PACKET_SCHEMA,
    version: EXECUTION_PACKET_VERSION,
    status: "ready",
    objective: overrides.objective ?? "Fanout execution smoke",
    createdAt: "2026-07-09T00:00:00.000Z",
    artifactDir,
    tierPlan: {
      tier1: { provider: "fake", model: "worker", thinking: "off", source: "smoke", status: "available", reason: "smoke worker" },
      tier2: { provider: "fake", model: "async-worker", thinking: "off", source: "smoke", status: "unavailable", reason: "not needed", fallback: "tier1" },
      tier2Fallback: { provider: "fake", model: "worker", thinking: "off", source: "tier1 inheritance", status: "available", reason: "realtime fallback for tier2 execution" },
    },
    userContext: overrides.userContext ?? ["approved smoke context"],
    discoveredRepoFacts: overrides.discoveredRepoFacts ?? ["temporary git repository"],
    assumptions: ["all files are temporary"],
    blockers: [],
    workUnits,
    estimates: {
      activeWait: "under one minute",
      backgroundCompletion: "none",
      cost: "synthetic",
      criticalPath: graph.criticalPath,
      parallelGroups: graph.parallelGroups,
    },
    stopRules: overrides.stopRules ?? ["stop outside owned files"],
    risks: ["smoke only"],
    finalValidationPlan: overrides.finalValidationPlan ?? ["rtk git diff --check"],
  };
}

function makeUnit(id, dependencies = [], ownedFiles = [`${id}.txt`], readOnlyFiles = []) {
  return {
    id,
    kind: "implement",
    goal: `Implement ${id}`,
    dependencies,
    ownedFiles,
    readOnlyFiles,
    steps: [`Complete ${id}.`],
    validationCommands: ["rtk git diff --check"],
    acceptanceCriteria: [`${id} is complete.`],
    rollbackNotes: [`Revert ${id}.`],
    active: "active",
    tier: {
      preferred: "tier1",
      assigned: "tier1",
      fallback: "tier1",
      provider: "fake",
      model: "worker",
      thinking: "off",
      reason: "smoke worker",
    },
    workerPacket: {
      sourcePlanIds: [id],
      targetAnchors: ownedFiles.map((file) => `${file}: smoke target`),
      requiredChanges: [`Complete ${id}.`],
      contractInputs: [`${id} smoke contract`],
      readDependencies: [...readOnlyFiles],
      forbiddenChanges: [],
      handoffContext: ["Use only the supplied smoke repository."],
    },
  };
}

function workerMetrics() {
  return {
    provider: "fake",
    model: "worker",
    tier: "tier1",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    estimatedCostUsd: 0.02,
    pricingSource: "pi-json-usage",
    ttftMs: 1,
    pollCount: 1,
    pollDurationMs: 4,
    toolDurationMs: 3,
    workerDurationMs: 8,
  };
}

function fakePiSource() {
  return `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

if (process.argv.includes("--version")) {
  console.log("fake-pi 1.0.0");
  process.exit(0);
}

const args = process.argv.slice(2);
for (const flag of ["--no-context-files", "--approve", "--tools", "-e", "--model", "--mode", "--session-dir", "-p"]) {
  if (!args.includes(flag)) throw new Error("missing worker flag " + flag);
}
if (args[args.indexOf("--tools") + 1] !== "read,grep,find,ls,edit,write") throw new Error("worker tool profile is not fixed");
if (args[args.indexOf("--mode") + 1] !== "json") throw new Error("worker mode is not json");
const nodeId = process.env.FANOUT_NODE_ID;
if (!nodeId || !process.env.FANOUT_RUN_ID || !process.env.FANOUT_WORKER_DIR || process.env.FANOUT_WORKTREE_ROOT !== process.cwd()) throw new Error("missing FANOUT worker environment");
const promptArg = args[args.indexOf("-p") + 1];
if (!promptArg?.startsWith("@")) throw new Error("missing @prompt.md argument");
const prompt = readFileSync(promptArg.slice(1), "utf8");
if (!prompt.includes(nodeId)) throw new Error("prompt does not contain node id");
if (!prompt.includes("fanout-repository-instruction-sentinel")) throw new Error("prompt does not contain curated repository instructions");

if (nodeId === "upstream") {
  writeFileSync("state.txt", "upstream\\n");
} else if (nodeId === "downstream") {
  const state = readFileSync("state.txt", "utf8").trim();
  if (state !== "upstream") throw new Error("dependent worker did not receive integrated upstream state: " + state);
  writeFileSync("result.txt", "saw:" + state + "\\n");
} else {
  throw new Error("unexpected node " + nodeId);
}

const observability = [
  { event: "turn_start", turnIndex: 0 },
  { event: "provider_ttft", provider: "fake", model: "worker", ttftMs: 1 },
  { event: "tool_end", toolCallId: "worker-tool", turnIndex: 0, durationMs: 2 },
  { event: "turn_end", turnIndex: 0 },
];
appendFileSync(process.env.FANOUT_OBSERVABILITY_FILE, observability.map((event) => JSON.stringify(event)).join("\\n") + "\\n");
console.log(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "fake", model: "worker", content: [{ type: "toolCall", id: "worker-tool", name: "read", arguments: { path: "value.txt" } }], usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.001 } } } }));
`;
}

function compiledPacketFakePiSource() {
  return `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";

if (process.argv.includes("--version")) {
  console.log("compiled-packet-fake-pi 1.0.0");
  process.exit(0);
}

const args = process.argv.slice(2);
const nodeId = process.env.FANOUT_NODE_ID;
const model = args[args.indexOf("--model") + 1];
if (nodeId === "compiled-edit") writeFileSync("value.txt", "compiled\\n");
else if (nodeId !== "final-validation") throw new Error("unexpected compiled packet node " + nodeId);

const [provider, ...modelParts] = model.split("/");
const actualModel = modelParts.join("/");
appendFileSync(process.env.FANOUT_OBSERVABILITY_FILE, [{ event: "turn_start", turnIndex: 0 }, { event: "provider_ttft", provider, model: actualModel, ttftMs: 1 }, { event: "turn_end", turnIndex: 0 }].map((event) => JSON.stringify(event)).join("\\n") + "\\n");
console.log(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", provider, model: actualModel, usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.001 } } } }));
`;
}

function policyFakePiSource() {
  return `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (process.argv.includes("--version")) {
  console.log("policy-fake-pi 1.0.0");
  process.exit(0);
}

const args = process.argv.slice(2);
const model = args[args.indexOf("--model") + 1];
const nodeId = process.env.FANOUT_NODE_ID;
const workerDir = process.env.FANOUT_WORKER_DIR || "";
if (nodeId === "fallback" && model === "fake/async-worker") {
  console.error("provider 503 transient failure");
  appendFileSync(process.env.FANOUT_OBSERVABILITY_FILE, JSON.stringify({ event: "provider_error", runId: process.env.DOUBLEWORD_RUN_ID, provider: "fake", model: "async-worker", turnIndex: 0, responseId: "failed-response", failureCode: "retryable-service", httpStatus: 503 }) + "\\n");
  process.exit(1);
}
if (nodeId === "after-integration" || nodeId === "after-combined-repair") {
  const value = readFileSync("value.txt", "utf8").trim();
  if (value !== "good") throw new Error("downstream did not receive repaired integration state: " + value);
  writeFileSync("result.txt", "saw:" + value + "\\n");
} else if (nodeId === "validation-repair") writeFileSync("value.txt", workerDir.split("/").at(-1)?.endsWith("-validation-repair") ? "good\\n" : "bad\\n");
else if (nodeId === "integration-validation-repair") writeFileSync("value.txt", workerDir.split("/").at(-1)?.endsWith("-integration-repair") ? "bad\\n" : "good\\n");
else if (nodeId !== "empty-patch") writeFileSync("value.txt", "good\\n");
if (nodeId === "missing-metrics") process.exit(0);
if (nodeId === "worker-commit") {
  const committed = spawnSync("git", ["-c", "user.name=Fanout Smoke", "-c", "user.email=fanout-smoke@local", "commit", "-q", "-am", "worker commit"], { encoding: "utf8" });
  if (committed.status !== 0) throw new Error("worker commit fixture failed: " + committed.stderr);
}

const [provider, ...modelParts] = model.split("/");
const actualModel = modelParts.join("/");
const unsafeTool = nodeId === "unsafe-tool" ? { type: "toolCall", id: "unsafe-call", name: "bash", arguments: { command: "git -C . reset --hard" } } : undefined;
const observedTool = unsafeTool ?? { type: "toolCall", id: "worker-tool", name: "read", arguments: { path: "value.txt" } };
appendFileSync(process.env.FANOUT_OBSERVABILITY_FILE, [
  { event: "turn_start", turnIndex: 0 },
  { event: "provider_ttft", provider, model: actualModel, ttftMs: 1 },
  { event: "tool_end", toolCallId: observedTool.id, turnIndex: 0, durationMs: 2 },
  { event: "turn_end", turnIndex: 0 },
].map((event) => JSON.stringify(event)).join("\\n") + "\\n");
console.log(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", provider, model: actualModel, content: [observedTool], usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.001 } } } }));
`;
}

function initRepo(repo) {
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Fanout Smoke", "-c", "user.email=fanout-smoke@local", "commit", "-q", "-m", "initial"]);
}

function git(cwd, args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (!allowFailure && result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr || result.stdout}`);
  return result;
}

function cleanupWorktrees(repo) {
  if (!existsSync(join(repo, ".git"))) return;
  const listed = git(repo, ["worktree", "list", "--porcelain"], true);
  if (listed.status === 0) {
    const main = comparablePath(repo);
    for (const line of listed.stdout.split("\n")) {
      if (!line.startsWith("worktree ")) continue;
      const worktree = line.slice("worktree ".length);
      if (comparablePath(worktree) !== main) git(repo, ["worktree", "remove", "--force", worktree], true);
    }
  }
  git(repo, ["worktree", "prune"], true);
}

function comparablePath(path) {
  const absolute = resolve(path);
  return absolute === "/private/var" || absolute.startsWith("/private/var/") ? absolute.slice("/private".length) : absolute;
}

function writeJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonl(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function expectThrows(run, pattern, name) {
  try {
    run();
  } catch (error) {
    assert(pattern.test(error instanceof Error ? error.message : String(error)), `${name} failed with the wrong error: ${error}`);
    return;
  }
  throw new Error(`${name} did not fail`);
}

async function expectRejects(run, pattern, name) {
  try {
    await run();
  } catch (error) {
    assert(pattern.test(error instanceof Error ? error.message : String(error)), `${name} failed with the wrong error: ${error}`);
    return;
  }
  throw new Error(`${name} did not fail`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
