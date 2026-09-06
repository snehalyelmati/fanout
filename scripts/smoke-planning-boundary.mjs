import { rejects } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BATCHING_DISCIPLINE_MARKER } from "../packages/fanout-core/src/batching-discipline.ts";
import {
  activatePlanningTools,
  FANOUT_PLANNING_TOOLS,
  planningToolBlockReason,
  restorePlanningTools,
  submitPlanningArtifact,
} from "../packages/fanout-pi/src/planning-capabilities.ts";
import { renderWorkContractMarkdown } from "../packages/fanout-core/src/work-contract-views.ts";
import { FANOUT_ORCHESTRATION_MARKER } from "../packages/fanout-pi/src/fanout-plan-orchestration.ts";
import { assert, expectThrows, extensionHarness, phaseState, profileGateCommand, validDetails, validPlan, validProfile, validSubmission, sdkPlanningSession } from "./planning-boundary-fixtures.mjs";
import { testPlanningPresentation } from "./smoke-planning-presentation.mjs";

const root = mkdtempSync(join(tmpdir(), "fanout-planning-boundary-"));
try {
  testToolProfile();
  testCombinedSubmission();
  testArtifactSubmission();
  await testPlanningLifecycle();
  await testRealPlanningRuntime();
  await testRealPlanningRuntime(true);
  await testRealPlanningCancellation();
  await testPlanningPresentation(root);
  console.log("planning boundary smoke passed (A15)");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function testToolProfile() {
  const calls = [];
  const pi = { getActiveTools: () => ["read", "bash", "extension_tool"], setActiveTools: (tools) => calls.push([...tools]) };
  const previous = activatePlanningTools(pi);
  restorePlanningTools(pi, previous);
  assert(JSON.stringify(calls) === JSON.stringify([FANOUT_PLANNING_TOOLS, previous]), "planning profile did not restore the exact prior tools");
  assert(!planningToolBlockReason("read", true), "read was blocked during planning");
  assert(planningToolBlockReason("bash", true)?.includes("blocks bash"), "blocked tool did not fail closed");
  assert(!planningToolBlockReason("bash", false), "normal turns inherited the planning gate");
}

function testCombinedSubmission() {
  const repository = join(root, "combined-repo");
  mkdirSync(repository);
  const state = phaseState(repository, join(root, "combined-artifacts"), join(root, "combined-artifacts", "run"), "implementation");
  const draft = { plan: validPlan(), details: validDetails() };
  const invalid = structuredClone(draft);
  invalid.details.items[0].changes[0].target.resource.path = "unowned.md";
  expectThrows(() => submitPlanningArtifact(state, invalid, repository), /write-not-authorized/, "combined compiler admission");
  assert(!existsSync(state.implementationPlanPath) && !existsSync(state.implementationDetailsPath), "invalid combined draft published one half");
  const accepted = submitPlanningArtifact(state, draft, repository);
  assert(accepted.compiled?.ok && accepted.planIdentity, "combined submission did not compile both artifacts");
  assert(JSON.stringify(JSON.parse(readFileSync(state.implementationDetailsPath)).plan) === JSON.stringify(accepted.planIdentity), "combined details lost exact plan identity");
  assert(JSON.stringify(accepted.compiled.packet.sourceArtifacts) === JSON.stringify({ plan: accepted.planIdentity, details: accepted.identity }), "combined compiler result is not bound to both artifacts");
}

function testArtifactSubmission() {
  const repository = join(root, "repo");
  const artifactRoot = join(root, "artifacts");
  mkdirSync(repository);
  const artifactDir = join(artifactRoot, "run-1");
  const submittedProfile = submitPlanningArtifact(phaseState(repository, artifactRoot, artifactDir, "profile"), validProfile(), repository);
  const profile = JSON.parse(readFileSync(submittedProfile.path, "utf8"));
  const state = { ...phaseState(repository, artifactRoot, artifactDir, "implementation"), approvedProfile: { identity: submittedProfile.identity, profile } };
  const draft = validSubmission();
  expectThrows(() => submitPlanningArtifact(state, { ...draft, artifactDir: join(root, "wrong") }, repository), /additional properties/, "caller-selected envelope");
  expectThrows(() => submitPlanningArtifact(state, { schema: "wrong" }, repository), /additional properties|required properties/, "malformed draft");
  const profileGate = profile.requiredFinalGates[0].command;
  for (const details of [
    { ...draft.details, items: draft.details.items.map((item) => ({ ...item, validationCommands: [profileGate] })) },
    { ...draft.details, finalValidationCommands: [profileGate] },
    { ...draft.details, finalValidationCommands: [{ ...profileGate, env: { FIRST: "1", SECOND: "2" } }] },
  ]) expectThrows(() => submitPlanningArtifact(state, { ...draft, details }, repository), /requiredFinalGates.*remove.*focused.*resubmit/, "duplicate profile gate");
  assert(!existsSync(state.implementationPlanPath) && !existsSync(state.implementationDetailsPath), "invalid combined draft published artifacts");
  const omittedNotes = structuredClone(draft);
  delete omittedNotes.details.items[0].advisoryNotes;
  const accepted = submitPlanningArtifact(state, omittedNotes, repository);
  assert(JSON.parse(readFileSync(accepted.path)).items[0].advisoryNotes.length === 0, "omitted notes did not persist as []");
  expectThrows(() => submitPlanningArtifact(state, { ...draft, details: { ...draft.details, items: [{ ...draft.details.items[0], advisoryNotes: null }] } }, repository), /advisoryNotes/, "null notes");
  expectThrows(() => submitPlanningArtifact(state, validPlan(), repository), /additional properties|required properties/, "old single-half submission");

  const fallbackState = { ...state, ...phaseState(repository, artifactRoot, join(artifactRoot, "fallback"), "implementation") };
  const fallback = validSubmission();
  fallback.plan.implementationItems.push({ ...structuredClone(fallback.plan.implementationItems[0]), id: "reader", writeResources: [{ kind: "file", path: "reader.ts" }], readResources: [{ kind: "file", path: "README.md" }] });
  fallback.details.items.push({ ...structuredClone(fallback.details.items[0]), id: "reader", kind: "implement", changes: [{ kind: "modify", target: { resource: { kind: "file", path: "reader.ts" }, sourcePlanIds: ["reader"] }, intent: "Update reader", anchors: [{ kind: "symbol", symbol: "reader" }] }] });
  const badWrite = structuredClone(fallback);
  badWrite.details.items[1].changes[0].target.resource.path = "unowned.ts";
  expectThrows(() => submitPlanningArtifact(fallbackState, badWrite, repository), /write-not-authorized/, "provisional ownership rejection");
  assert(!fallbackState.repairAttempted, "unrelated error armed fallback");
  expectThrows(() => submitPlanningArtifact(fallbackState, fallback, repository), /planned-read-not-grounded/, "first read ambiguity");
  assert(fallbackState.repairAttempted && !existsSync(fallbackState.implementationPlanPath), "ambiguous draft published a half or lost fallback");
  const changedPlan = structuredClone(fallback);
  changedPlan.plan.objective = "Different plan";
  expectThrows(() => submitPlanningArtifact(fallbackState, changedPlan, repository), /planned-read-not-grounded/, "new plan inherited previous fallback");
  expectThrows(() => submitPlanningArtifact(fallbackState, fallback, repository), /planned-read-not-grounded/, "returning plan inherited unrelated fallback");
  const acceptedFallback = submitPlanningArtifact(fallbackState, fallback, repository);
  const beforeView = JSON.stringify(acceptedFallback.compiled.packet);
  const review = renderWorkContractMarkdown(acceptedFallback.compiled.packet, acceptedFallback.compiled.packet.nodes);
  assert(review.includes("conservatively waits") && review.includes("reduce parallelism"), "fallback warning absent");
  assert(JSON.stringify(acceptedFallback.compiled.packet) === beforeView, "warning changed authority");

  const repositoryArtifact = join(repository, ".fanout", "run");
  expectThrows(() => submitPlanningArtifact(phaseState(repository, join(repository, ".fanout"), repositoryArtifact, "implementation"), draft, repository), /cannot be submitted into the repository/, "repository destination");
  assert(!existsSync(join(repository, ".fanout")), "destination rejection mutated repository");
  const outside = join(root, "symlink-outside");
  const linkedRoot = join(root, "linked-artifacts");
  mkdirSync(outside);
  symlinkSync(outside, linkedRoot, "dir");
  submitPlanningArtifact(phaseState(repository, linkedRoot, join(linkedRoot, "run"), "implementation"), draft, repository);
}

async function testPlanningLifecycle() {
  const extension = (await import("../packages/fanout-pi/src/index.ts")).default;
  const rejectedPreflight = await extensionHarness(root, extension, "no-model", false, false);
  assert(rejectedPreflight.messages.length === 0 && !existsSync(rejectedPreflight.activePointerPath) && rejectedPreflight.notifications.some((entry) => entry.message.includes("prior active packet selection remains invalidated")), "planning preflight rejection left or misreported the prior active selection");
  for (const [scenario, profile, published] of [
    ["refresh-profile-failure", validProfile(), false],
    ["refresh-profile-success", { preparation: [], readiness: [], candidateNormalization: [], requiredFinalGates: [] }, true],
  ]) {
    const harness = await extensionHarness(root, extension, scenario, false, true, "--refresh-profile Test planning boundary");
    const previous = readFileSync(harness.activeProfilePath);
    const started = harness.handler("before_agent_start")({ prompt: harness.messages[0].content, systemPrompt: "base" }, harness.ctx);
    assert(started.systemPrompt.includes("Project Execution Profile"), `${scenario}: refresh did not enter the profile phase`);
    assert(harness.submit.parameters.properties.artifact.properties.preparation && !harness.submit.parameters.properties.artifact.properties.implementationItems, `${scenario}: profile did not register its exact submission schema`);
    assert(started.systemPrompt.indexOf("Build and submit the Project Execution Profile") < started.systemPrompt.indexOf(BATCHING_DISCIPLINE_MARKER), `${scenario}: generic batching buried the profile action`);
    await harness.submit.execute("submit", { artifact: profile }, undefined, undefined, harness.ctx);
    await harness.handler("agent_settled")({}, harness.ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const current = readFileSync(harness.activeProfilePath);
    assert(published ? !current.equals(previous) : current.equals(previous), `${scenario}: active profile publication was not atomic`);
    assert(published ? harness.notifications.some(({ message }) => message.includes("Profile approved")) && harness.messages.at(-1)?.content === "Prepare and submit the Fanout implementation plan." : harness.messages.length === 1, `${scenario}: refresh lifecycle advanced incorrectly: ${JSON.stringify(harness.messages)}`);
  }
  for (const scenario of ["success", "failure", "unsubmitted-file", "mutated-submission", "mutated-details-submission", "duplicate-details-resubmission", "cancellation", "clarification", "queued-transition"]) {
    const harness = await extensionHarness(root, extension, scenario, scenario === "queued-transition");
    const before = harness.handler("before_agent_start");
    const baseTools = [...harness.activeTools];
    const started = before({ prompt: harness.messages[0].content, systemPrompt: scenario === "clarification" ? `base\n\n${BATCHING_DISCIPLINE_MARKER}` : "base" }, harness.ctx);
    assert(started.systemPrompt.indexOf("Inspect the repository and submit exactly one") < started.systemPrompt.indexOf(BATCHING_DISCIPLINE_MARKER) && started.systemPrompt.split(BATCHING_DISCIPLINE_MARKER).length - 1 === 1, "planning action buried or batching duplicated");
    assert(!started.systemPrompt.includes("Fanout runtime context") && !started.systemPrompt.includes(harness.activePointerPath), "planning included unpublished/runtime context");
    assert(started.systemPrompt.includes('"projectExecutionProfile"') && started.systemPrompt.includes("full-check"), "combined planning omitted approved profile");
    const runId = /"runId":"([^"]+)"/.exec(started.systemPrompt)?.[1];
    const artifactDir = join(dirname(harness.activeProfilePath), runId);
    assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), "planning tools not activated");
    assert(harness.handler("tool_call")({ toolName: "read", toolCallId: "read", input: { path: join(root, "external-context.md") } }, harness.ctx) === undefined, "Pi-native read blocked");
    const gate = harness.handler("tool_call")({ toolName: scenario === "clarification" ? "ask_user_question" : "bash", toolCallId: "call", input: {} }, harness.ctx);
    assert(scenario === "clarification" ? gate === undefined : gate?.block === true, "tool authority changed");
    if (scenario === "duplicate-details-resubmission") {
      const draft = validSubmission();
      draft.details.finalValidationCommands = [profileGateCommand()];
      await rejects(() => harness.submit.execute("invalid", { artifact: draft }, undefined, undefined, harness.ctx), /requiredFinalGates.*remove.*focused.*resubmit/);
      assert(!existsSync(join(artifactDir, "implementation-plan.json")), "invalid combined draft published plan");
    }
    if (["success", "queued-transition", "mutated-submission", "mutated-details-submission", "duplicate-details-resubmission"].includes(scenario)) {
      const submitted = await harness.submit.execute("submit", { artifact: validSubmission() }, undefined, undefined, harness.ctx);
      assert(submitted.terminate === true, "combined submission did not terminate");
    }
    if (scenario === "mutated-submission") writeFileSync(join(artifactDir, "implementation-plan.json"), "{");
    if (scenario === "mutated-details-submission") writeFileSync(join(artifactDir, "implementation-details.json"), "{");
    if (scenario === "unsubmitted-file") { mkdirSync(artifactDir, { recursive: true }); writeFileSync(join(artifactDir, "implementation-plan.json"), JSON.stringify(validPlan())); }
    if (scenario === "cancellation") harness.handler("session_shutdown")({}, harness.ctx);
    else await harness.handler("agent_settled")({}, harness.ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), "planning did not restore tools");
    assert(harness.messages.length === 1, "combined planning launched a second investigation");
    const success = ["success", "queued-transition", "duplicate-details-resubmission"].includes(scenario);
    assert(existsSync(harness.activePointerPath) === success, `${scenario}: incorrect publication`);
    if (success) assert(harness.notifications.some(({ message }) => message.includes("Fanout plan ready")), "successful corrected draft did not finish");
    const resumed = before({ prompt: "unrelated", systemPrompt: "base" }, harness.ctx);
    assert(!resumed.systemPrompt.includes(FANOUT_ORCHESTRATION_MARKER), `${scenario}: planning remained wedged`);
  }
  for (const scenario of ["dirty-staged", "dirty-unstaged", "dirty-untracked"]) {
    const harness = await extensionHarness(root, extension, scenario, false);
    assert(harness.messages.length === 0 && harness.notifications.some(({ message }) => message.includes("clean committed repository")), `${scenario}: dirty base reached paid planning`);
    assert(readFileSync(join(harness.ctx.cwd, scenario === "dirty-untracked" ? "new.txt" : "README.md"), "utf8") === "User changes\n", `${scenario}: preflight changed user files`);
  }
  await testPlanningContextIsolation(extension);
}

