import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactIdentity } from "../packages/fanout-core/src/artifact-identity.ts";
import { correlatedWorkerMetrics } from "../packages/fanout-pi/src/attempt-evidence.ts";
import { executeWorkerAttempt } from "../packages/fanout-pi/src/worker-attempt-execution.ts";
import { capturePlanningBase, removeReconstructedWorktree } from "../packages/fanout-pi/src/repository-identity.ts";
import { correlateAttemptMetrics, deriveAttemptMetricTotals, deriveSummedResponseTtftMs } from "../packages/fanout-core/src/attempt-metrics.ts";
import { parseAttemptRecoveryContext } from "../packages/fanout-core/src/recovery-evidence.ts";
import { FIXED_WORKER_CAPABILITIES, WORK_CONTRACT_VERSION } from "../packages/fanout-core/src/work-contract.ts";
import {
  allocateAttempt,
  appendTerminalOutcome,
  commitAttemptCompletion,
  completeAttempt,
  createNodeAttemptState,
  discardPreparedAttemptCompletion,
  parseAttemptOutcome,
  parseStageFact,
  prepareAttemptCompletion,
  remainingAttemptBudgets,
  routeAttempt,
} from "../packages/fanout-core/src/execution-attempt.ts";
import { buildCanonicalWorkerPrompt } from "../packages/fanout-pi/src/fanout-worker-contract.ts";

const assignment = { tier: "tier2", provider: "generic", model: "worker" };
const processTimeout = { stage: "process", code: "timeout", timeoutMs: 100, durationMs: 100 };
const noBudgets = { original: 0, retry: 0, fallback: 0, validationRepair: 0, integrationRepair: 0 };

// A10: only the typed fact and budget context can change routing.
const retryContext = { kind: "original", assignment, fallbackAllowed: true, remaining: { ...noBudgets, retry: 1, fallback: 1 } };
assert(routeAttempt(processTimeout, retryContext) === "retry", "typed timeout did not schedule the same-tier retry");
assert(routeAttempt({ stage: "process", code: "nonzero", exitCode: 1, durationMs: 1 }, retryContext) === "fail", "unclassified process failure retried");
assert(routeAttempt({ stage: "provider", code: "rate-limit", httpStatus: 429 }, retryContext) === "retry", "typed provider rate limit did not retry");
assert(routeAttempt({ stage: "provider", code: "authentication", httpStatus: 401 }, retryContext) === "fail", "authentication retried");
assert(routeAttempt({ stage: "provider", code: "quota" }, retryContext) === "fail", "quota exhaustion retried");
assert(routeAttempt({ stage: "provider", code: "invalid-model" }, retryContext) === "fail", "invalid model retried");
assert(routeAttempt({ stage: "worker-gate", code: "unauthorized-change" }, retryContext) === "retry", "original unauthorized candidate did not receive one clean retry");
assert(routeAttempt({ stage: "worker-gate", code: "unauthorized-change" }, { ...retryContext, kind: "retry", remaining: noBudgets }) === "fail", "repeated unauthorized candidate escaped its retry limit");
assert(routeAttempt({ stage: "worker-gate", code: "forbidden-change" }, retryContext) === "fail", "forbidden candidate retried");
assert(routeAttempt({ stage: "process", code: "user-abort", durationMs: 1 }, retryContext) === "abort", "user abort did not abort");
for (const code of ["preflight-failure", "spawn-failure", "timeout", "signal", "head-drift", "index-drift", "identity-failure", "audit-failure"]) {
  assert(routeAttempt({ stage: "candidate-normalization", code, commandIndex: 0 }, retryContext) === "fail", `candidate normalization ${code} consumed model retry authority`);
}
assert(routeAttempt({ stage: "candidate-normalization", code: "user-abort", commandIndex: 0 }, retryContext) === "abort", "candidate normalization user abort did not abort");
assert(parseStageFact({ stage: "candidate-normalization", code: "timeout", commandIndex: 1 }).commandIndex === 1, "candidate normalization command identity did not round trip");
expectThrow(() => parseStageFact({ stage: "candidate-normalization", code: "timeout", commandIndex: -1 }), "candidate normalization admitted a negative command index");
assert(routeAttempt({ stage: "validation", code: "program-failure", failedCommandIndexes: [1] }, { ...retryContext, remaining: { ...noBudgets, validationRepair: 1 } }) === "validation-repair", "typed validation failure did not repair");
assert(routeAttempt({ stage: "apply", code: "check-conflict" }, { ...retryContext, remaining: { ...noBudgets, integrationRepair: 1 } }) === "integration-repair", "typed apply conflict did not repair");
assert(routeAttempt({ stage: "apply", code: "applied" }, { ...retryContext, remaining: noBudgets }) === "accept", "applied fact did not accept");
expectThrow(() => parseStageFact({ stage: "provider", code: "vendor.retry" }), "unknown provider fact was admitted");
expectThrow(() => parseStageFact({ stage: "metrics", code: "complete", retry: true }), "unknown fact field was admitted");

let state = createNodeAttemptState("node");
const original = allocateAttempt(state, { runId: "run", nodeId: "node", kind: "original", assignment });
state = original.state;
assert(original.allocation.budgetTransition.before === 0 && original.allocation.budgetTransition.after === 1, "launch was not precharged");
assert(original.allocation.attemptId === "node:000001", "first attempt identity is not node-monotonic");
expectThrow(() => allocateAttempt(state, { runId: "run", nodeId: "node", kind: "retry", assignment, sourceAttemptId: "other:000001" }), "cross-node source attempt was admitted");
expectThrow(() => allocateAttempt(state, { runId: "run", nodeId: "node", kind: "retry", assignment, sourceAttemptId: "node:000002" }), "future source attempt was admitted");
expectThrow(() => allocateAttempt(state, { runId: "run", nodeId: "node", kind: "retry", assignment: { ...assignment, model: "changed" }, sourceAttemptId: original.allocation.attemptId }), "same-tier retry changed its assignment");
expectThrow(() => allocateAttempt(state, { runId: "run", nodeId: "node", kind: "fallback", assignment: { tier: "tier1", provider: "generic", model: "realtime" }, sourceAttemptId: original.allocation.attemptId, fallbackAllowed: true }), "fallback bypassed retry exhaustion");
const originalOutcome = finishAttempt(original.allocation, state, processTimeout);
assert(originalOutcome.action === "retry", "typed original outcome did not authorize retry");
const retry = allocateAttempt(state, { runId: "run", nodeId: "node", kind: "retry", assignment, sourceAttemptId: original.allocation.attemptId });
state = retry.state;
assert(retry.allocation.attemptId === "node:000002", "retry reset attempt identity");
assert(routeAttempt(processTimeout, { kind: "retry", assignment, fallbackAllowed: true, remaining: remainingAttemptBudgets(state) }) === "fallback", "exhausted Tier 2 retry did not route to eligible fallback");
const retryOutcome = finishAttempt(retry.allocation, state, processTimeout);
assert(retryOutcome.action === "fallback", "typed retry outcome did not authorize fallback");
const fallback = allocateAttempt(state, { runId: "run", nodeId: "node", kind: "fallback", assignment: { ...assignment, tier: "tier1", model: "realtime" }, sourceAttemptId: retry.allocation.attemptId, fallbackAllowed: true });
state = fallback.state;
assert(routeAttempt(processTimeout, { kind: "fallback", assignment: fallback.allocation.assignment, fallbackAllowed: true, remaining: remainingAttemptBudgets(state) }) === "fail", "fallback attempt escaped its fixed one-launch pool");
finishAttempt(fallback.allocation, state, processTimeout);
expectThrow(() => allocateAttempt(state, { runId: "run", nodeId: "node", kind: "retry", assignment, sourceAttemptId: fallback.allocation.attemptId }), "second same-tier retry was allocated");

