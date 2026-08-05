import { readFileSync, readdirSync } from "node:fs";
import { artifactIdentity } from "../packages/fanout-core/src/artifact-identity.ts";
import {
  IMPLEMENTATION_DETAILS_VERSION,
  IMPLEMENTATION_PLAN_VERSION,
  compileExecutionPacket,
  validateImplementationDetailsArtifact,
  validateImplementationPlan,
} from "../packages/fanout-core/src/fanout-compiler.ts";
import { EXECUTION_PACKET_VERSION, deriveExecutionGraph, validateExecutionPacket } from "../packages/fanout-core/src/execution-packet.ts";
import { renderWorkContractMarkdown, renderWorkContractMermaid } from "../packages/fanout-core/src/work-contract-views.ts";
import { EXECUTION_EVENT_NAMES as SHIM_EVENT_NAMES, EXECUTION_RUN_VERSION } from "../packages/fanout-core/src/execution-run.ts";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = "1".repeat(40);
const profileIdentity = artifactIdentity("profiles/test.json", Buffer.from("{}\n"));
const plan = {
  schema: "fanout.implementation-plan", version: IMPLEMENTATION_PLAN_VERSION, planId: "plan-1", createdAt: "2026-07-14T00:00:00.000Z",
  planningHost: { platform: process.platform }, planningBase: { headCommit: hash, tree: hash }, profile: profileIdentity, objective: "Add the checked feature",
  userContext: ["requested"], discoveredRepoFacts: ["src exists"], assumptions: [],
  implementationItems: [{
    id: "feature", goals: ["Add feature"], writeResources: [{ kind: "file", path: "src/feature.ts" }], readResources: [{ kind: "file", path: "package.json" }],
    forbiddenWrites: [{ resource: { kind: "directory", path: "generated" }, reason: "generated output stays untouched" }], semanticReviewCriteria: ["feature is observable"],
    advisoryNotes: [{ kind: "rationale", reference: "feature", text: "smallest implementation" }],
  }],
};
const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
const planIdentity = artifactIdentity("implementation-plan.json", planBytes);
const command = { executable: "rtk", args: ["npm", "run", "check"] };
const profileGate = { executable: "rtk", args: ["npm", "run", "full-check"], env: { SECOND: "2", FIRST: "1" } };
const profile = {
  schema: "fanout.project-execution-profile", version: 1, profileId: "test", createdAt: new Date(0).toISOString(), preparation: [], readiness: [], candidateNormalization: [],
  requiredFinalGates: [{ command: profileGate, purpose: "full validation", expectedMutations: "none", networkAccess: false, lifecycleScripts: false }],
};

const reservedFinalPlan = structuredClone(plan);
reservedFinalPlan.implementationItems.push({
  ...structuredClone(plan.implementationItems[0]),
  id: "final-validation",
  writeResources: [],
  readResources: structuredClone(plan.implementationItems[0].writeResources),
});
const reservedFinalPlanResult = validateImplementationPlan(reservedFinalPlan);
assert(!reservedFinalPlanResult.ok && reservedFinalPlanResult.errors.some((error) => error.includes("finalValidationCommands")), "reserved Phase A final-validation authority was admitted");

const packetGlobalForbiddenPlan = structuredClone(plan);
packetGlobalForbiddenPlan.implementationItems.push({
  ...structuredClone(plan.implementationItems[0]),
  id: "feature-tests",
  writeResources: [{ kind: "file", path: "test/feature.test.ts" }],
  forbiddenWrites: [{ resource: { kind: "file", path: "src/feature.ts" }, reason: "The test worker must not repair implementation." }],
});
const packetGlobalForbiddenResult = validateImplementationPlan(packetGlobalForbiddenPlan);
assert(!packetGlobalForbiddenResult.ok && packetGlobalForbiddenResult.errors.some((error) => error.includes("packet-global") && error.includes("worker ownership")), "Phase A admitted a forbidden write that cancels another item's write authority");

