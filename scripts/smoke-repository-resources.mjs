import { readFileSync } from "node:fs";
import {
  authorizeObservedChanges,
  compileRepositoryAuthority,
  decodeGitPathList,
  parseRepoPath,
  parseResource,
  resourceCovers,
  resourcesOverlap,
} from "../packages/fanout-core/src/repository-resource.ts";

const file = (path) => parseResource({ kind: "file", path });
const directory = (path) => parseResource({ kind: "directory", path });
const plan = (id, writeResources, readResources = [], forbiddenWriteResources = [], forbiddenNotes = []) => ({ id, writeResources, readResources, forbiddenWriteResources, forbiddenNotes });
const detail = (sourcePlanIds, ownedResources, readDependencies = [], forbiddenWriteResources = [], forbiddenNotes = []) => ({ sourcePlanIds, ownedResources, readDependencies, forbiddenWriteResources, forbiddenNotes });
const read = (resource, timing, reason = "Required context.") => ({ resource, timing, reason });

const corePackage = JSON.parse(readFileSync(new URL("../packages/fanout-core/package.json", import.meta.url), "utf8"));
assert(corePackage.exports?.["./repository-resource"] === "./src/repository-resource.ts", "canonical resource module is not publicly exported");

runA2();
runA1();
runAuthorityChecks();
runReadChecks();
runA3();
runA9();
console.log("repository resource smoke passed (A1, A2, A3, A9)");

function runA2() {
  for (const value of ["README.md", "docs/interior space.md", "src/naïve/文件.ts", "unicode/é.ts", "app/[slug]/page.tsx", "src/routes/[...rest]/+page.svelte", "*.ts", "a?.ts", "a[b].ts", "a{b}.ts"]) {
    assert(parseRepoPath(value) === value, `RepoPath changed valid input ${JSON.stringify(value)}`);
    assert(parseResource({ kind: "file", path: value }).path === value, `Resource changed valid input ${JSON.stringify(value)}`);
  }
  for (const value of [
    "", "/absolute", "C:/drive", "//server/share", "a/../b", "./a", "a/./b", ".git/config", "a/.git/b",
    "a\u0000b", "a\u001fb", "a\u007fb", "a\\b", "a/", "a//b",
    " leading", "trailing ", "\u0085edge", "edge\u0085", "a/ leading", "a/trailing ", "\ud800", "\udc00",
  ]) {
    expectThrows(() => parseRepoPath(value), `RepoPath accepted ${JSON.stringify(value)}`);
    expectThrows(() => parseResource({ kind: "directory", path: value }), `Resource accepted ${JSON.stringify(value)}`);
  }
  for (const value of [null, 1, {}, { kind: "tree", path: "src" }, { kind: "file", path: "src", extra: true }]) {
    expectThrows(() => parseResource(value), `Resource accepted malformed input ${JSON.stringify(value)}`);
  }
  console.log("A2 canonical resource parser passed");
}

function runA1() {
  const result = compileRepositoryAuthority(
    [plan("source", [file("src/value.ts")])],
    [detail(["source"], [directory("src/value.ts")])],
  );
  expectError(result, "write-not-authorized", "A1 file-to-directory widening");
  assert(resourceCovers(directory("src"), file("src/value.ts")), "directory did not authorize descendant file");
  assert(resourceCovers(directory("src"), directory("src/narrow")), "directory did not authorize descendant directory");
  assert(!resourceCovers(directory("src"), file("src")), "directory authority changed kind at the same path");
  assert(!resourceCovers(file("src"), file("src/value.ts")), "file authority widened to descendants");
  console.log("A1 directional narrowing passed");
}

function runAuthorityChecks() {
  const narrowed = compileRepositoryAuthority(
    [plan("source", [directory("src")])],
    [detail(["source"], [file("src/a.ts")]), detail(["source"], [directory("src/generated")])],
  );
  expectOk(narrowed, "directory narrowing");

  expectError(
    compileRepositoryAuthority([plan("source", [file("src/a.ts"), file("src/b.ts")])], [detail(["source"], [file("src/a.ts")])]),
    "planned-write-not-grounded",
    "dropped Phase A write",
  );
  expectError(
    compileRepositoryAuthority(
      [plan("a", [directory("src")]), plan("b", [directory("tests")])],
      [detail(["a", "b"], [file("src/a.ts")]), detail(["b"], [file("tests/a.test.ts")])],
    ),
    "write-not-authorized",
    "same-source write authorization",
  );

  const connected = compileRepositoryAuthority(
    [
      plan("a", [directory("src")]),
      plan("b", [directory("src/generated")]),
      plan("c", [file("README.md")]),
    ],
    [
      detail(["a"], [directory("src")]),
      detail(["b"], [file("src/generated/output.ts")]),
      detail(["c"], [file("README.md")]),
    ],
  );
  expectOk(connected, "connected ownership");
  assert(connected.ownershipGroups.length === 2, `expected two ownership groups: ${JSON.stringify(connected.ownershipGroups)}`);
  assert(connected.ownershipGroups.some((group) => group.memberIndexes.join(",") === "0,1"), "overlapping ownership was not transitively grouped");
  assert(resourcesOverlap(file("same"), directory("same")), "file-directory replacement did not overlap");
  assert(!resourcesOverlap(file("src"), file("src/a.ts")), "file path incorrectly overlapped descendant file");
}

