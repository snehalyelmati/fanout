# Execa Web Streams manual Fanout E2E

Status: the first controlled canary completed on 2026-07-29; the focused-validation canary stopped on its first worker-scope failure on 2026-07-30; the bounded unauthorized-change-recovery canary then completed on 2026-07-30 without exercising that recovery route; a normal Pi control completed from the same baseline; the first packet-v9 worker-validation canary stopped on malformed direct-argv TypeScript validation authority on 2026-08-04; the corrected packet-v9 canary and five subsequent repetitions completed on 2026-08-05; the controller-only profile-gate repair canary completed on 2026-08-06; and the requested Doubleword routing matrix stopped on its first singleton after provider metrics-correlation failures.

This is the next transfer/complexity benchmark after the controlled p-map task. It follows the common safety, execution, evidence, failure, and reporting protocol in [`fanout-execution-benchmark-procedure.md`](fanout-execution-benchmark-procedure.md) and the operator workflow in [`p-map-abort-signal-manual-e2e.md`](p-map-abort-signal-manual-e2e.md). This document records only Execa-specific inputs and gates.

## Objective

Implement Web Stream conversion methods for asynchronous Execa subprocesses from the realistic issue-style task brief. Exercise repository discovery, cross-module runtime behavior, public types, pipeline forwarding, early-error handling, documentation, and final integration without exposing the historical upstream implementation to workers.

This task is not directly comparable with p-map for speed or cost because the repository, task, validation suite, and change surface differ. Use p-map as the existing control and Execa as transfer/complexity evidence.

## Fixed setup

| Item | Value |
| --- | --- |
| Task | Add `readableStream()`, `writableStream()`, and `transformStream()` |
| Task brief | `/Users/snehalyelmati/Documents/execa-web-streams/TASK.md` |
| Repository | `/Users/snehalyelmati/Documents/execa-web-streams/repo` |
| Upstream SHA | `c31c94c2c65e1aaf1b4d3295eaf927b910a2dc46` |
| Upstream tree | `01ca61578861dda1e7f191bc44febe5525be3922` |
| Reproducible local baseline | `33e0ba6175e03cc85cbdee982f878cbd6670af4d` |
| Local baseline tree | `dc79b511fdf12392c97c12ff97e1f13af126da78` |
| Baseline difference | committed `package-lock.json` plus `.envrc` and `runs/` ignore entries |
| Runtime | Node `v26.5.0`, npm `11.17.0` |
| Install | `rtk npm ci --ignore-scripts --no-audit --no-fund` |
| Baseline validation | `rtk npm test`; 5,096 unit tests plus lint, `tsd`, and `tsc` |

The repository is a shallow single-history checkout with no remote, so the historical solution is not available through local Git history. `node_modules` is ignored and must not be shared into Fanout worktrees.

## Preflight

Run from the repository and require exact clean baseline identity:

```bash
cd /Users/snehalyelmati/Documents/execa-web-streams/repo
rtk git status --short --branch
rtk git rev-parse HEAD
rtk git rev-parse HEAD^{tree}
rtk npm ci --ignore-scripts --no-audit --no-fund
rtk npm test
```

Keep install and validation as separate commands. Stop if the tree is dirty, identity differs, or any baseline gate fails.

## Plan and profile

Launch Pi from a fresh visible pane rooted at the exact clean baseline, using the current local Fanout extension. The user must explicitly authorize every live or cost-incurring step.

Prepare the profile and packet with:

```text
/fanout-plan --refresh-profile Read ../TASK.md and implement that feature request exactly.
```

The profile should use isolated direct-argv preparation, no shared paths, offline-capable readiness, deterministic XO candidate normalization, and full `npm test` final validation. A practical preparation command is `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund`; do not add lifecycle scripts or dependency changes.

Ordinary planning must derive the work from repository evidence and the task brief without a decomposition override. A clarification is acceptable only for a genuine unresolved product choice.

## Review gate

Reject a materially incorrect packet. The semantic repair boundaries should be equivalent to:

```text
runtime-and-behavioral-tests ──┐
types-and-type-tests ──────────┤
documentation ─────────────────┤
                               └──> final validation
```

Required properties:

- runtime implementation and behavioral AVA coverage remain one independently acceptable and repairable unit;
- public types and `tsd` coverage remain together;
- documentation is independently writable;
- baseline-context reads do not falsely serialize disjoint work;
- `.pipe()` exposes only the read-side Web Stream method;
- early spawn errors preserve the original subprocess failure;
- no synchronous API, dependency, configuration, or file outside `TASK.md`'s allowlist changes;
- final validation runs the complete `npm test` suite.

The exact upstream patch is not packet authority and must not be fetched or supplied to workers.

## Execution and evidence

Run `/fanout-execute --dry-run` first and confirm zero workers, provider calls, tokens, accepted transitions, or repository changes. The user may then explicitly authorize one live canary with `/fanout-execute`.

Do not schedule repetitions until the canary, independent repository checks, artifacts, and cleanup all pass. Stop on the first failure or any source, task, packet, profile, routing, concurrency, or platform change.

After execution, inspect the checkout without launching another full suite:

```bash
rtk git status --short
rtk git diff --name-only
rtk git diff --check
rtk git worktree list --porcelain
rtk ps -axo pid,etime,command
```

Require tree-bound controller final evidence showing status `passed`, the packet-focused commands followed by one successful profile `npm test`, and matching expected, validation-before, validation-after, accepted-repair when present, and final active-checkout trees. Confirm every final-repair `worker-validation-manifest.json` contains only packet-focused commands and no profile `npm test`. Run an external full suite only for an explicitly requested audit or missing, incomplete, or suspect controller evidence, and record that exception separately.

Inspect the authoritative Event v5 log, Projection v6, summary, attempt evidence, final validation, accepted tree, cleanup, provider/model/tier identities, tokens, cost, TTFT, tool time, and wall time. Preserve failed artifacts and classify the owning component before proposing changes. Older Event v4 / Projection v5 runs remain descriptive Legacy evidence.

## 2026-07-29 canary result

The canary ran directly in the primary clean checkout, as explicitly authorized, from Fanout commit `b1cc84d6513de1551b617b01ba947103498921fb`. Pi ran in retained tmux pane `%267` under `doubleword:fanout-canary`. The frozen planning artifacts were:

