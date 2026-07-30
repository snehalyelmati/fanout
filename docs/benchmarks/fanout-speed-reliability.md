# Fanout speed and reliability investigation

Status: approved prerequisite and Points 1–4 implemented; controlled Point 5 attempted but release gate not met

Date: 2026-07-27

## Purpose

Capture evidence, aligned decisions, approved implementation requirements,
and controlled validation for improving Fanout speed and reliability.

The prerequisite and Points 1–5 are the approved design baseline. Implemented
decisions are synchronized with:

- `docs/DESIGN_DECISIONS.md`
- `docs/ROADMAP.md`
- `docs/BENCHMARKS.md`

## Objective

Reduce Fanout latency, cost, and avoidable failures without weakening:

- exact packet and repository identity;
- typed ownership;
- accepted-ledger integrity;
- fresh-worktree validation;
- bounded model recovery;
- reproducible execution evidence.

The p-map runs are evidence, not the product design target. Solutions must
remain repository- and ecosystem-independent.

## Investigation areas

| Point | Area | Status |
| --- | --- | --- |
| P0 | Final-repair candidate continuity | Aligned prerequisite |
| 1 | Deterministic project execution environment | Aligned |
| 2 | Deterministic integration of disjoint work | Aligned |
| 3 | Repeated identical failure cutoff | Aligned |
| 4 | Vertical serial-chain fusion | Aligned |
| 5 | Controlled measurement and validation | Aligned |

## Prerequisite correctness issue: final-repair candidate continuity

Status: aligned existing decision; implementation gap.

This is a prerequisite correctness fix, not a sixth optimization.

### Evidence

In the July 19 run, final validation started from accepted tree
`aa36794cb464c2d977329b3df92951ec0912da33` and reported approximately 20 XO
errors.

The first final-validation repair produced result tree
`c92f7bc6fbf13524e13bcb5caec27b42f70798d3`. Its patch changed `test.js` by 39
insertions and 7 deletions, and the next final-validation round reduced the
failure to one XO error.

The second repair's recovery prompt and evidence identified that rejected
candidate, but its worker worktree did not contain the candidate bytes. Its
captured patch changed `test.js` by only two insertions, omitting the first
repair's changes, and final validation regressed to approximately 20 errors.

The candidate patch base alone is not evidence of this bug. Because the first
repair was rejected, both repair candidates correctly remain transitions from
the same accepted tree:

```text
repair 1: accepted A → rejected B
repair 2: accepted A → candidate C
```

The evidence of lost continuity is that repair 2's disposable worktree did not
begin at B and its recaptured A → C patch did not contain repair 1's changes.

### Root cause

The final-validation controller preserves the rejected candidate identity in
recovery evidence and prompt context, but the next final-repair worker is
launched without that candidate as its seed.

Ordinary validation repair already follows the required pattern: reconstruct
the accepted ledger, overlay the exact rejected candidate in the next
disposable repair worktree, and recapture the repaired candidate relative to
the accepted tree. Final-validation repair does not currently reuse that
path.

### Existing decision to enforce

ADR 0003 already permits a rejected candidate to seed only the immediately
following validation-repair worktree without becoming accepted authority.
Final-validation repair must enforce the same rule:

1. Reconstruct the exact accepted ledger state A.
2. Verify and overlay the immediately prior rejected candidate A → B.
3. Verify that the next repair worktree's pre-worker Git-visible tree is B.
4. Launch the next repair against B.
5. Normalize and recapture the complete cumulative candidate as A → C.
6. Apply C only if authoritative final validation passes.

B must never enter the accepted ledger, active checkout, or final success
evidence independently.

If an intervening repair process fails before producing a candidate, a later
permitted repair continues from the most recent exact rejected candidate. If
the seed artifact cannot be verified or overlaid exactly, fail closed with a
typed identity/controller failure before allocating another model.

### Interaction with exact no progress

The Point 3 guard compares cumulative candidate states after continuity has
been reconstructed:

- B followed by a distinct C is progress and may continue under budget.
- B followed by B with the same exact failure is `exact-no-progress`.

Prompt references or model claims never establish continuity or progress.

### Evidence requirements

Bind each successor final-repair attempt to:

- the prior rejected candidate transition and artifact identity;
- the accepted ledger tree used for reconstruction;
- the seed result tree verified before worker launch;
- the cumulative candidate captured after the worker;
- the source attempt or final-validation evidence.

Existing attempt and reconstruction evidence should be extended only where
these facts are not already recorded. No second merge mechanism is needed.

### Prerequisite acceptance criteria

1. A focused test makes repair 2 succeed only when repair 1's bytes are present.
2. Repair 2's pre-worker tree equals repair 1's rejected result tree.
3. Repair 2 is recaptured as a complete accepted-tree → cumulative-result
   transition containing both repairs.