const publicationCase = originalLaunch("publication-case", assignment);
const preparedPublication = prepareAttemptCompletion(publicationCase.allocation, {
  startedAt: "2026-07-13T00:00:00.000Z",
  finishedAt: "2026-07-13T00:00:00.100Z",
  terminalFact: processTimeout,
  state: publicationCase.state,
  fallbackAllowed: true,
  metrics: observedMetrics(publicationCase.allocation),
});
expectThrow(() => allocateAttempt(publicationCase.state, { runId: "run", nodeId: "publication-case", kind: "retry", assignment, sourceAttemptId: publicationCase.allocation.attemptId }), "unpublished prepared outcome became routing authority");
assert(commitAttemptCompletion(preparedPublication).action === "retry", "published prepared outcome lost its typed action");
allocateAttempt(publicationCase.state, { runId: "run", nodeId: "publication-case", kind: "retry", assignment, sourceAttemptId: publicationCase.allocation.attemptId });

const discardedCase = originalLaunch("discarded-publication", assignment);
const discardedPreparation = prepareAttemptCompletion(discardedCase.allocation, {
  startedAt: "2026-07-13T00:00:00.000Z",
  finishedAt: "2026-07-13T00:00:00.100Z",
  terminalFact: processTimeout,
  state: discardedCase.state,
  fallbackAllowed: true,
  metrics: observedMetrics(discardedCase.allocation),
});
discardPreparedAttemptCompletion(discardedPreparation);
const replacementPreparation = prepareAttemptCompletion(discardedCase.allocation, {
  startedAt: "2026-07-13T00:00:00.000Z",
  finishedAt: "2026-07-13T00:00:00.100Z",
  terminalFact: { stage: "bookkeeping", code: "failed-after-mutation" },
  state: discardedCase.state,
  fallbackAllowed: true,
  metrics: observedMetrics(discardedCase.allocation),
});
assert(commitAttemptCompletion(replacementPreparation).terminalFact.stage === "bookkeeping", "discarded publication prevented the replacement terminal outcome");