const details = {
  schema: "fanout.implementation-details", version: IMPLEMENTATION_DETAILS_VERSION, detailsId: "plan-1", createdAt: "2026-07-14T00:01:00.000Z", plan: planIdentity,
  items: [{
    id: "feature", kind: "implement",
    changes: [{ kind: "create", target: { resource: { kind: "file", path: "src/feature.ts" }, sourcePlanIds: ["feature"] }, contentIntent: "feature implementation" }],
    readDependencies: [{ resource: { kind: "file", path: "package.json" }, timing: "baseline-context", timingSource: "phase-b", sourcePlanIds: ["feature"], reason: "package metadata" }],
    validationCommands: [command], advisoryNotes: [{ kind: "context", reference: "feature", text: "grounded source" }],
  }],
  finalValidationCommands: [command, command],
};
const detailsIdentity = artifactIdentity("implementation-details.json", Buffer.from(`${JSON.stringify(details, null, 2)}\n`));
const tier = (provider, model, status = "available") => ({ provider, model, thinking: "medium", source: "test", status, reason: "test" });
const tierPlan = { tier1: tier("local", "one"), tier2: { ...tier("local", "two", "unavailable"), fallback: "tier1" }, tier2Fallback: tier("local", "fallback") };

assert(validateImplementationPlan(plan).ok, "plan v3 rejected");
assert(validateImplementationDetailsArtifact(details, { planIdentity, planIds: ["feature"], profile }).ok, "details v6 rejected");
const modifyDetails = structuredClone(details);
modifyDetails.items[0].changes = [{ kind: "modify", target: { resource: { kind: "file", path: "src/feature.ts" }, sourcePlanIds: ["feature"] }, intent: "modify feature", anchors: [{ kind: "symbol", symbol: "feature" }] }];
const malformedDetails = [
  ["singular anchor", (value) => { value.items[0].changes[0].anchor = value.items[0].changes[0].anchors[0]; delete value.items[0].changes[0].anchors; }],
  ["flattened endpoint", (value) => { value.items[0].changes[0].target = { kind: "file", path: "src/feature.ts", sourcePlanIds: ["feature"] }; }],
  ["wrong anchor field", (value) => { value.items[0].changes[0].anchors = [{ kind: "symbol", text: "feature" }]; }],
  ["line-only file anchor", (value) => { value.items[0].changes[0].anchors = [{ kind: "line-range-hint", start: 1, end: 2 }]; }],
  ["duplicate source ids", (value) => { value.items[0].changes[0].target.sourcePlanIds = ["feature", "feature"]; }],
  ["empty item validation", (value) => { value.items[0].validationCommands = []; }],
  ["unknown item field", (value) => { value.items[0].unknown = true; }],
  ["empty items", (value) => { value.items = []; }],
  ["empty final validation", (value) => { value.finalValidationCommands = []; }],
];
for (const [label, mutate] of malformedDetails) {
  const value = structuredClone(modifyDetails); mutate(value);
  const result = validateImplementationDetailsArtifact(value, { planIdentity, planIds: ["feature"] });
  assert(!result.ok && result.errors.some((error) => error.includes("items") || error.includes("finalValidationCommands")), `${label} was not rejected with a schema path: ${result.errors.join("; ")}`);
  assert(!result.errors.some((error) => error.includes("details need grounded items and finalValidationCommands")), `${label} retained the combined legacy diagnostic`);
}
for (const [label, duplicateDetails] of [
  ["node", { ...structuredClone(details), items: [{ ...structuredClone(details.items[0]), validationCommands: [{ ...profileGate, env: { FIRST: "1", SECOND: "2" } }] }] }],
  ["packet-final", { ...structuredClone(details), finalValidationCommands: [profileGate] }],
]) {
  const result = validateImplementationDetailsArtifact(duplicateDetails, { planIdentity, planIds: ["feature"], profile });
  assert(!result.ok && result.errors.some((error) => error.includes("requiredFinalGates[0]")) && result.errors.some((error) => error.includes("focused task-specific check") && error.includes("resubmit")), `${label} profile-gate duplicate was admitted or lacked correction guidance`);
}
const packetNormalization = { ...structuredClone(details), candidateNormalizationCommands: [] };
assert(!validateImplementationDetailsArtifact(packetNormalization, { planIdentity, planIds: ["feature"] }).ok, "details v6 admitted packet-owned normalization");
const perItemNormalization = structuredClone(details); perItemNormalization.items[0].candidateNormalizationCommands = [];
assert(!validateImplementationDetailsArtifact(perItemNormalization, { planIdentity, planIds: ["feature"] }).ok, "details v6 admitted per-item normalization authority");
const phaseBForbidden = structuredClone(details);
phaseBForbidden.items[0].forbiddenWrites = [];
const phaseBForbiddenResult = validateImplementationDetailsArtifact(phaseBForbidden, { planIdentity, plan });
assert(!phaseBForbiddenResult.ok && phaseBForbiddenResult.errors.some((error) => error.includes("items[0]") && error.includes("forbiddenWrites")), "Phase B forbiddenWrites failed to reject structurally");
assert(!validateImplementationPlan({ ...plan, version: 1 }).ok, "legacy plan v1 admitted");
assert(!validateImplementationDetailsArtifact({ ...details, version: 5 }, { planIdentity }).ok, "legacy details v5 admitted");
assert(!validateImplementationDetailsArtifact({ ...details, plan: { ...planIdentity, sha256: "2".repeat(64) } }, { planIdentity }).ok, "mixed plan/details identity admitted");
const duplicateFinalValidation = validateImplementationDetailsArtifact({
  ...details,
  items: [...details.items, {
    id: "final-validation", kind: "final-validation", changes: [],
    readDependencies: [{ resource: { kind: "file", path: "src/feature.ts" }, timing: "post-change-required", timingSource: "phase-b", sourcePlanIds: ["feature"], reason: "integrated validation input" }],
    validationCommands: [command], advisoryNotes: [],
  }],
}, { planIdentity, planIds: ["feature"] });
assert(!duplicateFinalValidation.ok && duplicateFinalValidation.errors.some((error) => error.includes("finalValidationCommands")), "duplicate Phase B final-validation authority was admitted");

