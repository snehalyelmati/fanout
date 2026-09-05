import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DOUBLEWORD_PRICING_PROVENANCE } from "../packages/doubleword-provider/src/pricing.ts";
import { deriveAttemptMetricTotals } from "../packages/fanout-core/src/attempt-metrics.ts";
import { correlatedWorkerMetrics } from "../packages/fanout-pi/src/attempt-evidence.ts";
import { extractWorkerSummary } from "../packages/fanout-pi/src/fanout-worker-contract.ts";
import {
  WORKER_MODEL_TOOLS,
  WORKER_TRUST_BOUNDARY,
  guardWorkerWritePath,
  workerToolBlockReason,
} from "../packages/fanout-pi/src/worker-capabilities.ts";
import {
  FANOUT_VALIDATE_TOOL,
  loadWorkerValidationContext,
  publishWorkerValidationManifest,
  registerWorkerValidationTool,
  runWorkerValidation,
  workerValidationBatchBlockReason,
} from "../packages/fanout-pi/src/worker-validation.ts";

const root = mkdtempSync(join(tmpdir(), "fanout-worker-pipeline-"));
try {
  const worktree = join(root, "worktree");
  const outside = join(root, "outside");
  mkdirSync(join(worktree, "src"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(worktree, "src", "value.txt"), "before\n");
  symlinkSync(outside, join(worktree, "escape"));

  assert(WORKER_MODEL_TOOLS.join(",") === "read,grep,find,ls,edit,write,fanout_validate", "A19 fixed worker profile changed");
  assert(workerToolBlockReason("read", { path: "../secret" }, worktree) === undefined, "worker reads were falsely described as contained");
  assert(workerToolBlockReason(FANOUT_VALIDATE_TOOL, {}, worktree) === undefined, "contract-bound validation was blocked");
  assert(workerToolBlockReason("bash", { command: "true" }, worktree)?.includes("unavailable"), "A7 bash remained model-callable");
  assert(workerToolBlockReason("extension_tool", {}, worktree)?.includes("unavailable"), "A7 extension tool remained model-callable");
  assert(workerToolBlockReason("write", { path: "src/new.txt" }, worktree) === undefined, "valid worker write was blocked");

  for (const path of ["../outside.txt", ".git/config", "src/../outside.txt", join(worktree, "absolute.txt"), "escape/mutated.txt"]) {
    const reason = workerToolBlockReason("write", { path }, worktree);
    assert(reason, `A7 worker escape was admitted: ${path}`);
  }
  assert(!existsSync(join(outside, "mutated.txt")), "A7 symlink escape mutated outside before rejection");
  assert(guardWorkerWritePath(worktree, "src/future/file.txt") === "src/future/file.txt", "new in-worktree path was rejected");

  await testWorkerValidation(root, worktree);
  await testNormalizedWorkerValidation(root, worktree);

  for (const phrase of ["ignored files", "external paths", "network", "processes", "outside Fanout containment"]) {
    assert(WORKER_TRUST_BOUNDARY.includes(phrase), `A20 trust boundary omitted ${phrase}`);
  }
  const partialStdout = join(root, "partial-stdout.jsonl");
  const partialObservability = join(root, "partial-observability.jsonl");
  writeFileSync(partialStdout, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "fake", model: "worker", usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { total: 0.01 } } } })}\n`);
  writeFileSync(partialObservability, `${JSON.stringify({ event: "turn_end", turnIndex: 0 })}\n`);
  const partial = workerMeasurement({ stdoutPath: partialStdout, observabilityPath: partialObservability, tier: "tier1", workerDurationMs: 8, expectedProvider: "fake", expectedModel: "worker" });
  assert(!partial.complete && deriveAttemptMetricTotals(partial).costUsd === 0.01 && deriveAttemptMetricTotals(partial).totalTokens === 6, "failed runtime attempt discarded observed partial usage/cost");
  const cachedStdout = join(root, "cached-stdout.jsonl");
  const cachedObservability = join(root, "cached-observability.jsonl");
  writeFileSync(cachedStdout, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "fake", model: "worker", usage: { input: 4, output: 2, cacheRead: 10, cacheWrite: 1, totalTokens: 6, cost: { total: 0.01 } }, content: [] } })}\n`);
  writeFileSync(cachedObservability, [
    { ts: "2026-07-13T00:00:00.000Z", event: "turn_start", turnIndex: 0 },
    { ts: "2026-07-13T00:00:00.001Z", event: "assistant_ttft", turnIndex: 0 },
    { ts: "2026-07-13T00:00:00.008Z", event: "turn_end", turnIndex: 0 },
  ].map(JSON.stringify).join("\n") + "\n");
  const cached = workerMeasurement({ stdoutPath: cachedStdout, observabilityPath: cachedObservability, tier: "tier1", workerDurationMs: 8, firstOutputMs: 1, expectedProvider: "fake", expectedModel: "worker" });
  assert(cached.complete && deriveAttemptMetricTotals(cached).inputTokens === 4 && deriveAttemptMetricTotals(cached).cacheReadTokens === 10 && deriveAttemptMetricTotals(cached).cacheWriteTokens === 1 && deriveAttemptMetricTotals(cached).totalTokens === 6, "Pi cached tokens or exact Turn interval were rejected or omitted");

  const providerStdout = join(root, "provider-stdout.jsonl");
  const providerObservability = join(root, "provider-observability.jsonl");
  const inputCost = 0.09 / 1_000_000 * 4;
  const outputCost = 0.18 / 1_000_000 * 2;
  const usage = { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: inputCost, output: outputCost, cacheRead: 0, cacheWrite: 0, total: inputCost + outputCost } };
  writeFileSync(providerStdout, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "doubleword", model: "deepseek-ai/DeepSeek-V4-Flash-0731", usage, content: [] } })}\n`);
  const providerEvents = [
    { ts: "2026-08-26T00:00:00.000Z", event: "turn_start", turnIndex: 0 },
    { ts: "2026-08-26T00:00:00.001Z", event: "provider_start", provider: "doubleword", model: "deepseek-ai/DeepSeek-V4-Flash-0731", turnIndex: 0 },
    { ts: "2026-08-26T00:00:00.002Z", event: "provider_ttft", provider: "doubleword", model: "deepseek-ai/DeepSeek-V4-Flash-0731", responseId: "response-1", turnIndex: 0, ttftMs: 1 },
    { ts: "2026-08-26T00:00:00.002Z", event: "assistant_ttft", turnIndex: 0 },
    { ts: "2026-08-26T00:00:00.007Z", event: "provider_end", provider: "doubleword", model: "deepseek-ai/DeepSeek-V4-Flash-0731", responseId: "response-1", turnIndex: 0, tier: "realtime", usage, usageSource: "provider", pricingSource: "doubleword-model-metadata" },
    { ts: "2026-08-26T00:00:00.008Z", event: "turn_end", turnIndex: 0 },
  ];
  writeFileSync(providerObservability, providerEvents.map(JSON.stringify).join("\n") + "\n");
  const staleProvider = workerMeasurement({ stdoutPath: providerStdout, observabilityPath: providerObservability, tier: "tier1", workerDurationMs: 8, firstOutputMs: 2, expectedProvider: "doubleword", expectedModel: "deepseek-ai/DeepSeek-V4-Flash-0731" });
  assert(staleProvider.status === "partial" && staleProvider.issues.some((issue) => issue.path.includes("pricingSourceUrl")), "absent Doubleword snapshot provenance did not remain partial");
  providerEvents[4] = { ...providerEvents[4], usageInputField: "input_tokens", usageOutputField: "output_tokens", pricingSourceUrl: DOUBLEWORD_PRICING_PROVENANCE.sourceUrl, pricingRetrievedAt: DOUBLEWORD_PRICING_PROVENANCE.retrievedAt, pricingSnapshotSha256: DOUBLEWORD_PRICING_PROVENANCE.snapshotSha256 };
  writeFileSync(providerObservability, providerEvents.map(JSON.stringify).join("\n") + "\n");
  const currentProvider = workerMeasurement({ stdoutPath: providerStdout, observabilityPath: providerObservability, tier: "tier1", workerDurationMs: 8, firstOutputMs: 2, expectedProvider: "doubleword", expectedModel: "deepseek-ai/DeepSeek-V4-Flash-0731" });
  assert(currentProvider.status !== "invalid", `current Doubleword snapshot provenance was rejected: ${JSON.stringify(currentProvider.issues)}`);
  providerEvents[4] = { ...providerEvents[4], usage: { ...usage, cost: { ...usage.cost, total: 0.0001 } } };
  writeFileSync(providerObservability, providerEvents.map(JSON.stringify).join("\n") + "\n");
  const wrongPricing = workerMeasurement({ stdoutPath: providerStdout, observabilityPath: providerObservability, tier: "tier1", workerDurationMs: 8, firstOutputMs: 2, expectedProvider: "doubleword", expectedModel: "deepseek-ai/DeepSeek-V4-Flash-0731" });
  assert(wrongPricing.status === "invalid" && wrongPricing.issues.some((issue) => issue.code === "pricing-mismatch"), "incorrect Doubleword cost was admitted with trusted snapshot provenance");
  const unpricedModel = "mock-provider/Unpriced";
  writeFileSync(providerStdout, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "doubleword", model: unpricedModel, usage, content: [] } })}\n`);
  for (const event of providerEvents) if (event.model) event.model = unpricedModel;
  providerEvents[4] = { ...providerEvents[4], model: unpricedModel, usage };
  writeFileSync(providerObservability, providerEvents.map(JSON.stringify).join("\n") + "\n");
  const unpricedProvider = workerMeasurement({ stdoutPath: providerStdout, observabilityPath: providerObservability, tier: "tier1", workerDurationMs: 8, firstOutputMs: 2, expectedProvider: "doubleword", expectedModel: unpricedModel });
  assert(unpricedProvider.status === "partial" && deriveAttemptMetricTotals(unpricedProvider).costUsd === null && deriveAttemptMetricTotals(unpricedProvider).observedCostUsd === 0, "unpriced Doubleword measurements were promoted to trusted cost");
  writeFileSync(providerStdout, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "doubleword", model: "deepseek-ai/DeepSeek-V4-Flash-0731", usage, content: [] } })}\n`);
  for (const event of providerEvents) if (event.model) event.model = "deepseek-ai/DeepSeek-V4-Flash-0731";
  providerEvents[4] = { ...providerEvents[4], model: "deepseek-ai/DeepSeek-V4-Flash-0731", usage, usageInputField: "prompt_tokens", usageOutputField: "completion_tokens" };
  writeFileSync(providerObservability, providerEvents.map(JSON.stringify).join("\n") + "\n");
  const compatibilityUsage = workerMeasurement({ stdoutPath: providerStdout, observabilityPath: providerObservability, tier: "tier1", workerDurationMs: 8, firstOutputMs: 2, expectedProvider: "doubleword", expectedModel: "deepseek-ai/DeepSeek-V4-Flash-0731" });
  assert(compatibilityUsage.status === "invalid" && compatibilityUsage.issues.some((issue) => issue.code === "provider-evidence-mismatch"), "compatibility usage aliases were admitted as native Doubleword usage");

  const summaryStdout = join(root, "summary-stdout.jsonl");
  writeFileSync(summaryStdout, [
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## Worker summary\n\n1. Superseded." }] } },
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "ignore" }] } },
    { type: "message_end", message: { role: "assistant", content: [
      { type: "thinking", thinking: "private" },
      { type: "text", text: "Preamble.\n\n## Worker summary\n\n1. Implemented." },
      { type: "toolCall", id: "tool-1" },
      { type: "text", text: "\n2. Preserved exact text." },
    ] } },
  ].map(JSON.stringify).join("\n") + "\n");
  assert(extractWorkerSummary(summaryStdout) === "1. Implemented.\n2. Preserved exact text.", "worker summary extraction did not use the final assistant text blocks exactly");
  writeFileSync(summaryStdout, `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## Worker summary   \n\n1. Non-exact heading." }] } })}\n`);
  assert(extractWorkerSummary(summaryStdout) === "1. Non-exact heading.", "harmless summary heading whitespace was rejected");
  writeFileSync(summaryStdout, [
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## Worker summary\nOld summary" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "No summary here" }] } },
  ].map(JSON.stringify).join("\n"));
  assert(extractWorkerSummary(summaryStdout) === undefined, "summary extraction searched an older message");
  testDiscoveredExtensionWithFixedProfile(root);
  console.log("worker pipeline smoke passed (A7, A19, A20)");
} finally {
  rmSync(root, { recursive: true, force: true });
}

