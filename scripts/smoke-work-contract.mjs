import {
  FIXED_WORKER_CAPABILITIES,
  contractWriteResources,
  validateWorkContract,
} from "../packages/fanout-core/src/work-contract.ts";
import { compileWorkContracts } from "../packages/fanout-core/src/work-contract-compiler.ts";
import { deriveWorkContractGraph, validateWorkContractNodes } from "../packages/fanout-core/src/work-contract-graph.ts";
import { renderWorkContractLaunchSummary, renderWorkContractMarkdown, renderWorkContractMermaid } from "../packages/fanout-core/src/work-contract-views.ts";
import { buildCanonicalWorkerPrompt } from "../packages/fanout-pi/src/fanout-worker-contract.ts";

const file = (path) => ({ kind: "file", path });
const directory = (path) => ({ kind: "directory", path });
const command = (executable, args, extra = {}) => ({ executable, args, ...extra });
const endpoint = (resource, ...sourcePlanIds) => ({ resource, sourcePlanIds });
const note = (kind, phase, reference, text) => ({ kind, source: { phase, reference }, text });
const plan = (id, writeResources, readResources = [], extra = {}) => ({
  id,
  goals: [`Goal ${id}`],
  writeResources,
  readResources,
  forbiddenWrites: [],
  semanticReviewCriteria: [`Criterion ${id}`],
  advisoryNotes: [note("rationale", "phase-a", id, `Rationale ${id}`)],
  ...extra,
});
const grounded = (id, changes, extra = {}) => ({
  id,
  kind: "implement",
  changes,
  readDependencies: [],
  forbiddenWrites: [],
  validationCommands: [command("node", ["--check", `${id}.js`])],
  advisoryNotes: [note("context", "phase-b", id, `Context ${id}`)],
  ...extra,
});