const runtimePolicy = { maxConcurrency: 2, failFast: false, fallbackAllowed: true };
const compiled = compileExecutionPacket({ implementationPlan: plan, implementationDetails: details, planIdentity, detailsIdentity, tierPlan, runtimePolicy, createdAt: "2026-07-14T00:02:00.000Z" });
assert(compiled.ok && compiled.packet, `compile failed: ${compiled.errors.join("; ")}`);
const packet = compiled.packet;
assert(packet.version === EXECUTION_PACKET_VERSION && packet.version === 9, "packet is not v9");
assert(packet.nodes.length === 2 && packet.nodes.at(-1).kind === "final-validation", "canonical nodes/final validation missing");
assert(packet.nodes.every((node) => !Object.hasOwn(node.workContract, "candidateNormalizationCommands")), "packet retained profile-owned normalization");
assert(packet.nodes.at(-1).workContract.validationCommands.length === 2, "command order/duplicates were not preserved");
assert(packet.nodes.every((node) => node.workContract.forbiddenWrites.some((entry) => entry.resource.path === "generated" && entry.sourcePlanIds[0] === "feature")), "Phase A forbidden writes did not reach every ordinary/final Work Contract with provenance");
assert(JSON.stringify(packet.runtimePolicy) === JSON.stringify(runtimePolicy), "immutable runtime policy was not stored in packet v9");
const forbidden = ["artifactDir", "blockers", "workUnits", "estimates", "stopRules", "risks", "finalValidationPlan", "goal", "dependencies", "ownedFiles", "readOnlyFiles", "steps", "validationCommands", "acceptanceCriteria", "rollbackNotes", "workerPacket"];
assert(!forbidden.some((key) => Object.hasOwn(packet, key) || packet.nodes.some((node) => Object.hasOwn(node, key))), "packet retains flattened legacy authority");
assert(validateExecutionPacket(packet).executable, "packet v9 rejected");
assert(!validateExecutionPacket({ ...packet, version: 7 }).executable, "legacy packet v7 admitted");
assert(!validateExecutionPacket({ ...packet, status: "ready" }).executable, "legacy status field admitted");
assert(!validateExecutionPacket({ ...packet, runtimePolicy: { ...packet.runtimePolicy, maxConcurrency: 0 } }).executable, "invalid packet runtime policy admitted");
assert(EXECUTION_RUN_VERSION === 6 && SHIM_EVENT_NAMES.length === 9, "execution-run compatibility subpath exposed legacy runtime authority");
const graph = deriveExecutionGraph(packet);
assert(JSON.stringify(graph.edges) === JSON.stringify([["feature", "final-validation"]]), "graph was not derived from contracts");

