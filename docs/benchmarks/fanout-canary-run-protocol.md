# Fanout canary run protocol

Purpose: define the common operational protocol for separately declared Fanout canaries and fixed repetition cohorts. Task-specific runbooks supply repository paths, baseline identities, task prompts, allowed paths, validation commands, and expected routing. This is reusable experiment methodology, not a requirement to launch another run for the [research preview](../STUDY.md). Commands use ordinary Git, npm and tmux; no `rtk` wrapper is required.

## Run classes

- A **canary** is the first live execution after any Fanout source, task, packet, profile, routing, concurrency, platform, or dependency change.
- A **repetition** gets a new execution run ID and clean active checkout while reusing the canary's byte-identical frozen inputs and baseline.
- A **concurrent cohort** runs repetitions simultaneously from independent active worktrees. It measures reliability under load; resource contention makes its wall time, TTFT, generation time, tool time, and validation duration unsuitable as uncontended performance baselines.

Run one canary first. Do not start repetitions until its execution, controller final validation, artifact inspection, and cleanup all pass.

The benchmark therefore has two stages:

1. Run the singleton canary to find and correct protocol, packet, profile, routing, validation, and executor problems.
2. After it passes, freeze the experiment and run the requested number of repetitions for a median, range, completion rate, repair rate, tokens, and cost distribution.

Any correction between those stages creates a new singleton canary. Do not mix the superseded canary with the corrected repetition cohort.

## 1. Declare and freeze inputs

Record:

- Fanout commit and intentional dirty paths;
- target repository and task file;
- expected baseline commit and full Git-visible tree;
- model routing, thinking levels, and concurrency;
- profile, plan, details, work-contract, packet, pointer, Event, and Projection versions;
- exact writable-path allowlist;
- focused node checks, packet-final checks, and profile-final checks;
- platform, Node, npm, and relevant dependency state.

Freeze Fanout before planning:

```bash
git status --short --branch
git rev-parse HEAD
git diff --check
```

Record any intentional diff. Do not change Fanout after planning begins. Any correction requires a fresh canary.

## 2. Verify the target baseline

```bash
git -C <target-repository> status --short --branch
git -C <target-repository> rev-parse HEAD
git -C <target-repository> rev-parse 'HEAD^{tree}'
```

Require the exact clean baseline and installed dependencies. For all benchmarks, reuse recorded successful setup validation when preflight confirms the same baseline commit/tree, task, dependency state, and platform. Do not rerun baseline tests or request a per-run waiver for that unchanged fixture; record the reused setup evidence and identity checks instead. Run baseline validation during initial setup or when relevant state has changed or cannot be verified. Stop on baseline, dependency, task, or platform drift and re-establish the fixture before execution. This rule supersedes duplicate preflight-test instructions in historical task runbooks; it does not skip validation of generated implementations or required acceptance gates.

## 3. Prepare active checkouts

A live Fanout execution holds one lock under the active checkout's absolute Git directory. Therefore:

- never run two executions from the same active checkout;
- a singleton canary or sequential repetition cohort must use a clean checkout, either by restoring and reusing the primary checkout or by using one standalone clone; do not create linked Git worktrees for one-at-a-time execution;
- concurrent runs require one clean active worktree per run;
- every active checkout must start at the exact baseline commit/tree;
- every active checkout must have its own verified artifact namespace and active pointer;
- fixed repetitions must use byte-identical task, packet, profile, and pointer artifacts;
- do not use `FANOUT_WORKTREE_SHARED_PATHS` or share dependency directories between worktrees.

Fanout creates further detached worker, repair, reconciliation, and final-validation worktrees beneath each run. Their paths are run-specific, but concurrent linked worktrees still share Git's object store and worktree registry. Treat any Git lock collision, worktree cleanup failure, or unexpected prune as a failed canary.

Concurrent runs also share host CPU, memory, disk, package-manager caches, and provider capacity. Report their measurements as load-contended evidence. Use sequential runs for uncontended latency or cost comparisons.

Choose the repetition mode based on the intended metric:

- use sequential repetitions for primary wall-time, TTFT, generation-time, and validation-duration distributions;
- use concurrent repetitions to collect correctness, completion, repair, token, cost, and throughput evidence faster, while labeling all timing as load-contended;
- when both matter, keep sequential and concurrent cohorts separate rather than combining their distributions.

Linked worktrees are concurrency infrastructure, not a default isolation mechanism. Before authorizing a concurrent cohort, record its nominal worker ceiling:

```text
simultaneous runs × packet concurrency
```

Five runs at concurrency four may allocate 20 workers at once, plus preparation and validation processes. Confirm host and provider capacity first; otherwise run sequentially. The 60-second stagger reduces the initial burst but does not reduce the eventual ceiling when runs overlap.

## 4. Manage the visible tmux window

Use the tmux window `doubleword:fanout-canary` for every run. This is a window target containing one or more panes.

Before launching:

1. If the window does not exist, create it with the first Pi session rooted in that run's active checkout.
2. If a pane contains an active canary, split the window and start the new Pi session in a new pane.
3. If a pane's run has finished, capture its evidence, quit Pi gracefully, and close that pane before reuse.
4. Record every pane ID, Pi chat/session ID, active-checkout path, and run assignment.

