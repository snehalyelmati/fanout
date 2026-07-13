import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const implementationPromptPath = "packages/fanout-pi/prompts/fanout-implementation-plan.md";
const detailsPromptPath = "packages/fanout-pi/prompts/fanout-implementation-details.md";
const oldPromptPath = "packages/fanout-pi/prompts/fanout-plan.md";
const oldExecutionPromptPath = "packages/fanout-pi/prompts/fanout-execution-packet.md";
for (const path of [implementationPromptPath, detailsPromptPath]) if (!existsSync(path)) throw new Error(`${path} is missing`);
if (existsSync(oldPromptPath)) throw new Error(`${oldPromptPath} should not be the runtime prompt anymore`);
if (existsSync(oldExecutionPromptPath)) throw new Error(`${oldExecutionPromptPath} should be replaced by the details prompt`);

const implementationPrompt = readFileSync(implementationPromptPath, "utf8");
const detailsPrompt = readFileSync(detailsPromptPath, "utf8");
const orchestration = readFileSync("packages/fanout-pi/src/fanout-plan-orchestration.ts", "utf8");
const fanoutPiIndex = readFileSync("packages/fanout-pi/src/index.ts", "utf8");

const piPkg = JSON.parse(readFileSync("packages/fanout-pi/package.json", "utf8"));
if (!piPkg.pi?.extensions?.includes("./src/index.ts")) throw new Error("packages/fanout-pi/package.json does not expose ./src/index.ts");
if (piPkg.pi?.prompts?.some((path) => path.includes("fanout-plan"))) throw new Error("/fanout-plan should be command-backed, not a package prompt");
for (const phrase of ["Phase A", "implementation-plan.json", "what must change and why", "Do not locate anchors", "Planning only", "ask_user_question", "Ambiguity gate", "implementationItems", "validationPlan", "contract-first", "Do not add dependencies for final verification", "not execution DAG edges", "resolved task objective", "Copy the adapter-provided `artifactDir` exactly", "bare repository-relative path", "explicit task-declared validation dependency", "exact upstream file/resource", "explicit task-declared multi-file ownership bundle or node", "top-level `finalValidationCommands`", "Implementation plan written; validating…"]) {
  if (!implementationPrompt.includes(phrase)) throw new Error(`${implementationPromptPath} is missing phrase: ${phrase}`);
}
for (const phrase of ["Phase B", "implementationPlanPath", "implementation-details.json", "where to edit and the exact edit intent", "deterministic compiler", "Do not invent contracts", "Do not decide execution dependencies", "Do not write packet fields", "anchorText", "symbolName", "lineRangeHint", "baseline-context", "post-change-required", "authorable from the contract", "one details item per independently editable file/resource", "explicit task-declared multi-file ownership bundle or node", "overrides the default per-resource split preference", "Reuse the same `sourcePlanIds`", "Phase A `filesToRead` entry overlaps", "Every Phase A `filesToChange` entry must be covered", "only as a concrete `post-change-required` file read", "explicit task-declared validation dependency", "matching upstream `filesToRead`", "same `sourcePlanIds`", "Copy adapter-provided `artifactDir` and `sourcePlanPath` exactly", "bare repository-relative path", "literal executable shell command", "Do not wrap it in Markdown backticks or a code fence", "applicable repository command-prefix rules", "such as `rtk`", "final integrated validation", "distinct from every item's `validationCommands`", "Use schema `fanout.implementation-details`, version `2`, status `ready`", "finalValidationCommands", "Do not serialize tests, docs, fixtures, or package scripts behind implementation unless", "requiredReadClassifications", "sourcePlanIds", "ownedResources", "validationCommands", "Copy `objective` exactly", "Implementation details written; validating…"]) {
  if (!detailsPrompt.includes(phrase)) throw new Error(`${detailsPromptPath} is missing phrase: ${phrase}`);
}
for (const forbidden of ["workerPacket", "parallelGroups", "tier assignments"]) {
  if (implementationPrompt.includes(forbidden)) throw new Error(`${implementationPromptPath} should not mention ${forbidden}`);
}
for (const phrase of ["fanout.plan.orchestration.v1", "buildImplementationPlanPrompt", "buildImplementationDetailsPrompt", "buildImplementationDetailsRepairPrompt", "requiredReadClassifications", "validateImplementationPlanArtifact", "validateImplementationPlan", "references itself"]) {
  if (!orchestration.includes(phrase)) throw new Error(`fanout-plan orchestration is missing phrase: ${phrase}`);
}
for (const phrase of ["if (pendingFanoutPlan)", "A Fanout plan is already in progress", "Fanout planning requires an active Pi model", "fanout_plan_rejected"]) {
  if (!fanoutPiIndex.includes(phrase)) throw new Error(`fanout-plan command is missing overlap guard phrase: ${phrase}`);
}
for (const phrase of ["const finishedFanoutPlan = pendingFanoutPlan", "buildRequiredReadClassifications", "const planObjective", "objective: planObjective", "fanout_required_read_classifications", "existsSync(finishedFanoutPlan.implementationDetailsPath)", "displayFanoutPlanReport", "appendFanoutReport", "reportPresentationAvailable", "fanout_plan_failed", "pi.on(\"message_update\"", "pi.on(\"message_end\"", "assistant_usage"]) {
  if (!fanoutPiIndex.includes(phrase)) throw new Error(`fanout-plan finalization is missing phrase: ${phrase}`);
}
for (const phrase of ["fanout_compiler_repair_requested", "buildImplementationDetailsRepairPrompt", "unclassifiedOverlapPolicy: \"sequential\"", "policy: \"sequential\"", "isAmbiguousReadOverlapFailure", "repairAttempted: true"]) {
	if (!fanoutPiIndex.includes(phrase)) throw new Error(`fanout-plan compiler recovery is missing phrase: ${phrase}`);
}
for (const phrase of ["acceptedSubmission", "phaseSubmitted", "was not accepted by fanout_submit_artifact", "session_before_switch", "session_before_fork", "session_shutdown"]) if (!fanoutPiIndex.includes(phrase)) throw new Error(`fanout-plan lifecycle boundary is missing phrase: ${phrase}`);
for (const phrase of ["pendingFanoutPlan?.systemPrompt", "systemPrompt: undefined", "activatePlanningTools(pi)", "Run Fanout planning for:", "Continue Fanout planning details for:", "Repair Fanout planning details for:"]) {
	if (!fanoutPiIndex.includes(phrase)) throw new Error(`fanout-plan typed prompt state is missing phrase: ${phrase}`);
}
for (const forbidden of ["isFanoutPhasePrompt(event.prompt", "fanout_phase_prompt_marker_mismatch", "sendMessage.call", "triggerTurn: false"]) if (fanoutPiIndex.includes(forbidden)) throw new Error(`fanout-pi retained forbidden lifecycle/report mechanism: ${forbidden}`);
if (fanoutPiIndex.includes("activeFanoutPlan")) throw new Error("fanout-plan finalization must not depend on activeFanoutPlan prompt-marker state");
if (fanoutPiIndex.indexOf("if (!tier1Resolved") > fanoutPiIndex.indexOf("const run = createFanoutPlanRun")) throw new Error("fanout-plan resolves artifacts before rejecting a missing active model");

