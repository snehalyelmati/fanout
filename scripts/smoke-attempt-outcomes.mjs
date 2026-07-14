import { correlateAttemptMetrics, deriveAttemptMetricTotals, deriveSummedResponseTtftMs } from "../packages/fanout-core/src/attempt-metrics.ts";
import { parseAttemptRecoveryContext } from "../packages/fanout-core/src/recovery-evidence.ts";
import { FIXED_WORKER_CAPABILITIES } from "../packages/fanout-core/src/work-contract.ts";
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
const reversedParent = structuredClone(instrumentedEvidence);
reversedParent.responses[0].turnId = "turn-2";
expectMetricCode(reversedParent, "correlation-mismatch");
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
const missingTool = structuredClone(instrumentedEvidence);
missingTool.tools.pop();
expectMetricCode(missingTool, "missing-tool");
const genericWithProviderRecord = genericEvidence(original.allocation.attemptId);
genericWithProviderRecord.responses.push(providerEvidence(original.allocation.attemptId).responses[0]);
expectMetricCode(genericWithProviderRecord, "provider-evidence-mismatch");
const instrumentedWithoutResponse = structuredClone(instrumentedEvidence);
instrumentedWithoutResponse.responses = [];
expectMetricCode(instrumentedWithoutResponse, "missing-identity");
const missingPoll = structuredClone(instrumentedEvidence);
delete missingPoll.polls[0].durationMs;
expectMetricCode(missingPoll, "missing-poll");
assert(!correlateAttemptMetrics(missingPoll).partialMetrics.polls.some((poll) => poll.pollId === "poll-1"), "missing poll evidence was replaced with guessed zeroes");
const duplicatePoll = structuredClone(instrumentedEvidence);
duplicatePoll.polls.push(structuredClone(duplicatePoll.polls[0]));
expectMetricCode(duplicatePoll, "duplicate-identity");
const crossAttemptPoll = structuredClone(instrumentedEvidence);
crossAttemptPoll.polls[0].attemptId = "other:000001";
expectMetricCode(crossAttemptPoll, "correlation-mismatch");
const reversedPollParent = structuredClone(instrumentedEvidence);
reversedPollParent.polls[0].responseId = "response-2a";
expectMetricCode(reversedPollParent, "correlation-mismatch");

const partialEvidence = genericEvidence(original.allocation.attemptId);
delete partialEvidence.workerDurationMs;
const partial = correlateAttemptMetrics(partialEvidence);
assert(!partial.ok && !partial.partialMetrics.complete && deriveAttemptMetricTotals(partial.partialMetrics).costUsd === 0.18, "failed attempt lost observed partial cost");

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
assert(accepted.action === "accept" && accepted.durationMs === 1000 && accepted.budgetTransition.name === "original", "terminal outcome lost actual action or budget transition");
assert(accepted.version === 2, "attempt outcome did not advance to v2");
expectThrow(() => parseAttemptOutcome({ ...accepted, version: 1 }), "legacy attempt outcome v1 was admitted");
let outcomes = appendTerminalOutcome([], accepted);
assert(outcomes.length === 1, "terminal outcome was not recorded");
expectThrow(() => appendTerminalOutcome(outcomes, accepted), "duplicate terminal outcome was admitted");

