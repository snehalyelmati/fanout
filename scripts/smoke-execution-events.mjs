import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { correlateAttemptMetrics } from "../packages/fanout-core/src/attempt-metrics.ts";
import { allocateAttempt, completeAttempt, createNodeAttemptState } from "../packages/fanout-core/src/execution-attempt.ts";
import { EXECUTION_EVENT_NAMES, parseExecutionEvent, reduceExecutionEvent, replayExecutionEvents } from "../packages/fanout-core/src/execution-event.ts";
import { renderExecutionReport } from "../packages/fanout-core/src/execution-report.ts";
import { createExecutionEventRecorder, replayExecutionArtifacts } from "../packages/fanout-pi/src/execution-event-store.ts";
import { RuntimeEventRecorder } from "../packages/fanout-pi/src/runtime-event-recorder.ts";

const root = mkdtempSync(join(tmpdir(), "fanout-events-"));
const trees = {
  base: "1".repeat(40),
  nodeA: "2".repeat(40),
  repaired: "4".repeat(40),
};
const packet = { path: "packet/execution-packet.json", sha256: "a".repeat(64), byteLength: 123 };
const evidence = { path: "executions/run/final-validation.json", sha256: "b".repeat(64), byteLength: 45 };
const patch = {
  patch: {
    artifact: { path: "executions/run/attempts/node-a.patch", sha256: "c".repeat(64), byteLength: 12 },
    headCommit: "3".repeat(40),
    changedPaths: ["src/a.ts"],
    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
    baseTree: trees.base,
    resultTree: trees.nodeA,
  },
};
const preflightEvidence = {
  planningCommit: { expected: "3".repeat(40), actual: "3".repeat(40), status: "matched" },
  repositoryTree: { expected: trees.base, actual: trees.base, status: "matched" },
  platform: { expected: process.platform, actual: process.platform, status: "matched" },
  worker: {
    extension: { requested: "packages/fanout-pi/src/index.ts", resolved: "/repo/packages/fanout-pi/src/index.ts", status: "available" },
    launcher: { executable: process.execPath, args: ["--version"], resolvedExecutable: process.execPath, resolvedCwd: "/repo", version: process.version, status: "available" },
    modelCallableTools: ["read", "grep", "find", "ls", "edit", "write"],
  },
  commandCounts: { candidateNormalization: [2, 0], validation: [1, 1] },
  candidateNormalizationCommands: [
    commandEvidence(0, "node-a", 0, ["normalize-a"]),
    commandEvidence(0, "node-a", 1, ["normalize-b"]),
  ],
  validationCommands: [
    commandEvidence(0, "node-a", 0, ["validate"]),
    commandEvidence(1, "final-validation", 0, ["final-validate"]),
  ],
};