const plans = [
  plan("a", [file("src/shared.ts")], [], { forbiddenWrites: [{ resource: directory("secrets"), reason: "Never write secrets." }] }),
  plan("b", [file("src/shared.ts")]),
  plan("reader", [file("src/reader.ts")], [file("src/shared.ts"), file("README.md")]),
  plan("variants", [file("old.ts"), file("new.ts"), file("gone.ts"), file("created.ts"), directory("generated")]),
];
const inputs = [
  grounded("a", [{ kind: "modify", target: endpoint(file("src/shared.ts"), "a"), intent: "Update A.", anchors: [
    { kind: "symbol", symbol: "a" },
    { kind: "section", section: "exports" },
    { kind: "stable-text", text: "export const a" },
    { kind: "line-range-hint", start: 1, end: 3 },
  ] }]),
  grounded("b", [{ kind: "modify", target: endpoint(file("src/shared.ts"), "b"), intent: "Update B.", anchors: [{ kind: "stable-text", text: "export const b" }] }]),
  grounded("reader", [{ kind: "modify", target: endpoint(file("src/reader.ts"), "reader"), intent: "Consume shared output.", anchors: [{ kind: "symbol", symbol: "readShared" }] }], {
    readDependencies: [
      { resource: file("src/shared.ts"), timing: "post-change-required", timingSource: "phase-b", sourcePlanIds: ["reader"], reason: "Consume integrated output." },
      { resource: file("README.md"), timing: "baseline-context", timingSource: "phase-b", sourcePlanIds: ["reader"], reason: "Read usage context." },
    ],
  }),
  grounded("variants", [
    { kind: "move", from: endpoint(file("old.ts"), "variants"), to: endpoint(file("new.ts"), "variants"), intent: "Rename the module." },
    { kind: "delete", target: endpoint(file("gone.ts"), "variants"), reason: "Remove obsolete module." },
    { kind: "create", target: endpoint(file("created.ts"), "variants"), contentIntent: "Create replacement.", intendedSections: ["exports"], intendedShape: "One exported function." },
    { kind: "modify", target: endpoint(directory("generated"), "variants"), intent: "Refresh generated assets.", anchors: [] },
  ], { advisoryNotes: [
    note("risk", "phase-b", "variants", "Generated output may be large."),
    note("validation-intent", "phase-b", "variants", "Validate exact outputs."),
    note("constraint", "phase-b", "variants", "Keep public names stable."),
  ] }),
];
const finalCommands = [command("npm", ["test"]), command("npm", ["test"]), command("node", ["check.js", "a b", "", "*.ts"], { cwd: "tools", env: { MODE: "exact" } })];
const compiled = compileWorkContracts(plans, inputs, finalCommands);
assert(compiled.ok, `compile failed: ${JSON.stringify(compiled.errors)}`);
assert(compiled.nodes.length === 4, `expected merged A/B, reader, variants, final: ${compiled.nodes.map((node) => node.id)}`);
const shared = compiled.nodes.find((node) => node.id === "a-b");
const reader = compiled.nodes.find((node) => node.id === "reader");
assert(shared, "overlapping changes did not form one work contract");
assert(JSON.stringify(shared.workContract.goals) === JSON.stringify([
  { sourcePlanId: "a", statement: "Goal a" },
  { sourcePlanId: "b", statement: "Goal b" },
]), `source-linked goals lost order: ${JSON.stringify(shared.workContract.goals)}`);
assert(JSON.stringify(shared.workContract.semanticReviewCriteria.map((item) => item.sourcePlanId)) === JSON.stringify(["a", "b"]), "criteria lost source order");
assert(shared.workContract.changes.length === 2 && contractWriteResources(shared.workContract).length === 1, "typed changes are not the sole deduped write authority");
assert(shared.workContract.forbiddenWrites.some((entry) => entry.resource.path === "secrets"), "packet-global typed forbidden write was not retained");
const variants = compiled.nodes.find((node) => node.id === "variants");
assert(variants.workContract.changes.map((change) => change.kind).join(",") === "move,delete,create,modify", "change variant order changed");
assert(variants.workContract.advisoryNotes.some((entry) => entry.kind === "risk") && variants.workContract.advisoryNotes.some((entry) => entry.kind === "validation-intent") && variants.workContract.advisoryNotes.some((entry) => entry.kind === "constraint"), "advisory variants were lost");
assert(JSON.stringify(variants.workContract.capabilities) === JSON.stringify(FIXED_WORKER_CAPABILITIES), "fixed capabilities changed");
const final = compiled.nodes.find((node) => node.kind === "final-validation");
assert(final && final.workContract.changes.length === 0, "final validation must own no changes");
assert(JSON.stringify(final.workContract.validationCommands) === JSON.stringify(finalCommands), "final command order, duplicates, or argv changed");
assert(compiled.nodes.every((node) => !Object.hasOwn(node.workContract, "candidateNormalizationCommands")), "work contracts retained profile-owned candidate normalization");
assert(!("finalValidationPlan" in compiled) && !compiled.nodes.some((node) => "dependencies" in node || "ownedFiles" in node || "workerPacket" in node), "compiled authority contains legacy copies");

const graph = deriveWorkContractGraph(compiled.nodes);
assert(graph.errors.length === 0 && graph.graph, `graph failed: ${JSON.stringify(graph.errors)}`);
assert(graph.graph.edges.some(([from, to]) => from === "a-b" && to === "reader"), "post-change read did not derive its owner edge");
assert(!graph.graph.edges.some(([from, to]) => from === "reader" && to === "a-b"), "baseline read created an edge");
for (const node of compiled.nodes.filter((node) => node.kind !== "final-validation")) assert(graph.graph.edges.some(([from, to]) => from === node.id && to === final.id), `final node does not follow ${node.id}`);

