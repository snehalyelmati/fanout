import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-"));
const logFile = join(dir, "observability.jsonl");
const realtimeModels = [
  { model: "deepseek-v4-flash", inputRate: 0.09, outputRate: 0.18 },
];

function run(provider, model = provider, envPatch = {}) {
  const result = spawnSync("pi", ["-e", ".", "--model", `${provider}/${model}`, "-p", "Respond 'hello', do not say anything else."], {
    cwd: process.cwd(),
    env: { ...process.env, DOUBLEWORD_OBSERVABILITY_FILE: logFile, DOUBLEWORD_RUN_ID: "smoke-observability", ...envPatch },
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.includes("Doubleword stub response.")) {
    throw new Error(`${provider}/${model} smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

function byEvent(events, name) {
  return events.filter((event) => event.event === name);
}

function has(events, name, predicate = () => true) {
  return byEvent(events, name).some(predicate);
}

function allEvents(events, name, count, predicate) {
  const matches = byEvent(events, name);
  return matches.length === count && matches.every(predicate);
}

function sameCost(actual, expected) {
  return Math.abs(actual - expected) <= Number.EPSILON;
}

function testExternalFanoutObservability() {
  const repo = join(dir, "repo");
  const artifactRoot = join(dir, "fanout-artifacts");
  const init = spawnSync("git", ["init", "--quiet", repo], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  const env = { ...process.env, FANOUT_ARTIFACT_DIR: artifactRoot, DOUBLEWORD_RUN_ID: "external-observability" };
  delete env.DOUBLEWORD_OBSERVABILITY_FILE;
  const result = spawnSync("pi", ["-e", resolve("packages/fanout-pi/src/index.ts"), "--model", "doubleword-stub/deepseek-v4-flash", "-p", "Respond 'hello', do not say anything else."], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.includes("Doubleword stub response.")) throw new Error(`external observability run failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
  if (status.status !== 0 || status.stdout.trim()) throw new Error(`Fanout dirtied target repository: ${status.stdout}${status.stderr}`);
  if (existsSync(join(repo, "runs"))) throw new Error("Fanout created repository-local runs/");
  const externalLog = findFile(artifactRoot, "observability.jsonl");
  if (!externalLog) throw new Error("Fanout did not create external observability.jsonl");
  const events = readFileSync(externalLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (!events.some((event) => event.event === "session_start" && event.sessionRunId && event.observabilityPath === externalLog)) throw new Error(`external session telemetry missing: ${readFileSync(externalLog, "utf8")}`);
  if (!events.some((event) => event.event === "provider_end" && event.runId === "external-observability")) throw new Error(`bundled provider did not share external telemetry: ${readFileSync(externalLog, "utf8")}`);
}

function findFile(directory, name) {
  if (!existsSync(directory)) return undefined;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) return path;
  }
}

function realtimeCostMatches(event, model, inputRate, outputRate) {
  if (event.provider !== "doubleword-stub" || event.model !== model || event.tier !== "realtime") return false;
  const usage = event.usage;
  if (typeof usage?.input !== "number" || typeof usage.output !== "number") return false;
  const expectedInput = usage.input * inputRate / 1_000_000;
  const expectedOutput = usage.output * outputRate / 1_000_000;
  const expectedTotal = expectedInput + expectedOutput;
  return sameCost(usage.cost?.input, expectedInput) && sameCost(usage.cost.output, expectedOutput) && sameCost(usage.cost.total, expectedTotal);
}

try {
  testExternalFanoutObservability();
  run("doubleword-stub", "deepseek-v4-flash");
  run("doubleword-stub", "deepseek-v4-flash", { DOUBLEWORD_EXECUTION_MODE: "async" });

  const events = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const providers = ["doubleword-stub"];
  const checks = [
    ["agent_end.no_tools", allEvents(events, "agent_end", 2, (event) => event.turnCount === 1 && event.toolCallCount === 0)],
    ["turn_start", has(events, "turn_start", (event) => typeof event.turnIndex === "number")],
    ["turn_end.no_tools", allEvents(events, "turn_end", 2, (event) => event.toolCallCount === 0)],
    ["provider_start", has(events, "provider_start")],
    ...providers.flatMap((provider) => [
      [`${provider}.provider_start.turnIndex`, has(events, "provider_start", (event) => event.provider === provider && event.turnIndex === 0)],
      [`${provider}.batchingDiscipline`, has(events, "provider_start", (event) => event.provider === provider && event.batchingDiscipline === true)],
      [`${provider}.provider_ttft`, has(events, "provider_ttft", (event) => event.provider === provider && typeof event.ttftMs === "number")],
      [`${provider}.provider_end`, has(events, "provider_end", (event) => event.provider === provider && typeof event.durationMs === "number")],
      [`${provider}.usage.cost.total`, has(events, "provider_end", (event) => event.provider === provider && typeof event.usage?.cost?.total === "number")],
      [`${provider}.usage.provenance`, has(events, "provider_end", (event) => event.provider === provider && event.usageSource === "synthetic-stub" && event.pricingSource === "doubleword-stub-model-metadata")],
    ]),
    ...realtimeModels.map(({ model, inputRate, outputRate }) => [
      `realtime.${model}.cost`,
      has(events, "provider_end", (event) => realtimeCostMatches(event, model, inputRate, outputRate)),
    ]),
    ["unified.realtime.tier", has(events, "provider_end", (event) => event.provider === "doubleword-stub" && event.model === "deepseek-v4-flash" && event.tier === "realtime")],
    ["unified.async.tier", has(events, "provider_end", (event) => event.provider === "doubleword-stub" && event.model === "deepseek-v4-flash" && event.tier === "async")],
    ["unified.async_submit", has(events, "async_submit", (event) => event.provider === "doubleword-stub" && event.turnIndex === 0 && event.serviceTierRequested === "flex")],
    ["unified.async_poll", has(events, "async_poll", (event) => event.provider === "doubleword-stub" && event.turnIndex === 0 && event.serviceTierRequested === "flex" && typeof event.durationMs === "number")],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) throw new Error(`Missing observability fields/events: ${missing.join(", ")}\n${readFileSync(logFile, "utf8")}`);

  console.log(`observability smoke passed (${events.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability log: ${logFile}`);
  process.exit(1);
}
