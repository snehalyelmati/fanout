import { readFileSync } from "node:fs";
import { buildRequiredReadClassifications, compileExecutionPacket } from "../packages/fanout-core/src/fanout-compiler.ts";
import { validateExecutionPacket } from "../packages/fanout-core/src/execution-packet.ts";

const phaseA = readFileSync("packages/fanout-pi/prompts/fanout-implementation-plan.md", "utf8");
const phaseB = readFileSync("packages/fanout-pi/prompts/fanout-implementation-details.md", "utf8");

for (const phrase of ["what must change and why", "behavior/contracts", "likely modules", "validation intent", "forbidden scope", "contract-first", "authorable from the contract", "Do not add dependencies for final verification", "not execution DAG edges"]) {
  if (!phaseA.includes(phrase)) throw new Error(`Phase A prompt missing reduced planning phrase: ${phrase}`);
}
for (const forbidden of ["workerPacket", "parallelGroups", "lineRangeHint", "anchorText"]) {
  if (phaseA.includes(forbidden)) throw new Error(`Phase A prompt leaked grounding/execution term: ${forbidden}`);
}
for (const phrase of ["implementation-details.json", "where to edit and the exact edit intent", "anchorText", "symbolName", "baseline-context", "post-change-required", "deterministic compiler", "post-change-required`: only when", "one details item per independently editable file/resource", "Reuse the same `sourcePlanIds`", "Phase A `filesToRead` entry overlaps", "Every Phase A `filesToChange` entry must be covered", "only as a concrete `post-change-required` file read", "Do not serialize tests, docs, fixtures, or package scripts behind implementation unless", "exact upstream artifact, file, or decision"]) {
  if (!phaseB.includes(phrase)) throw new Error(`Phase B prompt missing grounding phrase: ${phrase}`);
}
for (const forbidden of ["parallelGroups", "tierPlan", "workerPacket"]) {
  if (phaseB.includes(forbidden)) throw new Error(`Phase B prompt leaked packet field: ${forbidden}`);
}

const base = compile(samplePlan(), sampleDetails());
expectCompileOk("base", base);
if (base.packet.workUnits.some((unit) => /contract/i.test(unit.id))) throw new Error(`compiler emitted a default contract node: ${base.packet.workUnits.map((unit) => unit.id).join(",")}`);
const unavailableWorker = base.packet.workUnits.find((unit) => unit.id === "a");
const baseFinalValidation = base.packet.workUnits.find((unit) => unit.id === "final-validation");
if (unavailableWorker?.tier.model !== "fallback-worker" || unavailableWorker.tier.assigned !== "tier1") throw new Error(`tier2-unavailable worker did not use tier2Fallback: ${JSON.stringify(unavailableWorker?.tier)}`);
if (baseFinalValidation?.tier.model !== "current-session-model") throw new Error(`tier1-only final validation used fallback model: ${JSON.stringify(baseFinalValidation?.tier)}`);

const directoryDetail = detail("a", "generated/file.txt");
directoryDetail.ownedResources = ["generated/"];
const directoryOwnership = compile(samplePlan([item("a", ["generated/file.txt"])]), sampleDetails([directoryDetail]));
expectCompileOk("directory ownership", directoryOwnership);
if (!directoryOwnership.packet.workUnits.some((unit) => unit.ownedFiles.includes("generated/"))) throw new Error("compiler discarded explicit directory ownership intent");

const tier2Worker = compile(samplePlan([item("a", ["src/a.ts"])]), sampleDetails([detail("a", "src/a.ts")]), { tier2Eligible: ["implement"], tier1Only: ["final-validation"], fallbackTier: "tier1" }, availableTierPlan());
expectCompileOk("tier2 worker", tier2Worker);
const availableWorker = tier2Worker.packet.workUnits.find((unit) => unit.id === "a");
expectTier("tier2 worker assignment", availableWorker, "tier2", "tier2", "background");
if (availableWorker?.tier.model !== "zai-org/GLM-5.2-FP8") throw new Error(`tier2-available worker did not retain tier2 model: ${JSON.stringify(availableWorker?.tier)}`);