- plan SHA-256 `5fd92ec0e3527953cb45faad1b4aeeb682f3e733c3c00b983ec197fe2d703fba`, 17,842 bytes;
- details SHA-256 `38687d76f07cbecd165d95b3247ad46f5eff0ef2da008b105382241cfa7d462e`, 17,685 bytes;
- packet SHA-256 `ba69f67e86443a2735aa1a9654945a3ebec4acbfc337bbe72028b6b1b2131103`, 58,073 bytes;
- profile SHA-256 `50c9bec27ac95da0453bc11092e5a1b40830540175c10f82461fc72c7916acf1`, 1,701 bytes.

Dry run `2026-07-29T18-34-56-001Z-b5556ab8` passed with zero workers, attempts, tokens, accepted transitions, or repository changes. Live run `2026-07-29T18-35-56-724Z-06e1182a` then completed with Event v4 / Projection v5 evidence and passed final validation.

The immutable packet made four ordinary nodes concurrently ready with maximum concurrency two: joint runtime/AVA behavior, joint types/`tsd`, API documentation, and guide documentation. The three smaller nodes passed on their original attempts. The joint runtime node's original candidate timed out at the fixture's 240-second AVA limit; validation repair 1 still failed its focused program gate, and validation repair 2 passed. The initial integrated `npm test` then found three XO violations across the combined result. One project final-validation repair corrected the two affected test files, after which both ordered full `npm test` gates passed. No integration repair, reconciliation, exact-no-progress termination, budget exhaustion, serial-chain fusion, or attempt fallback occurred.

Worker-summary continuity held only across the immediate runtime validation-repair chain: repair 1 received the original summary and repair 2 received repair 1's summary. The project final-validation repair received no predecessor summary. Summaries remained absent from Attempt Outcome, Event, Projection, and recovery authority.

The final checkout changed exactly the 14 task-allowed paths and hashed to accepted tree `c3ad52480adfb65a9bda2b63f609b7133aaef7b7`. The ledger reported 16 cumulative file touches, +373/-30, because the final repair re-touched two test files. Independent `npm test` passed; an initial operator rerun inside the Codex sandbox was invalid because XO could not write its ignored cache, and the permission-correct rerun passed. `git diff --check` passed. No current-run process, extra worktree, or execution lock remained.

The authoritative run duration was 1,240.055s, with 1,403,298 tokens, estimated cost `$1.8652415`, 420.670s summed worker time, and 3.972s summed tool time. The profiler admitted the current artifacts with exact profile identity and derived a 1,193.167s observed completion boundary, 231.712s overlap across ordinary node envelopes, a 596.734s final-validation span, 65.718s aggregate TTFT, and 316.537s aggregate generation time. Ordinary workers used the configured Terra medium realtime fallback because async Tier 2 was unavailable; validation repairs used Sol medium. There were no Tier 2 provider calls.

Post-canary inspection found that Phase B had not received the profile commands: `implementation-details.json` supplied `npm test` as packet-final validation while the exact approved profile already required `npm test`, and the effective initial and repaired final rounds therefore ran that full suite twice. The type node also used the repository-wide `npm run type` script rather than a focused invocation for its owned type tests. The 2026-07-30 protocol correction passes the exact profile into Phase B, asks for the narrowest meaningful node checks, reserves packet-final commands for additional task-specific integration, and rejects an exact profile-gate duplicate as a correctable draft while preserving normal resubmission. Existing canary metrics remain unchanged; any measured improvement requires a newly authorized clean run.

This is one canary, not a reliability cohort. No median, range, reliability rate, cross-task speed comparison, or universal SLO is reported. Repetitions require separate user authorization and byte-identical packet/profile/pointer bytes from a clean baseline.

## 2026-07-30 focused-validation canary stop

The rerun used Fanout commit `071a978d9f87c05dc4e1967ba2aff6f84fa14a22` directly in the restored primary Execa checkout. Dependencies were reinitialized; the user waived another redundant baseline `npm test` because the exact clean fixture had already passed setup validation. Pi ran in retained tmux pane `%270`; historical pane `%267` was closed after `%270` was alive. The existing approved profile remained byte-identical at SHA-256 `50c9bec27ac95da0453bc11092e5a1b40830540175c10f82461fc72c7916acf1`, 1,701 bytes.

Ordinary planning created a new lineage without a decomposition override. Plan SHA-256 was `c904919e0d0c2f0940de8caa38642106ae0807ca01d93029d55f9c87615c121c`, 15,430 bytes; details SHA-256 `814d606b8e8263d6417a14e8e631a609df3d55c0fb8841f46e7cf453aff54572`, 23,822 bytes; packet SHA-256 `402e13486f57c1f03a8fae4a1f5abd787722797cdb4cbd83ed3f64474262b53b`, 54,135 bytes. Dry run `2026-07-30T13-30-04-955Z-515240ac` passed with zero workers, tokens, accepted transitions, or mutations.

The new packet demonstrated the intended validation-scope correction: runtime used its focused three-file AVA command, types used focused `tsd --files` arguments, the combined docs node used one two-file XO command, packet-final validation contained only the additional task-specific `npx ava test/convert/web.js`, and the profile retained the sole project-wide `npm test`. The runtime/test, types/`tsd`, and documentation repair boundaries and all 14 unique write owners remained correct.

Live canary `2026-07-30T13-31-34-936Z-035a16ed` stopped on its first failure. The Terra runtime worker ignored its explicit seven-file canonical work contract and edited all 14 task files, including the separately owned type and documentation paths. Ownership enforcement rejected the complete runtime candidate as `unauthorized-change` before validation; it was not repaired or applied. The original types and docs attempts passed and were accepted. The primary checkout exactly matched their accepted tree `c401cf558d22387faf1756c133e7dab5f12382ee`; `git diff --check` passed. Final validation correctly did not run. No current-run process, extra worktree, or execution lock remained.

The focused type gate took 3.887s versus 9.376s for the prior `npm run type`, a 5.489s (58.5%) reduction. The combined docs gate took 1.897s versus 3.524s summed across the prior two docs gates, a 1.627s (46.2%) reduction. The run stopped before runtime, packet-final, or profile-final validation, so it provides no measured full-suite or end-to-end optimization comparison.

