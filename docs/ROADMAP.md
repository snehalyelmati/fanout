# Roadmap

## Objective

Build Fanout as a planning-to-execution bridge, plus a standalone Doubleword provider and a Pi adapter:

- `doubleword-provider`: how to call Doubleword models and tiers.
- `fanout-core`: how to turn a user objective plus context into an execution packet, optimized DAG, validation contract, and execution summary.
- `fanout-pi`: Pi adapter/install target that exposes `/fanout-plan` for packet preparation and `/fanout-execute` for execution.

Fanout's workflow is split into three phases:

1. **Research and planning by the user**: users bring whatever research, planning notes, specs, or repo context they prefer. Fanout does not own this phase.
2. **Execution packet**: `/fanout-plan [objective]` runs two explicit prompts plus a compiler: first a solve/plan artifact, then repo-grounded implementation details, then deterministic packet/DAG compilation.
3. **Execution**: `/fanout-execute` runs the active accepted packet with worker management, validation, patch integration, and summary metrics.

The Doubleword provider adapts to these inference tiers:

- **Realtime**: interactive, standard OpenAI-compatible usage.
- **Async / tier 2**: minutes-scale TTFT via Responses API polling, lower cost.
- **Batch / tier 3**: long-running JSONL batch jobs, lowest cost.

Fanout should preserve developer velocity by using slower tiers only where latency is hidden by planning, parallelism, background execution, or explicit user acceptance.

## Principles

- User-owned research/planning stays decoupled from execution.
- Implementation-plan and implementation-details artifacts are the boundary between research/planning, repo grounding, and deterministic packet compilation.
- Execution packets are the stable boundary between planning and execution.
- Stay Pi-native first; avoid a new agent loop unless necessary.
- Keep Doubleword provider support independent from Fanout.
- Keep Fanout core independent from Pi and Doubleword.
- Stub before live endpoints.
- Observability first.
- Use simple packet and scheduler contracts before custom orchestration.
- Separate workflow gains from provider-tier savings in every benchmark.
- Keep expensive/deep workflow ideas deferred until benchmarks justify them.

## Current Fanout workflow roadmap

### End-to-end hardening

Status: The current closed generation is Project Execution Profile v1, plan v3, details v6, packet v9, pointer v2, work contract v4, Attempt Outcome v5, final evidence v2, Event v5, Projection v6, and presentation entry v1. Planning uses canonical TypeBox structures, phase-specific terminating submission tools, phase-isolated provider context, Pi-native read-only filesystem access, and Phase A-only global forbidden writes. Workers have six file tools plus manifest-bound advisory `fanout_validate`; controller validation remains authoritative. Work contract v3 and packet v8 require replanning; older execution evidence remains descriptive Legacy data.

Live `/fanout-execute` remains blocked from release until the explicitly authorized macOS p-map canary, fresh review, and repository-owner approval pass for the same immutable commit. Offline readiness does not satisfy those external gates.

### Phase 1: User-owned research and planning

Status: external to Fanout.

Fanout assumes the user may arrive with research notes, implementation ideas, repo context, screenshots, design docs, issue links, or no extra context at all. Fanout should consume this context but not prescribe the user's research workflow.

Acceptance criteria:

- `/fanout-plan` works with either a supplied objective or the current conversation context.
- Packet preparation clearly lists missing facts and clarification needs instead of inventing them.
- The packet records user-provided context separately from inferred repo facts.

### Phase 2: Execution packet via `/fanout-plan`

Status: Phase 2B now publishes plan v3/details v6 and compiles work-contract v4 nodes into profile-bound packet v9. A separately approved profile v1 owns preparation, readiness, normalization, and required final gates. Phase-specific structural schemas reject malformed submissions before tool execution, while contextual semantic checks retain plan membership, profile-gate, resource, identity, and graph policy. Provider context is isolated by phase without altering session history. Phase A alone owns global forbidden writes; Phase B keeps node validation focused on owned changes and reserves packet-final commands for additional task-specific integration. `/fanout-plan --refresh-profile` validates replacement before pointer publication; failed refresh preserves the prior profile. Live canary evidence remains a release gate, not an offline implementation claim.

