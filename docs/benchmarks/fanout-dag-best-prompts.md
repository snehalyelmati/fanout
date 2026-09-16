# Best Fanout DAG prompt candidates

Curated summaries of historical prompt strategies. Original prompt text and run records remain local and are not part of this public note.

## Graduated candidate

### `combined-general-conflict-proof`

- Source run: `loop-20260707-145016`
- Score: avg `4.916`, min task `4.88`
- Tasks: 5 total, including 2 heldout tasks
- Status: graduated under current stop condition
- Known strengths: contract-first fanout, same-file conflict proof, early docs/tests/fixtures, edge proof, concise final validation
- Known risks: contract node can still grow if the task is vague; keep it to shared facts needed by multiple workers

Strategy: short read-only contract first; prove disjoint writable ownership in the initial parallel group; add only evidence-backed dependency edges; defer integrated validation until authored work joins.

## Prior baseline

### `combined-best`

- Source run: `fanout-dag-prompt-experiment-20260707-130623`
- Score: avg `4.917`, min task `4.875`
- Tasks: 3 known tasks only
- Status: prior baseline; superseded for robustness by `combined-general-conflict-proof` because the newer run used heldout tasks and explicit same-file conflict proof
- Known strengths: strongest original combination of contract-first, first parallel group, authoring/verification split, and edge proof
- Known risks: more task-context specific than the graduated candidate

Strategy: freeze exact shared interfaces, launch work that can proceed from the contract in one parallel group, and require proof for each dependency edge.

## Strong comparators

### `lean-safe-near5`

- Source run: `loop-20260707-145016`
- Score: avg `4.892`, min task `4.86`
- Status: near miss; useful for shorter prompt mutation, not current default
- Known strength: terse while preserving most safety rails
- Known risk: just below stop condition; terseness may under-specify schema/prompt/docs migration edges

Strategy: minimize the safe critical path with one contract step, a disjoint first parallel group, and compact final validation/review.

### `authorability-edge-proof`

- Source run: `fanout-dag-prompt-experiment-20260707-130623`
- Score: avg `4.79`, min task `4.63`
- Status: useful ingredient, not final
- Known strength: best isolated edge-proof behavior
- Known risk: weaker than combined candidates without explicit contract-first and ownership-conflict proof

Strategy: require a named upstream artifact, file, or decision for every dependency edge; remove convenience and redundant edges.

## Current default recommendation

Use `combined-general-conflict-proof` for `/fanout-plan` DAG prompt tuning. Keep `lean-safe-near5` as the compression target only after it can pass the same 5-task stop condition.