The failed run lasted 307.657s, used 999,692 tokens, and cost an estimated `$1.030657`. The profiler admitted the recorded prefix with exact profile identity: 245.026s observed boundary, 228.039s ordinary-node overlap, 47.785s aggregate TTFT, and 331.906s aggregate generation. This is stopped-run evidence, not a completed comparison or reliability statistic.

## 2026-07-30 unauthorized-change-recovery canary

The next canary ran Fanout commit `5ee0d8eee2fc6f1784dc794deda56c103ed3f11b` directly in the restored primary Execa checkout. The user waived another redundant baseline `npm test`; the exact baseline commit `6e9ed1185adca485097d299da263a38d74ee636b` and tree `475de97e8bce060242e1ce9025d10e7f763735bd` were clean before planning. Pi ran in retained tmux pane `%271`; historical pane `%270` was closed after `%271` was alive. Routing remained Sol medium for Tier 1/control, disabled async Tier 2, and Terra medium for the realtime worker fallback.

The approved profile remained byte-identical at SHA-256 `50c9bec27ac95da0453bc11092e5a1b40830540175c10f82461fc72c7916acf1`, 1,701 bytes. Ordinary planning created lineage `20260730-144225004-read-task-md-and-implement-that-feature-` without a decomposition override:

- plan SHA-256 `8034d66a2b8310f1b51a3581ed2bbc8b930db6213d5e0e3673b5f62ee063bad9`, 17,179 bytes;
- details SHA-256 `f87c6421c7ab85590bbae696bec5cc16995e5e74201c1ea475795f7c0f117bbc`, 23,375 bytes;
- packet SHA-256 `d020151817b4410922384f32772e7f1cf460ff7e90b8c76c29c21b9a2f704343`, 56,432 bytes;
- active-packet pointer SHA-256 `3940b5d66835460a28f9a5f747b74b20420fc9fc2396f64dc138da6bc9b397ec`.

The packet preserved three parallel repair boundaries: runtime plus AVA tests, types plus `tsd` tests, and documentation. Their union contained exactly the 14 allowed paths. Node validation remained focused; packet-wide validation was one XO invocation over the changed paths; the profile retained the sole full `npm test`. Dry run `2026-07-30T14-49-23-602Z-ddb21840` completed in 26.669s with zero attempts, tokens, accepted transitions, or mutations.

Live run `2026-07-30T14-50-17-829Z-86af4e51` completed with current Event v5 / Projection v6 evidence. The original types and docs candidates passed and applied. The original runtime candidate stayed within its seven-path authority but failed focused AVA validation; its immediate validation repair received the original worker summary, passed, and reconciled onto the advanced accepted ledger. Initial project final validation stopped at two XO findings in `test/convert/web.js`; one Sol final-validation repair corrected them. The repaired XO gate passed in 4.393s and the profile's single full `npm test` passed in 295.261s. Final validation preserved exact tree `b320d9829b6257000cf22845c932a0e594fae5e8`.

No original candidate made an unauthorized change, so the new bounded clean-retry route was not exercised: retry count remained zero. This run therefore validates compatibility of the new policy with the successful path, not recovery effectiveness. There was no fallback, integration repair, exact-no-progress termination, budget exhaustion, or fusion. Worker-summary continuity held for the immediate runtime validation repair; the project final-validation repair received no predecessor summary. Summaries remained outside Attempt Outcome, Event, Projection, and recovery authority.

The final checkout changed exactly the 14 task-allowed paths. The accepted ledger reported 15 cumulative file touches, +303/-6, because project final repair re-touched `test/convert/web.js`. `git diff --check` passed. The controller-owned full suite is the post-run test evidence; no redundant independent full-suite rerun was performed. Cleanup left no current-run worker process, extra worktree, or execution lock, and pane `%271` remains visible.

The authoritative run duration was 733.668s, with 989,440 tokens, estimated cost `$1.1097045`, 387.951s summed worker time, 2.187s summed tool time, and 8.407s cleanup. Aggregate Attempt Outcome turn timing was 64.381s TTFT and 302.938s generation. The profiler admitted the run as Current with exact profile identity, a 657.421s observed completion boundary, 214.021s overlap across ordinary node envelopes, and a 367.586s final-validation span. Profile validation passed with 2.308s isolated preparation, 0.283s readiness, and 20.039s normalization while preserving the baseline tree.

This is one separately planned canary, not a byte-identical repetition of either earlier Execa run. No median, range, reliability rate, recovery rate, or universal SLO is reported.

## 2026-07-30 normal Pi control

The normal control restored the same primary checkout to clean baseline commit `6e9ed1185adca485097d299da263a38d74ee636b` and tree `475de97e8bce060242e1ce9025d10e7f763735bd`. Dependencies were already initialized and the baseline suite had already passed, so setup was not repeated. Pi ran in retained tmux pane `%272` with `openai-codex/gpt-5.6-sol` medium and no Fanout extension loaded. The session was `019fb39b-b700-738e-b75b-3193a92357d4`; its immutable trace is:

```text
/Users/snehalyelmati/.pi/agent/sessions/--Users-snehalyelmati-Documents-execa-web-streams-repo--/2026-07-30T15-19-14-432Z_019fb39b-b700-738e-b75b-3193a92357d4.jsonl
```

The user prompt was recorded at `2026-07-30T15:19:48.212Z`. Normal Pi inspected the task and repository, proposed a plan, and paused for approval. Approval was recorded at `15:21:55.444Z`; the final response was produced at `15:31:40.284Z`. Prompt-to-final wall time was 712.072s, including the 127.232s approval interval; post-approval implementation time was 584.840s.

The single Sol session used 33 assistant turns, 106,514 input tokens, 15,185 output tokens, 1,806,848 cache-read tokens, 0 cache-write tokens, and 1,928,547 total tokens, costing `$1.891544`. Its 63 tool calls comprised 28 reads, 16 shell calls, 5 writes, and 14 edits. Four tool results were errors: two expected reads of not-yet-created files, one ambiguous documentation edit, and one focused AVA failure. Session-derived tool envelopes summed to 307.696s and occupied 272.220s of wall time, dominated by validation. The session format does not record a trustworthy TTFT/generation split, so neither is inferred.

