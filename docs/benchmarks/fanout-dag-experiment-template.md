# Fanout DAG Prompt Experiment Template

Archived July 2026 methodology. The `subagent` call, GPT-5.5 setting, launch command, task examples and packet-v3 example below describe the original scoring environment; they are not mandatory or validated instructions for a current Fanout run. Use the [current source guide](../GETTING_STARTED.md) and [runtime guide](../FANOUT_GUIDE.md) for today's setup and artifact contracts. Keep full prompt text and evaluator output in ignored local artifacts; publish only curated summaries.

Artifact directory: `runs/fanout-dag-prompt-experiments/<run-id>`

## Goal

Test prompt variants for producing safe, parallel Fanout execution DAGs without task-specific hardcoding.

## Stop condition

A candidate graduates only if:

- average score > 4.90 across all benchmark tasks;
- minimum task score > 4.85;
- no task-specific hardcoding;
- no ownership blocker;
- no repeated false serialization of tests/docs/fixtures behind implementation;
- run used a fresh Pi process/session.

## Original hard constraints

- Use the `subagent` tool. First call: `subagent({ action: "list" })`.
- Use GPT-5.5 with medium reasoning/effort for generator and evaluator subagents when supported.
- Do not edit source repo files.
- Writing ignored experiment artifacts under this artifact directory is allowed.
- Updating `runs/fanout-dag-prompt-experiments/RESULTS.md` is allowed.
- Updating `runs/fanout-dag-prompt-experiments/BEST_PROMPTS.md` is allowed.
- Generate execution DAGs only, not full Fanout plan packets.
- Use batches if task limits reject a single large parallel call. Keep concurrency 6 where possible.
- If spawn caps force direct completion of remaining artifacts, disclose the phase and counts in `synthesis.md`.

## Output files

Create/maintain:

- `experiment.md` — concrete copy of this template with variants/tasks filled in.
- `generators/<variant>-<task>.md` — generator outputs.
- `evaluators/<variant>-<task>.md` — evaluator outputs.
- `synthesis.md` — loop synthesis.
- `pi-orchestrator.log` — parent Pi stdout/stderr if shell-launched in background.
- `pi-orchestrator.pid` — parent Pi PID if shell-launched in background.
- `../RESULTS.md` — one row per tested variant.
- `../BEST_PROMPTS.md` — full text for graduated, near-miss, or mutation-seed prompts.

## Original launch shape

```bash
pi --approve \
  --name "fanout-dag-loop-<run-id>" \
  --provider openai-codex \
  --model gpt-5.5 \
  --thinking medium \
  -p "Run this experiment file exactly: <absolute-path-to-experiment.md>"
```

## Prompt variants

Fill with 5 variants. Each variant must be generic, not task-specific.

### 1. `<variant-name>`

```text
<full prompt text>
```

## Tasks

Use 3 known tasks plus at least 2 heldout tasks.

### A. `/fanout-execute` MVP

Implement `/fanout-execute` MVP: active packet loader, stale/worktree guardrails, user confirmation, subagent launch stub, metrics summary, smoke tests, docs.

### B. Packet observability + benchmark ingestion

Add packet observability + benchmark ingestion: emit `fanout_packet_ready`, include DAG metrics/tier counts/artifact paths, update trace summarizer, summary markdown, fixtures, smoke tests, docs.

### C. Execution packet schema v3 migration

Add execution packet schema v3 migration: schema bump, backward reject/migration policy, new `executionMode`/`approval` fields, renderer updates, fixtures, validator tests, prompt/docs updates.

### D. Heldout task

<task text>

### E. Heldout task

<task text>

## Generator contract

For each `<variant>-<task>` generator:

- Read the task and variant.
- Inspect repo only if needed.
- Do not modify source repo files.
- Output only an execution DAG, not a full Fanout plan packet.
- Save to `generators/<variant>-<task>.md`.
- Markdown output must include:
  1. boxed ASCII or Mermaid DAG;
  2. parallel groups;
  3. critical path;
  4. node table: id, goal, owned files/resources, read-only inputs, dependency edges with reason/proof, validation contract, tier suggestion;
  5. concise DAG rationale only.

## Evaluator contract

For each `<variant>-<task>` evaluator:

- Read exactly one generator output.
- Do not edit source repo files.
- Save to `evaluators/<variant>-<task>.md`.
- Score 1–5 for:
  - minimized critical path;
  - max safe parallel width;
  - edge correctness/proof;
  - small sequential work per node;
  - ownership conflicts;
  - validation coverage;
  - missing inspect/test/docs/review nodes;
  - false serialization of docs/tests behind code.
- Return score table, blockers, hardcoding flag, ownership-conflict flag, false-serialization flag, concrete prompt improvements, and overall average.

## Final synthesis

Write `synthesis.md` with:

- ranking by average score;
- task score table for all variants;
- pass/fail against stop condition;
- whether any candidate exceeds avg > 4.90 and min task > 4.85;
- common failure modes;
- next prompt mutations if stop condition is not met;
- what not to add because over-engineered;
- artifact counts and validation;
- spawn/batching/direct-completion caveats.

Then update:

- `../RESULTS.md` with one row per variant.
- `../BEST_PROMPTS.md` with any graduated prompt, any near miss avg >= 4.85, and any prompt used as a next-run mutation seed.