async function testWorkerValidation(root, worktree) {
  const attemptDir = join(root, "attempt");
  mkdirSync(attemptDir);
  const command = { executable: process.execPath, args: ["-e", "const fs=require('node:fs'); if(fs.readFileSync('src/value.txt','utf8')!=='after\\n'){console.error('expected after');process.exit(7)}"] };
  const identity = publishWorkerValidationManifest(attemptDir, {
    runId: "run-1",
    nodeId: "node-1",
    attemptId: "node-1:000001",
    worktreeRoot: worktree,
    platform: process.platform,
    commands: [command],
    timeoutMs: 5_000,
  });
  const env = {
    FANOUT_RUN_ID: "run-1",
    FANOUT_NODE_ID: "node-1",
    FANOUT_ATTEMPT_ID: "node-1:000001",
    FANOUT_WORKER_DIR: attemptDir,
    FANOUT_WORKTREE_ROOT: worktree,
    FANOUT_VALIDATION_MANIFEST: JSON.stringify(identity),
  };
  const context = loadWorkerValidationContext(env, worktree);
  assert(context, "verified worker validation context was not loaded");
  const lone = [{ role: "assistant", content: [{ type: "toolCall", id: "validate-1", name: FANOUT_VALIDATE_TOOL }] }];
  const mixed = [{ role: "assistant", content: [{ type: "toolCall", id: "validate-1", name: FANOUT_VALIDATE_TOOL }, { type: "toolCall", id: "read-1", name: "read" }] }];
  assert(workerValidationBatchBlockReason(FANOUT_VALIDATE_TOOL, "validate-1", lone, true) === undefined, "lone worker validation was blocked");
  assert(workerValidationBatchBlockReason(FANOUT_VALIDATE_TOOL, "validate-1", mixed, true)?.includes("only tool call"), "mixed worker validation batch was admitted");
  assert(workerValidationBatchBlockReason(FANOUT_VALIDATE_TOOL, "missing", [], true)?.includes("only tool call"), "ambiguous worker validation batch evidence was admitted");

  let registered;
  registerWorkerValidationTool({ registerTool(tool) { registered = tool; }, on() {} }, context);
  assert(registered?.parameters?.additionalProperties === false && Object.keys(registered.parameters.properties).length === 0, "fanout_validate accepted model-supplied command parameters");
  const arbitraryMarker = join(root, "arbitrary-command-ran");
  const failed = await registered.execute("validate-1", { command: `${process.execPath} -e require('node:fs').writeFileSync('${arbitraryMarker}','bad')` }, undefined, undefined, { cwd: worktree });
  assert(!existsSync(arbitraryMarker), "fanout_validate executed a model-supplied arbitrary command");
  assert(failed.isError === true && failed.content[0].text.includes("expected after") && failed.details.result.status === "failed", "worker did not receive same-call validation failure feedback");
  writeFileSync(join(worktree, "src", "value.txt"), "after\n");
  const passed = await runWorkerValidation(context, "validate-2", undefined, worktree);
  assert(passed.isError === undefined && passed.details.result.status === "passed", "worker validation did not pass after repair");
  const evidence = readdirSync(join(attemptDir, "worker-validation")).sort();
  assert(evidence.length === 2 && evidence.every((name) => JSON.parse(readFileSync(join(attemptDir, "worker-validation", name), "utf8")).manifest.sha256 === identity.sha256), "worker validation evidence was not recorded against the immutable manifest");

  const bulkCommands = [
    { executable: process.execPath, args: ["-e", "process.stdout.write('PASSED_HEAD_' + 'p'.repeat(20_000) + '_PASSED_TAIL')"] },
    { executable: process.execPath, args: ["-e", "process.stdout.write('FAILED_STDOUT_HEAD_' + 'o'.repeat(12_000) + '_FAILED_STDOUT_TAIL'); process.stderr.write('FAILED_STDERR_HEAD_' + 'e'.repeat(12_000) + '_FAILED_STDERR_TAIL'); process.exit(7)"] },
  ];
  const bulkIdentity = publishWorkerValidationManifest(attemptDir, {
    runId: "run-1",
    nodeId: "node-1",
    attemptId: "node-1:000001",
    worktreeRoot: worktree,
    platform: process.platform,
    commands: bulkCommands,
    timeoutMs: 5_000,
  });
  const bulkContext = loadWorkerValidationContext({ ...env, FANOUT_VALIDATION_MANIFEST: JSON.stringify(bulkIdentity) }, worktree);
  const bulk = await runWorkerValidation(bulkContext, "validate-bulk", undefined, worktree);
  const bulkText = bulk.content[0].text;
  assert(bulk.isError === true && bulkText.includes("[0] passed") && !bulkText.includes("PASSED_HEAD_") && !bulkText.includes("_PASSED_TAIL"), "passed worker validation output remained model-visible");
  assert(bulkText.length < 9_000 && bulkText.includes("fanout_validate output truncated") && bulkText.includes("FAILED_STDOUT_HEAD_") && bulkText.includes("_FAILED_STDERR_TAIL"), "failed worker validation output was not bounded with useful head/tail diagnostics");
  assert(bulk.details.result.commands[0].stdout.includes("_PASSED_TAIL") && bulk.details.result.commands[1].stdout.includes("_FAILED_STDOUT_TAIL") && bulk.details.result.commands[1].stderr.includes("_FAILED_STDERR_TAIL"), "bounded model output truncated authoritative validation details");
  const bulkEvidence = JSON.parse(readFileSync(join(attemptDir, bulk.details.evidence.path), "utf8"));
  assert(bulkEvidence.result.commands[0].stdout.includes("_PASSED_TAIL") && bulkEvidence.result.commands[1].stderr.includes("_FAILED_STDERR_TAIL"), "bounded model output truncated stored validation evidence");

  writeFileSync(join(attemptDir, identity.path), "{}\n");
  let tamperRejected = false;
  try { loadWorkerValidationContext(env, worktree); } catch (error) { tamperRejected = /digest|length|artifact/i.test(String(error)); }
  assert(tamperRejected, "tampered worker validation manifest was admitted");
}

