import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  parseValidationCommand,
  parseValidationCommands,
} from "../packages/fanout-core/src/validation-command.ts";
import {
  preflightValidationCommands,
  runValidationCommands,
} from "../packages/fanout-pi/src/validation-runner.ts";

const root = mkdtempSync(join(tmpdir(), "fanout-validation-"));

try {
  runAdmissionChecks();
  await runA6();
  await runEnvironmentAndCwdChecks();
  await runPreflightChecks();
  await runOutcomeChecks();
  console.log("validation runner smoke passed (A6)");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function runAdmissionChecks() {
  const valid = parseValidationCommand({
    executable: "/a path/tool",
    args: ["", "a value", "*.ts"],
    cwd: "packages/fanout-core",
    env: { EMPTY: "", LITERAL: "$HOME" },
  });
  assert(valid.args[0] === "" && valid.env.LITERAL === "$HOME", "valid command was normalized");
  const prototypeName = parseValidationCommand({ executable: "node", args: [], env: JSON.parse('{"__proto__":"literal"}') });
  assert(Object.hasOwn(prototypeName.env, "__proto__") && prototypeName.env.__proto__ === "literal", "portable environment name changed object shape");
  parseValidationCommand({ executable: "bash", args: ["-c", "printf explicit"] });
  parseValidationCommand({ executable: "cmd.exe", args: ["/c", "echo explicit"] }, "win32");

  for (const value of [
    null,
    [],
    {},
    { executable: "node", args: [], extra: true },
    { executable: "", args: [] },
    { executable: " node", args: [] },
    { executable: "node ", args: [] },
    { executable: "no\u0000de", args: [] },
    { executable: "node", args: "-v" },
    { executable: "node", args: [1] },
    { executable: "node", args: ["line\nfeed"] },
    { executable: "node", args: [], cwd: "../escape" },
    { executable: "node", args: [], cwd: 1 },
    { executable: "node", args: [], env: [] },
    { executable: "node", args: [], env: { "BAD-NAME": "1" } },
    { executable: "node", args: [], env: { OK: 1 } },
    { executable: "node", args: [], env: { OK: "line\nfeed" } },
  ]) expectThrows(() => parseValidationCommand(value), `admitted malformed command ${JSON.stringify(value)}`);

  expectThrows(
    () => parseValidationCommand({ executable: "node", args: [], env: { Path: "a", PATH: "b" } }, "win32"),
    "admitted Windows environment collision",
  );
  const duplicate = { executable: "node", args: ["-v"] };
  const admitted = parseValidationCommands([duplicate, duplicate]);
  assert(admitted.length === 2, "command list was deduplicated");
}

async function runA6() {
  const literalArgs = ["a value with spaces", "", "'quoted'", "$(touch nope)", "*.ts", "a|b", ">file", "$HOME", "; echo nope"];
  const result = await runValidationCommands([
    {
      executable: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...literalArgs],
      env: { SHELL: "/definitely/not/the/caller-shell" },
    },
  ], options("a6"));
  assert(result.status === "passed", JSON.stringify(result));
  assert(JSON.stringify(JSON.parse(result.commands[0].stdout)) === JSON.stringify(literalArgs), `argv changed: ${result.commands[0].stdout}`);
  assert(!existsSync(join(root, "nope")), "shell-looking argv was executed");
}

