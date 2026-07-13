import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactIdentity,
  parseAcceptedStateTransition,
  verifyArtifactBytes,
} from "../packages/fanout-core/src/artifact-identity.ts";
import {
  publishPlanningArtifacts,
  readVerifiedArtifact,
  writeArtifactAtomically,
} from "../packages/fanout-pi/src/artifact-store.ts";
import {
  AmbiguousApplyError,
  applyAcceptedTransition,
  capturePatchCandidate,
  capturePlanningBase,
  fullGitVisibleTree,
  replayAcceptedTransitions,
  verifyPatchCandidate,
} from "../packages/fanout-pi/src/repository-identity.ts";

const root = mkdtempSync(join(tmpdir(), "fanout-identity-"));

try {
  runA4();
  runA5();
  runPlanningBaseChecks();
  runA8();
  console.log("artifact identity smoke passed (A4, A5, A8)");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function runA4() {
  const artifactRoot = join(root, "a4");
  for (const name of ["plan", "details", "packet", "evidence"]) {
    const path = `run/${name}.json`;
    const bytes = Buffer.from('{"ready":true}\n');
    const identity = writeArtifactAtomically(artifactRoot, path, bytes);
    assert(readVerifiedArtifact(artifactRoot, identity).equals(bytes), `${name} bytes did not round-trip`);
    writeFileSync(join(artifactRoot, path), Buffer.from('{ "ready": true }\n'));
    expectThrows(() => readVerifiedArtifact(artifactRoot, identity), `${name} formatting mutation retained authority`);
    writeArtifactAtomically(artifactRoot, path, bytes);
  }

  const bytes = Buffer.from("exact bytes");
  const identity = artifactIdentity("run/exact.bin", bytes);
  verifyArtifactBytes(identity, bytes);
  expectThrows(() => verifyArtifactBytes({ ...identity, byteLength: identity.byteLength + 1 }, bytes), "length mismatch passed");
  expectThrows(() => verifyArtifactBytes({ ...identity, sha256: "0".repeat(64) }, bytes), "digest mismatch passed");
}

function runA5() {
  const artifactRoot = join(root, "a5");
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, "active.json"), "old pointer\n");
  writeFileSync(join(artifactRoot, "blocked"), "not a directory\n");
  expectThrows(
    () => publishPlanningArtifacts(
      artifactRoot,
      "active.json",
      [
        { path: "run/plan.json", bytes: Buffer.from("plan\n") },
        { path: "blocked/details.json", bytes: Buffer.from("details\n") },
      ],
      Buffer.from("new pointer\n"),
    ),
    "torn planning publication succeeded",
  );
  assert(!existsSync(join(artifactRoot, "active.json")), "failed publication preserved a stale pointer");
  assert(readFileSync(join(artifactRoot, "run/plan.json"), "utf8") === "plan\n", "atomic artifact exposed partial bytes");
  assert(!findTemporaryFiles(artifactRoot).length, "temporary publication files remained authoritative-looking");

  rmSync(join(artifactRoot, "blocked"));
  publishPlanningArtifacts(
    artifactRoot,
    "active.json",
    [
      { path: "run/plan.json", bytes: Buffer.from("plan\n") },
      { path: "run/details.json", bytes: Buffer.from("details\n") },
    ],
    Buffer.from("selected last\n"),
  );
  assert(readFileSync(join(artifactRoot, "active.json"), "utf8") === "selected last\n", "active selection was not published");
}