Normal Pi corrected the focused AVA failure in-session. The focused three-file AVA run then passed 77 tests; a subsequent Web-conversion-only AVA run passed 14 tests; lint, `tsd`, and `tsc` passed; and the final full `npm test` passed 5,115 tests in 252.3s. `git diff --check` passed. Exactly the 14 allowed paths changed, with +322/-15, producing exact tree `ed7963c8f5e7304acfb9d5074f4190bcb7b2d7e9`. The captured patch SHA-256 was `d83ae22cc2ad45e3d126794aab764d244c30e76401b35ad26a625983a0e40d5f`, 31,428 bytes. No worker, extra worktree, execution lock, or leaked Execa process existed.

### Observed comparison with the recovery-policy Fanout canary

The closest Fanout comparison is the immediately preceding recovery-policy canary because it used the same task, baseline, profile, routing policy, and day. Its end-to-end boundary from the first Phase A planning prompt at `14:42:25.007Z` through the terminal execution report at `15:02:31.518Z` was 1,206.511s. That boundary includes two-phase planning, dry-run, confirmation, and live execution. Normal Pi's prompt-to-final boundary includes its own planning and approval pause.

| Metric | Fanout | Normal Pi | Observation |
| --- | ---: | ---: | --- |
| End-to-end wall | 1,206.511s | 712.072s | Normal Pi was 494.439s / 41.0% shorter |
| Live/post-approval work boundary | 733.668s live run | 584.840s after approval | Normal Pi was 148.828s / 20.3% shorter; boundaries are similar but not identical |
| Total tokens including Fanout planning | 1,551,297 | 1,928,547 | Normal Pi recorded 377,250 / 24.3% more, mostly cache reads |
| Total cost including Fanout planning | `$2.6579225` | `$1.891544` | Normal Pi was `$0.7663785` / 28.8% cheaper |
| Model turns | 8 planning + 33 execution | 33 | Fanout used separate planning and worker/repair turns |
| Model tool calls | 51 planning + 129 execution | 63 | Controller validation commands are additional and not included in Fanout's model-tool count |
| Full-suite result | passed | 5,115 tests passed | Both passed their self-authored integrated suites |
| Allowed path count | 14 | 14 | Both respected the task allowlist |
| Exact final tree | `b320d9829b6257000cf22845c932a0e594fae5e8` | `ed7963c8f5e7304acfb9d5074f4190bcb7b2d7e9` | Implementations differ and are not byte-equivalent |

Fanout's separately reported live-only 989,440 tokens and `$1.1097045` cost omit its 561,857-token / `$1.548218` planning session and must not be compared directly with the normal Pi total. Conversely, Fanout supplies typed authority enforcement, rejected-candidate isolation, accepted-ledger replay, exact repair routing, isolated preparation, and profiler timing that normal Pi does not. Normal Pi avoided that control-plane overhead and self-corrected sequentially.

Both results pass their own tests, but there is no shared independently authored hidden acceptance suite in this fixture. The comparison therefore supports workflow, cost, scope, and recorded-validation observations; it does not establish that either implementation is semantically superior. One run per mode cannot support a reliability rate, variance estimate, median, range, or universal SLO.

## 2026-08-04 packet-v9 worker-validation canary stop

Live run `2026-08-04T15-47-51-375Z-6255f7df` used packet SHA-256 `6a76399830ad9e727a2be57f147a0410da7d091f6601518a415ff90ed5c7d6c9` with work contract v4 and the existing profile SHA-256 `50c9bec27ac95da0453bc11092e5a1b40830540175c10f82461fc72c7916acf1`. It started from the exact baseline commit/tree and exposed the six fixed file tools plus zero-argument, manifest-bound `fanout_validate`; controller validation remained authoritative.

The runtime original called advisory validation three times with failed → passed → passed results, then passed controller validation. The documentation original called it twice with failed → passed results, then passed controller validation. Both original candidates were accepted without node repair. The TypeScript original's immutable command was:

```text
npx tsd --files test-d/convert/{readable-stream,writable-stream,transform-stream}.test-d.ts --files test-d/pipe.test-d.ts
```

Fanout correctly launched that manifest as direct argv, so no shell brace expansion occurred. `tsd` received the brace expression literally and failed. The worker could not change packet authority; its one repair produced the same candidate and typed failure, correctly recording `fail/exact-no-progress` with the second attempt and leaving the other repair slot unused.

The recorded prefix contains four attempts: accepted runtime and documentation originals plus the TypeScript original and one repair. It ended after 327.517s with 825,187 tokens, estimated cost `$0.784550`, two accepted transitions covering nine cumulative file touches, one exact-no-progress termination, and no final validation. A node-executor routing bug continued after the terminal repair and caused `node typescript-web-stream-contracts completed without a causal attempt`; the run therefore recorded controller `internal-failure` and left that node pending even though the repair attempt's typed terminal outcome was already authoritative.

Completed historical run `2026-08-04T13-58-43-157Z-e46c2a14` used three repairs: two node repairs and one final repair. In the packet-v9 recorded prefix, repairs fell to one, repair fresh input fell from 163,536 to 32,346 tokens, and repair cost fell from `$1.329` to `$0.275`. This is encouraging advisory-validation evidence only. Because malformed validation authority stopped the latest run before final validation, it is not a completed performance, cost, quality, accepted-tree, reliability, or end-to-end comparison.

The stopped run exposed two independent defects. Planning encoded shell brace expansion in a direct-argv validation manifest instead of using a command valid without a shell. After the typed repair outcome reached exact no-progress, node execution also lost its causal failure and reported controller `internal-failure`. The subsequent fixes changed the TypeScript gate to `npm run type` and preserved the causal failed-node disposition. The stopped candidate remains preserved as `stash@{0}` at the time of the corrected run; the first historical canary remains `stash@{1}`.

## 2026-08-05 corrected packet-v9 worker-validation canary

