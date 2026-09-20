import { execFileSync } from "node:child_process";
import { contractWriteResources, type WorkContract } from "../../fanout-core/src/work-contract.ts";
import { fullGitVisibleTree } from "./repository-identity.ts";

export interface WorkerSourceContext {
	baselineTree: string;
	currentTree: string;
	files: Array<{ path: string; tree: string; blob: string; text: string }>;
	omitted: Array<{ path: string; tree: string; reason: string }>;
}

// ponytail: fixed prompt ceiling; tune from measured context misses before adding ranking.
const FILE_BYTES = 64 * 1024;
const TOTAL_BYTES = 192 * 1024;
const MAX_ENTRIES = 128;

export function buildWorkerSourceContext(cwd: string, baselineTree: string, contract: WorkContract): WorkerSourceContext {
	const currentTree = fullGitVisibleTree(cwd);
	const requests = [
		...contractWriteResources(contract).map((resource) => ({ resource, tree: currentTree })),
		...contract.readDependencies.map((read) => ({ resource: read.resource, tree: read.timing === "baseline-context" ? baselineTree : currentTree })),
	];
	const result: WorkerSourceContext = { baselineTree, currentTree, files: [], omitted: [] };
	const seen = new Set<string>();
	const blobs = new Map<string, Buffer>();
	const metadata = new Map<string, Array<{ mode: string; type: string; blob: string; size: number; path: string }>>();
	let remaining = TOTAL_BYTES;
	const git = (...args: string[]) => execFileSync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
	for (const [requestIndex, { resource, tree }] of requests.entries()) {
		if (seen.has(`${tree}:${resource.path}`)) continue;
		if (seen.size >= MAX_ENTRIES || remaining < 1024) {
			result.omitted.push({ path: resource.path, tree, reason: "context limit reached; remaining resources not preloaded" });
			break;
		}
		// ls-tree includes sizes, avoiding one metadata subprocess per file. NUL
		// delimiters preserve filenames containing tabs, newlines, or quotes.
		if (!metadata.has(`${tree}:${resource.path}`)) {
			const paths = [...new Set(requests.slice(requestIndex, requestIndex + 32).filter((request) => request.tree === tree).map((request) => request.resource.path))];
			const batch = git("--literal-pathspecs", "ls-tree", "-r", "-l", "-z", tree, "--", ...paths).toString("utf8").split("\0").filter(Boolean).map((entry) => {
				const tab = entry.indexOf("\t");
				const [mode, type, blob, size] = entry.slice(0, tab).trim().split(/\s+/);
				return { mode, type, blob, size: Number(size), path: entry.slice(tab + 1) };
			});
			for (const path of paths) {
				const prefix = path.replace(/\/$/, "");
				metadata.set(`${tree}:${path}`, batch.filter((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`)));
			}
		}
		const entries = metadata.get(`${tree}:${resource.path}`)!;
		if (!entries.length) {
			seen.add(`${tree}:${resource.path}`);
			result.omitted.push({ path: resource.path, tree, reason: "absent in source tree (possibly a new endpoint)" });
		}
		for (const [index, entry] of entries.entries()) {
			if (seen.size >= MAX_ENTRIES || remaining < 1024) {
				result.omitted.push({ path: resource.path, tree, reason: "context limit reached; remaining directory entries not preloaded" });
				break;
			}
			const { mode, type, blob, size, path } = entry;
			const key = `${tree}:${path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			let reason: string | undefined;
			if (type !== "blob" || mode === "120000") reason = "not a regular file";
			else {
				if (size > FILE_BYTES || size > remaining) reason = "source context byte limit";
				else {
					if (!blobs.has(blob)) {
						const upcoming = [...entries.slice(index, index + 16), ...requests.slice(requestIndex + 1, requestIndex + 32).flatMap((request) => metadata.get(`${request.tree}:${request.resource.path}`)?.slice(0, 16) ?? [])];
						const batch = [...new Map(upcoming.slice(0, Math.min(16, MAX_ENTRIES - seen.size + 1))
							.filter((item) => item.type === "blob" && item.mode !== "120000" && item.size <= FILE_BYTES && item.size <= remaining && !blobs.has(item.blob))
							.map((item) => [item.blob, item])).values()];
						const output = execFileSync("git", ["cat-file", "--batch"], { cwd, input: batch.map((item) => item.blob).join("\n") + "\n", maxBuffer: 16 * (FILE_BYTES + 128) });
						let offset = 0;
						for (const item of batch) {
							const end = output.indexOf(10, offset);
							if (end < 0 || output.subarray(offset, end).toString("ascii") !== `${item.blob} blob ${item.size}`) throw new Error("unexpected Git blob batch header");
							offset = end + 1;
							if (output[offset + item.size] !== 10) throw new Error("incomplete Git blob batch content");
							blobs.set(item.blob, Buffer.from(output.subarray(offset, offset + item.size)));
							offset += item.size + 1;
						}
					}
					const bytes = blobs.get(blob)!;
					try {
						if (bytes.includes(0)) throw new Error("binary");
						const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
						const file = { path, tree, blob, text };
						const promptBytes = Buffer.byteLength(JSON.stringify(file, null, 2));
						if (promptBytes > remaining) reason = "source context byte limit";
						else { result.files.push(file); remaining -= promptBytes; }
					} catch { reason = "binary or invalid UTF-8"; }
				}
			}
			if (reason) result.omitted.push({ path, tree, reason });
		}
	}
	return result;
}