async function testPlanningContextIsolation(extension) {
  const prior = [
    { role: "compactionSummary", summary: "Earlier decision: preserve compatibility.", timestamp: 1, tokensBefore: 100 },
    { role: "custom", customType: "fanout-report", content: "exclude report" },
    { role: "toolResult", content: [{ type: "text", text: "exclude tool result" }], toolCallId: "old" },
    { role: "assistant", content: [{ type: "toolCall", id: "old", name: "read", arguments: {} }] },
    { role: "user", content: "Superseded request" },
    { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] },
    { role: "user", content: "Initiating objective context" },
    { role: "assistant", content: [{ type: "text", text: "Acknowledged" }] },
  ];
  const explicit = await extensionHarness(root, extension, "context-explicit", false, true, "Explicit objective", prior);
  explicit.handler("before_agent_start")({ prompt: explicit.messages[0].content, systemPrompt: "base" }, explicit.ctx);
  assert(explicit.submit.parameters.properties.artifact.properties.plan && explicit.submit.parameters.properties.artifact.properties.details, "Phase A did not register its exact submission schema");
  let filtered = explicit.handler("context")({ messages: structuredClone(explicit.sessionMessages) }, explicit.ctx).messages;
  assert(filtered.length === 1 && filtered[0].content === "Prepare and submit the Fanout implementation plan.", "explicit /fanout-plan retained earlier conversation");
  assert(Buffer.byteLength(JSON.stringify(filtered)) < Buffer.byteLength(JSON.stringify(explicit.sessionMessages)), "explicit planning context did not shrink deterministically");
  explicit.sessionMessages.push({ role: "assistant", content: [
    { type: "toolCall", id: "batched-read", name: "read", arguments: { path: "README.md" } },
    { type: "toolCall", id: "batched-submit", name: "fanout_submit_artifact", arguments: { artifact: validSubmission() } },
  ] });
  const batched = explicit.handler("tool_call")({ toolName: "fanout_submit_artifact", toolCallId: "batched-submit", input: { artifact: validSubmission() } }, explicit.ctx);
  assert(batched?.block === true, "batched planning submission was admitted");
  explicit.sessionMessages.push({ role: "assistant", content: [{ type: "toolCall", id: "lone-submit", name: "fanout_submit_artifact", arguments: { artifact: validSubmission() } }] });
  const lone = explicit.handler("tool_call")({ toolName: "fanout_submit_artifact", toolCallId: "lone-submit", input: { artifact: validSubmission() } }, explicit.ctx);
  assert(lone === undefined, "lone planning submission was blocked");
  const submitted = await explicit.submit.execute("submit", { artifact: validSubmission() }, undefined, undefined, explicit.ctx);
  assert(submitted.terminate === true, "successful planning submission was not terminating");
  assert((submitted.terminate ? 1 : 2) === 1, "successful submission retained the deterministic post-submit provider call");
  await explicit.handler("agent_settled")({}, explicit.ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(explicit.messages.length === 1 && existsSync(explicit.activePointerPath), "combined plan restarted investigation instead of publishing");

  const implicit = await extensionHarness(root, extension, "context-implicit", false, true, "", prior);
  implicit.handler("before_agent_start")({ prompt: implicit.messages[0].content, systemPrompt: "base" }, implicit.ctx);
  filtered = implicit.handler("context")({ messages: structuredClone(implicit.sessionMessages) }, implicit.ctx).messages;
  assert(filtered.length === 6 && JSON.stringify(filtered[0]).includes("Earlier decision") && filtered[1].content === "Superseded request" && filtered[3].content === "Initiating objective context" && filtered.at(-1).content === "Prepare and submit the Fanout implementation plan.", "implicit /fanout-plan lost the current conversation");
  const retained = await extensionHarness(root, extension, "context-retained", false, true, "Explicit objective", [
    { role: "user", content: "Prepare and submit the Fanout implementation plan." },
    { role: "user", content: "EXCLUDED_DUPLICATE_HISTORY" },
  ]);
  retained.handler("before_agent_start")({ prompt: retained.messages[0].content, systemPrompt: "base" }, retained.ctx);
  retained.handler("context")({ messages: structuredClone(retained.sessionMessages) }, retained.ctx);
  retained.handler("session_before_compact")({}, retained.ctx);
  retained.sessionMessages.unshift({ role: "compactionSummary", summary: "EXCLUDED_WHOLE_BRANCH", timestamp: 1, tokensBefore: 100 });
  retained.handler("session_compact")({}, retained.ctx);
  retained.sessionMessages.push({ role: "user", content: "NEW_CONTINUATION" });
  const keptContext = retained.handler("context")({ messages: structuredClone(retained.sessionMessages) }, retained.ctx).messages;
  assert(keptContext.length === 2 && keptContext[1].content === "NEW_CONTINUATION" && !JSON.stringify(keptContext).includes("EXCLUDED_"), "compaction matched an old duplicate trigger or dropped new continuation");

}

