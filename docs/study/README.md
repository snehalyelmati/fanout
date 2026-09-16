# Study figure data and regeneration

`results.csv` is a **curated scalar summary**, not a trace or complete benchmark archive. It records selected p-map, qs, Pi764 and PR787 observations from [BENCHMARKS.md](../BENCHMARKS.md); `source_section` is the heading anchor for the public numerical source. Run identifiers are study-local labels. No prompt, session, tool event stream or local evidence path is exported.

`configuration` distinguishes ordinary Pi, iterative parallel Fanout, experimental batch parallel Fanout and the separate whole-task experiment. `routing_id` resolves to the exact role assignments below; every plotted run uses the OpenAI Codex realtime service at medium reasoning, with no Doubleword/async task run:

| Routing ID | Model roles |
| --- | --- |
| `codex-sol-realtime` | Ordinary Pi agent: `gpt-5.6-sol` medium. |
| `codex-sol-planner-terra-worker-sol-repair-realtime` | Fanout planner: `gpt-5.6-sol` medium; initial workers: `gpt-5.6-terra` medium; repair: `gpt-5.6-sol` medium. |
| `codex-terra-initial-sol-repair-realtime` | Whole-task initial candidate: `gpt-5.6-terra` medium; bounded recovery: `gpt-5.6-sol` medium. |

`status` is the primary recorded outcome: `pass`, `historical-pass` (older acceptance/E2E boundary), `semantic-fail`, `quality-fail`, `harness-error`, `infrastructure-error`, or `checker-biased`. The p-map batch Fanout row retains its primary harness-error label even though its candidate passed native gates. Pi764's 28.118 seconds end at the provider usage-limit error, not completed validation; its correction count is `NA` because the first correction was interrupted. All PR787 final automated gates passed, but manual quality accepted raw 2/3 and whole-task 0/2; there is no admitted arm mean. Qs raw-02's final candidate passed, but the checker incorrectly forced an unnecessary correction: its time and cost remain visible as **checker-biased resource use**, excluded from fair raw comparison. The exploratory p-map whole-01 is kept separate from the two predeclared repeats; diagnostic and native-continuation rows are distinct protocol variants. [p-map batch](../BENCHMARKS.md#complete-before-validation-prompt-canary--2026-09-07), [Pi764](../BENCHMARKS.md#pi-fixed-comparison-stopped-by-provider-usage-limit--2026-09-08), [PR787](../BENCHMARKS.md#pr787-fixed-comparison-faster-traces-no-accepted-batch--2026-09-08), [qs calibration](../BENCHMARKS.md#qs-raw-calibration-and-artifact-checker-defect--2026-09-07).

`e2e_s` is the cohort's reported task-clock duration in seconds; historical p-map supplemental audit was outside that clock. `estimated_usd` is token-price arithmetic, not billed cash or provider operating cost. `responses` and `corrections` are reported counts where comparable; `NA` means this summary does not supply a count. A failed or interrupted run's values are consumed resources, not cost or time to correct completion. This selection must not be used to calculate a cross-family mean. [Accounting protocol](../benchmarks/fanout-high-latency-study.md#acceptance-and-full-e2e-accounting).

`figures/measured-comparison.svg` (and PNG) plots each selected run on task-specific time and cost axes. Shape and explicit text show outcome, while color identifies configuration. Its apparent fast failed points are deliberately retained with their failure labels.

`figures/modeled-feasibility.svg` (and PNG) is **hypothetical sensitivity**, with equal work `D×W` and synchronized homogeneous worker waves. Declared planning `P=307.086s`, final validation `V=296.075s` and work-envelope `E=279.310s` constants supply an illustrative time scale from the study's earlier visualization example. They are model inputs, not a reconstructed measured baseline. They do not measure ordinary Pi's serial-unit speed, future provider latency or model quality. For depth `D=2`, width `W=1..8`, concurrency `C=4`, added request delay `L=60s` and `r=1` or `4` sequential model requests per work unit:

```text
ordinary-realtime serial surrogate = V + E × D × W
high-latency Fanout              = P + V + (E + r × L) × D × ceil(W/C)
```

This assumes zero additional repair overhead and the same useful work, capability and acceptance. The added 60 seconds is **in addition to** timing already in `E`, not an observed Doubleword completion delay or total TTFT. A worker's request depth `r` is distinct from task DAG depth `D`. The simple wave equation is valid only for the declared synchronized homogeneous workers; it is not a scheduler replay. The modeled Fanout-only D2/W3 check is `307.086 + 296.075 + 279.310×2 = 1161.781s`, then two affected waves add `120s` to reach `1281.781s`. This check does not compare to measured ordinary Pi.

### Timing-input provenance

The earlier visualization protocol prescribed the following constants. Retaining its exact values makes the corrected concurrency arithmetic checkable; their decimal precision is not an accuracy claim for the hypothetical serial or parallel workloads.

| Input | Value | Provenance and definition limit |
| --- | ---: | --- |
| Planning `P` | 307.086s | Prescribed planning allowance in the earlier study visualization example. Its original request-to-completion derivation was not independently recovered for this release; use it as an assumed constant. |
| Final validation `V` | 296.075s | Rounded command-duration sum from Execa repetition 1, run `2026-08-05T05-18-55-482Z-7437e419`: 4.835491s focused lint + 291.239776s full test = 296.075267s. This excludes reconstruction and other surrounding lifecycle time. |
| Work envelope `E` | 279.310s | Prescribed per-wave work allowance in the earlier visualization example. Its exact original aggregation was not independently recovered; it is not a measured ordinary-Pi unit duration or a measured per-node request duration. |

The [Execa repetition record](../benchmarks/execa-web-streams-manual-e2e.md#2026-08-05-five-repetition-cohort) identifies runtime source `ebbbd7ecba4418fb58944558727b933f690c090d`, task base `6e9ed1185adca485097d299da263a38d74ee636b`, and packet SHA-256 `974cb3b9eb0a48e3c1cbc8dd2e6e0a3bbe90374e185a119c4e9a79d3f287596c`. The locally checked final-validation receipt has SHA-256 `633034b4175fc52ea0715110314cc46ab6b8c2206eac57fd294cc0e5e13b18c1`; the receipt and raw outputs are not published. No combination of these constants is presented as that run's measured E2E.

The model's price panel uses separate **invented units**: serial `$0.30 × D × W`; Fanout `$0.35` fixed coordinator/repair allowance plus worker price ratio `q × $0.30 × D × W`, for `q=0.5` and `0.8`. It illustrates when parallel time and assumed cheap-worker cost can both improve, while every branch still adds cost. It does not derive prices, tokens, repair demand or model capability from observed runs.

Regenerate the Matplotlib SVG and PNG exports in an isolated plotting environment; this is a documentation tool, not a project runtime dependency:

```sh
python3 -m venv /tmp/fanout-study-plot-venv
/tmp/fanout-study-plot-venv/bin/python -m pip install -r docs/study/requirements.txt
/tmp/fanout-study-plot-venv/bin/python scripts/study-figures.py
```

The script checks 27 unique rows, recognized outcomes, positive scalar values, the qs checker-bias label, both PR787 whole-task failures and the D2/W3 arithmetic before rendering. SVG files contain title/description metadata; the PNGs are static raster exports. The ignored local run archives remain the detailed source of record and are intentionally absent from this public data set.