function runPlanningBaseChecks() {
  const repo = join(root, "planning-base");
  const child = join(root, "planning-child");
  initRepo(child);
  writeFileSync(join(child, "child.txt"), "child\n");
  git(child, ["add", "."]);
  git(child, ["commit", "-m", "child"]);
  initRepo(repo);
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  writeFileSync(join(repo, "executable.sh"), "#!/bin/sh\n");
  chmodSync(join(repo, "executable.sh"), 0o755);
  symlinkSync("tracked.txt", join(repo, "link"));
  writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  git(repo, ["-c", "protocol.file.allow=always", "submodule", "add", "--quiet", child, "gitlink"]);
  git(repo, ["commit", "-m", "gitlink"]);
  writeFileSync(join(repo, "staged.txt"), "staged\n");
  git(repo, ["add", "staged.txt"]);
  writeFileSync(join(repo, "untracked.bin"), Buffer.from([0, 1, 2, 255]));
  writeFileSync(join(repo, "ignored.txt"), "one\n");

  const indexPath = git(repo, ["rev-parse", "--git-path", "index"]).stdout.toString().trim();
  const indexBefore = readFileSync(join(repo, indexPath));
  const first = capturePlanningBase(repo);
  assert(first.headCommit === git(repo, ["rev-parse", "HEAD"]).stdout.toString().trim(), "planning HEAD was not exact");
  assert(readFileSync(join(repo, indexPath)).equals(indexBefore), "full-tree calculation changed the user index");
  assert(git(repo, ["ls-tree", first.tree, "executable.sh"]).stdout.toString().startsWith("100755 "), "executable mode was absent from tree identity");
  assert(git(repo, ["ls-tree", first.tree, "link"]).stdout.toString().startsWith("120000 "), "symlink mode was absent from tree identity");
  assert(git(repo, ["ls-tree", first.tree, "gitlink"]).stdout.toString().startsWith("160000 "), "gitlink mode was absent from tree identity");
  writeFileSync(join(repo, "ignored.txt"), "two\n");
  assert(fullGitVisibleTree(repo) === first.tree, "ignored file changed the full Git-visible tree");
  writeFileSync(join(repo, "untracked.bin"), Buffer.from([0, 1, 3, 255]));
  assert(fullGitVisibleTree(repo) !== first.tree, "non-ignored untracked bytes were absent from tree identity");
}

