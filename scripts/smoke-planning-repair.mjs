import { deepStrictEqual, rejects, throws } from "node:assert/strict";
import { getCurrentTools, validateToolArguments } from "@earendil-works/pi-ai";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repairPlanningDraft, retainPlanningDraft, submitPlanningArtifact } from "../packages/fanout-pi/src/planning-capabilities.ts";
import { assert, extensionHarness, phaseState, sdkPlanningSession, validSubmission } from "./planning-boundary-fixtures.mjs";

export async function testPlanningRepair(root, extension) {
  const repository = join(root, "repair-repo");
  mkdirSync(repository);
  const state = phaseState(repository, join(root, "repair-artifacts"), join(root, "repair-artifacts/run"), "implementation");
  const body = validSubmission();
  body.details.items[0].id = "grounded-first";
  body.plan.implementationItems.push({ ...structuredClone(body.plan.implementationItems[0]), id: "other", writeResources: [{ kind: "file", path: "other.md" }] });
  body.details.items.push({ ...structuredClone(body.details.items[0]), id: "grounded-other", changes: [{ ...structuredClone(body.details.items[0].changes[0]), target: { resource: { kind: "file", path: "other.md" }, sourcePlanIds: ["other"] } }] });
  const draft = retainPlanningDraft(body);
  const original = structuredClone(draft);
  const detail = structuredClone(body.details.items[0]);
  detail.changes[0].intent = "Updated intent";
  const correction = { revision: 1, replacePlanItems: [], replaceDetailItems: [detail] };
  for (const [input, error] of [
    [{ ...correction, revision: 2 }, /Stale/],
    [{ ...correction, replaceDetailItems: [detail, detail] }, /Duplicate/],
    [{ ...correction, replaceDetailItems: [detail, { ...detail, id: "missing" }] }, /Unknown/],
    [{ ...correction, replacePlanItems: [{ ...body.plan.implementationItems[0], goals: ["changed"] }], replaceDetailItems: [{ ...detail, id: "missing" }] }, /Unknown/],
    [{ ...correction, replaceDetailItems: [] }, /must change/],
    [{ ...correction, replaceDetailItems: [Object.fromEntries(Object.entries(body.details.items[0]).reverse())] }, /must change/],
    [{ ...correction, objective: "changed" }, /additional properties/],
  ]) {
    throws(() => repairPlanningDraft(draft, input), error);
    deepStrictEqual(draft, original, "rejected batch partially mutated the draft");
  }
  throws(() => retainPlanningDraft({ plan: {} }), /required properties/);
  throws(() => retainPlanningDraft({ ...body, details: { ...body.details, items: [detail, detail] } }), /unique/);
  const repaired = repairPlanningDraft(draft, correction);
  deepStrictEqual(repaired.body.plan, original.body.plan);
  deepStrictEqual(repaired.body.details.items, [detail, original.body.details.items[1]]);
  assert(repaired.revision === 2, "revision did not advance exactly once");
  detail.changes[0].target.resource.path = "new.md";
  const unauthorized = repairPlanningDraft(draft, correction);
  throws(() => submitPlanningArtifact(state, unauthorized.body, repository), /write-not-authorized/);
  const planItem = { ...body.plan.implementationItems[0], writeResources: [{ kind: "file", path: "new.md" }] };
  const coordinated = repairPlanningDraft(unauthorized, { revision: 2, replacePlanItems: [planItem], replaceDetailItems: [] });
  assert(submitPlanningArtifact(state, coordinated.body, repository).compiled.ok, "coordinated scope/grounding correction failed");
  const atomicCorrection = repairPlanningDraft(draft, { ...correction, replacePlanItems: [planItem] });
  deepStrictEqual(atomicCorrection.body, {
    plan: { ...body.plan, implementationItems: [planItem, body.plan.implementationItems[1]] },
    details: { ...body.details, items: [detail, body.details.items[1]] },
  }, "joint scope/detail batch changed untouched records or lost replacements");
  const conflict = structuredClone(body.details.items[1]);
  conflict.changes[0].target = { resource: { kind: "file", path: "new.md" }, sourcePlanIds: ["code"] };
  const conflicted = repairPlanningDraft(coordinated, { revision: 3, replacePlanItems: [], replaceDetailItems: [conflict] });
  throws(() => submitPlanningArtifact(state, conflicted.body, repository), /overlap|owner|grounded|coverage/i);

  const reads = structuredClone(body);
  reads.plan.implementationItems[0].readResources = [{ kind: "file", path: "other.md" }];
  reads.plan.implementationItems[1].readResources = [{ kind: "file", path: "README.md" }];
  for (const [index, item] of reads.details.items.entries()) item.readDependencies = [{ resource: reads.plan.implementationItems[index].readResources[0], sourcePlanIds: [reads.plan.implementationItems[index].id], timing: index === 0 ? "baseline-context" : "post-change-required", timingSource: "phase-b", reason: "Read the declared source" }];
  const readDraft = retainPlanningDraft(reads);
  const cycleItem = structuredClone(reads.details.items[0]);
  cycleItem.readDependencies[0].timing = "post-change-required";
  const cycle = repairPlanningDraft(readDraft, { revision: 1, replacePlanItems: [], replaceDetailItems: [cycleItem] });
  throws(() => submitPlanningArtifact(state, cycle.body, repository), /cycle/i);
  reads.details.items[0].readDependencies = [];
  reads.details.items[1].readDependencies = [];
  reads.plan.implementationItems[0].readResources = [];
  const fallback = retainPlanningDraft(reads);
  throws(() => submitPlanningArtifact(state, fallback.body, repository), /planned-read-not-grounded/);
  assert(state.repairAttempted, "read fallback not armed");
  const changedPlan = structuredClone(reads.plan.implementationItems[0]);
  changedPlan.goals = ["Changed semantic goal"];
  const resetFallback = repairPlanningDraft(fallback, { revision: 1, replacePlanItems: [changedPlan], replaceDetailItems: [] });
  throws(() => submitPlanningArtifact(state, resetFallback.body, repository), /planned-read-not-grounded/);
  const fallbackRepair = repairPlanningDraft(resetFallback, { revision: 2, replacePlanItems: [], replaceDetailItems: [], finalValidationCommands: [] });
  assert(submitPlanningArtifact(state, fallbackRepair.body, repository).compiled.ok, "same-plan typed correction lost sequential read fallback");

  for (const event of ["session_shutdown", "session_before_switch", "session_before_fork"]) {
    const harness = await extensionHarness(root, extension, `repair-${event}`, false);
    harness.handler("before_agent_start")({ systemPrompt: "base" }, harness.ctx);
    const bad = validSubmission();
    bad.details.items[0].changes[0].target.resource.path = "unowned.md";
    await rejects(() => harness.submit.execute("initial", { artifact: bad }, undefined, undefined, harness.ctx), /Retained draft revision 1/);
    harness.handler(event)({}, harness.ctx);
    await rejects(() => harness.submit.execute("stale", { artifact: correction }, undefined, undefined, harness.ctx), /No matching/);
    await harness.handler("agent_settled")({}, harness.ctx);
    assert(!existsSync(harness.activePointerPath) && harness.activeTools.includes("bash"), `${event}: retained draft escaped reset`);
  }

  const profile = await extensionHarness(root, extension, "repair-profile-tamper", false);
  profile.handler("before_agent_start")({ systemPrompt: "base" }, profile.ctx);
  await profile.submit.execute("accepted", { artifact: validSubmission() }, undefined, undefined, profile.ctx);
  const identity = JSON.parse(readFileSync(profile.activeProfilePath)).profile;
  writeFileSync(join(profile.activeProfilePath, "..", identity.path), "{}");
  await profile.handler("agent_settled")({}, profile.ctx);
  assert(!existsSync(profile.activePointerPath), "profile tampering was accepted at settlement");

  const refreshing = await extensionHarness(root, extension, "repair-profile-cancel", false, true, "--refresh-profile Test");
  refreshing.handler("before_agent_start")({ systemPrompt: "base" }, refreshing.ctx);
  const profileBody = { preparation: [], readiness: [], candidateNormalization: [], requiredFinalGates: [] };
  const validate = (args) => validateToolArguments(refreshing.submit, { name: "fanout_submit_artifact", arguments: refreshing.submit.prepareArguments(args) });
  const encodedProfile = { artifact: JSON.stringify(profileBody) };
  deepStrictEqual(validate(encodedProfile), { artifact: profileBody });
  assert(typeof encodedProfile.artifact === "string", "argument preparation mutated the original tool call");
  for (const artifact of ["null", "[]", "true", "42", JSON.stringify(JSON.stringify(profileBody)), JSON.stringify({ ...profileBody, extra: true })]) throws(() => validate({ artifact }), /Validation failed/);
  throws(() => validate({ artifact: "{" }), /artifact contains malformed JSON/);
  throws(() => validate({ artifact: JSON.stringify(profileBody), extra: true }), /Validation failed/);
  await refreshing.submit.execute("profile", { artifact: { preparation: [], readiness: [], candidateNormalization: [], requiredFinalGates: [] } }, undefined, undefined, refreshing.ctx);
  let approve;
  refreshing.ctx.ui.confirm = () => new Promise((resolve) => { approve = resolve; });
  const settling = refreshing.handler("agent_settled")({}, refreshing.ctx);
  refreshing.handler("session_before_switch")({}, refreshing.ctx);
  approve(true);
  await settling;
  assert(refreshing.messages.length === 1 && !existsSync(refreshing.activePointerPath), "stale profile approval restarted planning");
  for (const scenario of ["success", "schema-budget", "plan-budget", "second-repair", "stale-revision-recovery", "malformed-initial", "length-initial", "cancel-repair", "compact-repair", "encoded-repair", "malformed-json-initial", "malformed-json-budget"]) await testSdkRepair(root, extension, scenario);
}

