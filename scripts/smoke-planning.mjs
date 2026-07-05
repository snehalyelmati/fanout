import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const promptPath = "packages/fanout-pi/prompts/fanout-plan.md";
if (!existsSync(promptPath)) throw new Error(`${promptPath} is missing`);

const prompt = readFileSync(promptPath, "utf8");

const piPkg = JSON.parse(readFileSync("packages/fanout-pi/package.json", "utf8"));
if (!piPkg.pi?.extensions?.includes("./src/index.ts")) throw new Error("packages/fanout-pi/package.json does not expose ./src/index.ts");
if (piPkg.pi?.prompts?.includes("./prompts/fanout-plan.md")) throw new Error("/fanout-plan should be command-backed, not a package prompt");
for (const phrase of ["Planning only", "ask_user_question", "Fanout plan ready", "Validate the DAG", "Resolved preflight context", "packetHelper.printRunDir", "scripts/fanout-packet-artifacts.mjs", "Tier/model plan", "Execution flow", "Metrics"]) {
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

function run(name, promptText, settings) {
  const logFile = join(dir, `${name}.jsonl`);
  const agentDir = join(dir, `${name}-agent`);
  mkdirSync(agentDir, { recursive: true });
  if (settings) writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  const result = spawnSync("pi", ["--no-extensions", "-e", ".", "--model", "doubleword-stub/deepseek-v4-flash", "-p", promptText], {
    cwd: process.cwd(),
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, DOUBLEWORD_OBSERVABILITY_FILE: logFile, DOUBLEWORD_RUN_ID: `smoke-planning-${name}` },
    encoding: "utf8",
  });

  if (result.status !== 0 || (name === "plain" && !result.stdout.includes("Doubleword stub response."))) {
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

function preflight(runResult) {
  const event = runResult.events.find((item) => item.event === "fanout_plan_preflight");
  if (!event) throw new Error(`${runResult.logFile}: missing fanout_plan_preflight event`);
  return event;
}

try {
  const plain = run("plain", "Prepare a docs-only change plan");
  const planned = run("fanout-plan", "/fanout-plan Prepare a docs-only change plan", {
    fanout: { tiers: { tier2: { provider: "doubleword-stub", model: "glm-5-2", thinking: "medium", enabled: false } } },
  });
  const unavailable = preflight(planned);
  if (unavailable.tierPlan?.tier2?.status !== "unavailable" || unavailable.tierPlan?.tier2?.fallback !== "tier1" || unavailable.tier2Availability?.available !== false || unavailable.nodeKindTierPolicy?.fallbackTier !== "tier1" || !String(unavailable.tier2Availability?.reason).includes("disabled")) {
    throw new Error(`bad unavailable tier2 fallback: ${JSON.stringify(unavailable)}`);
  }

  const stubTier2 = run("fanout-plan-tier2-stub", "/fanout-plan Prepare a docs-only change plan", {
    fanout: { tiers: { tier2: { provider: "doubleword-stub", model: "glm-5-2", thinking: "medium" } } },
  });
  const available = preflight(stubTier2);
  if (
    available.tierPlan?.tier2?.provider !== "doubleword-stub" ||
    available.tierPlan?.tier2?.model !== "glm-5-2" ||
    available.tierPlan?.tier2?.thinking !== "medium" ||
    available.tierPlan?.tier2?.source !== "fanout.tiers.tier2" ||
    available.tierPlan?.tier2?.status !== "available" ||
    available.tier2Availability?.available !== true ||
    available.tier2Availability?.reason !== "model has async/background/authReady fanout metadata" ||
    available.tier2Availability?.fanout?.async !== true ||
    available.tier2Availability?.fanout?.background !== true ||
    available.tier2Availability?.fanout?.authReady !== true ||
    "fallback" in available.tierPlan.tier2
  ) {
    throw new Error(`bad available tier2 preflight: ${JSON.stringify(available)}`);
  }
  const minimumLift = 20;

  if (planned.input <= plain.input + minimumLift) {
    throw new Error(`fanout-plan did not materially increase provider input: plain=${plain.input}, fanout-plan=${planned.input}, logs=${plain.logFile},${planned.logFile}`);
  }

  console.log(`planning smoke passed (plain input=${plain.input}, fanout-plan input=${planned.input}, tier2-stub input=${stubTier2.input}, events=${plain.events.length}+${planned.events.length}+${stubTier2.events.length})`);
  rmSync(dir, { recursive: true, force: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`observability logs: ${dir}`);
  process.exit(1);
}