// A12: nested repair helpers share the same two node-global pools.
let nested = createNodeAttemptState("nested");
const nestedOriginal = allocateAttempt(nested, { runId: "run", nodeId: "nested", kind: "original", assignment });
nested = nestedOriginal.state;
finishAttempt(nestedOriginal.allocation, nested, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: parseAttemptRecoveryContext(validationRecoveryEvidence(nestedOriginal.allocation.attemptId)) });
const validationOne = allocateAttempt(nested, { runId: "run", nodeId: "nested", kind: "validation-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: nestedOriginal.allocation.attemptId });
nested = validationOne.state;
finishAttempt(validationOne.allocation, nested, { stage: "apply", code: "check-conflict" }, { recovery: parseAttemptRecoveryContext(integrationRecoveryEvidence(validationOne.allocation.attemptId)) });
const integrationOne = allocateAttempt(nested, { runId: "run", nodeId: "nested", kind: "integration-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: validationOne.allocation.attemptId });
nested = integrationOne.state;
finishAttempt(integrationOne.allocation, nested, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: parseAttemptRecoveryContext(validationRecoveryEvidence(integrationOne.allocation.attemptId)) });
const validationTwo = allocateAttempt(nested, { runId: "run", nodeId: "nested", kind: "validation-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: integrationOne.allocation.attemptId });
nested = validationTwo.state;
finishAttempt(validationTwo.allocation, nested, { stage: "apply", code: "check-conflict" }, { recovery: parseAttemptRecoveryContext(integrationRecoveryEvidence(validationTwo.allocation.attemptId)) });
const integrationTwo = allocateAttempt(nested, { runId: "run", nodeId: "nested", kind: "integration-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: validationTwo.allocation.attemptId });
nested = integrationTwo.state;
assert(integrationTwo.allocation.attemptId === "nested:000005", "nested repairs reset monotonic attempt identity");
assert(nested.counts.validationRepair === 2 && nested.counts.integrationRepair === 2, "nested repairs did not consume node-global pools");
expectThrow(() => allocateAttempt(nested, { runId: "run", nodeId: "nested", kind: "validation-repair", assignment, sourceAttemptId: integrationTwo.allocation.attemptId }), "third validation repair was allocated");
expectThrow(() => allocateAttempt(nested, { runId: "run", nodeId: "nested", kind: "integration-repair", assignment, sourceAttemptId: integrationTwo.allocation.attemptId }), "third integration repair was allocated");

let transientRepair = createNodeAttemptState("transient-repair");
const transientOriginal = allocateAttempt(transientRepair, { runId: "run", nodeId: "transient-repair", kind: "original", assignment });
transientRepair = transientOriginal.state;
finishAttempt(transientOriginal.allocation, transientRepair, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: parseAttemptRecoveryContext(validationRecoveryEvidence(transientOriginal.allocation.attemptId)) });
const transientValidationOne = allocateAttempt(transientRepair, { runId: "run", nodeId: "transient-repair", kind: "validation-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: transientOriginal.allocation.attemptId });
transientRepair = transientValidationOne.state;
assert(finishAttempt(transientValidationOne.allocation, transientRepair, processTimeout).action === "validation-repair", "transient validation-repair crash required fabricated validation evidence");
const transientValidationTwo = allocateAttempt(transientRepair, { runId: "run", nodeId: "transient-repair", kind: "validation-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: transientValidationOne.allocation.attemptId });
transientRepair = transientValidationTwo.state;
finishAttempt(transientValidationTwo.allocation, transientRepair, { stage: "apply", code: "check-conflict" }, { recovery: parseAttemptRecoveryContext(integrationRecoveryEvidence(transientValidationTwo.allocation.attemptId)) });
const transientIntegrationOne = allocateAttempt(transientRepair, { runId: "run", nodeId: "transient-repair", kind: "integration-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: transientValidationTwo.allocation.attemptId });
transientRepair = transientIntegrationOne.state;
assert(finishAttempt(transientIntegrationOne.allocation, transientRepair, processTimeout).action === "integration-repair", "transient integration-repair crash required fabricated apply evidence");
const transientIntegrationTwo = allocateAttempt(transientRepair, { runId: "run", nodeId: "transient-repair", kind: "integration-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: transientIntegrationOne.allocation.attemptId });
transientRepair = transientIntegrationTwo.state;
finishAttempt(transientIntegrationTwo.allocation, transientRepair, { stage: "metrics", code: "missing-timing" });

let exhaustedValidation = createNodeAttemptState("exhausted-validation");
const exhaustedOriginal = allocateAttempt(exhaustedValidation, { runId: "run", nodeId: "exhausted-validation", kind: "original", assignment });
exhaustedValidation = exhaustedOriginal.state;
finishAttempt(exhaustedOriginal.allocation, exhaustedValidation, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: parseAttemptRecoveryContext(validationRecoveryEvidence(exhaustedOriginal.allocation.attemptId)) });
const exhaustedRepairOne = allocateAttempt(exhaustedValidation, { runId: "run", nodeId: "exhausted-validation", kind: "validation-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: exhaustedOriginal.allocation.attemptId });
exhaustedValidation = exhaustedRepairOne.state;
finishAttempt(exhaustedRepairOne.allocation, exhaustedValidation, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: parseAttemptRecoveryContext(validationRecoveryEvidence(exhaustedRepairOne.allocation.attemptId)) });
const exhaustedRepairTwo = allocateAttempt(exhaustedValidation, { runId: "run", nodeId: "exhausted-validation", kind: "validation-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: exhaustedRepairOne.allocation.attemptId });
exhaustedValidation = exhaustedRepairTwo.state;
const exhaustedOutcome = finishAttempt(exhaustedRepairTwo.allocation, exhaustedValidation, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: parseAttemptRecoveryContext(validationRecoveryEvidence(exhaustedRepairTwo.allocation.attemptId)) });
assert(exhaustedOutcome.action === "fail" && exhaustedOutcome.recovery?.kind === "validation" && parseAttemptOutcome(JSON.parse(JSON.stringify(exhaustedOutcome))).recovery?.kind === "validation", "exhausted validation failure lost its typed terminal evidence");

// A11: identity correlation, not event order or provider/model equality, admits metrics.
const generic = correlateAttemptMetrics(genericEvidence(original.allocation.attemptId));
assert(generic.ok && generic.metrics?.complete && deriveAttemptMetricTotals(generic.metrics).totalTokens === 18 && deriveAttemptMetricTotals(generic.metrics).toolDurationMs === 3, `generic correlation failed: ${JSON.stringify(generic.errors)}`);
const cachedEvidence = genericEvidence(original.allocation.attemptId);
cachedEvidence.turns[0].cacheReadTokens = 2;
cachedEvidence.turns[0].cacheWriteTokens = 1;
const cached = correlateAttemptMetrics(cachedEvidence);
assert(cached.ok && deriveAttemptMetricTotals(cached.metrics).cacheReadTokens === 2 && deriveAttemptMetricTotals(cached.metrics).cacheWriteTokens === 1 && deriveAttemptMetricTotals(cached.metrics).totalTokens === 18, "overlapping cache usage did not survive strict correlation");
const forged = originalLaunch("forged", assignment);
const forgedMetrics = observedMetrics(forged.allocation, true);
expectThrow(() => completeAttempt({ ...forged.allocation, attemptId: "forged-id", budgetTransition: { name: "original", before: -1, after: 0, limit: 1 } }, { startedAt: "2026-07-13T00:00:00.000Z", finishedAt: "2026-07-13T00:00:01.000Z", terminalFact: { stage: "apply", code: "applied" }, state: forged.state, fallbackAllowed: true, metrics: forgedMetrics }), "forged allocation completed");
expectThrow(() => completeAttempt(forged.allocation, { startedAt: "2026-07-13T00:00:00.000Z", finishedAt: "2026-07-13T00:00:01.000Z", terminalFact: { stage: "apply", code: "applied" }, state: forged.state, fallbackAllowed: true, metrics: { ...forgedMetrics, complete: true } }), "forged complete metrics were accepted");
expectThrow(() => { forgedMetrics.turns[0].costUsd = 99; }, "validated metrics remained mutable");
const noTurns = genericEvidence(original.allocation.attemptId);
noTurns.turns = [];
noTurns.tools = [];
expectMetricCode(noTurns, "missing-identity");
const instrumentedEvidence = providerEvidence(original.allocation.attemptId);
const instrumented = correlateAttemptMetrics(instrumentedEvidence);
assert(instrumented.ok && deriveSummedResponseTtftMs(instrumented.metrics) === 5 && deriveAttemptMetricTotals(instrumented.metrics).pollCount === 3 && !("totals" in instrumented.metrics), `instrumented correlation failed: ${JSON.stringify(instrumented.errors)}`);
const cachedProviderEvidence = structuredClone(instrumentedEvidence);
cachedProviderEvidence.turns[0].cacheReadTokens = 10;
cachedProviderEvidence.turns[0].cacheWriteTokens = 1;
cachedProviderEvidence.responses[0].cacheReadTokens = 10;
cachedProviderEvidence.responses[0].cacheWriteTokens = 1;
assert(correlateAttemptMetrics(cachedProviderEvidence).ok, "overlapping provider cache usage was rejected");
const reordered = structuredClone(instrumentedEvidence);
reordered.responses.reverse();
reordered.tools.reverse();
assert(correlateAttemptMetrics(reordered).ok, "array order became correlation authority");

const wrongAttempt = structuredClone(instrumentedEvidence);
wrongAttempt.responses[0].attemptId = "other:000001";
expectMetricCode(wrongAttempt, "correlation-mismatch");
assert(correlateAttemptMetrics(wrongAttempt).partialMetrics.responses.every((response) => response.attemptId === original.allocation.attemptId), "cross-attempt evidence leaked into partial metrics");
const duplicateResponse = structuredClone(instrumentedEvidence);
duplicateResponse.responses.push(structuredClone(duplicateResponse.responses[0]));
expectMetricCode(duplicateResponse, "duplicate-identity");
const reusedResponseIdentity = structuredClone(instrumentedEvidence);
reusedResponseIdentity.responses[1].responseId = reusedResponseIdentity.responses[0].responseId;
reusedResponseIdentity.turns[1].responseIds[0] = reusedResponseIdentity.responses[0].responseId;
expectMetricCode(reusedResponseIdentity, "duplicate-identity");
const multiplyClaimedResponse = structuredClone(instrumentedEvidence);
multiplyClaimedResponse.turns[1].responseIds.push("response-1");
expectMetricCode(multiplyClaimedResponse, "duplicate-identity");
const reversedParent = structuredClone(instrumentedEvidence);
reversedParent.responses[0].turnId = "turn-2";
expectMetricCode(reversedParent, "correlation-mismatch");
const reversedInterval = structuredClone(instrumentedEvidence);
reversedInterval.responses[0].firstTokenAt = "2026-07-13T00:00:00.010Z";
reversedInterval.responses[0].requestedAt = "2026-07-13T00:00:00.011Z";
expectMetricCode(reversedInterval, "correlation-mismatch");
const wrongDuration = structuredClone(instrumentedEvidence);
wrongDuration.turns[0].durationMs++;
expectMetricCode(wrongDuration, "correlation-mismatch");
assert(!correlateAttemptMetrics(wrongDuration).partialMetrics.turns.some((turnEvidence) => turnEvidence.turnId === "turn-1"), "contradictory interval remained in partial evidence");
const mismatchedResponse = structuredClone(instrumentedEvidence);
mismatchedResponse.responses[0].responseId = "unknown-response";
expectMetricCode(mismatchedResponse, "correlation-mismatch");
const mismatchedProvider = structuredClone(instrumentedEvidence);
mismatchedProvider.responses[0].model = "other-model";
expectMetricCode(mismatchedProvider, "provider-evidence-mismatch");
const unknownTool = structuredClone(instrumentedEvidence);
unknownTool.tools[0].toolCallId = "unknown-tool";
expectMetricCode(unknownTool, "correlation-mismatch");
const duplicateTool = structuredClone(instrumentedEvidence);
duplicateTool.tools.push(structuredClone(duplicateTool.tools[0]));
expectMetricCode(duplicateTool, "duplicate-identity");
const multiplyClaimedTool = structuredClone(instrumentedEvidence);
multiplyClaimedTool.turns[1].toolCallIds.push("tool-1");
expectMetricCode(multiplyClaimedTool, "duplicate-identity");
const missingTool = structuredClone(instrumentedEvidence);
missingTool.tools.pop();
expectMetricCode(missingTool, "missing-tool");
const genericWithProviderRecord = genericEvidence(original.allocation.attemptId);
genericWithProviderRecord.responses.push(providerEvidence(original.allocation.attemptId).responses[0]);
expectMetricCode(genericWithProviderRecord, "provider-evidence-mismatch");
const instrumentedWithoutResponse = structuredClone(instrumentedEvidence);
instrumentedWithoutResponse.responses = [];
expectMetricCode(instrumentedWithoutResponse, "missing-measurement");
const missingPoll = structuredClone(instrumentedEvidence);
delete missingPoll.polls[0].durationMs;
expectMetricCode(missingPoll, "missing-poll");
assert(!correlateAttemptMetrics(missingPoll).partialMetrics.polls.some((poll) => poll.pollId === "poll-1"), "missing poll evidence was replaced with guessed zeroes");
const duplicatePoll = structuredClone(instrumentedEvidence);
duplicatePoll.polls.push(structuredClone(duplicatePoll.polls[0]));
expectMetricCode(duplicatePoll, "duplicate-identity");
const multiplyClaimedPoll = structuredClone(instrumentedEvidence);
multiplyClaimedPoll.responses[1].pollIds.push("poll-1");
expectMetricCode(multiplyClaimedPoll, "duplicate-identity");
const crossAttemptPoll = structuredClone(instrumentedEvidence);
crossAttemptPoll.polls[0].attemptId = "other:000001";
expectMetricCode(crossAttemptPoll, "correlation-mismatch");
const reversedPollParent = structuredClone(instrumentedEvidence);
reversedPollParent.polls[0].responseId = "response-2a";
expectMetricCode(reversedPollParent, "correlation-mismatch");

const partialEvidence = genericEvidence(original.allocation.attemptId);
delete partialEvidence.workerDurationMs;
const partial = correlateAttemptMetrics(partialEvidence);
assert(partial.ok && !partial.partialMetrics.complete && deriveAttemptMetricTotals(partial.partialMetrics).costUsd === 0.18, "failed attempt lost observed partial cost");

await workerMetricsFailureRegression();
for (const [field, observed] of Object.entries({ provider: "wrong-provider", model: "wrong-model", tier: "tier1" })) {
  const launch = originalLaunch(`invalid-${field}`, assignment);
  const evidence = genericEvidence(launch.allocation.attemptId);
  evidence.turns[0][field] = observed;
  const metrics = correlateAttemptMetrics(evidence, [{ code: "provider-evidence-mismatch", path: `worker.${field}`, message: "supplied assignment contradicts allocation" }]).partialMetrics;
  expectThrow(() => finishAttempt(launch.allocation, launch.state, { stage: "apply", code: "applied" }, { metrics }), "invalid assignment became accepted");
  const failed = finishAttempt(launch.allocation, launch.state, { stage: "metrics", code: "correlation-mismatch" }, { metrics });
  const replayed = parseAttemptOutcome(JSON.parse(JSON.stringify(failed)));
  assert(replayed.action === "fail" && replayed.metrics.status === "invalid" && replayed.metrics.turns[0][field] === observed, "contradicted assignment could not complete/replay a failed attempt with its original observation");
  const foreign = structuredClone(replayed);
  foreign.metrics.attemptId = "foreign:000001";
  expectThrow(() => parseAttemptOutcome(foreign), "invalid measurements weakened attempt identity binding");
  const validMismatch = originalLaunch(`valid-mismatch-${field}`, assignment);
  const mismatchedEvidence = genericEvidence(validMismatch.allocation.attemptId);
  mismatchedEvidence.turns[0][field] = observed;
  expectThrow(() => finishAttempt(validMismatch.allocation, validMismatch.state, { stage: "metrics", code: "correlation-mismatch" }, { metrics: correlateAttemptMetrics(mismatchedEvidence).partialMetrics }), "valid metrics weakened assignment binding");
}
for (const [start, first, finish] of [[30, 10, undefined], [undefined, 50, 20], [30, undefined, 10]]) {
  const evidence = genericEvidence("partial-order:000001");
  Object.assign(evidence.turns[0], interval(start, first, finish, "requestedAt", "firstOutputAt", "finishedAt"));
  for (const [key, value] of Object.entries({ requestedAt: start, firstOutputAt: first, finishedAt: finish })) if (value === undefined) delete evidence.turns[0][key];
  delete evidence.turns[0].durationMs;
  assert(correlateAttemptMetrics(evidence).partialMetrics.status === "invalid", "missing telemetry masked contradictory supplied timestamp ordering");
}
for (const boundary of ["start", "finish"]) {
  const evidence = genericEvidence(`partial-containment-${boundary}:000001`);
  delete evidence.turns[0].firstOutputAt;
  delete evidence.turns[0].durationMs;
  if (boundary === "start") {
    delete evidence.turns[0].finishedAt;
    Object.assign(evidence.tools[0], interval(9, undefined, 23, "startedAt", undefined, "finishedAt"));
  } else {
    delete evidence.turns[0].requestedAt;
    Object.assign(evidence.tools[0], interval(20, undefined, 31, "startedAt", undefined, "finishedAt"));
  }
  assert(correlateAttemptMetrics(evidence).partialMetrics.status === "invalid", "missing parent endpoint masked contradicted child containment");
}
const partialEnvelope = genericEvidence("partial-envelope:000001");
delete partialEnvelope.turns[0].finishedAt;
delete partialEnvelope.turns[0].durationMs;
const partialEnvelopeMetrics = correlateAttemptMetrics(partialEnvelope, [], { startedAt: "2026-07-13T00:00:00.011Z", finishedAt: "2026-07-13T00:00:00.100Z" }).partialMetrics;
assert(partialEnvelopeMetrics.status === "invalid" && partialEnvelopeMetrics.turns[0].requestedAt === "2026-07-13T00:00:00.010Z", "partial attempt interval lost its supplied out-of-envelope endpoint");
const missingResponse = providerEvidence("missing-response:000001");
missingResponse.responses.pop();
missingResponse.polls.pop();
assert(correlateAttemptMetrics(missingResponse).partialMetrics.status === "partial", "missing child response fabricated a parent usage contradiction");
missingResponse.turns[1].costUsd = 0.01;
assert(correlateAttemptMetrics(missingResponse).partialMetrics.status === "invalid", "observed response subset exceeding parent total was admitted");
const responseSpend = providerEvidence("response-spend:000001");
delete responseSpend.turns[0].costUsd;
const responseSpendMetrics = correlateAttemptMetrics(responseSpend).partialMetrics;
assert(deriveAttemptMetricTotals(responseSpendMetrics).observedCostUsd === 0.18 && deriveAttemptMetricTotals(responseSpendMetrics).costUsd === null, "verified response spend was lost or double-counted when assistant cost was missing");

const accepted = completeAttempt(forged.allocation, {
  startedAt: "2026-07-13T00:00:00.000Z",
  finishedAt: "2026-07-13T00:00:01.000Z",
  terminalFact: { stage: "apply", code: "applied" },
  state: forged.state,
  fallbackAllowed: true,
  metrics: forgedMetrics,
  evidenceRefs: ["patch.json", "validation.json"],
  diagnostic: "human-only text: 429 network crash",
});
assert(accepted.action === "accept" && accepted.disposition === "ordinary" && accepted.durationMs === 1000 && accepted.budgetTransition.name === "original", "terminal outcome lost actual action, disposition, or budget transition");
assert(accepted.version === 6, "attempt outcome did not advance to v6");
expectThrow(() => parseAttemptOutcome({ ...accepted, version: 5 }), "legacy attempt outcome v5 was admitted");
expectThrow(() => parseAttemptOutcome({ ...accepted, version: 7 }), "future attempt outcome v7 was admitted");
const mixedAttemptMetrics = structuredClone(accepted);
delete mixedAttemptMetrics.metrics.turns[0].requestedAt;
expectThrow(() => parseAttemptOutcome(mixedAttemptMetrics), "mixed-generation Attempt metrics were admitted");
const escapedEnvelope = structuredClone(accepted);
escapedEnvelope.metrics.turns[0].requestedAt = "2026-07-12T23:59:59.999Z";
escapedEnvelope.metrics.turns[0].durationMs = Date.parse(escapedEnvelope.metrics.turns[0].finishedAt) - Date.parse(escapedEnvelope.metrics.turns[0].requestedAt);
expectThrow(() => parseAttemptOutcome(escapedEnvelope), "metric interval outside the Attempt envelope was admitted");
let outcomes = appendTerminalOutcome([], accepted);
assert(outcomes.length === 1, "terminal outcome was not recorded");
expectThrow(() => appendTerminalOutcome(outcomes, accepted), "duplicate terminal outcome was admitted");

const validationRecovery = parseAttemptRecoveryContext(validationRecoveryEvidence(original.allocation.attemptId));
assert(validationRecovery.kind === "validation" && validationRecovery.commands[1].status === "timeout" && validationRecovery.commands[1].stdout === "partial output" && validationRecovery.commands[2].status === "unexecuted", "validation recovery lost ordered process evidence");
const validationContractMismatch = validationRecoveryEvidence(original.allocation.attemptId);
validationContractMismatch.workContract.validationCommands[0] = { executable: process.execPath, args: ["-e", "process.exit(0)"] };
expectThrow(() => parseAttemptRecoveryContext(validationContractMismatch), "validation recovery admitted commands different from its canonical work contract");
const recoveryPrompt = buildCanonicalWorkerPrompt({ objective: "recover", userContext: [], discoveredRepoFacts: [], assumptions: [] }, { id: "node", kind: "implement", workContract: validationRecovery.workContract }, [], validationRecovery);
assert(recoveryPrompt.startsWith("Repair the rejected candidate already present in this worktree so every validation command passes."), "validation repair prompt did not begin with the repair action");
assert(recoveryPrompt.indexOf("## Failed validation") < recoveryPrompt.indexOf("## Authorized work") && !recoveryPrompt.includes('"workContract"'), "validation repair prompt buried failure evidence or duplicated its contract");
assert(recoveryPrompt.includes('"status": "timeout"') && recoveryPrompt.includes('"status": "unexecuted"') && recoveryPrompt.includes('"stdout": "partial output"') && recoveryPrompt.includes("untrusted data"), "canonical prompt lost or failed to contain typed validation recovery evidence");
const validationCase = originalLaunch("validation-case", assignment);
const validationCaseRecovery = parseAttemptRecoveryContext(validationRecoveryEvidence(validationCase.allocation.attemptId));
const validationRepairOutcome = completeAttempt(validationCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, state: validationCase.state, fallbackAllowed: true, metrics: observedMetrics(validationCase.allocation), recovery: validationCaseRecovery });
assert(validationRepairOutcome.action === "validation-repair" && validationRepairOutcome.recovery?.kind === "validation", "validation repair outcome lost typed recovery evidence");
const replayedValidationMismatch = structuredClone(validationRepairOutcome);
replayedValidationMismatch.terminalFact.failedCommandIndexes = [0];
expectThrow(() => parseAttemptOutcome(replayedValidationMismatch), "replay admitted validation indexes that contradicted recovery evidence");
const missingRecoveryCase = originalLaunch("missing-recovery", assignment);
expectThrow(() => completeAttempt(missingRecoveryCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, state: missingRecoveryCase.state, fallbackAllowed: true, metrics: observedMetrics(missingRecoveryCase.allocation) }), "validation repair action omitted typed recovery evidence");
finishAttempt(missingRecoveryCase.allocation, missingRecoveryCase.state, { stage: "metrics", code: "missing-timing" });

const integrationRecovery = parseAttemptRecoveryContext(integrationRecoveryEvidence(original.allocation.attemptId));
const integrationPrompt = buildCanonicalWorkerPrompt({ objective: "integrate", userContext: [], discoveredRepoFacts: [], assumptions: [] }, { id: "node", kind: "implement", workContract: integrationRecovery.workContract }, [], integrationRecovery);
assert(integrationPrompt.startsWith("Repair the rejected candidate for application to the current accepted tree."), "integration repair prompt did not begin with the repair action");
assert(integrationPrompt.includes('"applyFailure"') && integrationPrompt.includes('"acceptedLedger"') && integrationPrompt.includes('"rejectedPatch"') && !integrationPrompt.includes('"workContract"') && !integrationPrompt.includes("## Task context"), "integration repair prompt lost evidence or retained duplicate context");
const staleBaseRecovery = integrationRecoveryEvidence(original.allocation.attemptId);
staleBaseRecovery.acceptedLedger.push({ sourceAttemptId: "node:000002", patch: patchIdentity("b", "d") });
staleBaseRecovery.reconstructedTree = "d".repeat(40);
assert(parseAttemptRecoveryContext(staleBaseRecovery).rejectedPatch.baseTree === "b".repeat(40), "parallel stale-base conflict was not representable against a prior accepted state");
const unknownBaseRecovery = structuredClone(staleBaseRecovery);
unknownBaseRecovery.rejectedPatch = patchIdentity("e", "f");
expectThrow(() => parseAttemptRecoveryContext(unknownBaseRecovery), "integration recovery admitted a rejected patch from outside the accepted state history");
const integrationCase = originalLaunch("integration-case", assignment);
const integrationCaseRecovery = parseAttemptRecoveryContext(integrationRecoveryEvidence(integrationCase.allocation.attemptId));
const integrationRepairOutcome = completeAttempt(integrationCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "apply", code: "check-conflict" }, state: integrationCase.state, fallbackAllowed: true, metrics: observedMetrics(integrationCase.allocation), recovery: integrationCaseRecovery });
assert(integrationRepairOutcome.action === "integration-repair" && integrationRepairOutcome.recovery?.kind === "integration" && integrationRepairOutcome.recovery.applyFailure.stage === "check", "integration repair lost typed apply evidence");
const replayedApplyMismatch = structuredClone(integrationRepairOutcome);
replayedApplyMismatch.recovery.applyFailure.stage = "apply";
expectThrow(() => parseAttemptOutcome(replayedApplyMismatch), "replay admitted an apply stage that contradicted the terminal fact");
const malformedRecovery = validationRecoveryEvidence(original.allocation.attemptId);
malformedRecovery.commands[2].status = "passed";
malformedRecovery.commands[2].exitCode = 0;
expectThrow(() => parseAttemptRecoveryContext(malformedRecovery), "executed command after validation failure was admitted");
const earlyUnexecuted = validationRecoveryEvidence(original.allocation.attemptId);
earlyUnexecuted.commands[0] = commandEvidence(0, "unexecuted");
expectThrow(() => parseAttemptRecoveryContext(earlyUnexecuted), "unexecuted command before first failure was admitted");
const postTreeRecovery = integrationRecoveryEvidence(original.allocation.attemptId);
postTreeRecovery.applyFailure = { stage: "post-tree", code: "tree-mismatch", exitCode: null, signal: null, timeoutMs: null, stdout: "", stderr: "tree mismatch", durationMs: 1 };
assert(parseAttemptRecoveryContext(postTreeRecovery).applyFailure.stage === "post-tree", "post-tree integration evidence was not representable");
const postTreeCase = originalLaunch("post-tree", assignment);
const postTreeCaseRecovery = integrationRecoveryEvidence(postTreeCase.allocation.attemptId);
postTreeCaseRecovery.applyFailure = { ...postTreeRecovery.applyFailure };
const postTreeOutcome = completeAttempt(postTreeCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "apply", code: "post-tree-mismatch" }, state: postTreeCase.state, fallbackAllowed: true, metrics: observedMetrics(postTreeCase.allocation), recovery: postTreeCaseRecovery });
assert(postTreeOutcome.disposition === "ordinary" && postTreeCase.state.counts.integrationRepair === 0 && postTreeOutcome.action === "fail" && postTreeOutcome.recovery?.kind === "integration" && postTreeOutcome.recovery.applyFailure.stage === "post-tree", "post-tree detail could not enter a terminal outcome");
const contradictoryValidation = validationRecoveryEvidence(original.allocation.attemptId);
contradictoryValidation.commands[0].signal = "SIGTERM";
expectThrow(() => parseAttemptRecoveryContext(contradictoryValidation), "contradictory passed command evidence was admitted");
const contradictoryApply = integrationRecoveryEvidence(original.allocation.attemptId);
contradictoryApply.applyFailure = { ...contradictoryApply.applyFailure, code: "spawn-failure", exitCode: 1 };
expectThrow(() => parseAttemptRecoveryContext(contradictoryApply), "contradictory apply process evidence was admitted");
const contradictoryPostTree = integrationRecoveryEvidence(original.allocation.attemptId);
contradictoryPostTree.applyFailure = { stage: "post-tree", code: "tree-mismatch", exitCode: 1, signal: "SIGTERM", timeoutMs: 10, stdout: "", stderr: "tree mismatch", durationMs: 1 };
expectThrow(() => parseAttemptRecoveryContext(contradictoryPostTree), "contradictory post-tree process fields were admitted");

const failedCase = originalLaunch("failed-case", assignment);
const failed = finishAttempt(failedCase.allocation, failedCase.state, processTimeout);
assert(failed.action === "retry" && deriveAttemptMetricTotals(failed.metrics).costUsd === 0.18, "partial failed-attempt outcome lost routing or cost");
const replayedFailed = parseAttemptOutcome(JSON.parse(JSON.stringify(failed)));
assert(!replayedFailed.metrics.complete && deriveAttemptMetricTotals(replayedFailed.metrics).costUsd === 0.18, "serialized partial failed-attempt metrics did not round-trip conservatively");
const contradictoryTimingCase = originalLaunch("contradictory-timing", assignment);
const contradictoryTimingEvidence = genericEvidence(contradictoryTimingCase.allocation.attemptId);
for (const turnEvidence of contradictoryTimingEvidence.turns) {
  turnEvidence.tier = contradictoryTimingCase.allocation.assignment.tier;
  turnEvidence.provider = contradictoryTimingCase.allocation.assignment.provider;
  turnEvidence.model = contradictoryTimingCase.allocation.assignment.model;
}
contradictoryTimingEvidence.turns[0].durationMs++;
const contradictoryTimingMetrics = correlateAttemptMetrics(contradictoryTimingEvidence);
const contradictoryTimingOutcome = completeAttempt(contradictoryTimingCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "metrics", code: "missing-timing" }, state: contradictoryTimingCase.state, fallbackAllowed: true, metrics: contradictoryTimingMetrics.partialMetrics });
const replayedContradictoryTiming = parseAttemptOutcome(JSON.parse(JSON.stringify(contradictoryTimingOutcome)));
assert(!replayedContradictoryTiming.metrics.turns.some((turnEvidence) => turnEvidence.turnId === "turn-1"), "failed Attempt replay admitted contradictory interval evidence");
const ambiguousClaimCase = originalLaunch("ambiguous-claim", assignment);
const ambiguousClaimEvidence = genericEvidence(ambiguousClaimCase.allocation.attemptId);
for (const turnEvidence of ambiguousClaimEvidence.turns) {
  turnEvidence.tier = ambiguousClaimCase.allocation.assignment.tier;
  turnEvidence.provider = ambiguousClaimCase.allocation.assignment.provider;
  turnEvidence.model = ambiguousClaimCase.allocation.assignment.model;
}
ambiguousClaimEvidence.turns[1].toolCallIds.push("tool-1");
const ambiguousClaimMetrics = correlateAttemptMetrics(ambiguousClaimEvidence);
assert(!ambiguousClaimMetrics.partialMetrics.turns.some((turnEvidence) => turnEvidence.toolCallIds.includes("tool-1")) && !ambiguousClaimMetrics.partialMetrics.tools.some((tool) => tool.toolCallId === "tool-1"), "ambiguous child authority survived partial correlation");
const ambiguousClaimOutcome = completeAttempt(ambiguousClaimCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "metrics", code: "duplicate-identity" }, state: ambiguousClaimCase.state, fallbackAllowed: true, metrics: ambiguousClaimMetrics.partialMetrics });
const replayedAmbiguousClaim = parseAttemptOutcome(JSON.parse(JSON.stringify(ambiguousClaimOutcome)));
assert(!replayedAmbiguousClaim.metrics.turns.some((turnEvidence) => turnEvidence.toolCallIds.includes("tool-1")) && !replayedAmbiguousClaim.metrics.tools.some((tool) => tool.toolCallId === "tool-1"), "failed Attempt replay admitted ambiguous parent/child authority");
const forgedAmbiguousReplay = structuredClone(ambiguousClaimOutcome);
forgedAmbiguousReplay.metrics.turns[0].toolCallIds.push("tool-1");
forgedAmbiguousReplay.metrics.turns[1].toolCallIds.push("tool-1");
forgedAmbiguousReplay.metrics.tools.push(ambiguousClaimEvidence.tools[0]);
expectThrow(() => parseAttemptOutcome(forgedAmbiguousReplay), "ambiguous failed-Attempt evidence was admitted on replay");
const filteredPartialCase = originalLaunch("filtered-partial", assignment);
const filteredEvidence = genericEvidence(filteredPartialCase.allocation.attemptId);
for (const turnEvidence of filteredEvidence.turns) {
  turnEvidence.tier = filteredPartialCase.allocation.assignment.tier;
  turnEvidence.provider = filteredPartialCase.allocation.assignment.provider;
  turnEvidence.model = filteredPartialCase.allocation.assignment.model;
}
filteredEvidence.turns[1].totalTokens--;
const filteredMetrics = correlateAttemptMetrics(filteredEvidence);
assert(!filteredMetrics.ok && !filteredMetrics.partialMetrics.complete, "filtered partial fixture unexpectedly correlated");
const filteredPartialOutcome = completeAttempt(filteredPartialCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "metrics", code: "usage-mismatch" }, state: filteredPartialCase.state, fallbackAllowed: true, metrics: filteredMetrics.partialMetrics });
const replayedFilteredPartial = parseAttemptOutcome(JSON.parse(JSON.stringify(filteredPartialOutcome)));
assert(!replayedFilteredPartial.metrics.complete && deriveAttemptMetricTotals(replayedFilteredPartial.metrics).observedCostUsd === 0.06, "filtered partial metrics became complete or lost observed cost during replay");
for (const diagnostic of ["429", "503", "network", "crash", "authentication failed", "quota exhausted"]) {
  const proseCase = originalLaunch(`prose-${diagnostic.replace(/\W+/g, "-")}`, assignment);
  const proseOutcome = finishAttempt(proseCase.allocation, proseCase.state, { stage: "process", code: "nonzero", exitCode: 1, durationMs: 100 }, { diagnostic });
  assert(proseOutcome.action === "fail" && proseOutcome.diagnostic === diagnostic, `diagnostic prose changed typed routing: ${diagnostic}`);
}
const incompleteCase = originalLaunch("incomplete", assignment);
const partialAccepted = completeAttempt(incompleteCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "apply", code: "applied" }, state: incompleteCase.state, fallbackAllowed: true, metrics: observedMetrics(incompleteCase.allocation) });
assert(partialAccepted.action === "accept" && partialAccepted.metrics.status === "partial" && parseAttemptOutcome(JSON.parse(JSON.stringify(partialAccepted))).action === "accept", "missing measurements blocked acceptance or replay");
expectThrow(() => completeAttempt(forged.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "metrics", code: "complete" }, state: forged.state, fallbackAllowed: true, metrics: forgedMetrics }), "one allocation produced two terminal outcomes");