4. Repair 1 never enters the accepted ledger or active checkout independently.
5. Only the exact passing cumulative candidate is applied.
6. A missing, corrupt, or inapplicable seed fails before model allocation.
7. A process-only failure does not discard the latest rejected candidate.
8. Exact-no-progress operates on the reconstructed cumulative state.

### Decision impact

- **Decisions followed:** ADR 0003's immediate repair-seed exception, exact
  accepted-ledger authority, and fresh reconstruction.
- **Proposed changes to prior decisions:** none.
- **Deferred or skipped:** generalized rejected-candidate branching, merging,
  or persistence beyond the immediately following repair chain.

## 1. Deterministic project execution environment

### Evidence

The July 20 Event-v3 run failed after detached worktrees could not use required
repository dependencies:

- `tsd` validation could not resolve its package.
- Runtime validation could not reliably run required AVA tooling.
- The packet also omitted the repository's deterministic XO normalizer.
- Runtime and types consumed repeated model attempts against environment
  failures.
- At least 116.9 seconds and approximately $0.431 were avoidable.

Earlier p-map canaries also spent model-repair budget on deterministic XO
formatting. Reconstructing one failed result, running the repository fixer, and
then running the suite passed all 55 tests.

The current preflight verifies the launcher executable—for example, `npx`—but
that does not prove that the package invoked through it exists inside the
actual worker environment.

### Root cause

Stable project-wide execution requirements are rediscovered by each planning
LLM call.

Once present, commands execute deterministically. The nondeterminism lies in
whether planning remembers to include requirements such as:

- environment setup;
- dependency readiness checks;
- candidate formatting;
- standard repository quality gates.

Infrastructure failures are then misclassified as candidate failures and
consume model recovery budgets.

### Aligned decision: Project Execution Profile

Add a versioned, user-approved **Project Execution Profile** that is independent
of execution packets.

It contains stable project-wide policy for:

1. isolated worktree preparation;
2. environment readiness checks;
3. candidate normalization;
4. required final quality gates.

Task-specific scope, ownership, DAG structure, and validation remain in the
execution packet.

### Authority boundaries

```text
Project Execution Profile       Execution Packet
-------------------------       ----------------
worktree setup                  objective and scope
environment checks              ownership
candidate normalization         dependencies and DAG
required quality gates          task-specific validation
               \                /
                Resolved Execution Run
```

The controller combines the exact approved profile and packet at execution
time.

The profile must never control:

- task scope;
- file ownership;
- dependencies;
- DAG structure;
- model routing;
- repair budgets.

If a proposed profile change requires any of these, it belongs in planning and
may require a new packet.

### Packet independence

Profile changes do not mutate, invalidate, or recompile otherwise valid
packets.

At execution time, Fanout records:

- exact packet identity;
- exact profile identity and version;
- effective commands;
- profile validation evidence.

This preserves reproducibility without copying project-wide policy into every
packet.

Historical profile versions must remain identifiable so a run can be audited
against the exact policy it used.

### Planning behavior

The planning LLM receives the exact current approved profile and identity as explicit context:

```text
Already guaranteed by the Project Execution Profile:
- isolated worktree setup: …
- candidate normalization: …
- required final quality gates: …

Do not repeat these commands.
Add only focused node checks and task-specific integrated packet-final checks.
```

An ordinary node uses the narrowest meaningful checks covering its owned changes; shared infrastructure, configuration, build, test-harness, and similarly wide-impact work may require broader checks. Project-wide suites remain profile final gates and run once during effective final validation. If a submitted node or packet-final command is exactly identical to a profile final gate, core artifact admission rejects only that Phase B draft, identifies both locations, and tells the planner to remove it or replace it with a focused check. The Pi controller publishes no artifact and the model may resubmit in the same planning session. Fanout does not silently deduplicate because doing so could remove a node's only meaningful validation and would mutate submitted authority.

Planning records which profile version it saw, but the profile remains
separate from packet authority.

### First-use lifecycle

During the first `/fanout-plan` without a profile:

1. Inspect repository manifests, lockfiles, scripts, CI, and instructions.
2. Propose phase-specific direct-argv commands.
3. Show their purpose, expected mutations, network access, and lifecycle-script
   authority.
4. Obtain explicit user approval.
5. Validate the proposed profile in a disposable worktree.
6. Persist it only after successful validation.
7. Provide it as context to the planning LLM.

Profile updates follow the same approval and validation process.

Fanout must never silently modify the profile after a failure.

### Profile validation

Validation should establish that:

- command declarations are structurally valid direct argv;
- isolated setup succeeds in a disposable worktree;
- setup does not change tracked files, `HEAD`, or the Git-visible base tree;
- readiness checks pass inside the prepared worktree;
- candidate normalizers are available and executable;
- normalizing the clean baseline does not produce unexpected tracked changes;
- required final gates are launchable.

A final semantic gate may legitimately fail on the baseline when the task is
to fix that failure. Therefore profile validation should distinguish
environment readiness from task correctness rather than universally requiring
baseline tests to pass.