function runA8() {
  const source = join(root, "source");
  const artifacts = join(root, "patches");
  initRepo(source);
  writeFileSync(join(source, "value.txt"), "zero\n");
  writeFileSync(join(source, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "base"]);
  writeFileSync(join(source, "planning-untracked.txt"), "planning base\n");
  const base = capturePlanningBase(source);
  const baseCommit = base.headCommit;

  writeFileSync(join(source, "value.txt"), "one\n");
  writeFileSync(join(source, "binary.bin"), Buffer.from([0, 255, 2, 4]));
  renameSync(join(source, "binary.bin"), join(source, "renamed.bin"));
  symlinkSync("value.txt", join(source, "value-link"));
  const patch1 = capturePatchCandidate(source, base, artifacts, "attempts/one.patch");
  verifyPatchCandidate(source, artifacts, patch1);
  assert(patch1.changedPaths.join(",") === "binary.bin,renamed.bin,value-link,value.txt", `changed paths are incomplete: ${patch1.changedPaths}`);
  assert(!patch1.changedPaths.includes("planning-untracked.txt"), "planning-base untracked content leaked into the candidate patch");
  assert(patch1.stats.filesChanged === patch1.changedPaths.length, "patch statistics did not match changed paths");
  assert(readVerifiedArtifact(artifacts, patch1.artifact).includes(Buffer.from("GIT binary patch")), "binary patch was not captured");
  const patch1Bytes = readVerifiedArtifact(artifacts, patch1.artifact);

  writeFileSync(join(artifacts, patch1.artifact.path), Buffer.concat([patch1Bytes, Buffer.from("altered") ]));
  expectThrows(() => verifyPatchCandidate(source, artifacts, patch1), "altered candidate patch passed verification");
  writeArtifactAtomically(artifacts, patch1.artifact.path, patch1Bytes);
  writeFileSync(join(source, "value.txt"), "validator changed it\n");
  expectThrows(() => verifyPatchCandidate(source, artifacts, patch1), "validator tree change passed verification");
  writeFileSync(join(source, "value.txt"), "one\n");
  verifyPatchCandidate(source, artifacts, patch1);

  writeFileSync(join(source, "value.txt"), "two\n");
  const patch2 = capturePatchCandidate(source, { headCommit: baseCommit, tree: patch1.resultTree }, artifacts, "attempts/two.patch");
  assert(patch2.changedPaths.join(",") === "value.txt", `accepted baseline leaked into the next patch: ${patch2.changedPaths}`);
  const transitions = [
    parseAcceptedStateTransition({ patch: patch1 }),
    parseAcceptedStateTransition({ patch: patch2 }),
  ];

  const replay = checkoutAt("replay", source, baseCommit);
  replayAcceptedTransitions(replay, artifacts, transitions);
  assert(readFileSync(join(replay, "value.txt"), "utf8") === "two\n", "valid ledger did not converge");
  assert(fullGitVisibleTree(replay) === patch2.resultTree, "valid ledger produced the wrong tree");

  const reordered = checkoutAt("reordered", source, baseCommit);
  const reorderedBefore = fullGitVisibleTree(reordered);
  expectThrows(() => replayAcceptedTransitions(reordered, artifacts, [transitions[1], transitions[0]]), "reordered ledger applied");
  assert(fullGitVisibleTree(reordered) === reorderedBefore, "reordered ledger mutated active state");

  const missing = checkoutAt("missing", source, baseCommit);
  rmSync(join(artifacts, patch1.artifact.path));
  expectThrows(() => applyAcceptedTransition(missing, artifacts, transitions[0]), "missing patch applied");
  assert(fullGitVisibleTree(missing) === patch1.baseTree, "missing patch mutated active state");
  writeArtifactAtomically(artifacts, patch1.artifact.path, patch1Bytes);

  const divergent = checkoutAt("divergent", source, baseCommit);
  const invalid = parseAcceptedStateTransition({ patch: { ...patch1, resultTree: patch1.baseTree } });
  expectThrows(() => applyAcceptedTransition(divergent, artifacts, invalid), "tree-divergent transition applied");
  assert(fullGitVisibleTree(divergent) === patch1.baseTree, "tree-divergent transition mutated active state");

  const changedPathDivergent = checkoutAt("changed-path-divergent", source, baseCommit);
  const wrongPaths = { patch: { ...patch1, changedPaths: patch1.changedPaths.slice(1) } };
  expectThrows(() => applyAcceptedTransition(changedPathDivergent, artifacts, wrongPaths), "changed-path-divergent transition applied");
  assert(fullGitVisibleTree(changedPathDivergent) === patch1.baseTree, "changed-path-divergent transition mutated active state");

  const statsDivergent = checkoutAt("stats-divergent", source, baseCommit);
  const wrongStats = { patch: { ...patch1, stats: { ...patch1.stats, insertions: patch1.stats.insertions + 1 } } };
  expectThrows(() => applyAcceptedTransition(statsDivergent, artifacts, wrongStats), "statistics-divergent transition applied");
  assert(fullGitVisibleTree(statsDivergent) === patch1.baseTree, "statistics-divergent transition mutated active state");

  const ambiguous = checkoutAt("ambiguous", source, baseCommit);
  expectThrows(
    () => applyAcceptedTransition(ambiguous, artifacts, transitions[0], { afterApply: () => writeFileSync(join(ambiguous, "raced.txt"), "race\n") }),
    "post-apply race was accepted",
    AmbiguousApplyError,
  );
  assert(existsSync(join(ambiguous, "raced.txt")), "ambiguous apply was automatically reset");
}

function checkoutAt(name, source, commit) {
  const repo = join(root, name);
  git(root, ["clone", "--quiet", source, repo]);
  git(repo, ["checkout", "--detach", commit]);
  writeFileSync(join(repo, "planning-untracked.txt"), "planning base\n");
  return repo;
}

function initRepo(path) {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "--quiet"]);
  git(path, ["config", "user.name", "Fanout Test"]);
  git(path, ["config", "user.email", "fanout@example.test"]);
}

function git(cwd, args, input) {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd, input });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}

function findTemporaryFiles(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const candidate = join(path, entry.name);
    return entry.isDirectory() ? findTemporaryFiles(candidate) : entry.name.endsWith(".tmp") ? [candidate] : [];
  });
}

function expectThrows(run, message, ErrorType = Error) {
  try {
    run();
  } catch (error) {
    assert(error instanceof ErrorType, `${message}: wrong error ${error}`);
    return;
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
