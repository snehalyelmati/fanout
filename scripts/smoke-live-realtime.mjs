import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DOUBLEWORD_API_KEY) {
  console.log("skipping live realtime smoke: DOUBLEWORD_API_KEY is not set");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-live-realtime-"));
const logFile = join(dir, "observability.jsonl");
const timeout = Number(process.env.DOUBLEWORD_LIVE_REALTIME_SMOKE_TIMEOUT_MS ?? 180_000);

try {
  const result = spawnSync(
    "pi",
    ["-e", ".", "--model", "doubleword/deepseek-ai/DeepSeek-V4-Flash", "-p", "Respond 'hello', do not say anything else."],
    {
      cwd: process.cwd(),
      env: { ...process.env, DOUBLEWORD_OBSERVABILITY_FILE: logFile, DOUBLEWORD_RUN_ID: "smoke-live-realtime" },
      encoding: "utf8",
      timeout,
    },
  );

  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`live realtime smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const events = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const hasEnd = events.some((event) => event.event === "provider_end" && event.provider === "doubleword" && event.model === "deepseek-ai/DeepSeek-V4-Flash" && event.tier === "realtime");
  if (!hasEnd) throw new Error(`missing live realtime provider_end\n${readFileSync(logFile, "utf8")}`);

  console.log(`live realtime smoke passed (${events.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability log: ${logFile}`);
  process.exit(1);
}
