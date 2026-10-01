"""Generate animated reveal.js chart snippets (HTML/SVG) from the offline model outputs.
Run: python3 gen.py  -> writes charts/*.md (raw-HTML blocks) included by fanout.qmd."""
import json, math, pathlib, re

HERE = pathlib.Path(__file__).parent
DATA = json.load(open(HERE / "data.json"))
OUT = HERE / "charts"
OUT.mkdir(exist_ok=True)


def write(name, html):
    (OUT / f"{name}.md").write_text("```{=html}\n" + html + "\n```\n")


def mins(s):
    return f"{s/60:.1f} min"


def usd(c):
    return f"${c:.2f}" if c >= 0.1 else f"${c:.3f}"


# ---------- bar chart: label | time track | cost track ----------
def bars(rows, tmax, cmax, tbase=None, cbase=None, head=("Time", "Cost"), frag=True, cls="", tfmt=None, cfmt=None, one=False):
    """rows: dict(label, t, c, kind, t_ext=None, c_ext=None, static=False, sub='')."""
    def track(v, ext, vmax, base, fmt, kind):
        w = 100 * v / vmax
        h = f'<span class="bfill k-{kind}" style="width:{w:.2f}%"></span>'
        if ext and ext > v:
            h += f'<span class="bext" style="left:{w:.2f}%;width:{100*(ext-v)/vmax:.2f}%"></span>'
            lab = f'{fmt(v)} <em>→ {fmt(ext)} cold</em>'
            left = 100 * ext / vmax
        else:
            lab, left = fmt(v), w
        inside = left + 2.8 * len(re.sub("<[^>]+>", "", lab)) > 100
        pos = f"right:{100-left:.2f}%" if inside else f"left:{left:.2f}%"
        h += f'<span class="bval{" in" if inside else ""}" style="{pos}">{lab}</span>'
        if base is not None:
            h += f'<i class="bbase" style="left:{100*base/vmax:.2f}%"></i>'
        return f'<span class="btrack">{h}</span>'

    out = [f'<div class="bchart {cls}"><div class="bhead"><span></span><span>{head[0]}</span><span>{head[1]}</span></div>']
    for i, r in enumerate(rows):
        f = ""
        sub = f'<small>{r["sub"]}</small>' if r.get("sub") else ""
        out.append(
            f'<div class="brow on auto" style="--d:{i*0.12:.2f}s"><span class="blab">{r["label"]}{sub}</span>'
            + track(r["t"], r.get("t_ext"), tmax, tbase, tfmt or mins, r["kind"])
            + track(r["c"], r.get("c_ext"), cmax, cbase, cfmt or usd, r["kind"])
            + "</div>"
        )
    out.append("</div>")
    return "\n".join(out)


R1 = (274.137, 0.54771)
R2 = (691.486, 0.8515143)
F1 = (414.612, 0.390560)
F2 = (523.805, 0.318282)

# Measured anchors (all realtime)
write("measured", bars([
    dict(label="Raw Pi · GPT-5.6 Sol", sub="R1", t=R1[0], c=R1[1], kind="measured", static=True),
    dict(label="Raw Pi · Kimi K3 on DW", sub="R2", t=R2[0], c=R2[1], kind="measured"),
    dict(label="Fanout · Sol plans, Terra works", sub="F1", t=F1[0], c=F1[1], kind="measured"),
    dict(label="Fanout · Kimi plans, DeepSeek works", sub="F2", t=F2[0], c=F2[1], kind="measured"),
], tmax=R2[0] * 1.35, cmax=R2[1] * 1.45, tbase=R1[0], cbase=R1[1]))

# Continuation group size
write("groups", bars([
    dict(label="Every request waits", t=1663.805, c=0.310442, c_ext=0.395725, kind="modeled", static=True),
    dict(label="Groups of 5", t=763.805, c=0.310442, c_ext=0.325944, kind="dw"),
    dict(label="Groups of 10", t=643.805, c=0.310442, c_ext=0.316046, kind="dw"),
    dict(label="Whole session", t=583.805, c=0.310442, c_ext=0.311329, kind="dw"),
], tmax=1663.805 * 1.15, cmax=0.40 * 2.3, tbase=R1[0], cls="timeonly"))

