import { ProfilerCatalog } from "./catalog";
import { queryWorkspace, type SelectionKind, type WorkspaceRequest } from "./workspace";

const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;
const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'";
const POST_API = new Set(["/api/comparison", "/api/scenario", "/api/refresh"]);
const SELECTION_KINDS = new Set<SelectionKind>(["run", "node", "attempt", "turn", "tool", "event", "stage"]);
const ASSETS = new Map([
	["/", ["app.html", "text/html; charset=utf-8"]],
	["/assets/app.css", ["app.css", "text/css; charset=utf-8"]],
	["/assets/app.js", ["app.js", "text/javascript; charset=utf-8"]],
] as const);

class RequestError extends Error {
	constructor(readonly status: number, message: string) { super(message); }
}

function response(body: BodyInit | Bun.BunFile | null, status: number, contentType: string): Response {
	return new Response(body, { status, headers: { "content-type": contentType, "content-security-policy": CONTENT_SECURITY_POLICY, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}

function json(status: number, body: unknown): Response { return response(JSON.stringify(body), status, "application/json; charset=utf-8"); }

function containsFilesystemSelector(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsFilesystemSelector);
	if (!value || typeof value !== "object") return false;
	return Object.entries(value).some(([key, child]) => /^(?:path|root|artifactRoot|file|filename)$/.test(key) || containsFilesystemSelector(child));
}

async function readBody(request: Request): Promise<unknown> {
	if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new RequestError(415, "application/json is required");
	const declaredLength = request.headers.get("content-length");
	if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) throw new RequestError(413, "request body is too large");
	let bytes = 0;
	let text = "";
	const decoder = new TextDecoder();
	const reader = request.body?.getReader();
	if (!reader) throw new RequestError(400, "JSON body is required");
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new RequestError(413, "request body is too large"); }
		text += decoder.decode(value, { stream: true });
	}
	try { return JSON.parse(text + decoder.decode()); }
	catch { throw new RequestError(400, "request body must be valid JSON"); }
}

function exactQuery(url: URL, allowed: readonly string[]): void {
	for (const key of url.searchParams.keys()) if (!allowed.includes(key)) throw new RequestError(400, "query parameter is not accepted");
	for (const key of allowed) if (url.searchParams.getAll(key).length > 1) throw new RequestError(400, "query parameter must be unique");
}

function workspaceRequest(url: URL): WorkspaceRequest {
	exactQuery(url, ["run", "kind", "id", "node", "attempt", "turn", "sort"]);
	const kind = url.searchParams.get("kind");
	const id = url.searchParams.get("id");
	if ((kind === null) !== (id === null) || kind !== null && !SELECTION_KINDS.has(kind as SelectionKind)) throw new RequestError(400, "selection kind and id must name one supported selection");
	const sort = url.searchParams.get("sort");
	if (sort !== null && sort !== "chronological" && sort !== "duration") throw new RequestError(400, "sort must be chronological or duration");
	return {
		...(url.searchParams.get("run") ? { runId: url.searchParams.get("run")! } : {}),
		...(kind && id ? { selection: { kind: kind as SelectionKind, id, ...(url.searchParams.get("node") ? { nodeId: url.searchParams.get("node")! } : {}), ...(url.searchParams.get("attempt") ? { attemptId: url.searchParams.get("attempt")! } : {}), ...(url.searchParams.get("turn") ? { turnId: url.searchParams.get("turn")! } : {}) } } : {}),
		...(sort ? { sort } : {}),
	};
}

export function startProfilerServer(artifactRoot: string, port: number): Bun.Server<undefined> {
	const catalog = new ProfilerCatalog(artifactRoot);
	return Bun.serve({
		hostname: LOOPBACK,
		port,
		development: false,
		async fetch(request, server) {
			const expectedHost = `${LOOPBACK}:${server.port}`;
			if (request.headers.get("host") !== expectedHost) return json(403, { error: "unexpected-host" });
			const origin = request.headers.get("origin");
			if (origin !== null && origin !== `http://${expectedHost}`) return json(403, { error: "unexpected-origin" });
			const url = new URL(request.url);
			try {
				const asset = ASSETS.get(url.pathname as keyof typeof ASSETS);
				if (asset) {
					if (request.method !== "GET" || url.search) return json(request.method === "GET" ? 400 : 405, { error: request.method === "GET" ? "query-parameters-not-accepted" : "method-not-allowed" });
					return response(Bun.file(`${import.meta.dir}/${asset[0]}`), 200, asset[1]);
				}
				if (url.pathname === "/api/catalog") {
					if (request.method !== "GET") return json(405, { error: "method-not-allowed" });
					exactQuery(url, []);
					const snapshot = catalog.snapshot();
					return json(200, { generation: snapshot.generation, refreshedAt: snapshot.refreshedAt, selectedExecutionRunId: snapshot.selectedExecutionRunId, recentRuns: snapshot.executionRuns.map((run) => ({ id: run.selectionId, runId: run.id, admission: run.admission, label: run.label, updatedAt: run.updatedAt })) });
				}
				if (url.pathname === "/api/workspace") {
					if (request.method !== "GET") return json(405, { error: "method-not-allowed" });
					return json(200, queryWorkspace(catalog.snapshot(), workspaceRequest(url)));
				}
				if (url.pathname === "/api/evidence") {
					if (request.method !== "GET") return json(405, { error: "method-not-allowed" });
					exactQuery(url, ["reference", "offset", "limit"]);
					const reference = url.searchParams.get("reference");
					if (!reference) throw new RequestError(400, "active Source Reference is required");
					const integer = (name: "offset" | "limit") => { const value = url.searchParams.get(name); if (value === null) return undefined; if (!/^\d+$/.test(value)) throw new RequestError(400, `${name} must be a non-negative integer`); return Number(value); };
					return json(200, await catalog.readEvidencePage(reference, { offset: integer("offset"), limit: integer("limit") }));
				}
				if (POST_API.has(url.pathname)) {
					if (request.method !== "POST") return json(405, { error: "method-not-allowed" });
					exactQuery(url, []);
					const body = await readBody(request);
					if (containsFilesystemSelector(body)) throw new RequestError(400, "filesystem-selectors-not-accepted");
					if (url.pathname !== "/api/refresh") return json(501, { error: "not-implemented" });
					if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new RequestError(400, "refresh accepts only an empty object");
					const snapshot = await catalog.refresh();
					return json(200, { generation: snapshot.generation, refreshedAt: snapshot.refreshedAt, selectedExecutionRunId: snapshot.selectedExecutionRunId });
				}
				return json(404, { error: "not-found" });
			} catch (error) {
				if (error instanceof RequestError || error instanceof TypeError) return json(error instanceof RequestError ? error.status : 400, { error: error.message });
				throw error;
			}
		},
	});
}
