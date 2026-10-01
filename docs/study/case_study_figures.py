"""Offline static case-study figures. Run with python3 after installing requirements.txt."""
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from matplotlib.ticker import FuncFormatter

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "case-studies" / "coding-agents-at-async-prices" / "data.json"
OUT = HERE / "figures"

# Seconds and estimated USD: measured anchors, then fixed-trace counterfactuals.
WALK = [
    ("Raw Pi Sol", 274.137, 0.54771, False),
    ("Raw Pi Kimi realtime", 691.486, 0.8515143, False),
    ("Raw Pi Kimi async", 2011.486, 0.631702, True),
    ("Fanout Kimi / DeepSeek realtime", 523.805, 0.318282, False),
    ("+ async workers", 1663.805, 0.310442, True),
    ("+ continuations: groups of 10", 643.805, 0.310442, True),
    ("+ depth 19 → 10", 583.805, 0.310442, True),
    ("+ half the output", 530.656, 0.200159, True),
]


def validate(width):
    assert all(math.isfinite(v) and v > 0 for row in WALK for v in row[1:3])
    assert math.isclose(WALK[2][1] - WALK[1][1], 22 * 60)
    assert math.isclose(WALK[4][1] - WALK[3][1], 19 * 60)
    assert math.isclose(WALK[4][1] - WALK[5][1], (19 - 2) * 60)
    assert math.isclose(WALK[5][1] - WALK[6][1], 60)
    assert WALK[4][2] == WALK[5][2] == WALK[6][2]
    assert width and len({config["label"] for config in width}) == len(width)
    for config in width:
        rows = config["rows"]
        assert rows and [r["W"] for r in rows] == sorted({r["W"] for r in rows})
        assert all(math.isfinite(r[k]) and r[k] > 0
                   for r in rows for k in ("W", "time_ratio", "cost_ratio"))


def save(fig, name, title, description):
    fig.savefig(OUT / f"{name}.svg", metadata={
        "Date": None, "Title": title, "Description": description,
    })
    fig.savefig(OUT / f"{name}.png", dpi=160)
    plt.close(fig)


def walk_figure():
    fig, axes = plt.subplots(1, 2, figsize=(13, 7), sharey=True)
    for ax, column, scale, title in zip(axes, (1, 2), (60, 1),
                                         ("Active time (minutes)", "Token-price estimate (USD)")):
        for y, row in enumerate(WALK):
            _, time, cost, modeled = row
            value = row[column] / scale
            ax.barh(y, value, height=0.62, color="#dce8f2" if modeled else "#3676a8",
                    edgecolor="#42627d", hatch="///" if modeled else None)
            ax.text(value + (0.35 if column == 1 else 0.012), y,
                    f"{time / 60:.1f}" if column == 1 else f"${cost:.3f}", va="center")
        ax.axvline(WALK[0][column] / scale, color="#333333", linestyle="--", linewidth=1.3)
        ax.set_xlim(0, max(r[column] / scale for r in WALK) * 1.21)
        ax.set_title(title, loc="left", pad=12)
        ax.grid(axis="x", color="#e5e7eb")
        ax.set_axisbelow(True)
        ax.tick_params(axis="y", length=0)
    axes[0].set_yticks(range(len(WALK)), [
        f"{r[0]}\n({'modeled' if r[3] else 'measured'})" for r in WALK
    ])
    axes[0].invert_yaxis()
    fig.suptitle("p-map: from realtime runs to an async model", x=0.03, ha="left", fontsize=16)
    fig.legend(handles=[
        Patch(facecolor="#3676a8", label="Measured"),
        Patch(facecolor="#dce8f2", edgecolor="#42627d", hatch="///", label="Modeled"),
        Line2D([], [], color="#333333", linestyle="--", label="Raw Pi Sol reference"),
    ], loc="lower center", bbox_to_anchor=(0.64, 0.045), ncol=3, frameon=False)
    fig.text(0.03, 0.025, "Fanout planner stays realtime. Continuations are hypothetical. USD = token-price estimates, not invoices.", fontsize=10)
    fig.subplots_adjust(left=0.31, right=0.98, bottom=0.15, top=0.88, wspace=0.14)
    save(fig, "async-walk", "Measured and modeled p-map async walk",
         "Two horizontal bar panels: minutes and estimated USD. Hatched bars are modeled; dashed lines mark raw Pi Sol.")


def width_figure(width):
    fig, axes = plt.subplots(1, 2, figsize=(13, 7))
    colors = ("#3676a8", "#158074", "#666666", "#b36a00", "#8a629c", "#b94458")
    for ax, key, title in zip(axes, ("time_ratio", "cost_ratio"),
                               ("Time / raw Pi Sol", "Estimated cost / raw Pi Sol")):
        for i, config in enumerate(width):
            rows = config["rows"]
            ax.plot([r["W"] for r in rows], [r[key] for r in rows], marker="o",
                    color=colors[i % len(colors)], linestyle="-" if i % 2 == 0 else "--",
                    label=config["label"].replace("DS ", "DeepSeek "))
        ax.set_xscale("log", base=2)
        ax.set_yscale("log")
        ax.set_yticks((0.25, 0.5, 1, 2, 4, 8) if key == "time_ratio"
                     else (0.05, 0.1, 0.25, 0.5, 1))
        ax.axhline(1, color="#333333", linestyle="--", linewidth=1.3)
        ax.set_xticks(sorted({r["W"] for c in width for r in c["rows"]}))
        ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}×"))
        ax.set_title(title, loc="left", pad=12)
        ax.set_xlabel("Independent parts (W)")
        ax.grid(color="#e5e7eb", which="major")
        ax.set_axisbelow(True)
    fig.suptitle("Width sensitivity — all curves modeled", x=0.03, ha="left", fontsize=16)
    fig.legend(*axes[0].get_legend_handles_labels(), loc="lower center",
               bbox_to_anchor=(0.5, 0.055), ncol=2, frameon=False)
    fig.text(0.03, 0.025, "Concurrency 4; fixed realtime planner; equal units; sequential raw Sol reference. Below 1 = better. No new quality measurement.", fontsize=10)
    fig.subplots_adjust(left=0.07, right=0.98, bottom=0.28, top=0.88, wspace=0.18)
    save(fig, "width-sensitivity", "Modeled width sensitivity versus raw Pi Sol",
         "All configurations from the case-study width data, with log-scale axes and reference lines at one.")


if __name__ == "__main__":
    width = json.loads(SOURCE.read_text())["width"]
    validate(width)
    plt.rcParams.update({"font.size": 10, "font.family": "DejaVu Sans",
                         "axes.spines.top": False, "axes.spines.right": False,
                         "svg.hashsalt": "fanout-case-study"})
    OUT.mkdir(exist_ok=True)
    walk_figure()
    width_figure(width)
    print(f"Validated {len(WALK)} walk steps and {len(width)} width configurations; wrote four SVG/PNG exports.")
