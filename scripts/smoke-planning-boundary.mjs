import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  activatePlanningTools,
  FANOUT_PLANNING_TOOLS,
  planningToolBlockReason,
  restorePlanningTools,
  submitPlanningArtifact,
} from "../packages/fanout-pi/src/planning-capabilities.ts";
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

  expectThrows(() => submitPlanningArtifact(state, { ...plan, artifactDir: join(root, "wrong-run") }, repository), /current run/, "wrong-run Phase A");
  expectThrows(() => submitPlanningArtifact(state, { schema: "wrong" }, repository), /schema/, "malformed Phase A");

  const detailsState = { ...state, phase: "details" };
  const details = validDetails(state, plan.objective);
  const submittedDetails = submitPlanningArtifact(detailsState, details, repository);
  assert(submittedDetails.path === state.implementationDetailsPath, "controller did not select the Phase B destination");
  expectThrows(() => submitPlanningArtifact(detailsState, plan, repository), /implementation details schema/, "wrong-phase artifact");
  expectThrows(() => submitPlanningArtifact(detailsState, { ...details, sourcePlanPath: join(root, "wrong-run.json") }, repository), /current run/, "wrong-run Phase B");

  const repositoryArtifact = join(repository, ".fanout", "run");
  expectThrows(() => submitPlanningArtifact(phaseState(repository, join(repository, ".fanout"), repositoryArtifact, "implementation"), { ...plan, artifactDir: repositoryArtifact }, repository), /cannot be submitted into the repository/, "repository destination");
  assert(!existsSync(join(repository, ".fanout")), "repository destination rejection mutated the repository");

  const outside = join(root, "symlink-outside");
  const linkedRoot = join(root, "linked-artifacts");
  mkdirSync(outside);
  symlinkSync(outside, linkedRoot, "dir");
  const linkedDir = join(linkedRoot, "run");
  submitPlanningArtifact(phaseState(repository, linkedRoot, linkedDir, "implementation"), { ...plan, artifactDir: linkedDir }, repository);
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
  appendFanoutReport(safe, true, { kind: "planning", runId: "plan-1", status: "ready", reportPath, details: { packetPath: "packet.json" } });
  appendFanoutReport(safe, true, { kind: "execution", runId: "run-1", status: "completed", reportPath, details: { eventPath: "events.jsonl" } });
  assert(entries.length === 2 && entries.every((entry) => entry.data.content === "PRIVATE_REPORT\n"), "report entries did not retain artifact-derived data");
  assert(registrations[0].renderer({ data: entries[0].data }).render().join("\n").includes("PRIVATE_REPORT"), "renderer did not use entry.data");

  assert(!registerFanoutReportPresentation({}), "missing report capabilities did not fail closed");
  assert(!registerFanoutReportPresentation({ appendEntry() {} }), "partial report capabilities did not fail closed");
  assert(!registerFanoutReportPresentation({ appendEntry() {}, registerEntryRenderer() { throw new Error("registration failed"); } }), "throwing renderer registration did not fail closed");
  expectThrows(() => appendFanoutReport({ appendEntry() { throw new Error("append failed"); } }, true, { kind: "planning", runId: "plan-2", status: "ready", reportPath, details: {} }), /append failed/, "throwing report append");
  expectThrows(() => appendFanoutReport(safe, false, { kind: "planning", runId: "plan-3", status: "ready", reportPath, details: {} }), /unavailable/, "disabled report presentation");
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
      appendFanoutReport(pi, true, { kind, runId: `${kind}-${mode}`, status: "ready", reportPath, details: { mode } });
    }
    const reportEntries = appended.map((entry, index) => ({ type: "custom", id: `report-${mode}-${index}`, parentId: index ? `report-${mode}-${index - 1}` : null, timestamp: "2026-07-13T00:00:00.000Z", ...entry }));
    const laterProviderRequest = { messages: buildSessionContext(reportEntries).messages };
    const serialized = JSON.stringify(laterProviderRequest);
    assert(!serialized.includes(`PRIVATE_${mode.toUpperCase()}`) && !serialized.includes(FANOUT_PLAN_REPORT_ENTRY) && !serialized.includes(FANOUT_EXECUTION_REPORT_ENTRY), `A15 failed in ${mode} mode`);
  }
}

