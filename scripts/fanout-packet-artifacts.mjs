#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  formatPacketValidationResult,
  readExecutionPacket,
  validateExecutionPacket,
  writeExecutionPacketArtifacts,
} from "../packages/fanout-core/src/execution-packet.ts";

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  usage();
  process.exit(2);
}

try {
  const root = artifactProjectRoot(process.cwd());

  if (parsed.printRunDir) {
    console.log(validateOutDir(join(root, parsed.printRunDir), root));
    process.exit(0);
  }
  if (parsed.printActivePath) {
    console.log(validateActivePointerPath(join(root, "active-packet.json"), root));
    process.exit(0);
  }

  if (!parsed.packetArg) {
    usage();
    process.exit(2);
  }

  const outDir = validateOutDir(parsed.outDir ?? dirname(resolve(parsed.packetArg)), root);
  const activePointerPath = parsed.activePointerPath ? validateActivePointerPath(parsed.activePointerPath, root) : undefined;
  const packet = readExecutionPacket(parsed.packetArg);
  const validation = validateExecutionPacket(packet);
  process.stdout.write(formatPacketValidationResult(validation));
  if (!validation.ok) process.exit(1);

  const paths = writeExecutionPacketArtifacts(packet, outDir, { activePointerPath });
  console.log(`wrote ${paths.packetPath}`);
  console.log(`wrote ${paths.planPath}`);
  console.log(`wrote ${paths.dagPath}`);
  if (paths.activePointerPath) console.log(`wrote ${paths.activePointerPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function artifactProjectRoot(cwd) {
  const base = resolve(process.env.FANOUT_ARTIFACT_DIR || join(homedir(), ".pi", "agent", "fanout"));
  const projectId = `${basename(cwd)}-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}`;
  const root = resolve(base, projectId);
  rejectSymlinkPathInsideCwd(root, cwd);
  mkdirSync(root, { recursive: true });
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`${root} must not be a symlink`);
  if (!stat.isDirectory()) throw new Error(`${root} must be a directory`);
  return root;
}

function validateOutDir(value, root) {
  const realRoot = realpathSync(root);
  const outDir = resolve(value);
  if (dirname(outDir) !== root) throw new Error(`--out must be a run directory under ${root}`);
  const stat = lstatIfExists(outDir);
  if (stat) {
    if (stat.isSymbolicLink()) throw new Error("--out must not be a symlink");
    if (!stat.isDirectory()) throw new Error("--out must be a directory");
    if (dirname(realpathSync(outDir)) !== realRoot) throw new Error(`--out must stay under ${root}`);
  }
  return outDir;
}

function validateActivePointerPath(value, root) {
  const expected = resolve(root, "active-packet.json");
  const actual = resolve(value);
  if (actual !== expected) throw new Error(`--active must be ${expected}`);
  const stat = lstatIfExists(actual);
  if (stat) {
    if (stat.isSymbolicLink()) throw new Error("--active must not be a symlink");
    if (!stat.isFile()) throw new Error("--active must be a file path");
  }
  return actual;
}

function rejectSymlinkPathInsideCwd(target, cwd) {
  const root = resolve(cwd);
  const absolute = resolve(target);
  const comparableRoot = comparablePath(root);
  const comparableAbsolute = comparablePath(absolute);
  if (comparableAbsolute !== comparableRoot && !comparableAbsolute.startsWith(`${comparableRoot}${sep}`)) return;
  const relativeParts = comparableAbsolute.slice(comparableRoot.length).split(sep).filter(Boolean);
  let cursor = root;
  for (const part of relativeParts) {
    cursor = join(cursor, part);
    const stat = lstatIfExists(cursor);
    if (stat?.isSymbolicLink()) throw new Error(`${cursor} must not be a symlink`);
  }
}

function comparablePath(path) {
  return path === "/private/var" || path.startsWith("/private/var/") ? path.slice("/private".length) : path;
}

function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function parseArgs(args) {
  const parsed = { packetArg: undefined, outDir: undefined, activePointerPath: undefined, printRunDir: undefined, printActivePath: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--out") {
      parsed.outDir = readValue(args, ++index, arg);
    } else if (arg === "--active") {
      parsed.activePointerPath = readValue(args, ++index, arg);
    } else if (arg === "--print-run-dir") {
      parsed.printRunDir = readValue(args, ++index, arg);
    } else if (arg === "--print-active-path") {
      parsed.printActivePath = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag: ${arg}`);
    } else if (!parsed.packetArg) {
      parsed.packetArg = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

function readValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function usage() {
  console.error("usage: node scripts/fanout-packet-artifacts.mjs <execution-packet.json> [--out <dir>] [--active <active-packet.json>]");
  console.error("       node scripts/fanout-packet-artifacts.mjs --print-run-dir <run-id>");
  console.error("       node scripts/fanout-packet-artifacts.mjs --print-active-path");
}
