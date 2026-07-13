import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFinalValidationFailure, deriveFinalRepairWorkContract, FINAL_VALIDATION_TRUST_BOUNDARY } from "../packages/fanout-core/src/final-validation.ts";
import { FIXED_WORKER_CAPABILITIES, WORK_CONTRACT_SCHEMA, WORK_CONTRACT_VERSION } from "../packages/fanout-core/src/work-contract.ts";
import { checkContractOwnership, checkFinalRepairOwnership } from "../packages/fanout-pi/src/fanout-git.ts";
import { runFinalValidationRound } from "../packages/fanout-pi/src/final-validation.ts";
import {
  applyAcceptedTransition,
  capturePatchCandidate,
  capturePlanningBase,
  createReconstructedWorktree,
  fullGitVisibleTree,
  removeReconstructedWorktree,
} from "../packages/fanout-pi/src/repository-identity.ts";

const root = mkdtempSync(join(tmpdir(), "fanout-final-validation-"));
const repo = join(root, "repo");
const runDir = join(root, "run");

try {
  git(root, ["init", "repo"]);
  git(repo, ["config", "user.email", "fanout@example.test"]);
  git(repo, ["config", "user.name", "Fanout Test"]);
  writeFileSync(join(repo, ".gitignore"), ".repair-cache\n.validation-cache\n");
  writeFileSync(join(repo, "source.txt"), "base\n");
  writeFileSync(join(repo, "other.txt"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "fixture"]);

  const planningBase = capturePlanningBase(repo);
  const accepted = makeCandidate("accepted", [], (worktree) => writeFileSync(join(worktree, "source.txt"), "accepted\n"));
  applyAcceptedTransition(repo, runDir, accepted);
  const acceptedTree = accepted.patch.resultTree;
  assert(fullGitVisibleTree(repo) === acceptedTree, "accepted fixture transition did not reach active");

  const restored = await round("restored", [node("writeFileSync('transient.txt','x')"), node("rmSync('transient.txt')")]);
  assert(restored.status === "passed", "sequence-boundary validation rejected restored intermediate mutation");
  assert(!existsSync(join(repo, "transient.txt")), "final validation ran in the active checkout");

  const mutation = await round("persistent-mutation", [node("writeFileSync('residue.txt','x')")]);
  assert(mutation.status === "failed" && mutation.evidence.failure?.kind === "hard" && mutation.evidence.failure.code === "validation-drift", "A16 persistent validation mutation did not hard-fail");
  assert(fullGitVisibleTree(repo) === acceptedTree && !existsSync(join(repo, "residue.txt")), "A16 validation mutation reached active");

  const activeDrift = await round("active-drift", [node(`writeFileSync(${JSON.stringify(join(repo, "active-drift.txt"))},'x')`)]);
  assert(activeDrift.status === "failed" && activeDrift.evidence.failure?.kind === "hard" && activeDrift.evidence.failure.code === "active-drift", "A16 active drift did not hard-fail");
  assert(existsSync(join(repo, "active-drift.txt")), "A16 active drift was reset instead of preserved");
  rmSync(join(repo, "active-drift.txt"));
  assert(fullGitVisibleTree(repo) === acceptedTree, "active fixture did not return to the accepted tree after inspection");

  const stagedDrift = await round("staged-active-drift", [node(`const { spawnSync }=await import('node:child_process');writeFileSync(${JSON.stringify(join(repo, "source.txt"))},'staged\\n');spawnSync('git',['add','source.txt'],{cwd:${JSON.stringify(repo)}});writeFileSync(${JSON.stringify(join(repo, "source.txt"))},'accepted\\n')`)]);
  assert(stagedDrift.status === "failed" && stagedDrift.evidence.failure?.kind === "hard" && stagedDrift.evidence.failure.code === "active-drift", "A16 staged active drift with the same visible tree was admitted");
  assert(git(repo, ["diff", "--cached", "--name-only"]) === "source.txt", "A16 staged active drift was reset");
  git(repo, ["reset", "HEAD", "--", "source.txt"]);

  const external = join(root, "external-side-effect.txt");
  const outsideContainment = await round("outside-containment", [node(`writeFileSync('.validation-cache','ignored');writeFileSync(${JSON.stringify(external)},'external')`)]);
  assert(outsideContainment.status === "passed" && existsSync(external), "A20 ignored/external effects were falsely treated as contained");
  for (const phrase of ["ignored files", "external paths", "network", "processes", "outside containment"]) assert(FINAL_VALIDATION_TRUST_BOUNDARY.includes(phrase), `A20 trust boundary omitted ${phrase}`);

  const finalContract = contract([], [], [node("process.exit(0)")]);
  const repairContract = deriveFinalRepairWorkContract([
    contract([modify("source.txt")], [forbidden("forbidden.txt")], [node("process.exit(0)")]),
    contract([modify("other.txt")], [], [node("process.exit(0)")]),
  ], finalContract);
  const coordinated = makeCandidate("coordinated", [accepted], (worktree) => {
    writeFileSync(join(worktree, "source.txt"), "coordinated\n");
    writeFileSync(join(worktree, "other.txt"), "coordinated\n");
  });
  const coordinatedDir = join(runDir, "coordinated-authority");
  mkdirSync(coordinatedDir, { recursive: true });
  assert(checkFinalRepairOwnership(repairContract, coordinated.patch, coordinatedDir).ok, "A17 derived authority did not union approved upstream endpoints");
  const widened = makeCandidate("widened", [accepted], (worktree) => writeFileSync(join(worktree, "widened.txt"), "not authorized\n"));
  const authorityDir = join(runDir, "authority");
  mkdirSync(authorityDir, { recursive: true });
  const authority = checkContractOwnership(repairContract, widened.patch, authorityDir, repo);
  assert(!authority.ok && authority.violations.some((violation) => violation.file === "widened.txt"), "A17 widened final-repair authority was admitted");

  const ignoredResidue = makeCandidate("ignored-residue", [accepted], (worktree) => {
    writeFileSync(join(worktree, "source.txt"), "repaired\n");
    writeFileSync(join(worktree, ".repair-cache"), "worker-only\n");
  });
  const residueRound = await runFinalValidationRound({
    repoRoot: repo,
    runDir,
    roundId: "ignored-repair-residue",
    planningBase,
    ledger: [accepted],
    candidate: ignoredResidue,
    commands: [node("if(!existsSync('.repair-cache')) process.exit(7)", "existsSync")],
    expectedValidationTree: ignoredResidue.patch.resultTree,
    expectedActiveTree: acceptedTree,
  });
  assert(residueRound.status === "failed" && residueRound.repairable && readFileSync(join(repo, "source.txt"), "utf8") === "accepted\n", "A17 ignored repair residue made a candidate acceptable or mutated active");
  assert(fullGitVisibleTree(repo) === acceptedTree, "rejected A17 repair candidate changed active state");

  for (const outcome of ["nonzero", "timeout", "signal"]) assert(classifyFinalValidationFailure([commandEvidence(outcome)], true, true)?.kind === "program", `${outcome} was not final-repair eligible`);
  for (const outcome of ["spawn", "aborted"]) assert(classifyFinalValidationFailure([commandEvidence(outcome)], true, true)?.kind === "hard", `${outcome} incorrectly consumed final-repair authority`);

  const acceptedPatchPath = join(runDir, accepted.patch.artifact.path);
  const acceptedPatchBytes = readFileSync(acceptedPatchPath);
  writeFileSync(acceptedPatchPath, "corrupt");
  let replayFailed = false;
  try {
    await round("replay-failure-cleanup", [node("process.exit(0)")]);
  } catch {
    replayFailed = true;
  } finally {
    writeFileSync(acceptedPatchPath, acceptedPatchBytes);
  }
  assert(replayFailed && !existsSync(join(runDir, "final-validation", "rounds", "replay-failure-cleanup", "worktree")), "failed reconstruction left disposable worktree residue");
  assert(!git(repo, ["worktree", "list", "--porcelain"]).includes("replay-failure-cleanup"), "failed reconstruction remained registered");

  console.log("final validation smoke passed (A16, A17, A20)");

  async function round(roundId, commands) {
    return await runFinalValidationRound({ repoRoot: repo, runDir, roundId, planningBase, ledger: [accepted], commands, expectedValidationTree: acceptedTree, expectedActiveTree: acceptedTree });
  }

  function makeCandidate(name, ledger, edit) {
    const worktree = join(root, `candidate-${name}`);
    const base = createReconstructedWorktree(repo, worktree, planningBase, runDir, ledger);
    try {
      edit(worktree);
      return { patch: capturePatchCandidate(worktree, base, runDir, `patches/${name}.bin`) };
    } finally {
      removeReconstructedWorktree(repo, worktree);
    }
  }
} finally {
  cleanupWorktrees(repo);
  rmSync(root, { recursive: true, force: true });
}

