import { createComparisonController } from "/assets/comparison-render.js";
import { createScenarioController } from "/assets/scenario-render.js";
import { createWorkspaceRenderer } from "/assets/workspace-render.js";
import { createInteractionState, installPaneControls, restoreQuery, revealSelection, rowExpanded, selectionQuery, setQuery as rememberQuery, toggleRow } from "/assets/interaction.js";

const $ = (selector) => document.querySelector(selector);
for (const root of document.querySelectorAll("[data-profile]")) {
	root.append($("#provider-profile-fields").content.cloneNode(true));
	root.querySelector('[data-field="name"]').value = `${root.dataset.profile === "tier1" ? "Tier 1" : "Tier 2"} fixed assumptions`;
}

let workspace, loadSerial = 0;
const interaction = createInteractionState(location.search);
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value ?? "unknown"; if (className) node.className = className; return node; };
const currentRun = () => workspace?.recentRuns.find((run) => run.selected);
const setQuery = (next, replace = false) => { rememberQuery(interaction, next); const value = next.toString(), url = `${location.pathname}${value ? `?${value}` : ""}`; if (replace) history.replaceState(null, "", url); else history.pushState(null, "", url); };
const reveal = (selection) => revealSelection(interaction, selection, currentRun()?.id);
const select = (selection) => { reveal(selection); const next = selectionQuery(interaction, selection, selection.kind === "run" ? selection.id : currentRun()?.id); if (next.toString() !== interaction.query.toString()) setQuery(next); load(); };
const button = (label, selection, className = "", current = false) => { const node = text("button", label, className); node.type = "button"; if (current) node.setAttribute("aria-current", "true"); node.addEventListener("click", () => select(selection)); return node; };
const renderList = (selector, values, render) => $(selector).replaceChildren(...values.map(render));
const receiptNode = (receipt) => {
	const details = document.createElement("details"), summary = text("summary", "Evidence Receipt"), dl = document.createElement("dl");
	for (const [name, value] of [["Evidence class", receipt.evidenceClass], ["Generation", receipt.artifactGeneration], ["Derivation", receipt.derivation], ["Missing inputs", receipt.missingInputs.join(", ") || "none"], ["Assumptions", receipt.assumptions.join(", ") || "none"], ["Limitations", receipt.limitations.join(", ") || "none"], ["Source References", receipt.sourceReferences.map((source) => `${source.id}: ${source.path}`).join("; ") || "none"]]) dl.append(text("dt", name), text("dd", value));
	details.append(summary, dl); return details;
};
const comparisonTable = (headers, rows) => {
	const table = document.createElement("table"), thead = document.createElement("thead"), tr = document.createElement("tr"), tbody = document.createElement("tbody");
	for (const value of headers) { const th = text("th", value); th.scope = "col"; tr.append(th); } thead.append(tr);
	for (const values of rows) { const row = document.createElement("tr"); for (const value of values) { const td = document.createElement("td"); td.append(value instanceof Node ? value : document.createTextNode(value)); row.append(td); } tbody.append(row); }
	table.append(thead, tbody); return table;
};
const directed = (value, unit) => value > 0 ? `↑ +${value} ${unit}` : value < 0 ? `↓ ${value} ${unit}` : `— 0 ${unit}`;
const moduleDependencies = { $, text, receiptNode, comparisonTable, directed, getWorkspace: () => workspace };
const loadComparison = createComparisonController(moduleDependencies);
const runScenario = createScenarioController(moduleDependencies);

async function loadDiagnostics() {
	const selected = workspace.recentRuns.find((item) => item.selected), root = $("#diagnostics");
	if (!selected) { root.replaceChildren(text("p", "Diagnostic Observations require an admitted Execution Run.")); return; }
	const sort = $("#diagnostic-sort").value, response = await fetch(`/api/diagnostics?run=${encodeURIComponent(selected.id)}&sort=${sort}`);
	if (!response.ok) { root.replaceChildren(text("p", `Diagnostics unavailable: ${(await response.json()).error}`)); return; }
	const result = await response.json(), nodes = result.observations.map((item) => { const section = document.createElement("section"); section.append(text("h4", item.title), text("p", `${item.durationMs} ms · ${item.costUsd === null ? `${item.costStatus} cost` : `$${item.costUsd}`} · frequency ${item.frequency} · ${item.occurredAt}`), receiptNode(item.receipt)); return section; });
	if (result.suppressions.length) { const details = document.createElement("details"), summary = text("summary", `Suppressed observations (${result.suppressions.length})`), list = document.createElement("ul"); for (const item of result.suppressions) list.append(text("li", `${item.subjectId}: ${item.reason}`)); details.append(summary, list); nodes.push(details); }
	if (!nodes.length) nodes.push(text("p", "No supported Diagnostic Observations.")); root.replaceChildren(...nodes);
}

const render = createWorkspaceRenderer({ $, text, button, renderList, receiptNode, interaction, getWorkspace: () => workspace, currentRun, select, reveal, rowExpanded, toggleRow, loadDiagnostics, loadComparison });
async function load(fallback = false) {
	const serial = ++loadSerial, response = await fetch(`/api/workspace?${interaction.query}`); if (serial !== loadSerial) return;
	if (!response.ok) { if (fallback) { const sort = interaction.query.get("sort"); setQuery(new URLSearchParams(sort ? { sort } : {}), true); return load(); } $("#status").value = `Workspace unavailable: ${(await response.json()).error}`; return; }
	workspace = await response.json(); render(workspace); $("#status").value = `Catalog generation ${workspace.generation}`;
}

$("#sort").addEventListener("change", (event) => { const next = new URLSearchParams(interaction.query); next.set("sort", event.target.value); setQuery(next); load(); });
$("#diagnostic-sort").addEventListener("change", loadDiagnostics);
$("#scenario-mode").addEventListener("change", (event) => { $("#scenario-limit").disabled = event.target.value !== "custom"; });
$("#scenario-run").addEventListener("click", runScenario);
$("#comparison-run").addEventListener("change", loadComparison);
$("#comparison-node-a").addEventListener("change", loadComparison);
$("#comparison-node-b").addEventListener("change", loadComparison);
$("#refresh").addEventListener("click", async () => { const response = await fetch("/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); $("#status").value = response.ok ? "Refreshed" : "Refresh failed"; if (response.ok) load(true); });
installPaneControls(interaction, () => { const run = currentRun(); if (run && workspace.selection.kind !== "run") select(run.selection); });
window.addEventListener("popstate", () => { restoreQuery(interaction, location.search); load(); });
load();
