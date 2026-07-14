import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactIdentity } from "../packages/fanout-core/src/artifact-identity.ts";
import { classifyFinalValidationFailure, deriveFinalRepairWorkContract, FINAL_VALIDATION_TRUST_BOUNDARY, parseFinalValidationEvidence } from "../packages/fanout-core/src/final-validation.ts";
import { assertFinalValidationRecoverySource, parseAttemptRecoveryContext } from "../packages/fanout-core/src/recovery-evidence.ts";
import { FIXED_WORKER_CAPABILITIES, WORK_CONTRACT_SCHEMA, WORK_CONTRACT_VERSION } from "../packages/fanout-core/src/work-contract.ts";
import { checkContractOwnership, checkFinalRepairOwnership, ownershipViolationFactCode } from "../packages/fanout-pi/src/fanout-git.ts";
import { recordAcceptedFinalRepair, runFinalValidation, runFinalValidationRound } from "../packages/fanout-pi/src/final-validation.ts";
import { buildCanonicalWorkerPrompt } from "../packages/fanout-pi/src/fanout-worker-contract.ts";
import { parseSharedWorktreePaths, prepareSharedWorktreePaths } from "../packages/fanout-pi/src/worktree-preparation.ts";
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
  writeFileSync(join(repo, ".gitignore"), ".repair-cache\n.validation-cache\n.preinstalled\n");
  writeFileSync(join(repo, "source.txt"), "base\n");
  writeFileSync(join(repo, "other.txt"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "fixture"]);
  mkdirSync(join(repo, ".preinstalled", "dependency"), { recursive: true });
  writeFileSync(join(repo, ".preinstalled", "dependency", "ready"), "ready\n");
  assert(JSON.stringify(parseSharedWorktreePaths('[".preinstalled"]')) === '[".preinstalled"]', "explicit shared-worktree preparation input did not parse");
  assertThrows(() => parseSharedWorktreePaths('["../escape"]'), "shared-worktree preparation admitted a repository escape");

  const planningBase = capturePlanningBase(repo);
  const accepted = makeCandidate("accepted", [], (worktree) => writeFileSync(join(worktree, "source.txt"), "accepted\n"));
  applyAcceptedTransition(repo, runDir, accepted);
  const acceptedTree = accepted.patch.resultTree;
  assert(fullGitVisibleTree(repo) === acceptedTree, "accepted fixture transition did not reach active");

  const restored = await round("restored", [node("writeFileSync('transient.txt','x')"), node("rmSync('transient.txt')")]);
  assert(restored.status === "passed", "sequence-boundary validation rejected restored intermediate mutation");
  assert(!existsSync(join(repo, "transient.txt")), "final validation ran in the active checkout");
  const sharedDependency = await round("shared-dependency", [node("if (readFileSync('.preinstalled/dependency/ready','utf8') !== 'ready\\n') process.exit(1)", "readFileSync")]);
  assert(sharedDependency.status === "passed", "reconstructed validation worktree could not resolve installed ignored dependencies");
  for (const code of ["active-drift", "validation-drift"]) {
    const fabricatedDrift = structuredClone(restored.evidence);
    fabricatedDrift.status = "failed";
    fabricatedDrift.failure = { kind: "hard", code, detail: "fabricated stable-boundary drift" };
    assertThrows(() => parseFinalValidationEvidence(fabricatedDrift), `${code} failure admitted stable expected boundaries and passed commands`);
  }

  const mutation = await round("persistent-mutation", [node("writeFileSync('residue.txt','x')")]);
  assert(mutation.status === "failed" && mutation.evidence.failure?.kind === "hard" && mutation.evidence.failure.code === "validation-drift", "A16 persistent validation mutation did not hard-fail");
  assert(fullGitVisibleTree(repo) === acceptedTree && !existsSync(join(repo, "residue.txt")), "A16 validation mutation reached active");

  const activeDrift = await round("active-drift", [node(`writeFileSync(${JSON.stringify(join(repo, "active-drift.txt"))},'x')`)]);
  assert(activeDrift.status === "failed" && activeDrift.evidence.failure?.kind === "hard" && activeDrift.evidence.failure.code === "active-drift", "A16 active drift did not hard-fail");
  assert(existsSync(join(repo, "active-drift.txt")), "A16 active drift was reset instead of preserved");
  rmSync(join(repo, "active-drift.txt"));
  assert(fullGitVisibleTree(repo) === acceptedTree, "active fixture did not return to the accepted tree after inspection");

  writeFileSync(join(repo, "before-launch-drift.txt"), "drift\n");
  const beforeLaunchDrift = await round("before-launch-drift", [node("process.exit(0)")]);
  assert(beforeLaunchDrift.evidence.failure?.kind === "hard" && beforeLaunchDrift.commands[0].outcome === "unexecuted" && beforeLaunchDrift.commands[0].id === "before-launch-drift/0", "pre-command hard failure did not emit round-bound unexecuted evidence");
  parseFinalValidationEvidence(beforeLaunchDrift.evidence);
  const malformedHardManifest = structuredClone(beforeLaunchDrift.evidence);
  malformedHardManifest.commands.push({ ...malformedHardManifest.commands[0], id: "before-launch-drift/1", index: 1, outcome: "passed", exitCode: 0 });
  assertThrows(() => parseFinalValidationEvidence(malformedHardManifest), "hard final-validation evidence admitted unexecuted commands before executed commands");
  assertThrows(() => parseFinalValidationEvidence({ ...beforeLaunchDrift.evidence, commands: [] }), "final-validation evidence admitted an empty authoritative command manifest");
  rmSync(join(repo, "before-launch-drift.txt"));

  const validationHeadDrift = await round("validation-head-drift", [node("writeFileSync('validation-head.txt','drift\\n');const {spawnSync}=await import('node:child_process');spawnSync('git',['add','validation-head.txt']);spawnSync('git',['-c','user.name=Fanout Test','-c','user.email=fanout@example.test','commit','-m','validation drift'])")]);
  assert(validationHeadDrift.evidence.failure?.kind === "hard" && validationHeadDrift.evidence.validation.after.headCommit !== validationHeadDrift.evidence.validation.before.headCommit, "validation HEAD drift fixture did not produce exact hard-failure evidence");
  parseFinalValidationEvidence(validationHeadDrift.evidence);
  const executedPreflight = structuredClone(validationHeadDrift.evidence);
  executedPreflight.failure = { kind: "hard", code: "preflight", detail: "failed before launch" };
  assertThrows(() => parseFinalValidationEvidence(executedPreflight), "pre-command preflight failure admitted executed command evidence");

  const stagedDrift = await round("staged-active-drift", [node(`const { spawnSync }=await import('node:child_process');writeFileSync(${JSON.stringify(join(repo, "source.txt"))},'staged\\n');spawnSync('git',['add','source.txt'],{cwd:${JSON.stringify(repo)}});writeFileSync(${JSON.stringify(join(repo, "source.txt"))},'accepted\\n')`)]);
  assert(stagedDrift.status === "failed" && stagedDrift.evidence.failure?.kind === "hard" && stagedDrift.evidence.failure.code === "active-drift", "A16 staged active drift with the same visible tree was admitted");
  assert(git(repo, ["diff", "--cached", "--name-only"]) === "source.txt", "A16 staged active drift was reset");
  git(repo, ["reset", "HEAD", "--", "source.txt"]);

  const external = join(root, "external-side-effect.txt");
  const outsideContainment = await round("outside-containment", [node(`writeFileSync('.validation-cache','ignored');writeFileSync(${JSON.stringify(external)},'external')`)]);
  assert(outsideContainment.status === "passed" && existsSync(external), "A20 ignored/external effects were falsely treated as contained");
  for (const phrase of ["ignored files", "external paths", "network", "processes", "outside containment"]) assert(FINAL_VALIDATION_TRUST_BOUNDARY.includes(phrase), `A20 trust boundary omitted ${phrase}`);

  const finalContract = contract([], [], [node("process.exit(7)"), node("process.exit(0)")]);
  const upstreamWorkContracts = [
    { nodeId: "source", workContract: contract([modify("source.txt")], [forbidden("forbidden.txt")], [node("process.exit(0)")]) },
    { nodeId: "other", workContract: contract([modify("other.txt")], [], [node("process.exit(0)")]) },
  ];
  const packetIdentity = artifactIdentity("execution-packet.json", Buffer.from("packet\n"));
  const repairContract = deriveFinalRepairWorkContract(upstreamWorkContracts.map((entry) => entry.workContract), finalContract);
  const repairContext = { packetIdentity, finalValidationContract: finalContract, upstreamWorkContracts };
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
  assert(ownershipViolationFactCode([{ file: "forbidden.txt", code: "forbidden-change", reason: "wording without the policy keyword" }]) === "forbidden-change", "ownership fact routing depended on diagnostic wording");

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

  const passingCandidateRound = await runFinalValidationRound({ repoRoot: repo, runDir, roundId: "passing-candidate", planningBase, ledger: [accepted], candidate: coordinated, commands: [node("process.exit(0)")], expectedValidationTree: coordinated.patch.resultTree, expectedActiveTree: acceptedTree });
  const acceptedEvidence = { ...passingCandidateRound.evidence, acceptedRepair: { transition: coordinated, activeAfterApply: passingCandidateRound.evidence.validation.after } };
  parseFinalValidationEvidence(acceptedEvidence);
  const contradictoryAccepted = structuredClone(acceptedEvidence);
  contradictoryAccepted.acceptedRepair.activeAfterApply.indexTree = coordinated.patch.resultTree;
  assertThrows(() => parseFinalValidationEvidence(contradictoryAccepted), "accepted final repair admitted a contradictory post-apply index/HEAD identity");
  const sameDigestDifferentTransition = { patch: { ...coordinated.patch, baseTree: planningBase.tree } };
  assertThrows(() => recordAcceptedFinalRepair(repo, runDir, passingCandidateRound, sameDigestDifferentTransition), "accepted final-repair producer compared only candidate patch digest instead of the exact transition");

  let repairAvailable = true;
  const rejectedRepair = await runFinalValidation({
    repoRoot: repo,
    runDir,
    planningBase,
    ledger: [accepted],
    commands: repairContract.validationCommands,
    expectedValidationTree: acceptedTree,
    expectedActiveTree: acceptedTree,
    repair: {
      ...repairContext,
      workContract: repairContract,
      acceptedLedger: [{ sourceAttemptId: "node:000001", patch: accepted.patch }],
      available: () => repairAvailable,
      launch: async () => { repairAvailable = false; return { attemptId: "final-validation:000001", candidate: ignoredResidue, continue: true }; },
      transition: (candidate) => candidate,
      authorize: async () => true,
      reject: async () => false,
      apply: async () => false,
    },
  });
  assert(rejectedRepair.status === "failed" && rejectedRepair.commandCount === 2 && rejectedRepair.commands[1].outcome === "unexecuted", "fail-fast final validation did not retain the full launched command manifest");
  assert(rejectedRepair.evidence.expectedValidationTree === acceptedTree && !rejectedRepair.evidence.candidate, "rejected final-repair candidate escaped into accepted-tree completion evidence");

  const promptRecoveries = [];
  let promptLaunches = 0;
  await runFinalValidation({
    repoRoot: repo,
    runDir,
    planningBase,
    ledger: [accepted],
    commands: repairContract.validationCommands,
    expectedValidationTree: acceptedTree,
    expectedActiveTree: acceptedTree,
    repair: {
      ...repairContext,
      workContract: repairContract,
      acceptedLedger: [{ sourceAttemptId: "node:000001", patch: accepted.patch }],
      available: () => promptLaunches < 2,
      launch: async (recovery) => {
        promptRecoveries.push(recovery);
        promptLaunches += 1;
        return promptLaunches === 1
          ? { attemptId: "final-validation:prompt-1", candidate: ignoredResidue, continue: true }
          : { attemptId: "final-validation:prompt-2", continue: false };
      },
      transition: (candidate) => candidate,
      authorize: async () => true,
      reject: async () => true,
      apply: async () => false,
    },
  });
  assert(promptRecoveries.length === 2 && !promptRecoveries[0].failedRound.candidate && promptRecoveries[1].failedRound.candidate?.patch.artifact.sha256 === ignoredResidue.patch.artifact.sha256, "first/subsequent final-repair contexts lost failed-round candidate identity");
  for (const [index, recovery] of promptRecoveries.entries()) {
    const prompt = buildCanonicalWorkerPrompt({ objective: "repair", userContext: [], discoveredRepoFacts: [], assumptions: [] }, { id: "final-validation", kind: "implement", workContract: repairContract }, [], recovery);
    for (const identity of [recovery.failedRound.validation.before.tree, recovery.failedRound.validation.after.tree, recovery.failedRound.active.before.tree, recovery.failedRound.active.after.tree]) assert(prompt.includes(identity), `final-repair prompt ${index + 1} omitted a failed-round repository identity`);
    assert(prompt.includes(packetIdentity.sha256) && prompt.includes('"nodeId": "source"') && prompt.includes('"nodeId": "other"'), `final-repair prompt ${index + 1} omitted packet identity or ordered upstream work contracts`);
    if (index === 1) assert(prompt.includes(ignoredResidue.patch.artifact.sha256), "subsequent final-repair prompt omitted its rejected candidate patch");
    const conflictingContract = structuredClone(repairContract);
    conflictingContract.validationCommands = [node("process.exit(9)")];
    assertThrows(() => buildCanonicalWorkerPrompt({ objective: "repair", userContext: [], discoveredRepoFacts: [], assumptions: [] }, { id: "final-validation", kind: "implement", workContract: conflictingContract }, [], recovery), `final-repair prompt ${index + 1} admitted conflicting node and recovery contracts`);
  }
  const omittedCandidate = structuredClone(promptRecoveries[1]);
  delete omittedCandidate.failedRound.candidate;
  let omittedCandidateRejected = false;
  try { buildCanonicalWorkerPrompt({ objective: "repair", userContext: [], discoveredRepoFacts: [], assumptions: [] }, { id: "final-validation", kind: "implement", workContract: repairContract }, [], omittedCandidate); }
  catch { omittedCandidateRejected = true; }
  assert(omittedCandidateRejected, "subsequent final-repair context admitted an omitted failed candidate");

  const timeoutRecoveries = [];
  let timeoutAvailable = true;
  const timeoutCommands = [node("setTimeout(() => {}, 10_000)")];
  const timeoutFinalContract = { ...finalContract, validationCommands: timeoutCommands };
  const timeoutContract = deriveFinalRepairWorkContract(upstreamWorkContracts.map((entry) => entry.workContract), timeoutFinalContract);
  const timeoutResult = await runFinalValidation({
    repoRoot: repo,
    runDir,
    planningBase,
    ledger: [accepted],
    commands: timeoutCommands,
    expectedValidationTree: acceptedTree,
    expectedActiveTree: acceptedTree,
    timeoutMs: 20,
    repair: {
      ...repairContext,
      finalValidationContract: timeoutFinalContract,
      workContract: timeoutContract,
      acceptedLedger: [{ sourceAttemptId: "node:000001", patch: accepted.patch }],
      available: () => timeoutAvailable,
      launch: async (recovery) => { timeoutRecoveries.push(recovery); timeoutAvailable = false; return { attemptId: "final-validation:timeout", continue: false }; },
      transition: (candidate) => candidate,
      authorize: async () => true,
      reject: async () => false,
      apply: async () => false,
    },
  });
  assert(timeoutResult.repairable && timeoutRecoveries.length === 1 && timeoutRecoveries[0].commands[0].status === "timeout" && timeoutRecoveries[0].commands[0].signal === null, "real final-validation timeout could not produce admitted repair evidence");
  buildCanonicalWorkerPrompt({ objective: "repair timeout", userContext: [], discoveredRepoFacts: [], assumptions: [] }, { id: "final-validation", kind: "implement", workContract: timeoutContract }, [], timeoutRecoveries[0]);
  const timeoutFactMismatch = structuredClone(timeoutRecoveries[0]);
  timeoutFactMismatch.commands[0].timeoutMs += 1;
  assertThrows(() => parseAttemptRecoveryContext(timeoutFactMismatch), "timeout recovery admitted a timeoutMs different from its source-digested failed round");
  const staleRound = structuredClone(promptRecoveries[0]);
  staleRound.failedRound.active.after.tree = planningBase.tree;
  staleRound.sourceFinalValidationEvidence = artifactIdentity(staleRound.sourceFinalValidationEvidence.path, Buffer.from(`${JSON.stringify(staleRound.failedRound, null, 2)}\n`));
  assertThrows(() => parseAttemptRecoveryContext(staleRound), "self-digested final-repair context admitted contradictory active boundary identity");
  const contractCommandMismatch = structuredClone(promptRecoveries[0]);
  contractCommandMismatch.workContract.validationCommands[0] = node("process.exit(0)");
  assertThrows(() => parseAttemptRecoveryContext(contractCommandMismatch), "final-validation recovery admitted commands different from its canonical work contract");
  const digestMismatch = structuredClone(promptRecoveries[0]);
  digestMismatch.failedRound.commands[0].stderr = "altered diagnostic";
  digestMismatch.commands[0].stderr = "altered diagnostic";
  assertThrows(() => parseAttemptRecoveryContext(digestMismatch), "altered embedded failed round retained stale source artifact identity");
  assertThrows(() => assertFinalValidationRecoverySource(promptRecoveries[0], { ...promptRecoveries[0].sourceFinalValidationEvidence, sha256: "0".repeat(64) }), "first final-repair launch admitted a source identity different from its prompt recovery evidence");
  const contradictoryProcess = structuredClone(promptRecoveries[0]);
  contradictoryProcess.failedRound.commands[0].outcome = "passed";
  contradictoryProcess.failedRound.commands[0].exitCode = 7;
  contradictoryProcess.sourceFinalValidationEvidence = artifactIdentity(contradictoryProcess.sourceFinalValidationEvidence.path, Buffer.from(`${JSON.stringify(contradictoryProcess.failedRound, null, 2)}\n`));
  assertThrows(() => parseAttemptRecoveryContext(contradictoryProcess), "contradictory final-validation process evidence was admitted");

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
    return await runFinalValidationRound({ repoRoot: repo, runDir, roundId, planningBase, ledger: [accepted], commands, expectedValidationTree: acceptedTree, expectedActiveTree: acceptedTree, prepareWorktree: (worktree) => prepareSharedWorktreePaths(repo, worktree, [".preinstalled"]) });
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
  return { id: "final-validation/0", index: 0, command: node("process.exit(1)"), outcome, exitCode: outcome === "nonzero" ? 1 : null, signal: outcome === "signal" ? "SIGTERM" : null, timeoutMs: outcome === "timeout" ? 1 : null, stdout: "", stderr: "", durationMs: 1 };
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

function assertThrows(run, message) {
  try { run(); }
  catch { return; }
  throw new Error(message);
}