async function testRealPlanningRuntime(implicitObjective = false) {
  const { default: extension } = await import("../packages/fanout-pi/src/index.ts");
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  let queued = false;
  let settled = 0;
  let compacted = 0;
  const runtime = await sdkPlanningSession(root, implicitObjective ? "retry-compaction-bare" : "retry-compaction", extension, (pi) => {
    pi.on("agent_end", ({ messages }) => {
      if (!queued && messages.some((message) => message.role === "assistant" && message.content.some((part) => part.type === "text" && part.text === "continue planning EXCLUDED_PHASE_A"))) {
        queued = true;
        pi.sendUserMessage("Continue the same planning phase.", { deliverAs: "followUp" });
      }
    });
    pi.on("agent_settled", () => { settled++; });
    pi.on("session_before_compact", (event) => ({ compaction: { summary: "EXCLUDED_WHOLE_BRANCH: EXCLUDED_OLD_HISTORY and EXCLUDED_PHASE_A", firstKeptEntryId: event.branchEntries.at(-1).id, tokensBefore: event.preparation.tokensBefore } }));
    pi.on("session_compact", () => { compacted++; });
  }, { compaction: { enabled: true, keepRecentTokens: 20, reserveTokens: 100 } });
  const { session, sessionManager } = runtime;
  sessionManager.appendMessage({ role: "user", content: (implicitObjective ? "BARE_OBJECTIVE_DECISION " : "EXCLUDED_OLD_HISTORY ").repeat(100), timestamp: Date.now() - 2000 });
  sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Option B preserves constraints." }], api: "openai-completions", provider: "fanout-sdk-test", model: "scripted", usage: usage(), stopReason: "stop", timestamp: Date.now() - 1000 });
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
  const observed = [];
  let calls = 0;
  session.agent.streamFunction = (model, context) => {
    calls++;
    observed.push(JSON.parse(JSON.stringify(context)));
    assert(context.systemPrompt.includes(FANOUT_ORCHESTRATION_MARKER), `SDK request ${calls} lost planning system prompt`);
    assert(!context.tools.some((tool) => tool.name === "bash"), `SDK request ${calls} restored write tools before settled`);
    if (calls <= 4) assert(context.systemPrompt.includes('"phase":"implementation"'), `SDK request ${calls} advanced before settlement`);
    const result = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), timestamp: Date.now(), stopReason: "stop" };
    if (calls === 1 || calls === 2) { result.stopReason = "error"; result.errorMessage = calls === 1 ? "503 service overloaded" : "maximum context length exceeded"; }
    else if (calls === 3) result.content = [{ type: "text", text: "continue planning EXCLUDED_PHASE_A" }];
    else result.content = [{ type: "toolCall", id: `submit-${calls}`, name: "fanout_submit_artifact", arguments: { artifact: calls === 4 ? { plan: validPlan(), details: { ...validDetails(), items: [{ ...validDetails().items[0], changes: [{ ...validDetails().items[0].changes[0], target: { resource: { kind: "file", path: "unowned.md" }, sourcePlanIds: ["code"] } }] }] } } : validSubmission() } }];
    if (calls >= 4) result.stopReason = "toolUse";
    const stream = createAssistantMessageEventStream();
    stream.push(result.stopReason === "error" ? { type: "error", reason: "error", error: result } : { type: "done", reason: result.stopReason, message: result });
    return stream;
  };
  try {
    await session.prompt(implicitObjective ? "/fanout-plan" : "/fanout-plan Implement option B");
    await waitFor(() => settled === 1);
    assert(calls === 5 && compacted === 1 && queued, `SDK branches not exercised: calls=${calls}, compactions=${compacted}, queued=${queued}`);
    assert(!JSON.stringify(observed[2].messages).includes("EXCLUDED_"), "explicit objective regained excluded history after SDK compaction");
    if (implicitObjective) assert(JSON.stringify(observed[2].messages).includes("BARE_OBJECTIVE_DECISION"), "bare objective lost its admitted conversation after compaction");
    assert(observed[4].messages.some((message) => message.role === "toolResult" && message.isError && JSON.stringify(message).includes("write-not-authorized")), "compiler draft failure did not return through the real tool retry loop");
    assert(existsSync(runtime.activePointerPath), "SDK corrected details did not publish a packet");
    assert(session.getActiveToolNames().includes("bash"), "SDK settled success did not restore prior tools");
  } finally { session.dispose(); }
}

