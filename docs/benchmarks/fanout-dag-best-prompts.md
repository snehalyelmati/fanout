# Best Fanout DAG prompt candidates

Central ignored ledger of prompt text worth reusing or mutating. Full run data lives in `RESULTS.md` and per-run `experiment.md` / `synthesis.md` files.

## Graduated candidate

### `combined-general-conflict-proof`

- Source run: `loop-20260707-145016`
- Score: avg `4.916`, min task `4.88`
- Tasks: 5 total, including 2 heldout tasks
- Status: graduated under current stop condition
- Known strengths: contract-first fanout, same-file conflict proof, early docs/tests/fixtures, edge proof, concise final validation
- Known risks: contract node can still grow if the task is vague; keep it to shared facts needed by multiple workers

```text
Generate only an execution DAG.

Start with one short read-only inspection/contract node that freezes only the shared facts needed for independent workers: public APIs/command names, file/resource ownership, schemas/fields, expected errors or decisions, fixture/test/doc targets, and validation artifacts.

Before listing parallel groups, prove that no two nodes in the same group own the same writable file/resource. If they do, merge them or serialize only the shared-file portion.

Then list every work unit that can be authored from the contract and put those in the first parallel group.

Add a dependency edge only when the downstream node cannot be authored safely without a specific upstream artifact, file, or decision; name that proof on the edge. Reject convenience edges and redundant transitive edges.

Separate authoring from final verification. Tests, fixtures, prompts, package scripts, and docs should start from the frozen contract when possible; final execution/reconciliation waits for implementation.

Keep each node to one cohesive owned file/resource set and one validation contract. State the critical path using fan-in notation, e.g. `contract -> max(P1..Pn) -> final-validation`.
```

## Prior baseline

### `combined-best`

- Source run: `fanout-dag-prompt-experiment-20260707-130623`
- Score: avg `4.917`, min task `4.875`
- Tasks: 3 known tasks only
- Status: prior baseline; superseded for robustness by `combined-general-conflict-proof` because the newer run used heldout tasks and explicit same-file conflict proof
- Known strengths: strongest original combination of contract-first, first parallel group, authoring/verification split, and edge proof
- Known risks: more task-context specific than the graduated candidate

```text
Generate only an execution DAG. Start with one short read-only inspection/contract node that freezes exact APIs, file ownership, schema fields, CLI names, event fields, expected errors, fixture names, docs targets, and validation artifacts. Then list every work unit that can start from that contract and put those in the first parallel group. Add a dependency edge only when the downstream node cannot be authored safely without a specific upstream artifact, file, or decision; name that proof on the edge. Treat authoring and final verification as separate work: tests, fixtures, prompts, package scripts, and docs should start from the frozen contract when possible, with a small final execution/reconciliation node after implementation. Keep each node to one cohesive owned file/resource set and one validation contract. Reject convenience edges, redundant transitive edges, broad ownership globs, and bundled docs/test/review sink nodes. State the critical path using fan-in notation such as `contract -> max(P1..Pn) -> final-validation`.
```

## Strong comparators

### `lean-safe-near5`

- Source run: `loop-20260707-145016`
- Score: avg `4.892`, min task `4.86`
- Status: near miss; useful for shorter prompt mutation, not current default
- Known strength: terse while preserving most safety rails
- Known risk: just below stop condition; terseness may under-specify schema/prompt/docs migration edges

```text
Generate only an execution DAG optimized for the shortest safe critical path.

Use the fewest nodes that expose real parallelism:
1. one read-only contract node;
2. one first parallel group containing all authorable work with non-overlapping writable ownership;
3. minimal final validation/review nodes.

Do not add edges for convenience, sequencing preference, or because work should pass later. Add an edge only when a node cannot be authored safely without a named upstream artifact/file/decision.

Prefer early tests, fixtures, prompts, package scripts, and docs from the contract. Keep same-file work in one node unless a real interface boundary exists. Avoid broad ownership globs, catch-all reconciliation, and extra orchestration nodes.

For each node, state owned files/resources, read-only inputs, dependency proofs, validation contract, and tier suggestion. State the critical path as `contract -> max(first parallel group) -> final validation/review` unless a real hard edge proves otherwise.
```

### `authorability-edge-proof`

- Source run: `fanout-dag-prompt-experiment-20260707-130623`
- Score: avg `4.79`, min task `4.63`
- Status: useful ingredient, not final
- Known strength: best isolated edge-proof behavior
- Known risk: weaker than combined candidates without explicit contract-first and ownership-conflict proof

```text
Add a dependency edge only when the downstream node cannot be authored safely without a specific upstream artifact, file, or decision. Name that proof on the edge. Reject convenience edges and redundant transitive edges.
```

## Current default recommendation

Use `combined-general-conflict-proof` for `/fanout-plan` DAG prompt tuning. Keep `lean-safe-near5` as the compression target only after it can pass the same 5-task stop condition.