Validation evidence should record:

- repository tree and platform;
- profile identity;
- commands and outcomes;
- timings;
- before/after Git identities;
- failure classification.

The profile is revalidated before every execution.

### Isolated setup

Each fresh worker, repair, and final-validation worktree receives an
independent environment created by approved setup commands.

Examples are repository-specific:

```text
npm ci
pnpm install --frozen-lockfile
uv sync
bundle install
```

Fanout remains ecosystem-independent and only executes approved direct argv.

Setup may create ignored or untracked environment state, but any tracked-tree
or `HEAD` mutation fails closed as a controller error.

### Failure classification

Preparation or preflight failure must:

- occur before the corresponding paid model call;
- be classified as an environment/controller failure;
- consume no model retry or repair budget;
- preserve exact evidence;
- stop with actionable diagnostics.

An LLM must never be asked to repair unavailable dependencies or broken setup.

### Candidate normalization

Project-wide normalizers are approved once but run after every candidate edit:

```text
worker or repair edit
→ project normalization
→ patch capture
→ ownership checks
→ task-specific validation
```

Normalization remains subject to packet ownership and repository-identity
checks.

A normalizer cannot expand a worker's write authority.

### Required final quality gates

Stable repository-wide gates belong in the profile, for example:

```text
npm test
tsc --noEmit
lint without fixes
```

Task-specific commands remain in the packet. The packet can add checks but
cannot remove profile gates.

### Isolation decision

**Default:** independently prepare each worktree.

Shared symlinks are not the generic default because shared ignored state may
be mutated by:

- package managers;
- package launchers;
- lifecycle scripts;
- native rebuilds;
- compiler caches;
- validation tools.

Cross-worker mutation could affect sibling workers, final validation, or the
active checkout.

### Deferred optimizations

Ignore until isolated setup is measured and proven too slow:

- copying a prepared environment;
- filesystem copy-on-write cloning;
- shared symlinks;
- environment caches owned by Fanout.

Package managers may continue using their native global caches.

### Observability requirements

Record separately:

- profile validation time;
- per-worktree setup time;
- readiness-check time;
- normalization time;
- required final-gate time;
- cleanup time;
- environment failure category.

These measurements determine whether setup optimization is needed later.

### Changes to existing decisions

#### Worktree preparation

**Existing decision:** explicitly selected ignored paths are linked into every
disposable worktree; reinstalling dependencies is avoided.

**Proposed replacement:** isolated, profile-declared per-worktree preparation
is the default. Shared paths are deferred as an optional future optimization.

#### Candidate normalization

**Existing decision:** every generated implementation-details artifact owns
the project-wide candidate-normalization list.

**Proposed replacement:** the Project Execution Profile owns project-wide
normalization. Packets retain only task-specific execution authority.

#### Execution evidence

**Existing decision:** run-started evidence binds packet, repository, platform,
worker, and command facts.

**Required extension:** bind the exact Project Execution Profile and resolved
effective command policy to each execution run.

### Point 1 acceptance criteria

1. A planning LLM cannot omit approved project normalizers or final gates.
2. Missing dependencies fail before any model request.
3. Environment failures consume zero repair attempts.
4. Setup cannot alter tracked repository state.
5. Worktree environments are isolated from each other and the active checkout.
6. Normalization runs for original and repair candidates.
7. Existing packets remain usable after orthogonal profile updates.
8. Every run records exact packet and profile identities.
9. Profile changes require approval and validation.
10. Preparation overhead is measured before optimization.

## 2. Deterministic integration of disjoint work

Status: aligned.

### Evidence and current behavior

When concurrent workers begin from accepted tree `A`, each candidate is bound
to that exact base:

```text
Worker X: A → X
Worker Y: A → Y
```

If X is accepted first, the active and accepted-ledger tree becomes X. Y still
describes transition A → Y, so the strict publication gate rejects it before
considering whether the changed files overlap:

```text
expected base A, found X
→ check-conflict
→ Tier-1 integration-repair model
```

This rejection correctly protects exact transition identity: applying Y's
bytes to X cannot retain Y's old result-tree claim. However, it conflates a
stale but compatible candidate with a genuine integration conflict.

The successful p-map run spent approximately 144.853 seconds on an integration
repair even though the concurrent changes were path-disjoint.

Fanout already has the required low-level capability in its repair-seed
overlay path. Existing checks prove that verified candidate bytes can be
overlaid on a later accepted reconstruction, disjoint accepted content is
preserved, conflicting content is rejected, and a new patch can be recaptured
relative to the latest accepted tree.

### Aligned decision: deterministic stale-candidate reconciliation

Before allocating an integration-repair model, Fanout may deterministically
reconcile a stale candidate when all exact safety gates pass.

The resulting authority is a newly captured transition:

```text
Original candidate: A → Y
Accepted sibling:   A → X
Reconciled result:  X → XY
```

The old A → Y transition never becomes accepted authority.