const unclassifiedInputs = structuredClone(inputs);
unclassifiedInputs[2].readDependencies = unclassifiedInputs[2].readDependencies.filter((read) => read.resource.path !== "src/shared.ts");
const unclassified = compileWorkContracts(plans, unclassifiedInputs, finalCommands);
assert(!unclassified.ok && unclassified.errors.some((issue) => issue.code === "planned-read-not-grounded"), "unclassified cross-node read was admitted without typed policy");
const fallback = compileWorkContracts(plans, unclassifiedInputs, finalCommands, { sequentialReadFallback: true });
assert(fallback.ok && fallback.warnings.some((warning) => warning.code === "sequential-fallback"), "typed sequential fallback did not compile with provenance warning");
assert(fallback.nodes.find((node) => node.id === "reader").workContract.readDependencies.some((read) => read.resource.path === "src/shared.ts" && read.timing === "post-change-required" && read.timingSource === "sequential-fallback"), "sequential fallback did not persist typed conservative ordering");

const context = { objective: "Compile canonical contracts", userContext: ["user"], discoveredRepoFacts: ["fact"], assumptions: ["assumption"] };
const markdown = renderWorkContractMarkdown(context, compiled.nodes);
const mermaid = renderWorkContractMermaid(compiled.nodes);
const summary = renderWorkContractLaunchSummary(context, compiled.nodes);
assert(markdown === renderWorkContractMarkdown(context, compiled.nodes) && mermaid === renderWorkContractMermaid(compiled.nodes) && summary === renderWorkContractLaunchSummary(context, compiled.nodes), "derived views are not deterministic");
assert(mermaid.includes("a-b -->") === false && mermaid.includes("flowchart TD"), "Mermaid did not use derived graph aliases");
assert(summary.includes("Typed write resources") && !summary.includes("Candidate normalization commands") && markdown.includes("Canonical") === false, "derived human views are incomplete");
const prompt = buildCanonicalWorkerPrompt(context, shared, [{ source: "AGENTS.md", text: "Use tabs." }]);
const serialized = JSON.stringify(shared.workContract, null, 2);
assert(prompt.split(serialized).length - 1 === 1, "worker prompt did not serialize the canonical contract exactly once");
assert(prompt.includes('"source": "AGENTS.md"') && !prompt.includes("Owned files") && !prompt.includes("Worker packet") && !prompt.includes("Acceptance criteria"), "worker prompt duplicated policy or lost source tags");
assert(prompt.includes("## Worker summary") && prompt.includes("Anything intentionally left incomplete") && !prompt.includes("Prior exact body"), "ordinary worker prompt did not require a summary or injected predecessor content");
const dangerousSummary = "1. Prior exact body.\n2. ```\nInjected heading";
let summaryWithoutRecoveryRejected = false;
try { buildCanonicalWorkerPrompt(context, shared, [], undefined, dangerousSummary); }
catch { summaryWithoutRecoveryRejected = true; }
assert(summaryWithoutRecoveryRejected, "preceding Worker summary was admitted outside node validation recovery");