const tier1Veto = compile(samplePlan([item("docs", ["README.md"])]), sampleDetails([detail("docs", "README.md")]), { tier2Eligible: ["docs"], tier1Only: ["docs"], fallbackTier: "tier1" }, availableTierPlan());
expectCompileOk("tier1 veto", tier1Veto);
expectTier("tier1Only veto", tier1Veto.packet.workUnits.find((unit) => unit.id === "docs"), "tier1", "tier1", "active");

const sameFile = compile(samplePlan([item("a", ["src/shared.ts"]), item("b", ["src/shared.ts"])]), sampleDetails([
  detail("a", "src/shared.ts"),
  detail("b", "src/shared.ts", { anchorText: "export function b" }),
]));
expectCompileOk("same file merge", sameFile);
if (sameFile.packet.workUnits.filter((unit) => unit.id !== "final-validation").length !== 1) throw new Error("same-file details did not merge into one worker packet");

const splitSource = compile(samplePlan([item("a", ["src/a.ts", "src/a-extra.ts"])]), sampleDetails([
  detail("a", "src/a.ts"),
  detail("a", "src/a-extra.ts", { anchorText: "export const aExtra", symbolName: "symbolAExtra" }),
]));
expectCompileOk("split source id", splitSource);
const splitSourceUnits = splitSource.packet.workUnits.filter((unit) => unit.id !== "final-validation");
if (splitSourceUnits.length !== 2) throw new Error(`split source id did not create separate workers: ${splitSourceUnits.map((unit) => unit.id).join(",")}`);
if (new Set(splitSourceUnits.map((unit) => unit.id)).size !== splitSourceUnits.length) throw new Error(`split source id created duplicate worker ids: ${splitSourceUnits.map((unit) => unit.id).join(",")}`);

const splitDependency = compile(samplePlan([item("a", ["src/a.ts", "src/a-extra.ts"]), item("b", ["src/b.ts"], ["a"])]), sampleDetails([
  detail("a", "src/a.ts"),
  detail("a", "src/a-extra.ts", { anchorText: "export const aExtra", symbolName: "symbolAExtra" }),
  detail("b", "src/b.ts"),
]));
expectCompileOk("semantic dependency does not schedule", splitDependency);
const splitDependencyIds = splitDependency.packet.workUnits.filter((unit) => unit.id !== "final-validation" && unit.workerPacket.sourcePlanIds.includes("a")).map((unit) => unit.id);
const splitDependencyB = splitDependency.packet.workUnits.find((unit) => unit.id !== "final-validation" && unit.workerPacket.sourcePlanIds.includes("b"));
if (splitDependencyIds.length !== 2 || !splitDependencyB) throw new Error(`split dependency shape was not preserved: ${splitDependency.packet.workUnits.map((unit) => unit.id).join(",")}`);
for (const id of splitDependencyIds) if (splitDependencyB.dependencies.includes(id)) throw new Error(`semantic dependency ${id} leaked into execution dependencies: ${splitDependencyB.dependencies.join(",")}`);

const mixedSourceCycle = compile(samplePlan([item("contract", ["src/core.ts"]), item("command", ["src/index.ts", "src/execute.ts"], ["contract"])]), sampleDetails([
  detail("contract", "src/core.ts"),
  detail(["contract", "command"], "src/index.ts", {}, [{ file: "src/execute.ts", classification: "post-change-required", reason: "Must import the new helper." }]),
  detail("command", "src/execute.ts"),
]));
expectCompileOk("mixed source semantic dependency cycle", mixedSourceCycle);
const mixedIndex = mixedSourceCycle.packet.workUnits.find((unit) => unit.ownedFiles.includes("src/index.ts"));
const mixedExecute = mixedSourceCycle.packet.workUnits.find((unit) => unit.ownedFiles.includes("src/execute.ts"));
if (!mixedIndex || !mixedExecute) throw new Error(`mixed source regression lost expected units: ${mixedSourceCycle.packet.workUnits.map((unit) => unit.id).join(",")}`);
if (!mixedIndex.dependencies.includes(mixedExecute.id)) throw new Error(`post-change-required edge missing from index to execute: ${mixedIndex.dependencies.join(",")}`);
if (mixedExecute.dependencies.includes(mixedIndex.id)) throw new Error(`semantic dependency created a cycle back to index: ${mixedExecute.dependencies.join(",")}`);

