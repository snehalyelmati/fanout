import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deriveAttemptMetricTotals } from "../packages/fanout-core/src/attempt-metrics.ts";
import { correlatedWorkerMetrics } from "../packages/fanout-pi/src/attempt-evidence.ts";
import {
  WORKER_MODEL_TOOLS,
  WORKER_TRUST_BOUNDARY,
  guardWorkerWritePath,
  workerToolBlockReason,
} from "../packages/fanout-pi/src/worker-capabilities.ts";

const root = mkdtempSync(join(tmpdir(), "fanout-worker-pipeline-"));
try {
  const worktree = join(root, "worktree");
  const outside = join(root, "outside");
  mkdirSync(join(worktree, "src"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(worktree, "src", "value.txt"), "before\n");
  symlinkSync(outside, join(worktree, "escape"));

  assert(WORKER_MODEL_TOOLS.join(",") === "read,grep,find,ls,edit,write", "A19 fixed worker profile changed");
  assert(workerToolBlockReason("read", { path: "../secret" }, worktree) === undefined, "worker reads were falsely described as contained");
  assert(workerToolBlockReason("bash", { command: "true" }, worktree)?.includes("unavailable"), "A7 bash remained model-callable");
  assert(workerToolBlockReason("extension_tool", {}, worktree)?.includes("unavailable"), "A7 extension tool remained model-callable");
  assert(workerToolBlockReason("write", { path: "src/new.txt" }, worktree) === undefined, "valid worker write was blocked");

  for (const path of ["../outside.txt", ".git/config", "src/../outside.txt", join(worktree, "absolute.txt"), "escape/mutated.txt"]) {
    const reason = workerToolBlockReason("write", { path }, worktree);
    assert(reason, `A7 worker escape was admitted: ${path}`);
  }
  assert(!existsSync(join(outside, "mutated.txt")), "A7 symlink escape mutated outside before rejection");
  assert(guardWorkerWritePath(worktree, "src/future/file.txt") === "src/future/file.txt", "new in-worktree path was rejected");

  for (const phrase of ["ignored files", "external paths", "network", "processes", "outside Fanout containment"]) {
    assert(WORKER_TRUST_BOUNDARY.includes(phrase), `A20 trust boundary omitted ${phrase}`);
  }
  const partialStdout = join(root, "partial-stdout.jsonl");
  const partialObservability = join(root, "partial-observability.jsonl");
  writeFileSync(partialStdout, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "fake", model: "worker", usage: { input: 4, output: 2, totalTokens: 6, cost: { total: 0.01 } } } })}\n`);
  writeFileSync(partialObservability, `${JSON.stringify({ event: "turn_end", turnIndex: 0 })}\n`);
  const partial = correlatedWorkerMetrics("partial:000001", { provider: "fake", model: "worker", tier: "tier1", workerDurationMs: 8 }, partialStdout, partialObservability, undefined);
  assert(!partial.complete && deriveAttemptMetricTotals(partial).costUsd === 0.01 && deriveAttemptMetricTotals(partial).totalTokens === 6, "failed runtime attempt discarded observed partial usage/cost");
  const cachedStdout = join(root, "cached-stdout.jsonl");
  const cachedObservability = join(root, "cached-observability.jsonl");
  writeFileSync(cachedStdout, `${JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "fake", model: "worker", usage: { input: 4, output: 2, cacheRead: 10, cacheWrite: 1, totalTokens: 17, cost: { total: 0.01 } }, content: [] } })}\n`);
  writeFileSync(cachedObservability, `${JSON.stringify({ event: "turn_end", turnIndex: 0 })}\n`);
  const cached = correlatedWorkerMetrics("cached:000001", { provider: "fake", model: "worker", tier: "tier1", workerDurationMs: 8 }, cachedStdout, cachedObservability, 1);
  assert(cached.complete && deriveAttemptMetricTotals(cached).inputTokens === 4 && deriveAttemptMetricTotals(cached).totalTokens === 17, "Pi cached tokens were rejected or omitted from generic attempt metrics");
  testDiscoveredExtensionWithFixedProfile(root);
  console.log("worker pipeline smoke passed (A7, A19, A20)");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function testDiscoveredExtensionWithFixedProfile(root) {
  const repo = join(root, "discovery-repo");
  const marker = join(root, "discovered-tools.json");
  mkdirSync(join(repo, ".pi", "extensions"), { recursive: true });
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
      FANOUT_WORKTREE_ROOT: repo,
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