let noProgressState = createNodeAttemptState("no-progress");
const noProgressOriginal = allocateAttempt(noProgressState, { runId: "run", nodeId: "no-progress", kind: "original", assignment });
noProgressState = noProgressOriginal.state;
const noProgressSource = parseAttemptRecoveryContext(validationRecoveryEvidence(noProgressOriginal.allocation.attemptId));
finishAttempt(noProgressOriginal.allocation, noProgressState, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: noProgressSource });
const noProgressRepair = allocateAttempt(noProgressState, { runId: "run", nodeId: "no-progress", kind: "validation-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: noProgressOriginal.allocation.attemptId });
noProgressState = noProgressRepair.state;
const noProgressCurrent = parseAttemptRecoveryContext(validationRecoveryEvidence(noProgressRepair.allocation.attemptId));
noProgressCurrent.commands[1].durationMs += 50;
noProgressCurrent.rejectedPatch.artifact.path = "workers/no-progress/attempts/002-validation-repair/patch.bin";
const noProgressOutcome = finishAttempt(noProgressRepair.allocation, noProgressState, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: noProgressCurrent, repairSource: noProgressSource });
assert(noProgressOutcome.action === "fail"
  && noProgressOutcome.disposition === "exact-no-progress"
  && noProgressOutcome.repairProgress?.disposition === "exact-no-progress"
  && noProgressOutcome.repairProgress.candidateEqual
  && noProgressOutcome.repairProgress.failureEqual
  && !noProgressOutcome.repairProgress.progressed
  && noProgressState.counts.validationRepair === 1, "attempt-local artifact path or duration change consumed the remaining repair budget");
const missingProgress = structuredClone(noProgressOutcome);
delete missingProgress.repairProgress;
expectThrow(() => parseAttemptOutcome(missingProgress), "failed repair outcome omitted mandatory exact progress evidence");

let progressState = createNodeAttemptState("progress");
const progressOriginal = allocateAttempt(progressState, { runId: "run", nodeId: "progress", kind: "original", assignment });
progressState = progressOriginal.state;
const progressSource = parseAttemptRecoveryContext(validationRecoveryEvidence(progressOriginal.allocation.attemptId));
finishAttempt(progressOriginal.allocation, progressState, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: progressSource });
const progressRepair = allocateAttempt(progressState, { runId: "run", nodeId: "progress", kind: "validation-repair", assignment: { ...assignment, tier: "tier1" }, sourceAttemptId: progressOriginal.allocation.attemptId });
progressState = progressRepair.state;
const progressCurrent = parseAttemptRecoveryContext(validationRecoveryEvidence(progressRepair.allocation.attemptId));
progressCurrent.commands[1].stderr = "different exact output";
const progressOutcome = finishAttempt(progressRepair.allocation, progressState, { stage: "validation", code: "timeout", failedCommandIndexes: [1] }, { recovery: progressCurrent, repairSource: progressSource });
assert(progressOutcome.action === "validation-repair"
  && progressOutcome.disposition === "changed"
  && progressOutcome.repairProgress?.disposition === "changed"
  && progressOutcome.repairProgress.candidateEqual
  && !progressOutcome.repairProgress.failureEqual
  && progressOutcome.repairProgress.progressed, "changed exact failure output was falsely terminated as no-progress");

