# Pre-merge cleanup plan

Purpose: organize the experimentation on `feature/improve-tat` so the branch can merge as a reproducible evidence package. Do not start runtime/plugin restructuring in this cleanup. The next branch can decide whether the plugin stays one package, splits into multiple packages, or becomes a monorepo.

## What is useful from this branch

- Offline trace summarization now handles extension observability, raw Pi session traces, and synthetic hybrid workflow fixtures.
- Hybrid workflow fixtures are useful for deterministic scheduler invariants: active/background accounting, deadlines, budgets, fallback, speculative waste, and infeasible linear critical paths.
- Manual/semantic review correctly killed generic tier2 DAG routing for normal interactive traces.
- Planned Parallel RPE is the useful direction: tier1 planner, safe code-edit units, tier2 background execution, tier1 review/synthesis.
- Safe-work-unit evaluation is useful as an offline gate before runtime work.
- Full `pi-mono` TAT bucket code-shard evaluation suggests long decomposable traces can compress remaining realtime execution into shallow tier2 background DAGs.

## What is not useful enough yet

- Synthetic hybrid target passes are simulator evidence, not observed trace feasibility.
- The 15-trace TAT bucket prediction artifact is now tracked under `datasets/fixtures/`, but the full `pi-mono` traces remain external/ignored.
- The exact subagent prediction protocol is now tracked in `docs/benchmarks/safe-work-unit-eval-protocol.md`.
- Safe-unit labels are predictor-provided, not independent human labels.
- The evaluator is heuristic. It is not a semantic proof of safety.
- Runtime scheduling is not implemented. Current results do not prove live Doubleword TAT.

## Must fix before merge

### 1. Make E2 reproducible

Done:

- Sanitized TAT bucket prediction artifact moved to tracked storage:

```text
datasets/fixtures/tat-bucket-code-shards-predictions.jsonl
```

- `docs/benchmarks/tat-bucket-code-shards.md` and `docs/BENCHMARKS.md` use the tracked artifact path.
- `smoke:benchmarks` asserts the tracked artifact metrics when `datasets/traces/pi-mono-full/` is present locally:

```text
15 evaluated prediction rows
49 code-edit units
31 safe_independent
16 safe_after_dependency
2 unsafe
safety precision 1
recall 0.969
dependency accuracy 0.941
```

### 2. Document the prediction protocol

Done: tracked protocol doc added at:

```text
docs/benchmarks/safe-work-unit-eval-protocol.md
```

It defines:

- what a safe work unit is;
- the exact JSONL schema and required fields;
- the difference between `safe_independent`, `safe_after_dependency`, `unsafe`, and `inconclusive`;
- code-edit-only mode versus docs/research mode;
- prompt template used to generate predictions;
- what context the predictor may read: trace prefix and evaluator/schema only, not suffix evidence;
- how labels are used and why predictor-provided labels are weaker than independent labels;
- evaluator limitations.

Minimum predictor prompt template to document:

```text
Prediction-only; do not edit files.
Generate exactly one JSONL prediction row for the safe-work-unit evaluator.
Read scripts/eval-safe-work-units.mjs and trace <trace-path>.
Return no prose or markdown fence: one JSON object line.
Use schema doubleword.safe-work-unit-prediction version 1.
Choose a plausible implementation prefixBoundary.
Propose 2-5 CODE EDIT shards only: each owns source/config/test files, not docs/notes/summaries.
Include ownedFiles, readOnlyFiles, mutableResources, dependencies, validationRequirements,
reviewRequirements, cancellationRules, activeBoundaryClaim, and label.expectedVerdict.
Label safe only if prefix evidence supports independent execution without hidden suffix dependencies.
```

### 3. Tighten evaluator correctness

Done:

- `prefixBoundary.messageId` is validated when supplied: the trace row at `prefixBoundary.line` must match.
- Graph-level checks were added for prediction rows:
  - dependency cycles;
  - dangling dependencies;
  - overlapping `ownedFiles` or `mutableResources` unless serialized;
  - accepted DAG depth and width in the safe-unit summary.
- Unit-level verdicts remain, and graph-level schedulability is reported so a cyclic group cannot look launchable.

### 4. Clarify hybrid baseline semantics

`all_tier1_baseline` currently behaves as a hypothetical tier1 baseline even for synthetic nodes whose `tierEligibility` excludes tier1. Before merge, choose one:

- rename/document it as a hypothetical comparison baseline; or
- enforce `assignedTier in tierEligibility` and mark impossible baselines infeasible.

Done: documented `all_tier1_baseline` as a hypothetical comparison baseline in benchmark output/docs.

### 5. Clean documentation boundaries

- Keep `docs/BENCHMARKS.md` as the ledger and high-level summary.
- Keep detailed evidence under `docs/benchmarks/`.
- Keep design decisions in `docs/DESIGN_DECISIONS.md`, not benchmark docs.
- Keep future implementation tasks in `docs/ROADMAP.md` and this cleanup plan.
- Mark every result as one of:
  - synthetic fixture evidence;
  - retrospective trace-derived evidence;
  - live runtime evidence.

### 6. Validation before merge

Run:

```bash
rtk npm run check
rtk npm run smoke:benchmarks
rtk npm run eval:safe-work-units -- \
  datasets/traces/pi-mono-full \
  --predictions datasets/fixtures/tat-bucket-code-shards-predictions.jsonl \
  --out runs/safe-work-unit-eval/tat-bucket-code-shards
```

If full `pi-mono` is not present locally, docs should say how to fetch it or mark the E2 full-dataset check as local-only while keeping a smaller committed smoke fixture.

## Do not do before merge

- Do not implement the runtime tier2 executor.
- Do not restructure the plugin or repo layout.
- Do not add provider live calls.
- Do not build generic DAG routing.
- Do not add duplicate implementation portfolios as a default path.

## Post-merge implementation sequence

1. Decide plugin/package structure.
2. Define the RPE execution packet schema.
3. Implement an offline scheduler library first:
   - graph validation;
   - ownership conflict detection;
   - DAG depth/width;
   - `tier2_exec_wait_worst_case = depth * 10m`;
   - launch/no-launch decision by user wait budget.
4. Add runtime observability fields.
5. Prototype isolated tier2 background executors.
6. Add tier1 review/synthesis acceptance flow.

## Merge acceptance checklist

- [x] E2 prediction artifact is tracked or explicitly marked local-only with reproduction instructions.
- [x] Safe-work-unit protocol is documented.
- [x] Evaluator validates prefix `messageId`.
- [x] Graph-level cycle/dangling-dependency checks exist or are explicitly deferred in docs.
- [x] Hybrid tier1 baseline semantics are documented.
- [x] Benchmark docs separate synthetic, retrospective, and live evidence.
- [x] Smoke commands pass.
