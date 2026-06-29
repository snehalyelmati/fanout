import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = { ...process.env };
delete env.DOUBLEWORD_API_KEY;
env.DOUBLEWORD_MODEL_CACHE_FILE = join(tmpdir(), `doubleword-check-models-${process.pid}-${Date.now()}.json`);

const result = spawnSync("pi", ["-e", ".", "--list-models"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env,
});

if (result.status !== 0) {
  throw new Error(`pi --list-models failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

const rows = result.stdout
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .filter(([provider, model]) => provider && model && provider !== "provider");

const available = new Set(rows.map(([provider, model]) => `${provider}/${model}`));
const expected = [
  ["doubleword-stub", "glm-5-2"],
  ["doubleword-stub", "deepseek-v4-flash"],
  ["doubleword", "zai-org/GLM-5.2-FP8"],
  ["doubleword", "deepseek-ai/DeepSeek-V4-Flash"],
];

const missing = expected
  .map(([provider, model]) => `${provider}/${model}`)
  .filter((pair) => !available.has(pair));
const forbiddenProviders = new Set(["doubleword-realtime-stub", "doubleword-async-stub", "doubleword-realtime", "doubleword-async"]);
const duplicates = rows
  .filter(([provider]) => forbiddenProviders.has(provider))
  .map(([provider, model]) => `${provider}/${model}`);

if (missing.length) throw new Error(`missing model pairs: ${missing.join(", ")}\n${result.stdout}`);
if (duplicates.length) throw new Error(`legacy duplicate model pairs present: ${duplicates.join(", ")}\n${result.stdout}`);

console.log("model check passed");
