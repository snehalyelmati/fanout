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
import { FANOUT_ORCHESTRATION_MARKER } from "../packages/fanout-pi/src/fanout-plan-orchestration.ts";
import { assert, expectThrows, extensionHarness, phaseState, profileGateCommand, validDetails, validPlan, validProfile } from "./planning-boundary-fixtures.mjs";
import { testPlanningPresentation } from "./smoke-planning-presentation.mjs";

const root = mkdtempSync(join(tmpdir(), "fanout-planning-boundary-"));
try {
  testToolProfile();
  testArtifactSubmission();
  await testPlanningLifecycle();
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

function testArtifactSubmission() {
  const repository = join(root, "repo");
  const artifactRoot = join(root, "artifacts");
  mkdirSync(repository);
  const artifactDir = join(artifactRoot, "run-1");
  const submittedProfile = submitPlanningArtifact(phaseState(repository, artifactRoot, artifactDir, "profile"), validProfile(), repository);
  const profile = JSON.parse(readFileSync(submittedProfile.path, "utf8"));
  const state = { ...phaseState(repository, artifactRoot, artifactDir, "implementation"), approvedProfile: { identity: submittedProfile.identity, profile } };
  const plan = validPlan(artifactDir);
  const submittedPlan = submitPlanningArtifact(state, plan, repository);
  assert(submittedPlan.path === state.implementationPlanPath, "controller did not select the Phase A destination");
  assert(JSON.parse(readFileSync(submittedPlan.path, "utf8")).objective === plan.objective, "Phase A artifact was not atomically published");

  expectThrows(() => submitPlanningArtifact(state, { ...plan, artifactDir: join(root, "wrong-run") }, repository), /additional properties/, "caller-selected Phase A envelope");
  expectThrows(() => submitPlanningArtifact(state, { schema: "wrong" }, repository), /additional properties|required properties/, "malformed Phase A");

	const details = validDetails(state, plan.objective);
	const acceptedPlanBytes = readFileSync(submittedPlan.path);
	const detailsState = { ...state, phase: "details", planIdentity: submittedPlan.identity, acceptedPlan: JSON.parse(acceptedPlanBytes.toString("utf8")) };
  writeFileSync(submittedPlan.path, Buffer.concat([acceptedPlanBytes, Buffer.from(" ")]));
  expectThrows(() => submitPlanningArtifact(detailsState, details, repository), /accepted implementation-plan bytes changed/, "mutated accepted Phase A bytes");
  writeFileSync(submittedPlan.path, acceptedPlanBytes);
  const profileGate = profile.requiredFinalGates[0].command;
  expectThrows(() => submitPlanningArtifact(detailsState, { ...details, items: details.items.map((item, index) => index ? item : { ...item, validationCommands: [profileGate] }) }, repository), /items\[0\]\.validationCommands\[0\].*requiredFinalGates\[0\].*remove.*focused.*resubmit/, "duplicate node profile gate draft");
  expectThrows(() => submitPlanningArtifact(detailsState, { ...details, finalValidationCommands: [profileGate] }, repository), /finalValidationCommands\[0\].*requiredFinalGates\[0\].*remove.*focused.*resubmit/, "duplicate packet-final profile gate draft");
  expectThrows(() => submitPlanningArtifact(detailsState, { ...details, finalValidationCommands: [{ ...profileGate, env: { FIRST: "1", SECOND: "2" } }] }, repository), /finalValidationCommands\[0\].*requiredFinalGates\[0\]/, "duplicate profile gate with reordered environment");
  assert(!existsSync(state.implementationDetailsPath), "rejected duplicate Phase B draft was published");
  const omittedNotes = structuredClone(details);
  delete omittedNotes.items[0].advisoryNotes;
  const submittedDetails = submitPlanningArtifact(detailsState, omittedNotes, repository);
  assert(submittedDetails.path === state.implementationDetailsPath, "controller did not select the Phase B destination");
  assert(JSON.parse(readFileSync(submittedDetails.path, "utf8")).items[0].advisoryNotes.length === 0, "omitted Phase B advisoryNotes did not persist canonically as []");
  expectThrows(() => submitPlanningArtifact(detailsState, { ...details, items: [{ ...details.items[0], advisoryNotes: null }] }, repository), /advisoryNotes/, "null Phase B advisoryNotes");
  expectThrows(() => submitPlanningArtifact(detailsState, plan, repository), /additional properties|required properties/, "wrong-phase artifact");
  expectThrows(() => submitPlanningArtifact(detailsState, { ...details, sourcePlanPath: join(root, "wrong-run.json") }, repository), /additional properties/, "caller-selected Phase B envelope");

  const repositoryArtifact = join(repository, ".fanout", "run");
  expectThrows(() => submitPlanningArtifact(phaseState(repository, join(repository, ".fanout"), repositoryArtifact, "implementation"), plan, repository), /cannot be submitted into the repository/, "repository destination");
  assert(!existsSync(join(repository, ".fanout")), "repository destination rejection mutated the repository");

  const outside = join(root, "symlink-outside");
  const linkedRoot = join(root, "linked-artifacts");
  mkdirSync(outside);
  symlinkSync(outside, linkedRoot, "dir");
  const linkedDir = join(linkedRoot, "run");
  submitPlanningArtifact(phaseState(repository, linkedRoot, linkedDir, "implementation"), plan, repository);
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
    await harness.handler("agent_end")({}, harness.ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const current = readFileSync(harness.activeProfilePath);
    assert(published ? !current.equals(previous) : current.equals(previous), `${scenario}: active profile publication was not atomic`);
    assert(published ? harness.notifications.some(({ message }) => message.includes("Profile approved")) && harness.messages.at(-1)?.content === "Prepare and submit the Fanout implementation plan." : harness.messages.length === 1, `${scenario}: refresh lifecycle advanced incorrectly: ${JSON.stringify(harness.messages)}`);
  }
  for (const scenario of ["success", "failure", "unsubmitted-file", "mutated-submission", "mutated-details-submission", "duplicate-details-resubmission", "cancellation", "clarification", "queued-transition"]) {
      const harness = await extensionHarness(root, extension, scenario, scenario === "queued-transition" || scenario === "mutated-details-submission");
      const before = harness.handler("before_agent_start");
      const baseTools = [...harness.activeTools];
      const started = before({ prompt: harness.messages[0].content, systemPrompt: scenario === "clarification" ? `base\n\n${BATCHING_DISCIPLINE_MARKER}` : "base" }, harness.ctx);
    assert(started.systemPrompt.indexOf("Inspect the repository and submit exactly one") < started.systemPrompt.indexOf(BATCHING_DISCIPLINE_MARKER) && started.systemPrompt.split(BATCHING_DISCIPLINE_MARKER).length - 1 === 1, `${scenario}: phase action was buried or batching duplicated`);
    assert(!started.systemPrompt.includes("Fanout runtime context"), `${scenario}: planning prompt retained irrelevant runtime metadata`);
    const runId = /"runId":"([^"]+)"/.exec(started?.systemPrompt ?? "")?.[1];
    const artifactDir = runId ? join(dirname(harness.activeProfilePath), runId) : undefined;
    assert(artifactDir, `${scenario}: internal phase prompt omitted its run identity`);
    assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), `${scenario}: planning profile was not activated`);
    const externalRead = harness.handler("tool_call")({ toolName: "read", toolCallId: "external-read", input: { path: join(root, "external-context.md") } }, harness.ctx);
    assert(externalRead === undefined, `${scenario}: planning blocked Pi-native external read scope`);
    const gate = harness.handler("tool_call")({ toolName: scenario === "clarification" ? "ask_user_question" : "bash", toolCallId: "call", input: {} }, harness.ctx);
    if (scenario === "clarification") assert(gate === undefined, "clarification tool was blocked");
    else assert(gate?.block === true, `${scenario}: blocked tool reached execution`);

    if (scenario === "success" || scenario === "queued-transition" || scenario === "mutated-submission" || scenario === "mutated-details-submission" || scenario === "duplicate-details-resubmission") {
      await harness.submit.execute("submit", { artifact: validPlan(artifactDir) }, undefined, undefined, harness.ctx);
    }
    if (scenario === "mutated-submission") writeFileSync(join(artifactDir, "implementation-plan.json"), "{");
    if (scenario === "unsubmitted-file") {
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, "implementation-plan.json"), `${JSON.stringify(validPlan(artifactDir))}\n`);
    }
    if (scenario === "cancellation") harness.handler("session_shutdown")({}, harness.ctx);
    else harness.handler("agent_end")({}, harness.ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), `${scenario}: exact prior profile was not restored`);
    if (scenario === "unsubmitted-file") assert(harness.messages.length === 1, "an unsubmitted Phase A file advanced planning");
    if (scenario === "failure") assert(!existsSync(harness.activePointerPath) && harness.notifications.some((entry) => entry.message.includes("prior active packet selection remains invalidated")), "planning failure contradicted or recreated the invalidated active selection");
    if (scenario === "mutated-submission") {
      assert(harness.messages.length === 1, "malformed post-submission Phase A bytes advanced planning");
      const resumed = before({ prompt: "unrelated", systemPrompt: "base" }, harness.ctx);
      assert(!resumed.systemPrompt.includes(FANOUT_ORCHESTRATION_MARKER) && JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), "malformed post-submission Phase A bytes left planning wedged");
    }

    if (scenario === "mutated-details-submission") {
      const phaseBPrompt = harness.messages.at(-1);
      assert(harness.messages.length === 2 && phaseBPrompt.options === undefined && !phaseBPrompt.queuedWhileStreaming, "Phase B was queued inside agent_end and bypassed before_agent_start");
      assert(phaseBPrompt.content === "Ground the accepted Phase A plan without changing the repository; submit implementation details with `fanout_submit_artifact`.", "Phase B trigger was not action-first or echoed model-authored context");
      before({ prompt: phaseBPrompt.content, systemPrompt: "base" }, harness.ctx);
      assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), "details mutation regression did not activate the Phase B profile");
      await harness.submit.execute("submit", { artifact: validDetails() }, undefined, undefined, harness.ctx);
      writeFileSync(join(artifactDir, "implementation-details.json"), "{");
      harness.handler("agent_end")({}, harness.ctx);
      assert(JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), "malformed post-submission Phase B bytes did not restore the exact prior profile");
      assert(harness.messages.length === 2, "malformed post-submission Phase B bytes advanced planning");
      const resumed = before({ prompt: "unrelated", systemPrompt: "base" }, harness.ctx);
      assert(!resumed.systemPrompt.includes(FANOUT_ORCHESTRATION_MARKER) && JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), "malformed post-submission Phase B bytes left planning wedged");
    }

    if (scenario === "duplicate-details-resubmission") {
      const phaseBPrompt = harness.messages.at(-1);
      const phaseBStarted = before({ prompt: phaseBPrompt.content, systemPrompt: "base" }, harness.ctx);
      const duplicate = { ...validDetails(), finalValidationCommands: [profileGateCommand()] };
      await rejects(() => harness.submit.execute("submit", { artifact: duplicate }, undefined, undefined, harness.ctx), /finalValidationCommands\[0\].*requiredFinalGates\[0\].*remove.*focused.*resubmit/, "duplicate Phase B tool submission");
      assert(!existsSync(join(artifactDir, "implementation-details.json")), "duplicate Phase B tool submission published an artifact");
      assert(phaseBStarted.systemPrompt.includes('"projectExecutionProfile"') && phaseBStarted.systemPrompt.includes('"requiredFinalGates"') && phaseBStarted.systemPrompt.includes("full-check") && phaseBStarted.systemPrompt.includes("Do not repeat"), "Phase B omitted exact profile context or validation-scope protocol");
      await harness.submit.execute("submit", { artifact: validDetails() }, undefined, undefined, harness.ctx);
      harness.handler("agent_end")({}, harness.ctx);
      assert(harness.notifications.some(({ message }) => message.includes("Fanout plan ready")), "corrected Phase B draft did not complete the preserved planning session");
    }

    if (scenario === "queued-transition") {
      const phaseBPrompt = harness.messages.at(-1);
      assert(harness.messages.length === 2 && phaseBPrompt.options === undefined && !phaseBPrompt.queuedWhileStreaming, "Phase B was queued inside agent_end and bypassed before_agent_start");
      const phaseBStarted = before({ prompt: phaseBPrompt.content, systemPrompt: "base" }, harness.ctx);
      assert(!phaseBStarted.systemPrompt.includes(harness.activePointerPath), "Phase B exposed the unpublished active packet as apparent input");
      assert(phaseBStarted.systemPrompt.includes("Submit grounded Fanout implementation details now") && phaseBStarted.systemPrompt.includes("controller creates them after submission"), "Phase B did not distinguish its output from prerequisites");
      assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), "queued Phase B profile was not activated");
      harness.handler("session_before_switch")({}, harness.ctx);
      assert(JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), "session switch did not restore the queued Phase B profile");
    }
  }
  await testPlanningContextIsolation(extension);
}