The corrected canary froze clean Fanout commit `505c258b8d9f367796b4e3c2fe1afaf741dc1ef0` and reused the exact clean Execa baseline commit `6e9ed1185adca485097d299da263a38d74ee636b` / tree `475de97e8bce060242e1ce9025d10e7f763735bd`. Pi ran in retained pane `%301` under `doubleword:fanout-canary`, chat `019fd008-7188-7a24-a6a4-10182ecd99eb`. Routing was Sol medium for Tier 1/control, disabled async Tier 2, and Terra medium for the realtime worker fallback, with concurrency four. The existing profile remained SHA-256 `50c9bec27ac95da0453bc11092e5a1b40830540175c10f82461fc72c7916acf1`, 1,701 bytes.

Planning successfully read `../TASK.md` and created lineage `20260805-034813952-read-task-md-and-implement-that-feature-`. Its frozen identities were:

- task SHA-256 `e2f9d0145c3955ed94db6fc45f19fbe03ac43df3359679ed1c0d218ef88fb869`, 5,059 bytes;
- plan SHA-256 `e0b533379fdba8b4d14b00233d67ab14b672ef1dc57477c8bc18ab9aa6e34c5c`, 17,537 bytes;
- details SHA-256 `b72698e7b3eda9af6a556f981bbb1da59f968f56e6ffa97069144044a084aca6`, 27,292 bytes;
- packet SHA-256 `974cb3b9eb0a48e3c1cbc8dd2e6e0a3bbe90374e185a119c4e9a79d3f287596c`, 60,259 bytes;
- active-packet pointer SHA-256 `f35a71ec10a7dad029151fdd1a526ef0521e43750e221aedb51eef275e856725`, 322 bytes.

Packet v9 / work-contract v4 made four original nodes concurrently ready: runtime plus AVA tests, types plus `tsd` tests, API documentation, and stream-guide documentation. Their union granted write authority to exactly the 14 `TASK.md` paths. Each implementation worker received manifest-bound `fanout_validate`; the TypeScript node used the corrected `npm run type` command. Packet-final validation was focused XO over the 14 paths, while the isolated profile retained the sole full `npm test` gate.

Dry run `2026-08-05T03-54-28-976Z-706202bb` completed in 25.836s with exactly three lifecycle events and zero workers, attempts, model calls, tokens, accepted transitions, cost, or repository mutations. Live run `2026-08-05T03-55-29-413Z-80959fd6` then completed in 998.923s and passed final validation.

All four original workers were allocated within 1.410s. Types, API documentation, and runtime reconciled deterministically onto the advancing accepted ledger; stream-guide documentation applied ordinarily. There were five attempts total: four original Terra attempts and one Sol final-validation repair. All five were accepted, with no node retry, fallback, node validation repair, integration repair, exact-no-progress termination, budget exhaustion, or internal failure. All five worker results contained the complete required five-section summary and reported no incomplete work or blockers.

Workers called `fanout_validate` ten times, producing eleven command executions: five advisory failures followed by five passing calls, with the final repair's one call running both immutable final commands. The runtime original accounted for all five failures before its passing sixth call; types and both documentation workers passed their advisory gates. Initial integrated XO found only three style violations in `test/convert/web.js` and `test/pipe/methods.js`. The bounded final-validation repair corrected those two files, invoked `fanout_validate`, and passed focused XO plus full `npm test` in 300.326s. The controller independently reran the same final gates and passed in 300.091s.

The final checkout changed exactly the 14 authorized paths and produced tree `375b89e307bb59cd121cb5b8eb5abc8c6aa08a5c`. The accepted ledger recorded 16 cumulative file touches because the final repair re-touched two test files. Independent `rtk npm test` passed lint, 5,109 AVA tests, `tsd`, and `tsc`; `git diff --check` passed. Inspection found one Execa worktree, no execution lock, and no current-run worker or test process. Pane `%301` remains alive for inspection.

The run used 1,376,170 tokens: 244,708 input, 19,398 output, and 1,112,064 cache-read tokens, with estimated cost `$1.1057552`. Summed worker duration was 812.975s, tool duration 338.335s, and cleanup 10.440s. TTFT ranged from 3.739s to 4.994s with a 4.505s median. Original-worker generation summed to 481.377s; their maximum concurrent envelope was 186.175s, yielding 295.202s observed overlap savings. Poll time was zero.

This corrected run demonstrates successful worker advisory validation, controller-authoritative reruns, four-way launch concurrency, deterministic reconciliation, and bounded final repair on one packet. It did not re-exercise the exact-no-progress causal-failure branch fixed after the stopped run, and it is not a byte-identical repetition of earlier Execa packets. No median, range, repair rate, reliability rate, or universal SLO is inferred.

## 2026-08-05 five-repetition cohort

The user authorized five additional live executions with the corrected packet, profile, routing, concurrency four, Execa baseline, and platform held fixed. Fanout HEAD was `ebbbd7ecba4418fb58944558727b933f690c090d`, whose only difference from canary commit `505c258b8d9f367796b4e3c2fe1afaf741dc1ef0` was the benchmark documentation recording that canary; runtime and test source bytes were unchanged. The five repetitions therefore form a fixed repetition cohort, while the preceding canary remains separate because its Git commit identity differs.

| Repetition | Pane | Run | Attempts | Recovery | Wall | Tokens | Cost | Final tree |
| ---: | --- | --- | ---: | --- | ---: | ---: | ---: | --- |
| 1 | `%302` | `2026-08-05T05-18-55-482Z-7437e419` | 4 | none | 631.296s | 756,614 | `$0.5685264` | `7e28e0d2d8f68beff3968fbbe9b78ce91913b320` |
| 2 | `%303` | `2026-08-05T05-34-34-351Z-75851a2b` | 5 | one final repair | 964.733s | 782,874 | `$0.8108926` | `b45076d5d9f5aa3ee59aed3c6e333e182dc95a46` |
| 3 | `%304` | `2026-08-05T05-56-09-745Z-6193c2da` | 5 | one final repair | 1,011.988s | 1,207,320 | `$0.9649424` | `6b2d11d141eb05a735cad0c6ed8d80ce8361af95` |
| 4 | `%305` | `2026-08-05T06-19-29-749Z-e7c91c41` | 6 | one clean runtime retry and one final repair | 1,530.488s | 1,654,515 | `$1.1499204` | `af25d4af7d8ebdc521889d56cc47fcfc3bb0cab8` |
| 5 | `%306` | `2026-08-05T06-50-24-299Z-fc84a3bd` | 5 | one final repair | 995.074s | 1,143,064 | `$0.8866022` | `e3520fe195fba1f757ed036d95b3b8cf0af39408` |

