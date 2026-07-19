const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;
const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'";
const GET_API = new Set(["/api/catalog", "/api/workspace", "/api/evidence"]);
const POST_API = new Set(["/api/comparison", "/api/scenario", "/api/refresh"]);

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fanout run profiler</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <header><h1>Fanout run profiler</h1><p>Read-only local evidence</p></header>
  <nav aria-label="Profiler sections"><a href="#workspace">Workspace</a><a href="#evidence">Evidence</a></nav>
  <main id="workspace">
    <section aria-labelledby="workspace-heading"><h2 id="workspace-heading">Workspace</h2><p>The profiler catalog is not available yet.</p></section>
    <section id="evidence" aria-labelledby="evidence-heading"><h2 id="evidence-heading">Evidence</h2><p>Source artifacts remain read-only.</p></section>
  </main>
  <footer><button type="button" id="refresh">Refresh</button><output id="status" aria-live="polite"></output></footer>
  <script type="module" src="/assets/app.js"></script>
</body>
</html>`;

const CSS = `:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{max-width:72rem;margin:auto;padding:1rem}header,nav,main,footer{display:flex;gap:1rem;align-items:baseline}main{align-items:stretch}section{flex:1;border:1px solid;padding:1rem}footer{margin-top:1rem}@media(max-width:40rem){main{display:block}}`;
const JS = `const button=document.querySelector("#refresh"),status=document.querySelector("#status");button.addEventListener("click",async()=>{const response=await fetch("/api/refresh",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});status.value=response.ok?"Refreshed":"Refresh is not available yet"});`;

class RequestError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

function response(body: BodyInit | null, status: number, contentType: string): Response {
	return new Response(body, {
		status,
		headers: {
			"content-type": contentType,
			"content-security-policy": CONTENT_SECURITY_POLICY,
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
		},
	});
}

function json(status: number, body: unknown): Response {
	return response(JSON.stringify(body), status, "application/json; charset=utf-8");
}

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
		if (bytes > MAX_BODY_BYTES) {
			await reader.cancel();
			throw new RequestError(413, "request body is too large");
		}
		text += decoder.decode(value, { stream: true });
	}
	text += decoder.decode();
	try {
		return JSON.parse(text);
	} catch {
		throw new RequestError(400, "request body must be valid JSON");
	}
}

export function startProfilerServer(artifactRoot: string, port: number): Bun.Server<undefined> {
	const fixedArtifactRoot = artifactRoot;
	return Bun.serve({
		hostname: LOOPBACK,
		port,
		development: false,
		async fetch(request, server) {
			void fixedArtifactRoot;
			const expectedHost = `${LOOPBACK}:${server.port}`;
			if (request.headers.get("host") !== expectedHost) return json(403, { error: "unexpected-host" });
			const origin = request.headers.get("origin");
			if (origin !== null && origin !== `http://${expectedHost}`) return json(403, { error: "unexpected-origin" });

			const url = new URL(request.url);
			if (url.search) return json(400, { error: "query-parameters-not-accepted" });
			if (request.method === "GET" && url.pathname === "/") return response(HTML, 200, "text/html; charset=utf-8");
			if (request.method === "GET" && url.pathname === "/assets/app.css") return response(CSS, 200, "text/css; charset=utf-8");
			if (request.method === "GET" && url.pathname === "/assets/app.js") return response(JS, 200, "text/javascript; charset=utf-8");
			if (GET_API.has(url.pathname)) return request.method === "GET" ? json(501, { error: "not-implemented" }) : json(405, { error: "method-not-allowed" });
			if (POST_API.has(url.pathname)) {
				if (request.method !== "POST") return json(405, { error: "method-not-allowed" });
				try {
					const body = await readBody(request);
					if (containsFilesystemSelector(body)) return json(400, { error: "filesystem-selectors-not-accepted" });
				} catch (error) {
					if (error instanceof RequestError) return json(error.status, { error: error.message });
					throw error;
				}
				return json(501, { error: "not-implemented" });
			}
			return json(404, { error: "not-found" });
		},
	});
}