# Cost split (stacked)
def split(rows, cmax):
    out = ['<div class="bchart split"><div class="bhead"><span></span><span>Planner vs workers (estimated $)</span></div>']
    for r in rows:
        p, w = r["planner"], r["workers"]
        out.append(
            f'<div class="brow on auto"><span class="blab">{r["label"]}<small>{r["sub"]}</small></span><span class="btrack">'
            f'<span class="bfill k-measured" style="width:{100*p/cmax:.2f}%"><b>planner {usd(p)}</b></span>'
            f'<span class="bfill k-workers" style="left:{100*p/cmax:.2f}%;width:{100*w/cmax:.2f}%"></span>'
            f'<span class="bval" style="left:{100*(p+w)/cmax:.2f}%">workers {usd(w)} · total {usd(p+w)}</span></span></div>'
        )
    out.append("</div>")
    return "\n".join(out)

write("split", split([
    dict(label="F1", sub="Sol plans · Terra works", planner=0.197639, workers=0.192921),
    dict(label="F2", sub="Kimi plans · DeepSeek works", planner=0.271329, workers=0.046953),
], cmax=0.62))

# ---------- SVG line charts ----------
COL = {"Terra realtime": "#8ab4f8", "DeepSeek realtime": "#2ec4b6", "DS async every request": "#93a1a1",
       "DS async + N=10": "#e9a23b", "Combined 6-month": "#e57cd8"}
NAMES = {"Terra realtime": "Terra · realtime", "DeepSeek realtime": "DeepSeek · realtime",
         "DS async every request": "DeepSeek · async, every request", "DS async + N=10": "DeepSeek · async + groups of 10",
         "Combined 6-month": "Combined · 6 months out"}


def logy(v, lo, hi, y0, y1):
    return y1 - (math.log(v) - math.log(lo)) / (math.log(hi) - math.log(lo)) * (y1 - y0)


def panel(ox, series, key, lo, hi, ticks, title, W=700, H=560):
    x0, x1, y0, y1 = ox + 70, ox + W - 30, 50, H - 60
    xs = [1, 2, 4, 8, 16]
    X = lambda w: x0 + math.log2(w) / 4 * (x1 - x0)
    Y = lambda v: logy(v, lo, hi, y0, y1)
    g = [f'<text class="ptitle" x="{x0}" y="30">{title}</text>',
         f'<rect class="win" x="{x0}" y="{Y(1):.1f}" width="{x1-x0}" height="{y1-Y(1):.1f}"/>',
         f'<text class="wintxt" x="{x1-8}" y="{y1-10}" text-anchor="end">better than raw Sol</text>']
    for t in ticks:
        g.append(f'<line class="grid{" one" if t == 1 else ""}" x1="{x0}" x2="{x1}" y1="{Y(t):.1f}" y2="{Y(t):.1f}"/>'
                 f'<text class="tick" x="{x0-10}" y="{Y(t)+6:.1f}" text-anchor="end">{t:g}×</text>')
    for w in xs:
        g.append(f'<text class="tick" x="{X(w):.1f}" y="{y1+30}" text-anchor="middle">{w}</text>')
    g.append(f'<text class="axis" x="{(x0+x1)/2}" y="{y1+55}" text-anchor="middle">parallel parts (width)</text>')
    for i, (name, rows) in enumerate(series):
        pts = [(X(r["W"]), Y(r[key])) for r in rows]
        d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        dots = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="{COL[name]}"/>' for x, y in pts)
        g.append(f'<g class="auto" style="--d:{i*0.15:.2f}s"><path class="line" pathLength="1" d="{d}" stroke="{COL[name]}"/>{dots}</g>')
    return "\n".join(g)


series = [(c["label"], c["rows"]) for c in DATA["width"] if c["label"] in COL]
legend = "".join(
    f'<span><i style="background:{COL[n]}"></i>{NAMES[n]}</span>'
    for i, (n, _) in enumerate(series))
svg = (f'<div class="lchart"><svg viewBox="0 0 1440 600">'
       + panel(0, series, "time_ratio", 0.25, 8, [0.25, 0.5, 1, 2, 4, 8], "Time vs raw Sol")
       + panel(730, series, "cost_ratio", 0.05, 1.2, [0.05, 0.1, 0.25, 0.5, 1], "Cost vs raw Sol")
       + f'</svg><div class="legend">{legend}</div></div>')