console.log("attempt outcomes smoke passed (A10, A11, A12, exact no-progress)");

async function workerMetricsFailureRegression() {
  const root = mkdtempSync(join(tmpdir(), "fanout-metric-terminal-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (args) => { const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); assert(result.status === 0, `metric fixture git failed: ${result.stderr}`); };
  try {
    git(["init"]);
    writeFileSync(join(repo, "base.txt"), "base");
    git(["add", "."]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "fixture"]);
    const planningBase = capturePlanningBase(repo);
    const overlayLaunch = originalLaunch("overlay-failure", assignment);
    const overlayDir = join(root, "overlay-attempt");
    const overlayWorktree = join(overlayDir, "worktree");
    const overlayStartedAt = new Date().toISOString();
    const overlayContract = workContract();
    let overlayAttempt;
    try {
      overlayAttempt = await executeWorkerAttempt({
        packet: { objective: "fixture", planningHost: { platform: process.platform } },
        unit: { id: "overlay-failure", workContract: overlayContract }, contract: overlayContract,
        repoRoot: repo, runDir: root, runId: "run", extensionEntry: "never-launched", piCommand: "never-launched",
        workerTimeoutMs: 1000, validationTimeoutMs: 1000, planningBase, ledger: [],
        profile: { preparation: [], readiness: [], candidateNormalization: [] },
        profileIdentity: artifactIdentity("profiles/fixture.json", Buffer.from("fixture")),
        seedPatch: { patch: { artifact: artifactIdentity("missing-seed.bin", Buffer.from("missing")), headCommit: planningBase.headCommit, baseTree: planningBase.tree, resultTree: planningBase.tree, changedPaths: [], stats: { filesChanged: 0, insertions: 0, deletions: 0 } } },
        allocation: overlayLaunch.allocation, attemptDir: overlayDir, worktreePath: overlayWorktree,
        tier: { ...assignment, thinking: "off" }, kind: "original", startedAt: overlayStartedAt, fallbackAllowed: true,
      });
    } finally { removeReconstructedWorktree(repo, overlayWorktree); }
    assert(overlayAttempt.error.includes("missing-seed.bin"), "overlay fixture failed before seed artifact admission");
    assert(overlayAttempt.terminalFact.code === "infrastructure-failure" && overlayAttempt.correlatedMetrics.turns.length === 0 && !existsSync(join(overlayDir, "preparation.json")) && !existsSync(join(overlayDir, "observability.jsonl")), "repair overlay failure escaped typed setup boundary or launched worker");
    const overlayCompleted = completeAttempt(overlayLaunch.allocation, { startedAt: overlayStartedAt, finishedAt: new Date().toISOString(), terminalFact: overlayAttempt.terminalFact, state: overlayLaunch.state, fallbackAllowed: true, metrics: overlayAttempt.correlatedMetrics });
    assert(overlayCompleted.action === "retry", "overlay infrastructure failure changed bounded typed routing");
    const stdoutPath = join(root, "unmatched-stdout.jsonl");
    const observabilityPath = join(root, "unmatched-observability.jsonl");
    const measurementLaunch = originalLaunch("unmatched-record", assignment);
    writeFileSync(stdoutPath, JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "generic", model: "worker", content: [] } }) + "\n");
    for (const event of [
      { event: "turn_start", turnIndex: 99, ts: "not a timestamp" },
      { event: "assistant_ttft", ts: "2026-07-13T00:00:00.000Z" },
      { event: "tool_start", turnIndex: 99, toolCallId: 12, ts: "2026-07-13T00:00:00.000Z" },
    ]) {
      writeFileSync(observabilityPath, JSON.stringify(event) + "\n");
      const metrics = correlatedWorkerMetrics({ allocation: measurementLaunch.allocation, providerRunId: "run", stdoutPath, observabilityPath, workerDurationMs: 1 });
      assert(metrics.status === "invalid", "malformed unmatched metric record disappeared during joins");
    }
    writeFileSync(observabilityPath, JSON.stringify({ event: "turn_start", turnIndex: 99, ts: "2026-07-13T00:00:00.000Z" }) + "\n");
    const orphan = correlatedWorkerMetrics({ allocation: measurementLaunch.allocation, providerRunId: "run", stdoutPath, observabilityPath, workerDurationMs: 1 });
    assert(orphan.status === "partial" && orphan.issues.some((issue) => issue.message.includes("no matching terminal")), "unpaired valid telemetry was silently treated as complete");
    for (const mode of ["envelope", "assignment"]) {
      const launch = originalLaunch(`worker-${mode}`, assignment);
      const cli = join(root, `worker-${mode}.mjs`);
      const marker = join(root, `normalized-${mode}`);
      writeFileSync(cli, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';
const ts = '2200-01-01T00:00:00.000Z';
writeFileSync(process.env.FANOUT_OBSERVABILITY_FILE, ${JSON.stringify(mode)} === 'envelope' ? [{event:'turn_start',turnIndex:0,ts},{event:'assistant_ttft',turnIndex:0,ts},{event:'turn_end',turnIndex:0,ts}].map(value=>JSON.stringify(value)).join('\\n')+'\\n' : '');
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'generic',model:${JSON.stringify(mode === "assignment" ? "wrong-model" : "worker")},content:[]}}));
`, { mode: 0o755 });
      const startedAt = new Date().toISOString();
      const contract = workContract();
      const unit = { id: launch.allocation.nodeId, kind: "implement", workContract: contract };
      const attempt = await executeWorkerAttempt({
        packet: { objective: "fixture", userContext: [], discoveredRepoFacts: [], assumptions: [], planningHost: { platform: process.platform } },
        unit, contract, repoRoot: repo, runDir: root, runId: "run", extensionEntry: cli, piCommand: cli,
        workerTimeoutMs: 10000, validationTimeoutMs: 10000, planningBase, preparedBase: planningBase, ledger: [],
        profile: { preparation: [], readiness: [], candidateNormalization: [{ command: { executable: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`] } }] },
        profileIdentity: artifactIdentity("profiles/fixture.json", Buffer.from("fixture")),
        allocation: launch.allocation, attemptDir: join(root, `attempt-${mode}`), worktreePath: repo, tier: { ...assignment, thinking: "off" }, kind: "original", startedAt, fallbackAllowed: true,
      });
      assert(attempt.failureKind === "metrics" && attempt.correlatedMetrics.status === "invalid" && !existsSync(marker), `${mode} telemetry reached repository normalization instead of a typed metrics failure`);
      const completed = completeAttempt(launch.allocation, { startedAt, finishedAt: new Date().toISOString(), terminalFact: attempt.terminalFact, state: launch.state, fallbackAllowed: true, metrics: attempt.correlatedMetrics });
      const replayed = parseAttemptOutcome(JSON.parse(JSON.stringify(completed)));
      assert(replayed.action === "fail" && replayed.terminalFact.stage === "metrics", `${mode} telemetry left an unfinished allocated attempt`);
      assert(mode === "envelope" ? replayed.metrics.turns[0].requestedAt === "2200-01-01T00:00:00.000Z" : replayed.metrics.turns[0].model === "wrong-model", "failed metrics discarded supplied contradiction evidence");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function originalLaunch(nodeId, nextAssignment) {
  return allocateAttempt(createNodeAttemptState(nodeId), { runId: "run", nodeId, kind: "original", assignment: nextAssignment });
}