const missingAnchor = compile(samplePlan(), sampleDetails([detail("a", "src/a.ts", { anchorText: undefined, symbolName: undefined, section: undefined, lineRangeHint: undefined })]));
expectCompileError("missing anchors", missingAnchor, "missing anchor");

const missingEditIntent = compile(samplePlan([item("a", ["src/a.ts"])]), sampleDetails([{ ...detail("a", "src/a.ts"), existingFileEdits: [], newFiles: [] }]));
expectCompileError("missing edit intent", missingEditIntent, "existingFileEdits or newFiles");

const unknownSource = compile(samplePlan(), sampleDetails([detail("missing", "src/a.ts")]));
expectCompileError("unknown Phase A ids", unknownSource, "unknown Phase A id missing");

const missingWriteCoverage = compile(samplePlan([item("a", ["src/a.ts"])]), sampleDetails([detail("a", "src/b.ts")]));
expectCompileError("missing filesToChange coverage", missingWriteCoverage, "filesToChange src/a.ts is not covered");

const missingContracts = compile(samplePlan([item("a", ["src/a.ts"], [], [])]), sampleDetails([detail("a", "src/a.ts")]));
expectCompileError("missing contracts", missingContracts, "missing contract inputs");

const noRequiredClassifications = buildRequiredReadClassifications(samplePlan([item("a", ["src/a.ts"]), item("b", ["src/b.ts"])]));
if (noRequiredClassifications.length !== 0) throw new Error(`unexpected required read classifications: ${JSON.stringify(noRequiredClassifications)}`);

const requiredClassifications = buildRequiredReadClassifications(samplePlan([item("a", ["src/a.ts"]), { ...item("b", ["src/b.ts"]), filesToRead: ["src/a.ts"] }]));
expectRequiredRows("required read classifications", requiredClassifications, [{ readerPlanId: "b", readFile: "src/a.ts", ownerPlanId: "a", ownerFile: "src/a.ts" }]);

const dedupedClassifications = buildRequiredReadClassifications(samplePlan([item("a", ["src/a.ts", "./src/a.ts"]), { ...item("b", ["src/b.ts"]), filesToRead: ["src/a.ts", "./src/a.ts"] }]));
expectRequiredRows("deduped required read classifications", dedupedClassifications, [{ readerPlanId: "b", readFile: "src/a.ts", ownerPlanId: "a", ownerFile: "src/a.ts" }]);

const unclassifiedPlanRead = compile(samplePlan([item("a", ["src/a.ts"]), { ...item("b", ["src/b.ts"]), filesToRead: ["src/a.ts"] }]), sampleDetails([
  detail("a", "src/a.ts"),
  detail("b", "src/b.ts"),
]));
expectCompileError("unclassified Phase A read overlap", unclassifiedPlanRead, "ambiguous");

const baseline = compile(samplePlan([item("a", ["src/a.ts"]), { ...item("b", ["src/b.ts"]), filesToRead: ["src/a.ts"] }]), sampleDetails([
  detail("a", "src/a.ts"),
  detail("b", "src/b.ts", {}, [
    { file: "src/a.ts", classification: "baseline-context", reason: "Read the old API shape." },
    { file: "./src/a.ts", classification: "baseline-context", reason: "Duplicate baseline row." },
  ]),
]));
expectCompileOk("baseline overlap", baseline);
expectGroup("baseline overlap stays parallel", baseline.packet, ["a", "b"]);
const baselineB = baseline.packet.workUnits.find((unit) => unit.id === "b");
if (baselineB?.workerPacket.readDependencies.length !== 1) throw new Error(`baseline read dependencies were not deduped: ${JSON.stringify(baselineB?.workerPacket.readDependencies)}`);
const baselineValidation = validateExecutionPacket(baseline.packet);
if (baselineValidation.warnings.some((warning) => warning.code === "read-write-overlap")) throw new Error(`baseline overlap still warned: ${JSON.stringify(baselineValidation.warnings)}`);
const unmarkedBaselinePacket = structuredClone(baseline.packet);
unmarkedBaselinePacket.workUnits.find((unit) => unit.id === "b").workerPacket.readDependencies = [];
const unmarkedValidation = validateExecutionPacket(unmarkedBaselinePacket);
if (!unmarkedValidation.warnings.some((warning) => warning.code === "read-write-overlap")) throw new Error("unmarked read-write overlap did not warn");
const malformedWorkerPacket = structuredClone(baseline.packet);
delete malformedWorkerPacket.workUnits.find((unit) => unit.id === "b").workerPacket;
const malformedWorkerValidation = validateExecutionPacket(malformedWorkerPacket);
if (!malformedWorkerValidation.errors.some((error) => error.code === "missing-worker-packet")) throw new Error(`malformed workerPacket did not return a structured error: ${JSON.stringify(malformedWorkerValidation)}`);
const malformedReadDependenciesPacket = structuredClone(baseline.packet);
malformedReadDependenciesPacket.workUnits.find((unit) => unit.id === "b").workerPacket.readDependencies = "bad";
const malformedReadDependenciesValidation = validateExecutionPacket(malformedReadDependenciesPacket);
if (!malformedReadDependenciesValidation.errors.some((error) => error.path?.endsWith(".readDependencies"))) throw new Error(`malformed readDependencies did not return a structured error: ${JSON.stringify(malformedReadDependenciesValidation)}`);

