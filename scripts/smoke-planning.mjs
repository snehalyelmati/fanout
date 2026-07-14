import { readFileSync } from "node:fs";
import { buildImplementationDetailsPrompt, buildImplementationDetailsRepairPrompt, buildImplementationPlanPrompt, createFanoutPlanRun } from "../packages/fanout-pi/src/fanout-plan-orchestration.ts";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const phaseA = readFileSync("packages/fanout-pi/prompts/fanout-implementation-plan.md", "utf8");
const phaseB = readFileSync("packages/fanout-pi/prompts/fanout-implementation-details.md", "utf8");
for (const text of [phaseA, phaseB]) {
  assert(text.includes("fanout_submit_artifact"), "phase prompt omitted controller submission");
  assert(text.includes("controller supplies schema/version"), "phase prompt asks the model to own its envelope");
  assert(!/status.{0,8}ready|artifactDir|sourcePlanPath|ownedResources|forbiddenChanges|shell command|string\[\] of literal/i.test(text), "phase prompt retains legacy executable authority");
}
assert(phaseA.includes("writeResources") && phaseA.includes('"kind":"file"'), "Phase A omitted typed resources");
assert(phaseA.includes("Do not add a `final-validation` implementation item") && phaseA.includes("compiler-owned final-validation node"), "Phase A permits duplicate final-validation authority");
assert(phaseA.includes("packet-global") && phaseA.includes("worker ownership"), "Phase A does not explain monotonic forbidden-write scope");
assert(phaseB.includes('"changes"') && phaseB.includes('"executable"') && phaseB.includes('"args"'), "Phase B omitted typed changes/direct argv");
assert(phaseB.includes("packet-global") && phaseB.includes("worker ownership"), "Phase B does not explain monotonic forbidden-write scope");

const context = { projectArtifactRoot: "/tmp/fanout" };
const run = createFanoutPlanRun("Typed plan", context, new Date("2026-07-14T00:00:00.000Z"));
const planPrompt = buildImplementationPlanPrompt("Typed plan", { planningBase: { headCommit: "1".repeat(40), tree: "1".repeat(40) }, planningHost: { platform: process.platform } }, run);
const detailsPrompt = buildImplementationDetailsPrompt("Typed plan", {}, run, [{ readerPlanId: "a", readResource: { kind: "file", path: "a.ts" }, ownerPlanId: "b", ownerResource: { kind: "file", path: "a.ts" } }]);
assert(planPrompt.includes('"phase":"implementation"') && detailsPrompt.includes('"phase":"details"'), "typed pending phase attribution missing");
assert(detailsPrompt.includes("post-change-required") && detailsPrompt.includes('"readResource"'), "typed Phase B read checklist missing");
const repairPrompt = buildImplementationDetailsRepairPrompt("Typed plan", {}, run, [{ code: "planned-read-not-grounded", message: "diagnostic wording", path: "planned[0].readResources[0]" }]);
assert(repairPrompt.includes('"code": "planned-read-not-grounded"') && repairPrompt.includes('"path": "planned[0].readResources[0]"') && !repairPrompt.includes("planned-read-not-grounded:"), "repair prompt flattened structured compiler issues");

console.log("planning prompt smoke passed (plan v2/details v3 controller envelopes)");
