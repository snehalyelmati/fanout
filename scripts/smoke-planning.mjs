import { readFileSync } from "node:fs";
import { BATCHING_DISCIPLINE, BATCHING_DISCIPLINE_MARKER, PLANNING_BATCHING_DISCIPLINE } from "../packages/fanout-core/src/batching-discipline.ts";
import { CombinedPlanningBodySchema, DirectArgvCommandSchema, planningSchemaErrors } from "../packages/fanout-core/src/planning-artifact-schema.ts";
import { buildImplementationPlanPrompt, buildProjectExecutionProfilePrompt, createFanoutPlanRun } from "../packages/fanout-pi/src/fanout-plan-orchestration.ts";
import { validSubmission } from "./planning-boundary-fixtures.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
const planning = readFileSync("packages/fanout-pi/prompts/fanout-implementation-plan.md", "utf8");
const profile = readFileSync("packages/fanout-pi/prompts/fanout-execution-profile.md", "utf8");
assert(planningSchemaErrors(CombinedPlanningBodySchema, validSubmission()).length === 0, "combined planning fixture is not accepted by its tool schema");
assert(!planning.includes("```json"), "planning prompt duplicated the registered tool schema with a JSON example");
assert(profile.includes("`candidateNormalization`") && profile.includes("`requiredFinalGates`") && profile.includes("`networkAccess`") && profile.includes("grants no write authority"), "profile lost command disclosures");
assert(BATCHING_DISCIPLINE.includes(BATCHING_DISCIPLINE_MARKER), "worker batching marker missing");
assert(PLANNING_BATCHING_DISCIPLINE.includes("read-only") && PLANNING_BATCHING_DISCIPLINE.includes("fanout_submit_artifact alone") && !/edit|write|shell command|validation execution/i.test(PLANNING_BATCHING_DISCIPLINE), "planning batching widened tools");
assert(planningSchemaErrors(DirectArgvCommandSchema, { executable: "node", args: [], env: { "BAD-NAME": "x" } }).length > 0, "invalid environment key admitted");
const run = createFanoutPlanRun("Typed plan", { projectArtifactRoot: "/tmp/fanout" }, new Date("2026-07-14T00:00:00.000Z"));
const profilePrompt = buildProjectExecutionProfilePrompt("Typed plan", {}, run);
const profileInput = { identity: { path: "profiles/test.json", sha256: "c".repeat(64), byteLength: 1 }, profile: { requiredFinalGates: [{ command: { executable: "node", args: ["test.js"] } }] } };
const planPrompt = buildImplementationPlanPrompt("Typed plan", {}, { ...run, approvedProfile: profileInput });
assert(profilePrompt.includes('"phase":"profile"') && planPrompt.includes('"phase":"implementation"'), "planning phase attribution missing");
assert(planPrompt.includes(profileInput.identity.sha256) && planPrompt.includes('"requiredFinalGates"'), "planner did not receive the exact approved profile");
assert(!profilePrompt.includes("artifactDir") && !planPrompt.includes("resolvedTierPlan"), "planning retained generated runtime noise");
console.log("combined planning prompt smoke passed");