const postChange = compile(samplePlan([item("a", ["src/a.ts"]), { ...item("b", ["src/b.ts"]), filesToRead: ["src/a.ts"] }]), sampleDetails([
  detail("a", "src/a.ts"),
  detail("b", "src/b.ts", {}, [{ file: "src/a.ts", classification: "post-change-required", reason: "Must consume the changed export." }]),
]));
expectCompileOk("post-change overlap", postChange);
const postB = postChange.packet.workUnits.find((unit) => unit.id === "b");
if (!postB?.dependencies.includes("a")) throw new Error("post-change-required overlap did not create dependency");

const sequentialFallback = compileSequential(samplePlan([item("a", ["src/a.ts"]), { ...item("b", ["src/b.ts"]), filesToRead: ["src/a.ts"] }]), sampleDetails([
  detail("a", "src/a.ts"),
  detail("b", "src/b.ts"),
]));
expectCompileOk("sequential fallback overlap", sequentialFallback);
const sequentialB = sequentialFallback.packet.workUnits.find((unit) => unit.id === "b");
if (!sequentialB?.dependencies.includes("a")) throw new Error(`sequential fallback did not add dependency: ${sequentialB?.dependencies.join(",")}`);
if (!sequentialFallback.warnings.some((warning) => warning.includes("Implicit post-change-required fallback"))) throw new Error(`sequential fallback did not warn: ${sequentialFallback.warnings.join("; ")}`);
if (!sequentialFallback.packet.risks.some((risk) => risk.includes("Implicit post-change-required fallback"))) throw new Error(`sequential fallback warning missing from packet risks: ${sequentialFallback.packet.risks.join("; ")}`);

const ambiguous = compile(samplePlan(), sampleDetails([
  detail("a", "src/a.ts"),
  detail("b", "src/b.ts", {}, [{ file: "src/a.ts", classification: "later", reason: "Not classified." }]),
]));
expectCompileError("ambiguous overlap", ambiguous, "ambiguous");

console.log("fanout compiler smoke passed");

function compile(plan, details, policy = { tier2Eligible: ["implement", "docs"], tier1Only: ["final-validation"], fallbackTier: "tier1" }, tiers = tierPlan()) {
  return compileExecutionPacket({ implementationPlan: plan, implementationDetails: details, tierPlan: tiers, nodeKindTierPolicy: policy, artifactDir: plan.artifactDir, createdAt: "2026-07-08T00:00:00.000Z" });
}

function compileSequential(plan, details) {
  return compileExecutionPacket({ implementationPlan: plan, implementationDetails: details, tierPlan: tierPlan(), nodeKindTierPolicy: { tier2Eligible: ["implement", "docs"], tier1Only: ["final-validation"], fallbackTier: "tier1" }, unclassifiedOverlapPolicy: "sequential", artifactDir: plan.artifactDir, createdAt: "2026-07-08T00:00:00.000Z" });
}