### Eligibility

1. Read the exact accepted-ledger tip.
2. If the candidate base equals the tip, use the existing direct apply.
3. Otherwise locate the candidate base in the accepted ledger.
4. Collect every transition accepted after that base.
5. Require exact path disjointness between the candidate and every intervening
   accepted transition.

Exact path disjointness is the initial limit. Same-file non-overlapping hunks
remain unsupported even when Git could apply them cleanly.

### Reconciliation process

For an eligible stale candidate:

1. Reconstruct the latest accepted ledger in a disposable worktree.
2. Overlay the original candidate's verified bytes with the existing
   repair-seed mechanism.
3. Run the approved candidate normalizers again against the combined state.
4. Capture a new patch relative to the latest accepted tree.
5. Enforce the original packet ownership against the recaptured paths.
6. Run the node's task-specific validation against the combined state.
7. Verify validation did not change the captured patch or repository identity.
8. Apply the newly captured transition only if the accepted-ledger tip remains
   unchanged.
9. Record the original model attempt as accepted with the reconciled exact
   transition.

Clean `git apply` alone is insufficient. Normalization, ownership, combined
validation, recapture, and exact transition admission remain mandatory.

### Concurrency handling

Do not hold the active apply lock while preparing and validating the disposable
reconstruction.

Use a compare-and-apply loop:

```text
snapshot accepted-ledger tip
→ reconcile and validate outside the apply lock
→ reacquire the lock
→ apply only if the tip is unchanged
```

If another node is accepted meanwhile, repeat against the longer ledger. The
loop is bounded because every retry requires the finite accepted ledger to
advance.

### Fallback and hard-failure behavior

Use the existing bounded model integration-repair path when deterministic
reconciliation cannot establish compatibility, including:

- changed-path overlap;
- candidate base unavailable in the accepted ledger;
- verified overlay conflict;
- normalization or ownership failure;
- combined node-validation failure.

Combined-validation failure requires typed integration-reconciliation evidence
so it uses the integration-repair budget rather than being mistaken for an
ordinary candidate validation failure.

Active-checkout drift, repository-identity failure, ambiguous active mutation,
or bookkeeping failure remains a hard failure with existing lock-retention
behavior. Deterministic reconciliation must not guess recovery from those
states.

### Attempt and evidence semantics

Reconciliation occurs before the original model attempt receives a terminal
outcome.

On success:

- the original attempt is accepted;
- no artificial controller or model attempt is allocated;
- no integration-repair budget is consumed;
- the accepted transition is the recaptured latest-tree transition;
- both original and reconciled patch identities remain auditable.

Record reconciliation evidence containing:

- original candidate identity;
- original and latest base trees;
- intervening accepted transitions;
- path-disjointness result;
- overlay outcome;
- normalization and validation results;
- recaptured transition identity;
- retries caused by ledger advancement.

### Change to ADR 0003

**Existing decision:** Fanout deliberately does not auto-rebase accepted
candidates. Stale publication routes through model integration repair.

**Proposed narrow replacement:** Fanout does not auto-rebase arbitrary or
conflicting candidates. It may deterministically reconcile a stale candidate
when its base is an exact accepted-ledger state, intervening changed paths are
disjoint, verified bytes apply in a latest-ledger reconstruction, and the
recaptured transition passes normalization, ownership, validation, and exact
identity gates.

All existing exact accepted-transition and final-validation guarantees remain.

### Point 2 acceptance criteria

1. A path-disjoint stale candidate is accepted with zero integration-repair
   allocations.
2. Its accepted transition chains from the latest ledger tip.
3. Overlapping paths retain bounded model integration repair.
4. Overlay or combined-validation failure retains typed integration recovery.
5. Ledger advancement during reconciliation retries without lost work.
6. Active checkout drift and ambiguous mutation still fail closed.
7. Original and reconciled patch identities remain auditable.
8. Final validation remains unchanged.

### Deferred optimizations

- Same-file clean merges.
- Three-way merge or `git rebase`.
- A generic merge framework.
- Any broader optimistic integration policy.

## 3. Repeated identical failure cutoff

Status: aligned.

### Evidence and current behavior

Repair routing currently considers the typed terminal failure and remaining
fixed budget, but not whether the previous repair changed the candidate or the
failure.

The July 20 types node produced three attempts with the same candidate and
failure:

| Attempt | Kind | Patch SHA | Result tree | Failure |
| --- | --- | --- | --- | --- |
| 1 | original | `7e035e…` | `69ce5f…` | validation command 0 |
| 2 | validation repair | `7e035e…` | `69ce5f…` | validation command 0 |
| 3 | validation repair | `7e035e…` | `69ce5f…` | validation command 0 |

After repair 1, Fanout had exact evidence that the repair made no progress but
allocated repair 2 because one budget slot remained.

