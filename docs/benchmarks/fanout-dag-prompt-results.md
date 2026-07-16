# Fanout DAG Prompt Experiment Results

Ignored repo-local ledger for prompt experiment runs. Artifacts live under `runs/fanout-dag-prompt-experiments/`.

## Current best

| Variant | Run | Avg | Min task | Verdict |
|---|---|---:|---:|---|
| `combined-general-conflict-proof` | `loop-20260707-145016` | 4.916 | 4.88 | Current graduated prompt under 5-task loop. |

## Variant results

| Run | Date | Artifact dir | Model | Variant | A | B | C | Avg | Min | >=4.75 | No task <4.5 | Hardcoding flag | Ownership conflict flag | False serialization flag | Failure modes | Verdict | Next mutation |
|---|---|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|---|---|---|
| run-1 | 2026-07-07 12:46 | `fanout-dag-prompt-experiment-20260707-124658` | GPT-5.5 | `parallel-group-first` | 4.38 | 3.90 | 4.25 | 4.18 | 3.90 | no | no | low | low | medium | Test/docs authoring sometimes serialized; critical path fan-in sometimes imprecise. | Useful seed, replaced by combined prompt. | Add contract-first + edge proof + authoring/verification split. |
| run-1 | 2026-07-07 12:46 | `fanout-dag-prompt-experiment-20260707-124658` | GPT-5.5 | `critical-path-minimizer` | 3.63 | 4.00 | 4.10 | 3.91 | 3.63 | no | no | low | low | medium | Shortens chains but misses early docs/tests/fixtures from contract. | Not final. | Add explicit first parallel group and authorability edge proof. |
| run-1 | 2026-07-07 12:46 | `fanout-dag-prompt-experiment-20260707-124658` | GPT-5.5 | `edge-proof-required` | 3.75 | 3.75 | 3.50 | 3.67 | 3.50 | no | no | low | low | medium | Edge quality good but too conservative; parallel width too low. | Not final. | Pair edge proof with anti-serialization requirement. |
| run-1 | 2026-07-07 12:46 | `fanout-dag-prompt-experiment-20260707-124658` | GPT-5.5 | `micro-shard-fanout` | 3.60 | 3.63 | 3.60 | 3.61 | 3.60 | no | no | low | low | high | Clean ownership but extra serial links and false dependencies. | Not final. | Avoid micro-sharding without contract/fan-in discipline. |
| run-2 | 2026-07-07 13:06 | `fanout-dag-prompt-experiment-20260707-130623` | GPT-5.5 | `combined-best` | 4.875 | 5.000 | 4.875 | 4.917 | 4.875 | yes | yes | medium | low | low | Some task-specific examples in prompt/run context; core nodes can be chunky. | Baseline winner. | Generalize wording; add conflict proof without hardcoding task fields. |
| run-2 | 2026-07-07 13:06 | `fanout-dag-prompt-experiment-20260707-130623` | GPT-5.5 | `authorability-edge-proof` | 4.63 | 4.88 | 4.88 | 4.79 | 4.63 | yes | yes | low | low | low | Strong edge proof; slightly less complete than combined-best. | Candidate. | Add explicit contract + first parallel group wording. |
| run-2 | 2026-07-07 13:06 | `fanout-dag-prompt-experiment-20260707-130623` | GPT-5.5 | `authoring-verification-split` | 4.63 | 4.88 | 4.63 | 4.71 | 4.63 | no | yes | low | low | low | Strong authoring split but weaker edge/ownership checks. | Near miss. | Add exact edge proof and same-file conflict check. |
| run-2 | 2026-07-07 13:06 | `fanout-dag-prompt-experiment-20260707-130623` | GPT-5.5 | `contract-first` | 4.50 | 4.875 | 4.50 | 4.625 | 4.50 | no | yes | low | low | low | Contract helps but prompt underspecifies anti-serialization and edge proof. | Near miss. | Add authorability test for docs/tests/fixtures. |
| final-prompts-1 | 2026-07-07 13:33 | `fanout-dag-final-prompts-20260707-133344` | GPT-5.5 | `minimal-contract-fanout` | 4.13 | 4.25 | 4.50 | 4.29 | 4.13 | no | no | low | medium | medium | Contract/core nodes can become large; needs shared-file conflict check. | Not final alone. | Add conflict proof + validation assertion mapping. |
| final-prompts-1 | 2026-07-07 13:33 | `fanout-dag-final-prompts-20260707-133344` | GPT-5.5 | `anti-serialization-rubric` | 3.88 | 4.25 | 4.25 | 4.13 | 3.88 | no | no | low | medium | low | Can create implementation chains or broad reconciliation nodes. | Not final alone. | Add ownership proof and restrict reconcile node scope. |
| final-prompts-1 | 2026-07-07 13:33 | `fanout-dag-final-prompts-20260707-133344` | GPT-5.5 | `lean-dag-contract` | 4.50 | 3.63 | 4.00 | 4.04 | 3.63 | no | no | low | high | medium | Too terse; task B had same-file ownership conflict. | Small-task only with safety rail. | Add same-file conflict proof and hard authoring-blocker labels. |

