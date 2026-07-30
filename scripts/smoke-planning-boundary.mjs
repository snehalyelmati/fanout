import { rejects } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { BATCHING_DISCIPLINE_MARKER } from "../packages/fanout-core/src/batching-discipline.ts";
import {
  activatePlanningTools,
  FANOUT_PLANNING_TOOLS,
  planningToolBlockReason,
  restorePlanningTools,
  submitPlanningArtifact,
} from "../packages/fanout-pi/src/planning-capabilities.ts";
import { FANOUT_ORCHESTRATION_MARKER } from "../packages/fanout-pi/src/fanout-plan-orchestration.ts";
import { publishProjectExecutionProfile } from "../packages/fanout-pi/src/project-execution-profile.ts";
import { testPlanningPresentation } from "./smoke-planning-presentation.mjs";

const profileIdentity = { path: "project-execution-profile.json", sha256: "a".repeat(64), byteLength: 1 };

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

  expectThrows(() => submitPlanningArtifact(state, { ...plan, artifactDir: join(root, "wrong-run") }, repository), /unknown or missing fields/, "caller-selected Phase A envelope");
  expectThrows(() => submitPlanningArtifact(state, { schema: "wrong" }, repository), /unknown or missing fields/, "malformed Phase A");

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
  const submittedDetails = submitPlanningArtifact(detailsState, details, repository);
  assert(submittedDetails.path === state.implementationDetailsPath, "controller did not select the Phase B destination");
  expectThrows(() => submitPlanningArtifact(detailsState, plan, repository), /unknown or missing fields/, "wrong-phase artifact");
  expectThrows(() => submitPlanningArtifact(detailsState, { ...details, sourcePlanPath: join(root, "wrong-run.json") }, repository), /unknown or missing fields/, "caller-selected Phase B envelope");

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
  const rejectedPreflight = await extensionHarness(extension, "no-model", false, false);
  assert(rejectedPreflight.messages.length === 0 && !existsSync(rejectedPreflight.activePointerPath) && rejectedPreflight.notifications.some((entry) => entry.message.includes("prior active packet selection remains invalidated")), "planning preflight rejection left or misreported the prior active selection");
  for (const [scenario, profile, published] of [
    ["refresh-profile-failure", validProfile(), false],
    ["refresh-profile-success", { preparation: [], readiness: [], candidateNormalization: [], requiredFinalGates: [] }, true],
  ]) {
    const harness = await extensionHarness(extension, scenario, false, true, "--refresh-profile Test planning boundary");
    const previous = readFileSync(harness.activeProfilePath);
    const started = harness.handler("before_agent_start")({ prompt: harness.messages[0].content, systemPrompt: "base" }, harness.ctx);
    assert(started.systemPrompt.includes("Project Execution Profile"), `${scenario}: refresh did not enter the profile phase`);
    assert(started.systemPrompt.indexOf("Build and submit the Project Execution Profile") < started.systemPrompt.indexOf(BATCHING_DISCIPLINE_MARKER), `${scenario}: generic batching buried the profile action`);
    await harness.submit.execute("submit", { artifact: profile }, undefined, undefined, harness.ctx);
    await harness.handler("agent_end")({}, harness.ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const current = readFileSync(harness.activeProfilePath);
    assert(published ? !current.equals(previous) : current.equals(previous), `${scenario}: active profile publication was not atomic`);
    assert(published ? harness.notifications.some(({ message }) => message.includes("Profile approved")) && harness.messages.at(-1)?.content === "Prepare and submit the Fanout implementation plan." : harness.messages.length === 1, `${scenario}: refresh lifecycle advanced incorrectly: ${JSON.stringify(harness.messages)}`);
  }
  for (const scenario of ["success", "failure", "unsubmitted-file", "mutated-submission", "mutated-details-submission", "duplicate-details-resubmission", "cancellation", "clarification", "queued-transition"]) {
      const harness = await extensionHarness(extension, scenario, scenario === "queued-transition" || scenario === "mutated-details-submission");
      const before = harness.handler("before_agent_start");
      const baseTools = [...harness.activeTools];
      const started = before({ prompt: harness.messages[0].content, systemPrompt: scenario === "clarification" ? `base\n\n${BATCHING_DISCIPLINE_MARKER}` : "base" }, harness.ctx);
    assert(started.systemPrompt.indexOf("Inspect the repository and submit exactly one") < started.systemPrompt.indexOf(BATCHING_DISCIPLINE_MARKER) && started.systemPrompt.split(BATCHING_DISCIPLINE_MARKER).length - 1 === 1, `${scenario}: phase action was buried or batching duplicated`);
    assert(!started.systemPrompt.includes("Fanout runtime context"), `${scenario}: planning prompt retained irrelevant runtime metadata`);
    const runId = /"runId":"([^"]+)"/.exec(started?.systemPrompt ?? "")?.[1];
    const artifactDir = runId ? join(dirname(harness.activeProfilePath), runId) : undefined;
    assert(artifactDir, `${scenario}: internal phase prompt omitted its run identity`);
    assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), `${scenario}: planning profile was not activated`);
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
}