The runtime chain is an important counterexample. Its patch and result-tree
identities changed, and it progressed from command 0 to command 1 even though
validation remained nonzero. The cutoff must not stop changed candidates or
formatting repairs that reduce failures while the same command still fails.

Point 1 prevents known environment failures before model work. Point 3 remains
a final defense against semantic model no-ops.

### Aligned decision: exact repair-state guard

A failed model repair terminates its repair chain when it reproduces both:

1. the exact candidate repository state that caused the repair; and
2. the exact failure state that caused the repair.

```text
same candidate state
+ same failure state
= terminal exact-no-progress
```

An original failure still receives its first permitted repair. If that repair
returns exact no progress, Fanout stops even when another repair budget slot
remains.

### Repair-state identity

Derive a canonical SHA-256 identity from admitted evidence.

#### Candidate state

Use Git authority rather than patch encoding:

- exact `HEAD` commit;
- candidate result tree;
- integration target or reconstructed tree when applicable.

The result tree is authoritative because differently encoded patches that
produce the same complete Git-visible state still represent no repository
progress.

#### Failure state

For validation and final-validation failure, include:

- exact direct-argv command manifests;
- ordered command indexes;
- statuses;
- exit codes;
- signals;
- configured timeouts;
- exact stdout and stderr.

For integration failure, include:

- exact apply stage and typed code;
- exit code or signal;
- configured timeout;
- exact stdout and stderr;
- accepted-ledger target tree.

Exclude only observational values that necessarily vary without changing the
state:

- attempt and source identities;
- timestamps;
- measured command durations.

Do not normalize paths, line numbers, timestamps embedded in output, or error
wording. Exact comparison may conservatively miss a duplicate, but it must not
collapse distinct failures.

Using an exact digest does not authorize semantic parsing of diagnostics.
Fanout compares already admitted bytes and typed facts only.

### Routing

At repair-attempt completion:

1. Derive the source repair-state identity.
2. Derive the failed repair's state identity.
3. If they are equal, record typed `exact-no-progress` evidence and choose
   terminal action `fail`.
4. If they differ, retain existing typed routing and fixed budgets.

```text
Original failure S1
→ repair 1
→ failure S1 again
→ fail: exact-no-progress

Original failure S1
→ repair 1
→ failure S2
→ ordinary routing continues
```

The decision belongs in `fanout-core` attempt policy, not an executor-specific
conditional.

### Scope

Apply the guard to model repair chains:

- validation repair;
- integration repair;
- final-validation repair.

Do not apply it to:

- original attempts;
- transient provider retries;
- realtime fallback;
- failures without an authoritative candidate state.

Transport retries may legitimately repeat because they recover provider
execution rather than repository progress.

### Attempt and event evidence

Record typed repair-progress evidence in the Attempt Outcome:

- source repair-state digest;
- current repair-state digest;
- candidate-state equality;
- failure-state equality;
- disposition `changed` or `exact-no-progress`.

The event reducer must validate this relationship against the source outcome
or exact final-validation evidence. A worker cannot claim progress or no
progress.

Reports should distinguish exact-no-progress termination from budget
exhaustion and show that repair budget remained unused.

No separate evidence artifact is required because existing recovery evidence
contains the raw facts.

### Why one no-op repair is sufficient

A second stochastic call could theoretically succeed, but treating repairs as
implicit best-of-N sampling would hide a separate execution policy inside the
repair budget.

Fanout's repair budget authorizes bounded corrective progress. Explicit
best-of-N repair can be considered later only with separate evidence and
policy.

### Change to ADR 0005

**Existing decision:** a repairable typed failure plus remaining fixed budget
authorizes another repair.

**Proposed narrow replacement:** fixed budgets remain hard ceilings, but a
successor repair additionally requires the immediately preceding repair to
have changed the candidate state or exact failure state. Exact no progress
terminates the chain with unused budget.

ADR 0005 must narrowly permit exact equality comparison over admitted command
output while continuing to prohibit semantic parsing, regex classification,
fuzzy matching, and prose-derived routing.

### Point 3 acceptance criteria

1. Identical candidate tree and failure evidence stop the repair chain.
2. A changed candidate with the same failed command continues.
3. The same candidate with different exact failure output continues.
4. Duration-only differences still count as exact no progress.
5. Provider retry and fallback behavior remain unchanged.
6. Validation, integration, and final-validation repair use the same core
   policy.
7. The event reducer rejects fabricated progress evidence.
8. Reports distinguish budget exhaustion from exact-no-progress termination.

### Deferred optimizations

- Fuzzy diagnostic matching or output normalization.
- Repair-cycle detection beyond the immediate source.
- Best-of-N repair sampling.

## 4. Vertical serial-chain fusion

Status: aligned.

### Evidence and generalization

Both p-map plans independently separated runtime implementation and runtime
tests:

```text
runtime-abort       owns index.js
runtime-tests       owns test.js
```

The test node has a `post-change-required` read of `index.js`, so the compiler
correctly derives:

```text
runtime implementation
→ runtime tests
→ final validation
```