P0 prompt-DAG dry-run benchmarking graduated `combined-general-conflict-proof` as the current best DAG prompt candidate across known and heldout tasks. The hardened `/fanout-execute` offline smoke matrix now covers the public dry-run and live seams, repair, integration, final validation, event replay, and cleanup. Treating the prompt as a released runtime default still requires the explicitly authorized macOS p-map canary and repository-owner approval.

The hardened Phase 2B contract and its resolved audit scope are summarized in [`docs/impl/phase-2b-fanout-plan.md`](impl/phase-2b-fanout-plan.md).

Goal: prepare a user-reviewable active packet that is detailed enough to execute later, with DAG validation completed before the packet is accepted.

Build the smallest useful packet first:

1. **Context intake**
   - Objective, constraints, user notes, repo facts, risks, assumptions, and open questions.
   - Separate user-provided context from inferred repo facts.
2. **Read-only exploration**
   - Inspect local files, docs, configs, tests, and history needed for the next decision.
   - Ask only for non-discoverable intent/tradeoffs, one question at a time with a recommended answer.
   - Do not edit project files, patch, migrate, codegen, or run destructive commands; writes are limited to Fanout artifact storage.
3. **Prepare implementation-plan artifact**
   - Define implementation items, behavior/contracts, likely writable files/resources, read-only context, semantic dependencies, validation intent, acceptance criteria, risks, and forbidden scope.
   - Draw item boundaries around independently acceptable and repairable changes, keeping inseparable production behavior and its behavioral tests in one item; declare genuine shared reads without padding for fusion.
   - Do not choose anchors, worker ownership, parallelism, execution dependencies, or tiers in this phase; semantic dependencies are traceability/planning context, not DAG edges.
4. **Prepare implementation-details artifact**
   - Ground Phase A items in exact files/resources, stable anchors, edit intent, new-file content shape, read-dependency classification, and the narrowest meaningful task-specific validation commands for each node's owned changes; Phase A remains the sole source of global forbidden writes, while shared infrastructure, configuration, build, and test-harness changes may require broader checks.
   - Treat the exact approved profile as guaranteed: do not repeat its commands, and use packet-final commands only for additional task-specific integrated checks before profile-owned project-wide gates.
   - Reject an exact node or packet-final duplicate of a profile final gate in core artifact admission as a correctable draft; identify both locations and let the Pi controller preserve the planning session for resubmission instead of silently deduplicating.
   - Do not invent contracts/APIs/product scope or write packet/DAG fields.
5. **Compile canonical work contracts and execution DAG**
   - Structurally admit plan v3/details v6 through canonical schemas, reject malformed anchors/endpoints/source IDs/commands before semantic compilation, group overlapping typed changes into packet-v9 work-contract-v4 nodes, derive dependency edges from typed `post-change-required` reads, propagate every Phase A ban, assign tiers, fuse eligible unique vertical chains, and add the final-validation contract.
   - Persist no default node, flattened worker packet, or duplicate graph authority.
6. **Validate the DAG during compilation**
   - Reject cycles, ownerless reads, overlapping ownership contradictions, missing direct-argv validation, malformed semantic criteria, tier-policy violations, and ambiguous read/write overlap.
   - `baseline-context` read overlap does not serialize; `post-change-required` read overlap creates a dependency; unrepaired ambiguous read overlap may fall back to conservative sequential dependencies with a warning.
7. **Optimize the execution plan**
   - Estimate critical path, parallel width, tier choices, expected active wait, background completion time, cost, and risk.