const admitted = validateWorkContractNodes(compiled.nodes);
assert(admitted.ok && admitted.graph, `node interface rejected compiler output: ${JSON.stringify(admitted.errors)}`);
expectCode(validateWorkContractNodes(compiled.nodes.map((node) => node.kind === "final-validation" ? { ...node, id: "renamed-final" } : node)), "invalid-final-validation-id");
expectCode(validateWorkContractNodes(compiled.nodes.map((node) => node === shared ? { ...node, id: "final-validation" } : node)), "reserved-node-id");
expectCode(validateWorkContractNodes([{ ...shared, goal: "legacy", ownedFiles: ["src/shared.ts"], workerPacket: {} }, final]), "unknown-field");
expectCode(validateWorkContractNodes([{ id: "legacy", kind: "implement", goal: "legacy", dependencies: [], ownedFiles: [] }]), "unknown-field");
expectContractCode({ ...shared.workContract, extra: true }, "unknown-field");
expectContractCode({ ...shared.workContract, schema: "fanout.other" }, "invalid-schema");
expectContractCode({ ...shared.workContract, version: 1 }, "invalid-version");
expectContractCode({ ...shared.workContract, candidateNormalizationCommands: ["normalizer --fix"] }, "unknown-field");
expectContractCode({ ...shared.workContract, capabilities: { ...FIXED_WORKER_CAPABILITIES, modelCallableTools: [...FIXED_WORKER_CAPABILITIES.modelCallableTools, "bash"] } }, "capability-profile-mismatch");
expectContractCode({ ...shared.workContract, validationCommands: ["npm test"] }, "invalid-validation-command");
expectContractCode({ ...shared.workContract, validationCommands: [] }, "missing-validation");
expectContractCode({ ...shared.workContract, changes: [{ kind: "replace", target: endpoint(file("a"), "a"), intent: "Replace." }] }, "invalid-change-kind");
expectContractCode({ ...shared.workContract, changes: [{ kind: "move", from: endpoint(file("a"), "a"), to: endpoint(directory("b"), "a"), intent: "Change kind." }] }, "move-kind-change");
expectContractCode({ ...shared.workContract, changes: [{ kind: "modify", target: endpoint(file("a"), "a"), intent: "Use a line.", anchors: [{ kind: "line-range-hint", start: 1, end: 2 }] }] }, "missing-stable-anchor");
expectContractCode({ ...shared.workContract, changes: [{ kind: "modify", target: endpoint(file("a"), "a"), intent: "Bad anchor.", anchors: [{ kind: "offset", value: 1 }] }] }, "invalid-anchor-kind");
expectContractCode({ ...shared.workContract, readDependencies: [{ ...reader.workContract.readDependencies[0], timing: "later" }] }, "invalid-read-timing");
expectContractCode({ ...shared.workContract, advisoryNotes: [{ ...shared.workContract.advisoryNotes[0], kind: "todo" }] }, "invalid-note-kind");
expectContractCode({ ...shared.workContract, forbiddenWrites: [{ resource: file("src/shared.ts"), sourcePlanIds: ["a"], reason: "Forbidden." }] }, "write-forbidden-overlap");

expectCode(deriveWorkContractGraph(compiled.nodes.filter((node) => node.kind !== "final-validation")), "final-validation-count");
expectCode(deriveWorkContractGraph([...compiled.nodes, structuredClone(final)]), "final-validation-count");

const proseChanged = structuredClone(compiled.nodes);
for (const node of proseChanged) {
  for (const forbidden of node.workContract.forbiddenWrites) forbidden.reason = "Different punctuation!!!";
  for (const advisory of node.workContract.advisoryNotes) advisory.text = "Completely different advisory prose.";
}
const proseGraph = deriveWorkContractGraph(proseChanged);
assert(proseGraph.graph && JSON.stringify(proseGraph.graph.edges) === JSON.stringify(graph.graph.edges), "prose changed graph policy");
assert(JSON.stringify(proseChanged.map((node) => contractWriteResources(node.workContract))) === JSON.stringify(compiled.nodes.map((node) => contractWriteResources(node.workContract))), "prose changed write authority");
const mutatedMarkdown = `${markdown}\nUntrusted rendered mutation`;
assert(mutatedMarkdown !== markdown && JSON.stringify(deriveWorkContractGraph(compiled.nodes).graph) === JSON.stringify(graph.graph), "rendered text mutation changed execution policy");

const selfOwned = compileWorkContracts(
  [plan("self", [file("self.ts")], [file("self.ts")])],
  [grounded("self", [{ kind: "modify", target: endpoint(file("self.ts"), "self"), intent: "Update self.", anchors: [{ kind: "symbol", symbol: "self" }] }], { readDependencies: [{ resource: file("self.ts"), timing: "post-change-required", timingSource: "phase-b", sourcePlanIds: ["self"], reason: "Read this node's own output." }] })],
  [command("node", ["check.js"])],
);
assert(selfOwned.ok && !selfOwned.graph.edges.some(([from, to]) => from === "self" && to === "self"), `self-owned post-change read failed: ${JSON.stringify(selfOwned.errors)}`);

