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
	let remaining = TOTAL_BYTES;
	const git = (...args: string[]) => execFileSync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
	for (const { resource, tree } of requests) {
		if (seen.has(`${tree}:${resource.path}`)) continue;
		if (seen.size >= MAX_ENTRIES || remaining < 1024) {
			result.omitted.push({ path: resource.path, tree, reason: "context limit reached; remaining resources not preloaded" });
			break;
		}
		const entries = git("--literal-pathspecs", "ls-tree", "-r", "-z", tree, "--", resource.path).toString("utf8").split("\0").filter(Boolean);
		if (!entries.length) {
			seen.add(`${tree}:${resource.path}`);
			result.omitted.push({ path: resource.path, tree, reason: "absent in source tree (possibly a new endpoint)" });
		}
		for (const entry of entries) {
			if (seen.size >= MAX_ENTRIES || remaining < 1024) {
				result.omitted.push({ path: resource.path, tree, reason: "context limit reached; remaining directory entries not preloaded" });
				break;
			}
			const tab = entry.indexOf("\t");
			const [mode, type, blob] = entry.slice(0, tab).split(" ");
			const path = entry.slice(tab + 1);
			const key = `${tree}:${path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			let reason: string | undefined;
			if (type !== "blob" || mode === "120000") reason = "not a regular file";
			else {
				const size = Number(git("cat-file", "-s", blob).toString("utf8").trim());
				if (size > FILE_BYTES || size > remaining) reason = "source context byte limit";
				else {
					const bytes = git("cat-file", "blob", blob);
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