const { buildImplementationDetailsPrompt, buildImplementationDetailsRepairPrompt, buildImplementationPlanPrompt, createFanoutPlanRun, validateImplementationPlanArtifact } = await import("../packages/fanout-pi/src/fanout-plan-orchestration.ts");
const { validateImplementationDetailsArtifact } = await import("../packages/fanout-core/src/fanout-compiler.ts");
const { createPlanningMetrics, planningMetricsSummary, recordPlanningAssistant, recordPlanningToolInterval } = await import("../packages/fanout-pi/src/planning-observability.ts");
const metrics = createPlanningMetrics();
const assistantUsage = recordPlanningAssistant(metrics, { role: "assistant", provider: "stub", model: "planner", usage: { input: 10, output: 4, cacheRead: 3, cacheWrite: 2, totalTokens: 19, cost: { total: 0.25 } } });
const metricsSummary = planningMetricsSummary(metrics, "medium");
if (assistantUsage?.pricingSource !== "pi-json-usage" || metricsSummary.inputTokens !== 10 || metricsSummary.outputTokens !== 4 || metricsSummary.cacheReadTokens !== 3 || metricsSummary.cacheWriteTokens !== 2 || metricsSummary.totalTokens !== 19 || metricsSummary.estimatedCostUsd !== 0.25 || metricsSummary.nonToolDurationMs < 0) throw new Error(`bad planning metrics: ${JSON.stringify(metricsSummary)}`);
for (const testCase of [
  { name: "partial overlap", intervals: [[10, 30], [20, 40]], now: 50, tool: 30, nonTool: 20 },
  { name: "nested reverse completion", intervals: [[20, 40], [10, 50]], now: 60, tool: 40, nonTool: 20 },
  { name: "touching", intervals: [[0, 10], [10, 20]], now: 30, tool: 20, nonTool: 10 },
  { name: "disjoint", intervals: [[5, 10], [20, 25]], now: 30, tool: 10, nonTool: 20 },
]) {
  const toolMetrics = createPlanningMetrics();
  toolMetrics.started = 0;
  for (const [started, ended] of testCase.intervals) recordPlanningToolInterval(toolMetrics, started, ended);
  const summary = planningMetricsSummary(toolMetrics, "off", testCase.now);
  if (summary.toolDurationMs !== testCase.tool || summary.nonToolDurationMs !== testCase.nonTool) throw new Error(`${testCase.name} tool union is wrong: ${JSON.stringify(summary)}`);
}
const helperDir = mkdtempSync(join(tmpdir(), "doubleword-pi-plan-helper-"));
try {
  const run = createFanoutPlanRun("Update docs", { projectArtifactRoot: helperDir }, new Date("2026-07-08T01:02:03.100Z"));
  const sameSecondRun = createFanoutPlanRun("Update docs", { projectArtifactRoot: helperDir }, new Date("2026-07-08T01:02:03.900Z"));
  if (run.runId === sameSecondRun.runId) throw new Error(`same-second run ids collided: ${run.runId}`);
  const context = { projectArtifactRoot: helperDir, resolvedTierPlan: { tier1: {}, tier2: {} } };
  const implementationPromptText = buildImplementationPlanPrompt("Update docs", context, run);
  if (!implementationPromptText.includes("fanout.plan.orchestration.v1") || !implementationPromptText.includes('"phase":"implementation"')) throw new Error("implementation phase diagnostic marker is missing");
  const checklist = [{ readerPlanId: "docs", readFile: "README.md", ownerPlanId: "impl", ownerFile: "README.md" }];
  const detailsPromptText = buildImplementationDetailsPrompt("Update docs", { ...context, resolvedTierPlan: { leaked: true } }, run, checklist);
  if (!detailsPromptText.includes("fanout.plan.orchestration.v1") || !detailsPromptText.includes('"phase":"details"')) throw new Error("details phase diagnostic marker is missing");
  for (const phrase of ["Phase B input", "requiredReadClassifications", "\"readerPlanId\": \"docs\"", "\"implementationPlanPath\""]) {
    if (!detailsPromptText.includes(phrase)) throw new Error(`details prompt missing phrase: ${phrase}`);
  }
  if (detailsPromptText.includes("resolvedTierPlan") || detailsPromptText.includes("leaked")) throw new Error("details prompt leaked full preflight context");
  const repairPrompt = buildImplementationDetailsRepairPrompt("Update docs", context, run, ["ambiguous Phase A filesToRead overlap"], checklist);
  if (!repairPrompt.includes("fanout.plan.orchestration.v1") || !repairPrompt.includes('"phase":"details"')) throw new Error("details repair diagnostic marker is missing");
  for (const phrase of ["repairing implementation-details.json only", "Do not change Phase A", "baseline-context if old/current file is enough", "post-change-required if changed file is needed", "ambiguous Phase A filesToRead overlap"]) {
    if (!repairPrompt.includes(phrase)) throw new Error(`repair prompt missing phrase: ${phrase}`);
  }
  mkdirSync(dirname(run.implementationPlanPath), { recursive: true });

  const validPlan = {
    schema: "fanout.implementation-plan",
    version: 1,
    status: "ready",
    objective: "Update docs",
    createdAt: "2026-07-08T01:02:03.100Z",
    artifactDir: run.artifactDir,
    userContext: [],
    discoveredRepoFacts: [],
    assumptions: [],
    implementationItems: [{ id: "docs", goal: "Update docs", rationale: "Docs-only change.", filesToChange: ["README.md"], filesToRead: [], dependencies: [], validation: ["rtk npm run check"], acceptanceCriteria: ["README updated"], risks: [] }],
    validationPlan: ["rtk npm run check"],
    risks: [],
  };
  writePlan(run.implementationPlanPath, validPlan);
  expectValidPlan(run.implementationPlanPath, { artifactDir: run.artifactDir });

  writePlan(run.implementationPlanPath, { ...validPlan, objective: "Resolved docs objective" });
  expectValidPlan(run.implementationPlanPath, { artifactDir: run.artifactDir });
  const validDetails = {
    schema: "fanout.implementation-details",
    version: 2,
    status: "ready",
    objective: "Resolved docs objective",
    artifactDir: run.artifactDir,
    sourcePlanPath: run.implementationPlanPath,
    finalValidationCommands: ["rtk npm run check"],
    items: [{
      sourcePlanIds: ["docs"],
      ownedResources: ["README.md"],
      existingFileEdits: [{ file: "README.md", section: "Usage", editIntent: "Update docs." }],
      newFiles: [],
      readDependencies: [],
      forbiddenChanges: [],
      validationCommands: ["rtk npm run check"],
    }],
  };
  if (validDetails.finalValidationCommands.length !== 1 || validDetails.finalValidationCommands[0] !== "rtk npm run check") throw new Error(`bad final validation command fixture: ${JSON.stringify(validDetails.finalValidationCommands)}`);
  const detailsValidation = validateImplementationDetailsArtifact(validDetails, { objective: "Resolved docs objective", artifactDir: run.artifactDir, sourcePlanPath: run.implementationPlanPath });
  if (!detailsValidation.ok) throw new Error(`resolved Phase B objective was rejected: ${JSON.stringify(detailsValidation)}`);
  const wrongDetailsValidation = validateImplementationDetailsArtifact({ ...validDetails, objective: "Invocation shorthand" }, { objective: "Resolved docs objective", artifactDir: run.artifactDir, sourcePlanPath: run.implementationPlanPath });
  if (wrongDetailsValidation.ok || !wrongDetailsValidation.errors.some((error) => error.includes("objective does not match implementation plan"))) throw new Error(`mismatched Phase B objective was accepted: ${JSON.stringify(wrongDetailsValidation)}`);
  writePlan(run.implementationPlanPath, { ...validPlan, artifactDir: join(helperDir, "wrong") });
  expectInvalidPlan(run.implementationPlanPath, { artifactDir: run.artifactDir }, "artifactDir does not match current run");
  const { createdAt, assumptions, risks, ...missingRequired } = validPlan;
  writePlan(run.implementationPlanPath, missingRequired);
  expectInvalidPlan(run.implementationPlanPath, { artifactDir: run.artifactDir }, "createdAt is required");
  writePlan(run.implementationPlanPath, { ...validPlan, implementationItems: [{ ...validPlan.implementationItems[0], dependencies: ["docs"] }] });
  expectInvalidPlan(run.implementationPlanPath, { artifactDir: run.artifactDir }, "references itself");
  writePlan(run.implementationPlanPath, { ...validPlan, implementationItems: [{ ...validPlan.implementationItems[0], dependencies: ["missing"] }] });
  expectInvalidPlan(run.implementationPlanPath, { artifactDir: run.artifactDir }, "references unknown id missing");
  writePlan(run.implementationPlanPath, { ...validPlan, validationPlan: [42] });
  expectInvalidPlan(run.implementationPlanPath, { artifactDir: run.artifactDir }, "validationPlan[0] must be a string");
  writePlan(run.implementationPlanPath, { ...validPlan, implementationItems: [{ ...validPlan.implementationItems[0], filesToChange: ["`README.md`"] }] });
  expectInvalidPlan(run.implementationPlanPath, { artifactDir: run.artifactDir }, "filesToChange[0] must be a bare repository path");
} finally {
  rmSync(helperDir, { recursive: true, force: true });
}

