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
const modelId = "deepseek-ai/DeepSeek-V4-Flash-0731";

try {
  const result = spawnSync(
    "pi",
    ["-e", ".", "--model", `doubleword/${modelId}`, "-p", "Respond 'hello', do not say anything else."],
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
  const end = events.find((event) => event.event === "provider_end" && event.provider === "doubleword" && event.model === modelId && event.tier === "realtime");
  if (!end) throw new Error(`missing live realtime provider_end\n${readFileSync(logFile, "utf8")}`);
  if (end.usageSource !== "provider" || end.usageInputField !== "input_tokens" || end.usageOutputField !== "output_tokens" || !Number.isSafeInteger(end.usage?.input) || !Number.isSafeInteger(end.usage?.output)) throw new Error(`0731 did not return native input_tokens/output_tokens usage\n${readFileSync(logFile, "utf8")}`);
  if (end.pricingSource !== "doubleword-model-metadata" || end.pricingSourceUrl !== "https://docs.doubleword.ai/inference-api/models" || !/^\d{4}-\d{2}-\d{2}$/.test(end.pricingRetrievedAt) || !/^[a-f0-9]{64}$/.test(end.pricingSnapshotSha256)) throw new Error(`0731 pricing snapshot provenance is incomplete\n${readFileSync(logFile, "utf8")}`);

  console.log(`live realtime smoke passed (${events.length} events)`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability log: ${logFile}`);
  process.exit(1);
}