try {
  assert(EXECUTION_EVENT_NAMES.join(",") === "run-started,preflight-completed,confirmation-decided,attempt-allocated,attempt-completed,node-completed,final-validation-started,final-validation-completed,run-finished", "execution-event v2 does not expose exactly the nine approved transitions");
  const legacyTimestamp = allocationFor("legacy-time");
  const legacyMetrics = correlateAttemptMetrics(metricEvidence(legacyTimestamp.allocation.attemptId));
  assert(completeAttempt(legacyTimestamp.allocation, { state: legacyTimestamp.state, startedAt: "2026-07-13T00:00:00Z", finishedAt: "2026-07-13T00:00:01Z", terminalFact: { stage: "apply", code: "applied" }, fallbackAllowed: false, metrics: legacyMetrics.metrics }).durationMs === 1000, "serialized-event hardening changed the existing completeAttempt timestamp contract");
  const dryEvents = [
    event(1, "run-started", { mode: "dry-run", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 2, failFast: false, fallbackAllowed: false } }),
    event(2, "preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }),
    event(3, "run-finished", { outcome: "dry-run-completed", durationMs: 2, cause: { kind: "event", eventSequence: 2, code: "dry-run" } }),
  ];
  const dry = replayExecutionEvents(dryEvents);
  assert(dry.version === 3, "execution projection did not advance to v3");
  assert(dry.preflightEvidence.validationCommands[0].manifest.args[0] === "validate", "projection discarded strict preflight evidence");
  assert(dry.mode === "dry-run" && dry.terminalOutcome?.outcome === "dry-run-completed", "A14 lost the explicit dry-run outcome");
  assert(dry.finalValidation.disposition === "not-run" && dry.finalValidation.reason === "dry-run", "A14 inferred final validation from absence");
  assert(dry.phase === "finished" && dry.lastEventSequence === 3, "dry-run projection did not terminate explicitly");
  expectThrow(() => replayExecutionEvents([dryEvents[0], dryEvents[1], event(3, "run-finished", { outcome: "failed", durationMs: 2, cause: { kind: "controller", stage: "preflight", code: "internal-failure", detail: "cannot override dry-run completion" } })]), "controller failure overrode passed dry-run preflight");

  const declinedEvents = [
    event(1, "run-started", { mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false } }),
    event(2, "preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }),
    event(3, "confirmation-decided", { decision: "declined" }),
    event(4, "run-finished", { outcome: "aborted", durationMs: 3, cause: { kind: "event", eventSequence: 3, code: "confirmation-declined" } }),
  ];
  const declined = replayExecutionEvents(declinedEvents);
  assert(declined.terminalOutcome?.outcome === "aborted" && declined.finalValidation.disposition === "not-run" && declined.finalValidation.reason === "aborted", "declined confirmation did not reduce to an explicit abort");
  expectThrow(() => replayExecutionEvents(declinedEvents.slice(0, -1).concat(event(4, "run-finished", { outcome: "failed", durationMs: 3, cause: { kind: "controller", stage: "confirmation", code: "internal-failure", detail: "cannot override decline" } }))), "controller failure overrode declined confirmation");
  const failedPreflight = replayExecutionEvents([
    event(1, "run-started", { mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false } }),
    event(2, "preflight-completed", { status: "failed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [{ code: "repository-tree-mismatch", detail: "repository tree changed" }] }),
    event(3, "run-finished", { outcome: "failed", durationMs: 2, cause: { kind: "event", eventSequence: 2, code: "preflight-failed" } }),
  ]);
  assert(failedPreflight.terminalOutcome?.outcome === "failed" && failedPreflight.finalValidation.disposition === "not-run" && failedPreflight.finalValidation.reason === "upstream-failure", "failed preflight did not produce an explicit upstream failure");
  const controllerFailed = replayExecutionEvents([
    event(1, "run-started", { mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false } }),
    event(2, "preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }),
    event(3, "confirmation-decided", { decision: "accepted" }),
    event(4, "run-finished", { outcome: "failed", durationMs: 3, cause: { kind: "controller", stage: "attempts", code: "internal-failure", detail: "controller stopped before allocation" } }),
  ]);
  assert(controllerFailed.terminalOutcome?.cause.kind === "controller", "typed internal controller failure required a fabricated domain event");
  expectThrow(() => replayExecutionEvents([
    event(1, "run-started", { mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false } }),
    event(2, "run-finished", { outcome: "failed", durationMs: 1, cause: { kind: "controller", stage: "final-validation", code: "internal-failure", detail: "wrong stage" } }),
  ]), "controller cause contradicted the current phase");

  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], surprise: true }), "unknown event field was admitted");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], version: 1 }), "legacy execution event v1 was admitted");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, mode: "preview" } }), "unknown run mode was admitted");
  const { fallbackAllowed: _fallbackAllowed, ...incompletePolicy } = dryEvents[0].payload.policy;
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, policy: incompletePolicy } }), "run-started admitted an incomplete immutable runtime policy");
  const { preflightEvidence: _preflightEvidence, ...missingPreflightEvidence } = dryEvents[0].payload;
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: missingPreflightEvidence }), "run-started admitted missing strict preflight evidence");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, worker: { ...preflightEvidence.worker, modelCallableTools: "read" } } } }), "run-started admitted malformed preflight evidence");
  const { version: _launcherVersion, ...incompleteLauncher } = preflightEvidence.worker.launcher;
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, worker: { ...preflightEvidence.worker, launcher: incompleteLauncher } } } }), "run-started admitted incomplete preflight evidence");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, candidateNormalizationCommands: [...preflightEvidence.candidateNormalizationCommands].reverse() } } }), "run-started admitted reordered command evidence");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, platform: { ...preflightEvidence.platform, actual: "contradictory-platform" } } } }), "run-started admitted contradictory preflight evidence");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, repositoryTree: { expected: trees.nodeA, actual: trees.nodeA, status: "matched" } } } }), "run-started admitted a repository-tree expectation outside its planning-base authority");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, worker: { ...preflightEvidence.worker, launcher: { ...preflightEvidence.worker.launcher, status: "unavailable" } } } } }), "run-started admitted an unavailable launcher with a successful version");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, worker: { ...preflightEvidence.worker, launcher: { ...preflightEvidence.worker.launcher, status: "unavailable", resolvedCwd: null, version: null } } } } }), "run-started admitted partial unavailable launcher resolution");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, validationCommands: [{ ...preflightEvidence.validationCommands[0], resolution: { status: "unavailable", resolvedExecutable: process.execPath, resolvedCwd: null } }] } } }), "run-started admitted partial unavailable command resolution");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, candidateNormalizationCommands: [preflightEvidence.candidateNormalizationCommands[0], { ...preflightEvidence.candidateNormalizationCommands[1], nodeId: "node-b" }] } } }), "run-started admitted multiple node IDs for one packet index");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, validationCommands: [{ ...preflightEvidence.validationCommands[0], nodeId: "node-b" }] } } }), "run-started admitted contradictory node IDs across command evidence groups");
  expectThrow(() => parseExecutionEvent({ ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, validationCommands: [{ ...preflightEvidence.validationCommands[0], packetNodeIndex: 999, nodeId: "not-in-this-run" }] } } }), "run-started admitted command evidence outside packet node order");
  expectThrow(() => replayExecutionEvents([
    { ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, worker: { ...preflightEvidence.worker, extension: { ...preflightEvidence.worker.extension, resolved: null, status: "unavailable" } } } } },
    dryEvents[1],
  ]), "passed preflight contradicted unavailable worker evidence");
  expectThrow(() => replayExecutionEvents([
    { ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, repositoryTree: { expected: trees.base, actual: trees.nodeA, status: "mismatched" } } } },
    dryEvents[1],
  ]), "passed preflight contradicted repository-tree evidence");
  expectThrow(() => replayExecutionEvents([
    { ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, validationCommands: [] } } },
    dryEvents[1],
  ]), "passed preflight admitted omitted validation-command evidence");
  expectThrow(() => replayExecutionEvents([
    { ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, candidateNormalizationCommands: preflightEvidence.candidateNormalizationCommands.slice(0, 1) } } },
    dryEvents[1],
  ]), "passed preflight admitted omitted candidate-normalization evidence");
  expectThrow(() => parseExecutionEvent({
    ...dryEvents[0],
    payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, commandCounts: { ...preflightEvidence.commandCounts, validation: ["one", 0] } } },
  }), "run-started admitted malformed command counts");
  expectThrow(() => replayExecutionEvents([
    { ...dryEvents[0], payload: { ...dryEvents[0].payload, preflightEvidence: { ...preflightEvidence, commandCounts: { ...preflightEvidence.commandCounts, validation: [0, 0] }, validationCommands: [] } } },
    dryEvents[1],
  ]), "passed preflight admitted zero final-validation evidence");
  const duplicateCommands = parseExecutionEvent(event(7, "final-validation-started", { commandIdentities: ["validation:duplicate", "validation:duplicate"], expectedTree: trees.base }));
  assert(duplicateCommands.payload.commandIdentities.length === 2, "final-validation event admission discarded or rejected ordered duplicate commands");
  expectThrow(() => replayExecutionEvents([dryEvents[0], { ...dryEvents[1], sequence: 3 }]), "gapped log was admitted");
  expectThrow(() => replayExecutionEvents([dryEvents[0], { ...dryEvents[1], runId: "other" }]), "mixed run IDs were admitted");
  expectThrow(() => replayExecutionEvents([dryEvents[0], { ...dryEvents[1], payload: { ...dryEvents[1].payload, repositoryTree: trees.nodeA } }]), "passed preflight admitted repository drift");
  expectThrow(() => reduceExecutionEvent(dry, dryEvents[2]), "event after terminal outcome was admitted");

  const { allocation, outcome } = acceptedOutcome();
  const liveEvents = [
    event(1, "run-started", { mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: true, fallbackAllowed: false } }),
    event(2, "preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }),
    event(3, "confirmation-decided", { decision: "accepted" }),
    event(4, "attempt-allocated", { allocation }),
    event(5, "attempt-completed", { outcome, acceptedTransition: patch }),
    event(6, "node-completed", { nodeId: "node-a", status: "succeeded", cause: { attemptId: allocation.attemptId } }),
    event(7, "final-validation-started", { commandIdentities: ["validation:0"], expectedTree: trees.nodeA }),
    event(8, "final-validation-completed", { status: "passed", commandCount: 1, durationMs: 3, evidence, expectedTree: trees.nodeA, beforeTree: trees.nodeA, afterTree: trees.nodeA }),
    event(9, "run-finished", { outcome: "completed", durationMs: 8, cause: { kind: "event", eventSequence: 8, code: "final-validation-passed" } }),
  ];
  const live = replayExecutionEvents(liveEvents);
  assert(live.acceptedLedger.length === 1 && live.acceptedLedger[0].transition.patch.resultTree === trees.nodeA, "accepted ledger did not preserve the exact transition");
  assert(live.nodes[0].status === "succeeded" && live.finalValidation.disposition === "passed", "live lifecycle did not converge");
  assert(live.totals.attempts === 1 && live.totals.totalTokens === 3 && live.totals.filesChanged === 1, "projection totals did not derive from outcomes and ledger");
  const report = renderExecutionReport(live);
  const cwd = process.cwd();
  const prior = process.env.FANOUT_REPORT_TEST;
  process.chdir(root);
  process.env.FANOUT_REPORT_TEST = "changed";
  assert(renderExecutionReport(live) === report, "report depends on cwd or environment");
  process.chdir(cwd);
  if (prior === undefined) delete process.env.FANOUT_REPORT_TEST;
  else process.env.FANOUT_REPORT_TEST = prior;
  assert(report.includes("Outcome: **completed**") && report.endsWith("\n"), "deterministic report omitted the explicit outcome or canonical newline");
  expectThrow(() => replayExecutionEvents(liveEvents.slice(0, -1).concat(event(9, "run-finished", { outcome: "failed", durationMs: 8, cause: { kind: "controller", stage: "final-validation", code: "internal-failure", detail: "cannot override passed final validation" } }))), "controller failure overrode passed final validation");

  expectThrow(() => replayExecutionEvents(liveEvents.map((item) => item.event === "attempt-allocated" ? { ...item, payload: { allocation: { ...allocation, budgetTransition: { ...allocation.budgetTransition, before: 1, after: 2 } } } } : item)), "budget reset/overflow was admitted");
  expectThrow(() => replayExecutionEvents(liveEvents.filter((item) => item.event !== "attempt-allocated").map((item, index) => ({ ...item, sequence: index + 1 }))), "completion without allocation was admitted");
  expectThrow(() => replayExecutionEvents(liveEvents.map((item) => item.event === "final-validation-started" ? { ...item, payload: { ...item.payload, expectedTree: trees.base } } : item)), "final validation targeted a stale accepted tree");
  expectThrow(() => replayExecutionEvents(liveEvents.map((item) => item.event === "final-validation-completed" ? { ...item, payload: { ...item.payload, commandCount: 2 } } : item)), "final-validation aggregate contradicted its launched commands");
  expectThrow(() => replayExecutionEvents(liveEvents.map((item) => item.event === "run-finished" ? { ...item, payload: { ...item.payload, cause: { ...item.payload.cause, attemptId: "node-a:000001" } } } : item)), "completed cause admitted an inapplicable attempt reference");

  const finalRepairLaunch = allocateAttempt(createNodeAttemptState("final-validation"), {
    runId: "run",
    nodeId: "final-validation",
    kind: "validation-repair",
    assignment: { tier: "tier1", provider: "test", model: "worker" },
    sourceFinalValidationEvidence: evidence,
  });
  const finalRepairMetrics = correlateAttemptMetrics(metricEvidence(finalRepairLaunch.allocation.attemptId));
  const finalRepairOutcome = completeAttempt(finalRepairLaunch.allocation, {
    state: finalRepairLaunch.state,
    startedAt: "2026-07-13T00:00:00.008Z",
    finishedAt: "2026-07-13T00:00:00.009Z",
    terminalFact: { stage: "apply", code: "applied" },
    fallbackAllowed: true,
    metrics: finalRepairMetrics.metrics,
  });
  const repairTransition = { patch: { ...patch.patch, artifact: { ...patch.patch.artifact, path: "executions/run/attempts/final-repair.patch", sha256: "d".repeat(64) }, baseTree: trees.nodeA, resultTree: trees.repaired } };
  const repairedValidation = replayExecutionEvents([
    ...liveEvents.slice(0, 7),
    event(8, "attempt-allocated", { allocation: finalRepairLaunch.allocation }),
    event(9, "attempt-completed", { outcome: finalRepairOutcome, acceptedTransition: repairTransition }),
    event(10, "final-validation-completed", { status: "passed", commandCount: 1, durationMs: 3, evidence, expectedTree: trees.repaired, beforeTree: trees.repaired, afterTree: trees.repaired }),
    event(11, "run-finished", { outcome: "completed", durationMs: 10, cause: { kind: "event", eventSequence: 10, code: "final-validation-passed" } }),
  ]);
  assert(repairedValidation.finalValidation.expectedTree === trees.repaired && repairedValidation.acceptedLedger.length === 2, "final-validation repair did not roll projection authority to the validated accepted tree");

  const bridgeDir = join(root, "runtime-recorder-bridge");
  const bridge = new RuntimeEventRecorder(bridgeDir, "run");
  await bridge.record("run-started", startedPayload({ mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: true } }));
  await bridge.record("preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] });
  await bridge.record("confirmation-decided", { decision: "accepted" });
  const bridged = acceptedOutcome();
  await bridge.recordAttemptAllocated(bridged.allocation);
  await bridge.recordAttemptCompleted(bridged.outcome, patch);
  await bridge.flush();
  assert(bridge.projection().attempts[0].outcome?.action === "accept" && bridge.projection().lastEventSequence === 5, "runtime recorder did not preserve allocation/completion order");
  await expectReject(bridge.recordAttemptAllocated({ ...bridged.allocation, attemptId: "wrong-run:000001", runId: "wrong-run" }), "runtime recorder hid an allocation publication failure");

  const publicationDir = join(root, "runtime-recorder-publication-failure");
  let failAllocationPublication = false;
  const publicationBridge = new RuntimeEventRecorder(publicationDir, "run", {
    replace: (path, bytes, kind) => {
      if (kind === "events" && failAllocationPublication) throw new Error("injected allocation publication failure");
      atomicTestReplace(path, bytes);
    },
  });
  await publicationBridge.record("run-started", startedPayload({ mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: true } }));
  await publicationBridge.record("preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] });
  await publicationBridge.record("confirmation-decided", { decision: "accepted" });
  failAllocationPublication = true;
  const laterSideEffect = join(publicationDir, "worker-launched");
  let rejected = false;
  try {
    await publicationBridge.recordAttemptAllocated(bridged.allocation);
    writeFileSync(laterSideEffect, "should not exist\n");
  } catch {
    rejected = true;
  }
  assert(rejected && !existsSync(laterSideEffect), "allocation publication failure allowed a later runtime side effect");

  const routed = routedOutcome();
  expectThrow(() => replayExecutionEvents([
    event(1, "run-started", { mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: true, fallbackAllowed: true } }),
    event(2, "preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }),
    event(3, "confirmation-decided", { decision: "accepted" }),
    event(4, "attempt-allocated", { allocation: routed.allocation }),
    event(5, "attempt-completed", { outcome: routed.outcome }),
    event(6, "node-completed", { nodeId: "node-a", status: "failed", cause: { attemptId: routed.allocation.attemptId } }),
  ]), "retry-routed attempt was misreported as a terminal node failure");
  expectThrow(() => replayExecutionEvents([
    event(1, "run-started", { mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: true, fallbackAllowed: true } }),
    event(2, "preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }),
    event(3, "confirmation-decided", { decision: "accepted" }),
    event(4, "attempt-allocated", { allocation: routed.allocation }),
    event(5, "run-finished", { outcome: "failed", durationMs: 4, cause: { kind: "controller", stage: "attempts", code: "internal-failure", detail: "worker disappeared" } }),
  ]), "terminal run outcome stranded an allocated attempt");

  const parallelDir = join(root, "parallel");
  const recorder = createExecutionEventRecorder({ runDir: parallelDir, runId: "run", now: clock() });
  await recorder.record("run-started", startedPayload({ mode: "live", packet, planningBaseTree: trees.base, nodeIds: ["node-a", "node-b"], policy: { maxConcurrency: 2, failFast: false, fallbackAllowed: true } }));
  await recorder.record("preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] });
  await recorder.record("confirmation-decided", { decision: "accepted" });
  const a = allocationFor("node-a");
  const b = allocationFor("node-b");
  await Promise.all([
    recorder.record("attempt-allocated", { allocation: a.allocation }),
    recorder.record("attempt-allocated", { allocation: b.allocation }),
  ]);
  const parallelLog = readFileSync(join(parallelDir, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert(parallelLog.map((item) => item.sequence).join(",") === "1,2,3,4,5", "parallel recorder commits were not gapless");

  const postRenameDir = join(root, "post-log-rename");
  let failAfterLogReplace = true;
  const postRename = createExecutionEventRecorder({
    runDir: postRenameDir,
    runId: "run",
    now: clock(),
    replace: (path, bytes, kind) => {
      atomicTestReplace(path, bytes);
      if (kind === "events" && failAfterLogReplace) {
        failAfterLogReplace = false;
        throw new Error("injected post-log-rename failure");
      }
    },
  });
  await expectReject(postRename.record("run-started", startedPayload({ mode: "dry-run", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false } })), "post-log-rename failure was not surfaced");
  await expectReject(postRename.record("preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }), "recorder continued after ambiguous event publication");
  assert(replayExecutionArtifacts(postRenameDir).lastEventSequence === 1, "A13 did not preserve and replay the complete new log after rename");

  let projectionWrites = 0;
  const tornDir = join(root, "torn");
  const torn = createExecutionEventRecorder({
    runDir: tornDir,
    runId: "run",
    now: clock(),
    replace: (path, bytes, kind) => {
      if (kind === "projection" && ++projectionWrites === 2) {
        throw new Error("injected projection failure");
      }
      atomicTestReplace(path, bytes);
    },
  });
  await torn.record("run-started", startedPayload({ mode: "dry-run", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false } }));
  await expectReject(torn.record("preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }), "projection failure did not stop the recorder");
  assert(readFileSync(join(tornDir, "events.jsonl"), "utf8").trim().split("\n").length === 2, "A13 lost the committed authoritative log");
  assert(JSON.parse(readFileSync(join(tornDir, "execution-run.json"), "utf8")).lastEventSequence === 1, "projection failure did not leave the older complete view");
  await expectReject(torn.record("run-finished", { outcome: "dry-run-completed", durationMs: 2, cause: { kind: "event", eventSequence: 2, code: "dry-run" } }), "recorder continued side effects after derived publication failure");
  writeFileSync(join(tornDir, "summary.md"), "stale report\n");
  const repaired = replayExecutionArtifacts(tornDir);
  assert(repaired.lastEventSequence === 2 && !existsSync(join(tornDir, "summary.md")), "A13 replay published or retained a nonterminal summary");

  const terminalDir = join(root, "terminal-report");
  let failReport = true;
  const terminal = createExecutionEventRecorder({
    runDir: terminalDir,
    runId: "run",
    now: clock(),
    replace: (path, bytes, kind) => {
      if (kind === "report" && failReport) {
        failReport = false;
        throw new Error("injected report failure");
      }
      atomicTestReplace(path, bytes);
    },
  });
  await terminal.record("run-started", startedPayload({ mode: "dry-run", packet, planningBaseTree: trees.base, nodeIds: ["node-a"], policy: { maxConcurrency: 1, failFast: false, fallbackAllowed: false } }));
  await terminal.record("preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] });
  await expectReject(terminal.record("run-finished", { outcome: "dry-run-completed", durationMs: 2, cause: { kind: "event", eventSequence: 2, code: "dry-run" } }), "terminal report failure was not surfaced");
  const repairedTerminal = replayExecutionArtifacts(terminalDir);
  assert(repairedTerminal.terminalOutcome?.outcome === "dry-run-completed" && readFileSync(join(terminalDir, "summary.md"), "utf8").includes("dry-run-completed"), "terminal replay did not preserve the committed outcome");

  writeFileSync(join(tornDir, "events.jsonl"), `${JSON.stringify(event(2, "preflight-completed", { status: "passed", planningBaseTree: trees.base, repositoryTree: trees.base, issues: [] }))}\n`);
  expectThrow(() => replayExecutionArtifacts(tornDir), "corrupt authoritative log was repaired from its projection");

  console.log("execution event smoke passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function event(sequence, name, payload) {
  if (name === "run-started") payload = startedPayload(payload);
  return { schema: "fanout.execution-event", version: 2, runId: "run", sequence, occurredAt: `2026-07-13T00:00:00.${String(sequence).padStart(3, "0")}Z`, event: name, payload };
}

function startedPayload(payload) {
  const packetNodeCount = payload.nodeIds.length + 1;
  const candidateNormalizationCommands = placeFinalEvidence(preflightEvidence.candidateNormalizationCommands, payload.nodeIds.length);
  const validationCommands = placeFinalEvidence(preflightEvidence.validationCommands, payload.nodeIds.length);
  return {
    ...payload,
    preflightEvidence: {
      ...preflightEvidence,
      commandCounts: {
        candidateNormalization: countsByPacketNode(candidateNormalizationCommands, packetNodeCount),
        validation: countsByPacketNode(validationCommands, packetNodeCount),
      },
      candidateNormalizationCommands,
      validationCommands,
    },
  };
}

function placeFinalEvidence(commands, finalNodeIndex) {
  return commands.map((command) => command.nodeId === "final-validation" ? { ...command, packetNodeIndex: finalNodeIndex } : command);
}

function countsByPacketNode(commands, packetNodeCount) {
  const counts = Array(packetNodeCount).fill(0);
  for (const command of commands) counts[command.packetNodeIndex]++;
  return counts;
}

function commandEvidence(packetNodeIndex, nodeId, commandIndex, args) {
  return {
    packetNodeIndex,
    nodeId,
    commandIndex,
    manifest: { executable: process.execPath, args, cwd: null },
    resolution: { status: "available", resolvedExecutable: process.execPath, resolvedCwd: "/repo" },
  };
}

function acceptedOutcome() {
  const launch = allocationFor("node-a");
  const metrics = correlateAttemptMetrics(metricEvidence(launch.allocation.attemptId));
  assert(metrics.ok, `metric fixture is invalid: ${JSON.stringify(metrics.errors)}`);
  const outcome = completeAttempt(launch.allocation, {
    state: launch.state,
    startedAt: "2026-07-13T00:00:00.000Z",
    finishedAt: "2026-07-13T00:00:00.001Z",
    terminalFact: { stage: "apply", code: "applied" },
    fallbackAllowed: true,
    metrics: metrics.metrics,
    evidenceRefs: ["attempt/node-a"],
  });
  return { allocation: launch.allocation, outcome };
}

function routedOutcome() {
  const launch = allocationFor("node-a");
  const metrics = correlateAttemptMetrics(metricEvidence(launch.allocation.attemptId));
  const outcome = completeAttempt(launch.allocation, {
    state: launch.state,
    startedAt: "2026-07-13T00:00:00.000Z",
    finishedAt: "2026-07-13T00:00:00.001Z",
    terminalFact: { stage: "process", code: "timeout", timeoutMs: 1, durationMs: 1 },
    fallbackAllowed: true,
    metrics: metrics.metrics,
  });
  assert(outcome.action === "retry", "routed fixture did not request retry");
  return { allocation: launch.allocation, outcome };
}

function allocationFor(nodeId) {
  return allocateAttempt(createNodeAttemptState(nodeId), { runId: "run", nodeId, kind: "original", assignment: { tier: "tier1", provider: "test", model: "worker" } });
}

function metricEvidence(attemptId) {
  return {
    attemptId,
    compatibility: "generic",
    turns: [{ attemptId, turnId: "turn-1", terminal: "completed", provider: "test", model: "worker", tier: "tier1", inputTokens: 1, outputTokens: 2, totalTokens: 3, costUsd: 0.01, pricingSource: "test", responseIds: [], toolCallIds: [] }],
    responses: [],
    polls: [],
    tools: [],
    workerFirstOutputMs: 1,
    workerDurationMs: 2,
  };
}

function clock() {
  let tick = 0;
  return () => new Date(`2026-07-13T00:00:00.${String(++tick).padStart(3, "0")}Z`);
}

function atomicTestReplace(path, bytes) {
  writeFileSync(path, bytes);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function expectThrow(fn, message) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

async function expectReject(promise, message) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(message);
}