function usage() { return { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("SDK planning did not settle"); await new Promise((resolve) => setTimeout(resolve, 5)); }
}

async function testRealPlanningCancellation() {
  const { default: extension } = await import("../packages/fanout-pi/src/index.ts");
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  let settled = 0;
  const runtime = await sdkPlanningSession(root, "cancel", extension, (pi) => pi.on("agent_settled", () => { settled++; }));
  const { session, sessionManager } = runtime;
  sessionManager.appendMessage({ role: "user", content: "Choose option B from the earlier discussion.", timestamp: Date.now() });
  sessionManager.appendCompaction("Option B means keep compatibility and change only the renderer.", sessionManager.getLeafId(), 100);
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
  let providerContext;
  session.agent.streamFunction = (model, context, options) => {
    providerContext = context;
    const stream = createAssistantMessageEventStream();
    options.signal.addEventListener("abort", () => stream.push({ type: "error", reason: "aborted", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: "aborted", timestamp: Date.now() } }), { once: true });
    return stream;
  };
  try {
    await session.prompt("/fanout-plan");
    await waitFor(() => providerContext !== undefined);
    assert(JSON.stringify(providerContext.messages).includes("Option B means keep compatibility"), "bare invocation dropped the SDK compaction summary before the provider");
    await session.abort();
    await waitFor(() => settled === 1);
    assert(!existsSync(runtime.activePointerPath) && session.getActiveToolNames().includes("bash"), "SDK cancellation published a packet or failed to restore tools");
  } finally { session.dispose(); }
}