The downstream worker repeats environment preparation, context discovery,
model launch, normalization, validation, patch capture, and publication. It
also owns only `test.js`, so a test that exposes an implementation defect
cannot repair `index.js`.

This is not specific to implementation and tests. The same shape can occur
between two implementation tasks, schema and generated client work, parser and
serializer changes, or any other serial work requiring the same context and
validation.

### Aligned decision: deterministic vertical fusion

Deterministically fuse isolated serial work units when they use equivalent
typed context, compatible validation, and the same execution class, provided
contraction does not delay another branch.

```text
Before:

A1 → A2 ─┐
B1 ──────┼→ D
C1 ──────┘

After:

[A1 + A2] ─┐
B1 ────────┼→ D
C1 ────────┘
```

A1 and A2 may represent any work category. The compiler uses typed contracts
and graph structure rather than filenames or prose labels such as
"implementation" and "tests".

### Structural eligibility

For an ordinary edge `A → B`:

1. A's only ordinary successor is B.
2. B's only ordinary predecessor is A.
3. Final-validation edges are ignored for this calculation.

This ensures fusion does not delay another branch. If A has another successor,
fusing it with B would delay that successor. If B has another predecessor,
fusion would delay work in A until the other predecessor completes.

### Execution compatibility

A and B must have:

- the same work-unit kind;
- the same derived model and tier assignment;
- the same Project Execution Profile;
- no final-validation role.

Fusion must not silently move work to a different provider, model, tier, or
trust policy.

### Equivalent typed context

Define a node's repository context from the coverage-normalized union of its:

- write resources;
- baseline reads;
- post-change reads.

A and B are initially eligible only when these resource closures are
coverage-equivalent and B's dependency on A is an explicit
`post-change-required` read.

Do not infer context equivalence from filenames, semantic similarity, advisory
prose, or model judgment during compilation.

### Compatible validation

Validation manifests must be:

- exactly identical; or
- related such that one exact ordered manifest contains the other.

The fused node uses the covering manifest once after all changes. If neither
manifest covers the other, retain separate nodes initially.

Preserve command order and intentional duplicates inside the selected covering
manifest. Do not concatenate and rerun duplicate manifests solely because the
commands came from two pre-fusion nodes.

### Fused work contract

The fused node receives the validated union of:

- goals and semantic review criteria;
- approved changes;
- read dependencies;
- forbidden writes;
- advisory context.

The union must pass ordinary work-contract, ownership, forbidden-write, and
resource-authority admission. Fusion cannot add write authority beyond the
original contracts.

The fused execution performs:

```text
one isolated environment setup
→ one worker launch
→ one normalization phase
→ one covering validation manifest
→ one ownership gate
→ one atomic accepted transition
```

Repairs receive only the same approved union, allowing them to correct either
side of the vertical slice without widening scope.

### Compiler and graph behavior

The compiler should:

1. compile the initial typed work contracts;
2. derive the initial graph;
3. identify eligible isolated serial pairs;
4. contract them deterministically;
5. rederive and validate the graph;
6. repeat for longer eligible chains.

The resulting node identity and ordering must be deterministic from the
ordered source contracts.

No scheduler change, runtime orchestrator, or model-authored grouping field is
needed. This extends the existing compiler-owned grouping policy beyond
connected write resources to one exact serial-cohesion rule.

### Atomicity and trade-offs

A1 is no longer independently accepted before A2. The fused vertical slice
succeeds or fails atomically.

This is appropriate when the scheduling boundary provides no parallelism and
both nodes form one execution context. It also prevents a downstream worker
from validating behavior it lacks authority to repair.

Keep nodes separate when independent acceptance or review is valuable, their
context or validation differs, they use different execution classes, or graph
contraction would delay another branch.

### Changes to existing compiler decisions

**Existing grouping decision:** the compiler groups connected or overlapping
write-resource scopes and derives ordering from typed post-change reads.

**Proposed extension:** after deriving that graph, the compiler also contracts
isolated serial chains that satisfy exact context, validation, execution, and
authority predicates.

**Existing validation decision:** direct-argv command order and duplicates are
preserved.

**Proposed narrow clarification:** preserve the selected covering manifest
exactly, but do not concatenate duplicate manifests from nodes that no longer
exist independently after fusion.

### Point 4 acceptance criteria

1. An eligible isolated A → B chain becomes one deterministic work contract.
2. p-map-shaped implementation → test work with equivalent context and
   covering validation fuses without filename-specific logic.
3. A with another ordinary successor does not fuse with B.
4. B with another ordinary predecessor does not fuse with A.
5. Different kinds, tiers, context closures, or incompatible validation remain
   separate.
6. The fused contract cannot exceed the union of original write authority.
7. Final validation is never fused.
8. Graph rederivation preserves all external dependencies and parallel groups.
9. The fused node runs one setup, normalization, validation, and accepted
   transition.