write("width", svg)

# Reliability: linear, p on x
rel = DATA["reliability_W4"]
x0, x1, y0, y1 = 80, 860, 40, 460
X = lambda p: x0 + p / 0.5 * (x1 - x0)
Y = lambda v: y1 - v / 1.1 * (y1 - y0)
g = [f'<rect class="win" x="{x0}" y="{Y(1):.1f}" width="{x1-x0}" height="{y1-Y(1):.1f}"/>']
for t in [0, 0.25, 0.5, 0.75, 1]:
    g.append(f'<line class="grid{" one" if t == 1 else ""}" x1="{x0}" x2="{x1}" y1="{Y(t):.1f}" y2="{Y(t):.1f}"/><text class="tick" x="{x0-10}" y="{Y(t)+6:.1f}" text-anchor="end">{t:g}×</text>')
for p in [0, 0.1, 0.2, 0.3, 0.4, 0.5]:
    g.append(f'<text class="tick" x="{X(p):.1f}" y="{y1+30}" text-anchor="middle">{int(p*100)}%</text>')
g.append(f'<text class="axis" x="{(x0+x1)/2}" y="{y1+58}" text-anchor="middle">chance a unit needs a repair</text>')
for i, (key, col, name) in enumerate([("time_ratio", "#e9a23b", "time"), ("cost_ratio", "#2ec4b6", "cost")]):
    d = "M" + " L".join(f"{X(r['p']):.1f},{Y(r[key]):.1f}" for r in rel)
    last = rel[-1]
    g.append(f'<g class="auto" style="--d:{i*0.2:.2f}s"><path class="line" pathLength="1" d="{d}" stroke="{col}"/>'
             f'<text class="lab" x="{x1+12}" y="{Y(last[key])+6:.1f}" fill="{col}">{name} {last[key]:.2f}×</text>'
             f'<text class="lab" x="{x0+10}" y="{Y(rel[0][key])-14:.1f}" fill="{col}">{rel[0][key]:.2f}×</text></g>')
write("reliability", f'<div class="lchart"><svg viewBox="0 0 1000 540">{"".join(g)}</svg></div>')

# Scatter of p-map runs: recent Fanout runs in full colour, older ones faded
NAME = {"sol-terra": "Sol plans · Terra works", "kimi-deepseek": "Kimi plans · DeepSeek works",
        "glm-deepseek": "GLM plans · DeepSeek works", "raw-pi": "Raw Pi"}
CUT = "2026-09-19"
pts = [dict(t=p["active_s"], c=p["cost_usd"], f=NAME[p["setup"]], ok=p["completed"], new=p["setup"] == "raw-pi" or p["date"] >= CUT)
       for p in DATA["scatter"]]
SC = {"Sol plans · Terra works": "#8ab4f8", "Kimi plans · DeepSeek works": "#2ec4b6",
      "GLM plans · DeepSeek works": "#b39ddb", "Raw Pi": "#eee8d5"}
recent = [p for p in pts if p["new"] and p["ok"] and p["f"] != "Raw Pi"]
in_band = sum(300 <= p["t"] <= 480 for p in recent)
med = sorted(p["t"] for p in recent)[len(recent) // 2] / 60
x0, x1, y0, y1 = 90, 1340, 30, 520
tmx, cmx = 20, 2.0
X = lambda s: x0 + min(s / 60, tmx) / tmx * (x1 - x0)
Yc = lambda c: y1 - min(c, cmx) / cmx * (y1 - y0)
g = [f'<rect class="band" x="{X(300):.1f}" y="{y0}" width="{X(420)-X(300):.1f}" height="{y1-y0}"/>',
     f'<text class="bandtxt" x="{X(420)+14:.1f}" y="{y0+26}">latest Fanout runs converging on 5–7 min</text>']
for t in range(0, tmx + 1, 5):
    g.append(f'<line class="grid" x1="{X(t*60):.1f}" x2="{X(t*60):.1f}" y1="{y0}" y2="{y1}"/><text class="tick" x="{X(t*60):.1f}" y="{y1+30}" text-anchor="middle">{t}</text>')
for c in [0, 0.5, 1, 1.5, 2]:
    g.append(f'<line class="grid" x1="{x0}" x2="{x1}" y1="{Yc(c):.1f}" y2="{Yc(c):.1f}"/><text class="tick" x="{x0-10}" y="{Yc(c)+6:.1f}" text-anchor="end">${c:.1f}</text>')
g.append(f'<text class="axis" x="{(x0+x1)/2}" y="{y1+58}" text-anchor="middle">active time, minutes (planning + execution)</text>')
for p in sorted(pts, key=lambda p: p["new"]):
    x, y, col = X(p["t"]), Yc(p["c"]), SC[p["f"]]
    op = ".85" if p["new"] else ".22"
    g.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="{col}" fill-opacity="{op}"/>' if p["ok"] else
             f'<path d="M{x-6:.1f},{y-6:.1f} L{x+6:.1f},{y+6:.1f} M{x-6:.1f},{y+6:.1f} L{x+6:.1f},{y-6:.1f}" stroke="{col}" stroke-opacity="{op}" stroke-width="3"/>')
