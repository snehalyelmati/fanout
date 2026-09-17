# Reproducing calculations and running new experiments

The published [results](README.md) are curated scalar summaries. Regenerating figures reproduces their arithmetic and presentation; it does not rerun models or replay the historical experiments. Original model sessions, prompts, tool logs, candidate archives and event streams stay local. Some experimental drivers were specific to those local archives and are not distributed as turnkey historical reruns.

## Task inventory

These are historical task definitions and pinned source revisions, not a claim that the task set covers all useful parallel work. Obtain upstream code independently and retain its license. Public issue/reference solutions can contaminate model evaluation; related Pi tasks are not independent repository samples.

| Task | Repository and baseline | Required behavior / acceptance boundary |
| --- | --- | --- |
| Execa Web Streams, 5 August cohort | `sindresorhus/execa`, upstream `c31c94c2c65e1aaf1b4d3295eaf927b910a2dc46`; historical local fixture `6e9ed1185adca485097d299da263a38d74ee636b`, tree `475de97e8bce060242e1ce9025d10e7f763735bd` | Add asynchronous `readableStream()`, `writableStream()` and `transformStream()` methods, pipeline forwarding, early-error behavior, public types, tests and documentation within 14 authorized paths. Controller final validation and separate full-suite reruns; no common independently authored semantic acceptance suite. The local fixture is not an upstream release or a bundled checkout. |
| p-map iterable abort | `sindresorhus/p-map`, `c3c261e2189f94d1a09724e8f03d5345af518017` | Add optional `AbortSignal` support to `pMapIterable`; preserve abort reason, stop new work/yields, handle pending source values and mappers, close the iterator and remove listeners. Include public types, tests and documentation. Required native suite, independent acceptance and path scope. |
| qs strict merge | `ljharb/qs`, `88e15636da953397262bd3014ab8b0d17d5c8039` | Add `strictMerge: true` by default: object/scalar conflicts become arrays retaining both values in encounter order, including dot notation. Preserve prototype-sensitive scalar values and null-prototype nested objects; `strictMerge: false` retains legacy behavior. Independent API cases plus native lint/tests/README/scope gates. Reference: `cb41a545a32422ad3044584d3c4fa8f953552605`. |
| Pi issue 764, exact56 | `earendil-works/pi`, `c5cf74e032ec31b926c5acc5e21b017cf434f63e` | Keep the resume selector header within 56 columns for populated, empty-folder and empty-all-session states; preserve wider guidance and cancellation. The historical scope is the specific 56-column reproduction, not every width. Reference: `588399594c36cf4ee5bb04d4ab9e8220adc66b5f`. |
| Pi PR 787 | `earendil-works/pi`, `ffdc8d686ba6157a6bacd26456a2b6f4414d0401` | Add the declared tree-navigation option contract, prompt replacement/empty-instruction behavior and branch labeling across adapters and docs without extra hook API expansion. Nine external gates, 36 focused tests and manual public-scope/Markdown review. Historical reference: `81f5a12e812fbf1704f2e805a8388edff8937c15`; its documentation was incomplete for the explicit task. |

The qs task gate boundary was roughly 6.6s; admitted Pi rendering and tree-navigation reference gates took 5.073s and 10.120s on the recorded host. These are preparation measurements, not cross-machine guarantees. Pi validation covered named lint/type and focused tests, not every monorepo test or every application startup mode. Full historical acceptance details and checker identities are in the [benchmark ledger](../BENCHMARKS.md).

## Boundaries of the historical evidence

