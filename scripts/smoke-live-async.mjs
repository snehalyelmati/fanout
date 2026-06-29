import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DOUBLEWORD_API_KEY) {
  console.log("skipping live async smoke: DOUBLEWORD_API_KEY is not set");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-live-async-"));
const logFile = join(dir, "observability.jsonl");
const timeout = Number(process.env.DOUBLEWORD_LIVE_ASYNC_SMOKE_TIMEOUT_MS ?? 600_000);

try {
  const result = spawnSync(
    "pi",
    ["-e", ".", "--model", "doubleword/deepseek-ai/DeepSeek-V4-Flash", "-p", "Respond 'hello', do not say anything else."],
    {
      cwd: process.cwd(),
      env: { ...process.env, DOUBLEWORD_EXECUTION_MODE: "async", DOUBLEWORD_OBSERVABILITY_FILE: logFile, DOUBLEWORD_RUN_ID: "smoke-live-async" },
      encoding: "utf8",
      timeout,
    },
  );

  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`live async smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const events = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const has = (name, predicate = () => true) => events.some((event) => event.event === name && predicate(event));
  const required = [
    ["async_submit", has("async_submit", (event) => event.provider === "doubleword" && event.serviceTierRequested === "flex" && typeof event.responseId === "string")],
    ["provider_end", has("provider_end", (event) => event.provider === "doubleword" && event.model === "deepseek-ai/DeepSeek-V4-Flash" && event.tier === "async")],
  ];
  const missing = required.filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) throw new Error(`missing live async events: ${missing.join(", ")}\n${readFileSync(logFile, "utf8")}`);

  console.log(`live async smoke passed (${events.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability log: ${logFile}`);
  process.exit(1);
}
