export function createWorkspaceRenderer({ $, text, button, renderList, receiptNode, interaction, getWorkspace, currentRun, select, reveal, rowExpanded, toggleRow, loadDiagnostics, loadComparison }) {
	const rowSelection = (row) => ({ ...row.selection, ...(row.nodeId ? { nodeId: row.nodeId } : {}), ...(row.attemptId ? { attemptId: row.attemptId } : {}), ...(row.turnId ? { turnId: row.turnId } : {}) });
	const isExpanded = (row) => rowExpanded(interaction, row, currentRun()?.id);
	const renderWaterfall = () => {
		const workspace = getWorkspace(), ns = "http://www.w3.org/2000/svg", rows = workspace.waterfall, byId = new Map(rows.map((row) => [row.id, row])), max = Math.max(1, ...rows.map((row) => row.endMs ?? 0));
		const visible = (row) => { const parent = byId.get(row.parentId); return !parent || visible(parent) && (parent.kind === "run" || isExpanded(parent)); };
		renderList("#waterfall", rows.filter(visible), (row) => {
			const line = document.createElement("div"), expandable = ["node", "final-validation", "attempt", "turn"].includes(row.kind), selected = workspace.selection.kind === row.selection.kind && workspace.selection.id === row.selection.id;
			line.className = `timing-row depth-${row.depth}${selected ? " selected" : ""}`;
			if (expandable) {
				const open = isExpanded(row), toggle = text("button", open ? "▾" : "▸", "timing-toggle");
				toggle.type = "button"; toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${row.kind} ${row.operation}`);
				toggle.addEventListener("click", () => { toggleRow(interaction, row, currentRun().id); renderWaterfall(); }); line.append(toggle);
			} else line.append(text("span", "•", "timing-leaf"));
			const choose = text("button", `${selected ? "Selected · " : ""}${row.operation}`, "timing-select");
			choose.type = "button"; choose.setAttribute("aria-label", `Select ${row.kind} ${row.operation}`); choose.addEventListener("click", () => select(rowSelection(row))); line.append(choose);
			if (row.placement === "absolute") {
				const track = document.createElementNS(ns, "svg"), bar = document.createElementNS(ns, "rect");
				track.classList.add("waterfall-track"); track.setAttribute("viewBox", "0 0 100 24"); track.setAttribute("preserveAspectRatio", "none"); track.setAttribute("aria-label", `${row.startMs} to ${row.endMs} ms; duration ${row.durationMs} ms`);
				bar.classList.add("bar"); bar.setAttribute("x", 100 * row.startMs / max); bar.setAttribute("y", "3"); bar.setAttribute("width", Math.max(.5, 100 * row.durationMs / max)); bar.setAttribute("height", "16"); track.append(bar); line.append(track);
			} else line.append(text("div", `${row.durationMs ?? "unknown"} ms · absolute placement unavailable`, "unavailable"));
			return line;
		});
	};
	return function renderWorkspace(value) {
		$("#objective").textContent = value.objective ?? "No admitted objective";
		reveal(value.selection);
		renderList("#breadcrumbs", value.breadcrumbs, (item) => { const current = item.kind === value.selection.kind && item.id === value.selection.id; return button(item.label, item, `crumb${current ? " selected" : ""}`, current); });
		renderList("#lineages", value.recentLineages, (lineage) => button(`${lineage.id} · ${lineage.admission} · ${lineage.executionRunCount} runs`, lineage.selection, `run${lineage.selected ? " selected" : ""}`, lineage.selected));
		renderList("#runs", value.recentRuns, (run) => button(`${run.runId} · ${run.label} · ${run.admission}`, run.selection, `run${run.selected ? " selected" : ""}`, run.selected));
		const svg = $("#dag"), ns = "http://www.w3.org/2000/svg", defs = document.createElementNS(ns, "defs"), marker = document.createElementNS(ns, "marker"), arrow = document.createElementNS(ns, "path");
		marker.id = "dag-arrow"; for (const [name, item] of [["markerWidth", "8"], ["markerHeight", "8"], ["refX", "7"], ["refY", "4"], ["orient", "auto"]]) marker.setAttribute(name, item);
		arrow.setAttribute("d", "M0,0 L8,4 L0,8 Z"); arrow.classList.add("dag-arrow"); marker.append(arrow); defs.append(marker); svg.replaceChildren(defs);
		for (const edge of value.dag.edges) {
			const from = value.dag.nodes.find((node) => node.id === edge.from), to = value.dag.nodes.find((node) => node.id === edge.to); if (!from || !to) continue;
			const line = document.createElementNS(ns, "line"); for (const [name, item] of [["x1", from.x + 70], ["y1", from.y + 42], ["x2", to.x + 70], ["y2", to.y]]) line.setAttribute(name, item); line.setAttribute("marker-end", "url(#dag-arrow)"); line.classList.add("dag-edge"); svg.append(line);
		}
		for (const item of value.dag.nodes) {
			const group = document.createElementNS(ns, "g"), rect = document.createElementNS(ns, "rect"), label = document.createElementNS(ns, "text"), status = document.createElementNS(ns, "text");
			group.setAttribute("transform", `translate(${item.x} ${item.y})`); group.setAttribute("tabindex", "0"); group.setAttribute("role", "button"); group.setAttribute("aria-label", `${item.label}: ${item.status}`); group.setAttribute("aria-pressed", String(item.selected)); group.classList.add("dag-node"); if (item.selected) group.classList.add("selected");
			rect.setAttribute("width", "140"); rect.setAttribute("height", "42"); label.setAttribute("x", "7"); label.setAttribute("y", "18"); label.textContent = `${item.selected ? "● " : ""}${item.label}`; status.setAttribute("x", "7"); status.setAttribute("y", "34"); status.textContent = item.status;
			group.append(rect, label, status); group.addEventListener("click", () => select(item.selection)); group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(item.selection); } }); svg.append(group);
		}
		renderWaterfall();
		renderList("#events", value.events, (event) => { const current = value.selection.kind === "event" && value.selection.id === event.selection.id; return button(`#${event.sequence} ${event.event} · ${event.summary}`, event.selection, `event${current ? " selected" : ""}`, current); });
		renderList("#ledger", value.ledger, (row) => {
			const tr = document.createElement("tr");
			for (const [index, item] of [row.startMs, row.endMs, row.durationMs, row.source, row.operation, row.outcome].entries()) { const td = document.createElement("td"); if (index === 4) { const choose = text("button", String(item)); choose.type = "button"; choose.setAttribute("aria-label", `Select ${row.operation}: ${row.outcome}`); choose.addEventListener("click", () => select(rowSelection(row))); td.append(choose); } else td.textContent = item === null ? "unavailable" : String(item); tr.append(td); }
			return tr;
		});
		const metrics = text("div", "", "metrics"); for (const metric of value.metrics) { const node = text("div", "", "metric"); node.append(text("b", metric.value === null ? "unknown" : `${metric.value} ${metric.unit}`), text("small", `${metric.label} · ${metric.category} · ${metric.evidenceClass}`), receiptNode(metric.receipt)); metrics.append(node); } $("#metrics").replaceChildren(metrics);
		const dl = document.createElement("dl"); dl.append(text("dt", "Selection"), text("dd", `${value.inspector.kind}: ${value.inspector.title}`)); for (const [name, item] of value.inspector.fields) dl.append(text("dt", name), text("dd", item)); $("#details").replaceChildren(dl, ...(value.inspector.relatedSelections ?? []).map((item) => button(item.label, item.selection, "event")));
		$("#receipt").replaceChildren(receiptNode(value.inspector.receipt));
		renderList("#source-evidence", value.supportingEvidence, (item) => {
			const section = document.createElement("section"), open = text("button", `Open ${item.label}`), output = text("pre", item.reason); open.type = "button"; open.disabled = !item.source;
			open.addEventListener("click", async () => { const response = await fetch(`/api/evidence?reference=${encodeURIComponent(item.source.id)}&limit=100`); if (!response.ok) { output.textContent = `Evidence unavailable: ${(await response.json()).error}`; return; } const page = await response.json(); output.textContent = page.status === "Current" ? page.rows.join("\n") : page.status; });
			section.append(open, output); return section;
		});
		renderList("#routing", value.routing, (route) => { const node = document.createElement("p"); node.append(text("strong", "Planned routing: "), document.createTextNode(`${route.nodeId} · ${route.planned.tier} ${route.planned.provider}/${route.planned.model}; `), text("strong", "Observed Attempt routing: "), document.createTextNode(route.observed.map((item) => `${item.attemptId} · ${item.tier} ${item.provider}/${item.model}`).join(", ") || "none")); return node; });
		$("#sort").value = interaction.query.get("sort") ?? "chronological";
		loadDiagnostics(); loadComparison();
	};
}
