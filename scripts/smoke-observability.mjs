import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-"));
const logFile = join(dir, "observability.jsonl");

function run(model) {
  const result = spawnSync("pi", ["-e", ".", "--model", `${model}/${model}`, "-p", "Say hello"], {
    cwd: process.cwd(),
    env: { ...process.env, DOUBLEWORD_OBSERVABILITY_FILE: logFile, DOUBLEWORD_RUN_ID: "smoke-observability" },
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.includes("Doubleword stub response.")) {
    throw new Error(`${model} smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
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

try {
  run("doubleword-realtime-stub");
  run("doubleword-async-stub");

  const events = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const providers = ["doubleword-realtime-stub", "doubleword-async-stub"];
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
    ]),
    ["async_submit", has(events, "async_submit")],
    ["async_poll", has(events, "async_poll", (event) => typeof event.durationMs === "number")],
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
