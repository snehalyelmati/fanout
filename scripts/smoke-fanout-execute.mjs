import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactIdentity } from "../packages/fanout-core/src/artifact-identity.ts";
import { compileExecutionPacket } from "../packages/fanout-core/src/fanout-compiler.ts";
import { runDag } from "../packages/fanout-core/src/dag-scheduler.ts";
import { executionPacketBytes } from "../packages/fanout-core/src/execution-packet.ts";
import { executeFanout } from "../packages/fanout-pi/src/fanout-execute.ts";
import { artifactSegment } from "../packages/fanout-pi/src/fanout-git.ts";
import { replayExecutionArtifacts } from "../packages/fanout-pi/src/execution-event-store.ts";
import { FanoutNodeExecutor } from "../packages/fanout-pi/src/fanout-node-executor.ts";
import { publishExecutionPacket } from "../packages/fanout-pi/src/planning-publication.ts";
import { capturePlanningBase, fullGitVisibleTree } from "../packages/fanout-pi/src/repository-identity.ts";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const root = mkdtempSync(join(tmpdir(), "fanout-v6-execute-"));
try {
  const repo = join(root, "repo"); const artifacts = join(root, "artifacts"); const runDir = join(artifacts, "plan");
  mkdirSync(repo); mkdirSync(runDir, { recursive: true });
  git(repo, ["init", "-q"]); git(repo, ["config", "user.email", "fanout@example.invalid"]); git(repo, ["config", "user.name", "Fanout Test"]);
  writeFileSync(join(repo, ".gitignore"), ".preinstalled\n");
  writeFileSync(join(repo, "README.md"), "# Fixture\n"); git(repo, ["add", ".gitignore", "README.md"]); git(repo, ["commit", "-qm", "fixture"]);
  mkdirSync(join(repo, ".preinstalled"));
  writeFileSync(join(repo, ".preinstalled", "ready"), "ready\n");
  const base = capturePlanningBase(repo);
  const plan = { schema: "fanout.implementation-plan", version: 2, planId: "p", createdAt: new Date(0).toISOString(), planningHost: { platform: process.platform }, planningBase: base, objective: "Add x", userContext: [], discoveredRepoFacts: [], assumptions: [], implementationItems: [{ id: "x", goals: ["Add x"], writeResources: [{ kind: "file", path: "x.ts" }], readResources: [], forbiddenWrites: [], semanticReviewCriteria: ["x exists"], advisoryNotes: [] }] };
  const planIdentity = artifactIdentity("implementation-plan.json", Buffer.from(JSON.stringify(plan)));
  const command = { executable: process.execPath, args: ["-e", "if (require('node:fs').readFileSync('x.ts','utf8') !== 'export const x = 1;\\n') process.exit(1)"] };
  const details = { schema: "fanout.implementation-details", version: 4, detailsId: "p", createdAt: new Date(0).toISOString(), plan: planIdentity, candidateNormalizationCommands: [], items: [{ id: "x", kind: "implement", changes: [{ kind: "create", target: { resource: { kind: "file", path: "x.ts" }, sourcePlanIds: ["x"] }, contentIntent: "x" }], readDependencies: [], forbiddenWrites: [], validationCommands: [command], advisoryNotes: [] }], finalValidationCommands: [command] };
  const detailsIdentity = artifactIdentity("implementation-details.json", Buffer.from(JSON.stringify(details)));
  const summary = { provider: "doubleword-stub", model: "deepseek-v4-flash", thinking: "off", source: "test", status: "available", reason: "test" };
  const compiled = compileExecutionPacket({ implementationPlan: plan, implementationDetails: details, planIdentity, detailsIdentity, tierPlan: { tier1: summary, tier2: { ...summary, status: "unavailable", fallback: "tier1" }, tier2Fallback: summary }, runtimePolicy: { maxConcurrency: 2, failFast: false, fallbackAllowed: true }, createdAt: new Date(0).toISOString() });
  assert(compiled.packet, compiled.errors.join("; "));
  const paths = publishExecutionPacket(compiled.packet, artifacts, runDir, join(artifacts, "active-packet.json"));
  const packetIdentity = JSON.parse(readFileSync(paths.activePointerPath, "utf8")).packet;
  let traversalRejected = false;
  try { await executeFanout({ cwd: repo, activePointerPath: paths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", dryRun: true, runId: "../../escape" }); }
  catch (error) { traversalRejected = /canonical path segment/.test(String(error)); }
  assert(traversalRejected && !existsSync(join(artifacts, "escape")) && !existsSync(join(repo, ".git", "fanout-execution.lock")), "path-traversing run identity escaped execution storage or acquired the repository lock");
  const result = await executeFanout({ cwd: repo, activePointerPath: paths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", dryRun: true, runId: "dry-run", maxConcurrency: 99 });
  assert(result.status === "succeeded" && result.snapshot.version === 4 && result.snapshot.mode === "dry-run" && result.snapshot.terminalOutcome.outcome === "dry-run-completed", "hardened dry run did not project explicit state");
  assert(result.snapshot.policy.maxConcurrency === 2, "execution options overrode immutable packet runtime policy");
  assert(result.snapshot.preflightEvidence.planningCommit.actual === base.headCommit && result.snapshot.preflightEvidence.repositoryTree.actual === base.tree && result.snapshot.preflightEvidence.platform.actual === process.platform, "dry run did not preserve exact repository/platform preflight evidence");
  assert(result.snapshot.preflightEvidence.worker.launcher.resolvedExecutable && result.snapshot.preflightEvidence.worker.extension.resolved && result.snapshot.preflightEvidence.worker.modelCallableTools.join(",") === "read,grep,find,ls,edit,write", "dry run did not preserve worker capability evidence");
  assert(result.snapshot.preflightEvidence.validationCommands.some((entry) => entry.nodeId === "x" && entry.manifest.args.join("\0") === command.args.join("\0") && entry.resolution.status === "available"), "dry run did not preserve resolved validation argv evidence");
  const events = readFileSync(result.paths.eventsPath, "utf8").trim().split("\n").map(JSON.parse);
  assert(events.map((event) => event.sequence).join(",") === "1,2,3" && events.every((event) => event.version === 3), "events are not gapless v3 authority");
  assert(!existsSync(join(repo, ".git", "fanout-execution.lock")), "dry run leaked execution lock");
  const directoryExtension = await executeFanout({ cwd: repo, activePointerPath: paths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: repo, dryRun: true, runId: "directory-extension" });
  assert(directoryExtension.status === "failed" && directoryExtension.snapshot.preflightEvidence.worker.extension.status === "unavailable" && directoryExtension.snapshot.preflight.issues.some((issue) => issue.detail.includes("extension entry")), "preflight admitted a directory as an executable Pi extension entry");

  const lockPath = join(repo, ".git", "fanout-execution.lock");
  writeFileSync(lockPath, `${JSON.stringify({ runId: "other", pid: process.pid })}\n`);
  let lockRejected = false;
  try { await executeFanout({ cwd: repo, activePointerPath: paths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", dryRun: true, runId: "lock-contender" }); }
  catch (error) { lockRejected = /already locked/.test(String(error)); }
  finally { rmSync(lockPath, { force: true }); }
  assert(lockRejected && !existsSync(join(runDir, "executions", "lock-contender")), "lock contention created execution artifacts without execution authority");

  writeFileSync(join(repo, "uncommitted-planning-input.txt"), "not reconstructable from HEAD\n");
  const dirtyBase = capturePlanningBase(repo);
  const dirtyPlan = { ...plan, planningBase: dirtyBase };
  const dirtyPlanIdentity = artifactIdentity("implementation-plan.json", Buffer.from(JSON.stringify(dirtyPlan)));
  const dirtyDetails = { ...details, plan: dirtyPlanIdentity };
  const dirtyDetailsIdentity = artifactIdentity("implementation-details.json", Buffer.from(JSON.stringify(dirtyDetails)));
  const dirtyCompiled = compileExecutionPacket({ implementationPlan: dirtyPlan, implementationDetails: dirtyDetails, planIdentity: dirtyPlanIdentity, detailsIdentity: dirtyDetailsIdentity, tierPlan: { tier1: summary, tier2: { ...summary, status: "unavailable", fallback: "tier1" }, tier2Fallback: summary }, runtimePolicy: { maxConcurrency: 2, failFast: false, fallbackAllowed: true }, createdAt: new Date(0).toISOString() });
  assert(dirtyCompiled.packet, dirtyCompiled.errors.join("; "));
  const dirtyRunDir = join(artifacts, "dirty-plan");
  const dirtyPaths = publishExecutionPacket(dirtyCompiled.packet, artifacts, dirtyRunDir, join(artifacts, "dirty-active-packet.json"));
  let dirtyConfirmed = false;
  const dirtyResult = await executeFanout({ cwd: repo, activePointerPath: dirtyPaths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", piCommand: process.execPath, runId: "dirty-base", confirm: () => { dirtyConfirmed = true; return true; } });
  assert(dirtyResult.status === "failed" && !dirtyConfirmed && dirtyResult.snapshot.totals.attempts === 0 && dirtyResult.snapshot.preflight.issues.some((issue) => issue.code === "planning-base-mismatch" && issue.detail.includes("non-HEAD content")), "non-reconstructable planning base passed preflight or reached confirmation/worker allocation");
  rmSync(join(repo, "uncommitted-planning-input.txt"));

  const fakePi = join(root, "fake-pi.mjs");
  writeFileSync(fakePi, `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
if (process.argv.includes("--version")) { console.log("fake-pi 1.0.0"); process.exit(0); }
const args = process.argv.slice(2);
const [provider, ...modelParts] = args[args.indexOf("--model") + 1].split("/");
const model = modelParts.join("/");
const usage = { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { total: 0.001 } };
if (process.env.FANOUT_RUN_ID === "live" && readFileSync(".preinstalled/ready", "utf8") !== "ready\\n") process.exit(9);
if (process.env.FANOUT_RUN_ID === "provider-abort") {
  appendFileSync(process.env.FANOUT_OBSERVABILITY_FILE, JSON.stringify({ event: "provider_error", runId: process.env.DOUBLEWORD_RUN_ID, provider, model, turnIndex: 0, responseId: "response-1", failureCode: "abort" }) + "\\n");
  process.exit(1);
}
if (!['post-worker-abort', 'repair-overlay', 'normalized-candidate', 'unauthorized-normalization', 'interrupted-normalization', 'identity-normalization', 'diagnostic-normalization', 'normalization-boundary-abort', 'normalization-boundary-abort-rewrite-failure', 'final-normalization', 'final-normalization-widened'].includes(process.env.FANOUT_RUN_ID) && process.env.FANOUT_WORKER_DIR.endsWith("001-original")) {
  appendFileSync(process.env.FANOUT_OBSERVABILITY_FILE, JSON.stringify({ event: "provider_error", runId: process.env.DOUBLEWORD_RUN_ID, provider, model, turnIndex: 0, responseId: "response-1", failureCode: "rate-limit", httpStatus: 429 }) + "\\n");
  process.exit(1);
}
writeFileSync(process.env.FANOUT_NODE_ID === "y" ? "y.ts" : "x.ts", process.env.FANOUT_WORKER_DIR.endsWith("validation-repair") ? "export const x = 1;\\n" : "export const x = 0;\\n");
const observedAt = new Date().toISOString();
appendFileSync(process.env.FANOUT_OBSERVABILITY_FILE, [
  { ts: observedAt, event: "turn_start", turnIndex: 0 },
  { ts: observedAt, event: "provider_start", provider, model, turnIndex: 0 },
  { ts: observedAt, event: "provider_ttft", provider, model, turnIndex: 0, responseId: "response-1", ttftMs: 0 },
  { ts: observedAt, event: "assistant_ttft", turnIndex: 0 },
  { ts: observedAt, event: "provider_end", provider, model, turnIndex: 0, responseId: "response-1", tier: "realtime", usage, usageSource: "provider", pricingSource: "doubleword-model-metadata", pollCount: 0 },
  { ts: observedAt, event: "turn_end", turnIndex: 0 },
].map(JSON.stringify).join("\\n") + "\\n");
console.log(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", provider, model, usage } }));
`, "utf8");
  chmodSync(fakePi, 0o755);

  const normalizedNode = structuredClone(compiled.packet.nodes[0]);
  normalizedNode.workContract.candidateNormalizationCommands = [
    { executable: process.execPath, args: ["-e", "require('node:fs').writeFileSync('x.ts', 'export const x = 1;\\n'); process.exit(7)"] },
    { executable: process.execPath, args: ["-e", "require('node:fs').writeFileSync('x.ts', 'export const x = 2;\\n')"] },
  ];
  normalizedNode.workContract.validationCommands = [{ executable: process.execPath, args: ["-e", "if (require('node:fs').readFileSync('x.ts', 'utf8') !== 'export const x = 2;\\n') process.exit(1)"] }];
  const normalizedFinal = structuredClone(compiled.packet.nodes.at(-1));
  normalizedFinal.workContract.candidateNormalizationCommands = structuredClone(normalizedNode.workContract.candidateNormalizationCommands);
  const normalizedPacket = { ...compiled.packet, nodes: [normalizedNode, normalizedFinal] };
  const normalizedRunDir = join(runDir, "executions", "normalized-candidate");
  const normalizedCompletions = [];
  const normalizedExecutor = new FanoutNodeExecutor({
    packet: normalizedPacket,
    packetIdentity: artifactIdentity(packetIdentity.path, executionPacketBytes(normalizedPacket)),
    repoRoot: repo,
    runDir: normalizedRunDir,
    runId: "normalized-candidate",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    recorder: { async recordAttemptAllocated() {}, async recordAttemptCompleted(outcome, acceptedTransition) { normalizedCompletions.push({ outcome, acceptedTransition }); }, async flush() {} },
  });
  let normalizedResult;
  try { normalizedResult = await normalizedExecutor.runNode(normalizedNode); }
  finally { normalizedExecutor.cleanupWorktrees(); }
  const normalizedAudit = JSON.parse(readFileSync(join(normalizedRunDir, "workers", artifactSegment("x"), "attempts", "001-original", "candidate-normalization.json"), "utf8"));
  assert(normalizedResult.ok && readFileSync(join(repo, "x.ts"), "utf8") === "export const x = 2;\n", "post-normalization bytes were not captured, validated, and applied");
  assert(normalizedAudit.schema === "fanout.candidate-normalization-evidence" && normalizedAudit.version === 1 && normalizedAudit.status === "completed" && normalizedAudit.before.indexMatchesHead && normalizedAudit.after.indexMatchesHead && normalizedAudit.commands.map((entry) => entry.outcome).join(",") === "nonzero,passed", "normalization did not write typed v1 evidence or continue nonzero exactly once");
  assert(normalizedCompletions.length === 1 && normalizedCompletions[0].outcome.evidenceRefs.some((reference) => reference.endsWith("candidate-normalization.json")) && normalizedCompletions[0].acceptedTransition, "accepted normalized attempt omitted its audit evidence or transition");
  rmSync(join(repo, "x.ts"));
  assert(fullGitVisibleTree(repo) === base.tree, "normalized candidate fixture did not restore the planning tree");

  const normalizationPlanDir = join(artifacts, "normalization-confirm-plan");
  const normalizationPaths = publishExecutionPacket(normalizedPacket, artifacts, normalizationPlanDir, join(artifacts, "normalization-confirm-active.json"));
  let normalizationConfirmation = "";
  const normalizationDeclined = await executeFanout({ cwd: repo, activePointerPath: normalizationPaths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", confirm: (_title, message) => { normalizationConfirmation = message; return false; }, piCommand: fakePi, runId: "normalization-confirm" });
  assert(normalizationDeclined.status === "aborted" && normalizationConfirmation.includes(JSON.stringify(normalizedNode.workContract.candidateNormalizationCommands[0])) && normalizationConfirmation.includes(JSON.stringify(normalizedNode.workContract.candidateNormalizationCommands[1])), "live confirmation omitted packet-declared candidate normalization manifests");

  const unavailablePacket = structuredClone(compiled.packet);
  for (const node of unavailablePacket.nodes) node.workContract.candidateNormalizationCommands = [{ executable: "fanout-missing-normalizer", args: [] }];
  const unavailablePlanDir = join(artifacts, "normalization-preflight-plan");
  const unavailablePaths = publishExecutionPacket(unavailablePacket, artifacts, unavailablePlanDir, join(artifacts, "normalization-preflight-active.json"));
  const unavailableResult = await executeFanout({ cwd: repo, activePointerPath: unavailablePaths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", dryRun: true, piCommand: fakePi, runId: "normalization-preflight" });
  assert(unavailableResult.status === "failed" && unavailableResult.snapshot.preflight.issues.some((issue) => issue.code === "executable-unavailable" && issue.detail.includes("candidate normalization")), "preflight did not expose an unavailable candidate normalizer");
  assert(unavailableResult.snapshot.preflightEvidence.candidateNormalizationCommands.every((entry) => entry.resolution.status === "unavailable" && entry.resolution.resolvedExecutable === null), "failed normalizer resolution was not preserved as closed preflight evidence");

  const unauthorizedNode = structuredClone(compiled.packet.nodes[0]);
  unauthorizedNode.workContract.candidateNormalizationCommands = [{ executable: process.execPath, args: ["-e", "const fs = require('node:fs'); fs.writeFileSync('x.ts', 'export const x = 1;\\n'); fs.writeFileSync('outside.ts', 'outside\\n')"] }];
  const unauthorizedFinal = structuredClone(compiled.packet.nodes.at(-1));
  unauthorizedFinal.workContract.candidateNormalizationCommands = structuredClone(unauthorizedNode.workContract.candidateNormalizationCommands);
  const unauthorizedPacket = { ...compiled.packet, nodes: [unauthorizedNode, unauthorizedFinal] };
  const unauthorizedRunDir = join(runDir, "executions", "unauthorized-normalization");
  const unauthorizedCompletions = [];
  const unauthorizedExecutor = new FanoutNodeExecutor({
    packet: unauthorizedPacket,
    packetIdentity: artifactIdentity(packetIdentity.path, executionPacketBytes(unauthorizedPacket)),
    repoRoot: repo,
    runDir: unauthorizedRunDir,
    runId: "unauthorized-normalization",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    recorder: { async recordAttemptAllocated() {}, async recordAttemptCompleted(outcome) { unauthorizedCompletions.push(outcome); }, async flush() {} },
  });
  let unauthorizedResult;
  try { unauthorizedResult = await unauthorizedExecutor.runNode(unauthorizedNode); }
  finally { unauthorizedExecutor.cleanupWorktrees(); }
  assert(!unauthorizedResult.ok && unauthorizedCompletions.length === 1 && unauthorizedCompletions[0].terminalFact.stage === "worker-gate" && unauthorizedCompletions[0].terminalFact.code === "unauthorized-change", "normalizer edits bypassed typed write ownership");
  assert(!existsSync(join(repo, "x.ts")) && !existsSync(join(repo, "outside.ts")), "unauthorized normalized candidate reached the active checkout");

  const interruptedNode = structuredClone(compiled.packet.nodes[0]);
  interruptedNode.workContract.candidateNormalizationCommands = [{ executable: process.execPath, args: ["-e", "require('node:fs').writeFileSync('x.ts', 'partial\\n'); setInterval(() => {}, 1000)"] }];
  const interruptedFinal = structuredClone(compiled.packet.nodes.at(-1));
  interruptedFinal.workContract.candidateNormalizationCommands = structuredClone(interruptedNode.workContract.candidateNormalizationCommands);
  const interruptedPacket = { ...compiled.packet, nodes: [interruptedNode, interruptedFinal] };
  const interruptedRunDir = join(runDir, "executions", "interrupted-normalization");
  const interruptedAllocations = [];
  const interruptedCompletions = [];
  const interruptedExecutor = new FanoutNodeExecutor({
    packet: interruptedPacket,
    packetIdentity: artifactIdentity(packetIdentity.path, executionPacketBytes(interruptedPacket)),
    repoRoot: repo,
    runDir: interruptedRunDir,
    runId: "interrupted-normalization",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    validationTimeoutMs: 40,
    recorder: { async recordAttemptAllocated(allocation) { interruptedAllocations.push(allocation); }, async recordAttemptCompleted(outcome) { interruptedCompletions.push(outcome); }, async flush() {} },
  });
  let interruptedResult;
  try { interruptedResult = await interruptedExecutor.runNode(interruptedNode); }
  finally { interruptedExecutor.cleanupWorktrees(); }
  const interruptedAttemptDir = join(interruptedRunDir, "workers", artifactSegment("x"), "attempts", "001-original");
  assert(!interruptedResult.ok && interruptedAllocations.length === 1 && interruptedCompletions.length === 1 && interruptedCompletions[0].terminalFact.stage === "candidate-normalization" && interruptedCompletions[0].terminalFact.code === "timeout", "hard normalization interruption retried a model or lost its typed fact");
  assert(existsSync(join(interruptedAttemptDir, "candidate-normalization.json")) && !existsSync(join(interruptedAttemptDir, "patch.bin")) && !existsSync(join(repo, "x.ts")), "partially normalized hard failure was captured or applied");

  const diagnosticRunDir = join(runDir, "executions", "diagnostic-normalization");
  const diagnosticAttemptDir = join(diagnosticRunDir, "workers", artifactSegment("x"), "attempts", "001-original");
  const diagnosticNode = structuredClone(compiled.packet.nodes[0]);
  diagnosticNode.workContract.candidateNormalizationCommands = [{ executable: process.execPath, args: ["-e", `const fs = require('node:fs'); fs.mkdirSync(${JSON.stringify(join(diagnosticAttemptDir, "result.json"))}, { recursive: true }); fs.rmSync(${JSON.stringify(join(diagnosticAttemptDir, "observability.jsonl"))}); fs.mkdirSync(${JSON.stringify(join(diagnosticAttemptDir, "observability.jsonl"))}); setInterval(() => {}, 1000)`] }];
  const diagnosticFinal = structuredClone(compiled.packet.nodes.at(-1));
  diagnosticFinal.workContract.candidateNormalizationCommands = structuredClone(diagnosticNode.workContract.candidateNormalizationCommands);
  const diagnosticPacket = { ...compiled.packet, nodes: [diagnosticNode, diagnosticFinal] };
  const diagnosticAllocations = [];
  const diagnosticCompletions = [];
  const diagnosticExecutor = new FanoutNodeExecutor({
    packet: diagnosticPacket,
    packetIdentity: artifactIdentity(packetIdentity.path, executionPacketBytes(diagnosticPacket)),
    repoRoot: repo,
    runDir: diagnosticRunDir,
    runId: "diagnostic-normalization",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    validationTimeoutMs: 40,
    recorder: { async recordAttemptAllocated(allocation) { diagnosticAllocations.push(allocation); }, async recordAttemptCompleted(outcome) { diagnosticCompletions.push(outcome); }, async flush() {} },
  });
  let diagnosticResult;
  try { diagnosticResult = await diagnosticExecutor.runNode(diagnosticNode); }
  finally { diagnosticExecutor.cleanupWorktrees(); }
  assert(!diagnosticResult.ok && diagnosticAllocations.length === 1 && diagnosticCompletions.length === 1 && diagnosticCompletions[0].terminalFact.stage === "candidate-normalization" && diagnosticCompletions[0].terminalFact.code === "timeout" && diagnosticCompletions[0].action === "fail", "result diagnostic failure escaped typed normalization routing or retried a model");
  assert(lstatSync(join(diagnosticAttemptDir, "result.json")).isDirectory() && lstatSync(join(diagnosticAttemptDir, "observability.jsonl")).isDirectory() && existsSync(join(diagnosticAttemptDir, "candidate-normalization.json")) && diagnosticCompletions[0].evidenceRefs.some((reference) => reference.endsWith("candidate-normalization.json")) && !diagnosticCompletions[0].evidenceRefs.some((reference) => reference.endsWith("result.json") || reference.endsWith("observability.jsonl")) && !existsSync(join(diagnosticAttemptDir, "patch.bin")) && !existsSync(join(repo, "x.ts")), "failed diagnostics lost the durable normalization audit, claimed a non-file artifact, or admitted a patch");

  const boundaryAbortRunDir = join(runDir, "executions", "normalization-boundary-abort");
  const boundaryAbortAttemptDir = join(boundaryAbortRunDir, "workers", artifactSegment("x"), "attempts", "001-original");
  const boundaryAbortAuditPath = join(boundaryAbortAttemptDir, "candidate-normalization.json");
  const boundaryAbortNode = structuredClone(compiled.packet.nodes[0]);
  boundaryAbortNode.workContract.candidateNormalizationCommands = [{ executable: process.execPath, args: ["-e", "process.exit(0)"] }];
  const boundaryAbortFinal = structuredClone(compiled.packet.nodes.at(-1));
  boundaryAbortFinal.workContract.candidateNormalizationCommands = structuredClone(boundaryAbortNode.workContract.candidateNormalizationCommands);
  const boundaryAbortPacket = { ...compiled.packet, nodes: [boundaryAbortNode, boundaryAbortFinal] };
  const boundaryAbortAllocations = [];
  const boundaryAbortCompletions = [];
  const boundaryAbortExecutor = new FanoutNodeExecutor({
    packet: boundaryAbortPacket,
    packetIdentity: artifactIdentity(packetIdentity.path, executionPacketBytes(boundaryAbortPacket)),
    repoRoot: repo,
    runDir: boundaryAbortRunDir,
    runId: "normalization-boundary-abort",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    recorder: { async recordAttemptAllocated(allocation) { boundaryAbortAllocations.push(allocation); }, async recordAttemptCompleted(outcome) { boundaryAbortCompletions.push(outcome); }, async flush() {} },
  });
  const boundaryAbortController = new AbortController();
  Object.defineProperty(boundaryAbortController.signal, "aborted", { configurable: true, get: () => existsSync(boundaryAbortAuditPath) });
  let boundaryAbortRejected = false;
  try { await boundaryAbortExecutor.runNode(boundaryAbortNode, boundaryAbortController.signal); }
  catch (error) { boundaryAbortRejected = error?.name === "AbortError"; }
  finally { boundaryAbortExecutor.cleanupWorktrees(); }
  const boundaryAbortAudit = JSON.parse(readFileSync(boundaryAbortAuditPath, "utf8"));
  assert(boundaryAbortRejected && boundaryAbortAllocations.length === 1 && boundaryAbortCompletions.length === 1 && boundaryAbortCompletions[0].terminalFact.stage === "candidate-normalization" && boundaryAbortCompletions[0].terminalFact.code === "user-abort" && boundaryAbortCompletions[0].action === "abort", "abort after normalization completion escaped the pre-capture typed boundary");
  assert(boundaryAbortAudit.status === "interrupted" && boundaryAbortAudit.failure.code === "user-abort" && boundaryAbortAudit.commands[0].outcome === "passed" && !existsSync(join(boundaryAbortAttemptDir, "patch.bin")) && !existsSync(join(repo, "x.ts")), "pre-capture abort audit was inconsistent or a patch reached capture/apply");

  const rewriteFailureRunDir = join(runDir, "executions", "normalization-boundary-abort-rewrite-failure");
  const rewriteFailureAttemptDir = join(rewriteFailureRunDir, "workers", artifactSegment("x"), "attempts", "001-original");
  const rewriteFailureAuditPath = join(rewriteFailureAttemptDir, "candidate-normalization.json");
  const rewriteFailureAllocations = [];
  const rewriteFailureCompletions = [];
  const rewriteFailureExecutor = new FanoutNodeExecutor({
    packet: boundaryAbortPacket,
    packetIdentity: artifactIdentity(packetIdentity.path, executionPacketBytes(boundaryAbortPacket)),
    repoRoot: repo,
    runDir: rewriteFailureRunDir,
    runId: "normalization-boundary-abort-rewrite-failure",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    beforeNormalizationAuditRewrite: () => { throw new Error("injected normalization audit rewrite failure"); },
    recorder: { async recordAttemptAllocated(allocation) { rewriteFailureAllocations.push(allocation); }, async recordAttemptCompleted(outcome) { rewriteFailureCompletions.push(outcome); }, async flush() {} },
  });
  const rewriteFailureController = new AbortController();
  Object.defineProperty(rewriteFailureController.signal, "aborted", { configurable: true, get: () => existsSync(rewriteFailureAuditPath) });
  let rewriteFailureRejected = false;
  try { await rewriteFailureExecutor.runNode(boundaryAbortNode, rewriteFailureController.signal); }
  catch (error) { rewriteFailureRejected = error?.name === "AbortError"; }
  finally { rewriteFailureExecutor.cleanupWorktrees(); }
  const staleRewriteAudit = JSON.parse(readFileSync(rewriteFailureAuditPath, "utf8"));
  assert(rewriteFailureRejected && rewriteFailureAllocations.length === 1 && rewriteFailureCompletions.length === 1 && rewriteFailureCompletions[0].terminalFact.stage === "candidate-normalization" && rewriteFailureCompletions[0].terminalFact.code === "user-abort" && rewriteFailureCompletions[0].action === "abort", "failed abort-audit rewrite changed user-abort routing or retried a model");
  assert(staleRewriteAudit.status === "completed" && !rewriteFailureCompletions[0].evidenceRefs.some((reference) => reference.endsWith("candidate-normalization.json")) && rewriteFailureCompletions[0].diagnostic.includes("audit update failed after user abort") && !existsSync(join(rewriteFailureAttemptDir, "patch.bin")) && !existsSync(join(repo, "x.ts")), "stale completed normalization audit was cited or abort residue reached capture/apply");

  const identityNode = structuredClone(compiled.packet.nodes[0]);
  identityNode.workContract.candidateNormalizationCommands = [{ executable: process.execPath, args: ["-e", "require('node:fs').unlinkSync('.git')"] }];
  const identityFinal = structuredClone(compiled.packet.nodes.at(-1));
  identityFinal.workContract.candidateNormalizationCommands = structuredClone(identityNode.workContract.candidateNormalizationCommands);
  const identityPacket = { ...compiled.packet, nodes: [identityNode, identityFinal] };
  const identityRunDir = join(runDir, "executions", "identity-normalization");
  const identityAllocations = [];
  const identityCompletions = [];
  const identityExecutor = new FanoutNodeExecutor({
    packet: identityPacket,
    packetIdentity: artifactIdentity(packetIdentity.path, executionPacketBytes(identityPacket)),
    repoRoot: repo,
    runDir: identityRunDir,
    runId: "identity-normalization",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    recorder: { async recordAttemptAllocated(allocation) { identityAllocations.push(allocation); }, async recordAttemptCompleted(outcome) { identityCompletions.push(outcome); }, async flush() {} },
  });
  let identityResult;
  try { identityResult = await identityExecutor.runNode(identityNode); }
  finally { identityExecutor.cleanupWorktrees(); }
  const identityAttemptDir = join(identityRunDir, "workers", artifactSegment("x"), "attempts", "001-original");
  const identityAudit = JSON.parse(readFileSync(join(identityAttemptDir, "candidate-normalization.json"), "utf8"));
  assert(!identityResult.ok && identityAllocations.length === 1 && identityCompletions.length === 1 && identityCompletions[0].terminalFact.stage === "candidate-normalization" && identityCompletions[0].terminalFact.code === "identity-failure" && identityCompletions[0].action === "fail", "post-normalization identity failure escaped into model retry routing");
  assert(identityAudit.before && !identityAudit.after && identityAudit.failure.code === "identity-failure" && !existsSync(join(identityAttemptDir, "patch.bin")) && !existsSync(join(repo, "x.ts")), "post-normalization identity failure lost honest audit evidence or captured residue");

  const finalNormalizer = { executable: process.execPath, args: ["-e", "const fs = require('node:fs'); if (fs.readFileSync('x.ts', 'utf8') === 'export const x = 1;\\n') fs.writeFileSync('x.ts', 'export const x = 2;\\n')"] };
  const finalNormalizationDetails = structuredClone(details);
  finalNormalizationDetails.detailsId = "final-normalization";
  finalNormalizationDetails.candidateNormalizationCommands = [finalNormalizer];
  finalNormalizationDetails.items[0].validationCommands = [{ executable: process.execPath, args: ["-e", "if (require('node:fs').readFileSync('x.ts', 'utf8') !== 'export const x = 0;\\n') process.exit(1)"] }];
  finalNormalizationDetails.finalValidationCommands = [{ executable: process.execPath, args: ["-e", "if (require('node:fs').readFileSync('x.ts', 'utf8') !== 'export const x = 2;\\n') process.exit(1)"] }];
  const finalNormalizationDetailsIdentity = artifactIdentity("implementation-details.json", Buffer.from(JSON.stringify(finalNormalizationDetails)));
  const finalNormalizationCompiled = compileExecutionPacket({ implementationPlan: plan, implementationDetails: finalNormalizationDetails, planIdentity, detailsIdentity: finalNormalizationDetailsIdentity, tierPlan: { tier1: summary, tier2: { ...summary, status: "unavailable", fallback: "tier1" }, tier2Fallback: summary }, runtimePolicy: { maxConcurrency: 2, failFast: false, fallbackAllowed: true }, createdAt: new Date(0).toISOString() });
  assert(finalNormalizationCompiled.packet, finalNormalizationCompiled.errors.join("; "));
  const finalNormalizationPlanDir = join(artifacts, "final-normalization-plan");
  const finalNormalizationPaths = publishExecutionPacket(finalNormalizationCompiled.packet, artifacts, finalNormalizationPlanDir, join(artifacts, "final-normalization-active.json"));
  const finalNormalizationResult = await executeFanout({ cwd: repo, activePointerPath: finalNormalizationPaths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", confirm: () => true, piCommand: fakePi, runId: "final-normalization", workerTimeoutMs: 10_000, validationTimeoutMs: 10_000 });
  const finalNormalizationAttempt = finalNormalizationResult.snapshot.attempts.find((attempt) => attempt.allocation.nodeId === "final-validation");
  const finalNormalizationAttemptDir = join(finalNormalizationResult.paths.runDir, "workers", artifactSegment("final-validation"), "attempts", "001-validation-repair");
  const finalNormalizationAudit = JSON.parse(readFileSync(join(finalNormalizationAttemptDir, "candidate-normalization.json"), "utf8"));
  assert(finalNormalizationResult.status === "succeeded" && readFileSync(join(repo, "x.ts"), "utf8") === "export const x = 2;\n" && finalNormalizationResult.finalValidation.evidence.acceptedRepair, "derived final-repair normalization did not make final validation pass before capture");
  assert(finalNormalizationAttempt?.outcome?.terminalFact.stage === "apply" && finalNormalizationAttempt.outcome.action === "accept" && finalNormalizationAttempt.outcome.evidenceRefs.some((reference) => reference.endsWith("candidate-normalization.json")) && finalNormalizationAudit.status === "completed", "accepted final repair omitted its derived normalization audit or causal apply outcome");
  rmSync(join(repo, "x.ts"));
  assert(fullGitVisibleTree(repo) === base.tree, "final normalization success fixture did not restore the planning tree");

  const wideningNormalizer = { executable: process.execPath, args: ["-e", "const fs = require('node:fs'); if (fs.readFileSync('x.ts', 'utf8') === 'export const x = 1;\\n') { fs.writeFileSync('x.ts', 'export const x = 2;\\n'); fs.writeFileSync('outside.ts', 'outside\\n'); }"] };
  const wideningDetails = structuredClone(finalNormalizationDetails);
  wideningDetails.detailsId = "final-normalization-widened";
  wideningDetails.candidateNormalizationCommands = [wideningNormalizer];
  const wideningDetailsIdentity = artifactIdentity("implementation-details.json", Buffer.from(JSON.stringify(wideningDetails)));
  const wideningCompiled = compileExecutionPacket({ implementationPlan: plan, implementationDetails: wideningDetails, planIdentity, detailsIdentity: wideningDetailsIdentity, tierPlan: { tier1: summary, tier2: { ...summary, status: "unavailable", fallback: "tier1" }, tier2Fallback: summary }, runtimePolicy: { maxConcurrency: 2, failFast: false, fallbackAllowed: true }, createdAt: new Date(0).toISOString() });
  assert(wideningCompiled.packet, wideningCompiled.errors.join("; "));
  const wideningPlanDir = join(artifacts, "final-normalization-widened-plan");
  const wideningPaths = publishExecutionPacket(wideningCompiled.packet, artifacts, wideningPlanDir, join(artifacts, "final-normalization-widened-active.json"));
  const wideningResult = await executeFanout({ cwd: repo, activePointerPath: wideningPaths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", confirm: () => true, piCommand: fakePi, runId: "final-normalization-widened", workerTimeoutMs: 10_000, validationTimeoutMs: 10_000 });
  const wideningAttempt = wideningResult.snapshot.attempts.find((attempt) => attempt.allocation.nodeId === "final-validation");
  assert(wideningResult.status === "failed" && wideningAttempt?.outcome?.terminalFact.stage === "worker-gate" && wideningAttempt.outcome.terminalFact.code === "unauthorized-change" && wideningAttempt.outcome.evidenceRefs.some((reference) => reference.endsWith("candidate-normalization.json")), "final-repair normalizer widened derived upstream write authority");
  assert(!existsSync(join(repo, "outside.ts")) && readFileSync(join(repo, "x.ts"), "utf8") === "export const x = 0;\n", "rejected widened final repair mutated the active accepted tree");
  rmSync(join(repo, "x.ts"));
  assert(fullGitVisibleTree(repo) === base.tree, "final normalization authority fixture did not restore the planning tree");

  const validationStarted = join(root, "validation-started");
  const validationFinished = join(root, "validation-finished");
  const sibling = structuredClone(compiled.packet.nodes[0]);
  sibling.id = "y";
  sibling.workContract.goals = sibling.workContract.goals.map((goal) => ({ ...goal, sourcePlanId: "y" }));
  sibling.workContract.semanticReviewCriteria = sibling.workContract.semanticReviewCriteria.map((criterion) => ({ ...criterion, sourcePlanId: "y" }));
  sibling.workContract.changes = sibling.workContract.changes.map((change) => ({ ...change, target: { ...change.target, resource: { kind: "file", path: "y.ts" }, sourcePlanIds: ["y"] } }));
  sibling.workContract.validationCommands = [{ executable: process.execPath, args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(validationStarted)}, "started\\n"); setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(validationFinished)}, "finished\\n"), 5000)`] }];
  const parallelPacket = { ...compiled.packet, nodes: [compiled.packet.nodes[0], sibling, compiled.packet.nodes.at(-1)] };
  let mismatchedPacketIdentityRejected = false;
  try { new FanoutNodeExecutor({ packet: parallelPacket, packetIdentity, repoRoot: repo, runDir: join(runDir, "executions", "identity-mismatch"), runId: "identity-mismatch", extensionEntry: "packages/fanout-pi/src/index.ts", recorder: { async recordAttemptAllocated() {}, async recordAttemptCompleted() {}, async flush() {} } }); }
  catch (error) { mismatchedPacketIdentityRejected = /artifact (?:byte length|SHA-256) mismatch/.test(String(error)); }
  assert(mismatchedPacketIdentityRejected, "node executor admitted a packet identity that did not describe its packet bytes");
  const parallelPacketIdentity = artifactIdentity(packetIdentity.path, executionPacketBytes(parallelPacket));
  const abortRunDir = join(runDir, "executions", "abort-validation");
  const abortAllocations = [];
  const abortCompletions = [];
  const abortExecutor = new FanoutNodeExecutor({
    packet: parallelPacket,
    packetIdentity: parallelPacketIdentity,
    repoRoot: repo,
    runDir: abortRunDir,
    runId: "abort-validation",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    validationTimeoutMs: 10_000,
    recorder: { async recordAttemptAllocated(allocation) { abortAllocations.push(allocation); }, async recordAttemptCompleted(outcome) { abortCompletions.push(outcome); }, async flush() {} },
  });
  let schedulerRejected = false;
  let schedulerError;
  try {
    await runDag(parallelPacket, {
      maxConcurrency: 2,
      runNode: async (node, signal) => {
        if (node.id === "x") {
          await waitForFile(validationStarted);
          return { ok: true, attemptId: "abort-validation:x" };
        }
        return await abortExecutor.runNode(node, signal);
      },
      onNodeCompleted: () => { throw new Error("injected completion publication failure"); },
    });
  } catch (error) {
    schedulerRejected = true;
    schedulerError = String(error);
  } finally {
    abortExecutor.cleanupWorktrees();
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(schedulerRejected && /injected completion publication failure/.test(schedulerError ?? "") && existsSync(validationStarted) && !existsSync(validationFinished), `completion publication failure did not abort and drain a real in-flight validation process: ${JSON.stringify({ schedulerRejected, schedulerError, validationStarted: existsSync(validationStarted), validationFinished: existsSync(validationFinished) })}`);
  assert(abortAllocations.length === abortCompletions.length && abortAllocations.every((allocation) => abortCompletions.some((outcome) => outcome.attemptId === allocation.attemptId)), "aborted validation left a recorded allocation without one terminal completion");
  assert((git(repo, ["worktree", "list", "--porcelain"]).match(/^worktree /gm) ?? []).length === 1, "aborted real validation leaked worker Git worktree registrations");
  assert(!existsSync(join(abortRunDir, "workers", "y-a1fce436", "attempts", "001-original", "worktree")) && !existsSync(join(abortRunDir, "workers", "y-a1fce436", "attempts", "002-retry", "worktree")), "aborted real validation leaked worker worktree directories");

  const postWorkerAllocations = [];
  const postWorkerCompletions = [];
  const postWorkerExecutor = new FanoutNodeExecutor({
    packet: compiled.packet,
    packetIdentity,
    repoRoot: repo,
    runDir: join(runDir, "executions", "post-worker-abort"),
    runId: "post-worker-abort",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    recorder: { async recordAttemptAllocated(allocation) { postWorkerAllocations.push(allocation); }, async recordAttemptCompleted(outcome) { postWorkerCompletions.push(outcome); }, async flush() {} },
  });
  const postWorkerController = new AbortController();
  let abortReads = 0;
  Object.defineProperty(postWorkerController.signal, "aborted", { configurable: true, get: () => ++abortReads > 1 });
  let postWorkerRejected = false;
  try { await postWorkerExecutor.runNode(compiled.packet.nodes[0], postWorkerController.signal); }
  catch (error) { postWorkerRejected = error?.name === "AbortError"; }
  finally { postWorkerExecutor.cleanupWorktrees(); }
  assert(postWorkerRejected && postWorkerAllocations.length === 1 && postWorkerCompletions.length === 1 && postWorkerCompletions[0].action === "abort" && postWorkerCompletions[0].attemptId === postWorkerAllocations[0].attemptId, "abort after successful worker launch stranded its allocation before the gate");

  const repairPrimary = structuredClone(compiled.packet.nodes[0]);
  repairPrimary.workContract.validationCommands = [{ executable: process.execPath, args: ["-e", `const fs = require('node:fs'); const deadline = Date.now() + 5000; while (!fs.existsSync(${JSON.stringify(join(repo, "y.ts"))})) { if (Date.now() >= deadline) process.exit(2); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); } if (fs.readFileSync('x.ts','utf8') !== 'export const x = 1;\\n') process.exit(1)`] }];
  const repairSibling = structuredClone(compiled.packet.nodes[0]);
  repairSibling.id = "y";
  repairSibling.workContract.goals = repairSibling.workContract.goals.map((goal) => ({ ...goal, sourcePlanId: "y" }));
  repairSibling.workContract.semanticReviewCriteria = repairSibling.workContract.semanticReviewCriteria.map((criterion) => ({ ...criterion, sourcePlanId: "y" }));
  repairSibling.workContract.changes = repairSibling.workContract.changes.map((change) => ({ ...change, target: { ...change.target, resource: { kind: "file", path: "y.ts" }, sourcePlanIds: ["y"] } }));
  repairSibling.workContract.validationCommands = [{ executable: process.execPath, args: ["-e", "if (require('node:fs').readFileSync('y.ts','utf8') !== 'export const x = 0;\\n') process.exit(1)"] }];
  const repairPacket = { ...compiled.packet, nodes: [repairPrimary, repairSibling, compiled.packet.nodes.at(-1)] };
  const repairCompletions = [];
  const repairExecutor = new FanoutNodeExecutor({
    packet: repairPacket,
    packetIdentity: artifactIdentity(packetIdentity.path, executionPacketBytes(repairPacket)),
    repoRoot: repo,
    runDir: join(runDir, "executions", "repair-overlay"),
    runId: "repair-overlay",
    extensionEntry: "packages/fanout-pi/src/index.ts",
    piCommand: fakePi,
    validationTimeoutMs: 10_000,
    recorder: { async recordAttemptAllocated() {}, async recordAttemptCompleted(outcome, acceptedTransition) { repairCompletions.push({ outcome, acceptedTransition }); }, async flush() {} },
  });
  let repairResults;
  try { repairResults = await Promise.all([repairExecutor.runNode(repairPrimary), repairExecutor.runNode(repairSibling)]); }
  finally { repairExecutor.cleanupWorktrees(); }
  const repairAccepted = repairCompletions.filter((entry) => entry.acceptedTransition);
  assert(repairResults.every((result) => result.ok) && repairAccepted.length === 2 && repairAccepted[0].outcome.nodeId === "y" && repairAccepted[1].outcome.nodeId === "x" && repairAccepted[1].acceptedTransition.patch.baseTree === repairAccepted[0].acceptedTransition.patch.resultTree, "validation repair did not rebase its verified seed over the disjoint concurrently accepted tree");
  assert(!repairCompletions.some(({ outcome }) => outcome.terminalFact.stage === "process" && outcome.terminalFact.code === "infrastructure-failure"), "validation repair seed overlay failed before model work");
  rmSync(join(repo, "x.ts"), { force: true });
  rmSync(join(repo, "y.ts"), { force: true });
  assert(fullGitVisibleTree(repo) === base.tree, "repair seed overlay fixture did not restore the planning tree");

  const providerAbort = await executeFanout({ cwd: repo, activePointerPath: paths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", confirm: () => true, piCommand: fakePi, runId: "provider-abort", workerTimeoutMs: 10_000, validationTimeoutMs: 10_000 });
  const abortCause = providerAbort.snapshot.terminalOutcome.cause;
  assert(providerAbort.status === "aborted" && abortCause.kind === "event" && abortCause.code === "user-abort" && abortCause.attemptId === providerAbort.snapshot.attempts[0].allocation.attemptId && providerAbort.snapshot.attempts[0].outcome.action === "abort", "typed provider abort did not produce a terminal run citing its causal attempt completion");

  const failingDetails = { ...details, finalValidationCommands: [{ executable: process.execPath, args: ["-e", "process.exit(7)"] }, { executable: process.execPath, args: ["-e", "process.exit(0)"] }] };
  const failingDetailsIdentity = artifactIdentity("implementation-details.json", Buffer.from(JSON.stringify(failingDetails)));
  const failingCompiled = compileExecutionPacket({ implementationPlan: plan, implementationDetails: failingDetails, planIdentity, detailsIdentity: failingDetailsIdentity, tierPlan: { tier1: summary, tier2: { ...summary, status: "unavailable", fallback: "tier1" }, tier2Fallback: summary }, runtimePolicy: { maxConcurrency: 2, failFast: false, fallbackAllowed: true }, createdAt: new Date(0).toISOString() });
  assert(failingCompiled.packet, failingCompiled.errors.join("; "));
  const failingRunDir = join(artifacts, "final-failure-plan");
  const failingPaths = publishExecutionPacket(failingCompiled.packet, artifacts, failingRunDir, join(artifacts, "final-failure-active.json"));
  const failingPacketIdentity = JSON.parse(readFileSync(failingPaths.activePointerPath, "utf8")).packet;
  const finalFailure = await executeFanout({ cwd: repo, activePointerPath: failingPaths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", confirm: () => true, piCommand: fakePi, runId: "final-failure", workerTimeoutMs: 10_000, validationTimeoutMs: 10_000 });
  assert(finalFailure.status === "failed" && finalFailure.snapshot.finalValidation.disposition === "failed" && finalFailure.snapshot.finalValidation.commandCount === 2 && finalFailure.snapshot.terminalOutcome.outcome === "failed", "fail-fast/exhausted repair did not commit explicit accepted-tree final-validation failure");
  assert(finalFailure.finalValidation.evidence.expectedValidationTree === finalFailure.snapshot.acceptedLedger.at(-1).transition.patch.resultTree && !finalFailure.finalValidation.evidence.candidate, "rejected final-repair candidate became completion-tree authority");
  const finalRepairPrompt = readFileSync(join(finalFailure.paths.runDir, "workers", artifactSegment("final-validation"), "attempts", "001-validation-repair", "prompt.md"), "utf8");
  assert(finalRepairPrompt.includes(failingPacketIdentity.sha256) && finalRepairPrompt.includes('"nodeId": "x"') && finalRepairPrompt.includes('"finalValidationContract"'), "public final-repair prompt omitted immutable packet identity, original final contract, or packet-ordered upstream contracts");
  rmSync(join(repo, "x.ts"));
  assert(fullGitVisibleTree(repo) === base.tree, "final-validation failure fixture did not restore the pre-execution repository tree");

  const ambiguous = await executeFanout({ cwd: repo, activePointerPath: paths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", confirm: () => true, piCommand: fakePi, runId: "ambiguous-lock", workerTimeoutMs: 10_000, validationTimeoutMs: 10_000, afterActiveApply: () => writeFileSync(join(repo, "raced.ts"), "external race\n") });
  const ambiguousAttempt = ambiguous.snapshot.attempts.find((attempt) => attempt.outcome?.terminalFact?.stage === "bookkeeping" && attempt.outcome.terminalFact.code === "failed-after-mutation");
  assert(ambiguous.status === "failed" && ambiguousAttempt && existsSync(lockPath) && JSON.parse(readFileSync(lockPath, "utf8")).runId === "ambiguous-lock", "ambiguous post-apply mutation did not retain the execution lock for manual reconciliation");
  rmSync(lockPath, { force: true });
  rmSync(join(repo, "x.ts"), { force: true });
  rmSync(join(repo, "raced.ts"), { force: true });
  assert(fullGitVisibleTree(repo) === base.tree, "ambiguous-lock fixture cleanup did not restore the planning base");

  let liveConfirmation = "";
  const live = await executeFanout({ cwd: repo, activePointerPath: paths.activePointerPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", confirm: (_title, message) => { liveConfirmation = message; return true; }, piCommand: fakePi, runId: "live", workerTimeoutMs: 10_000, validationTimeoutMs: 10_000, worktreeSharedPaths: [".preinstalled"] });
  assert(live.status === "succeeded" && existsSync(join(repo, "x.ts")) && readFileSync(join(repo, "x.ts"), "utf8") === "export const x = 1;\n", `public executeFanout live seam did not apply the accepted patch: ${JSON.stringify({ status: live.status, error: live.error, snapshot: live.snapshot })}`);
  assert(live.snapshot.acceptedLedger.length === 1 && live.snapshot.finalValidation.disposition === "passed" && live.snapshot.totals.totalTokens === 12 && live.snapshot.totals.attemptKinds.retry === 1 && live.snapshot.totals.attemptKinds["validation-repair"] === 1, "live projection lost retry success, repair, accepted transition, final validation, or metrics");
  assert(live.snapshot.preflightEvidence.worker.launcher.resolvedExecutable && live.snapshot.preflightEvidence.worker.extension.resolved, "live projection did not preserve resolved worker evidence");
  assert(live.snapshot.preflightEvidence.validationCommands.some((entry) => entry.nodeId === "x" && entry.manifest.args.join("\0") === command.args.join("\0") && entry.resolution.status === "available"), "live projection did not preserve resolved validation argv evidence");
  assert(liveConfirmation.includes("Shared worktree paths: .preinstalled"), "live confirmation omitted explicit worktree preparation input");
  const liveEvents = readFileSync(live.paths.eventsPath, "utf8").trim().split("\n").map(JSON.parse);
  assert(liveEvents.length === 13 && liveEvents.every((event, index) => event.sequence === index + 1), "live executeFanout retry/repair seam did not produce a gapless causal lifecycle");
  const projectionBytes = readFileSync(live.paths.snapshotPath, "utf8");
  const reportBytes = readFileSync(live.paths.summaryPath, "utf8");
  replayExecutionArtifacts(live.paths.runDir);
  assert(readFileSync(live.paths.snapshotPath, "utf8") === projectionBytes && readFileSync(live.paths.summaryPath, "utf8") === reportBytes, "live audit replay was not byte-stable");
  assert(!existsSync(join(repo, ".git", "fanout-execution.lock")), "live execution leaked the repository lock");
  assert((git(repo, ["worktree", "list", "--porcelain"]).match(/^worktree /gm) ?? []).length === 1, "live execution leaked worker Git worktree registrations");
  assert(!existsSync(join(live.paths.runDir, "workers", "x-2d711642", "attempts", "001-original", "worktree")) && !existsSync(join(live.paths.runDir, "workers", "x-2d711642", "attempts", "002-retry", "worktree")) && !existsSync(join(live.paths.runDir, "workers", "x-2d711642", "attempts", "003-validation-repair", "worktree")), "live execution leaked worker worktree directories");

  const legacyPath = join(artifacts, "legacy-active.json");
  const legacy = `${JSON.stringify({ schema: "fanout.active-packet", version: 1, updatedAt: "old", packetPath: paths.packetPath })}\n`;
  writeFileSync(legacyPath, legacy);
  const before = git(repo, ["status", "--porcelain=v1"]);
  let rejected = false; try { await executeFanout({ cwd: repo, activePointerPath: legacyPath, projectArtifactRoot: artifacts, extensionEntry: "packages/fanout-pi/src/index.ts", dryRun: true, runId: "legacy" }); } catch (error) { rejected = /rerun \/fanout-plan/.test(String(error)); }
  assert(rejected, "A18 legacy pointer did not get replan guidance");
  assert(readFileSync(legacyPath, "utf8") === legacy && git(repo, ["status", "--porcelain=v1"]) === before && !existsSync(join(repo, ".git", "fanout-execution.lock")), "A18 rejection mutated history, repository, or lock");
  console.log("fanout execute cutover smoke passed (live public seam/event v3/projection v4/A18)");
} finally { rmSync(root, { recursive: true, force: true }); }

function git(cwd, args) { return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8" }).trim(); }
async function waitForFile(path) { const deadline = Date.now() + 5000; while (!existsSync(path)) { if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`); await new Promise((resolve) => setTimeout(resolve, 10)); } }