function observedMetrics(allocation, complete = false) {
  const evidence = genericEvidence(allocation.attemptId);
  for (const turnEvidence of evidence.turns) {
    turnEvidence.tier = allocation.assignment.tier;
    turnEvidence.provider = allocation.assignment.provider;
    turnEvidence.model = allocation.assignment.model;
  }
  if (!complete) delete evidence.workerDurationMs;
  const result = correlateAttemptMetrics(evidence);
  if (complete && !result.ok) throw new Error(`complete fixture metrics failed: ${JSON.stringify(result.errors)}`);
  return complete ? result.metrics : result.partialMetrics;
}

function finishAttempt(allocation, nextState, terminalFact, extra = {}) {
  if ((allocation.kind === "validation-repair" || allocation.kind === "integration-repair") && extra.recovery && !extra.repairSource) {
    const repairSource = structuredClone(extra.recovery);
    if (repairSource.kind === "integration") repairSource.applyFailure.stderr = `${repairSource.applyFailure.stderr}\ncausal source`;
    else repairSource.commands[repairSource.commands.findIndex((command) => command.status !== "passed" && command.status !== "unexecuted")].stderr += "\ncausal source";
    extra = { ...extra, repairSource };
  }
  return completeAttempt(allocation, {
    startedAt: "2026-07-13T00:00:00.000Z",
    finishedAt: "2026-07-13T00:00:00.100Z",
    terminalFact,
    state: nextState,
    fallbackAllowed: true,
    metrics: observedMetrics(allocation),
    ...extra,
  });
}