async function testPlanningContextIsolation(extension) {
  const prior = [
    { role: "user", content: "Superseded request" },
    { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] },
    { role: "user", content: "Initiating objective context" },
    { role: "assistant", content: [{ type: "text", text: "Acknowledged" }] },
  ];
  const explicit = await extensionHarness(root, extension, "context-explicit", false, true, "Explicit objective", prior);
  explicit.handler("before_agent_start")({ prompt: explicit.messages[0].content, systemPrompt: "base" }, explicit.ctx);
  assert(explicit.submit.parameters.properties.artifact.properties.implementationItems && !explicit.submit.parameters.properties.artifact.properties.items, "Phase A did not register its exact submission schema");
  let filtered = explicit.handler("context")({ messages: structuredClone(explicit.sessionMessages) }, explicit.ctx).messages;
  assert(filtered.length === 1 && filtered[0].content === "Prepare and submit the Fanout implementation plan.", "explicit /fanout-plan retained earlier conversation");
  assert(Buffer.byteLength(JSON.stringify(filtered)) < Buffer.byteLength(JSON.stringify(explicit.sessionMessages)), "explicit planning context did not shrink deterministically");
  explicit.sessionMessages.push({ role: "assistant", content: [
    { type: "toolCall", id: "batched-read", name: "read", arguments: { path: "README.md" } },
    { type: "toolCall", id: "batched-submit", name: "fanout_submit_artifact", arguments: { artifact: validPlan() } },
  ] });
  const batched = explicit.handler("tool_call")({ toolName: "fanout_submit_artifact", toolCallId: "batched-submit", input: { artifact: validPlan() } }, explicit.ctx);
  assert(batched?.block === true, "batched planning submission was admitted");
  explicit.sessionMessages.push({ role: "assistant", content: [{ type: "toolCall", id: "lone-submit", name: "fanout_submit_artifact", arguments: { artifact: validPlan() } }] });
  const lone = explicit.handler("tool_call")({ toolName: "fanout_submit_artifact", toolCallId: "lone-submit", input: { artifact: validPlan() } }, explicit.ctx);
  assert(lone === undefined, "lone planning submission was blocked");
  const submitted = await explicit.submit.execute("submit", { artifact: validPlan() }, undefined, undefined, explicit.ctx);
  assert(submitted.terminate === true, "successful planning submission was not terminating");
  assert((submitted.terminate ? 1 : 2) === 1, "successful submission retained the deterministic post-submit provider call");
  await explicit.handler("agent_end")({}, explicit.ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));
  explicit.handler("before_agent_start")({ prompt: explicit.messages.at(-1).content, systemPrompt: "base" }, explicit.ctx);
  assert(explicit.submit.parameters.properties.artifact.properties.items && !explicit.submit.parameters.properties.artifact.properties.objective, "Phase B did not register its exact submission schema");
  filtered = explicit.handler("context")({ messages: structuredClone(explicit.sessionMessages) }, explicit.ctx).messages;
  assert(filtered.length === 1 && filtered[0].content.startsWith("Ground the accepted Phase A plan"), "Phase B retained Phase A messages or tool results");
  assert(Buffer.byteLength(JSON.stringify(filtered)) < Buffer.byteLength(JSON.stringify(explicit.sessionMessages)), "Phase B serialized context did not shrink deterministically");

  const implicit = await extensionHarness(root, extension, "context-implicit", false, true, "", prior);
  implicit.handler("before_agent_start")({ prompt: implicit.messages[0].content, systemPrompt: "base" }, implicit.ctx);
  filtered = implicit.handler("context")({ messages: structuredClone(implicit.sessionMessages) }, implicit.ctx).messages;
  assert(filtered.length === 2 && filtered[0].role === "user" && filtered[0].content === "Initiating objective context" && filtered[1].content === "Prepare and submit the Fanout implementation plan.", "implicit /fanout-plan retained more than its initiating user request");
}