All five runs completed and passed final validation. Their wall-time median was 995.074s with range 631.296–1,530.488s; token median was 1,143,064 with range 756,614–1,654,515; cost median was `$0.8866022` with range `$0.5685264`–`$1.1499204`. Summed live execution was 5,133.579s, 5,544,387 tokens, and `$4.380884`.

The cohort recorded 20 original attempts, one clean runtime retry, and four final-validation repairs. Repetition 4's runtime original exhausted its 602-second worker-process timeout after multiple advisory validations; the single clean retry succeeded. There were no model fallbacks, node validation repairs, integration repairs, exact-no-progress terminations, budget-exhausted terminations, internal failures, or manual code interventions. Fourteen deterministic reconciliations applied disjoint candidates onto advancing accepted ledgers.

Across the five runs, workers invoked `fanout_validate` 36 times, executing 40 immutable commands: 29 calls passed and seven failed before workers corrected their candidates in the same attempt. All 24 completed worker results contained the required five-section summary; the timed-out runtime original was the sole attempt without a complete summary. Per-run median TTFT ranged from 1.559s to 2.002s. Summed generation time per run had median 632.676s and range 282.248–948.849s. Original-worker overlap savings had median 200.798s and range 189.887–254.861s; poll time remained zero throughout.

Each run changed exactly the 14 authorized paths, passed `git diff --check`, and passed an independent full `npm test` after controller validation; the independent AVA counts were 5,109, 5,108, 5,109, 5,110, and 5,109. Each completed with one Execa worktree and no execution lock, worker, or test-process leak. Repetitions 1–4 and the corrected canary were preserved as named Git stashes; repetition 5 remains in the primary checkout and pane `%306` for inspection. Panes `%301`–`%304` also remain visible; repetitions 4–5 used windows `fanout-canary-4` and `fanout-canary-5` after the original window reached its pane-layout limit. Obsolete failed pane `%297` was closed.

This fixed five-run cohort supports a 5/5 completed-run observation for this packet and environment. It does not exercise the corrected exact-no-progress causal-failure branch, establish behavior under source/profile/packet changes, or support a universal SLO.

## 2026-08-06 controller-only profile-gate repair canary

The canary froze clean Fanout commit `38f3a6def02e9c1d7a0684945b697cf99bb81aa5` and the exact Execa baseline commit/tree. Pi ran in pane `%313` under `doubleword:fanout-canary`, chat `019fd564-06ae-7063-bcf2-ff4c05a0c9aa`, with Sol medium control, disabled async Tier 2, Terra medium fallback, and concurrency four. One initial refreshed-profile draft was declined before packet planning; accepted lineage `20260806-044806056-read-task-md-and-implement-that-feature-` then used profile SHA-256 `827f12000575bb827aa8d7f9dfef42a979a55cdd96c19e5f340fa186caf4620f`, 1,779 bytes.

Planning read `../TASK.md` and froze plan SHA-256 `e50bc2c004ae4892c95b18c0a585a78ffaf6f9d86a4bac5b7dd45e2e929834ef`, 16,892 bytes; details SHA-256 `dd1474d640c53fb2388218d98725673766668bda435ee7d48749e82e6447dd65`, 27,260 bytes; packet SHA-256 `8e3ac9dfd23c7069a95fec7d195425867f2ff9a0799c0f3ed21c412792fdd312`, 57,283 bytes; and active-pointer SHA-256 `c308d3450888e36a78845ad1f4e4b365d22ec90a56e430f36720c86e98e4b09d`, 322 bytes. Packet v9/work-contract v4 kept runtime plus AVA, types plus `tsd`, and documentation as three parallel repair boundaries whose union contained exactly the 14 allowed paths. The user-waived broad type check remained `npm run type`; packet-final validation was focused AVA, and the profile owned the sole full `npm test`.

Dry run `2026-08-06T04-55-29-838Z-ce7aac86` completed in 25.564s with three lifecycle events and zero workers, attempts, tokens, cost, accepted transitions, or mutations. Live run `2026-08-06T04-56-25-545Z-2e64b74c` then completed in 641.878s and passed controller final validation. All three Terra originals passed and were accepted; types and documentation reconciled deterministically. Initial focused AVA passed, while profile `npm test` stopped on two XO findings in `test/convert/web.js`.

One Sol final-validation repair fixed that file. Its `worker-validation-manifest.json` contained only the packet-focused AVA command and excluded profile `npm test`, while its recovery context retained both authoritative command results. The worker's focused advisory call passed; the controller then ran focused AVA in 4.270s and the sole repaired full `npm test` in 292.845s, both passing. This directly exercises the controller-only profile-gate routing introduced by `38f3a6d`.

The four accepted attempts used 841,523 tokens and `$0.6997986`; worker/tool/poll time was 335.292s/54.604s/0. Across 30 turns, TTFT was 1.158s minimum, 1.535s median, and 3.288s maximum; generation summed to 267.461s, and original-attempt overlap saved 253.517s. Workers made six advisory validation calls executing ten commands: four calls passed and two failed before in-attempt correction. Every result contained the complete five-section summary, with no incomplete work or blockers.

The final checkout changed exactly the 14 authorized paths and matched accepted tree `5f465919dc8ed42effcc47f0c866214d3e7d552e`; the ledger's 15 cumulative touches reflect the repair re-touching one file. `git diff --check` passed. Tree-bound controller evidence replaced a redundant external full-suite rerun. Cleanup left one Execa worktree, no current-run process or execution lock, and pane `%313` alive for inspection.

This is one separately planned canary, not a member of the prior fixed repetition cohort. It validates the exercised final-repair routing path but does not support a new median, range, reliability rate, or universal SLO.

## 2026-08-06 Doubleword routing-matrix stop