function genericEvidence(attemptId) {
  return {
    attemptId,
    compatibility: "generic",
    turns: [
      turn(attemptId, "turn-1", 4, 2, 0.06, [], ["tool-1"]),
      turn(attemptId, "turn-2", 8, 4, 0.12, [], []),
    ],
    responses: [],
    polls: [],
    tools: [{ attemptId, turnId: "turn-1", toolCallId: "tool-1", name: "read", terminal: "completed", ...interval(20, undefined, 23, "startedAt", undefined, "finishedAt") }],
    workerFirstOutputMs: 2,
    workerDurationMs: 20,
  };
}

function providerEvidence(attemptId) {
  return {
    attemptId,
    compatibility: "instrumented",
    turns: [
      turn(attemptId, "turn-1", 4, 2, 0.06, ["response-1"], ["tool-1"]),
      turn(attemptId, "turn-2", 8, 4, 0.12, ["response-2a", "response-2b"], ["tool-2"]),
    ],
    responses: [
      response(attemptId, "turn-1", "response-1", 4, 2, 0.06, 1, ["poll-1"]),
      response(attemptId, "turn-2", "response-2a", 3, 1, 0.04, 2, ["poll-2"]),
      response(attemptId, "turn-2", "response-2b", 5, 3, 0.08, 2, ["poll-3"]),
    ],
    polls: [
      poll(attemptId, "turn-1", "response-1", "poll-1", 1),
      poll(attemptId, "turn-2", "response-2a", "poll-2", 1),
      poll(attemptId, "turn-2", "response-2b", "poll-3", 2),
    ],
    tools: [
      { attemptId, turnId: "turn-1", toolCallId: "tool-1", name: "read", terminal: "completed", ...interval(20, undefined, 23, "startedAt", undefined, "finishedAt") },
      { attemptId, turnId: "turn-2", toolCallId: "tool-2", name: "write", terminal: "completed", ...interval(50, undefined, 54, "startedAt", undefined, "finishedAt") },
    ],
    workerFirstOutputMs: 2,
    workerDurationMs: 20,
  };
}

