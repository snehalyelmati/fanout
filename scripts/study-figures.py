#!/usr/bin/env python3
"""Render curated public study figures with Matplotlib (no raw trace input)."""

import csv
import math
import os
import tempfile
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", tempfile.mkdtemp(prefix="fanout-study-mpl-"))
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/study/results.csv"
OUT = ROOT / "docs/study/figures"
COLORS = {
    "ordinary-pi": "#334155",
    "parallel-fanout-iterative": "#176f99",
    "parallel-fanout-batch": "#6147aa",
    "whole-task-experiment": "#b66b23",
}
NAMES = {
    "ordinary-pi": "Pi",
    "parallel-fanout-iterative": "Fanout iterative",
    "parallel-fanout-batch": "Fanout batch",
    "whole-task-experiment": "Whole task",
}
STATUS = {
    "pass": "PASS",
    "historical-pass": "OLD PASS",
    "semantic-fail": "SEMANTIC FAIL",
    "quality-fail": "QUALITY FAIL",
    "harness-error": "HARNESS ERROR",
    "infrastructure-error": "INFRA ERROR",
    "checker-biased": "CHECKER BIAS",
}


def read_rows():
    with DATA.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 27
    assert len({(r["task"], r["run"]) for r in rows}) == len(rows)
    for row in rows:
        assert row["configuration"] in COLORS and row["status"] in STATUS
        assert row["routing_id"] and row["source_section"]
        row["e2e_s"] = float(row["e2e_s"])
        row["estimated_usd"] = float(row["estimated_usd"])
        assert row["e2e_s"] > 0 and row["estimated_usd"] >= 0
    assert [r["status"] for r in rows if r["task"] == "PR787" and r["configuration"] == "whole-task-experiment"] == ["quality-fail", "quality-fail"]
    assert next(r for r in rows if r["task"] == "qs" and r["run"] == "raw-02-checker-biased")["status"] == "checker-biased"
    return rows


def save(fig, stem, title, description):
    OUT.mkdir(parents=True, exist_ok=True)
    for extension in ("svg", "png"):
        fig.savefig(
            OUT / f"{stem}.{extension}",
            format=extension,
            dpi=170,
            facecolor="white",
            bbox_inches="tight",
            metadata={"Title": title, "Description": description} if extension == "svg" else {"Title": title},
        )
        if extension == "svg":
            path = OUT / f"{stem}.{extension}"
            path.write_text("\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n")
    plt.close(fig)


def point(ax, x, y, row):
    status = row["status"]
    color = COLORS[row["configuration"]]
    shape = "s" if status.endswith("error") else "D" if "fail" in status or status == "checker-biased" else "o"
    face = color if status == "pass" else "white"
    ax.scatter(x, y, s=68, marker=shape, facecolors=face, edgecolors=color, linewidths=1.9, zorder=3)


def measured_figure(rows):
    groups = [(task, [r for r in rows if r["task"] == task]) for task in ("p-map", "qs", "Pi764", "PR787")]
    ratios = [len(group) + 1 for _, group in groups]
    fig = plt.figure(figsize=(17, 13.4), layout="constrained")
    grid = fig.add_gridspec(4, 2, height_ratios=ratios, width_ratios=[1, 1.02], hspace=0.12, wspace=0.08)
    for index, (task, group) in enumerate(groups):
        a_time = fig.add_subplot(grid[index, 0])
        a_cost = fig.add_subplot(grid[index, 1], sharey=a_time)
        time_max = math.ceil(max(r["e2e_s"] for r in group) / 100) * 100
        cost_max = math.ceil(max(r["estimated_usd"] for r in group) * 2) / 2
        y_values = list(range(len(group)))
        for y, row in zip(y_values, group):
            point(a_time, row["e2e_s"], y, row)
            point(a_cost, row["estimated_usd"], y, row)
            a_time.text(time_max*1.03, y, f'{row["e2e_s"]:.1f}', va="center", fontsize=9)
            a_cost.text(cost_max*1.025, y, f'${row["estimated_usd"]:.3f}', va="center", fontsize=9)
            a_cost.text(cost_max*1.35, y, STATUS[row["status"]], va="center", fontsize=8,
                        color="#526074", fontweight="bold")
        a_time.set_yticks(y_values, [f'{r["run"]} · {NAMES[r["configuration"]]}' for r in group], fontsize=9)
        a_time.set_ylim(len(group) - 0.5, -0.5)
        a_cost.tick_params(axis="y", labelleft=False)
        a_time.set_xlim(0, time_max*1.15)
        a_cost.set_xlim(0, cost_max*1.59)
        a_time.set_xticks([0, time_max/2, time_max], ["0", f"{time_max/2:g}", f"{time_max:g}"])
        a_cost.set_xticks([0, cost_max/2, cost_max], ["$0", f"${cost_max/2:g}", f"${cost_max:g}"])
        for ax in (a_time, a_cost):
            ax.set_facecolor("#f7f9fc")
            ax.grid(axis="x", color="#dbe2ec", linewidth=0.8)
            ax.tick_params(axis="both", length=0, colors="#526074", labelsize=9)
            for spine in ax.spines.values():
                spine.set_visible(False)
        a_time.set_title(f"{task} · {len(group)} observations" if index else f"{task} · {len(group)} observations\nFull task E2E · seconds",
                         loc="left", fontsize=12, fontweight="bold")
        if index == 0:
            a_cost.set_title("Estimated token cost · USD", loc="left", fontsize=12, fontweight="bold")
    fig.suptitle("Measured coding-task outcomes", x=0.04, ha="left", fontsize=21, fontweight="bold")
    fig.supxlabel("Filled circle: accepted  ·  open circle: historical pass  ·  diamond: failure/bias  ·  square: error.  Failed time ends at failure; no selective-success mean.",
                 fontsize=9, color="#526074")
    save(fig, "measured-comparison", "Measured coding-task outcomes",
         "Curated per-run seconds and estimated token cost for p-map, qs, Pi764, and PR787. Task-specific axes and explicit status labels distinguish accepted work from semantic failure, manual quality failure, checker bias, and harness or infrastructure errors.")


