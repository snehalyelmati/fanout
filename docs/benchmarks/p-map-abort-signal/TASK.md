# Feature request: abortable `pMapIterable`

## Baseline

- Repository: `https://github.com/sindresorhus/p-map.git`
- License: MIT
- Upstream commit: `3ada5f36632aca8df860c376856270b6d2ba2de8` (`7.0.5`)
- Local reproducible baseline: `c3c261e2189f94d1a09724e8f03d5345af518017`
- Runtime used to establish the baseline: Node `v26.4.0`, npm `11.17.0`
- Install: `npm ci --ignore-scripts`
- Baseline validation: `npm test` (`xo && ava && tsd`), 51 tests passed
- Dependency note: npm reports six high-severity findings in transitive development tooling. Do not run `npm audit fix` or update dependencies during the benchmark.

The local baseline differs from upstream only by a committed `package-lock.json`, added so every benchmark run installs the same dependency graph.

## Problem

Add `AbortSignal` support to `pMapIterable`, matching the existing `pMap` option where applicable.

Consumers currently cannot promptly stop a pending `pMapIterable` operation,
prevent additional source work, or close the source iterator through the same
abort mechanism supported by `pMap`.

### Required behavior

1. Add optional `signal?: AbortSignal` to `IterableOptions` and document it for `pMapIterable`.
2. If the signal is already aborted, the iterable's first `next()` must reject with the exact `signal.reason` before pulling from the source or starting a mapper.
3. If the signal aborts during iteration:
   - reject the pending consumer operation promptly with the exact `signal.reason`;
   - stop pulling new source items;
   - stop starting new mapper calls;
   - do not yield mapper results after the abort is observed.
4. Already-running mapper calls may settle in the background, but their results must not be yielded after abort.
5. Best-effort close the source iterator through `return()` when it exists.
6. Remove the abort listener on normal completion, source failure, mapper failure, abort, or early consumer exit.
7. Preserve existing ordering, concurrency, backpressure, skip, and error behavior when no signal is supplied.
8. Do not change the existing `pMap` abort contract and do not add dependencies.

### Test requirements

Add deterministic AVA coverage using deferred promises and counters rather than timing-sensitive sleeps:

- already-aborted signal;
- mid-iteration abort with the original reason object;
- no additional source pulls or mapper starts after abort;
- no values yielded after abort;
- source iterator cleanup;
- unchanged normal concurrency/backpressure behavior.

Add a `tsd` assertion that `pMapIterable` accepts `signal` and retains its inferred output type.

The runtime implementation and its behavioral regression tests must pass
together; neither is an acceptable partial result without the other.

## Documentation

Update the existing `signal` documentation so its applicability and
`pMapIterable` abort behavior are clear.

## Constraints

- Do not change the existing `pMap` abort contract.
- Do not add or update dependencies or configuration.
- Do not use timing-sensitive sleeps in new tests.
- Only `index.js`, `index.d.ts`, `index.test-d.ts`, `test.js`, and `readme.md`
  may change.

## Acceptance criteria

- All required abort semantics are covered without flaky wall-clock assertions.
- The runtime implementation and deterministic behavioral regression tests pass
  together.
- `npm test` passes from the integrated active worktree.
- No files outside `index.js`, `index.d.ts`, `index.test-d.ts`, `test.js`, and `readme.md` change.
- No dependency or configuration files change.
- The execution summary contains complete worker metrics and authoritative final-validation results.


## Promised source value regression

The 2026-09-27 revision of this benchmark exposes a regression previously
checked only by external acceptance. Preserve the pre-revision task and all
historical packets and evidence; do not reinterpret earlier results.

A source iterator can return `{done: false, value: thenable}` before that value
resolves. If cancellation occurs while the value is awaited, the pending consumer
must reject promptly with the exact reason before the value resolves. Resolving
the value afterward must start zero mapper calls, cause no new source pulls,
yield no result, and leave the source closed once. Add deterministic AVA coverage
of this sequence alongside the runtime implementation.

### Frozen worker validation requirement

Read the adjacent `validation-command.json`. Include its exact command object as
the FIRST entry of `validationCommands` for the worker that owns BOTH `index.js`
and `test.js` (`runtime-and-behavioral-tests`, including an equivalent fused
node). Retain the task-specific XO/AVA checks after it. The command's inline
source is deliberate: its bytes become part of the immutable packet and execute
from each isolated worker checkout without an external mutable checker path.
Do not rewrite, omit, or substitute this command with a worker-authored test.

Keep this requirement in the accepted plan, details and compiled runtime work
contract. It is a worker gate, not merely a final-validation command. Both
`fanout_validate` and authoritative node validation must run it before acceptance.
The worker must diagnose any failure and implement the feature within its existing
write authority. Do not expand writable files to include benchmark checkers.

Reuse the approved repository execution profile unchanged when applicable;
this task-specific check belongs to the packet, not a per-run profile rebuild. Retain
its required final `npm test` gate and the independent external acceptance check.
Fanout already enforces changed-path ownership; no Git status/path parser is
needed in this packet's validation commands.
