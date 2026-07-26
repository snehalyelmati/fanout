import { createComparisonController } from "/assets/comparison-render.js";
import { createScenarioController } from "/assets/scenario-render.js";
import { createWorkspaceRenderer } from "/assets/workspace-render.js";
import { createInteractionState, installPaneControls, projectQuery, resetProjectState, restoreQuery, revealSelection, rowExpanded, selectionQuery, setQuery as rememberQuery, toggleRow } from "/assets/interaction.js";

const $ = (selector) => document.querySelector(selector);
for (const root of document.querySelectorAll("[data-profile]")) {
	root.append($("#provider-profile-fields").content.cloneNode(true));
	root.querySelector('[data-field="name"]').value = `${root.dataset.profile === "tier1" ? "Tier 1" : "Tier 2"} fixed assumptions`;
}

let workspace, loadSerial = 0, projectNotice = "";
const interaction = createInteractionState(location.search);
const api = (path, params = {}, scoped = true) => {
	const query = params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined));
	const project = interaction.query.get("project"); if (scoped && project) query.set("project", project);
	return `${path}${query.size ? `?${query}` : ""}`;
};
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value ?? "unknown"; if (className) node.className = className; return node; };
const currentRun = () => workspace?.recentRuns.find((run) => run.selected);
const setQuery = (next, replace = false) => { rememberQuery(interaction, next); const value = next.toString(), url = `${location.pathname}${value ? `?${value}` : ""}`; if (replace) history.replaceState(null, "", url); else history.pushState(null, "", url); };
const reveal = (selection) => revealSelection(interaction, selection, currentRun()?.id);
const select = (selection) => { reveal(selection); const next = selectionQuery(interaction, selection, selection.kind === "run" ? selection.id : currentRun()?.id); if (next.toString() !== interaction.query.toString()) setQuery(next); load(); };
const button = (label, selection, className = "", current = false) => { const node = text("button", label, className); node.type = "button"; if (current) node.setAttribute("aria-current", "true"); node.addEventListener("click", () => select(selection)); return node; };
const renderList = (selector, values, render) => $(selector).replaceChildren(...values.map(render));
const clearProjectWorkspace = (message) => {
	loadSerial++; workspace = undefined; resetProjectState(interaction); $("main").setAttribute("aria-busy", "true");
	for (const selector of ["#breadcrumbs", "#lineages", "#runs", "#dag", "#metrics", "#waterfall", "#events", "#ledger", "#diagnostics", "#comparison", "#details", "#receipt", "#routing", "#source-evidence"]) $(selector).replaceChildren();
	$("#scenario").replaceChildren(text("p", "Choose fixed assumptions and calculate scenarios for side-by-side inspection."));
	$("#objective").textContent = message; $("#source-count").textContent = "";
	for (const [selector, value] of [["#summary-run", "No run selected"], ["#summary-id", "—"], ["#summary-admission", "—"], ["#summary-generation", "—"], ["#summary-duration", "—"], ["#summary-attempts", "—"], ["#summary-events", "— events"], ["#summary-tokens", "—"], ["#summary-cost", "—"]]) $(selector).textContent = value;
};
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
const moduleDependencies = { $, api, text, receiptNode, comparisonTable, directed, getWorkspace: () => workspace };
const loadComparison = createComparisonController(moduleDependencies);
const runScenario = createScenarioController(moduleDependencies);

async function loadDiagnostics() {
	const projectId = workspace.projectId, selected = workspace.recentRuns.find((item) => item.selected), root = $("#diagnostics");
	if (!selected) { root.replaceChildren(text("p", "Diagnostic Observations require an admitted Execution Run.")); return; }
	const sort = $("#diagnostic-sort").value, response = await fetch(api("/api/diagnostics", { run: selected.id, sort }));
	if (workspace?.projectId !== projectId) return;
	if (!response.ok) { root.replaceChildren(text("p", `Diagnostics unavailable: ${(await response.json()).error}`)); return; }
	const result = await response.json(), nodes = result.observations.map((item) => { const section = document.createElement("section"); section.append(text("h4", item.title), text("p", `${item.durationMs} ms · ${item.costUsd === null ? `${item.costStatus} cost` : `$${item.costUsd}`} · frequency ${item.frequency} · ${item.occurredAt}`), receiptNode(item.receipt)); return section; });
	if (result.suppressions.length) { const details = document.createElement("details"), summary = text("summary", `Suppressed observations (${result.suppressions.length})`), list = document.createElement("ul"); for (const item of result.suppressions) list.append(text("li", `${item.subjectId}: ${item.reason}`)); details.append(summary, list); nodes.push(details); }
	if (!nodes.length) nodes.push(text("p", "No supported Diagnostic Observations.")); root.replaceChildren(...nodes);
}

