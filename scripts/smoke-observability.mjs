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

function has(events, name, predicate = () => true) {
  return events.some((event) => event.event === name && predicate(event));
}

try {
  run("doubleword-realtime-stub");
  run("doubleword-async-stub");

  const events = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const checks = [
    ["provider_start", has(events, "provider_start")],
    ["provider_ttft", has(events, "provider_ttft", (event) => typeof event.ttftMs === "number")],
    ["provider_end", has(events, "provider_end", (event) => typeof event.durationMs === "number")],
    ["usage.cost.total", has(events, "provider_end", (event) => typeof event.usage?.cost?.total === "number")],
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