leg = "".join(f'<span><i style="background:{c}"></i>{n} ({sum(p["f"]==n for p in pts)})</span>' for n, c in SC.items())
write("scatter", f'<div class="lchart scatter"><svg viewBox="0 0 1380 600">{"".join(g)}</svg><div class="legend static">{leg}<span>× = failed · faded = before Sep 19</span></div></div>')
print(f"scatter: {len(pts)} points; recent fanout {len(recent)}, in 5-8 min {in_band}, median {med:.1f}")


# ---------- journey meter (auto-animate across slides) ----------
BT, BC = R1  # raw Sol baseline
TMAX, CMAX = 7.6, 4.2  # meter scale in × of raw Sol


# ---------- request timelines (right-hand illustration) ----------
# ---------- concept diagrams (right-hand illustration) ----------
# Vertical time runs downward. Blocks: rt = realtime request, as = async request, wait = queue wait,
# tool = local tool/test time, think = reasoning part of a response, part = unit of work.
VH, TOP = 430, 46


def col(x, w, label, segs, sub=None, clip=VH):
    g = [f'<text class="cd-h" x="{x + w/2:.0f}" y="18" text-anchor="middle">{label}</text>']
    if sub:
        g.append(f'<text class="cd-sub" x="{x + w/2:.0f}" y="36" text-anchor="middle">{sub}</text>')
    y = TOP
    for kind, h, *lab in segs:
        if y >= clip:
            break
        hh = min(h, clip - y)
        if kind == "tool":
            g.append(f'<line class="cd-tool" x1="{x + w/2:.1f}" x2="{x + w/2:.1f}" y1="{y:.1f}" y2="{y + hh:.1f}"/>')
        else:
            g.append(f'<rect class="cd-{kind}" x="{x}" y="{y:.1f}" width="{w}" height="{max(hh - 2, 1):.1f}" rx="3"/>')
            if lab:
                g.append(f'<text class="cd-in" x="{x + w/2:.0f}" y="{y + hh/2 + 5:.1f}" text-anchor="middle">{lab[0]}</text>')
        y += h
    if y > clip:
        g.append(f'<text class="cd-more" x="{x + w/2:.0f}" y="{clip + 18}" text-anchor="middle">⋯ keeps going</text>')
    return "".join(g), y


def brace(x, y0, y1, text, side="right"):
    d = 8 if side == "right" else -8
    anchor = "start" if side == "right" else "end"
    return (f'<path class="cd-brace" d="M{x},{y0} h{d} V{y1} h{-d}"/>'
            + "".join(f'<text class="cd-note" x="{x + d*1.6:.0f}" y="{(y0 + y1)/2 + 5 + (i - (len(text.split("|"))-1)/2) * 18:.0f}" text-anchor="{anchor}">{t}</text>' for i, t in enumerate(text.split("|"))))


def end_mark(x0, x1, y, text):
    return (f'<line class="cd-end" x1="{x0}" x2="{x1}" y1="{y:.1f}" y2="{y:.1f}"/>'
            f'<text class="cd-note" x="{x1 + 6}" y="{y + 5:.1f}">{text}</text>')


