import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  readExecutionPacket,
  renderExecutionPlanMarkdown,
  validateExecutionPacket,
  writeExecutionPacketArtifacts,
} from "../packages/fanout-core/src/execution-packet.ts";

const fixtureDir = "datasets/fixtures/fanout-packets";
const validPacketPath = join(fixtureDir, "valid-ready.json");
const validPacketAbs = resolve(validPacketPath);
const cliScriptAbs = resolve("scripts/fanout-packet-artifacts.mjs");
const cases = [
  ["valid-ready.json", true, true, []],
  ["cycle.json", false, false, ["cycle"]],
  ["missing-dependency.json", false, false, ["missing-dependency"]],
  ["ownership-conflict.json", false, false, ["ownership-conflict"]],
  ["missing-validation.json", false, false, ["missing-validation"]],
  ["unsafe-command.json", false, false, ["unsafe-command"]],
];

for (const [file, ok, executable, expectedCodes] of cases) {
  const packet = readExecutionPacket(join(fixtureDir, file));
  const result = validateExecutionPacket(packet);
  if (result.ok !== ok) fail(`${file}: expected ok=${ok}, got ${result.ok}`, result);
  if (result.executable !== executable) fail(`${file}: expected executable=${executable}, got ${result.executable}`, result);
  assertCodes(file, result, expectedCodes);
}

const validPacket = readExecutionPacket(validPacketPath);
expectInvalid("rm -fr unsafe variant", withPatch(validPacket, (packet) => {
  packet.workUnits[0].steps = ["rm -fr ."];
}), ["unsafe-command"]);
expectInvalid("absolute rm executable", withPatch(validPacket, (packet) => {
  packet.workUnits[0].steps = ["/bin/rm -rf ."];
}), ["unsafe-command"]);
expectInvalid("absolute sudo executable", withPatch(validPacket, (packet) => {
  packet.finalValidationPlan = ["/usr/bin/sudo true"];
}), ["unsafe-command"]);
expectInvalid("unsafe final validation", withPatch(validPacket, (packet) => {
  packet.finalValidationPlan = ["rm --recursive --force ."];
}), ["unsafe-command"]);
expectInvalid("git global option reset", withPatch(validPacket, (packet) => {
  packet.finalValidationPlan = ["rtk git -C . reset --hard"];
}), ["unsafe-command"]);
expectInvalid("committing final validation", withPatch(validPacket, (packet) => {
  packet.finalValidationPlan = ["rtk git commit -am validation"];
}), ["unsafe-command"]);
expectInvalid("npm publish with global options", withPatch(validPacket, (packet) => {
  packet.finalValidationPlan = ["npm --prefix . publish"];
}), ["unsafe-command"]);
expectInvalid("npm publish with arbitrary global option", withPatch(validPacket, (packet) => {
  packet.finalValidationPlan = ["npm --user-agent fanout publish"];
}), ["unsafe-command"]);
expectInvalid("Windows npm publish executable", withPatch(validPacket, (packet) => {
  packet.finalValidationPlan = ["\"C:\\Program Files\\nodejs\\npm.cmd\" --prefix . publish"];
}), ["unsafe-command"]);
expectInvalid("noncanonical work unit id", withPatch(validPacket, (packet) => {
  packet.workUnits[0].id += " ";
}), ["noncanonical-unit-id"]);
expectInvalid("noncanonical dependency id", withPatch(validPacket, (packet) => {
  packet.workUnits[1].dependencies[0] += " ";
}), ["noncanonical-dependency"]);
expectInvalid("critical path mismatch", withPatch(validPacket, (packet) => {
  packet.estimates.criticalPath = ["final-review"];
}), ["critical-path-mismatch"]);
expectInvalid("parallel groups mismatch", withPatch(validPacket, (packet) => {
  packet.estimates.parallelGroups = [["update-readme", "final-review"]];
}), ["parallel-groups-mismatch"]);
expectInvalid("directory/file ownership overlap", withPatch(validPacket, (packet) => {
  packet.workUnits = [
    unit("docs-dir", [], ["docs/"], []),
    unit("roadmap", [], ["docs/ROADMAP.md"], []),
  ];
  packet.estimates.criticalPath = ["docs-dir"];
  packet.estimates.parallelGroups = [["docs-dir", "roadmap"]];
}), ["ownership-conflict"]);
expectInvalid("blocked status", withPatch(validPacket, (packet) => {
  packet.status = "blocked";
}), ["invalid-status"]);
expectInvalid("ready blockers", withPatch(validPacket, (packet) => {
  packet.blockers = ["need a decision"];
}), ["ready-has-blockers"]);
expectInvalid("whitespace blocker", withPatch(validPacket, (packet) => {
  packet.blockers = ["   "];
}), ["ready-has-blockers"]);
expectInvalid("tier2 unavailable assignment", withPatch(validPacket, (packet) => {
  packet.workUnits[0].tier.assigned = "tier2";
}), ["tier2-unavailable-assignment"]);
expectInvalid("missing worker packet", withPatch(validPacket, (packet) => {
  delete packet.workUnits[0].workerPacket;
}), ["missing-worker-packet"]);

