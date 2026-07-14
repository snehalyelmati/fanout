import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  activatePlanningTools,
  FANOUT_PLANNING_TOOLS,
  planningToolBlockReason,
  restorePlanningTools,
  submitPlanningArtifact,
} from "../packages/fanout-pi/src/planning-capabilities.ts";
import { FANOUT_ORCHESTRATION_MARKER } from "../packages/fanout-pi/src/fanout-plan-orchestration.ts";
import {
  appendFanoutReport,
  FANOUT_EXECUTION_REPORT_ENTRY,
  FANOUT_PLAN_REPORT_ENTRY,
  registerFanoutReportPresentation,
} from "../packages/fanout-pi/src/report-presentation.ts";

const root = mkdtempSync(join(tmpdir(), "fanout-planning-boundary-"));
try {
  testToolProfile();
  testArtifactSubmission();
  testReportPresentation();
  await testPlanningLifecycle();
  await testA15ProviderContext();
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
  const state = phaseState(repository, artifactRoot, artifactDir, "implementation");
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

function testReportPresentation() {
  const reportPath = join(root, "report.md");
  writeFileSync(reportPath, "PRIVATE_REPORT\n");
  const registrations = [];
  const entries = [];
  const safe = {
    registerEntryRenderer: (type, renderer) => registrations.push({ type, renderer }),
    appendEntry: (type, data) => entries.push({ type, data }),
    sendMessage: () => { throw new Error("context-bearing fallback used"); },
    sendUserMessage: () => { throw new Error("context-bearing fallback used"); },
  };
  assert(registerFanoutReportPresentation(safe), "safe report capabilities were rejected");
  assert(registrations.map((entry) => entry.type).join(",") === `${FANOUT_PLAN_REPORT_ENTRY},${FANOUT_EXECUTION_REPORT_ENTRY}`, "versioned report renderers were not registered");
  appendFanoutReport(safe, true, { kind: "planning", reportPath });
  appendFanoutReport(safe, true, { kind: "execution", reportPath });
  assert(entries.length === 2 && entries.every((entry) => entry.data.content === "PRIVATE_REPORT\n"), "report entries did not retain artifact-derived data");
  assert(JSON.stringify(entries.map((entry) => [entry.type, entry.data.schema, Object.keys(entry.data).sort()])) === JSON.stringify([[FANOUT_PLAN_REPORT_ENTRY, "fanout.planning-report", ["content", "schema", "version"]], [FANOUT_EXECUTION_REPORT_ENTRY, "fanout.execution-report", ["content", "schema", "version"]]]), "report entries were not the two closed presentation-only v1 schemas");
  assert(registrations[0].renderer({ data: entries[0].data }).render(80).join("\n").includes("PRIVATE_REPORT"), "renderer did not use entry.data");
  const narrowLines = registrations[0].renderer({ data: { ...entries[0].data, content: `Objective: ${"abort scheduling cleanup ".repeat(20)}` } }).render(40);
  assert(narrowLines.length > 1 && narrowLines.every((line) => visibleWidth(line) <= 40), "planning report renderer exceeded Pi's render width");
  for (const { width, content } of [{ width: 0, content: "zero" }, { width: 1, content: "✅" }]) {
    const lines = registrations[0].renderer({ data: { ...entries[0].data, content } }).render(width);
    assert(lines.every((line) => visibleWidth(line) <= width), `planning report renderer exceeded edge width ${width}`);
  }
  for (const invalid of [
    undefined,
    { schema: FANOUT_PLAN_REPORT_ENTRY, version: 1 },
    { schema: FANOUT_PLAN_REPORT_ENTRY, version: 2, content: "future" },
    { schema: FANOUT_PLAN_REPORT_ENTRY, version: 1, content: "mixed", legacyPath: reportPath },
    { schema: FANOUT_EXECUTION_REPORT_ENTRY, version: 1, content: "cross-type" },
  ]) expectThrows(() => registrations[0].renderer({ data: invalid }), /Fanout report/, "planning renderer admitted non-v1 report data");
  expectThrows(() => registrations[1].renderer({ data: entries[0].data }), /Fanout report schema/, "execution renderer admitted planning report data");

  assert(!registerFanoutReportPresentation({}), "missing report capabilities did not fail closed");
  assert(!registerFanoutReportPresentation({ appendEntry() {} }), "partial report capabilities did not fail closed");
  assert(!registerFanoutReportPresentation({ appendEntry() {}, registerEntryRenderer() { throw new Error("registration failed"); } }), "throwing renderer registration did not fail closed");
  expectThrows(() => appendFanoutReport({ appendEntry() { throw new Error("append failed"); } }, true, { kind: "planning", reportPath }), /append failed/, "throwing report append");
  expectThrows(() => appendFanoutReport(safe, false, { kind: "planning", reportPath }), /unavailable/, "disabled report presentation");
}

async function testA15ProviderContext() {
  const piCli = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
  const sessionManagerUrl = pathToFileURL(join(dirname(piCli), "core", "session-manager.js")).href;
  const { buildSessionContext } = await import(sessionManagerUrl);
  for (const mode of ["tui", "rpc", "json", "print"]) {
    const appended = [];
    const pi = { registerEntryRenderer() {}, appendEntry: (customType, data) => appended.push({ customType, data }) };
    assert(registerFanoutReportPresentation(pi), `report presentation unavailable in ${mode} mode`);
    for (const kind of ["planning", "execution"]) {
      const reportPath = join(root, `${mode}-${kind}-report.md`);
      writeFileSync(reportPath, `PRIVATE_${mode.toUpperCase()}_${kind.toUpperCase()}_REPORT\n`);
      appendFanoutReport(pi, true, { kind, reportPath });
    }
    const reportEntries = appended.map((entry, index) => ({ type: "custom", id: `report-${mode}-${index}`, parentId: index ? `report-${mode}-${index - 1}` : null, timestamp: "2026-07-13T00:00:00.000Z", ...entry }));
    const laterProviderRequest = { messages: buildSessionContext(reportEntries).messages };
    const serialized = JSON.stringify(laterProviderRequest);
    assert(!serialized.includes(`PRIVATE_${mode.toUpperCase()}`) && !serialized.includes(FANOUT_PLAN_REPORT_ENTRY) && !serialized.includes(FANOUT_EXECUTION_REPORT_ENTRY), `A15 failed in ${mode} mode`);
  }
}

async function testPlanningLifecycle() {
  const extension = (await import("../packages/fanout-pi/src/index.ts")).default;
  const rejectedPreflight = await extensionHarness(extension, "no-model", false, false);
  assert(rejectedPreflight.messages.length === 0 && !existsSync(rejectedPreflight.activePointerPath) && rejectedPreflight.notifications.some((entry) => entry.message.includes("prior active packet selection remains invalidated")), "planning preflight rejection left or misreported the prior active selection");
  for (const scenario of ["success", "failure", "unsubmitted-file", "mutated-submission", "mutated-details-submission", "cancellation", "clarification", "queued-transition"]) {
    const harness = await extensionHarness(extension, scenario, scenario === "queued-transition" || scenario === "mutated-details-submission");
    const before = harness.handler("before_agent_start");
    const baseTools = [...harness.activeTools];
    const started = before({ prompt: harness.messages[0].content, systemPrompt: "base" }, harness.ctx);
    const artifactDir = /"artifactDir":\s*"([^"]+)"/.exec(started?.systemPrompt ?? "")?.[1];
    assert(artifactDir, `${scenario}: internal phase prompt omitted the controller artifact directory`);
    assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), `${scenario}: planning profile was not activated`);
    const gate = harness.handler("tool_call")({ toolName: scenario === "clarification" ? "ask_user_question" : "bash", toolCallId: "call", input: {} }, harness.ctx);
    if (scenario === "clarification") assert(gate === undefined, "clarification tool was blocked");
    else assert(gate?.block === true, `${scenario}: blocked tool reached execution`);

    if (scenario === "success" || scenario === "queued-transition" || scenario === "mutated-submission" || scenario === "mutated-details-submission") {
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

    if (scenario === "queued-transition") {
      const phaseBPrompt = harness.messages.at(-1);
      assert(harness.messages.length === 2 && phaseBPrompt.options === undefined && !phaseBPrompt.queuedWhileStreaming, "Phase B was queued inside agent_end and bypassed before_agent_start");
      const phaseBStarted = before({ prompt: phaseBPrompt.content, systemPrompt: "base" }, harness.ctx);
      assert(!phaseBStarted.systemPrompt.includes(harness.activePointerPath), "Phase B exposed the unpublished active packet as apparent input");
      assert(phaseBStarted.systemPrompt.includes("controller-owned output destination") && phaseBStarted.systemPrompt.includes("submit the grounding body now"), "Phase B did not distinguish its output from prerequisites");
      assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), "queued Phase B profile was not activated");
      harness.handler("session_before_switch")({}, harness.ctx);
      assert(JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), "session switch did not restore the queued Phase B profile");
    }
  }
}

async function extensionHarness(extension, scenario, queued, modelAvailable = true) {
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
    ui: { notify: (message, level) => notifications.push({ message, level }), setStatus() {}, confirm: async () => false },
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
  mkdirSync(dirname(activePointerPath), { recursive: true });
  writeFileSync(activePointerPath, '{"legacy":"selection"}\n');
  await commands.get("fanout-plan").handler("Test planning boundary", ctx);
  assert(!existsSync(activePointerPath), `${scenario}: /fanout-plan did not invalidate the prior active selection before planning`);
  return {
    get activeTools() { return pi.activeTools; },
    messages, notifications, activePointerPath, ctx, submit: tools.get("fanout_submit_artifact"),
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
    artifactDir,
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

function validDetails(_state, _objective) {
  const command = { executable: "rtk", args: ["npm", "run", "check"] };
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
