import { spawnSync } from "node:child_process";

const result = spawnSync("pi", ["-e", ".", "--list-models"], {
  cwd: process.cwd(),
  encoding: "utf8",
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
  ["doubleword-realtime-stub", "glm-5-2"],
  ["doubleword-realtime-stub", "deepseek-v4-flash"],
  ["doubleword-realtime", "zai-org/GLM-5.2-FP8"],
  ["doubleword-realtime", "deepseek-ai/DeepSeek-V4-Flash"],
  ["doubleword-async", "zai-org/GLM-5.2-FP8"],
  ["doubleword-async", "deepseek-ai/DeepSeek-V4-Flash"],
  ["doubleword-async-stub", "doubleword-async-stub"],
];

const missing = expected
  .map(([provider, model]) => `${provider}/${model}`)
  .filter((pair) => !available.has(pair));

if (missing.length) throw new Error(`missing model pairs: ${missing.join(", ")}\n${result.stdout}`);

console.log("model check passed");