const fused = compileSerialFixture("chain");
assert(fused.ok && fused.packet.nodes.length === 2, `eligible vertical chain did not fuse: ${fused.errors.join("; ")}`);
const fusedNode = fused.packet.nodes[0];
assert(/^fused-[0-9a-f]{16}$/.test(fusedNode.id) && fusedNode.workContract.changes.length === 3, "longer chain did not receive one deterministic identity and unioned authority");
assert(fusedNode.workContract.goals.map(({ sourcePlanId }) => sourcePlanId).join(",") === "a,b,c" && fusedNode.workContract.validationCommands.map(({ args }) => args[0]).join(",") === "a,b,c", "fusion lost source order, source-plan provenance, or the exact covering validation manifest");
assert(JSON.stringify(deriveExecutionGraph(fused.packet).edges) === JSON.stringify([[fusedNode.id, "final-validation"]]), "fused graph did not preserve the final-validation boundary");
assert(compileSerialFixture("branch").packet.nodes.length === 4, "branching serial edge fused and delayed another successor");
assert(compileSerialFixture("join").packet.nodes.length === 4, "joining serial edge fused before its other predecessor");
assert(compileSerialFixture("kind-mismatch").packet.nodes.length === 3, "different work-unit kinds fused");
assert(compileSerialFixture("context-mismatch").packet.nodes.length === 3, "different coverage-normalized contexts fused");
assert(compileSerialFixture("validation-mismatch").packet.nodes.length === 3, "incompatible validation manifests fused");
const tierMismatch = structuredClone(compileSerialFixture("context-mismatch").packet);
tierMismatch.nodes[1].tier = { ...tierMismatch.nodes[1].tier, preferred: "tier1" };
assert(!validateExecutionPacket(tierMismatch).executable, "a same-kind packet with contradictory derived tiers reached executable fusion input");

const context = { objective: packet.objective, userContext: packet.userContext, discoveredRepoFacts: packet.discoveredRepoFacts, assumptions: packet.assumptions };
assert(renderWorkContractMarkdown(context, packet.nodes) === renderWorkContractMarkdown(context, packet.nodes), "Markdown is unstable");
assert(renderWorkContractMermaid(packet.nodes) === renderWorkContractMermaid(packet.nodes), "Mermaid is unstable");