function runReadChecks() {
  expectOk(compileRepositoryAuthority([plan("context", [file("out.ts")])], [detail(["context"], [file("out.ts")], [read(file("package.json"), "baseline-context")])]), "discovered baseline read");
  expectError(compileRepositoryAuthority([plan("context", [file("out.ts")])], [detail(["missing"], [file("out.ts")], [read(file("package.json"), "baseline-context")])]), "unknown-source-plan-id", "baseline source attribution");
  expectError(compileRepositoryAuthority([plan("self", [file("self.ts")])], [detail(["self"], [file("self.ts")], [read(file("self.ts"), "post-change-required")])]), "self-post-change-read", "raw self read");
  const internal = compileRepositoryAuthority([plan("joint", [file("a.ts"), file("b.ts")])], [detail(["joint"], [file("a.ts")]), detail(["joint"], [file("b.ts")], [read(file("a.ts"), "post-change-required")])]);
  expectOk(internal, "group internal read");
  assert(internal.ownershipGroups.length === 1 && internal.readEdges.length === 0, "direct compiler lost joint ownership or retained internal edges");
  const plans = [
    plan("owner-a", [file("packages/a.ts")]),
    plan("owner-b", [file("packages/b.ts")]),
    plan("reader", [file("tests/all.test.ts")], [directory("packages")]),
  ];
  const baseline = compileRepositoryAuthority(plans, [
    detail(["owner-a"], [file("packages/a.ts")]),
    detail(["owner-b"], [file("packages/b.ts")]),
    detail(["reader"], [file("tests/all.test.ts")], [read(directory("packages"), "baseline-context")]),
  ]);
  expectOk(baseline, "baseline read");
  assert(baseline.readEdges.length === 0, "baseline read created an ownership edge");

  const postChange = compileRepositoryAuthority(plans, [
    detail(["owner-a"], [file("packages/a.ts")]),
    detail(["owner-b"], [file("packages/b.ts")]),
    detail(["reader"], [file("tests/all.test.ts")], [read(directory("packages"), "post-change-required")]),
  ]);
  expectOk(postChange, "post-change read");
  assert(postChange.readEdges.length === 2, `post-change read did not add every owner edge: ${JSON.stringify(postChange.readEdges)}`);

  expectError(
    compileRepositoryAuthority(
      [plan("reader", [file("tests/all.test.ts")], [file("missing.ts")])],
      [detail(["reader"], [file("tests/all.test.ts")], [read(file("missing.ts"), "post-change-required")])],
    ),
    "ownerless-post-change-read",
    "ownerless post-change read",
  );
  expectError(
    compileRepositoryAuthority(plans, [
      detail(["owner-a"], [file("packages/a.ts")]),
      detail(["owner-b"], [file("packages/b.ts")]),
      detail(["reader"], [file("tests/all.test.ts")], [{ resource: directory("packages"), timing: "later", reason: "Ambiguous." }]),
    ]),
    "invalid-read-timing",
    "unclassified read",
  );
  expectError(
    compileRepositoryAuthority(
      [plan("reader", [file("tests/all.test.ts")], [file("allowed.ts")])],
      [detail(["reader"], [file("tests/all.test.ts")], [read(file("other.ts"), "post-change-required")])],
    ),
    "read-not-authorized",
    "same-source read authorization",
  );
}

function runA3() {
  const typed = file("generated/blocked.ts");
  const prose = ["Do not change `generated/blocked.ts`!", "generated/blocked.ts (forbidden)", "marker-like-name:generated/blocked.ts"];
  for (const note of prose) {
    const result = compileRepositoryAuthority(
      [plan("source", [directory("generated")], [], [], [note])],
      [detail(["source"], [file("generated/allowed.ts")], [], [], [note])],
    );
    expectOk(result, `advisory forbidden note ${note}`);
    assert(result.forbiddenWriteResources.length === 0, "forbidden prose altered machine policy");
  }

  const monotonic = compileRepositoryAuthority(
    [plan("source", [file("src/a.ts")], [], [directory("generated")])],
    [detail(["source"], [file("src/a.ts")], [], [typed])],
  );
  expectOk(monotonic, "monotonic forbidden union");
  assert(monotonic.forbiddenWriteResources.length === 2, "Phase A or Phase B forbidden resource was dropped");

  expectError(
    compileRepositoryAuthority(
      [plan("source", [directory("src")], [], [file("src/blocked.ts")])],
      [detail(["source"], [directory("src")])],
    ),
    "owned-forbidden-overlap",
    "typed forbidden overlap",
  );
  console.log("A3 typed forbidden policy passed");
}