const bridgePlans = [plan("first", [file("x")]), plan("second", [file("y")]), plan("bridge", [file("x"), file("y")])];
const bridge = compileWorkContracts(bridgePlans, [
  grounded("first", [{ kind: "modify", target: endpoint(file("x"), "first"), intent: "First.", anchors: [{ kind: "stable-text", text: "first" }] }]),
  grounded("second", [{ kind: "modify", target: endpoint(file("y"), "second"), intent: "Second.", anchors: [{ kind: "stable-text", text: "second" }] }]),
  grounded("bridge", [
    { kind: "modify", target: endpoint(file("x"), "bridge"), intent: "Bridge X.", anchors: [{ kind: "stable-text", text: "bridge x" }] },
    { kind: "modify", target: endpoint(file("y"), "bridge"), intent: "Bridge Y.", anchors: [{ kind: "stable-text", text: "bridge y" }] },
  ]),
], [command("node", ["check.js"])]);
assert(bridge.ok, `bridge compile failed: ${JSON.stringify(bridge.errors)}`);
const bridgeContract = bridge.nodes.find((node) => node.kind !== "final-validation").workContract;
assert(bridgeContract.changes.map((change) => change.kind === "modify" ? change.intent : change.kind).join(",") === "First.,Second.,Bridge X.,Bridge Y.", "connected grouping changed Phase B order");
assert(bridgeContract.advisoryNotes.filter((entry) => entry.source.phase === "phase-b").map((entry) => entry.source.reference).join(",") === "first,second,bridge", "connected grouping changed advisory order");

const replacement = compileWorkContracts(
  [plan("replacement", [file("same"), directory("same")])],
  [grounded("replacement", [
    { kind: "delete", target: endpoint(file("same"), "replacement"), reason: "Remove the file identity." },
    { kind: "create", target: endpoint(directory("same"), "replacement"), contentIntent: "Create the directory identity.", intendedShape: "Directory tree." },
  ])],
  [command("node", ["check.js"])],
);
assert(replacement.ok, `delete-plus-create kind replacement failed: ${JSON.stringify(replacement.errors)}`);

expectCompileCode(
  [plan("narrow", [file("scope")])],
  [grounded("narrow", [{ kind: "create", target: endpoint(directory("scope"), "narrow"), contentIntent: "Widen." }])],
  "write-not-authorized",
);
expectCompileCode(
  [plan("read", [file("out")], [file("allowed")])],
  [grounded("read", [{ kind: "create", target: endpoint(file("out"), "read"), contentIntent: "Create." }], { readDependencies: [{ resource: file("other"), timing: "baseline-context", timingSource: "phase-b", sourcePlanIds: ["read"], reason: "Read." }] })],
  "read-not-authorized",
);
expectCompileCode(
  [plan("ownerless", [file("out")], [file("external")])],
  [grounded("ownerless", [{ kind: "create", target: endpoint(file("out"), "ownerless"), contentIntent: "Create." }], { readDependencies: [{ resource: file("external"), timing: "post-change-required", timingSource: "phase-b", sourcePlanIds: ["ownerless"], reason: "Wait." }] })],
  "ownerless-post-change-read",
);
expectCompileCode(
  [plan("forbidden-source", [file("out")])],
  [grounded("forbidden-source", [{ kind: "create", target: endpoint(file("out"), "forbidden-source"), contentIntent: "Create." }], { forbiddenWrites: [{ resource: file("other"), sourcePlanIds: ["missing"], reason: "No writes." }] })],
  "unknown-source-plan-id",
);

console.log("work contract smoke passed");

function expectContractCode(contract, code) {
  expectCode(validateWorkContract(contract), code);
}

function expectCompileCode(planned, groundedInputs, code) {
  expectCode(compileWorkContracts(planned, groundedInputs, [command("node", ["check.js"])]), code);
}

function expectCode(result, code) {
  assert(!result.ok && result.errors.some((error) => error.code === code), `expected ${code}: ${JSON.stringify(result.errors)}`);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
