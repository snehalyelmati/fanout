# Tier and model resolution

Fanout has two execution tiers and three concrete model roles:

- Tier 1: realtime control plane and typed repair.
- Tier 2: asynchronous background workers.
- Tier 2 fallback: realtime worker fallback; a role, not a third tier.

Batch execution remains out of scope.

## Configuration

Tier 1 always follows Pi's active model and thinking level. `/fanout-config tier1` changes Pi directly rather than storing a second Tier 1 override.

Tier 2 defaults to `doubleword / zai-org/GLM-5.2-FP8` with `medium` thinking. It is usable only when the selected registry model advertises all three properties:

```ts
model.fanout.async === true
model.fanout.background === true
model.fanout.authReady === true
```

Tier 2 fallback inherits the resolved Tier 1 role unless `fanout.execution.tier2Fallback` selects another runnable realtime registry model. Disabling Tier 2 preserves its selected model but routes newly planned eligible workers through this fallback role.

`fanout.execution.maxConcurrency` is read during `/fanout-plan` and captured in packet v6 runtime policy. Changing settings after planning does not mutate an accepted packet's execution policy. Retry, fallback, validation-repair, and integration-repair budgets remain fixed controller policy.

## Planning resolution

1. Resolve Tier 1 from the active Pi model and thinking level; fail planning if unavailable.
2. Resolve the configured/default Tier 2 registry model and supported thinking level.
3. Mark Tier 2 available only when it is enabled and all required capability metadata is true.
4. Resolve the realtime fallback from explicit settings or Tier 1 inheritance.
5. Assign `final-validation` and other controller work to Tier 1.
6. Assign eligible worker kinds (`implement`, `test`, `docs`, `inspect`, `validate-shard`, `review-shard`) to available Tier 2; otherwise assign the concrete fallback on the realtime tier.
7. Store all three model summaries, each node's concrete routing, and immutable runtime policy in packet v6.

Unavailable Tier 2 does not fail planning. It produces explicit unavailable/fallback reasoning in the packet-derived report.

## Packet v6 authority

Packet v6 nodes contain only:

- node ID and kind;
- concrete tier/model assignment and active/background policy;
- one embedded `fanout.work-contract` v2.

Typed work contracts are the sole ownership, read, forbidden-write, candidate-normalization, validation, capability, and semantic-criteria authority. Graph edges, prompts, confirmation summaries, Markdown, and Mermaid derive from them. There are no `ownedFiles`, `dependencies`, `workerPacket`, shell-command strings, or other flattened legacy fields.

Packet-global runtime policy fixes `maxConcurrency`, `failFast`, and whether typed fallback is permitted. `/fanout-execute` consumes that policy directly and does not reread current settings.

## Execution routing

`/fanout-execute` does not replan or globally reroute nodes:

1. Run the node with its packet-assigned provider/model/thinking.
2. A typed transient Tier 2 failure may consume one clean retry.
3. Exhausted retryable Tier 2 work may consume one realtime attempt with the packet's concrete fallback role when permitted.
4. Typed validation and integration repair use Tier 1 and their fixed two-launch pools.
5. Record every allocation and terminal outcome in event v2; diagnostic text never changes routing.

Generic-provider acceptance requires complete correlated Pi usage. Instrumented Doubleword attempts additionally require matching provider response/poll/usage/pricing evidence. Provider availability is not a reason to mutate packet routing for other nodes.

## Trust boundary

Tier selection does not sandbox providers, installed extensions, repository instructions, validation programs, inherited environment, network, processes, ignored files, or external paths. Those retain the user's host permissions. Fanout's guarantees cover strict artifact admission, model-callable file capabilities, typed repository authority, exact patch/tree integration, causal budgets, and explicit evidence.