function node(source, imports = "writeFileSync,rmSync") {
  return { executable: process.execPath, args: ["--input-type=module", "-e", `import { ${imports} } from 'node:fs';${source}`] };
}

function contract(changes, forbiddenWrites, validationCommands) {
  return {
    schema: WORK_CONTRACT_SCHEMA,
    version: WORK_CONTRACT_VERSION,
    goals: [{ sourcePlanId: "plan", statement: "Repair the accepted implementation" }],
    changes,
    readDependencies: [],
    forbiddenWrites,
    validationCommands,
    capabilities: FIXED_WORKER_CAPABILITIES,
    semanticReviewCriteria: [{ sourcePlanId: "plan", statement: "The final checks pass" }],
    advisoryNotes: [],
  };
}

function modify(path) {
  return { kind: "modify", target: { resource: { kind: "file", path }, sourcePlanIds: ["plan"] }, intent: "Repair the approved file", anchors: [{ kind: "stable-text", text: "base" }] };
}

function forbidden(path) {
  return { resource: { kind: "file", path }, sourcePlanIds: ["plan"], reason: "Explicitly outside scope" };
}

function commandEvidence(outcome) {
  return { id: "final-validation/0", index: 0, command: node("process.exit(1)"), outcome, exitCode: outcome === "nonzero" ? 1 : null, signal: outcome === "signal" ? "SIGTERM" : null, stdout: "", stderr: "", durationMs: 1 };
}

function git(cwd, args) {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function cleanupWorktrees(repoRoot) {
  if (!existsSync(repoRoot)) return;
  spawnSync("git", ["worktree", "prune"], { cwd: repoRoot, encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
