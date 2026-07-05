import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const promptPath = "packages/fanout-pi/prompts/fanout-plan.md";
if (!existsSync(promptPath)) throw new Error(`${promptPath} is missing`);

const prompt = readFileSync(promptPath, "utf8");

const piPkg = JSON.parse(readFileSync("packages/fanout-pi/package.json", "utf8"));
if (!piPkg.pi?.prompts?.includes("./prompts/fanout-plan.md")) throw new Error("packages/fanout-pi/package.json does not expose ./prompts/fanout-plan.md");
for (const phrase of ["Planning only", "ask_user_question", "Fanout plan ready", "Validate the DAG", "FANOUT_ARTIFACT_DIR=\"<artifactRoot from Fanout runtime context>\"", "scripts/fanout-packet-artifacts.mjs", "Tier/model plan", "Execution flow", "Metrics"]) {
  if (!prompt.includes(phrase)) throw new Error(`${promptPath} is missing phrase: ${phrase}`);
}

const dir = mkdtempSync(join(tmpdir(), "doubleword-pi-plan-"));

function readEvents(logFile) {
  return readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function run(name, promptText) {
  const logFile = join(dir, `${name}.jsonl`);
  const result = spawnSync("pi", ["-e", ".", "--model", "doubleword-stub/deepseek-v4-flash", "-p", promptText], {
    cwd: process.cwd(),
    env: { ...process.env, DOUBLEWORD_OBSERVABILITY_FILE: logFile, DOUBLEWORD_RUN_ID: `smoke-planning-${name}` },
    encoding: "utf8",
  });

  if (result.status !== 0 || !result.stdout.includes("Doubleword stub response.")) {
    throw new Error(`${name} planning smoke failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const events = readEvents(logFile);
  if (!events.some((event) => event.event === "provider_start")) throw new Error(`${name}: missing provider_start event`);
  const providerEnd = events.find((event) => event.event === "provider_end");
  if (!providerEnd) throw new Error(`${name}: missing provider_end event`);
  const input = providerEnd.usage?.input;
  if (typeof input !== "number") throw new Error(`${name}: missing provider_end.usage.input`);
  return { events, input, logFile };
}

try {
  const plain = run("plain", "Prepare a docs-only change plan");
  const planned = run("fanout-plan", "/fanout-plan Prepare a docs-only change plan");
  const minimumLift = 20;

  if (planned.input <= plain.input + minimumLift) {
    throw new Error(`fanout-plan did not materially increase provider input: plain=${plain.input}, fanout-plan=${planned.input}, logs=${plain.logFile},${planned.logFile}`);
  }

  console.log(`planning smoke passed (plain input=${plain.input}, fanout-plan input=${planned.input}, events=${plain.events.length}+${planned.events.length})`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability logs: ${dir}`);
  process.exit(1);
}
