import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const promptPath = "prompts/dw-plan.md";
if (!existsSync(promptPath)) throw new Error(`${promptPath} is missing`);

const prompt = readFileSync(promptPath, "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

if (!pkg.pi?.prompts?.includes(`./${promptPath}`)) throw new Error(`package.json does not expose ./${promptPath}`);
for (const phrase of ["Planning only", "Clarify until the ask is clear", "<proposed_plan>"]) {
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
  const result = spawnSync("pi", ["-e", ".", "--model", "doubleword-realtime-stub/glm-5-2", "-p", promptText], {
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
  const planned = run("dw-plan", "/dw-plan Prepare a docs-only change plan");
  const minimumLift = 20;

  if (planned.input <= plain.input + minimumLift) {
    throw new Error(`dw-plan did not materially increase provider input: plain=${plain.input}, dw-plan=${planned.input}, logs=${plain.logFile},${planned.logFile}`);
  }

  console.log(`planning smoke passed (plain input=${plain.input}, dw-plan input=${planned.input}, events=${plain.events.length}+${planned.events.length})`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability logs: ${dir}`);
  process.exit(1);
}
