# Execa Web Streams manual Fanout E2E

Status: the first controlled canary completed on 2026-07-29; the focused-validation canary stopped on its first worker-scope failure on 2026-07-30; the bounded unauthorized-change-recovery canary then completed on 2026-07-30 without exercising that recovery route; a normal Pi control completed from the same baseline; the first packet-v9 worker-validation canary stopped on malformed direct-argv TypeScript validation authority on 2026-08-04; the corrected packet-v9 canary completed on 2026-08-05; and five subsequent repetitions completed on 2026-08-05.

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
| Reproducible local baseline | `6e9ed1185adca485097d299da263a38d74ee636b` |
| Local baseline tree | `475de97e8bce060242e1ce9025d10e7f763735bd` |
| Baseline difference | committed `package-lock.json` only |
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

## Reporting

Record Execa results in [`../BENCHMARKS.md`](../BENCHMARKS.md) only after observed artifacts and tree-bound controller validation evidence exist. Report correctness and reliability before speed or cost. Keep p-map and Execa cohorts separate; do not combine their medians, ranges, or success claims.

## Fresh-chat handoff

```text
Runbook: docs/benchmarks/execa-web-streams-manual-e2e.md
Task: /Users/snehalyelmati/Documents/execa-web-streams/TASK.md
Repo: /Users/snehalyelmati/Documents/execa-web-streams/repo
Baseline: 6e9ed1185adca485097d299da263a38d74ee636b
Mode: manual transfer/complexity E2E; one canary before any repetitions
Constraint: do not initiate live or cost-incurring calls without explicit authorization
```
