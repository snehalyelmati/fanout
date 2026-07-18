# Fanout

Fanout turns a reviewed repository objective into bounded parallel work while preserving a provable chain from planning authority to accepted repository state.

## Planning language

**Objective**:
The user-approved repository outcome that one planning run is trying to achieve.
_Avoid_: Prompt, request

**Implementation Plan**:
The accepted semantic decomposition and maximum repository scope for an objective. It expresses intent, not executable worker authority.
_Avoid_: Packet, execution plan, plan result

**Implementation Details**:
The refinement of a plan into concrete change intents, reads, prohibitions, and commands without widening the plan.
_Avoid_: Grounding artifact, compilation

**Work Contract**:
The single authoritative statement of one node's goals, repository authority, validation, capabilities, review criteria, and advisory context.
_Avoid_: Worker prompt, work unit

**Execution Packet**:
The immutable, self-contained authority for one executable Fanout run, including its planning identity, routing policy, and work contracts.
_Avoid_: Plan, report

**Active Packet Pointer**:
The exact identity-bound reference that selects the one execution packet currently available for execution.
_Avoid_: Latest packet, active packet copy

**Artifact Identity**:
The exact path and byte identity used to admit an immutable planning or execution artifact.
_Avoid_: Filename, artifact reference

## Repository authority

**Repository Resource**:
A typed file or directory inside the repository used to express scope.
_Avoid_: Path, glob

**RepoPath**:
The canonical literal repository-relative identity used inside repository resources and authority checks.
_Avoid_: Filesystem path, glob

**Observed Changed Path**:
The exact entry identity reported by Git for a candidate change, before it is matched against typed repository authority.
_Avoid_: Resource, inferred scope

**Write Authority**:
The maximum repository resources that an accepted change may alter.
_Avoid_: Ownership note, writable path

**Read Dependency**:
A repository resource a node needs either from the planning baseline or after another node changes it.
_Avoid_: Dependency string

**Forbidden Write**:
A typed repository resource that an attempt may not change, regardless of advisory prose.
_Avoid_: Warning, forbidden note

**Change Intent**:
A typed semantic operation whose endpoints define the sole stored write authority for one planned change.
_Avoid_: Task description, implementation note

**Planning Base**:
The exact repository commit and Git-visible tree against which a plan was accepted.
_Avoid_: Base branch, current checkout

## Execution language

**DAG Node**:
The scheduling envelope for one work contract. It supplies identity and routing without restating repository authority.
_Avoid_: Work contract, task

**Attempt**:
One controller-authorized worker launch with one kind, one budget allocation, and one terminal outcome.
_Avoid_: Turn, retry

**Attempt Outcome**:
The durable terminal record that correlates one attempt's kind, evidence, stage fact, controller action, metrics, and budget transition.
_Avoid_: Worker response, status message

**Worker Turn**:
One terminal Pi assistant turn within an attempt, identified as the parent of its provider responses and tool invocations.
_Avoid_: Attempt, retry

**Provider Response**:
One instrumented provider operation within a worker turn, identified as the parent of its polling observations.
_Avoid_: Worker turn, assistant message

**Provider Poll**:
One correlated status and duration observation for an instrumented provider response.
_Avoid_: Retry, worker polling loop

**Tool Invocation**:
One model-requested tool call correlated to its worker turn and terminal local duration evidence.
_Avoid_: Command, validation step

**Repair Budget**:
A node-global monotonic allowance consumed before a repair-capable attempt is launched.
_Avoid_: Recursive retry count, refreshed allowance

**Candidate**:
The repository state produced by an attempt before it is accepted into the repository ledger.
_Avoid_: Patch, result

**Candidate Normalization**:
A packet-declared deterministic transformation applied once to a candidate before its patch is captured and validated.
_Avoid_: Auto-fix inference, repair

**Validation**:
The controller-owned execution of the commands declared for a work contract against a candidate.
_Avoid_: Semantic review

