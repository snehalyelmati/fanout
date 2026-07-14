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
const plan = {
  schema: "fanout.implementation-plan", version: IMPLEMENTATION_PLAN_VERSION, planId: "plan-1", createdAt: "2026-07-14T00:00:00.000Z",
  planningHost: { platform: process.platform }, planningBase: { headCommit: hash, tree: hash }, objective: "Add the checked feature",
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
const normalizationCommands = [{ executable: "normalizer", args: ["--first"] }, { executable: "normalizer", args: ["--second"] }];

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
  candidateNormalizationCommands: normalizationCommands,
  items: [{
    id: "feature", kind: "implement",
    changes: [{ kind: "create", target: { resource: { kind: "file", path: "src/feature.ts" }, sourcePlanIds: ["feature"] }, contentIntent: "feature implementation" }],
    readDependencies: [{ resource: { kind: "file", path: "package.json" }, timing: "baseline-context", timingSource: "phase-b", sourcePlanIds: ["feature"], reason: "package metadata" }],
    forbiddenWrites: [], validationCommands: [command], advisoryNotes: [{ kind: "context", reference: "feature", text: "grounded source" }],
  }],
  finalValidationCommands: [command, command],
};
const detailsIdentity = artifactIdentity("implementation-details.json", Buffer.from(`${JSON.stringify(details, null, 2)}\n`));
const tier = (provider, model, status = "available") => ({ provider, model, thinking: "medium", source: "test", status, reason: "test" });
const tierPlan = { tier1: tier("local", "one"), tier2: { ...tier("local", "two", "unavailable"), fallback: "tier1" }, tier2Fallback: tier("local", "fallback") };

assert(validateImplementationPlan(plan).ok, "plan v2 rejected");
assert(validateImplementationDetailsArtifact(details, { planIdentity, planIds: ["feature"] }).ok, "details v4 rejected");
const missingNormalization = structuredClone(details); delete missingNormalization.candidateNormalizationCommands;
assert(!validateImplementationDetailsArtifact(missingNormalization, { planIdentity, planIds: ["feature"] }).ok, "details v4 admitted a missing repository normalization list");
const perItemNormalization = structuredClone(details); perItemNormalization.items[0].candidateNormalizationCommands = normalizationCommands;
assert(!validateImplementationDetailsArtifact(perItemNormalization, { planIdentity, planIds: ["feature"] }).ok, "details v4 admitted per-item normalization authority");
const crossOwnerPlan = structuredClone(plan);
crossOwnerPlan.implementationItems.push({
  ...structuredClone(plan.implementationItems[0]),
  id: "feature-tests",
  writeResources: [{ kind: "file", path: "test/feature.test.ts" }],
  forbiddenWrites: [],
});
const crossOwnerPlanIdentity = artifactIdentity("implementation-plan.json", Buffer.from(`${JSON.stringify(crossOwnerPlan, null, 2)}\n`));
const packetGlobalForbiddenDetails = structuredClone(details);
packetGlobalForbiddenDetails.plan = crossOwnerPlanIdentity;
packetGlobalForbiddenDetails.items.push({
  id: "feature-tests", kind: "implement",
  changes: [{ kind: "create", target: { resource: { kind: "file", path: "test/feature.test.ts" }, sourcePlanIds: ["feature-tests"] }, contentIntent: "feature coverage" }],
  readDependencies: [],
  forbiddenWrites: [{ resource: { kind: "file", path: "src/feature.ts" }, sourcePlanIds: ["feature-tests"], reason: "A different worker owns implementation." }],
  validationCommands: [command], advisoryNotes: [],
});
const packetGlobalForbiddenDetailsResult = validateImplementationDetailsArtifact(packetGlobalForbiddenDetails, { planIdentity: crossOwnerPlanIdentity, plan: crossOwnerPlan });
assert(!packetGlobalForbiddenDetailsResult.ok && packetGlobalForbiddenDetailsResult.errors.some((error) => error.includes("packet-global") && error.includes("worker ownership")), "Phase B admitted a forbidden write that cancels planned write authority");
assert(!validateImplementationPlan({ ...plan, version: 1 }).ok, "legacy plan v1 admitted");
assert(!validateImplementationDetailsArtifact({ ...details, version: 3 }, { planIdentity }).ok, "legacy details v3 admitted");
assert(!validateImplementationDetailsArtifact({ ...details, plan: { ...planIdentity, sha256: "2".repeat(64) } }, { planIdentity }).ok, "mixed plan/details identity admitted");
const duplicateFinalValidation = validateImplementationDetailsArtifact({
  ...details,
  items: [...details.items, {
    id: "final-validation", kind: "final-validation", changes: [],
    readDependencies: [{ resource: { kind: "file", path: "src/feature.ts" }, timing: "post-change-required", timingSource: "phase-b", sourcePlanIds: ["feature"], reason: "integrated validation input" }],
    forbiddenWrites: [], validationCommands: [command], advisoryNotes: [],
  }],
}, { planIdentity, planIds: ["feature"] });
assert(!duplicateFinalValidation.ok && duplicateFinalValidation.errors.some((error) => error.includes("finalValidationCommands")), "duplicate Phase B final-validation authority was admitted");