function turn(attemptId, turnId, inputTokens, outputTokens, costUsd, responseIds, toolCallIds) {
  const [start, first, finish] = turnId === "turn-1" ? [10, 12, 30] : [40, 42, 70];
  return { attemptId, turnId, terminal: "completed", provider: "generic", model: "worker", tier: "tier2", ...interval(start, first, finish, "requestedAt", "firstOutputAt", "finishedAt"), inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: inputTokens + outputTokens, costUsd, pricingSource: "catalog-v1", responseIds, toolCallIds };
}

function response(attemptId, turnId, responseId, inputTokens, outputTokens, costUsd, ttftMs, pollIds) {
  const [start, finish] = responseId === "response-1" ? [11, 20] : responseId === "response-2a" ? [41, 50] : [51, 65];
  return { attemptId, turnId, responseId, provider: "generic", model: "worker", terminal: "completed", ...interval(start, start + ttftMs, finish, "requestedAt", "firstTokenAt", "finishedAt"), pollIds, inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: inputTokens + outputTokens, costUsd, pricingSource: "catalog-v1" };
}

function interval(start, first, finish, startField, firstField, finishField) {
  const timestamp = value => `2026-07-13T00:00:00.${String(value).padStart(3, "0")}Z`;
  return { [startField]: timestamp(start), ...(firstField ? { [firstField]: timestamp(first) } : {}), [finishField]: timestamp(finish), durationMs: finish - start };
}

function poll(attemptId, turnId, responseId, pollId, durationMs) {
  return { attemptId, turnId, responseId, pollId, status: "completed", durationMs };
}

function validationRecoveryEvidence(sourceAttemptId) {
  const commands = [
    commandEvidence(0, "passed", { exitCode: 0, stdout: "ok" }),
    commandEvidence(1, "timeout", { timeoutMs: 100, stdout: "partial output", stderr: "timed out", durationMs: 100 }),
    commandEvidence(2, "unexecuted"),
  ];
  const contract = workContract();
  contract.validationCommands = commands.map((command) => command.command);
  return {
    kind: "validation",
    sourceAttemptId,
    workContract: contract,
    commands,
    rejectedPatch: patchIdentity("b", "c"),
    reconstructedTree: "c".repeat(40),
  };
}

function integrationRecoveryEvidence(sourceAttemptId) {
  return {
    kind: "integration",
    sourceAttemptId,
    workContract: workContract(),
    applyFailure: { stage: "check", code: "nonzero", exitCode: 1, signal: null, timeoutMs: null, stdout: "", stderr: "conflict", durationMs: 2 },
    rejectedPatch: patchIdentity("b", "c"),
    acceptedLedger: [{ sourceAttemptId: "node:000000", patch: patchIdentity("a", "b") }],
    reconstructedTree: "b".repeat(40),
  };
}

function commandEvidence(index, status, extra = {}) {
  return { index, command: { executable: "node", args: [`check-${index}.mjs`] }, status, exitCode: null, signal: null, timeoutMs: null, stdout: "", stderr: "", durationMs: 0, ...extra };
}

function workContract() {
  return {
    schema: "fanout.work-contract",
    version: WORK_CONTRACT_VERSION,
    goals: [{ sourcePlanId: "plan", statement: "Update the file." }],
    changes: [{ kind: "create", target: { resource: { kind: "file", path: "src/value.ts" }, sourcePlanIds: ["plan"] }, contentIntent: "Create the value module." }],
    readDependencies: [],
    forbiddenWrites: [],
    validationCommands: [{ executable: "node", args: ["check.mjs"] }],
    capabilities: FIXED_WORKER_CAPABILITIES,
    semanticReviewCriteria: [{ sourcePlanId: "plan", statement: "The module validates." }],
    advisoryNotes: [],
  };
}

function patchIdentity(base, result) {
  return { artifact: { path: "patch.bin", sha256: "a".repeat(64), byteLength: 3 }, headCommit: "d".repeat(40), changedPaths: ["src/value.ts"], stats: { filesChanged: 1, insertions: 1, deletions: 0 }, baseTree: base.repeat(40), resultTree: result.repeat(40) };
}

function expectMetricCode(value, code) {
  const result = correlateAttemptMetrics(value);
  assert(!result.partialMetrics.complete && result.errors.some((error) => error.code === code), `expected metric error ${code}: ${JSON.stringify(result.errors)}`);
}

function expectThrow(run, message) {
  let threw = false;
  try { run(); } catch { threw = true; }
  assert(threw, message);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