8. **Emit the active user-facing execution packet**
   - Derive the DAG, typed ownership, tier/model plan, expected writes, validation manifests, warnings, and risks from the admitted packet and work contracts.
   - Publish packet-derived views first and the exact digest-bound pointer v2 last for `/fanout-execute`.

Packet artifacts:

```text
~/.pi/agent/fanout/<project-id>/<run-id>/implementation-plan.json
~/.pi/agent/fanout/<project-id>/<run-id>/implementation-details.json
~/.pi/agent/fanout/<project-id>/<run-id>/execution-packet.json
~/.pi/agent/fanout/<project-id>/<run-id>/execution-plan.md
~/.pi/agent/fanout/<project-id>/<run-id>/execution-dag.mmd
~/.pi/agent/fanout/<project-id>/active-packet.json
~/.pi/agent/fanout/<project-id>/profiles/<profile-id>.json
~/.pi/agent/fanout/<project-id>/active-profile.json
~/.pi/agent/fanout/<project-id>/observability/<session-run-id>/observability.jsonl
```

Phase 2 acceptance criteria:

- `/fanout-plan [objective]` produces implementation-plan, implementation-details, and active packet artifacts without mutating project files.
- The packet can be reviewed by a human before execution.
- DAG validation catches cycles, file ownership conflicts, missing validation, and unresolved required decisions before the packet is accepted.
- Estimates distinguish active wait, background completion, provider tier cost, and workflow savings.
- Pi-owned observability correlates `sessionRunId`/`planRunId` and logs invocation plus Phase A's authoritative resolved objective, model tiers, token/cache usage, cost, local TTFT, total and per-phase duration, per-tool timings, union-of-tool-active wall time, non-tool wall time, validation failures, `fanout_plan_end`/`fanout_plan_failed`, and the resulting artifact path without dirtying the target repository. DAG depth/width and rejected/accepted execution work remain in packet/execution artifacts rather than the common planning log.

### Phase 3: Execution via `/fanout-execute`

Status: The profile-bound runtime cutover is implemented. Focused gates cover isolated preparation, deterministic reconciliation, exact no-progress, fusion, cleanup-before-terminal timing, replay, and profiler compatibility. The controlled p-map canary plus three identical repetitions and repository-owner approval remain release gates.

The Execa asynchronous Web Stream transfer/complexity benchmark completed one controlled canary at its fixed reproducible baseline. It follows the p-map release gate rather than replacing it; no repetitions, reliability rate, cross-task speed comparison, or universal SLO exist. Post-canary evidence exposed duplicated project-wide final validation and broader-than-needed node checks, now addressed at the Phase B planning boundary. See [`docs/benchmarks/execa-web-streams-manual-e2e.md`](benchmarks/execa-web-streams-manual-e2e.md).

Goal: execute the active accepted packet, manage workers, validate outputs, run authoritative final validation, and return control with summary plus metrics.

Implemented order:

1. **Active packet loader and guardrails**
   - Load the active execution packet prepared by `/fanout-plan`.
   - Admit only pointer v2 bound to packet v9 and its exact packet-bound profile v1 identity; an orthogonal active-profile refresh does not invalidate an existing packet. Reject legacy or mixed generations before lock creation or mutation.
   - Revalidate the profile in a disposable clean worktree before confirmation or model allocation; reject shared-path configuration.
   - Refuse paths outside the project artifact root, exact planning commit/tree/platform drift, unsafe typed resources, unavailable direct validation executables, unavailable worker capability, and non-executable derived graphs.
   - Hold one canonical git-worktree execution lock for the run; never delete an existing lock automatically as stale.
   - Show the objective, work-unit count, concurrency, apply behavior, and audit path before asking the user to confirm launch.
2. **Execution run recorder**
   - Derive `<packet-artifact-dir>` from the loaded packet path and create `<packet-artifact-dir>/executions/<execution-run-id>/` before mutation.
   - Write authoritative event v5 `events.jsonl`, derived projection v6 `execution-run.json`, and terminal deterministic `summary.md`; cleanup completes and is timed before `run-finished`.
