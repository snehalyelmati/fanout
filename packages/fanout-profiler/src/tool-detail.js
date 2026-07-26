const PAGE_LIMIT = 500;
const PAGE_CAP = 4;
const clipped = (value, limit = 52) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
const string = (value) => typeof value === "string" && value ? value : null;

export function summarizeToolCall(call) {
	if (!call || typeof call !== "object") return null;
	const name = string(call.name), args = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments : {};
	const path = string(args.path), pattern = string(args.pattern);
	if (name === "grep" && pattern) return `${`“${clipped(pattern)}”`}${path ? ` in ${path}` : ""}`;
	if (name === "find" && pattern) return `${clipped(pattern)}${path ? ` under ${path}` : ""}`;
	if (["read", "write", "edit", "ls"].includes(name) && path) return path;
	return path ?? (pattern ? clipped(pattern) : null);
}

export function extractToolDetails(lines) {
	const details = new Map();
	for (const line of lines) {
		let record; try { record = JSON.parse(line); } catch { continue; }
		const content = record?.message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block?.type !== "toolCall" || typeof block.id !== "string") continue;
			const summary = summarizeToolCall(block); if (summary) details.set(block.id, summary);
		}
	}
	return details;
}

export function createToolDetailLoader(api, fetcher = fetch) {
	const details = new Map(), loads = new Map();
	const runId = (workspace) => workspace.recentRuns.find(({ selected }) => selected)?.id ?? workspace.selection.id;
	const key = (workspace, toolId) => `${workspace.projectId}|${runId(workspace)}|${toolId}`;
	const nodeKey = (workspace, nodeId) => `${workspace.projectId}|${runId(workspace)}|${nodeId}`;
	const get = (workspace, row) => details.get(key(workspace, row.selection.id)) ?? null;
	const loadSource = async (workspace, source) => {
		try {
			let offset = 0;
			for (let pageNumber = 0; pageNumber < PAGE_CAP; pageNumber++) {
				const response = await fetcher(api("/api/evidence", { reference: source.id, offset, limit: PAGE_LIMIT }));
				if (!response.ok) return false;
				const page = await response.json();
				if (page.status !== "Current") return false;
				for (const [toolId, summary] of extractToolDetails(page.rows)) details.set(key(workspace, toolId), summary);
				if (page.nextOffset === null) return true;
				offset = page.nextOffset;
			}
		} catch { return false; }
		return true;
	};
	const loadNode = (workspace, nodeId) => {
		const id = nodeKey(workspace, nodeId);
		if (!loads.has(id)) {
			const workerPrefix = nodeId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "node";
			const sources = workspace.supportingEvidence.filter((item) => item.source && item.label.startsWith("session/") && (item.source.path.includes(`/workers/${workerPrefix}/`) || item.source.path.includes(`/workers/${workerPrefix}-`))).map(({ source }) => source);
			loads.set(id, Promise.all(sources.map((source) => loadSource(workspace, source))));
		}
		return loads.get(id);
	};
	return {
		get,
		async load(workspace, rows) {
			const tools = rows.filter(({ kind }) => kind === "tool"), before = tools.filter((row) => get(workspace, row)).length;
			await Promise.all([...new Set(tools.map(({ nodeId }) => nodeId).filter(Boolean))].map((nodeId) => loadNode(workspace, nodeId)));
			return tools.filter((row) => get(workspace, row)).length > before;
		},
	};
}