const render = createWorkspaceRenderer({ $, api, text, button, renderList, receiptNode, interaction, getWorkspace: () => workspace, currentRun, select, reveal, rowExpanded, toggleRow, loadDiagnostics, loadComparison });
async function loadProjects() {
	const requested = interaction.query.get("project");
	let response = await fetch(api("/api/projects"));
	if (!response.ok && requested) {
		const failure = await response.json();
		if (failure.error === "project is not in the active storage root") { projectNotice = `Project ${requested} is no longer available`; response = await fetch(api("/api/projects", {}, false)); }
		else { $("#status").value = `Projects unavailable: ${failure.error}`; return false; }
	}
	if (!response.ok) { $("#status").value = `Projects unavailable: ${(await response.json()).error}`; return false; }
	const result = await response.json(), picker = $("#project"), selected = result.selectedProjectId;
	picker.replaceChildren(...result.projects.map((project) => { const option = text("option", `${project.id}${project.objective ? ` · ${project.objective}` : ""}`); option.value = project.id; return option; }));
	picker.disabled = !selected;
	if (!selected) { picker.append(text("option", "No Fanout projects found")); clearProjectWorkspace("No Fanout project evidence found"); $("main").removeAttribute("aria-busy"); $("#status").value = projectNotice || "No Fanout projects found"; projectNotice = ""; return false; }
	picker.value = selected;
	if (interaction.query.get("project") !== selected) setQuery(projectQuery(interaction, selected), true);
	return true;
}
async function load(fallback = false) {
	const serial = ++loadSerial, response = await fetch(api("/api/workspace", interaction.query)); if (serial !== loadSerial) return;
	if (!response.ok) { if (fallback) { const project = interaction.query.get("project"); if (project) setQuery(projectQuery(interaction, project), true); return load(); } $("main").removeAttribute("aria-busy"); $("#status").value = `Workspace unavailable: ${(await response.json()).error}`; return; }
	workspace = await response.json(); render(workspace); $("main").removeAttribute("aria-busy"); $("#status").value = projectNotice || `Catalog generation ${workspace.generation}`; projectNotice = "";
}

$("#project").addEventListener("change", (event) => { setQuery(projectQuery(interaction, event.target.value)); clearProjectWorkspace("Loading project evidence…"); load(); });
$("#sort").addEventListener("change", (event) => { const next = new URLSearchParams(interaction.query); next.set("sort", event.target.value); setQuery(next); load(); });
$("#diagnostic-sort").addEventListener("change", loadDiagnostics);
$("#scenario-mode").addEventListener("change", (event) => { $("#scenario-limit").disabled = event.target.value !== "custom"; });
$("#scenario-run").addEventListener("click", runScenario);
$("#comparison-run").addEventListener("change", loadComparison);
$("#comparison-node-a").addEventListener("change", loadComparison);
$("#comparison-node-b").addEventListener("change", loadComparison);
$("#refresh").addEventListener("click", async () => {
	const response = await fetch(api("/api/refresh"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
	if (!response.ok) { $("#status").value = `Refresh failed: ${(await response.json()).error}`; return; }
	const result = await response.json();
	if (result.disappearedProjectId) projectNotice = `Project ${result.disappearedProjectId} disappeared during refresh`;
	if (result.selectedProjectId && interaction.query.get("project") !== result.selectedProjectId) setQuery(projectQuery(interaction, result.selectedProjectId), true);
	clearProjectWorkspace("Refreshing project evidence…"); if (await loadProjects()) load(true);
});
installPaneControls(interaction, () => { const run = currentRun(); if (run && workspace?.selection.kind !== "run") select(run.selection); });
window.addEventListener("popstate", async () => { restoreQuery(interaction, location.search); clearProjectWorkspace("Loading project evidence…"); if (await loadProjects()) load(); });
if (await loadProjects()) load();