async function extensionHarness(extension, scenario, queued, modelAvailable = true, invocation = "Test planning boundary") {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const messages = [];
  const notifications = [];
  let streaming = false;
  const pi = {
    activeTools: ["read", "bash", "extension_tool"],
    on: (event, handler) => handlers.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command),
    registerTool: (tool) => tools.set(tool.name, tool),
    registerProvider() {},
    registerEntryRenderer() {},
    appendEntry() {},
    getActiveTools() { return [...this.activeTools]; },
    setActiveTools(value) { this.activeTools = [...value]; },
    getThinkingLevel: () => "low",
    sendUserMessage: (content, options) => {
      if (streaming && options?.deliverAs !== "followUp") return;
      messages.push({ content, options, queuedWhileStreaming: streaming });
    },
  };
  process.env.FANOUT_ARTIFACT_DIR = join(root, "extension-artifacts");
  await extension(pi);
  const model = { provider: "doubleword-stub", id: "deepseek-v4-flash", name: "stub", contextWindow: 100000, maxTokens: 1000 };
  const ctx = {
    cwd: join(root, `lifecycle-${scenario}`), mode: "tui", hasUI: true, model: modelAvailable ? model : undefined,
    modelRegistry: { getAll: () => [model] }, isIdle: () => !queued,
    ui: { notify: (message, level) => notifications.push({ message, level }), setStatus() {}, confirm: async () => scenario.startsWith("refresh-profile") },
  };
  mkdirSync(ctx.cwd, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: ctx.cwd });
  execFileSync("git", ["config", "user.email", "fanout@example.invalid"], { cwd: ctx.cwd });
  execFileSync("git", ["config", "user.name", "Fanout Test"], { cwd: ctx.cwd });
  writeFileSync(join(ctx.cwd, "README.md"), "# Test\n");
  execFileSync("git", ["add", "README.md"], { cwd: ctx.cwd });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: ctx.cwd });
  const projectId = `${basename(ctx.cwd)}-${createHash("sha1").update(resolve(ctx.cwd)).digest("hex").slice(0, 12)}`;
  const activePointerPath = join(process.env.FANOUT_ARTIFACT_DIR, projectId, "active-packet.json");
  const projectArtifactRoot = dirname(activePointerPath);
  const activeProfilePath = join(projectArtifactRoot, "active-profile.json");
  publishProjectExecutionProfile({ schema: "fanout.project-execution-profile", version: 1, profileId: "test", createdAt: new Date(0).toISOString(), ...validProfile() }, projectArtifactRoot, activeProfilePath);
  mkdirSync(dirname(activePointerPath), { recursive: true });
  writeFileSync(activePointerPath, '{"legacy":"selection"}\n');
  await commands.get("fanout-plan").handler(invocation, ctx);
  assert(!existsSync(activePointerPath), `${scenario}: /fanout-plan did not invalidate the prior active selection before planning`);
  if (modelAvailable) assert(messages[0]?.content === (invocation.startsWith("--refresh-profile") ? "Build and submit the Fanout Project Execution Profile." : "Prepare and submit the Fanout implementation plan."), `${scenario}: initial planning trigger was not phase-scoped`);
  return {
    get activeTools() { return pi.activeTools; },
    messages, notifications, activePointerPath, activeProfilePath, ctx, submit: tools.get("fanout_submit_artifact"),
    handler(event) {
      const value = handlers.get(event);
      if (!value) throw new Error(`missing ${event} handler`);
      if (event !== "agent_end") return value;
      return (...args) => {
        streaming = true;
        try { return value(...args); } finally { streaming = false; }
      };
    },
  };
}

function phaseState(repository, artifactRoot, artifactDir, phase) {
  return {
    phase,
    runId: "run-1",
    invocation: "test",
    objective: "Test planning boundary",
    context: { projectArtifactRoot: artifactRoot, planningBase: { headCommit: "1".repeat(40), tree: "1".repeat(40) } },
    metrics: {},
    approvedProfile: { identity: profileIdentity, profile: { schema: "fanout.project-execution-profile", version: 1, profileId: "test", createdAt: new Date(0).toISOString(), ...validProfile() } },
    artifactDir,
    projectExecutionProfilePath: join(artifactDir, "project-execution-profile.json"),
    implementationPlanPath: join(artifactDir, "implementation-plan.json"),
    implementationDetailsPath: join(artifactDir, "implementation-details.json"),
  };
}

function validPlan(_artifactDir) {
  return {
    objective: "Test planning boundary", userContext: [], discoveredRepoFacts: [], assumptions: [],
    implementationItems: [{ id: "code", goals: ["Test"], writeResources: [{ kind: "file", path: "README.md" }], readResources: [], forbiddenWrites: [], semanticReviewCriteria: ["works"], advisoryNotes: [{ kind: "rationale", reference: "code", text: "Test" }] }],
  };
}

function validProfile() {
  const declaration = (command, purpose) => ({ command, purpose, expectedMutations: "none", networkAccess: false, lifecycleScripts: false });
  return { preparation: [], readiness: [declaration({ executable: "rtk", args: ["npm", "run", "ready"] }, "Verify project readiness")], candidateNormalization: [], requiredFinalGates: [declaration(profileGateCommand(), "Run required final gate")] };
}

function profileGateCommand() {
  return { executable: "rtk", args: ["npm", "run", "full-check"], env: { SECOND: "2", FIRST: "1" } };
}

function validDetails(_state, _objective) {
  const command = { executable: "rtk", args: ["npm", "run", "focused-check"] };
  return {
    finalValidationCommands: [command],
    items: [{ id: "code", kind: "docs", changes: [{ kind: "modify", target: { resource: { kind: "file", path: "README.md" }, sourcePlanIds: ["code"] }, intent: "Test", anchors: [{ kind: "section", section: "Test" }] }], readDependencies: [], forbiddenWrites: [], validationCommands: [command], advisoryNotes: [] }],
  };
}

function expectThrows(fn, pattern, label) {
  try { fn(); } catch (error) { if (pattern.test(String(error))) return; throw error; }
  throw new Error(`${label} did not throw`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