3. **DAG scheduler**
   - Execute ready nodes in dependency order with deterministic packet-order tie breaking.
   - Keep scheduling separate from worktrees, workers, patch capture, validation, and repair.
4. **Worker management**
   - Run approved work units in independently profile-prepared git worktrees through curated non-interactive Pi subprocess workers.
   - Expose only six file tools plus zero-argument `fanout_validate`, bound to the attempt's immutable contract command manifest; require it to be a lone tool call, return failures immediately, and keep its evidence advisory while the controller reruns authoritative validation.
   - Use `--no-context-files` and explicitly inject only applicable repo-local `AGENTS.md`/`CLAUDE.md` instructions into the curated prompt, while leaving automatic Pi extension discovery enabled under `--approve`; enabled extensions are a separate trusted runtime boundary.
   - Capture the final numbered `Worker summary` from the existing model response and pass it only to the immediately following node validation-repair prompt; keep it outside routing, recovery, validation, budgets, acceptance, and replay.
   - Rebuild previously accepted integration state in each fresh downstream worktree by replaying the ordered ledger's digest/length-bound `patch.bin` transitions with exact base/result-tree, changed-path, and patch-stat verification; create no baseline commits or snapshot authority.
5. **Patch, validation, and apply gates**
   - After a successful worker edit, run every profile-declared candidate normalizer once, audit identities, capture the patch, enforce authority, run packet task validation, and apply only accepted whole-node patches.
   - Discard an original `unauthorized-change` candidate whole and spend at most the existing clean retry in a fresh reconstruction with the same assignment and work contract; repeated unauthorized changes and all forbidden changes fail.
   - Before integration repair, reconcile only exact path-disjoint stale candidates by reconstruction, overlay, normalization, recapture, ownership, validation, and compare-and-swap.
   - Continue past normalizer nonzero results so partial deterministic fixes reach authoritative validation; hard execution/identity failures stop without consuming model-repair budget.
   - Keep Git-observed filenames identity-preserving at the ownership gate; reject lossy path normalization.
   - Reject validation commands that change the captured patch or move the detached worker `HEAD`.
   - Serialize active-worktree apply checks and applies so parallel workers cannot race the integration state.
   - Allow only typed bounded Tier 1 recovery for validation failures and integration conflicts.
6. **Retry / realtime fallback**
   - Use fixed MVP retry/repair limits. Retry classified transient facts and one original unauthorized candidate only; stop after a repeated unauthorized change or when exact candidate and typed repair-failure state repeat, leaving unused budget untouched.
   - After retryable Tier 2 exhaustion, run at most one realtime attempt with the packet's concrete `tierPlan.tier2Fallback` model, and only when the typed work-unit assignment permits realtime fallback.
   - Do not switch remaining nodes globally. Tier 1 remains reserved for control-plane work and typed validation/integration recovery.
7. **Summary and metrics**
   - Return node and final-validation results, retry/fallback outcomes, token/cost totals, run time, poll time, tool time, patch stats, and artifact links.

Phase 3 acceptance criteria:

- `/fanout-execute` can run the active packet end-to-end with isolated workers and deterministic final validation.
- Failed or late workers cannot corrupt the active worktree silently.
- Every accepted worker has complete provider/model/tier/token/cost/TTFT/poll/tool/duration metrics.
- The executor records enough metrics to compare against baseline Pi execution.
- User regains control with a concise summary, validation status, and artifact links.

## Supporting/completed tracks

The sections below capture provider, observability, and benchmark work that supports the current Fanout workflow.

## Track 0: Project docs and planning

- Create project docs and working rules.
- Track scope in this roadmap.
- Track decisions in `docs/DESIGN_DECISIONS.md`.
- Keep the repo as one minimal monorepo with `doubleword-provider`, `fanout-core`, and `fanout-pi`.