10. Longer eligible chains contract deterministically.

### Deferred optimizations

- Fuzzy or model-judged context similarity.
- Fusion across branches or joins.
- Same-file or validation-manifest synthesis beyond exact covering.
- Arbitrary size caps without measured oversized-worker failures.
- Runtime or scheduler-level fusion.

## 5. Controlled measurement and validation

Status: aligned.

### Purpose

Point 5 is the release-confidence protocol for proving that Points 1–4 improve
Fanout. It is not another runtime feature.

Existing runs mix Event generations, packets, Fanout versions, environment
preparation, normalization policy, interruptions, and repository states. They
remain useful descriptive evidence but cannot establish a comparable failure
rate or clean before/after performance claim.

### Aligned decision: staged acceptance

Use three stages:

1. focused offline deterministic gates for every improvement;
2. one complete clean E2E canary;
3. three to five additional identical controlled E2E repetitions.

All controlled repetitions must pass before the implementation is called
reliable.

If the first canary or any repetition fails, stop and diagnose rather than
continuing to accumulate runs. Any implementation, packet, profile, or
configuration change creates a new candidate and restarts the sequence from
one canary.

### Stage 1: offline deterministic gates

Before any paid execution, prove independently that:

- unavailable environment preparation fails before model allocation;
- a path-disjoint stale candidate reconciles with no integration-repair model;
- final-validation repair 2 reconstructs the exact rejected candidate from
  repair 1 without accepting it;
- exact repair-state repetition prevents a successor repair;
- an eligible isolated serial chain fuses without changing external graph
  dependencies;
- each new evidence and event contract replays exactly;
- active repository, lock, and worktree cleanup guarantees remain intact.

These focused checks must fail on the pre-change behavior they are intended to
replace and pass on the implementation candidate.

### Stage 2: one E2E canary

Run one complete Event-v3-or-current-generation benchmark with exact identities
for:

- repository commit and full Git-visible tree;
- task and execution packet;
- Project Execution Profile version;
- Fanout runtime commit;
- provider, model, and tier assignments;
- concurrency and runtime policy;
- platform and relevant environment.

A successful canary must:

- complete every required work node;
- pass repository and independent task acceptance commands;
- pass authoritative final validation;
- leave the active checkout at the exact accepted result;
- leak no lock, process, or disposable worktree;
- retain complete replayable evidence for every attempt and controller action.

Inspect the complete run before authorizing repetitions.

### Stage 3: controlled repetitions

After the inspected canary passes, run three to five additional repetitions
with the same immutable:

- Fanout implementation commit;
- repository base;
- objective and packet;
- Project Execution Profile;
- provider/model/tier settings;
- concurrency and validation policy.

Operational caches may naturally be warm, but their usage and relevant timings
must remain recorded rather than silently treated as equivalent to a cold run.

The result is a release-confidence gate of four to six consecutive successful
runs including the initial canary. It is not a statistically general Fanout
failure rate.

### Required measurements

Record and compare:

- planning time separately from execution;
- profile validation and isolated worktree setup;
- confirmation-to-finish wall time;
- DAG critical path and parallel overlap;
- model turns, first-output timing, and generation time;
- normalization and validation time;
- deterministic reconciliation count and time;
- repair attempts, actions, and exact-no-progress stops;
- fused node count and eliminated serial boundaries;
- tokens and cost;
- cleanup time;
- final outcome and exact active-tree state.

Report medians and the full observed range for repeated runs. Do not set or
claim a universal latency or cost SLO until the controlled measurements justify
one.

### Profiler compatibility

The optimization does not require a new profiler product feature, but the
existing profiler must remain compatible with the new authoritative evidence.

The implementation must:

1. Admit the new current packet, Event, Attempt Outcome, and Projection
   generations through `fanout-core` replay.
2. Bind each current execution to its exact Project Execution Profile identity
   in addition to its packet, planning tree, node set, and runtime policy.
3. Include profile identity in comparison-alignment checks and Evidence
   Receipts so runs using different profiles are not presented as exactly
   comparable.
4. Render recorded controller dispositions such as deterministic
   reconciliation, `exact-no-progress`, and budget exhaustion through existing
   workspace or report fields without rederiving policy.
5. Keep recognized older generations labelled Legacy; do not migrate them.

P0 repair-seed continuity and Point 4 fused-node provenance may initially use
existing Source References and read-only artifact queries. Add dedicated UI
only if the canary exposes a concrete unanswered question.

This is compatibility and exact-comparison maintenance, not authorization for
new dashboards, exports, scenarios, or profiler-owned execution analysis.

### Tooling constraint

Use existing current-generation events, profiler views, and temporary
read-only artifact queries.

Do not add:

- a profiler export feature;
- a new benchmark framework;
- legacy event migration;
- unrelated provider instrumentation;
- runtime configuration used only to manufacture a benchmark result.

Add producer evidence only when a concrete required measurement cannot be
derived from the current authoritative artifacts.