def diagram(parts, note, key=("rt", "as", "wait", "tool")):
    names = {"rt": "realtime request", "as": "async request", "wait": "queue wait", "tool": "tools / tests",
             "think": "reasoning tokens", "part": "unit of work"}
    svg = f'<svg viewBox="0 0 520 {VH + 30}">{"".join(parts)}</svg>'
    k = "".join(f'<span><i class="cd-k-{n}"></i>{names[n]}</span>' for n in key)
    return (f'<div class="tl"><span class="eyebrow">How it works</span>{svg}'
            f'<div class="tl-key">{k}</div><p class="tl-note">{note}</p></div>')


def loop(kind, n, h=22, t=12, wait=0):
    segs = []
    for _ in range(n):
        if wait:
            segs.append(("wait", wait))
        segs += [(kind, h), ("tool", t)]
    return segs


# 1 · raw Sol: the agent loop
c1, _ = col(60, 200, "Raw Pi · realtime", loop("rt", 11))
d1 = diagram([c1, brace(272, TOP, TOP + 34, "one turn:|request, then tools"), brace(272, TOP + 34, TOP + 34 * 11, "15 turns,|one after another")],
             "One agent, one request at a time. Each turn waits for the last one to finish.", key=("rt", "tool"))

# 2 · verbose open-weight model
c2a, ya = col(40, 170, "GPT-5.6 Sol", loop("rt", 6))
kimi = loop("rt", 3) + [("rt", 150, "7.5 min response"), ("tool", 12)] + loop("rt", 3)
c2b, yb = col(290, 170, "Kimi K3", kimi)
d2 = diagram([c2a, c2b, end_mark(40, 210, ya, "done"), end_mark(290, 460, yb, "")],
             "Same loop, but more requests and much longer ones: open-weight models reason verbosely.", key=("rt", "tool"))

# 3 · what async does
c3a, ya = col(40, 170, "Realtime", loop("rt", 6), "starts immediately")
c3b, _ = col(290, 170, "Async", loop("as", 6, wait=48), "queues first")
d3 = diagram([c3a, c3b, end_mark(40, 210, ya, "done"), brace(470, TOP, TOP + 48, "~60s", "right")],
             "Async trades a queue wait for a lower price. In an agent loop, the wait repeats before every request.")

# 4 · how Fanout changes it
c4a, _ = col(20, 150, "Raw Pi · async", loop("as", 8, h=18, t=8, wait=36))
p4, yp = col(240, 260, "Fanout", [("rt", 40, "planner · realtime")])
lanes = ""
for i, n in enumerate([4, 2, 3]):
    lg, _ = col(240 + i * 90, 80, "", [("tool", 8)] + loop("as", n, h=18, t=8, wait=36))
    lanes += lg.replace(f'y="{TOP}', f'y="{yp}', 1) if False else lg
# shift worker lanes below the planner
lanes = lanes.replace('<text class="cd-h"', '<text class="cd-h hide"')
shift = f'<g transform="translate(0,{yp - TOP + 4})">{lanes}</g>'
lane_end = yp + 4 + 8 + 4 * 62
d4 = diagram([c4a, p4, shift, end_mark(240, 500, lane_end, ""), f'<text class="cd-note" x="370" y="{lane_end + 26}" text-anchor="middle">done: waits overlap</text>'],
             "A realtime planner splits the task; cheap async workers run side by side, so their waits overlap instead of adding up.")

# 5 · fast continuations
c5a, _ = col(20, 170, "Every request queues", loop("as", 7, h=20, t=10, wait=40))
grp = [("wait", 40)] + loop("as", 7, h=20, t=10)
c5b, yb = col(260, 150, "One group", grp)
d5 = diagram([c5a, c5b, brace(418, TOP + 40, yb - 10, "no queue|in-session;|cache warm")],
             "Pay the queue once per group of up to 10 requests; the rest of the session goes straight through.")