The requested nine-run routing matrix stopped on pair 1 repetition 1, as required by the first-failure protocol. Execa first established clean local baseline commit `33e0ba6175e03cc85cbdee982f878cbd6670af4d` / tree `dc79b511fdf12392c97c12ff97e1f13af126da78`; `.gitignore` now excludes the credential-bearing `.envrc` and provider-created `runs/`. Pi launched through `direnv exec` without removing `DOUBLEWORD_API_KEY` in pane `%318`, chat `019fd5ac-18f1-77da-b658-1fd6614c9b67`. Fanout remained at commit `38f3a6def02e9c1d7a0684945b697cf99bb81aa5` with the existing intentional benchmark-doc diff.

Routing was Tier 1 `doubleword/moonshotai/kimi-k3` medium, disabled async Tier 2, and realtime fallback `doubleword/deepseek-ai/DeepSeek-V4-Flash-0731` medium at concurrency four. Planning reused saved profile SHA-256 `827f12000575bb827aa8d7f9dfef42a979a55cdd96c19e5f340fa186caf4620f`, 1,779 bytes; it did not rebuild the profile. Lineage `20260806-060449596-read-task-md-and-implement-that-feature-` froze task SHA-256 `e4ec09eb0d57bb3af2c01dd1888e5ad85ddf3296127159c83a840bcd35eb153e`, 5,201 bytes; plan SHA-256 `7c1aa506cc19131b7f7158faa4b337de7105338e70f64573662a03c24346f185`, 19,820 bytes; details SHA-256 `1551ce9beeda6ac9660911228585935fd579c3779b72ec3791e3b72fb3f243fb`, 27,527 bytes; packet SHA-256 `d479b08c17f7682b06ea139ae3225a93a37ea8188d0c57cdb8e96c64e69da7b1`, 77,154 bytes; and active-pointer SHA-256 `76c551007e589b5ae7e59831a3ceb1e84cbf339432af1dc011938097beeeefa4`, 322 bytes. Packet v9 granted exactly the 14 `TASK.md` paths once each and froze the requested routing and baseline.

Dry run `2026-08-06T06-13-00-032Z-0ff9b4d4` completed in 27.954s with zero attempts, tokens, cost, accepted transitions, or mutations. Live run `2026-08-06T06-13-56-156Z-eb5bb1de` failed after 1,294.141s with four attempts: three originals and one clean retry. The runtime and documentation originals produced candidates but were rejected at the metrics boundary with `correlation-mismatch`: every Doubleword `provider_end` event lacked required `usageSource` and `pricingSource` provenance, so attempt identity correlation was incomplete. The runtime-test original and clean retry each reached the 602-second worker timeout. The dependent type node was skipped, no attempt was accepted, and final validation did not run.

Because the metrics contract rejected the completed provider calls, authoritative totals are zero tokens and zero cost rather than inferred usage. Cleanup took 7.443s and left the primary checkout clean at baseline, one Execa worktree, no accepted patch, and no execution lock or current-run worker process. Pane `%318` remains alive for inspection. The remaining two repetitions of pair 1 and all six runs for pairs 2–3 were not launched; this stopped run is provider/Fanout observability compatibility evidence, not a model-quality, cost, latency, or reliability comparison.

## 2026-08-27 repair-functionality canaries

Fanout was frozen at commit `dd0453493d7aa8e60beb0972376a436abb11f08e` with the existing intentional benchmark-doc diff. Execa was clean at commit `33e0ba6175e03cc85cbdee982f878cbd6670af4d` / tree `dc79b511fdf12392c97c12ff97e1f13af126da78`. The saved profile remained SHA-256 `827f12000575bb827aa8d7f9dfef42a979a55cdd96c19e5f340fa186caf4620f`, 1,779 bytes; neither canary rebuilt it.

The GPT canary ran in pane `%361`, chat `01a041df-38c8-733d-930e-2790e2501a36`, with Sol medium control, disabled async Tier 2, Terra medium fallback, and concurrency four. Lineage `20260827-062251303-read-task-md-and-implement-that-feature-` froze plan SHA-256 `1c8f35bffea7dc423e18fbc5e55f576ec3a72e7e5c3bff0872e5281bdfe81a0a`, 13,544 bytes; details SHA-256 `5cc410c0a97125cf744f3790e91d62e6ce9a87e485ddc8e2681b5c78a9ac8231`, 18,747 bytes; packet SHA-256 `a3e488e5c7fe65b9352184ff7e67bd01a7ebd622f5d6261e3399d2348fb81269`, 43,539 bytes; packet pointer SHA-256 `c25b6bd8e65ffa848e24a644e49ddf1b659c8501abcb52919e70c552d680328e`, 322 bytes; and profile pointer SHA-256 `acdb3ddeabbc8a9b6994fd6f5e3b387e3d4829a1a0da86a3c9a4a78b9b7e83ce`, 333 bytes. Packet v9 granted exactly the 14 task paths to one acceptance-coupled work node. Dry run `2026-08-27T06-27-19-458Z-1d9a75b7` used zero attempts, model calls, tokens, cost, accepted transitions, or mutations.

Live run `2026-08-27T06-28-14-294Z-7e838687` completed in 782.446s. The Terra original was accepted at tree `84fa68ea3b3e20c0b653f15e633b57fd57f25713`; initial final validation exposed three conversion failures. Sol validation repair 1 changed the candidate but its full suite still failed. Repair 2 was accepted and controller validation passed focused AVA plus profile `npm test` in 304.325s, with evidence SHA-256 `b3221092cef3c0bf82719ce79f91a520ad733ce3b44e8d02298319d0cb4d4213`, 522,448 bytes. Final tree `3206f83d61eebe9fe80342c2e0ba2d8a3321236c` changed exactly the 14 authorized paths; the aggregate 18 file touches include four repair re-touches. The three attempts used 746,254 tokens and `$0.877555`; worker/tool time was 274.349s/32.826s, and 19 turns recorded approximately 1–4s TTFT with 220s aggregate generation. The result is preserved as stash `fanout-canary-gpt-2026-08-27T06-28-14-294Z-7e838687`, after which Execa returned to the exact clean baseline.