**Final Validation**:
The authoritative integrated validation of the accepted ledger in a fresh repository reconstruction.
_Avoid_: Node validation, active-checkout test

**Final-validation Round**:
One numbered reconstruction and validation of the complete accepted ledger, including any bounded repair decision it produces.
_Avoid_: Test retry, node attempt

**Final-validation Evidence**:
The identity-bound record of one final-validation round's reconstructed trees, command results, boundary checks, and routing fact.
_Avoid_: Test log, summary

**Repair**:
A new bounded attempt supplied with typed evidence from a rejected candidate or failed final-validation round.
_Avoid_: Retry, patch fix-up

**Repair Seed**:
Rejected candidate bytes supplied only as the starting overlay for the next disposable validation-repair attempt; they never enter accepted state directly.
_Avoid_: Repair candidate, accepted patch

**Repair Candidate**:
The repository state produced by a repair attempt, which must pass fresh reconstruction and the normal acceptance gates before it can enter the ledger.
_Avoid_: Repair seed, accepted state

**Accepted Patch**:
Exact binary Git patch bytes bound to their changed paths, planning commit, base tree, and result tree.
_Avoid_: Diff file, overlay

**Accepted-State Transition**:
One verified move from an exact accepted tree to another exact accepted tree using an accepted patch.
_Avoid_: Apply result

**Accepted Ledger**:
The ordered chain of accepted-state transitions for a run.
_Avoid_: Patch list, current files

## Audit language

**Stage Fact**:
A closed, typed machine fact emitted by one deterministic execution stage. Human-readable output is diagnostic only.
_Avoid_: Error message, failure text

**Controller Action**:
The terminal routing decision for an attempt, such as accept, retry, repair, fail, or abort.
_Avoid_: Model recommendation

**Run Event**:
One validated immutable domain transition in an execution run.
_Avoid_: Log message, snapshot update

**Event Log**:
The gapless append-only sequence of run events that is authoritative for execution state.
_Avoid_: Execution snapshot, console log

**Projection**:
Replaceable run state reduced from the complete event log.
_Avoid_: Authority, snapshot source

**Derived Report**:
A deterministic human view of authoritative planning or execution state that never becomes machine policy.
_Avoid_: Execution plan, run state

**Accepted Metrics**:
The complete correlated usage, pricing, tool, worker-timing, and compatibility-class-specific provider evidence required before an attempt may be accepted.
_Avoid_: Best-effort telemetry, partial success metrics

**Artifact Generation**:
The coordinated set of planning and execution artifact versions admitted and interpreted as one compatibility boundary.
_Avoid_: Schema version, format version

**Diagnostic Observation**:
A deterministic evidence-backed statement about recorded or derived run behavior that does not recommend or rank changes.
_Avoid_: Optimization signal, recommendation

**Counterfactual Scenario**:
A user-configured deterministic calculation that preserves observed work and outcomes while varying bounded scheduling or provider timing and cost inputs.
_Avoid_: Prediction, forecast

**Local Trust Boundary**:
The boundary under which Fanout hardens deterministic repository integration while trusted Pi code and approved local programs retain the user's host permissions.
_Avoid_: Sandbox, containment

Sources: [Wayfinder map #8](https://github.com/snehalyelmati/fanout/issues/8), [trust boundary #9](https://github.com/snehalyelmati/fanout/issues/9), [repository authority #11](https://github.com/snehalyelmati/fanout/issues/11), [identity #12](https://github.com/snehalyelmati/fanout/issues/12), [attempt outcomes #14](https://github.com/snehalyelmati/fanout/issues/14), [run events #15](https://github.com/snehalyelmati/fanout/issues/15), [work contract #17](https://github.com/snehalyelmati/fanout/issues/17), [final validation #18](https://github.com/snehalyelmati/fanout/issues/18), [implementation spec #21](https://github.com/snehalyelmati/fanout/issues/21), [worktree preparation #30](https://github.com/snehalyelmati/fanout/issues/30), and [candidate normalization #32](https://github.com/snehalyelmati/fanout/issues/32).