const dir = mkdtempSync(join(tmpdir(), "fanout-packet-"));
try {
  const activePointerPath = join(dir, "active-packet.json");
  const paths = writeExecutionPacketArtifacts(validPacket, join(dir, "run"), { activePointerPath });
  for (const path of [paths.packetPath, paths.planPath, paths.dagPath, activePointerPath]) {
    if (!existsSync(path)) throw new Error(`artifact not written: ${path}`);
  }
  const active = JSON.parse(readFileSync(activePointerPath, "utf8"));
  if (active.schema !== "fanout.active-packet" || active.packetPath !== paths.packetPath) throw new Error(`bad active pointer: ${JSON.stringify(active)}`);
  const plan = readFileSync(paths.planPath, "utf8");
  for (const pattern of [/Tier\/model plan/, /Execution flow/, /\| goal :/, /\| tier :/, /\| owns :/, /Work units.*DAG depth/, /Tier1 nodes.*Tier2 nodes/, /Planned writes/]) {
    if (!pattern.test(plan)) throw new Error(`execution-plan.md missing pattern: ${pattern}`);
  }

  const branchPacket = withPatch(validPacket, (packet) => {
    const root = unit("inspect", [], [], ["README.md"]);
    root.kind = "inspect";
    const finalReview = unit("final-review", ["docs-a", "docs-b"], [], ["docs/a.md", "docs/b.md"]);
    finalReview.kind = "final-review";
    finalReview.tier.preferred = "tier1";
    finalReview.tier.reason = "tier1 control-plane node";
    packet.workUnits = [
      root,
      unit("docs-a", ["inspect"], ["docs/a.md"], []),
      unit("docs-b", ["inspect"], ["docs/b.md"], []),
      finalReview,
    ];
    packet.estimates.criticalPath = ["inspect", "docs-a", "final-review"];
    packet.estimates.parallelGroups = [["inspect"], ["docs-a", "docs-b"], ["final-review"]];
  });
  const branchFlow = executionFlow(branchPacket);
  if (!/\[docs-a\] docs.*\[docs-b\] docs/.test(branchFlow) || connectorBarCount(branchFlow) < 2) throw new Error("ASCII DAG does not show fork and true join shape");

  const subsetPacket = withPatch(validPacket, (packet) => {
    packet.workUnits = [
      unit("docs-a", [], ["docs/a.md"], []),
      unit("docs-b", [], ["docs/b.md"], []),
      unit("docs-a-review", ["docs-a"], [], ["docs/a.md"]),
    ];
    packet.estimates.criticalPath = ["docs-a", "docs-a-review"];
    packet.estimates.parallelGroups = [["docs-a", "docs-b"], ["docs-a-review"]];
  });
  const subsetFlow = executionFlow(subsetPacket);
  if (connectorBarCount(subsetFlow) !== 0) throw new Error("ASCII DAG implies a false join for subset dependency");

  const pairwisePacket = withPatch(validPacket, (packet) => {
    packet.workUnits = [
      unit("docs-a", [], ["docs/a.md"], []),
      unit("docs-b", [], ["docs/b.md"], []),
      unit("docs-a-review", ["docs-a"], [], ["docs/a.md"]),
      unit("docs-b-review", ["docs-b"], [], ["docs/b.md"]),
    ];
    packet.estimates.criticalPath = ["docs-a", "docs-a-review"];
    packet.estimates.parallelGroups = [["docs-a", "docs-b"], ["docs-a-review", "docs-b-review"]];
  });
  const pairwiseFlow = executionFlow(pairwisePacket);
  if (connectorBarCount(pairwiseFlow) !== 0) throw new Error("ASCII DAG implies a false fork for pairwise lanes");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const artifactBase = mkdtempSync(join(tmpdir(), "fanout-packet-artifacts-"));
const cliEnv = { FANOUT_ARTIFACT_DIR: artifactBase };
try {
  const runDir = runCli(["--print-run-dir", `smoke-fanout-packet-${process.pid}`], 0, "print run dir", { env: cliEnv }).stdout.trim();
  const activePath = runCli(["--print-active-path"], 0, "print active path", { env: cliEnv }).stdout.trim();
  runCli([validPacketAbs, "--out", runDir, "--active", activePath], 0, "positive CLI artifact write", { env: cliEnv });
  for (const name of ["execution-packet.json", "execution-plan.md", "execution-dag.mmd"]) {
    if (!existsSync(join(runDir, name))) throw new Error(`CLI artifact not written: ${name}`);
  }
  if (!existsSync(activePath)) throw new Error("CLI active pointer not written");

  const outsideDir = mkdtempSync(join(tmpdir(), "fanout-packet-outside-"));
  try {
    runCli([validPacketAbs, "--out", join(outsideDir, "outside-run")], 1, "outside --out rejection", { env: cliEnv });
    runCli([validPacketAbs, "--out", runDir, "--active", join(outsideDir, "active-packet.json")], 1, "outside --active rejection", { env: cliEnv });
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
} finally {
  rmSync(artifactBase, { recursive: true, force: true });
}

const cliCwd = mkdtempSync(join(tmpdir(), "fanout-packet-cli-"));
try {
  const env = { FANOUT_ARTIFACT_DIR: join(cliCwd, "fanout-store") };
  const runDir = runCli(["--print-run-dir", "documented-run"], 0, "documented run dir", { cwd: cliCwd, env }).stdout.trim();
  const activePath = runCli(["--print-active-path"], 0, "documented active path", { cwd: cliCwd, env }).stdout.trim();
  runCli([validPacketAbs, "--out", runDir, "--active", activePath], 0, "documented positive CLI --active", { cwd: cliCwd, env });
  if (!existsSync(activePath)) throw new Error("documented CLI active pointer was not written");
} finally {
  rmSync(cliCwd, { recursive: true, force: true });
}

const symlinkOutCwd = mkdtempSync(join(tmpdir(), "fanout-packet-symlink-out-"));
const symlinkOutTarget = mkdtempSync(join(tmpdir(), "fanout-packet-symlink-target-"));
try {
  const env = { FANOUT_ARTIFACT_DIR: join(symlinkOutCwd, "artifacts") };
  const root = runCli(["--print-run-dir", "placeholder"], 0, "init symlink out root", { cwd: symlinkOutCwd, env }).stdout.trim().replace(/\/placeholder$/, "");
  symlinkSync(symlinkOutTarget, join(root, "link-run"), "dir");
  runCli([validPacketAbs, "--out", join(root, "link-run")], 1, "symlink --out rejection", { cwd: symlinkOutCwd, env });
  if (existsSync(join(symlinkOutTarget, "execution-packet.json"))) throw new Error("symlink --out wrote outside artifact root");
} finally {
  rmSync(symlinkOutCwd, { recursive: true, force: true });
  rmSync(symlinkOutTarget, { recursive: true, force: true });
}

const symlinkActiveCwd = mkdtempSync(join(tmpdir(), "fanout-packet-symlink-active-"));
const symlinkActiveTarget = mkdtempSync(join(tmpdir(), "fanout-packet-active-target-"));
try {
  const env = { FANOUT_ARTIFACT_DIR: join(symlinkActiveCwd, "artifacts") };
  const runDir = runCli(["--print-run-dir", "run"], 0, "active symlink run dir", { cwd: symlinkActiveCwd, env }).stdout.trim();
  const activePath = runCli(["--print-active-path"], 0, "active symlink active path", { cwd: symlinkActiveCwd, env }).stdout.trim();
  mkdirSync(join(activePath, ".."), { recursive: true });
  symlinkSync(join(symlinkActiveTarget, "active-packet.json"), activePath);
  runCli([validPacketAbs, "--out", runDir, "--active", activePath], 1, "symlink --active rejection", { cwd: symlinkActiveCwd, env });
  if (existsSync(join(symlinkActiveTarget, "active-packet.json"))) throw new Error("symlink --active wrote outside artifact root");
} finally {
  rmSync(symlinkActiveCwd, { recursive: true, force: true });
  rmSync(symlinkActiveTarget, { recursive: true, force: true });
}

const symlinkRunsCwd = mkdtempSync(join(tmpdir(), "fanout-packet-symlink-runs-"));
const symlinkRunsTarget = mkdtempSync(join(tmpdir(), "fanout-packet-runs-target-"));
const externalArtifactBase = mkdtempSync(join(tmpdir(), "fanout-packet-external-artifacts-"));
try {
  symlinkSync(symlinkRunsTarget, join(symlinkRunsCwd, "runs"), "dir");
  runCli(["--print-run-dir", "external-run"], 0, "external artifact root ignores unrelated symlink runs", { cwd: symlinkRunsCwd, env: { FANOUT_ARTIFACT_DIR: externalArtifactBase } });
  const env = { FANOUT_ARTIFACT_DIR: join(symlinkRunsCwd, "runs", "fanout") };
  runCli(["--print-run-dir", "run"], 1, "symlink runs parent rejection", { cwd: symlinkRunsCwd, env });
  if (existsSync(join(symlinkRunsTarget, "fanout", "run", "execution-packet.json"))) throw new Error("symlink runs parent wrote packet outside artifact root");
} finally {
  rmSync(symlinkRunsCwd, { recursive: true, force: true });
  rmSync(symlinkRunsTarget, { recursive: true, force: true });
  rmSync(externalArtifactBase, { recursive: true, force: true });
}

console.log("fanout packet smoke passed");

function executionFlow(packet) {
  return renderExecutionPlanMarkdown(packet).match(/## Execution flow[\s\S]*?## Files/)?.[0] ?? "";
}

function connectorBarCount(flow) {
  return flow.split("\n").filter((line) => /^\s+\+[-+]+\s*$/.test(line)).length;
}

function unit(id, dependencies, ownedFiles, readOnlyFiles) {
  return {
    id,
    kind: "docs",
    goal: id,
    dependencies,
    ownedFiles,
    readOnlyFiles,
    steps: [`Plan ${id}.`],
    validationCommands: ["rtk npm run smoke:fanout-packet"],
    acceptanceCriteria: [`${id} is accepted.`],
    rollbackNotes: [`Revert ${id}.`],
    tier: {
      preferred: "tier2",
      assigned: "tier1",
      fallback: "tier1",
      provider: "current",
      model: "current-session-model",
      thinking: "auto",
      reason: "tier2 unavailable; realtime fallback",
    },
    workerPacket: {
      sourcePlanIds: [id],
      targetAnchors: ownedFiles.map((file) => `${file}: test anchor`),
      requiredChanges: [`Plan ${id}.`],
      contractInputs: [`${id} contract`],
      readDependencies: readOnlyFiles,
      forbiddenChanges: [],
      handoffContext: [],
    },
  };
}

function expectInvalid(name, packet, expectedCodes) {
  const result = validateExecutionPacket(packet);
  if (result.ok || result.executable) fail(`${name}: expected invalid packet`, result);
  assertCodes(name, result, expectedCodes);
}

function assertCodes(name, result, expectedCodes) {
  const codes = new Set(result.errors.map((issue) => issue.code));
  for (const code of expectedCodes) if (!codes.has(code)) fail(`${name}: missing error ${code}`, result);
}

function withPatch(packet, patch) {
  const copy = structuredClone(packet);
  patch(copy);
  return copy;
}

function runCli(args, expectedStatus, name, options = {}) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cliScriptAbs, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    throw new Error(`${name}: expected status ${expectedStatus}, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function fail(message, result) {
  throw new Error(`${message}\n${JSON.stringify(result, null, 2)}`);
}
