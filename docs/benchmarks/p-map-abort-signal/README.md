# p-map abort-signal benchmark

This directory is the current setup for the existing p-map abort-signal
benchmark. Its 2026-09-27 revision exposes the promised-source-value abort
regression to the runtime worker before acceptance. No planning/provider call,
canary, repetition, baseline suite, or p-map implementation edit was performed
to prepare the revision. Historical packets, candidates, evidence, and
`scripts/benchmarks/p-map-acceptance-v2.mjs` remain unchanged. The prior task is
preserved byte-for-byte at [history/TASK-before-2026-09-27.md](history/TASK-before-2026-09-27.md).

## Prepared inputs

- [TASK.md](TASK.md) is the current benchmark task. It includes the observed
  promised-source-value cancellation sequence and an explicit frozen worker gate.
- [validation-command.json](validation-command.json) is the exact direct-argv
  command to include first in the runtime worker's `validationCommands`.
- [prepared/execution-packet.json](prepared/execution-packet.json) is a concrete
  compiler-produced packet with that command already frozen in
  `runtime-and-behavioral-tests`, which owns `index.js` and `test.js` together.
- [prepared/provenance.json](prepared/provenance.json) records the historical
  source identities and current plan/details/packet/profile identities. The current
  [plan](prepared/implementation-plan.json) and
  [details](prepared/implementation-details.json) are preserved alongside it.

The prepared artifacts derive offline from the successful planning submission
`20260925-065423264-read-task-md-and-implement-that-feature-`. Its original files
were read only. The revised plan has the benchmark's current identity/objective
and regression requirement; details retain the original runtime AVA/XO checks
after the new check, with the runtime node renamed for clarity. Existing
type/documentation ownership, routing, concurrency, and final-profile gates are
retained. This is an offline derivation, not evidence that a new planning model
followed the task. The recorded artifact timestamp identifies revision
2026-09-27, not a live run time.

Baseline remains commit `c3c261e2189f94d1a09724e8f03d5345af518017`, tree
`8a2aeffb7e9e378c05dcb0cec8503b1fb530143f`. Reuse the existing clean fixture and
recorded baseline evidence; do not change its tree. The existing external
`<p-map-benchmark>/TASK.md` and adjacent `validation-command.json` have been
updated to match these current inputs; the pre-revision task remains in this
directory's `history/` snapshot.

The approved profile is copied byte-for-byte under `prepared/profiles/`:

- SHA-256: `2b0248d9a4f65fa271ad05eeb15ca67ed0ec158bfe36450e9a96ab39a072bb8a`;
- byte length: `1374`;
- preparation: `npm ci --ignore-scripts`; readiness: `npm ls --depth=0`;
- candidate normalization: **empty**, as in these exact approved profile bytes;
- required final gate: `npm test`.

The new check is task-specific and does not require rebuilding the profile.
Profile applicability must still be verified before any later execution if
environment/dependencies/platform change.

## Validation behavior

The standalone readable source is
[`p-map-promised-source-value-check.mjs`](../../../scripts/benchmarks/p-map-promised-source-value-check.mjs).
The JSON command embeds the same source on one line because validation argv
rejects control characters. It imports `index.js` from the current isolated
checkout; it does not invoke an external mutable test file or write to p-map.

A thenable signals exactly when its value is awaited. The check aborts then,
requires rejection with the exact reason before resolving that value, resolves
it, flushes pending continuations, and asserts zero mapper starts, one source
pull, one source close, and no yielded value. The two-second watchdog only
bounds hangs; ordering comes from promises, not sleeps. This focused check
covers the exposed sequence. Broader listener-cleanup coverage remains in the
unchanged external acceptance checker and the task's AVA requirements.

Existing Fanout mechanisms deliver the packet's command array into the worker's
immutable validation manifest. `fanout_validate` reports it to the worker;
authoritative node validation reruns it before acceptance. The inline bytes
survive into bounded repairs. No p-map knowledge was added to generic Fanout
core/prompts, and the checker does not prescribe the implementation fix.

From the Fanout checkout, run only the focused offline setup check:

```sh
node --disable-warning=ExperimentalWarning scripts/benchmarks/smoke-p-map-abort-signal.mjs
```

It verifies command/source equality, bound artifact SHA-256 and byte lengths,
recompiles the prepared plan/details to an identical packet, exercises the real
packet-verifier CLI (pass plus omitted-gate rejection), and executes the frozen
command through both `runWorkerValidation` and the authoritative validation
runner against synthetic broken and passing controls. It runs no p-map baseline
suite or provider calls.

## Future planning and review

No active packet pointer was published and no live execution is authorized by
this setup. For a separately authorized planning run, use the original clean
checkout and exact approved profile, and select the current benchmark task:

```text
/fanout-plan Read <absolute-fanout-source>/docs/benchmarks/p-map-abort-signal/TASK.md and its adjacent validation-command.json; implement that task exactly, preserving its frozen runtime-worker validation requirement.
```

Before accepting a future packet, check its frozen placement:

```sh
node --disable-warning=ExperimentalWarning scripts/benchmarks/verify-p-map-abort-signal-packet.mjs <new-execution-packet.json>
```

The verifier requires an executable packet on the fixed baseline/profile, one
runtime owner that also owns behavioral tests, and the exact command first in
that worker's contract. It rejects placement only in the final node or omission.
Also review the unchanged five-file authority and remaining task-specific
checks; use the standard pointer/profile identity checks and dry-run gate before
any user-authorized execution. The prepared packet can be reviewed offline now;
it is not silently installed into Pi-owned active storage.

Preserve `npm test` and external acceptance v2 after future execution. Record
results as revision 2026-09-27 of the existing benchmark: the promised-source-value
case is now known to workers, so do not compare it as unchanged held-out
correctness. Freeze the revised packet and task identities before repetitions;
no historical metric is recomputed.