# 6 · shallower chains = less sequential depth, same calls
deep = [("wait", 34)] + loop("as", 9, h=10, t=5) + [("wait", 34)] + loop("as", 9, h=10, t=5)
c6a, ya = col(40, 170, "Depth 19", deep, "one long chain")
halfl = [("wait", 34)] + loop("as", 10, h=10, t=5)
c6b, yb = col(270, 90, "Depth 10", halfl, "same calls, split")
c6c, _ = col(370, 90, "", [("wait", 34)] + loop("as", 9, h=10, t=5))
d6 = diagram([c6a, c6b, c6c, end_mark(40, 210, ya, ""), end_mark(270, 460, yb, "done")],
             "Same number of LLM calls, fewer in a row: the critical chain fits in one continuation group, so one wait instead of two.")

# 7 · less verbose output
def resp(think, out):
    return [("think", think), ("as", out), ("tool", 12)]
c7a, ya = col(40, 170, "Verbose", [("wait", 40)] + resp(90, 22) + resp(70, 22) + resp(60, 20))
c7b, yb = col(290, 170, "2× less output", [("wait", 40)] + resp(45, 11) + resp(35, 11) + resp(30, 10))
d7 = diagram([c7a, c7b, end_mark(40, 210, ya, ""), end_mark(290, 460, yb, "done")],
             "Half the output tokens: cheaper and shorter generation. The queue wait itself doesn't change.",
             key=("think", "as", "wait", "tool"))

# 8 · a task 4x as big: raw Sol does parts back to back, Fanout runs them at once
seq = []
for i in range(4):
    seq += [("part", 78, f"part {i+1}"), ("tool", 6)]
c8a, ya = col(20, 170, "Raw Sol", seq, "4 parts, back to back")
p8, yp = col(250, 250, "Fanout", [("rt", 70, "planner")], "4 parts at once")
par = "".join(col(250 + i * 64, 58, "", [("part", 78, str(i + 1))])[0] for i in range(4))
fan_end = yp + 6 + 78
d8 = diagram([c8a, p8, f'<g transform="translate(0,{yp - TOP + 6})">{par}</g>',
              end_mark(250, 494, fan_end, ""), f'<text class="cd-note" x="372" y="{fan_end + 24}" text-anchor="middle">done: 8.8 min</text>',
              end_mark(20, 190, ya, ""), f'<text class="cd-note" x="105" y="{ya + 24}" text-anchor="middle">done: 17.9 min</text>'],
             "Each part is as big as p-map's whole implementation. Raw Sol's time grows with the work; Fanout's stays about the same.",
             key=("rt", "part"))

TL = {1: d1, 2: d2, 3: d3, 0: d3, 4: d4, 5: d5, 6: d6, 7: d7, 8: d8}


def md_inline(t):
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    return re.sub(r"\*(.+?)\*", r"<em>\1</em>", t)


def meter_slide(title, step, t, c, kind, chips, context, c_cold=None, t_abs=None, c_abs=None, badge="modeled", tl=None, key="raw Sol (4.6 min · $0.55)"):
    tr, cr = t / BT, c / BC
    t_abs = t_abs or f"{t/60:.1f} min"
    c_abs = c_abs or usd(c)
    def row(lab, did, r, absval, maxv, cold=None):
        w = 100 * min(r, maxv) / maxv
        est = 1.8 * len(absval + " · 0.00×")
        inside = w + est > 98
        ghost_lab = ""
        if cold:
            gw = 100 * min(cold / BC, maxv) / maxv
            ghost = f'<span class="mghost" data-id="{did}-g" style="left:{w:.2f}%;width:{gw-w:.2f}%"></span>'
            cl = f"cold cache {usd(cold)}"
            start = max(gw, (w if inside else w + est) + 1)
            cin = start + 1.8 * len(cl) > 98
            cpos = f"right:{100-gw:.2f}%" if cin else f"left:{start:.2f}%"
            ghost_lab = f'<span class="mcold{" in" if cin else ""}" data-id="{did}-cv" style="{cpos}">{cl}</span>'
        else:
            ghost = f'<span class="mghost" data-id="{did}-g" style="left:{w:.2f}%;width:0%"></span>'
        return (f'<div class="mrow"><span class="mlab">{lab}</span><span class="mtrack">'
                f'<span class="mfill k-{kind}" data-id="{did}" style="width:{w:.2f}%"></span>{ghost}'
                f'<i class="mbase" style="left:{100/maxv:.2f}%"></i>'
                f'<span class="mval{" in" if inside else ""}" data-id="{did}-v" style="{f"right:{100-w:.2f}%" if inside else f"left:{w:.2f}%"}">{absval} · <strong>{r:.2f}×</strong></span>{ghost_lab}'
                f'</span></div>')
    chip_html = "".join(f'<span class="chip k2-{k}" data-id="chip-{i}">{n}</span>' for i, (n, k) in enumerate(chips))
    ctx = "".join(f"<li>{md_inline(x)}</li>" for x in context)
    return f"""## {title} {{auto-animate=true auto-animate-easing="cubic-bezier(.2,.8,.2,1)" auto-animate-duration="1.1"}}

```{{=html}}
<div class="jgrid">
<div class="journey">
<div class="jstep" data-id="jstep">Step {step} · <span class="badge b-{badge}">{badge}</span> <span class="jkey">┆ dashed line = {key}</span></div>
<div class="chips" data-id="chips">{chip_html}</div>
<div class="meter">{row("Time", "mt", tr, t_abs, TMAX)}{row("Cost", "mc", cr, c_abs, CMAX, c_cold)}</div>
<ul class="jctx">{ctx}</ul>
</div>
<div class="jside" data-id="jside">{tl or ""}</div>
</div>
```

"""