async function runEnvironmentAndCwdChecks() {
  const nested = join(root, "nested");
  mkdirSync(nested);
  const environment = await runValidationCommands([
    {
      executable: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({ inherited: process.env.INHERITED, literal: process.env.LITERAL, audit: process.env.AUDIT }))"],
      env: { LITERAL: "$INHERITED", AUDIT: "packet" },
    },
  ], {
    ...options("env"),
    inheritedEnv: { PATH: process.env.PATH, INHERITED: "host" },
    controllerEnv: { AUDIT: "controller" },
  });
  assert(environment.commands[0].stdout === JSON.stringify({ inherited: "host", literal: "$INHERITED", audit: "controller" }), "environment precedence or interpolation changed");

  const cwd = await runValidationCommands([
    { executable: process.execPath, args: ["-e", "process.stdout.write(process.cwd())"], cwd: "nested" },
  ], options("cwd"));
  assert(cwd.commands[0].stdout === realpathSync(nested), `wrong cwd: ${cwd.commands[0].stdout}`);

  writeFileSync(join(root, "not-directory"), "x");
  expectThrows(() => preflightValidationCommands([{ executable: process.execPath, args: [], cwd: "missing" }], options("missing-cwd")), "missing cwd passed");
  expectThrows(() => preflightValidationCommands([{ executable: process.execPath, args: [], cwd: "not-directory" }], options("file-cwd")), "file cwd passed");

  const outside = mkdtempSync(join(tmpdir(), "fanout-validation-outside-"));
  try {
    symlinkSync(outside, join(root, "outside-link"));
    expectThrows(() => preflightValidationCommands([{ executable: process.execPath, args: [], cwd: "outside-link" }], options("symlink-cwd")), "symlink cwd escaped checkout");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
}