function writePlan(path, plan) {
  writeFileSync(path, `${JSON.stringify(plan)}\n`);
}

function expectValidPlan(path, expected) {
  const validation = validateImplementationPlanArtifact(path, expected);
  if (!validation.ok || validation.itemCount !== 1) throw new Error(`bad implementation-plan validation: ${JSON.stringify(validation)}`);
}

function expectInvalidPlan(path, expected, errorSubstring) {
  const validation = validateImplementationPlanArtifact(path, expected);
  if (validation.ok || !validation.errors.some((error) => error.includes(errorSubstring))) throw new Error(`expected validation error ${errorSubstring}: ${JSON.stringify(validation)}`);
}

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-plan-"));
const repoRoot = process.cwd();

function readEvents(logFile) {
  return readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function run(name, promptText, settings, projectSettings) {
  const logFile = join(dir, `${name}.jsonl`);
  const agentDir = join(dir, `${name}-agent`);
  const projectDir = join(dir, `${name}-project`);
  mkdirSync(agentDir, { recursive: true });
  if (settings) writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  if (projectSettings) {
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(join(projectDir, ".pi", "settings.json"), `${JSON.stringify(projectSettings, null, 2)}\n`, "utf8");
  }
  const result = spawnSync("pi", ["--no-extensions", "-e", repoRoot, "--model", "doubleword-stub/deepseek-v4-flash", "-p", promptText], {
    cwd: projectSettings ? projectDir : repoRoot,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, DOUBLEWORD_OBSERVABILITY_FILE: logFile, DOUBLEWORD_RUN_ID: `smoke-planning-${name}` },
    encoding: "utf8",
  });

  if (result.status !== 0 || (name === "plain" && !result.stdout.includes("Doubleword stub response."))) {
    throw new Error(`${name} planning smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const events = readEvents(logFile);
  if (!events.some((event) => event.event === "provider_start")) throw new Error(`${name}: missing provider_start event`);
  const providerEnd = events.find((event) => event.event === "provider_end");
  if (!providerEnd) throw new Error(`${name}: missing provider_end event`);
  const input = providerEnd.usage?.input;
  if (typeof input !== "number") throw new Error(`${name}: missing provider_end.usage.input`);
  return { events, input, logFile };
}

function event(runResult, name) {
  const found = runResult.events.find((item) => item.event === name);
  if (!found) throw new Error(`${runResult.logFile}: missing ${name} event`);
  return found;
}

function preflight(runResult) {
  return event(runResult, "fanout_plan_preflight");
}

try {
  const plain = run("plain", "Prepare a docs-only change plan");
  const planned = run("fanout-plan", "/fanout-plan Prepare a docs-only change plan", {
    defaultThinkingLevel: "low",
    fanout: { tiers: {
      tier1: { provider: "doubleword-stub", model: "glm-5-2", thinking: "medium" },
      tier2: { provider: "doubleword-stub", model: "glm-5-2", thinking: "medium", enabled: false },
    } },
  });
  const unavailable = preflight(planned);
  if (typeof unavailable.sessionRunId !== "string" || typeof unavailable.planRunId !== "string" || "runId" in unavailable) throw new Error(`planning identities were not separated: ${JSON.stringify(unavailable)}`);
  if (unavailable.tierPlan?.tier1?.provider !== "doubleword-stub" || unavailable.tierPlan?.tier1?.model !== "deepseek-v4-flash" || unavailable.tierPlan?.tier1?.thinking !== "low" || unavailable.tierPlan?.tier1?.source !== "current Pi active model") {
    throw new Error(`legacy tier1 override replaced the current Pi model: ${JSON.stringify(unavailable.tierPlan)}`);
  }
  if (unavailable.tierPlan?.tier2?.status !== "unavailable" || unavailable.tierPlan?.tier2?.fallback !== "tier1" || unavailable.tier2Availability?.available !== false || unavailable.nodeKindTierPolicy?.fallbackTier !== "tier1" || !String(unavailable.tier2Availability?.reason).includes("disabled")) {
    throw new Error(`bad unavailable tier2 fallback: ${JSON.stringify(unavailable)}`);
  }
  if (unavailable.tierPlan?.tier2Fallback?.provider !== unavailable.tierPlan?.tier1?.provider || unavailable.tierPlan?.tier2Fallback?.model !== unavailable.tierPlan?.tier1?.model || unavailable.tierPlan?.tier2Fallback?.source !== "tier1 inheritance") {
    throw new Error(`missing fallback config did not inherit resolved tier1: ${JSON.stringify(unavailable.tierPlan)}`);
  }

  const layered = run("fanout-plan-layered-settings", "/fanout-plan Prepare a docs-only change plan", {
    defaultThinkingLevel: "low",
    fanout: {
      tiers: { tier2: { provider: "doubleword-stub", model: "glm-5-2", thinking: "medium", enabled: true } },
      execution: { tier2Fallback: { provider: "doubleword-stub", model: "glm-5-2", thinking: "medium" } },
    },
  }, {
    fanout: {
      tiers: { tier2: { enabled: false } },
      execution: { tier2Fallback: { inherit: "tier1" } },
    },
  });
  const layeredPreflight = preflight(layered);
  const layeredStart = event(layered, "fanout_plan_start");
  if (layeredPreflight.tierPlan?.tier2?.status !== "unavailable" || layeredPreflight.tier2Availability?.available !== false || !String(layeredPreflight.tier2Availability?.reason).includes("disabled")) {
    throw new Error(`project tier2 override did not win through layered settings: ${JSON.stringify(layeredPreflight)}`);
  }
  if (layeredPreflight.tierPlan?.tier2Fallback?.provider !== layeredPreflight.tierPlan?.tier1?.provider || layeredPreflight.tierPlan?.tier2Fallback?.model !== layeredPreflight.tierPlan?.tier1?.model || layeredPreflight.tierPlan?.tier2Fallback?.source !== "tier1 inheritance" || !String(layeredPreflight.tierPlan?.tier2Fallback?.reason).includes("explicit inheritance marker")) {
    throw new Error(`project inheritance marker did not mask global fallback: ${JSON.stringify(layeredPreflight.tierPlan)}`);
  }
  if (JSON.stringify(layeredStart.tierDefaults?.tier2Fallback) !== JSON.stringify({ inherit: "tier1" })) {
    throw new Error(`layered fallback defaults exposed stale provider/model fields: ${JSON.stringify(layeredStart.tierDefaults?.tier2Fallback)}`);
  }

  const stubTier2 = run("fanout-plan-tier2-stub", "/fanout-plan Prepare a docs-only change plan", {
    fanout: {
      tiers: { tier2: { provider: "doubleword-stub", model: "glm-5-2", thinking: "medium" } },
      execution: { tier2Fallback: { provider: "doubleword-stub", model: "deepseek-v4-flash", thinking: "off" } },
    },
  });
  const available = preflight(stubTier2);
  if (
    available.tierPlan?.tier2?.provider !== "doubleword-stub" ||
    available.tierPlan?.tier2?.model !== "glm-5-2" ||
    available.tierPlan?.tier2?.thinking !== "medium" ||
    available.tierPlan?.tier2?.source !== "fanout.tiers.tier2" ||
    available.tierPlan?.tier2?.status !== "available" ||
    available.tier2Availability?.available !== true ||
    available.tier2Availability?.reason !== "model has async/background/authReady fanout metadata" ||
    available.tier2Availability?.fanout?.async !== true ||
    available.tier2Availability?.fanout?.background !== true ||
    available.tier2Availability?.fanout?.authReady !== true ||
    "fallback" in available.tierPlan.tier2 ||
    available.tierPlan?.tier2Fallback?.provider !== "doubleword-stub" ||
    available.tierPlan?.tier2Fallback?.model !== "deepseek-v4-flash" ||
    available.tierPlan?.tier2Fallback?.thinking !== "off" ||
    available.tierPlan?.tier2Fallback?.source !== "fanout.execution.tier2Fallback"
  ) {
    throw new Error(`bad available tier2 preflight: ${JSON.stringify(available)}`);
  }
  const minimumLift = 20;

  if (planned.input <= plain.input + minimumLift) {
    throw new Error(`fanout-plan did not materially increase provider input: plain=${plain.input}, fanout-plan=${planned.input}, logs=${plain.logFile},${planned.logFile}`);
  }

  console.log(`planning smoke passed (plain input=${plain.input}, fanout-plan input=${planned.input}, tier2-stub input=${stubTier2.input}, events=${plain.events.length}+${planned.events.length}+${stubTier2.events.length})`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability logs: ${dir}`);
  process.exit(1);
}