const runtimePolicy = { maxConcurrency: 2, failFast: false, fallbackAllowed: true };
const compiled = compileExecutionPacket({ implementationPlan: plan, implementationDetails: details, planIdentity, detailsIdentity, tierPlan, runtimePolicy, createdAt: "2026-07-14T00:02:00.000Z" });
assert(compiled.ok && compiled.packet, `compile failed: ${compiled.errors.join("; ")}`);
const packet = compiled.packet;
assert(packet.version === EXECUTION_PACKET_VERSION && packet.version === 6, "packet is not v6");
assert(packet.nodes.length === 2 && packet.nodes.at(-1).kind === "final-validation", "canonical nodes/final validation missing");
assert(packet.nodes.every((node) => JSON.stringify(node.workContract.candidateNormalizationCommands) === JSON.stringify(normalizationCommands)), "repository normalization list was not copied into every packet contract");
assert(packet.nodes.at(-1).workContract.validationCommands.length === 2, "command order/duplicates were not preserved");
assert(JSON.stringify(packet.runtimePolicy) === JSON.stringify(runtimePolicy), "immutable runtime policy was not stored in packet v6");
const forbidden = ["artifactDir", "blockers", "workUnits", "estimates", "stopRules", "risks", "finalValidationPlan", "goal", "dependencies", "ownedFiles", "readOnlyFiles", "steps", "validationCommands", "acceptanceCriteria", "rollbackNotes", "workerPacket"];
assert(!forbidden.some((key) => Object.hasOwn(packet, key) || packet.nodes.some((node) => Object.hasOwn(node, key))), "packet retains flattened legacy authority");
assert(validateExecutionPacket(packet).executable, "packet v6 rejected");
assert(!validateExecutionPacket({ ...packet, version: 5 }).executable, "packet v5 admitted");
assert(!validateExecutionPacket({ ...packet, status: "ready" }).executable, "legacy status field admitted");
assert(!validateExecutionPacket({ ...packet, runtimePolicy: { ...packet.runtimePolicy, maxConcurrency: 0 } }).executable, "invalid packet runtime policy admitted");
assert(EXECUTION_RUN_VERSION === 3 && SHIM_EVENT_NAMES.length === 9, "execution-run compatibility subpath exposed legacy runtime authority");
const graph = deriveExecutionGraph(packet);
assert(JSON.stringify(graph.edges) === JSON.stringify([["feature", "final-validation"]]), "graph was not derived from contracts");
const context = { objective: packet.objective, userContext: packet.userContext, discoveredRepoFacts: packet.discoveredRepoFacts, assumptions: packet.assumptions };
assert(renderWorkContractMarkdown(context, packet.nodes) === renderWorkContractMarkdown(context, packet.nodes), "Markdown is unstable");
assert(renderWorkContractMermaid(packet.nodes) === renderWorkContractMermaid(packet.nodes), "Mermaid is unstable");

for (const name of readdirSync("packages/fanout-core/src").filter((name) => name.endsWith(".ts"))) {
  const source = readFileSync(`packages/fanout-core/src/${name}`, "utf8");
  assert(!/from\s+["'][^"']*(?:fanout-pi|doubleword)/.test(source), `fanout-core ${name} imports Pi or Doubleword`);
}
const providerPackage = JSON.parse(readFileSync("packages/doubleword-provider/package.json", "utf8"));
assert(!JSON.stringify(providerPackage).includes("fanout-core") && !JSON.stringify(providerPackage).includes("fanout-pi"), "standalone Doubleword package depends on Fanout");

console.log("hardened compiler cutover smoke passed (plan v2, details v4, packet v6, package independence)");
