import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadActiveExecutionPacket, validateActivePacketPointer } from "../packages/fanout-core/src/active-packet.ts";
import { artifactIdentity } from "../packages/fanout-core/src/artifact-identity.ts";
import { compileExecutionPacket } from "../packages/fanout-core/src/fanout-compiler.ts";
import { validateExecutionPacket } from "../packages/fanout-core/src/execution-packet.ts";
import { publishExecutionPacket } from "../packages/fanout-pi/src/planning-publication.ts";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const root = mkdtempSync(join(tmpdir(), "fanout-v10-packet-"));
try {
  const runDir = join(root, "run"); mkdirSync(runDir);
  const git = "1".repeat(40);
  const profileBytes = Buffer.from(JSON.stringify({ schema: "fanout.project-execution-profile", version: 1, profileId: "test", createdAt: new Date(0).toISOString(), preparation: [], readiness: [], candidateNormalization: [], requiredFinalGates: [] }));
  const profileIdentity = artifactIdentity("profiles/test.json", profileBytes);
  mkdirSync(join(root, "profiles")); writeFileSync(join(root, profileIdentity.path), profileBytes);
  const plan = { schema: "fanout.implementation-plan", version: 4, planId: "p", createdAt: new Date(0).toISOString(), planningHost: { platform: process.platform }, planningBase: { headCommit: git, tree: git }, profile: profileIdentity, objective: "x", userContext: [], discoveredRepoFacts: [], assumptions: [], implementationItems: [{ id: "x", goals: ["x"], writeResources: [{ kind: "file", path: "x.ts" }], readResources: [], forbiddenWrites: [], semanticReviewCriteria: ["x"], advisoryNotes: [] }] };
  const planIdentity = artifactIdentity("implementation-plan.json", Buffer.from(JSON.stringify(plan)));
  const command = { executable: "node", args: ["--version"] };
  const details = { schema: "fanout.implementation-details", version: 8, detailsId: "p", createdAt: new Date(0).toISOString(), plan: planIdentity, items: [{ id: "x", kind: "implement", changes: [{ kind: "create", target: { resource: { kind: "file", path: "x.ts" }, sourcePlanIds: ["x"] }, contentIntent: "x" }], readDependencies: [], validationCommands: [command, { ...command, args: ["--help"], env: { LITERAL: "a b" } }, command], advisoryValidationMode: "collect-independent", advisoryNotes: [] }], finalValidationCommands: [command] };
  const detailsIdentity = artifactIdentity("implementation-details.json", Buffer.from(JSON.stringify(details)));
  const summary = { provider: "p", model: "m", thinking: "off", source: "test", status: "available", reason: "test" };
  const result = compileExecutionPacket({ implementationPlan: plan, implementationDetails: details, planIdentity, detailsIdentity, tierPlan: { tier1: summary, tier2: { ...summary, status: "unavailable", fallback: "tier1" }, tier2Fallback: summary }, runtimePolicy: { maxConcurrency: 2, failFast: false, fallbackAllowed: true }, createdAt: new Date(0).toISOString() });
  assert(result.packet, result.errors.join("; "));
  const legacyPacketV8 = { ...structuredClone(result.packet), version: 8 };
  const legacyPacketV8Bytes = JSON.stringify(legacyPacketV8);
  assert(!validateExecutionPacket(legacyPacketV8).executable && JSON.stringify(legacyPacketV8) === legacyPacketV8Bytes, "legacy packet v8 was executable or mutated during rejection");
  assert(!validateExecutionPacket({ ...result.packet, version: 10 }).executable, "previous packet generation retained execution authority");
  const malformedNode = structuredClone(result.packet); malformedNode.nodes[0].workContract = null;
  assert(!validateExecutionPacket(malformedNode).ok, "malformed node contract was silently dropped");
  const legacyContract = structuredClone(result.packet); legacyContract.nodes[0].workContract.version = 5;
  assert(!validateExecutionPacket(legacyContract).ok, "packet v11 admitted a legacy work-contract v5 node");
  const independentFinal = structuredClone(result.packet); independentFinal.nodes.at(-1).workContract.advisoryValidationMode = "collect-independent";
  assert(!validateExecutionPacket(independentFinal).ok, "final validation acquired advisory independence");
  const packetNormalizer = structuredClone(result.packet); packetNormalizer.nodes[0].workContract.candidateNormalizationCommands = [];
  assert(!validateExecutionPacket(packetNormalizer).ok, "packet admission accepted profile-owned normalization authority");
  const renamedFinal = structuredClone(result.packet); renamedFinal.nodes.find((node) => node.kind === "final-validation").id = "renamed-final";
  const renamedFinalValidation = validateExecutionPacket(renamedFinal);
  assert(!renamedFinalValidation.ok && renamedFinalValidation.errors.some((error) => error.code === "invalid-final-validation-id"), "packet admission accepted a renamed final-validation node");
  const reservedOrdinary = structuredClone(result.packet); reservedOrdinary.nodes[0].id = "final-validation";
  const reservedOrdinaryValidation = validateExecutionPacket(reservedOrdinary);
  assert(!reservedOrdinaryValidation.ok && reservedOrdinaryValidation.errors.some((error) => error.code === "reserved-node-id"), "packet admission accepted an ordinary node under the reserved final-validation id");
  const unavailableTier = structuredClone(result.packet);
  unavailableTier.nodes[0].tier = { preferred: "tier2", assigned: "tier2", fallback: "tier1", provider: "substituted", model: "substituted", thinking: "off", reason: "substituted" };
  unavailableTier.nodes[0].active = "background";
  assert(validateExecutionPacket(unavailableTier).errors.some((error) => error.code === "tier-assignment-plan-mismatch"), "packet admission accepted an unavailable and substituted node tier assignment");
  const downgradedOrdinary = structuredClone(result.packet);
  downgradedOrdinary.nodes[0].tier = structuredClone(downgradedOrdinary.nodes.at(-1).tier);
  downgradedOrdinary.nodes[0].active = "active";
  assert(validateExecutionPacket(downgradedOrdinary).errors.some((error) => error.code === "tier-assignment-plan-mismatch"), "packet admission accepted a coherent Tier 1 downgrade for a Tier 2 ordinary kind");
  const substitutedController = structuredClone(result.packet);
  substitutedController.nodes.at(-1).tier.provider = "substituted";
  assert(validateExecutionPacket(substitutedController).errors.some((error) => error.code === "tier-assignment-plan-mismatch"), "packet admission accepted a final-validation provider outside the tier plan");
  const missingUnavailableFallback = structuredClone(result.packet);
  delete missingUnavailableFallback.tierPlan.tier2.fallback;
  assert(validateExecutionPacket(missingUnavailableFallback).errors.some((error) => error.code === "invalid-tier-fallback-policy"), "packet admission accepted unavailable tier2 without the declared tier1 fallback");
  writeFileSync(join(runDir, planIdentity.path), JSON.stringify(plan));
  writeFileSync(join(runDir, detailsIdentity.path), JSON.stringify(details));
  const paths = publishExecutionPacket(result.packet, root, runDir, join(root, "active-packet.json"));
  const loaded = loadActiveExecutionPacket(paths.activePointerPath, root);
  assert(loaded.packet.version === 11 && loaded.pointer.version === 2 && loaded.packet.compilationPolicy.sequentialReadFallback === false, "v11/v2 tuple did not load");
  assert(loaded.packet.nodes.every((node) => !Object.hasOwn(node.workContract, "candidateNormalizationCommands")), "packet retained profile normalization");
  const historical = JSON.stringify({ schema: "fanout.active-packet", version: 1, updatedAt: "old", packetPath: paths.packetPath });
  writeFileSync(join(root, "legacy-pointer.json"), historical);
  assert(!validateActivePacketPointer(JSON.parse(historical)).ok, "legacy pointer v1 admitted");
  assert(readFileSync(join(root, "legacy-pointer.json"), "utf8") === historical, "legacy bytes changed during rejection");
  for (const policy of [undefined, {}, { sequentialReadFallback: "true" }, { sequentialReadFallback: false, extra: true }]) {
    assert(!validateExecutionPacket({ ...result.packet, compilationPolicy: policy }).ok, "malformed compilation policy admitted");
  }
  const rejectPublished = (packet, pattern) => {
    publishExecutionPacket(packet, root, runDir, paths.activePointerPath);
    let error;
    try { loadActiveExecutionPacket(paths.activePointerPath, root); } catch (caught) { error = String(caught); }
    assert(error && pattern.test(error), `expected ${pattern}, got ${error}`);
  };
  for (const mutate of [
    (packet) => { packet.nodes[0].workContract.advisoryValidationMode = "fail-fast"; },
    (packet) => { const commands = packet.nodes[0].workContract.validationCommands; [commands[0], commands[1]] = [commands[1], commands[0]]; },
    (packet) => { packet.nodes[0].workContract.validationCommands[0].args = ["--different"]; },
    (packet) => { packet.nodes[0].workContract.validationCommands.push(command); },
    (packet) => { packet.nodes[0].workContract.validationCommands[1].env.LITERAL = "changed"; },
    (packet) => { packet.nodes[0].workContract.validationCommands[1].cwd = "nested"; },
    (packet) => { packet.nodes[0].id = "borrowed-node"; },
  ]) {
    const changed = structuredClone(result.packet); mutate(changed);
    rejectPublished(changed, /provenance node\/command\/policy mismatch/);
  }
  for (const identity of [planIdentity, detailsIdentity]) {
    const path = join(runDir, identity.path); const original = readFileSync(path);
    rmSync(path); rejectPublished(result.packet, /ENOENT/);
    writeFileSync(path, `${original} `); rejectPublished(result.packet, /length mismatch/);
    writeFileSync(path, Buffer.alloc(original.length, 32)); rejectPublished(result.packet, /SHA-256 mismatch/);
    rmSync(path); writeFileSync(join(root, `outside-${identity.path}`), original);
    symlinkSync(join(root, `outside-${identity.path}`), path); rejectPublished(result.packet, /escapes its root/);
    rmSync(path); writeFileSync(path, original);
  }
  const wrongPlanDetails = Buffer.from(JSON.stringify({ ...details, plan: { ...planIdentity, sha256: "2".repeat(64) } }));
  writeFileSync(join(runDir, detailsIdentity.path), wrongPlanDetails);
  rejectPublished({ ...result.packet, sourceArtifacts: { plan: planIdentity, details: artifactIdentity(detailsIdentity.path, wrongPlanDetails) } }, /details plan identity does not match/);
  writeFileSync(join(runDir, detailsIdentity.path), JSON.stringify(details));
  const otherProfile = artifactIdentity("profiles/other.json", profileBytes);
  writeFileSync(join(root, otherProfile.path), profileBytes);
  rejectPublished({ ...result.packet, profile: otherProfile }, /provenance profile identity mismatch/);
  writeFileSync(join(root, profileIdentity.path), Buffer.alloc(profileBytes.length, 32));
  rejectPublished(result.packet, /SHA-256 mismatch/);
  writeFileSync(join(root, profileIdentity.path), profileBytes);
  publishExecutionPacket(result.packet, root, runDir, paths.activePointerPath);
  writeFileSync(paths.packetPath, `${readFileSync(paths.packetPath, "utf8")} `);
  let rejected = false; try { loadActiveExecutionPacket(paths.activePointerPath, root); } catch { rejected = true; }
  assert(rejected, "mutated packet bytes were admitted");
  const compilePair = (sourcePlan, sourceDetails) => {
    const planBytes = Buffer.from(JSON.stringify(sourcePlan));
    const pairPlanIdentity = artifactIdentity(planIdentity.path, planBytes);
    const detailsBytes = Buffer.from(JSON.stringify({ ...sourceDetails, plan: pairPlanIdentity }));
    writeFileSync(join(runDir, planIdentity.path), planBytes);
    writeFileSync(join(runDir, detailsIdentity.path), detailsBytes);
    const compiled = compileExecutionPacket({ implementationPlan: sourcePlan, implementationDetails: JSON.parse(detailsBytes), planIdentity: pairPlanIdentity, detailsIdentity: artifactIdentity(detailsIdentity.path, detailsBytes), profile: JSON.parse(profileBytes), tierPlan: result.packet.tierPlan, runtimePolicy: result.packet.runtimePolicy });
    assert(compiled.packet, compiled.errors.join("; "));
    publishExecutionPacket(compiled.packet, root, runDir, paths.activePointerPath);
    assert(loadActiveExecutionPacket(paths.activePointerPath, root).packet.nodes.length === compiled.packet.nodes.length, "published source pair did not admit");
    return compiled.packet;
  };
  const twoPlan = structuredClone(plan);
  twoPlan.implementationItems.push({ ...structuredClone(plan.implementationItems[0]), id: "y", writeResources: [{ kind: "file", path: "y.ts" }] });
  const twoDetails = structuredClone(details);
  twoDetails.items.push({ ...structuredClone(details.items[0]), id: "y", changes: [{ kind: "create", target: { resource: { kind: "file", path: "y.ts" }, sourcePlanIds: ["y"] }, contentIntent: "y" }], advisoryValidationMode: "fail-fast" });
  const separate = compilePair(twoPlan, twoDetails);
  const borrowed = structuredClone(separate);
  borrowed.nodes[1].workContract.advisoryValidationMode = "collect-independent";
  rejectPublished(borrowed, /provenance node\/command\/policy mismatch/);
  const reordered = structuredClone(separate); [reordered.nodes[0], reordered.nodes[1]] = [reordered.nodes[1], reordered.nodes[0]];
  rejectPublished(reordered, /provenance node\/command\/policy mismatch/);
  twoDetails.items[1].advisoryValidationMode = "collect-independent";
  const mergedPlan = structuredClone(plan); mergedPlan.implementationItems[0].writeResources.push({ kind: "file", path: "y.ts" });
  const mergedDetails = structuredClone(twoDetails); mergedDetails.items[1].changes[0].target.sourcePlanIds = ["x"];
  const merged = compilePair(mergedPlan, mergedDetails);
  assert(merged.nodes.length === 2 && merged.nodes[0].workContract.advisoryValidationMode === "fail-fast", "merge widened continuation authority");
  merged.nodes[0].workContract.advisoryValidationMode = "collect-independent";
  rejectPublished(merged, /provenance node\/command\/policy mismatch/);
  for (const [index, other, timing] of [[0, "y", "baseline-context"], [1, "x", "post-change-required"]]) {
    const resource = { kind: "file", path: `${other}.ts` };
    twoPlan.implementationItems[index].readResources = [resource];
    twoDetails.items[index].readDependencies = [{ resource, timing, timingSource: "phase-b", sourcePlanIds: [twoDetails.items[index].id], reason: "shared context" }];
  }
  const fused = compilePair(twoPlan, twoDetails);
  assert(fused.nodes.length === 2 && fused.nodes[0].id.startsWith("fused-") && fused.nodes[0].workContract.advisoryValidationMode === "fail-fast", "fusion changed eligibility or widened continuation");
  fused.nodes[0].workContract.advisoryValidationMode = "collect-independent";
  rejectPublished(fused, /provenance node\/command\/policy mismatch/);
  console.log("hardened pointer/packet smoke passed (A4, A5, A18)");
} finally { rmSync(root, { recursive: true, force: true }); }