The [Execa five-run cohort](../benchmarks/execa-web-streams-manual-e2e.md#2026-08-05-five-repetition-cohort) held the packet, profile, routing, concurrency and task baseline fixed. Its runtime source was `ebbbd7ecba4418fb58944558727b933f690c090d`, packet SHA-256 `974cb3b9eb0a48e3c1cbc8dd2e6e0a3bbe90374e185a119c4e9a79d3f287596c`, and profile SHA-256 `50c9bec27ac95da0453bc11092e5a1b40830540175c10f82461fc72c7916acf1`. Reported durations and costs cover live execution, excluding planning; separate post-run checks establish additional validation evidence, not a longer measured completion boundary. The preceding canary is separate from the five repetitions. Later Execa planning comparisons used a different local baseline and produced artifacts without executing workers. Preserve those identities and boundaries rather than treating all Execa observations as one cohort.

The selected September workflow comparisons use their declared task-completion clocks, including planning where applicable, required checks and recovery. They retain the exclusions and evolving acceptance described in the [study](../STUDY.md#methodology-and-reproducibility). Comparing their totals with execution-only Execa times would mix different boundaries. Earlier retrospective session analyses are assumption-dependent estimates rather than live workflow results.

The [Doubleword realtime probes](../BENCHMARKS.md#l1--realtime-doubleword-ttft-microbenchmark) used four explicit model IDs, medium reasoning, requested priority service, streaming and a 16,384-token output cap. There were 50 sequential short-answer calls per model and five long-context calls per model, with alternating model order by round. They measured headers, first event, visible-text TTFT and total duration, excluding Pi/session startup. Long prompts had model-specific native token counts; five samples cannot characterize stable tails. Streamed and retrieved service-tier labels differed as documented. These probes do not measure coding completion, concurrent load or async service behavior.

## Available source tools

Follow [source setup](../GETTING_STARTED.md) first. The repository includes the normal Fanout commands, synthetic simulator tests, trace-summary utilities for your own local data, and versioned p-map acceptance scripts. It does not bundle the upstream tasks' source or the historical model responses.

For an independently prepared p-map candidate based on the pinned commit:

```sh
node scripts/benchmarks/p-map-acceptance-v2.mjs /absolute/path/to/p-map-candidate
node scripts/benchmarks/p-map-completion-v3.mjs /absolute/path/to/p-map-candidate
```

Acceptance-v2 is a semantic/path check; completion-v3 adds public signal typing and required artifact checks. Completion-v3 requires the historical candidate dependency `@tsd/typescript` version 5.2.2; a differently resolved version fails its identity gate. Neither check replaces the candidate repository's native test suite or manual review. The original baseline is expected to fail new-feature acceptance. The scripts execute candidate code and are intended for trusted, non-adversarial implementations.

The historical `scripts/benchmarks/p-map-raw-canary-v2.mjs` requires separately prepared task, settings, auth, protocol and checker inputs with exact identities. It is retained as methodology source, not a one-command default benchmark. Do not copy a historical credential file or weaken its identity checks to make a new run pass. Credentials belong in private local configuration and must never be included in public result assets.

## Declare a new comparison

1. Name the question and the workflows compared: ordinary Pi realtime/async or parallel Fanout realtime/async. Label whole-task experiments separately. Declare planner, worker and repair assignments, provider/service, reasoning and prices. Distinguish source preparation from implementation reasoning; count expensive planning that supplies any part of the solution.
2. Pin the task baseline, dependency lock, candidate authority and independent checker bytes. Verify the checker rejects the baseline and relevant broken candidates and accepts valid alternatives. Keep runtime code and tests together where repair requires both.
3. Freeze repetition count, order, budgets, timeout behavior and infrastructure stop rule before starting. Reuse qualified raw references only while the relevant task/model/environment/accounting remains comparable. Record any changed checker boundary.
4. Start from clean isolated repositories. Time from before the first task-model request through required preparation, planning, tools, failed work, repairs, integration, required acceptance and cleanup. Record excluded common provisioning, initialization and human waits separately. State whether manual quality review is inside or outside the clock.
5. Check final candidate identity across gates, authorized paths, semantic behavior, public types and documentation quality. Preserve failed results as failed even when the generated test suite passes. A final reply or matching patch does not complete an interrupted gate round.
6. Report all attempts and their estimated cost, completion/error time, sequential request depth and actual recovery exposure. Mark missing fields unavailable. Repository acceptance with valid partial measurements does not make missing totals comparable; contradictory evidence remains invalid. Do not replace failed trials, average selected successes or infer a reliability rate from two passes.
7. Store full evidence only in ignored local paths. Publish a small curated summary with source/task/checker identities, scalar metrics and limitations. Review every exported field for private paths, prompts, events and credentials.

For modeled follow-ups, preserve observed outcomes and recovery work. Changes in latency or prices cannot predict a different model's quality, tokens or decomposition. Hypothetical provider continuation/caching requires an explicit policy and must remain separate from measured service behavior. No live paid experiment is needed to regenerate this release's figures.