J1 = [
    ("Today: raw Pi on GPT-5.6 Sol", 1, R1[0], R1[1], "measured", [("Raw Pi · Sol", "base")],
     ["What developers use today: one agent, **15 requests in a row**, all realtime.",
      "This is the bar to beat: **4.6 min · $0.55** on the p-map task."], None, "measured"),
    ("Same agent on Doubleword realtime", 2, R2[0], R2[1], "measured", [("Raw Pi · Kimi K3 on DW", "base")],
     ["Slower **and** costlier than Sol: **22 requests**, and **68% of cost is output tokens**.",
      "Open-weight models reason verbosely: one response ran **25k tokens over 7.5 min**."], None, "measured"),
    ("Async today: every request waits", 3, 2011.486, 0.631702, "modeled", [("Raw Pi · Kimi K3 on DW", "base"), ("async", "dw")],
     ["Every one of 22 requests waits **~60s** before it starts: **33.5 min**.",
      "Only **−26% cost**, and if the cache goes cold in the queue, async costs *more* than realtime."], 1.497116, "modeled"),
]
DWC = ("Fanout · Kimi plans, DeepSeek works", "harness")
J2 = [
    ("Where we left off: raw Pi on DW async", 3, 2011.486, 0.631702, "modeled", [("Raw Pi · Kimi K3 on DW", "base"), ("async", "dw")],
     ["Same Doubleword models, same task. Now add Fanout."], 1.497116, "modeled"),
    ("Same DW models, with Fanout", 4, 1663.805, 0.310442, "harness", [DWC, ("async workers", "dw")],
     ["Kimi plans (realtime), DeepSeek workers run async: **cost halves** and time drops **33.5 → 27.7 min**.",
      "Measured on realtime: Fanout **8.7 min · $0.32** vs raw Pi **11.5 min · $0.85**.",
      "Still a wall: the critical worker makes **19 requests in a row**, each waiting ~60s."], 0.395725, "modeled"),
    ("+ Fast continuations", 5, 643.805, 0.310442, "dw",
     [DWC, ("async workers", "dw"), ("continuations · groups of 10", "dw")],
     ["**DW feature:** pay the wait once, then the next 9 requests in the session run fast.",
      "2 waits instead of 19, and the group keeps its cache warm.",
      "Billed at full realtime price, continuations would still cost only **$0.32** here (see agent-session plan)."], 0.316046, "modeled"),
    ("+ Shallower worker chains", 6, 583.805, 0.310442, "harness",
     [DWC, ("async workers", "dw"), ("continuations · groups of 10", "dw"), ("depth 19 → 10", "harness")],
     ["**Harness:** split work so fewer worker calls run *in sequence*: depth 19 → 10. Same calls, same cost.",
      "The critical chain fits in one continuation group: 1 wait instead of 2. Without continuations it would save ~9 min."], None, "modeled"),
    ("+ Less verbose models", 7, 530.656, 0.200159, "models",
     [DWC, ("async workers", "dw"), ("continuations · groups of 10", "dw"), ("depth 19 → 10", "harness"), ("2× less output", "models")],
     ["**Models / DW defaults:** half the output tokens for planner and workers: **−35% cost**.",
      "Narrow task, 6 months out: **8.8 min · $0.20**. Still ~2× slower than raw Sol, but **64% cheaper**."], None, "modeled"),
    ("+ A task 4× as big, in 4 parallel parts", 8, 530.656, 0.27667, "combined",
     [DWC, ("async workers", "dw"), ("continuations · groups of 10", "dw"), ("depth 19 → 10", "harness"), ("2× less output", "models"), ("4× task · 4 parts", "combined")],
     ["Same levers on a task 4× the size of p-map: **faster *and* cheaper** than raw Sol doing all 4 parts.",
      "Splitting p-map's own work 4 ways would only reach ~6 min: the 3-min realtime planner becomes the floor.",
      "Assumes no extra repairs. Reliability is what's left (see deep dive)."], None, "modeled"),
]
def journey(steps, name):
    out = []
    for (title, step, t, c, kind, chips, ctx, cold, badge) in steps:
        kw = {}
        if step == 8:
            kw = dict(t_abs="8.8 min vs 17.9 min", c_abs="$0.28 vs $2.19", key="raw Sol on the same 4× task (17.9 min · $2.19)")
            t, c = 530.656 / 1074.375 * BT, 0.12628479 * BC
        key = 0 if title.startswith("Where we left off") else step
        out.append(meter_slide(title, step, t, c, kind, chips, ctx, cold, badge=badge, tl=TL[key], **kw))
    (OUT / f"{name}.md").write_text("\n".join(out))

