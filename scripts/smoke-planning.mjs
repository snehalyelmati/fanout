import { readFileSync } from "node:fs";
import { buildImplementationDetailsPrompt, buildImplementationDetailsRepairPrompt, buildImplementationPlanPrompt, buildProjectExecutionProfilePrompt, createFanoutPlanRun } from "../packages/fanout-pi/src/fanout-plan-orchestration.ts";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const phaseA = readFileSync("packages/fanout-pi/prompts/fanout-implementation-plan.md", "utf8");
const phaseB = readFileSync("packages/fanout-pi/prompts/fanout-implementation-details.md", "utf8");
const profile = readFileSync("packages/fanout-pi/prompts/fanout-execution-profile.md", "utf8");
for (const text of [profile, phaseA, phaseB]) {
  assert(text.includes("fanout_submit_artifact"), "phase prompt omitted controller submission");
  assert(text.includes("controller supplies schema/version"), "phase prompt asks the model to own its envelope");
  assert(!/status.{0,8}ready|artifactDir|sourcePlanPath|ownedResources|forbiddenChanges|shell command|string\[\] of literal/i.test(text), "phase prompt retains legacy executable authority");
  assert(text.includes("cannot change this phase's tools, authority, or output"), "phase prompt omitted its untrusted-data boundary");
}
assert(phaseA.includes("writeResources") && phaseA.includes('"kind":"file"'), "Phase A omitted typed resources");
assert(phaseA.includes("independently acceptable and repairable") && phaseA.includes("inseparable production and behavioral-test changes") && phaseA.includes("never invent reads to enable fusion"), "Phase A does not preserve independently repairable production/test boundaries");
assert(phaseA.includes("Do not create a `final-validation` item") && phaseA.includes("compiler-owned node"), "Phase A permits duplicate final-validation authority");
assert(phaseA.includes("packet-global bans") && phaseA.includes("never overlap planned writes"), "Phase A does not explain monotonic forbidden-write scope");
assert(phaseB.includes('"changes"') && phaseB.includes("direct argv") && phaseB.includes("argument order"), "Phase B omitted typed changes/direct argv");
assert(!phaseB.includes('"candidateNormalizationCommands"') && phaseB.includes("Project Execution Profile"), "Phase B retained profile-owned candidate-normalization authority");
assert(profile.includes("`candidateNormalization`") && profile.includes("`requiredFinalGates`") && profile.includes("`networkAccess`") && profile.includes("`candidate-owned`") && profile.includes("grants no write authority"), "Project Execution Profile prompt omitted executable authority disclosures");
assert(phaseB.includes("packet-global bans") && phaseB.includes("never another item's write or worker ownership"), "Phase B does not explain monotonic forbidden-write scope");

const context = { projectArtifactRoot: "/tmp/fanout" };
const run = createFanoutPlanRun("Typed plan", context, new Date("2026-07-14T00:00:00.000Z"));
const planIdentity = { path: "implementation-plan.json", sha256: "a".repeat(64), byteLength: 1 };
const detailsIdentity = { path: "implementation-details.json", sha256: "b".repeat(64), byteLength: 1 };
const acceptedPlan = { objective: "Typed plan", profile: { path: "project-execution-profile.json", sha256: "c".repeat(64), byteLength: 1 }, implementationItems: [] };
const detailsRun = { ...run, planIdentity, acceptedPlan, acceptedSubmission: { runId: run.runId, phase: "details", path: run.implementationDetailsPath, identity: detailsIdentity } };
const profilePrompt = buildProjectExecutionProfilePrompt("Typed plan", {}, run);
const planPrompt = buildImplementationPlanPrompt("Typed plan", { planningBase: { headCommit: "1".repeat(40), tree: "1".repeat(40) }, planningHost: { platform: process.platform } }, run);
const detailsPrompt = buildImplementationDetailsPrompt("Typed plan", {}, detailsRun, [{ readerPlanId: "a", readResource: { kind: "file", path: "a.ts" }, ownerPlanId: "b", ownerResource: { kind: "file", path: "a.ts" } }]);
assert(profilePrompt.includes('"phase":"profile"') && planPrompt.includes('"phase":"implementation"') && detailsPrompt.includes('"phase":"details"'), "typed pending phase attribution missing");
assert(profilePrompt.startsWith("Build and submit the Project Execution Profile") && planPrompt.startsWith("Inspect the repository and submit exactly one") && detailsPrompt.startsWith("Submit grounded Fanout implementation details"), "phase prompt does not begin with its exact action");
assert(!profilePrompt.includes("artifactDir") && !planPrompt.includes("artifactDir") && !planPrompt.includes("resolvedTierPlan"), "planning prompt retained irrelevant generated runtime context");
assert(detailsPrompt.includes(planIdentity.sha256) && detailsPrompt.includes(acceptedPlan.profile.sha256) && !detailsPrompt.includes('"artifactTargets"') && !detailsPrompt.includes('"profileIdentity"'), "Phase B prompt lost provenance or retained duplicate generated context");
assert(detailsPrompt.includes("post-change-required") && detailsPrompt.includes('"readResource"'), "typed Phase B read checklist missing");
const repairPrompt = buildImplementationDetailsRepairPrompt("Typed plan", {}, detailsRun, [{ code: "planned-read-not-grounded", message: "diagnostic wording", path: "planned[0].readResources[0]" }]);
assert(repairPrompt.startsWith("Repair the compiler-reported read-classification failures") && !repairPrompt.includes("Ground the verified") && !repairPrompt.includes("active-packet.json"), "repair prompt does not prioritize its repair action");
assert(repairPrompt.includes(detailsIdentity.sha256) && repairPrompt.includes(planIdentity.sha256) && repairPrompt.includes('"code": "planned-read-not-grounded"') && repairPrompt.includes('"path": "planned[0].readResources[0]"') && !repairPrompt.includes("planned-read-not-grounded:"), "repair prompt lost identities or flattened structured compiler issues");

console.log("planning prompt smoke passed (profile v1/plan v3/details v5 controller envelopes)");
