export function createWorkspaceRenderer({ $, text, button, renderList, receiptNode, interaction, getWorkspace, currentRun, select, reveal, rowExpanded, toggleRow, loadDiagnostics, loadComparison }) {
	const rowSelection = (row) => ({ ...row.selection, ...(row.nodeId ? { nodeId: row.nodeId } : {}), ...(row.attemptId ? { attemptId: row.attemptId } : {}), ...(row.turnId ? { turnId: row.turnId } : {}) });
	const sameSelection = (left, right) => left.kind === right.kind && left.id === right.id;
	const formatDuration = (ms) => {
		if (ms === null || ms === undefined) return "—";
		if (ms < 1000) return `${Math.round(ms)}ms`;
		if (ms < 60_000) return `${Number((ms / 1000).toFixed(ms < 10_000 ? 3 : 1))}s`;
		return `${Math.floor(ms / 60_000)}m ${Math.round(ms % 60_000 / 1000)}s`;
	};
	const tone = (outcome = "") => /fail|error|reject|abort|conflict/i.test(outcome) ? "failure" : /repair|retry|fallback/i.test(outcome) ? "repair" : /pending|incomplete|unknown|unavailable/i.test(outcome) ? "" : /pass|success|complete|accept|applied/i.test(outcome) ? "success" : "";
	const metric = (workspace, id) => workspace.metrics.find((item) => item.id === id)?.value ?? null;
	const isExpanded = (row) => rowExpanded(interaction, row, currentRun()?.id);

	const renderSummary = (workspace) => {
		const run = currentRun(), runRow = workspace.waterfall.find((row) => row.kind === "run"), selectedRow = workspace.waterfall.find((row) => sameSelection(row.selection, workspace.selection)), attempts = workspace.waterfall.filter((row) => row.kind === "attempt").length;
		$("#summary-run").textContent = run ? `${run.label} · ${workspace.inspector.kind}` : "Planning evidence";
		$("#summary-id").textContent = run?.runId ?? workspace.inspector.title;
		$("#summary-admission").textContent = run?.admission ?? workspace.inspector.fields.find(([name]) => name === "Admission")?.[1] ?? "—";
		$("#summary-generation").textContent = workspace.inspector.receipt.artifactGeneration;
		$("#summary-duration").textContent = formatDuration(metric(workspace, "run-duration") ?? runRow?.durationMs ?? selectedRow?.durationMs);
		$("#summary-attempts").textContent = attempts || "—";
		$("#summary-events").textContent = `${workspace.events.length} events`;
		const tokens = metric(workspace, "tokens"), cost = metric(workspace, "cost");
		$("#summary-tokens").textContent = tokens === null ? "—" : tokens.toLocaleString();
		$("#summary-cost").textContent = cost === null ? "—" : `$${Number(cost).toFixed(4)}`;
	};

	const renderWaterfall = () => {
		const workspace = getWorkspace(), root = $("#waterfall"), rows = workspace.waterfall, run = currentRun();
		if (!rows.length) {
			const legacy = run?.admission === "Legacy";
			root.replaceChildren(text("p", legacy ? "This Execution Run belongs to a Legacy evidence generation. Its topology and source files remain inspectable, but current timing, metrics, Events, and replay state are intentionally unavailable." : "No run-relative timing evidence is available for this selection.", "empty-state"));
			$("#trace-note").textContent = legacy ? "Legacy evidence is descriptive only." : "Timing unavailable.";
			return;
		}
		const byId = new Map(rows.map((row) => [row.id, row])), max = Math.max(1, ...rows.map((row) => row.endMs ?? 0));
		const visible = (row) => { const parent = byId.get(row.parentId); return !parent || visible(parent) && (parent.kind === "run" || isExpanded(parent)); };
		const selectedRow = rows.find((row) => sameSelection(row.selection, workspace.selection));
		const axis = text("div", "", "trace-axis"), axisLabel = text("div", "Relative run time", "axis-label"), track = text("div", "", "trace-track axis-track");
		for (let index = 0; index <= 8; index++) { const tick = text("span", formatDuration(max * index / 8), "tick"); tick.style.left = `${index * 12.5}%`; track.append(tick); }
		if (selectedRow?.placement === "absolute") {
			const left = 100 * selectedRow.startMs / max, width = Math.max(.3, 100 * selectedRow.durationMs / max), range = text("span", "", "selection-range"), label = text("span", `Start ${formatDuration(selectedRow.startMs)} · End ${formatDuration(selectedRow.endMs)} · Duration ${formatDuration(selectedRow.durationMs)}`, `selection-label${left > 68 ? " align-end" : ""}`);
			range.style.left = `${left}%`; range.style.width = `${width}%`; label.style.left = `${left}%`; track.append(range, label);
		}
		axis.append(axisLabel, track);
		const lines = rows.filter(visible).map((row) => {
			const line = text("div", "", `timing-row${sameSelection(row.selection, workspace.selection) ? " selected" : ""}`), label = text("div", "", "timing-label"), expandable = ["node", "final-validation", "attempt", "turn"].includes(row.kind), state = text("span", "", `state-dot ${tone(row.outcome)}`);
			label.style.setProperty("--depth", String(row.depth));
			if (expandable) {
				const open = isExpanded(row), toggle = text("button", open ? "⌄" : "›", "timing-toggle");
				toggle.type = "button"; toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${row.kind} ${row.operation}`);
				toggle.addEventListener("click", () => { toggleRow(interaction, row, currentRun().id); renderWaterfall(); }); label.append(toggle);
			} else label.append(text("span", "", "timing-leaf"));
			const choose = text("button", "", "timing-select"); choose.type = "button"; choose.setAttribute("aria-label", `Select ${row.kind} ${row.operation}`); choose.append(document.createTextNode(row.operation), text("small", `${row.kind} · ${row.outcome}`)); choose.addEventListener("click", () => select(rowSelection(row))); label.append(choose, state);
			const rowTrack = text("div", "", "trace-track");
			if (row.placement === "absolute") {
				const bar = text("button", row.operation, `timeline-bar ${tone(row.outcome)}${sameSelection(row.selection, workspace.selection) ? " selected" : ""}`); bar.type = "button"; bar.style.left = `${100 * row.startMs / max}%`; bar.style.width = `${Math.max(.45, 100 * row.durationMs / max)}%`; bar.title = `${formatDuration(row.startMs)} to ${formatDuration(row.endMs)} · ${formatDuration(row.durationMs)}`; bar.addEventListener("click", () => select(rowSelection(row))); rowTrack.append(bar);
			} else rowTrack.append(text("span", `${formatDuration(row.durationMs)} measured · absolute placement unavailable`, "unavailable"));
			line.append(label, rowTrack); return line;
		});
		root.replaceChildren(axis, ...lines); $("#trace-note").textContent = `${rows.length} evidence rows · selected range on ruler`;
	};

	return function renderWorkspace(value) {
		$("#objective").textContent = value.objective ?? "No admitted objective";
		reveal(value.selection); renderSummary(value);
		renderList("#breadcrumbs", value.breadcrumbs, (item) => { const current = sameSelection(item, value.selection); return button(item.label, item, `crumb${current ? " selected" : ""}`, current); });
		renderList("#lineages", value.recentLineages, (lineage) => button(`${lineage.id} · ${lineage.admission} · ${lineage.executionRunCount} runs`, lineage.selection, `run${lineage.selected ? " selected" : ""}`, lineage.selected));
		renderList("#runs", value.recentRuns, (run) => button(`${run.runId} · ${run.label} · ${run.admission}`, run.selection, `run${run.selected ? " selected" : ""}`, run.selected));

		const svg = $("#dag"), ns = "http://www.w3.org/2000/svg", defs = document.createElementNS(ns, "defs"), marker = document.createElementNS(ns, "marker"), arrow = document.createElementNS(ns, "path"), maxX = Math.max(260, ...value.dag.nodes.map((node) => node.x + 165)), maxY = Math.max(260, ...value.dag.nodes.map((node) => node.y + 70));
		svg.setAttribute("viewBox", `0 0 ${maxX} ${maxY}`); svg.style.width = `${maxX}px`; svg.style.height = `${maxY}px`; marker.id = "dag-arrow"; for (const [name, item] of [["markerWidth", "8"], ["markerHeight", "8"], ["refX", "7"], ["refY", "4"], ["orient", "auto"]]) marker.setAttribute(name, item);
		arrow.setAttribute("d", "M0,0 L8,4 L0,8 Z"); arrow.classList.add("dag-arrow"); marker.append(arrow); defs.append(marker); svg.replaceChildren(defs);
		for (const edge of value.dag.edges) {
			const from = value.dag.nodes.find((node) => node.id === edge.from), to = value.dag.nodes.find((node) => node.id === edge.to); if (!from || !to) continue;
			const line = document.createElementNS(ns, "line"); for (const [name, item] of [["x1", from.x + 70], ["y1", from.y + 42], ["x2", to.x + 70], ["y2", to.y]]) line.setAttribute(name, item); line.setAttribute("marker-end", "url(#dag-arrow)"); line.classList.add("dag-edge"); svg.append(line);
		}
		for (const item of value.dag.nodes) {
			const group = document.createElementNS(ns, "g"), rect = document.createElementNS(ns, "rect"), label = document.createElementNS(ns, "text"), status = document.createElementNS(ns, "text");
			group.setAttribute("transform", `translate(${item.x} ${item.y})`); group.setAttribute("tabindex", "0"); group.setAttribute("role", "button"); group.setAttribute("aria-label", `${item.label}: ${item.status}`); group.setAttribute("aria-pressed", String(item.selected)); group.classList.add("dag-node"); if (item.selected) group.classList.add("selected");
			rect.setAttribute("width", "140"); rect.setAttribute("height", "42"); label.setAttribute("x", "7"); label.setAttribute("y", "17"); label.textContent = `${item.selected ? "● " : ""}${item.label.length > 20 ? `${item.label.slice(0, 19)}…` : item.label}`; status.setAttribute("x", "7"); status.setAttribute("y", "33"); status.classList.add("dag-status"); status.textContent = item.status;
			group.append(rect, label, status); group.addEventListener("click", () => select(item.selection)); group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(item.selection); } }); svg.append(group);
		}

		renderWaterfall();
		renderList("#events", value.events, (event) => { const current = value.selection.kind === "event" && value.selection.id === event.selection.id, node = text("button", "", `event${current ? " selected" : ""}`); node.type = "button"; if (current) node.setAttribute("aria-current", "true"); node.append(text("span", `#${event.sequence}`, "mono"), text("span", `${event.event} · ${event.summary}`)); node.addEventListener("click", () => select(event.selection)); return node; });
		renderList("#ledger", value.ledger, (row) => {
			const tr = document.createElement("tr");
			for (const [index, item] of [row.startMs, row.endMs, row.durationMs, row.source, row.operation, row.outcome].entries()) { const td = document.createElement("td"); if (index === 4) { const choose = text("button", String(item)); choose.type = "button"; choose.setAttribute("aria-label", `Select ${row.operation}: ${row.outcome}`); choose.addEventListener("click", () => select(rowSelection(row))); td.append(choose); } else td.textContent = item === null ? "unavailable" : String(item); tr.append(td); } return tr;
		});
		const metrics = text("div", "", "metrics"); for (const item of value.metrics) { const node = text("div", "", "metric"); node.append(text("b", item.value === null ? "unknown" : `${item.value} ${item.unit}`), text("small", `${item.label} · ${item.category} · ${item.evidenceClass}`), receiptNode(item.receipt)); metrics.append(node); } $("#metrics").replaceChildren(metrics);

		const dl = document.createElement("dl"); dl.append(text("dt", "Selection"), text("dd", `${value.inspector.kind}: ${value.inspector.title}`)); for (const [name, item] of value.inspector.fields) dl.append(text("dt", name), text("dd", item)); $("#details").replaceChildren(dl, ...(value.inspector.relatedSelections ?? []).map((item) => button(item.label, item.selection, "event")));
		$("#receipt").replaceChildren(receiptNode(value.inspector.receipt)); $("#source-count").textContent = `(${value.supportingEvidence.length})`;
		renderList("#source-evidence", value.supportingEvidence, (item) => { const section = document.createElement("section"), open = text("button", `Open ${item.label}`), output = text("pre", item.reason); open.type = "button"; open.disabled = !item.source; open.addEventListener("click", async () => { const response = await fetch(`/api/evidence?reference=${encodeURIComponent(item.source.id)}&limit=100`); if (!response.ok) { output.textContent = `Evidence unavailable: ${(await response.json()).error}`; return; } const page = await response.json(); output.textContent = page.status === "Current" ? page.rows.join("\n") : page.status; }); section.append(open, output); return section; });
		renderList("#routing", value.routing, (route) => { const node = document.createElement("p"); node.append(text("strong", "Planned routing: "), document.createTextNode(`${route.nodeId} · ${route.planned.tier} ${route.planned.provider}/${route.planned.model}; `), text("strong", "Observed Attempt routing: "), document.createTextNode(route.observed.map((item) => `${item.attemptId} · ${item.tier} ${item.provider}/${item.model}`).join(", ") || "none")); return node; });
		$("#sort").value = interaction.query.get("sort") ?? "chronological"; loadDiagnostics(); loadComparison();
	};
}