journey(J1, "journey1")
journey(J2, "journey2")
print("journey written")

# Closing recap: readout of time and cost vs raw Sol
REC = [("Raw Pi · GPT-5.6 Sol", "realtime · measured", 1.0, 1.0, "measured"),
       ("Raw Pi · DW models", "async · modeled", 2011.486 / R1[0], 0.631702 / R1[1], "modeled"),
       ("Fanout · DW + levers", "narrow task · modeled", 530.656 / R1[0], 0.200159 / R1[1], "combined"),
       ("Fanout · DW + levers", "4× task, 4 parts · modeled", 530.656 / 1074.375, 0.12628479, "combined")]
def cell(v, vmax, kind):
    w = 100 * min(v, vmax) / vmax
    good = " good" if v < 1 else (" bad" if v > 1.001 else "")
    return (f'<div class="rc"><span class="rv{good}">{v:.2f}×</span>'
            f'<span class="rbar"><span class="bfill k-{kind}" style="width:{w:.1f}%;transform:none"></span>'
            f'<i style="left:{100/vmax:.1f}%"></i></span></div>')
rows = "".join(f'<div class="rr"><div class="rl">{n}<small>{sub}</small></div>{cell(t, 7.5, k)}{cell(c, 1.6, k)}</div>'
               for n, sub, t, c, k in REC)
write("recap", f'<div class="readout"><div class="rr rh"><span></span><span>Time</span><span>Cost</span></div>{rows}</div>')

# Cover illustration: one realtime agent vs Fanout with async workers (vertical time)
ca, ya = col(10, 150, "One agent", loop("rt", 9, h=24, t=14), "realtime, in sequence")
pa, yp = col(230, 270, "Fanout", [("rt", 34, "planner")], "async workers in parallel")
lanes = "".join(col(230 + i * 94, 82, "", [("tool", 8)] + loop("as", n, h=26, t=10, wait=30))[0] for i, n in enumerate([3, 2, 3]))
lanes = lanes.replace('<text class="cd-h"', '<text class="cd-h hide"')
lane_end = yp + 4 + 8 + 3 * 66
cover = (f'<svg class="cover-art" viewBox="0 0 520 440">{ca}{pa}<g transform="translate(0,{yp - TOP + 4})">{lanes}</g>'
         f'<line class="cd-end" x1="230" x2="500" y1="{lane_end:.0f}" y2="{lane_end:.0f}"/>'
         f'<text class="cd-note" x="500" y="{lane_end + 22:.0f}" text-anchor="end">waits overlap</text></svg>')
write("cover", cover)