function testDiscoveredExtensionWithFixedProfile(root) {
  const repo = join(root, "discovery-repo");
  const marker = join(root, "discovered-tools.json");
  const attemptDir = join(root, "discovery-attempt");
  mkdirSync(join(repo, ".pi", "extensions"), { recursive: true });
  mkdirSync(attemptDir);
  const manifest = publishWorkerValidationManifest(attemptDir, { runId: "discovery", nodeId: "node", attemptId: "node:000001", worktreeRoot: repo, platform: process.platform, commands: [], timeoutMs: 5_000 });
  writeFileSync(join(repo, ".pi", "extensions", "discovered.ts"), `import { writeFileSync } from "node:fs";\nexport default function discovered(pi) {\n  pi.registerTool({ name: "discovered_tool", label: "Discovered", description: "Must remain unavailable", parameters: { type: "object", properties: {} }, async execute() { return { content: [{ type: "text", text: "unexpected" }] }; } });\n  pi.on("session_start", () => writeFileSync(${JSON.stringify(marker)}, JSON.stringify(pi.getActiveTools())));\n}\n`);
  const sessionDir = join(root, "sessions");
  const result = spawnSync("pi", [
    "--approve",
    "--no-context-files",
    "--tools", WORKER_MODEL_TOOLS.join(","),
    "-e", resolve("packages/fanout-pi/src/index.ts"),
    "--model", "doubleword-stub/deepseek-v4-flash",
    "--mode", "json",
    "--session-dir", sessionDir,
    "-p", "Reply briefly without tools.",
  ], {
    cwd: repo,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      PI_OFFLINE: "1",
      PI_CODING_AGENT_DIR: join(root, "pi-home"),
      DOUBLEWORD_MODEL_CACHE_FILE: join(root, "models.json"),
      FANOUT_RUN_ID: "discovery",
      FANOUT_NODE_ID: "node",
      FANOUT_ATTEMPT_ID: "node:000001",
      FANOUT_WORKER_DIR: attemptDir,
      FANOUT_WORKTREE_ROOT: repo,
      FANOUT_VALIDATION_MANIFEST: JSON.stringify(manifest),
    },
  });
  assert(result.status === 0, `A19 real Pi worker failed: ${result.stderr || result.stdout}`);
  assert(!result.stderr.includes("Extension error"), `normal worker shutdown crashed the Fanout extension: ${result.stderr}`);
  assert(existsSync(marker), "A19 project extension was not automatically discovered");
  const active = JSON.parse(readFileSync(marker, "utf8"));
  assert(active.join(",") === WORKER_MODEL_TOOLS.join(","), `A19 discovered extension widened active tools: ${active.join(",")}`);
  assert(result.stdout.includes("doubleword-stub"), "A19 registered provider did not serve the worker model");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testNormalizedWorkerValidation(root, worktree) {
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
  modelRuntime.registerProvider("fanout-test", { baseUrl: "http://localhost.invalid", apiKey: "test-only", api: "openai-completions", models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }] });
  const model = modelRuntime.getModel("fanout-test", "scripted");
  for (const mode of ["pass", "program", "tamper", "publication", "empty"]) {
    const attemptRoot = join(root, `sdk-${mode}`);
    mkdirSync(attemptRoot);
    const identity = publishWorkerValidationManifest(attemptRoot, { runId: "sdk", nodeId: "node", attemptId: "node:000001", worktreeRoot: worktree, platform: process.platform, commands: mode === "empty" ? [] : [{ executable: process.execPath, args: ["-e", mode === "program" ? "console.error('program failed');process.exit(7)" : "process.exit(0)"] }], timeoutMs: 5000 });
    const context = loadWorkerValidationContext({ FANOUT_RUN_ID: "sdk", FANOUT_NODE_ID: "node", FANOUT_ATTEMPT_ID: "node:000001", FANOUT_WORKER_DIR: attemptRoot, FANOUT_WORKTREE_ROOT: worktree, FANOUT_VALIDATION_MANIFEST: JSON.stringify(identity) }, worktree);
    if (mode === "tamper") writeFileSync(join(attemptRoot, identity.path), "{}\n");
    if (mode === "publication") writeFileSync(join(attemptRoot, "worker-validation"), "blocked");
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const agentDir = join(root, `sdk-agent-${mode}`);
    const loader = new DefaultResourceLoader({ cwd: worktree, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [(pi) => registerWorkerValidationTool(pi, context)] });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: worktree, agentDir, modelRuntime, model, settingsManager, sessionManager: SessionManager.inMemory(worktree), resourceLoader: loader, tools: [FANOUT_VALIDATE_TOOL] });
    const completed = [];
    session.subscribe((event) => { if (event.type === "tool_execution_end") completed.push(event); });
    let calls = 0;
    session.agent.streamFunction = (selected) => {
      const toolCall = calls++ === 0;
      const message = { role: "assistant", api: selected.api, provider: selected.provider, model: selected.id, content: toolCall ? [{ type: "toolCall", id: `validate-${mode}`, name: FANOUT_VALIDATE_TOOL, arguments: {} }] : [{ type: "text", text: "Done" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: toolCall ? "toolUse" : "stop", timestamp: Date.now() };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: message.stopReason, message });
      return stream;
    };
    try {
      await session.prompt("Run the bound validation once.");
      const result = session.agent.state.messages.find((message) => message.role === "toolResult");
      const failed = !["pass", "empty"].includes(mode);
      assert(result && result.isError === failed && completed.length === 1 && completed[0].isError === failed, `real Pi normalized ${mode} validation incorrectly`);
      assert(result.content[0].text.includes(mode === "program" ? "program failed" : mode === "empty" ? "No focused validation commands" : "fanout_validate"), `Pi lost ${mode} validation diagnostics`);
      assert(mode === "tamper" ? result.details.error : result.details.result, `Pi lost ${mode} structured evidence`);
      if (mode !== "publication") assert(result.details.evidence && existsSync(join(attemptRoot, result.details.evidence.path)), `Pi lost ${mode} persisted evidence identity`);
    } finally { session.dispose(); }
  }
}

function workerMeasurement(options) {
  const assignment = { provider: options.expectedProvider, model: options.expectedModel, tier: options.tier };
  return correlatedWorkerMetrics({ allocation: { runId: "measurement", nodeId: "node", attemptId: "node:000001", attemptNumber: 1, kind: "original", assignment, budgetTransition: { name: "original", before: 0, after: 1, limit: 1 } }, providerRunId: "measurement", stdoutPath: options.stdoutPath, observabilityPath: options.observabilityPath, workerDurationMs: options.workerDurationMs, workerFirstOutputMs: options.firstOutputMs });
}