For concurrent side-by-side panes separated by vertical borders, use horizontal tmux splits and normalize the layout:

```bash
tmux split-window -h -t doubleword:fanout-canary \
  -c <run-active-worktree> \
  -P -F '#{pane_id}' -- \
  env -u DOUBLEWORD_API_KEY \
  pi -e <fanout-extension> --model <controller-model> --thinking <effort>
tmux select-layout -t doubleword:fanout-canary even-horizontal
```

For five simultaneous runs, create five panes rooted in five independent active worktrees, then start the live executions 60 seconds apart. The stagger applies to `/fanout-execute`, not merely Pi process creation. If the panes become too narrow for reliable inspection, use additional `fanout-canary-*` windows and record the deviation.

After a run and its evidence capture are complete, quit its Pi session and close its pane. Do not leave completed sessions or panes as durable evidence; authoritative artifacts and the benchmark record must contain the evidence.

## 5. Verify Fanout configuration

Run `/fanout-config` in every Pi session and require exact agreement with the declared Tier 1, async Tier 2, Tier 2 fallback, thinking levels, and concurrency.

Stop and start a fresh canary on configuration drift. Do not repair configuration after planning.

Reuse the existing approved Project Execution Profile when the target repository is still at the exact clean baseline and its dependency state, platform, required commands, profile schema, and profile bytes remain applicable. Verify and record the profile identity and active pointer; do not invoke profile construction or `/fanout-plan --refresh-profile` merely because this is a new canary. Build or refresh a profile only when the target repository or one of those profile-defining inputs changed, no approved profile exists, or identity/applicability cannot be verified.

## 6. Plan and inspect

Run the task-specific exact `/fanout-plan` command. Planning must read the declared task file directly. If access is blocked, stop instead of pasting, moving, summarizing, or improvising the task.

Before execution, verify:

- semantic repair boundaries are correct;
- every writable path appears exactly once across work contracts;
- the union of writable paths exactly matches the task allowlist;
- baseline-context reads do not falsely serialize independent work;
- node checks are focused and use valid direct argv without shell expansion;
- packet-final validation contains only additional task integration checks;
- the profile owns the sole complete repository validation when applicable;
- preparation is isolated and offline-capable;
- baseline, routing, concurrency, profile identity, and packet versions are exact.

Record SHA-256 and byte length for the task, plan, details, packet, profile, and active pointer. These artifacts are immutable for the run.

## 7. Verify dry-run boundaries

```text
/fanout-execute --dry-run
```

Require zero Fanout workers, worker provider calls, allocated attempts, worker tokens/cost, accepted transitions, and active repository mutations. Standing-approved profile validation executes preparation, readiness and clean-baseline normalization before confirmation, including in dry-run; it resolves required final-gate argv without running the final suite. Executed commands may have their disclosed network/external effects. Record those commands and effects separately; dry-run is not an inert operation. Recheck target status and tree. Worker launch or active repository mutation is a hard failure.

## 8. Run one live canary

After explicit user authorization:

```text
/fanout-execute
```

Do not manually edit the target, change authority, or correct packet/profile state during execution. Preserve typed failures and artifacts.

## 9. Inspect the completed run

Run from the active target checkout:

```bash
git status --short
git diff --name-only
git diff --check
git worktree list --porcelain
ps -axo pid,etime,command
tmux list-panes -t doubleword:fanout-canary \
  -F '#{pane_id} #{pane_current_path} #{pane_dead} #{pane_current_command}'
```

Require:

- controller final validation passed and its complete command evidence is present;
- actual changed paths exactly match authorized paths;
- `git diff --check` passes;
- no execution lock, worker, test process, or unexpected worktree remains;
- the final accepted tree and active-checkout tree agree.

Do not rerun the profile's full validation suite externally when the controller already ran and recorded it. Run an external full suite only when explicitly requested or when controller final-validation evidence is missing, incomplete, or suspect; record that exception separately from benchmark execution time.

Capture evidence before quitting Pi and closing the pane.

## 10. Capture evidence

Record:

- Fanout commit and dirty-state explanation;
- pane, Pi session, planning lineage, and execution run IDs;
- task, plan, details, packet, profile, and pointer identities;
- baseline and final trees;
- routing, concurrency, platform, and profile identity;
- dry-run worker/active-mutation boundary proof and profile-command effects;
- changed-path authority and actual changes;
- attempts, retries, repairs, fallbacks, reconciliation, recovery, and terminal dispositions;
- worker-summary continuity and completeness;
- advisory worker validation separately from controller-authoritative validation;
- controller final-validation results and any exceptional external validation;
- wall time, overlap, TTFT, generation time, tool time, tokens, and cost;
- process, worktree, lock, Pi-session, and pane cleanup.

Report correctness, authority, and cleanup before time or cost.

## 11. Stop conditions

Stop on the first source, task, baseline, packet, profile, pointer, routing, concurrency, dependency, platform, authority, validation, controller, worktree, process, lock, or artifact drift. Do not continue a cohort after an unexplained failure.

Any correction requires a fresh canary. A failed or changed canary is not repaired into membership of the prior cohort.