for (const name of readdirSync("packages/fanout-core/src").filter((name) => name.endsWith(".ts"))) {
  const source = readFileSync(`packages/fanout-core/src/${name}`, "utf8");
  assert(!/from\s+["'][^"']*(?:fanout-pi|doubleword)/.test(source), `fanout-core ${name} imports Pi or Doubleword`);
}
const providerPackage = JSON.parse(readFileSync("packages/doubleword-provider/package.json", "utf8"));
assert(!JSON.stringify(providerPackage).includes("fanout-core") && !JSON.stringify(providerPackage).includes("fanout-pi"), "standalone Doubleword package depends on Fanout");

console.log("hardened compiler cutover smoke passed (plan v3, details v6, packet v9, package independence)");

function compileSerialFixture(shape) {
  const ids = shape === "branch" || shape === "join" || shape === "chain" ? ["a", "b", "c"] : ["a", "b"];
  const resources = Object.fromEntries(ids.map((id) => [id, { kind: "file", path: `src/${id}.ts` }]));
  const reads = {
    a: ids.filter((id) => id !== "a").map((id) => ({ id, timing: "baseline-context" })),
    b: [{ id: "a", timing: shape === "join" ? "baseline-context" : "post-change-required" }, ...(ids.includes("c") ? [{ id: "c", timing: "baseline-context" }] : [])],
    ...(ids.includes("c") ? { c: shape === "branch"
      ? [{ id: "a", timing: "post-change-required" }, { id: "b", timing: "baseline-context" }]
      : shape === "join"
        ? [{ id: "a", timing: "post-change-required" }, { id: "b", timing: "post-change-required" }]
        : [{ id: "a", timing: "baseline-context" }, { id: "b", timing: "post-change-required" }] } : {}),
  };
  if (shape === "context-mismatch") reads.a = [];
  const fixturePlan = {
    ...structuredClone(plan),
    planId: `fusion-${shape}`,
    implementationItems: ids.map((id) => ({
      id,
      goals: [`goal ${id}`],
      writeResources: [resources[id]],
      readResources: reads[id].map(({ id: readId }) => resources[readId]),
      forbiddenWrites: [],
      semanticReviewCriteria: [`criterion ${id}`],
      advisoryNotes: [],
    })),
  };
  const fixturePlanIdentity = artifactIdentity(`fusion-${shape}-plan.json`, Buffer.from(JSON.stringify(fixturePlan)));
  const manifests = {
    a: [{ executable: "rtk", args: ["a"] }],
    b: shape === "validation-mismatch" ? [{ executable: "rtk", args: ["b"] }] : [{ executable: "rtk", args: ["a"] }, { executable: "rtk", args: ["b"] }],
    c: [{ executable: "rtk", args: ["a"] }, { executable: "rtk", args: ["b"] }, { executable: "rtk", args: ["c"] }],
  };
  const fixtureDetails = {
    schema: "fanout.implementation-details",
    version: IMPLEMENTATION_DETAILS_VERSION,
    detailsId: `fusion-${shape}`,
    createdAt: "2026-07-14T00:01:00.000Z",
    plan: fixturePlanIdentity,
    items: ids.map((id) => ({
      id,
      kind: shape === "kind-mismatch" && id === "b" ? "test" : "implement",
      changes: [{ kind: "create", target: { resource: resources[id], sourcePlanIds: [id] }, contentIntent: `create ${id}` }],
      readDependencies: reads[id].map(({ id: readId, timing }) => ({ resource: resources[readId], timing, timingSource: "phase-b", sourcePlanIds: [id], reason: `read ${readId}` })),
      validationCommands: manifests[id],
      advisoryNotes: [],
    })),
    finalValidationCommands: [{ executable: "rtk", args: ["final"] }],
  };
  const fixtureDetailsIdentity = artifactIdentity(`fusion-${shape}-details.json`, Buffer.from(JSON.stringify(fixtureDetails)));
  const result = compileExecutionPacket({ implementationPlan: fixturePlan, implementationDetails: fixtureDetails, planIdentity: fixturePlanIdentity, detailsIdentity: fixtureDetailsIdentity, tierPlan, runtimePolicy, createdAt: "2026-07-14T00:02:00.000Z" });
  assert(result.packet, `${shape} fixture failed compilation: ${result.errors.join("; ")}`);
  return result;
}