async function testSdkRepair(root, extension, scenario) {
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  let settled = 0;
  let executeCalls = 0;
  let calls = 0;
  let cancelling;
  const events = [];
  const runtime = await sdkPlanningSession(root, scenario, extension, (pi) => {
    pi.on("agent_settled", () => { settled++; });
    pi.on("tool_call", ({ toolName }) => { if (toolName === "fanout_submit_artifact") executeCalls++; });
    pi.on("session_before_compact", (event) => ({ compaction: { summary: "Planning was rejected; repair the retained revision.", firstKeptEntryId: event.branchEntries.at(-1).id, tokensBefore: event.preparation.tokensBefore } }));
  }, { compaction: { enabled: scenario === "compact-repair", keepRecentTokens: 20, reserveTokens: 100 } });
  const { session } = runtime;
  session.subscribe((event) => { if (["extension_error", "message_end", "turn_end"].includes(event.type)) events.push(event); });
  session.agent.streamFunction = (model, context, options) => {
    // Pi may enter streamFunction once with an already-aborted signal; no provider request is sent.
    if (options.signal?.aborted) {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "error", reason: "aborted", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: "aborted", timestamp: Date.now() } });
      return stream;
    }
    calls++;
    assert(calls < 6, `${scenario}: unexpected extra model request`);
    const schema = getCurrentTools(context.messages).find((tool) => tool.name === "fanout_submit_artifact").parameters.properties.artifact.properties;
    const initialSchema = calls === 1 || ["malformed-initial", "malformed-json-initial", "length-initial"].includes(scenario);
    assert(!existsSync(runtime.activePointerPath), `${scenario}: published before acceptance`);
    assert(initialSchema ? schema.plan && !schema.revision : schema.revision && !schema.plan, `${scenario}: incorrect dynamic schema on request ${calls}`);
    if (!initialSchema) {
      const expectedRevision = calls === 3 && ["plan-budget", "second-repair"].includes(scenario) ? 2 : 1;
      assert(schema.revision.minimum === expectedRevision && schema.revision.maximum === expectedRevision, `${scenario}: repair schema did not require retained revision ${expectedRevision}`);
      assert(schema.revision.description.includes("current retained base revision") && schema.revision.description.includes("do not increment"), `${scenario}: repair revision guidance is ambiguous`);
      assert(schema.replacePlanItems.description.includes("Complete replacement") && schema.replaceDetailItems.description.includes("Complete replacement"), `${scenario}: repair replacement shape is ambiguous`);
    }
    const stream = createAssistantMessageEventStream();
    if (scenario === "cancel-repair" && calls === 2) {
      options.signal.addEventListener("abort", () => stream.push({ type: "error", reason: "aborted", error: { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), stopReason: "aborted", timestamp: Date.now() } }), { once: true });
      cancelling = true;
      return stream;
    }
    let artifact = validSubmission();
    if (scenario === "malformed-initial" && calls === 1) artifact = { plan: {} };
    else if (scenario === "malformed-json-initial" && calls === 1) artifact = JSON.stringify(artifact).slice(0, -1);
    else if (calls === 1 && !["success", "length-initial"].includes(scenario)) artifact.details.items[0].changes[0].target.resource.path = "unowned.md";
    else if (!initialSchema) {
      artifact = { revision: 1, replacePlanItems: [], replaceDetailItems: validSubmission().details.items };
      if (scenario === "schema-budget") artifact = { revision: "wrong" };
      if (scenario === "plan-budget") artifact = calls === 2
        ? { revision: 1, replacePlanItems: [{ ...validSubmission().plan.implementationItems[0], goals: ["Changed plan goal"] }], replaceDetailItems: [] }
        : { revision: "wrong" };
      if (scenario === "second-repair") {
        if (calls === 2) artifact.replaceDetailItems[0].changes[0].target.resource.path = "still-unowned.md";
        else artifact.revision = 2;
      }
      if (scenario === "stale-revision-recovery" && calls === 2) artifact.revision = 2;
    }
    if (scenario === "encoded-repair") artifact = JSON.stringify(artifact);
    if (scenario === "malformed-json-budget" && calls > 1) artifact = JSON.stringify(artifact).slice(0, -1);
    if (scenario === "compact-repair" && calls === 2) {
      const error = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(), timestamp: Date.now(), stopReason: "error", errorMessage: "maximum context length exceeded" };
      stream.push({ type: "error", reason: "error", error });
      return stream;
    }
    const result = { role: "assistant", content: [{ type: "toolCall", id: "reused-provider-id", name: "fanout_submit_artifact", arguments: { artifact } }], api: model.api, provider: model.provider, model: model.id, usage: usage(), timestamp: Date.now(), stopReason: scenario === "length-initial" ? "length" : "toolUse" };
    if (scenario === "length-initial" && calls === 2) { result.content = []; result.stopReason = "stop"; }
    stream.push({ type: "done", reason: result.stopReason, message: result });
    return stream;
  };
  try {
    await session.prompt("/fanout-plan Test typed correction");
    if (scenario === "cancel-repair") { await waitFor(() => cancelling); await session.abort(); }
    await waitFor(() => settled === 1);
    const success = !["schema-budget", "plan-budget", "length-initial", "cancel-repair", "malformed-json-budget"].includes(scenario);
    assert(existsSync(runtime.activePointerPath) === success, `${scenario}: incorrect publication`);
    assert(session.getActiveToolNames().includes("bash"), `${scenario}: tools not restored`);
    const expectedCalls = { success: 1, "schema-budget": 3, "plan-budget": 3, "second-repair": 3, "stale-revision-recovery": 3, "malformed-initial": 2, "length-initial": 2, "cancel-repair": 2, "compact-repair": 3, "encoded-repair": 2, "malformed-json-initial": 2, "malformed-json-budget": 3 }[scenario];
    assert(calls === expectedCalls, `${scenario}: expected ${expectedCalls} requests, got ${calls}: ${JSON.stringify(events)}`);
    if (scenario === "schema-budget") {
      assert(executeCalls === 1, "SDK schema-rejected repairs reached the tool-call execution hook");
      const failures = session.agent.state.messages.filter((message) => message.role === "toolResult" && message.isError);
      assert(failures.length === 3 && JSON.stringify(failures).includes("Validation failed"), "schema budget did not exercise SDK validation");
    }
    if (scenario === "stale-revision-recovery") {
      assert(executeCalls === 2, "stale repair revision reached the tool-call execution hook");
      const failures = session.agent.state.messages.filter((message) => message.role === "toolResult" && message.isError);
      assert(failures.some((message) => JSON.stringify(message).includes("artifact.revision: must be <= 1")), "stale revision feedback omitted the exact retained revision");
    }
    if (scenario.startsWith("malformed-json")) {
      assert(executeCalls === 1, "malformed JSON reached the execution hook");
      const failures = session.agent.state.messages.filter((message) => message.role === "toolResult" && message.isError);
      assert(failures.filter((message) => JSON.stringify(message).includes("artifact contains malformed JSON")).length === (scenario === "malformed-json-budget" ? 2 : 1), "malformed JSON did not get precise recovery feedback");
    }
  } finally { session.dispose(); }
}

function usage() { return { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("SDK repair did not settle"); await new Promise((resolve) => setTimeout(resolve, 5)); }
}