## Completed: Standalone Doubleword provider extension package

Status: published as the provider extension package `@snehalyelmati/pi-doubleword-provider` version `0.1.2`; local development now includes reasoning/tier metadata pending the next release.

Install:

```bash
pi install npm:@snehalyelmati/pi-doubleword-provider
```

Pi package page: <https://pi.dev/packages/@snehalyelmati/pi-doubleword-provider>

Release process used:

1. Chose the standalone provider boundary and npm name `@snehalyelmati/pi-doubleword-provider`.
2. Validated local and packed install shape with `pi -e`, smoke tests, and `npm pack --dry-run`.
3. Set npm metadata: public package, provider README, and `keywords` including `pi-package`.
4. Verified the `pi` manifest: `"pi": { "extensions": ["./src/index.ts"] }`.
5. Published with public npm access.
6. Verified the Pi package gallery page.

## Track 1: Provider stubs

Status: provider stubs live in `doubleword-provider`, with `fanout-pi` registering them for Pi.

Build provider stubs without hitting Doubleword live endpoints.

### Realtime stub

- Immediate fake response.
- Optional fixture-backed responses.
- Optional fake streaming if needed for UI tests.

### Async stub

- Simulate submit → queued/in-progress → complete.
- Configurable TTFT / poll delay.
- Fake response IDs.
- Fixture-backed final text/tool-call responses.

## Track 2: Observability test environment

Status: initial JSONL hooks are in place for provider, TTFT, async polling, usage/cost, errors/abort, tool timings, agent turn count, and tool batch size per turn. A tiny observability smoke asserts core JSONL events/fields; Phase 6 now has an initial offline trace summarizer, while full trace replay/dataset benchmarks remain deferred.

Capture per-run JSONL spans for:

- run/session IDs
- provider tier
- model/provider name
- provider submit time
- time to first token/event (TTFT)
- total provider time
- poll count and poll duration
- tool execution timings
- turn and agent timings
- agent turn count and per-turn tool batch size
- token usage
- cost estimate
- errors/abort state

Suggested output locations:

```text
runs/<run-id>/observability.jsonl
runs/<run-id>/plan.md
runs/<run-id>/jobs/*.json
```

## Track 3: Pi-native planning workflow

Status: superseded by the `/fanout-plan` execution-packet workflow. The old planning-only prompt should be removed instead of evolved further.

Keep the useful planning rules from the old prompt inside packet preparation:

- Plan only during packet prep: no edits, patches, codegen, migrations, or mutating commands.
- Investigate before asking when facts are discoverable from the repo/environment.
- Separate discoverable facts from user intent/preferences.
- Ask until goal, success criteria, scope, constraints, tradeoffs, validation, and acceptance are decision-complete.
- Produce a compact, human-reviewable plan before execution.

The planning surface is now `/fanout-plan`, not a standalone prompt template.

## Track 4: Live-shaped realtime Doubleword stubs

Status: `doubleword-stub` exposes the first live-shaped model IDs, pricing metadata, reasoning metadata, and realtime/async/batch Fanout tier metadata. An opt-in `doubleword` live provider now calls the Responses API with `service_tier: "priority"`, discovers live models from `/v1/models`, fills missing reasoning/tier metadata while preserving live catalog fields, and caches that catalog; normal validation remains offline and keyless.

- Register Doubleword realtime-shaped stub models for `glm-5-2` ($1.40/$4.40 per MTok in/out) and `deepseek-v4-flash` ($0.14/$0.28 per MTok in/out).
- Use pricing metadata from `https://doubleword.ai/pricing` for stub cost estimates and known live model tier costs; unknown discovered models remain available with zero-cost placeholders until pricing is added.
- Keep the stub path available for tests; no live API key or network required.
- Verify model IDs, fixture streaming, usage reporting, pricing metadata, reasoning metadata, and tier capability metadata.
- Register opt-in live realtime models under `doubleword` from provider discovery/cache, falling back to the minimal GLM/DeepSeek list when discovery is unavailable.
- Keep live smoke opt-in with `DOUBLEWORD_API_KEY`; no live network in default checks.