const validationRecovery = parseAttemptRecoveryContext(validationRecoveryEvidence(original.allocation.attemptId));
assert(validationRecovery.kind === "validation" && validationRecovery.commands[1].status === "timeout" && validationRecovery.commands[1].stdout === "partial output" && validationRecovery.commands[2].status === "unexecuted", "validation recovery lost ordered process evidence");
const validationContractMismatch = validationRecoveryEvidence(original.allocation.attemptId);
validationContractMismatch.workContract.validationCommands[0] = { executable: process.execPath, args: ["-e", "process.exit(0)"] };
expectThrow(() => parseAttemptRecoveryContext(validationContractMismatch), "validation recovery admitted commands different from its canonical work contract");
const recoveryPrompt = buildCanonicalWorkerPrompt({ objective: "recover", userContext: [], discoveredRepoFacts: [], assumptions: [] }, { id: "node", kind: "implement", workContract: validationRecovery.workContract }, [], validationRecovery);
assert(recoveryPrompt.includes('"status": "timeout"') && recoveryPrompt.includes('"status": "unexecuted"') && recoveryPrompt.includes('"stdout": "partial output"'), "canonical prompt lost typed validation recovery evidence");
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
assert(postTreeOutcome.action === "fail" && postTreeOutcome.recovery?.kind === "integration" && postTreeOutcome.recovery.applyFailure.stage === "post-tree", "post-tree detail could not enter a terminal outcome");
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
assert(!replayedFilteredPartial.metrics.complete && deriveAttemptMetricTotals(replayedFilteredPartial.metrics).costUsd === 0.06, "filtered partial metrics became complete or lost observed cost during replay");
for (const diagnostic of ["429", "503", "network", "crash", "authentication failed", "quota exhausted"]) {
  const proseCase = originalLaunch(`prose-${diagnostic.replace(/\W+/g, "-")}`, assignment);
  const proseOutcome = finishAttempt(proseCase.allocation, proseCase.state, { stage: "process", code: "nonzero", exitCode: 1, durationMs: 100 }, { diagnostic });
  assert(proseOutcome.action === "fail" && proseOutcome.diagnostic === diagnostic, `diagnostic prose changed typed routing: ${diagnostic}`);
}
const incompleteCase = originalLaunch("incomplete", assignment);
expectThrow(() => completeAttempt(incompleteCase.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "apply", code: "applied" }, state: incompleteCase.state, fallbackAllowed: true, metrics: observedMetrics(incompleteCase.allocation) }), "incomplete accepted metrics were admitted");
finishAttempt(incompleteCase.allocation, incompleteCase.state, { stage: "metrics", code: "missing-timing" });
expectThrow(() => completeAttempt(forged.allocation, { startedAt: accepted.startedAt, finishedAt: accepted.finishedAt, terminalFact: { stage: "metrics", code: "complete" }, state: forged.state, fallbackAllowed: true, metrics: forgedMetrics }), "one allocation produced two terminal outcomes");

console.log("attempt outcomes smoke passed (A10, A11, A12)");

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
    tools: [{ attemptId, turnId: "turn-1", toolCallId: "tool-1", terminal: "completed", durationMs: 3 }],
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
      { attemptId, turnId: "turn-1", toolCallId: "tool-1", terminal: "completed", durationMs: 3 },
      { attemptId, turnId: "turn-2", toolCallId: "tool-2", terminal: "completed", durationMs: 4 },
    ],
    workerFirstOutputMs: 2,
    workerDurationMs: 20,
  };
}

function turn(attemptId, turnId, inputTokens, outputTokens, costUsd, responseIds, toolCallIds) {
  return { attemptId, turnId, terminal: "completed", provider: "generic", model: "worker", tier: "tier2", inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd, pricingSource: "catalog-v1", responseIds, toolCallIds };
}

function response(attemptId, turnId, responseId, inputTokens, outputTokens, costUsd, ttftMs, pollIds) {
  return { attemptId, turnId, responseId, provider: "generic", model: "worker", terminal: "completed", ttftMs, pollIds, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd, pricingSource: "catalog-v1" };
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
    version: 2,
    goals: [{ sourcePlanId: "plan", statement: "Update the file." }],
    changes: [{ kind: "create", target: { resource: { kind: "file", path: "src/value.ts" }, sourcePlanIds: ["plan"] }, contentIntent: "Create the value module." }],
    readDependencies: [],
    forbiddenWrites: [],
    candidateNormalizationCommands: [],
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
  assert(!result.ok && result.errors.some((error) => error.code === code), `expected metric error ${code}: ${JSON.stringify(result.errors)}`);
}

function expectThrow(run, message) {
  let threw = false;
  try { run(); } catch { threw = true; }
  assert(threw, message);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
