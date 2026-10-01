# Case study: coding agents at async prices

A 30-slide deck for the Doubleword team: how far a parallel harness (Fanout) gets toward realtime speed on Doubleword's async tier, what is still missing, and product ideas for Doubleword. It combines measured runs on the p-map task with a declared trace-based model.

## Contents

| File | Purpose |
| --- | --- |
| `fanout.qmd` | Slides (Quarto reveal.js) |
| `custom.scss` | Theme on top of Quarto's `moon`: IBM Plex type, chart and diagram styles |
| `gen.py` | Generates the animated HTML/SVG charts into `charts/` from `data.json` |
| `data.json` | Curated numbers only: modeled width and reliability curves, and measured p-map run points |
| `MODEL.md` | Modeling rules, sources of every number, and caveats |
| `img/` | Provider screenshot |

## Render

```bash
cd docs/case-studies/coding-agents-at-async-prices
python3 gen.py
quarto render fanout.qmd
```

Open `fanout.html`; press `S` for speaker notes. For a PDF, open `fanout.html?print-pdf` in a browser and print to PDF (charts show their final state). `charts/`, `fanout_files/` and `*.html` are generated and ignored.

## Reading the numbers

Solid bars are measured; hatched bars are modeled. All dollar figures are token-price estimates, not invoices. The four runs used throughout each passed the stricter six-case independent acceptance check; faster runs exist but predate that check. See [MODEL.md](MODEL.md) and the [study](../../STUDY.md).