function runA9() {
  const raw = Buffer.concat([
    Buffer.from("src/naïve file.ts"), Buffer.from([0]),
    Buffer.from("src/文件.ts"), Buffer.from([0]),
  ]);
  const decoded = decodeGitPathList(raw);
  assert(JSON.stringify(decoded) === JSON.stringify(["src/naïve file.ts", "src/文件.ts"]), `Git path bytes changed: ${JSON.stringify(decoded)}`);
  assert(Buffer.compare(raw, Buffer.concat(decoded.flatMap((path) => [Buffer.from(path), Buffer.from([0])]))) === 0, "Git path bytes did not round-trip exactly");
  expectThrows(() => decodeGitPathList(Buffer.from([0xc3, 0x28, 0])), "invalid UTF-8 Git path was accepted");
  expectThrows(() => decodeGitPathList(Buffer.from("src/a.ts")), "non-NUL-terminated Git path list was accepted");
  expectThrows(() => decodeGitPathList(Buffer.from("src/a\\b\0")), "noncanonical Git path was accepted");

  for (const type of ["rename", "copy"]) {
    const moved = authorizeObservedChanges([
      { type, from: { path: parseRepoPath("old.ts"), kind: "regular" }, to: { path: parseRepoPath("src/new.ts"), kind: "regular" } },
    ], [directory("src")], []);
    assert(!moved.ok && moved.errors.some((error) => error.code === "observed-path-not-owned" && error.path === "old.ts"), `${type} source endpoint bypassed ownership`);
  }

  const exactKinds = authorizeObservedChanges([
    { type: "change", entry: { path: parseRepoPath("link"), kind: "symlink" } },
    { type: "change", entry: { path: parseRepoPath("vendor/module"), kind: "gitlink" } },
  ], [file("link"), file("vendor/module")], []);
  assert(exactKinds.ok, `authorized symlink/gitlink identities were rejected: ${JSON.stringify(exactKinds.errors)}`);

  const exactForbidden = authorizeObservedChanges([
    { type: "change", entry: { path: parseRepoPath("vendor/module"), kind: "gitlink" } },
  ], [directory("vendor")], [file("vendor/module")]);
  assert(!exactForbidden.ok && exactForbidden.errors.some((error) => error.code === "observed-path-forbidden"), "exact forbidden gitlink was accepted");
  const samePathDirectory = authorizeObservedChanges([
    { type: "change", entry: { path: parseRepoPath("vendor/module"), kind: "gitlink" } },
  ], [directory("vendor")], [directory("vendor/module")]);
  assert(samePathDirectory.ok, `directory prohibition changed kind at the same path: ${JSON.stringify(samePathDirectory.errors)}`);
  const forbiddenDescendant = authorizeObservedChanges([
    { type: "change", entry: { path: parseRepoPath("vendor/module/child"), kind: "symlink" } },
  ], [directory("vendor")], [directory("vendor/module")]);
  assert(!forbiddenDescendant.ok && forbiddenDescendant.errors.some((error) => error.code === "observed-path-forbidden"), "forbidden directory descendant was accepted");
  const unauthorizedLink = authorizeObservedChanges([
    { type: "change", entry: { path: parseRepoPath("outside-link"), kind: "symlink" } },
  ], [directory("src")], []);
  assert(!unauthorizedLink.ok && unauthorizedLink.errors.some((error) => error.code === "observed-path-not-owned"), "unauthorized symlink was accepted");

  const malformedKind = authorizeObservedChanges([
    { type: "change", entry: { path: parseRepoPath("src/a.ts"), kind: "directory" } },
  ], [directory("src")], []);
  assert(!malformedKind.ok && malformedKind.errors.some((error) => error.code === "invalid-observed-entry-kind"), "unknown Git entry kind was accepted");
  console.log("A9 exact Git path admission passed");
}

function expectOk(result, name) {
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.errors)}`);
}

function expectError(result, code, name) {
  if (result.ok || !result.errors.some((error) => error.code === code)) throw new Error(`${name}: expected ${code}, got ${JSON.stringify(result.errors)}`);
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