P, V, E, D, C = 307.086, 296.075, 279.310, 2, 4


def modeled_time(width, requests, extra_delay, parallel):
    if not parallel:
        return V + E*D*width
    return P + V + (E + requests*extra_delay)*D*math.ceil(width/C)


def modeled_cost(width, price_ratio, parallel):
    serial_work_cost = 0.30*D*width
    return 0.35 + price_ratio*serial_work_cost if parallel else serial_work_cost


def model_figure():
    assert math.isclose(modeled_time(3, 1, 0, True), 1161.781)
    assert math.isclose(modeled_time(3, 1, 60, True), 1281.781)
    assert math.isclose(modeled_time(3, 1, 60, True) - modeled_time(3, 1, 0, True), 120)
    assert math.isclose(modeled_cost(3, 0.5, True), 1.25)
    assert modeled_time(1, 1, 60, True) > modeled_time(1, 1, 60, False)
    assert modeled_time(3, 4, 60, True) < modeled_time(3, 4, 60, False)
    widths = list(range(1, 9))
    fig, (time_ax, cost_ax) = plt.subplots(1, 2, figsize=(13.2, 6.8), layout="constrained")
    fig.suptitle("Equal-work latency and price sensitivity · modeled", x=0.04, ha="left", fontsize=19, fontweight="bold")
    time_ax.plot(widths, [modeled_time(w, 1, 60, False) for w in widths], color="#b66b23", marker="o", label="Ordinary realtime serial surrogate")
    time_ax.plot(widths, [modeled_time(w, 1, 60, True) for w in widths], color="#176f99", marker="o", label="Fanout · 1 slow request/unit")
    time_ax.plot(widths, [modeled_time(w, 4, 60, True) for w in widths], color="#6147aa", linestyle="--", marker="s", label="Fanout · 4 slow requests/unit")
    time_ax.set(title="Modeled task time", xlabel="Independent work units per layer (W)", ylabel="Seconds")
    time_ax.legend(loc="upper left", frameon=False, fontsize=9)
    cost_ax.axhline(1, color="#94a3b8", linestyle=":", linewidth=1)
    for ratio, color, linestyle in ((0.5, "#176f99", "-"), (0.8, "#6147aa", "--")):
        cost_ax.plot(widths, [modeled_cost(w, ratio, True)/modeled_cost(w, ratio, False) for w in widths],
                     color=color, linestyle=linestyle, marker="o", label=f"Worker price ratio q={ratio:g}")
    cost_ax.set(title="Fanout / serial cost ratio", xlabel="Independent work units per layer (W)", ylabel="Ratio · below 1× is cheaper", ylim=(0.4, 1.65))
    cost_ax.legend(loc="upper right", frameon=False, fontsize=9)
    for ax in (time_ax, cost_ax):
        ax.set_xticks(widths)
        ax.set_facecolor("#f7f9fc")
        ax.grid(color="#dbe2ec", linewidth=0.8)
        for spine in ax.spines.values():
            spine.set_visible(False)
    fig.supxlabel("D=2, C=4, P=307.086s, V=296.075s, E=279.310s; +60s per slow request, synchronized waves, no additional repair time.\n"
                 "Time: serial V+E·D·W; Fanout P+V+(E+rL)·D·ceil(W/C). Cost: serial $0.30·D·W; Fanout $0.35+q·$0.30·D·W.\n"
                 "D2/W3/r1 Fanout: 1161.781s base + 120s = 1281.781s. All prices, equal work and Pi serial speed are assumptions.",
                 fontsize=8.8, color="#526074")
    save(fig, "modeled-feasibility", "Equal-work model sensitivity",
         "Hypothetical ordinary realtime serial and high-latency parallel Fanout task times for one to eight independent units per layer, including one or four serial slow requests per worker unit. A separate cost panel uses assumed worker price ratios. This is not a measured Pi or Doubleword comparison.")


if __name__ == "__main__":
    measured_figure(read_rows())
    model_figure()
    print(f"Wrote two SVG and two PNG figures to {OUT}")