### Point 5 acceptance criteria

1. The prerequisite continuity fix and every Point 1–4 behavior have focused
   offline regression gates.
2. One clean E2E canary passes before repetitions begin.
3. Three to five additional immutable repetitions all pass.
4. Any failure stops the sequence and a changed candidate restarts it.
5. Every run records exact packet, profile, runtime, repository, routing, and
   platform identities.
6. Repository and independent task acceptance both pass.
7. No run leaks active-tree drift, locks, processes, or worktrees.
8. Performance and cost are reported from current-generation evidence without
   unsupported reliability-rate or SLO claims.
9. The profiler admits the new current generation and binds current runs and
   comparisons to exact profile identity.
10. Recorded reconciliation, no-progress, and budget-exhaustion dispositions
    remain visible without profiler-derived routing logic.
11. Existing profiler views and artifact queries are used before adding new
    tooling.

## Current overall status

### Decisions followed

- Exact packet and tree authority.
- Fresh reconstruction and validation.
- A rejected candidate may seed only its immediate disposable repair successor
  and never becomes accepted authority by doing so.
- Direct-argv command execution.
- User-reviewed execution authority.
- Current-generation replay only.
- Legacy evidence remains descriptive.
- Observability remains part of the first implementation.

### Proposed changes to prior decisions

- Replace shared-path-default preparation with isolated profile-driven setup.
- Move project-wide normalization from packets to a separate profile.
- Extend execution evidence with exact profile identity.
- Extend profiler admission, Evidence Receipts, and exact-comparison alignment
  with that profile identity while keeping routing derivation in core.
- Narrow ADR 0003 to permit fully gated deterministic reconciliation of
  path-disjoint stale candidates.
- Amend ADR 0005 so fixed repair budgets are ceilings and exact no progress
  terminates a repair chain with unused budget.
- Extend compiler-owned grouping with exact vertical fusion of isolated serial
  chains and covering validation manifests.
- Adopt one inspected canary followed by three to five identical successful
  repetitions as the release-confidence gate for this optimization candidate.

### Deferred or skipped

- Environment sharing/copy optimizations.
- Automatic profile mutation.
- New profiler features beyond current-generation compatibility and rendering
  already recorded dispositions.
- Reliability-rate claims.
- Same-file and three-way deterministic merging.
- Fuzzy failure matching, repair-cycle detection, and best-of-N repair.
- Fuzzy context matching, branch/join fusion, and runtime fusion.
- General reliability-rate or universal SLO claims from the small canary set.
- New orchestrator, profiler feature, benchmark framework, migration, or
  deferred compatibility behavior.

## Implementation record — 2026-07-27

The approved prerequisite and Points 1–4 are implemented as one coordinated
generation: profile v1, plan v3, details v5, work contract v3, packet v7,
Attempt Outcome v4, final evidence v2, Event v4, and Projection v5.

Focused regression coverage now proves:

- cumulative exact final-repair seeds and invalid-seed prelaunch failure;
- validated isolated profile preparation with exact packet/profile binding;
- exact path-disjoint reconciliation and overlap fallback;
- exact repair-state no-progress termination with unused budget;
- deterministic compiler-owned vertical serial-chain fusion;
- profile-aware profiler receipts, cohorts, comparisons, alignment, and
  existing-field disposition rendering;
- cleanup before the terminal event with recorded cleanup duration.

The controlled Point 5 sequence ran with one canary and three byte-identical
repetitions. The canary and repetitions 1–2 completed; repetition 3 stopped
after the fused runtime/test worker exhausted its fixed two validation repairs.
This is useful diagnostic evidence but does not satisfy the all-successful
release-confidence gate and does not support a reliability-rate or universal
SLO claim.

Post-run inspection also found and fixed a profiler compatibility invariant:
total run duration includes profile validation performed before `run-started`,
so a valid duration may exceed the Event-log timestamp span. The profiler still
rejects any total duration shorter than that span and derives scenarios from
the post-confirmation Event boundary. Because this source change followed the
controlled runs, any next sequence restarts from a fresh canary. Exact run,
profile, packet, pane, phase, critical-path, overlap, cost, token, repair, tree,
cleanup, and failure evidence is recorded in
[`p-map-abort-signal-canary-tracker.md`](p-map-abort-signal-canary-tracker.md).

## Implementation update — 2026-07-30

Post-canary analysis of the Execa transfer run found that Phase B had received only the profile identity, not the exact approved profile commands. It consequently repeated `npm test` in the packet-final contract and the profile required final gate. The planning boundary now supplies the exact profile to Phase B, directs ordinary nodes toward the narrowest checks for owned changes, reserves packet-final commands for additional task-specific integration, and delegates exact profile-gate duplicate rejection to core artifact admission as a correctable draft. Focused regression evidence proves that rejection publishes no details artifact, preserves the planning session, returns both duplicate locations with correction guidance, and accepts a corrected resubmission.