## Loop 20260707-145016 results

| Run | Date | Artifact dir | Model | Variant | A | B | C | D | E | Avg | Min | Stop condition | Hardcoding flag | Ownership conflict flag | False serialization flag | Verdict | Next mutation |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---|
| loop-20260707-145016 | 2026-07-07 14:50 | `loop-20260707-145016` | GPT-5.5 | `combined-general-conflict-proof` | 4.92 | 4.95 | 4.90 | 4.93 | 4.88 | 4.916 | 4.88 | yes | no | no | no | Graduates; new best candidate. | Keep as baseline. |
| loop-20260707-145016 | 2026-07-07 14:50 | `loop-20260707-145016` | GPT-5.5 | `lean-safe-near5` | 4.90 | 4.88 | 4.86 | 4.92 | 4.90 | 4.892 | 4.86 | no | no | no | no | Useful comparator; does not beat stop condition. | Borrow only the useful rail into combined prompt. |
| loop-20260707-145016 | 2026-07-07 14:50 | `loop-20260707-145016` | GPT-5.5 | `no-reconcile-sink` | 4.86 | 4.90 | 4.84 | 4.88 | 4.86 | 4.868 | 4.84 | no | no | no | no | Useful comparator; does not beat stop condition. | Borrow only the useful rail into combined prompt. |
| loop-20260707-145016 | 2026-07-07 14:50 | `loop-20260707-145016` | GPT-5.5 | `contract-size-capped` | 4.80 | 4.78 | 4.82 | 4.86 | 4.76 | 4.804 | 4.76 | no | no | no | low | Useful comparator; does not beat stop condition. | Borrow only the useful rail into combined prompt. |
| loop-20260707-145016 | 2026-07-07 14:50 | `loop-20260707-145016` | GPT-5.5 | `anti-hardcode-generalizer` | 4.84 | 4.80 | 4.78 | 4.82 | 4.74 | 4.796 | 4.74 | no | no | no | low | Useful comparator; does not beat stop condition. | Borrow only the useful rail into combined prompt. |

## Rubric fields tracked in evaluator artifacts

Each evaluator scores 1–5 for:

- minimized critical path
- max safe parallel width
- edge correctness/proof
- small sequential work per node
- ownership conflicts
- validation coverage
- missing inspect/test/docs/review nodes
- false serialization of docs/tests behind code

## Stop criteria for future loops

A prompt candidate graduates when:

- average score > 4.90 across all tasks in the run;
- minimum task score > 4.85;
- no task-specific hardcoding;
- no unresolved ownership-conflict blocker;
- no recurring false serialization of tests/docs/fixtures behind implementation;
- the run used a fresh Pi process/session.

## Notes

- `/tmp` copies were migrated into this ignored repo-local folder on 2026-07-07.
- Future runs should use `GPT-5.5 medium` as the test model and a fresh pi session per experiment.
- Add heldout tasks before declaring a prompt stable.