The first Doubleword canary launched through `direnv exec` without removing `DOUBLEWORD_API_KEY` in fresh pane `%362`, chat `01a041f5-07a0-7b52-8d73-a5a71323ef1a`, with Kimi K3 medium control, disabled async Tier 2, DeepSeek V4 Flash 0731 medium fallback, and concurrency four. Planning read `../TASK.md` and accepted plan SHA-256 `036cd2abbb447318349a3c2e96310ab433a9d378ece5298f687ef112b4999512`, 18,134 bytes, under lineage `20260827-064520595-read-task-md-and-implement-that-feature-`. Implementation-details submission returned `items[1].changes[4].anchors[1].text: invalid-semantic-text: semantic text must be non-empty and contain no controls`, and Kimi began replacing the multiline anchor. The operator incorrectly interrupted this recoverable feedback loop. This is operator error, not a Fanout planning-recovery failure; no packet, dry-run, live execution, accepted patch, or Execa mutation followed.

A corrected fresh singleton used pane `%363`, chat `01a04209-01c3-7b9d-a99c-321c590c4eb6`, Kimi K3 high control, the same disabled async Tier 2 and DeepSeek medium fallback, concurrency four, and the unchanged saved profile. Planning read `../TASK.md`, received recoverable feedback that packet-global `forbiddenWrites` overlapped planned authority, removed the overlap, and successfully resubmitted. Lineage `20260827-070511437-read-task-md-and-implement-that-feature-` accepted plan SHA-256 `788bae9cb0a574999d794d7a891baed4aa67eb6f991c88dc04beed51e6e161f3`, 22,584 bytes, and details SHA-256 `f22197da6d856d68cb92e2262a7e16a6f9532523746e3af963af9af8fb30ebe7`, 35,156 bytes. Packet compilation then terminally rejected `read-not-authorized: file:package.json is not authorized by source runtime-web-streams (grounded[0].readDependencies[14])` and required a fresh `/fanout-plan`. Per the terminal-failure rule, no dry-run, live execution, or later repetitions ran. Execa remained clean at the exact baseline with one worktree; pane `%363` remains available for inspection.

## 2026-08-30 planning-parallelism prompt check

This check generated planning artifacts only; it did not run `/fanout-execute --dry-run` or `/fanout-execute`. All three fresh Pi sessions used GPT-5.6 Sol medium, the unchanged saved profile `827f12000575bb827aa8d7f9dfef42a979a55cdd96c19e5f340fa186caf4620f`, and the exact clean Execa baseline `33e0ba6175e03cc85cbdee982f878cbd6670af4d` / `dc79b511fdf12392c97c12ff97e1f13af126da78` with task SHA-256 `e4ec09eb0d57bb3af2c01dd1888e5ad85ddf3296127159c83a840bcd35eb153e`.

The before session in pane `%368`, chat `01a05172-ea3a-7ac6-8f15-2234f4fc83be`, used the regressed Phase A prompt and lineage `20260830-065444632-read-task-md-and-implement-that-feature-`. It produced one implementation item owning all 14 allowed paths, followed by final validation. Its plan/details/packet identities were `371ec6d5d8483ce84077dadf8b88b4d6feeb3ed46465e5532fcfa3967f01d040` / `e774ba3e9e574b2d90944af39f74632fca5e4bddbc186661ed26b8a5d5fc23e7` / `9f945cc7559defefa103842007c9c0a597924ce90481998a8c1ff92252c29409`, with 14,127 / 25,645 / 49,658 bytes. Pi displayed `$1.212` for the planning session.

The first replacement session in pane `%369`, chat `01a05176-8df3-72a7-ba57-0452f05d55ae`, used lineage `20260830-065843186-read-task-md-and-implement-that-feature-`. Phase A split five disjoint ownership units, but Phase B correctly exposed that early-error and pipe validation required the new core adapter; the resulting DAG placed core, types, and docs in the first group, then early-error and pipe, then final validation. This intermediate sample showed that a dependency edge was being used where those runtime resources shared repair authority. Its plan/details/packet identities were `d22c37c8d82dbf04744492fd5336e98385b4d1ecb0f6bd28f21d653ecf5827c2` / `ee23e6d9242f8db48d97db5444bc175a242a9c499745a047515af28dde6e1ccf` / `df8ca95bac2716e8156e898198888bbdb9da96212b0fd525b0489c0c1529a27a`, with 15,961 / 18,646 / 54,487 bytes. Pi displayed `$1.029`.

The final generic prompt added that focused validation which can reasonably require repairing another item's production code must merge those repair-coupled resources, and that an edge is not a substitute for shared repair authority. The fresh session in pane `%371`, chat `01a05186-40fb-7189-9d8a-ac2fc92d87d5`, used lineage `20260830-071552073-read-task-md-and-implement-that-feature-`. It produced exactly three disjoint implementation items: seven runtime/AVA paths, five type/`tsd` paths, and two documentation paths. All three were concurrently ready and fed only compiler-owned final validation. Plan/details/packet identities were `8cc3eb17783b4bd768ceb91727ba38a3c27def39c368f2b4c3fe631c147e15a2` / `c0e532a02dad4ddd08d0868eb813572b4ee453f4f63bb754c9ac191dff4d7b13` / `c9b423a330d7d32e113dbf420d3467cf56a6aaa368aaf40dc5001fcdfdc3bcb8`, with 16,455 / 26,117 / 56,386 bytes. Pi displayed `$1.284`.

The final prompt SHA-256 was `093e824a7ab5824fb1ba9e0843d7e9f38f3f263fdb548636e79cea264cf69faf`. The target checkout remained clean at the exact baseline after every session. This validates the decomposition process and removes the observed false serialization; it does not validate execution correctness, worker behavior, latency, or reliability. A full canary requires separate authorization.

## Reporting

Record Execa results in [`../BENCHMARKS.md`](../BENCHMARKS.md) only after observed artifacts and tree-bound controller validation evidence exist. Report correctness and reliability before speed or cost. Keep p-map and Execa cohorts separate; do not combine their medians, ranges, or success claims.

## Fresh-chat handoff

```text
Runbook: docs/benchmarks/execa-web-streams-manual-e2e.md
Task: /Users/snehalyelmati/Documents/execa-web-streams/TASK.md
Repo: /Users/snehalyelmati/Documents/execa-web-streams/repo
Baseline: 33e0ba6175e03cc85cbdee982f878cbd6670af4d
Mode: manual transfer/complexity E2E; one canary before any repetitions
Constraint: do not initiate live or cost-incurring calls without explicit authorization
```
