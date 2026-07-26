export function createComparisonController({ $, api, text, receiptNode, comparisonTable, directed, getWorkspace }) {
	let serial = 0;
	const options = (picker, values, prior) => {
		picker.replaceChildren(...values.map((value) => { const option = text("option", value.label); option.value = value.id; return option; }));
		if (values.some(({ id }) => id === prior)) picker.value = prior;
		picker.disabled = !values.length;
	};
	const render = (result) => {
		const root = $("#comparison"), nodes = [];
		if (result.nodePair) {
			const item = result.nodePair, section = document.createElement("section");
			section.append(text("h4", `Cross-packet Nodes · ${item.status}`), text("p", item.reason));
			if (item.warning) section.append(text("p", item.warning));
			section.append(comparisonTable(["Raw Node total", "Run A", "Run B", "Evidence"], item.totals.map((value) => [value.label, value.runA === null ? "unknown" : `${value.runA} ${value.unit}`, value.runB === null ? "unknown" : `${value.runB} ${value.unit}`, receiptNode(value.receipt)])));
			if (item.deltas.length) section.append(comparisonTable(["Metric", "Run A", "Run B", "B − A direction", "Percent", "Evidence"], item.deltas.map((value) => [value.label, `${value.runA} ${value.unit}`, `${value.runB} ${value.unit}`, directed(value.delta, value.unit), value.percentage === null ? "unavailable" : `${value.percentage}%`, receiptNode(value.receipt)])));
			if (item.omittedMetrics.length) section.append(text("p", `Omitted metrics: ${item.omittedMetrics.join(", ")}`));
			section.append(receiptNode(item.receipt)); nodes.push(section);
		}
		if (result.pair) {
			const pair = document.createElement("section"), available = result.pair.status !== "unavailable";
			pair.append(text("h4", available ? `Exact pair${result.pair.status === "partial" ? " · Partial" : ""}` : "Pair unavailable"));
			if (available) {
				pair.append(comparisonTable(["Metric", "Run A", "Run B", "B − A direction", "Percent", "Evidence"], result.pair.deltas.map((item) => [item.label, `${item.runA} ${item.unit}`, `${item.runB} ${item.unit}`, directed(item.delta, item.unit), item.percentage === null ? "unavailable" : `${item.percentage}%`, receiptNode(item.receipt)])));
				pair.append(comparisonTable(["Catalogue field", "Run A", "Run B"], Object.keys(result.pair.catalogue.runA).map((name) => [name, JSON.stringify(result.pair.catalogue.runA[name]), JSON.stringify(result.pair.catalogue.runB[name])])));
			} else pair.append(text("p", result.pair.reason));
			if (result.pair.omittedMetrics.length) pair.append(text("p", `Omitted metrics: ${result.pair.omittedMetrics.map(({ id, reason }) => `${id} (${reason})`).join("; ")}`));
			pair.append(receiptNode(result.pair.receipt)); nodes.push(pair);
		}
		for (const cohort of result.cohorts) {
			const section = document.createElement("section");
			section.append(text("h4", `${cohort.outcome} cohort · ${cohort.count} contributors${cohort.status === "partial" ? " · Partial" : ""}`));
			if (cohort.aggregates.length) section.append(comparisonTable(["Metric", "Count", "Minimum", "Median", "Maximum", "Contributors", "Evidence"], cohort.aggregates.map((item) => [item.label, String(item.count), `${item.minimum} ${item.unit}`, `${item.median} ${item.unit}`, `${item.maximum} ${item.unit}`, item.contributors.map(({ runId, value }) => `${runId}: ${value} ${item.unit}`).join("; "), receiptNode(item.receipt)])));
			else section.append(text("p", "Aggregate unavailable because contributor values are incomplete."));
			if (cohort.omittedMetrics.length) section.append(text("p", `Omitted metrics: ${cohort.omittedMetrics.map(({ id, reason }) => `${id} (${reason})`).join("; ")}`));
			section.append(receiptNode(cohort.receipt)); nodes.push(section);
		}
		if (!nodes.length) nodes.push(text("p", "Select another run to inspect an exact pair; no same-outcome cohort has two contributors."));
		root.replaceChildren(...nodes);
	};
	return async function loadComparison() {
		const requestSerial = ++serial, workspace = getWorkspace(), projectId = workspace.projectId, selected = workspace.recentRuns.find((run) => run.selected);
		if (!selected) { $("#comparison").replaceChildren(text("p", "Comparisons require an admitted Execution Run.")); return; }
		const picker = $("#comparison-run"), nodeA = $("#comparison-node-a"), nodeB = $("#comparison-node-b"), priorRun = picker.value, priorA = nodeA.value, priorB = nodeB.value;
		options(picker, workspace.recentRuns.filter((run) => run.id !== selected.id).map((run) => ({ id: run.id, label: `${run.runId} · ${run.label}` })), priorRun);
		options(nodeA, workspace.dag.nodes.map((node) => ({ id: node.id, label: node.label })), workspace.selection.kind === "node" ? workspace.selection.id : priorA);
		let target = null;
		if (picker.value) { const response = await fetch(api("/api/workspace", { run: picker.value })); if (response.ok) target = await response.json(); }
		if (requestSerial !== serial || getWorkspace()?.projectId !== projectId) return;
		options(nodeB, target?.dag.nodes.map((node) => ({ id: node.id, label: node.label })) ?? [], priorB);
		const response = await fetch(api("/api/comparison"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runAId: selected.id, ...(picker.value ? { runBId: picker.value } : {}), ...(picker.value && nodeA.value && nodeB.value ? { nodeAId: nodeA.value, nodeBId: nodeB.value } : {}) }) });
		if (requestSerial !== serial || getWorkspace()?.projectId !== projectId) return;
		if (!response.ok) { $("#comparison").replaceChildren(text("p", `Comparison unavailable: ${(await response.json()).error}`)); return; }
		render(await response.json());
	};
}
