import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { resourceCovers, parseRepoPath, parseResource } from "../../fanout-core/src/repository-resource.ts";
import { readManifest, type WorkerValidationContext } from "./worker-validation.ts";

export const WORKER_MODEL_TOOLS = ["read", "grep", "find", "ls", "edit", "write", "fanout_validate"] as const;

export const WORKER_TRUST_BOUNDARY =
	"Local Pi workers, discovered trusted extensions, and validation programs run with the user's permissions; ignored files, external paths, network, and processes are outside Fanout containment.";

export function workerToolBlockReason(toolName: string, input: unknown, worktreeRoot: string | undefined, context?: WorkerValidationContext): string | undefined {
	if (!worktreeRoot) return undefined;
	if (!WORKER_MODEL_TOOLS.includes(toolName as (typeof WORKER_MODEL_TOOLS)[number])) {
		return `Fanout workers allow only ${WORKER_MODEL_TOOLS.join(", ")}; ${toolName} is unavailable.`;
	}
	if (toolName !== "edit" && toolName !== "write") return undefined;
	try {
		const path = guardWorkerWritePath(worktreeRoot, pathField(input));
		if (!context) throw new Error("Worker write requires a verified ownership manifest");
		if (realpathSync(resolve(worktreeRoot)) !== context.worktreeRoot) throw new Error("Worker write manifest belongs to another worktree");
		const authority = readManifest(context);
		const resource = parseResource({ kind: "file", path });
		if (authority.forbiddenWrites.some((ban) => resourceCovers(ban, resource))) throw new Error(`Worker write is forbidden by the contract: ${path}`);
		if (!authority.writeResources.some((owned) => resourceCovers(owned, resource))) throw new Error(`Worker write is outside this node's ownership: ${path}. Complete only your assigned work; other nodes own their changes.`);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export function guardWorkerWritePath(worktreeRoot: string, value: unknown): string {
	if (typeof value !== "string" || isAbsolute(value)) throw new Error("Fanout worker writes require a repository-relative path");
	const path = parseRepoPath(value);
	const root = realpathSync(resolve(worktreeRoot));
	let current = root;
	for (const segment of path.split("/")) {
		current = resolve(current, segment);
		try {
			if (lstatSync(current).isSymbolicLink()) throw new Error(`Fanout worker write crosses a symlink: ${path}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
			throw error;
		}
	}
	if (current !== root && !current.startsWith(`${root}${sep}`)) throw new Error(`Fanout worker write escapes its worktree: ${path}`);
	return path;
}

function pathField(value: unknown): unknown {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>).path : undefined;
}