async function runPreflightChecks() {
  const marker = join(root, "preflight-marker");
  const commands = [
    nodeCommand(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`),
    { executable: "fanout-definitely-missing", args: [] },
  ];
  expectThrows(() => preflightValidationCommands(commands, options("preflight")), "missing executable passed preflight");
  assert(!existsSync(marker), "preflight ran an earlier command before rejecting the list");
  expectThrows(
    () => preflightValidationCommands([nodeCommand("")], { ...options("platform"), expectedPlatform: process.platform === "win32" ? "darwin" : "win32" }),
    "platform mismatch passed preflight",
  );

  const bare = await runValidationCommands([
    { executable: "node", args: ["-e", "process.stdout.write('bare')"] },
  ], { ...options("bare"), inheritedEnv: { PATH: dirname(process.execPath) } });
  assert(bare.commands[0].stdout === "bare", "bare executable did not use effective PATH");

  const relativeDir = join(root, "relative");
  mkdirSync(relativeDir);
  symlinkSync(process.execPath, join(relativeDir, "node-link"));
  const relative = await runValidationCommands([
    { executable: "./node-link", args: ["-e", "process.stdout.write('relative')"], cwd: "relative" },
  ], options("relative"));
  assert(relative.commands[0].stdout === "relative", "relative executable did not resolve from effective cwd");

  if (process.platform !== "win32") {
    const nonExecutable = join(root, "non-executable");
    writeFileSync(nonExecutable, "#!/bin/sh\nexit 0\n");
    chmodSync(nonExecutable, 0o644);
    expectThrows(() => preflightValidationCommands([{ executable: nonExecutable, args: [] }], options("non-executable")), "non-executable file passed preflight");
  }
}

async function runOutcomeChecks() {
  const orderPath = join(root, "order.txt");
  const append = (value) => nodeCommand(`require("node:fs").appendFileSync(${JSON.stringify(orderPath)}, ${JSON.stringify(value)})`);
  const duplicate = append("x");
  const ordered = await runValidationCommands([append("a"), duplicate, duplicate], options("ordered"));
  assert(ordered.status === "passed" && ordered.executedCount === 3, JSON.stringify(ordered));
  assert((await import("node:fs")).readFileSync(orderPath, "utf8") === "axx", "order or duplicates changed");
  assert(ordered.commands.map((command) => command.id).join(",") === "ordered/0,ordered/1,ordered/2", "command ids are not positional");

  rmSync(orderPath, { force: true });
  const continued = await runValidationCommands([
    nodeCommand(`require("node:fs").appendFileSync(${JSON.stringify(orderPath)}, "a"); process.exit(7)`),
    append("b"),
  ], { ...options("continue-nonzero"), continueAfterNonzero: true });
  assert(continued.status === "failed" && continued.executedCount === 2 && continued.commands[0].outcome === "nonzero" && continued.commands[1].outcome === "passed", JSON.stringify(continued));
  assert((await import("node:fs")).readFileSync(orderPath, "utf8") === "ab", "continue-after-nonzero skipped or repeated a command");

  const splitUtf8 = await runValidationCommands([
    nodeCommand("process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x82, 0xac])), 20)"),
  ], options("utf8"));
  assert(splitUtf8.commands[0].stdout === "€", `split UTF-8 output was corrupted: ${JSON.stringify(splitUtf8.commands[0].stdout)}`);

  const laterMarker = join(root, "later-marker");
  const failureCases = [
    ["nonzero", nodeCommand("process.exit(7)"), "nonzero"],
    ["signal", nodeCommand('process.kill(process.pid, "SIGTERM")'), "signal"],
    ["timeout", nodeCommand("setInterval(() => {}, 1000)"), "timeout", 40],
  ];
  for (const [scopeId, first, outcome, timeoutMs = 2_000] of failureCases) {
    rmSync(laterMarker, { force: true });
    const result = await runValidationCommands([first, nodeCommand(`require("node:fs").writeFileSync(${JSON.stringify(laterMarker)}, "ran")`)], { ...options(scopeId), timeoutMs });
    assert(result.status === "failed" && result.commands[0].outcome === outcome, JSON.stringify(result));
    assert(result.commands[1].outcome === "unexecuted" && !existsSync(laterMarker), `${scopeId} ran a later command`);
  }

  if (process.platform !== "win32") {
    const descendantMarker = join(root, "descendant-marker");
    const descendant = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(descendantMarker)}, "survived"), 400)`;
    const parent = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" }); setInterval(() => {}, 1000)`;
    const timedOutTree = await runValidationCommands([nodeCommand(parent)], { ...options("timeout-tree"), timeoutMs: 40 });
    assert(timedOutTree.commands[0].outcome === "timeout", JSON.stringify(timedOutTree));
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert(!existsSync(descendantMarker), "timeout left a descendant process running");
  }

  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 40);
  const aborted = await runValidationCommands([nodeCommand("setInterval(() => {}, 1000)"), nodeCommand("")], { ...options("abort"), timeoutMs: 2_000, signal: abortController.signal });
  assert(aborted.commands[0].outcome === "aborted" && aborted.commands[1].outcome === "unexecuted", JSON.stringify(aborted));

  const disappearing = join(root, "disappearing-node");
  symlinkSync(process.execPath, disappearing);
  const rechecked = await runValidationCommands([
    nodeCommand(`require("node:fs").unlinkSync(${JSON.stringify(disappearing)})`),
    { executable: disappearing, args: ["-e", "process.exit(0)"] },
    nodeCommand("")
  ], options("recheck"));
  assert(rechecked.commands[1].outcome === "spawn" && rechecked.commands[2].outcome === "unexecuted", JSON.stringify(rechecked));

  const firstCwd = join(root, "first-cwd");
  const nextCwd = join(root, "next-cwd");
  const cwdLink = join(root, "cwd-link");
  mkdirSync(firstCwd); mkdirSync(nextCwd);
  symlinkSync(firstCwd, cwdLink);
  const cwdRechecked = await runValidationCommands([
    nodeCommand(`const fs=require('node:fs');fs.unlinkSync(${JSON.stringify(cwdLink)});fs.symlinkSync(${JSON.stringify(nextCwd)},${JSON.stringify(cwdLink)})`),
    { ...nodeCommand("process.stdout.write(process.cwd())"), cwd: "cwd-link" },
  ], options("cwd-recheck"));
  assert(cwdRechecked.status === "passed" && cwdRechecked.commands[1].stdout === realpathSync(nextCwd), "immediate pre-launch resolution reused a replaced cwd symlink");
}

function nodeCommand(source) {
  return { executable: process.execPath, args: ["-e", source] };
}

function options(scopeId) {
  return { checkoutRoot: root, expectedPlatform: process.platform, scopeId, timeoutMs: 2_000 };
}

function expectThrows(fn, message) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