function samplePlan(items = [item("a", ["src/a.ts"]), item("b", ["src/b.ts"])]) {
  return {
    schema: "fanout.implementation-plan",
    version: 1,
    status: "ready",
    objective: "Compiler smoke",
    createdAt: "2026-07-08T00:00:00.000Z",
    artifactDir: "/tmp/fanout-compiler-smoke",
    userContext: ["User requested compiler smoke."],
    discoveredRepoFacts: ["Repo has TypeScript files."],
    assumptions: [],
    implementationItems: items,
    validationPlan: ["rtk npm run smoke:fanout-compiler"],
    risks: [],
  };
}

function item(id, filesToChange, dependencies = [], acceptanceCriteria = [`${id} satisfies the contract.`]) {
  return {
    id,
    goal: `Update ${id}`,
    rationale: `${id} is required by the objective.`,
    filesToChange,
    filesToRead: [],
    dependencies,
    validation: ["rtk npm run smoke:fanout-compiler"],
    acceptanceCriteria,
    risks: [],
  };
}

function sampleDetails(items = [detail("a", "src/a.ts"), detail("b", "src/b.ts")]) {
  return {
    schema: "fanout.implementation-details",
    version: 1,
    status: "ready",
    objective: "Compiler smoke",
    artifactDir: "/tmp/fanout-compiler-smoke",
    sourcePlanPath: "/tmp/fanout-compiler-smoke/implementation-plan.json",
    items,
  };
}

function detail(sourcePlanId, file, overrides = {}, readDependencies = []) {
  const sourcePlanIds = Array.isArray(sourcePlanId) ? sourcePlanId : [sourcePlanId];
  const anchorId = sourcePlanIds[0];
  return {
    sourcePlanIds,
    ownedResources: [file],
    existingFileEdits: [{ file, symbolName: `symbol${anchorId.toUpperCase()}`, section: "exports", anchorText: `export const ${anchorId}`, lineRangeHint: "1-5", editIntent: `Apply ${anchorId}.`, ...overrides }],
    newFiles: [],
    readDependencies,
    forbiddenChanges: ["Do not change unrelated files."],
    validationCommands: ["rtk npm run smoke:fanout-compiler"],
  };
}

function tierPlan() {
  return {
    tier1: { provider: "current", model: "current-session-model", thinking: "auto", source: "current Pi active model", status: "available", reason: "control plane, review, synthesis" },
    tier2: { provider: "doubleword", model: "zai-org/GLM-5.2-FP8", thinking: "medium", source: "default settings", status: "unavailable", reason: "async unavailable", fallback: "tier1" },
    tier2Fallback: { provider: "current", model: "fallback-worker", thinking: "low", source: "fanout.execution.tier2Fallback", status: "available", reason: "realtime fallback for tier2 execution" },
  };
}

function availableTierPlan() {
  return {
    tier1: { provider: "current", model: "current-session-model", thinking: "auto", source: "current Pi active model", status: "available", reason: "control plane, review, synthesis" },
    tier2: { provider: "doubleword", model: "zai-org/GLM-5.2-FP8", thinking: "medium", source: "default settings", status: "available", reason: "parallel async worker nodes" },
    tier2Fallback: { provider: "current", model: "fallback-worker", thinking: "low", source: "fanout.execution.tier2Fallback", status: "available", reason: "realtime fallback for tier2 execution" },
  };
}

function expectCompileOk(name, result) {
  if (!result.ok || !result.packet) throw new Error(`${name} compile failed: ${JSON.stringify(result.errors)}`);
  const validation = validateExecutionPacket(result.packet);
  if (!validation.ok) throw new Error(`${name} packet did not validate: ${JSON.stringify(validation, null, 2)}`);
}

function expectCompileError(name, result, substring) {
  if (result.ok || !result.errors.some((error) => error.includes(substring))) throw new Error(`${name}: expected ${substring}, got ${JSON.stringify(result.errors)}`);
}

function expectGroup(name, packet, ids) {
  const groups = packet.estimates.parallelGroups.map((group) => new Set(group));
  if (!groups.some((group) => ids.every((id) => group.has(id)))) throw new Error(`${name}: ${JSON.stringify(packet.estimates.parallelGroups)}`);
}

function expectRequiredRows(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)}`);
}

function expectTier(name, unit, preferred, assigned, active) {
  if (!unit || unit.tier.preferred !== preferred || unit.tier.assigned !== assigned || unit.active !== active) throw new Error(`${name}: ${JSON.stringify(unit?.tier)} active=${unit?.active}`);
}