async function testPlanningLifecycle() {
  const extension = (await import("../packages/fanout-pi/src/index.ts")).default;
  for (const scenario of ["success", "failure", "unsubmitted-file", "cancellation", "clarification", "queued-transition"]) {
    const harness = await extensionHarness(extension, scenario, scenario === "queued-transition");
    const before = harness.handler("before_agent_start");
    const baseTools = [...harness.activeTools];
    const started = before({ prompt: harness.messages[0].content, systemPrompt: "base" }, harness.ctx);
    const artifactDir = /"artifactDir":\s*"([^"]+)"/.exec(started?.systemPrompt ?? "")?.[1];
    assert(artifactDir, `${scenario}: internal phase prompt omitted the controller artifact directory`);
    assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), `${scenario}: planning profile was not activated`);
    const gate = harness.handler("tool_call")({ toolName: scenario === "clarification" ? "ask_user_question" : "bash", toolCallId: "call", input: {} }, harness.ctx);
    if (scenario === "clarification") assert(gate === undefined, "clarification tool was blocked");
    else assert(gate?.block === true, `${scenario}: blocked tool reached execution`);

    if (scenario === "success" || scenario === "queued-transition") {
      await harness.submit.execute("submit", { artifact: validPlan(artifactDir) }, undefined, undefined, harness.ctx);
    }
    if (scenario === "unsubmitted-file") {
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, "implementation-plan.json"), `${JSON.stringify(validPlan(artifactDir))}\n`);
    }
    if (scenario === "cancellation") harness.handler("session_shutdown")({}, harness.ctx);
    else harness.handler("agent_end")({}, harness.ctx);
    assert(JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), `${scenario}: exact prior profile was not restored`);
    if (scenario === "unsubmitted-file") assert(harness.messages.length === 1, "an unsubmitted Phase A file advanced planning");

    if (scenario === "queued-transition") {
      const phaseBPrompt = harness.messages.at(-1);
      assert(phaseBPrompt.options?.deliverAs === "followUp", "queued Phase A did not enqueue Phase B");
      before({ prompt: phaseBPrompt.content, systemPrompt: "base" }, harness.ctx);
      assert(JSON.stringify(harness.activeTools) === JSON.stringify(FANOUT_PLANNING_TOOLS), "queued Phase B profile was not activated");
      harness.handler("session_before_switch")({}, harness.ctx);
      assert(JSON.stringify(harness.activeTools) === JSON.stringify(baseTools), "session switch did not restore the queued Phase B profile");
    }
  }
}

async function extensionHarness(extension, scenario, queued) {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const messages = [];
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
    sendUserMessage: (content, options) => messages.push({ content, options }),
  };
  process.env.FANOUT_ARTIFACT_DIR = join(root, "extension-artifacts");
  await extension(pi);
  const model = { provider: "doubleword-stub", id: "deepseek-v4-flash", name: "stub", contextWindow: 100000, maxTokens: 1000 };
  const ctx = {
    cwd: join(root, `lifecycle-${scenario}`), mode: "tui", hasUI: true, model,
    modelRegistry: { getAll: () => [model] }, isIdle: () => !queued,
    ui: { notify() {}, setStatus() {}, confirm: async () => false },
  };
  mkdirSync(ctx.cwd, { recursive: true });
  await commands.get("fanout-plan").handler("Test planning boundary", ctx);
  return {
    get activeTools() { return pi.activeTools; },
    messages, ctx, submit: tools.get("fanout_submit_artifact"),
    handler(event) { const value = handlers.get(event); if (!value) throw new Error(`missing ${event} handler`); return value; },
  };
}

function phaseState(repository, artifactRoot, artifactDir, phase) {
  return {
    phase,
    runId: "run-1",
    invocation: "test",
    objective: "Test planning boundary",
    context: { projectArtifactRoot: artifactRoot },
    metrics: {},
    artifactDir,
    implementationPlanPath: join(artifactDir, "implementation-plan.json"),
    implementationDetailsPath: join(artifactDir, "implementation-details.json"),
  };
}

function validPlan(artifactDir) {
  return {
    schema: "fanout.implementation-plan", version: 1, status: "ready", objective: "Test planning boundary", createdAt: "2026-07-13T00:00:00.000Z", artifactDir,
    userContext: [], discoveredRepoFacts: [], assumptions: [], validationPlan: ["rtk npm run check"], risks: [],
    implementationItems: [{ id: "code", goal: "Test", rationale: "Test", filesToChange: ["README.md"], filesToRead: [], dependencies: [], validation: ["check"], acceptanceCriteria: ["works"], risks: [] }],
  };
}

function validDetails(state, objective) {
  return {
    schema: "fanout.implementation-details", version: 2, status: "ready", objective, artifactDir: state.artifactDir, sourcePlanPath: state.implementationPlanPath,
    finalValidationCommands: ["rtk npm run check"],
    items: [{ sourcePlanIds: ["code"], ownedResources: ["README.md"], existingFileEdits: [{ file: "README.md", section: "Usage", editIntent: "Test" }], newFiles: [], readDependencies: [], forbiddenChanges: [], validationCommands: ["rtk npm run check"] }],
  };
}

function expectThrows(fn, pattern, label) {
  try { fn(); } catch (error) { if (pattern.test(String(error))) return; throw error; }
  throw new Error(`${label} did not throw`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
