import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { publishProjectExecutionProfile } from "../packages/fanout-pi/src/project-execution-profile.ts";

const tier = { provider: "doubleword-stub", model: "deepseek-v4-flash", thinking: "low", source: "test", status: "available", reason: "test" };
const profileIdentity = { path: "project-execution-profile.json", sha256: "a".repeat(64), byteLength: 1 };

export async function extensionHarness(root, extension, scenario, queued, modelAvailable = true, invocation = "Test planning boundary", seedMessages = []) {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const messages = [];
  const sessionMessages = structuredClone(seedMessages);
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
      sessionMessages.push({ role: "user", content });
    },
  };
  process.env.FANOUT_ARTIFACT_DIR = join(root, "extension-artifacts");
  await extension(pi);
  const model = { provider: "doubleword-stub", id: "deepseek-v4-flash", name: "stub", contextWindow: 100000, maxTokens: 1000 };
  const ctx = {
    cwd: join(root, `lifecycle-${scenario}`), mode: "tui", hasUI: true, model: modelAvailable ? model : undefined,
    modelRegistry: { getAll: () => [model] }, isIdle: () => !queued,
    sessionManager: { buildSessionContext: () => ({ messages: sessionMessages }) },
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
  if (scenario.startsWith("dirty-")) {
    writeFileSync(join(ctx.cwd, scenario === "dirty-untracked" ? "new.txt" : "README.md"), "User changes\n");
    if (scenario === "dirty-staged") execFileSync("git", ["add", "README.md"], { cwd: ctx.cwd });
  }
  await commands.get("fanout-plan").handler(invocation, ctx);
  assert(!existsSync(activePointerPath), `${scenario}: /fanout-plan did not invalidate the prior active selection before planning`);
  if (queued) {
    assert(messages.length === 0, "busy planning invocation bypassed phase start through follow-up queue");
    await handlers.get("agent_settled")({}, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (modelAvailable && !scenario.startsWith("dirty-")) assert(messages[0]?.content === (invocation.startsWith("--refresh-profile") ? "Build and submit the Fanout Project Execution Profile." : "Prepare and submit the Fanout implementation plan."), `${scenario}: initial planning trigger was not phase-scoped`);
  const submit = {
    get parameters() { return tools.get("fanout_submit_artifact").parameters; },
    async execute(...args) {
      const tool = tools.get("fanout_submit_artifact");
      sessionMessages.push({ role: "assistant", content: [{ type: "toolCall", id: args[0], name: "fanout_submit_artifact", arguments: args[1] }] });
      try {
        const result = await tool.execute(...args);
        sessionMessages.push({ role: "toolResult", toolCallId: args[0], toolName: "fanout_submit_artifact", content: result.content, isError: false });
        return result;
      } catch (error) {
        sessionMessages.push({ role: "toolResult", toolCallId: args[0], toolName: "fanout_submit_artifact", content: [{ type: "text", text: String(error) }], isError: true });
        throw error;
      }
    },
  };
  return {
    get activeTools() { return pi.activeTools; },
    messages, sessionMessages, notifications, activePointerPath, activeProfilePath, ctx, submit,
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

export function phaseState(_repository, artifactRoot, artifactDir, phase) {
  return {
    phase,
    runId: "run-1",
    invocation: "test",
    objective: "Test planning boundary",
    context: { projectArtifactRoot: artifactRoot, resolvedTierPlan: { tier1: tier, tier2: tier, tier2Fallback: tier }, planningBase: { headCommit: "1".repeat(40), tree: "1".repeat(40) } },
    metrics: {},
    approvedProfile: { identity: profileIdentity, profile: { schema: "fanout.project-execution-profile", version: 1, profileId: "test", createdAt: new Date(0).toISOString(), ...validProfile() } },
    artifactDir,
    projectExecutionProfilePath: join(artifactDir, "project-execution-profile.json"),
    implementationPlanPath: join(artifactDir, "implementation-plan.json"),
    implementationDetailsPath: join(artifactDir, "implementation-details.json"),
  };
}

export function validPlan() {
  return {
    objective: "Test planning boundary", userContext: [], discoveredRepoFacts: [], assumptions: [],
    implementationItems: [{ id: "code", goals: ["Test"], writeResources: [{ kind: "file", path: "README.md" }], readResources: [], forbiddenWrites: [], semanticReviewCriteria: ["works"], advisoryNotes: [{ kind: "rationale", reference: "code", text: "Test" }] }],
  };
}

export function validSubmission() { return { plan: validPlan(), details: validDetails() }; }

export function validProfile() {
  const declaration = (command, purpose) => ({ command, purpose, expectedMutations: "none", networkAccess: false, lifecycleScripts: false });
  return { preparation: [], readiness: [declaration({ executable: "rtk", args: ["npm", "run", "ready"] }, "Verify project readiness")], candidateNormalization: [], requiredFinalGates: [declaration(profileGateCommand(), "Run required final gate")] };
}

export function profileGateCommand() {
  return { executable: "rtk", args: ["npm", "run", "full-check"], env: { SECOND: "2", FIRST: "1" } };
}

export function validDetails() {
  const command = { executable: "rtk", args: ["npm", "run", "focused-check"] };
  return {
    finalValidationCommands: [command],
    items: [{ id: "code", kind: "docs", changes: [{ kind: "modify", target: { resource: { kind: "file", path: "README.md" }, sourcePlanIds: ["code"] }, intent: "Test", anchors: [{ kind: "section", section: "Test" }] }], readDependencies: [], validationCommands: [command], advisoryNotes: [] }],
  };
}

export function expectThrows(fn, pattern, label) {
  try { fn(); } catch (error) { if (pattern.test(String(error))) return; throw error; }
  throw new Error(`${label} did not throw`);
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function sdkPlanningSession(root, scenario, extension, extraExtension, settings = {}) {
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const { InMemoryCredentialStore } = await import("@earendil-works/pi-ai");
  const cwd = join(root, `sdk-${scenario}`);
  mkdirSync(cwd);
  for (const args of [["init", "-q"], ["config", "user.email", "fanout@example.invalid"], ["config", "user.name", "Fanout Test"]]) execFileSync("git", args, { cwd });
  writeFileSync(join(cwd, "README.md"), "# Test\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd });
  const projectId = `${basename(cwd)}-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}`;
  process.env.FANOUT_ARTIFACT_DIR = join(root, "sdk-artifacts");
  const projectArtifactRoot = join(process.env.FANOUT_ARTIFACT_DIR, projectId);
  publishProjectExecutionProfile({ schema: "fanout.project-execution-profile", version: 1, profileId: scenario, createdAt: new Date(0).toISOString(), ...validProfile() }, projectArtifactRoot, join(projectArtifactRoot, "active-profile.json"));
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 }, ...settings });
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerProvider("fanout-sdk-test", { baseUrl: "http://localhost.invalid", apiKey: "test-only", api: "openai-completions", models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }] });
  const agentDir = join(root, `sdk-agent-${scenario}`);
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [extension, extraExtension] });
  await resourceLoader.reload();
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: modelRuntime.getModel("fanout-sdk-test", "scripted"), settingsManager, sessionManager, resourceLoader });
  return { session, sessionManager, cwd, projectArtifactRoot, activePointerPath: join(projectArtifactRoot, "active-packet.json") };
}
