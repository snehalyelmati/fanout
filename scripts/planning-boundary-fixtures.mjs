import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { publishProjectExecutionProfile } from "../packages/fanout-pi/src/project-execution-profile.ts";

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
  await commands.get("fanout-plan").handler(invocation, ctx);
  assert(!existsSync(activePointerPath), `${scenario}: /fanout-plan did not invalidate the prior active selection before planning`);
  if (modelAvailable) assert(messages[0]?.content === (invocation.startsWith("--refresh-profile") ? "Build and submit the Fanout Project Execution Profile." : "Prepare and submit the Fanout implementation plan."), `${scenario}: initial planning trigger was not phase-scoped`);
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
    context: { projectArtifactRoot: artifactRoot, planningBase: { headCommit: "1".repeat(40), tree: "1".repeat(40) } },
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