## Track 5: Live async Doubleword provider

Status: opt-in async mode for `doubleword` is wired for discovered/cached live models, Responses API background polling, 16k default output cap, wall-clock timeout, transient poll retry, final GET on timeout, and best-effort remote cancellation. `doubleword` and `doubleword-stub` keep model IDs stable and use a status-line toggle for realtime vs async when the selected provider supports multiple tiers. Normal validation remains offline and keyless.

- Register live-shaped async-capable models under `doubleword` from provider discovery/cache, falling back to the minimal GLM/DeepSeek list when discovery is unavailable.
- Use Responses API at `https://api.doubleword.ai/v1` with `service_tier: "flex"`, `background: true`, top-level `reasoning_effort` for reasoning-capable models (default medium unless Pi passes another thinking level), and `max_output_tokens` defaulting to 16k (`DOUBLEWORD_MAX_OUTPUT_TOKENS` overrides).
- Poll `GET /v1/responses/{id}` while status is `queued` or `in_progress`, retry transient poll failures, and enforce a 10 minute wall-clock timeout (`DOUBLEWORD_LIVE_ASYNC_TIMEOUT_MS` overrides).
- On timeout, perform one final GET; if still incomplete, best-effort cancel `POST /v1/responses/{id}/cancel`. On user abort, stop the local stream promptly and fire-and-forget the remote cancel.
- Translate completed Responses output into Pi assistant events after completion: reasoning items become `thinking` blocks, final `output_text` becomes text; no streaming before completion is assumed.
- Track response ID, status transitions, requested/actual service tier, poll time, usage, timeout, cancellation, retries, and errors.
- Keep live smoke opt-in with `DOUBLEWORD_API_KEY`; no live network in default checks.

Key limitation to validate live: async responses may not stream; Pi may only receive content/tool calls after completion. Tool-call translation remains pending.

## Track 6: Stub/trace benchmarks

Status: initial offline trace summarizer, smoke fixtures, deterministic hybrid policy simulation, and target evidence docs are in place. It reads local `observability.jsonl` files, raw Pi session JSONL traces, and versioned synthetic hybrid workflow JSONL fixtures, then produces `runs/phase6/summary.json` plus `summary.md`; no live calls or replay engine. Manual semantic subagent reviews now supersede the coarse optimistic-DAG heuristic. Hybrid fixture reports now include policy matrices with active TAT, background completion, target status, per-node schedules, budget/deadline/fallback/speculative evidence, and tier2 concurrency caps. The mixed fixture command demonstrates synthetic non-baseline tier2 passes for eligible workflow shapes and marks linear mandatory active critical paths infeasible. Results are tracked in `docs/BENCHMARKS.md`, [`docs/benchmarks/semantic-dag-and-rpe.md`](benchmarks/semantic-dag-and-rpe.md), and [`docs/benchmarks/hybrid-target-evidence.md`](benchmarks/hybrid-target-evidence.md).

Run:

```bash
rtk npm run benchmark:traces -- datasets/fixtures/phase6-observability.jsonl
rtk npm run benchmark:traces -- datasets/fixtures/pi-session-trace.jsonl --model glm-5-2
rtk npm run benchmark:traces -- datasets/fixtures --model glm-5-2 --out runs/mission-hybrid-benchmark
# after placing ignored external samples under datasets/traces/pi-mono-sample:
rtk npm run benchmark:traces -- datasets/traces/pi-mono-sample --model glm-5-2
rtk npm run smoke:benchmarks
```

Candidate datasets:

- `badlogicgames/pi-mono` — Pi-native session traces.
- `grfwings/pi-session-traces` — Pi-native traces.
- `trace-commons/agent-traces` — mixed agent traces, includes Pi/Claude/Codex/etc.
- `pagarsky/agent-trace` — telemetry-oriented tool-use traces.
- `NJU-LINK/CodeTraceBench` — labeled trajectory diagnosis benchmark.
- `nebius/SWE-agent-trajectories` — SWE-agent trajectories.
- `nebius/SWE-rebench-openhands-trajectories` — OpenHands trajectories.
- `nvidia/Open-SWE-Traces` and `nvidia/SWE-Zero-openhands-trajectories` — large SWE trace sets.

Store local samples under:

```text
datasets/traces/
datasets/fixtures/
```

Current benchmark questions answered by the summarizer and `docs/BENCHMARKS.md`:

- How many model turns does the workflow need? Use `agent_end.turnCount` and `turn_*` events.
- How many local tool calls are batched into each turn? Use `turn_end.toolCallCount`.
- Does async TTFT multiply wall-clock time or get amortized? Use async provider duration, TTFT, poll count, and poll duration totals.
- What is cost vs realtime? Use provider usage/cost totals plus the `glm-5-2` tier comparison table.
- Does planning-first reduce retries and wasted turns? Compare summaries from plain runs vs `/fanout-plan` packet-prep runs.
- Which synthetic hybrid workflow policies meet the 3x active TAT target? Use hybrid policy results, active/background schedules, and target statuses.
- Which workflow classes are ineligible? Linear mandatory critical-path fixtures are reported as infeasible instead of as tier2 feasibility passes.
- Which evidence is observed versus synthetic? Mixed reports preserve `observability`, `pi-session`, and synthetic `hybrid-workflow` source labels.

Deferred until the summaries prove they are needed: external dataset downloader, trace replay engine, strict DAG executor, subagents, and indexing.

## Track 7: Planned Parallel RPE prototypes

Status: design docs, offline safe-work-unit evaluator, full `pi-mono` TAT bucket code-shard evaluation, and trace-derived wait estimates are in place. Runtime prototype is folded into Phase 2 execution packet work and Phase 3 execution work.

Trace-backed direction:

- Generic interactive DAG tier2 routing is weak: manual semantic review found only ~1.5% tier2 savings in 10 traces.
- One-turn synthetic hybrid fixtures prove simulator accounting, but they are insufficient evidence for realistic multi-turn Pi traces.
- Tier1 semantic batching is valuable: manual estimates show ~25% savings from fewer turns/context, independent of Doubleword.
- Research-plan-execute background routing is promising: 5 RPE traces saved ~22% when research+plan stayed tier1 and execute moved to tier2, but sequential completion became 14-28h.
- Full `pi-mono` TAT bucket code-shard evaluation found 49 predicted code-edit units across 15 traces, with 31 safe independent, 16 safe-after-dependency, 2 unsafe, safety precision 1, and tier2 execution waits of 5-40m by accepted DAG depth.
- Speculative duplicate implementations are usually wasteful unless the scheduler proves independence, file ownership, budget, and cancellation constraints up front.

Design target: two narrower opt-in workflows, documented in [`docs/OPTIMISTIC_DAG_WORKFLOW.md`](OPTIMISTIC_DAG_WORKFLOW.md):

1. `semantic-batching-tier1`: realtime/tier1 workflow that reduces turns, redundant checks, and context bloat.
2. `planned-parallel-rpe`: tier1 planner, conflict-aware scheduler, isolated tier2 background executors, parallel reviewers, cancellation for speculative pre-confirm work, file ownership constraints, and tier1 final review/synthesis.

The hardened Phase 2 and Phase 3 contracts are implemented. Next work is evidence-driven:

- Measure packet-v9 scheduling against accepted DAG depth, immutable concurrency, typed outcomes, complete accepted metrics, fusion count, reconciliation, and actual Tier 2 wait.
- Compare advisory worker-validation calls with authoritative validation failures, validation/final repair attempts, runtime, tokens, and cost before claiming the new capability improves workflow efficiency.
- Extend observability only for demonstrated gaps in active planning time, background completion time, late outputs, review latency, or acceptance failures.
- Keep scheduler changes subordinate to typed work-contract authority, exact transitions, causal events, and fresh final validation.
- Keep default duplicate implementations deferred until trace-derived evidence shows they are worth the cost.

## Track 8: Live endpoint benchmarks

After stubs, traces, and RPE routing policies:

- Run small live realtime baseline with `rtk npm run smoke:live:realtime`.
- Run same tasks through live async with `rtk npm run smoke:live:async`.
- Probe batch creation/cancel with `DOUBLEWORD_LIVE_BATCH=1 rtk npm run smoke:live:batch`.
- Compare wall-clock time, TTFT, total time, tool count, token usage, and cost.
- Keep live tests opt-in and API-key gated.

## Track 9: Offline Fanout run profiler

Status: implementation-complete for the approved offline v1 scope; release acceptance still requires the #58 manual walkthrough in current Chrome and Firefox. The local multi-project registry, linked forensic workspace, exact comparisons, two bounded Diagnostic Observations, fixed-behavior concurrency/Provider Profile scenarios, native interaction/accessibility behavior, root validation, and separate representative benchmark are implemented over the current replayable generation. Current scenarios admit total run duration that includes pre-Event profile validation while retaining Event-derived post-confirmation scheduling and rejecting impossible shorter totals. The application stays one private Bun-powered `fanout-profiler` package depending only on `fanout-core`, with one fixed storage root, opaque project-scoped catalogs, explicit single-project override, immutable manual refresh, lazy large-evidence streaming, and a vanilla loopback web workspace. The 2026-07-26 Apple M1 Pro measurement met every local target; see [`docs/BENCHMARKS.md`](BENCHMARKS.md).

Order:

1. Finish the remaining design tickets and produce the implementation specification.
2. Completed: producer and consumer contracts cut atomically from Attempt outcome v2/event v2/projection v3 to v3/v3/v4, adding exact Worker Turn, Provider Response, Tool Invocation, and cache evidence.
3. Completed: the complete offline contract/replay matrix passes for the new generation; no compatibility replay or migration was added.
4. Implementation completed: built and repository-validated the smallest read-only local profiler over the new authoritative event generation, including the catalog, workspace, comparisons, diagnostics, Fanout-concurrency scenarios, independent fixed/cold-warm Tier Provider Profiles, URL-addressable keyboard-operable interactions, and separate measured benchmark. The manual Chrome/Firefox acceptance walkthrough remains pending under #58.
5. Repository startup now resolves one Fanout storage root, prefers the current project, and exposes an accessible URL-addressable picker for every evidence-bearing project under that root; refresh rescans membership, `--artifact-root` remains a single-project override, and the profiler package retains its Pi-independent dependency direction.

Attempt Outcome v5/Event v5/Projection v6 with exact profile identity is the only current replayable execution generation. Older artifacts are Legacy descriptive evidence only.

## Deferred ideas

Only build these if the simpler system fails benchmarks:

- Generic DAG executor beyond execution-packet-driven DAGs.
- Broad subagent orchestration beyond `/fanout-execute` needs.
- Model profiles/fusion: cheap investigator, deep researcher, reviewer, patcher, etc.
- Predictive repo indexing and speculative context gathering.
- Batch-tier orchestration for normal workflows.
- Batch eval/replay workflow beyond basic benchmarks.

## Open questions

- Exact Doubleword async TTFT and SLA per model/account.
- Whether async Responses supports tool calls in the needed format.
- Whether live async exposes useful usage metadata on retrieval.
- Whether any tier supports true streaming before completion.
- Whether Doubleword's Responses cancel endpoint has any provider-specific caveats beyond OpenAI-compatible background response cancellation.
- Which Doubleword models should be exposed first.
