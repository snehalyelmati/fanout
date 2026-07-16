const repoPathBrand: unique symbol = Symbol("RepoPath");

export type RepoPath = string & { readonly [repoPathBrand]: true };
export type ResourceKind = "file" | "directory";
export interface Resource {
	kind: ResourceKind;
	path: RepoPath;
}

export type ReadTiming = "baseline-context" | "post-change-required";
export interface ReadDependency {
	resource: Resource;
	timing: ReadTiming;
	reason: string;
}

export interface PlannedResourceScope {
	id: string;
	writeResources: Resource[];
	readResources: Resource[];
	forbiddenWriteResources: Resource[];
	forbiddenNotes?: string[];
}

export interface GroundedResourceScope {
	sourcePlanIds: string[];
	ownedResources: Resource[];
	readDependencies: ReadDependency[];
	forbiddenWriteResources: Resource[];
	forbiddenNotes?: string[];
}

export interface ResourceAuthorityIssue {
	code: string;
	message: string;
	path?: string;
}

export interface OwnershipGroup {
	memberIndexes: number[];
	resources: Resource[];
	sourcePlanIds: string[];
}

export interface ResourceScope {
	resources: Resource[];
	sourcePlanIds: string[];
}

export interface ReadEdge {
	fromGroup: number;
	toGroup: number;
	resource: Resource;
}

export interface RepositoryAuthorityResult {
	ok: boolean;
	errors: ResourceAuthorityIssue[];
	ownershipGroups: OwnershipGroup[];
	readEdges: ReadEdge[];
	forbiddenWriteResources: Resource[];
}

export type ObservedEntryKind = "regular" | "symlink" | "gitlink";
export interface ObservedEntry {
	path: RepoPath;
	kind: ObservedEntryKind;
}
export type ObservedChange =
	| { type: "change"; entry: ObservedEntry }
	| { type: "rename" | "copy"; from: ObservedEntry; to: ObservedEntry };

export function parseRepoPath(value: unknown): RepoPath {
	if (typeof value !== "string" || value.length === 0) throw new TypeError("repository path must be a non-empty string");
	if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.startsWith("\\")) throw new TypeError("repository path must be relative");
	if (value.includes("\\")) throw new TypeError("repository path must use forward slashes");
	if (value.endsWith("/")) throw new TypeError("repository path must not have a trailing slash");
	if (/[*?\[\]{}]/u.test(value)) throw new TypeError("repository path must not contain glob syntax");
	if (/[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError("repository path must not contain controls");
	if (hasUnpairedSurrogate(value)) throw new TypeError("repository path must not contain unpaired surrogates");
	const segments = value.split("/");
	if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment === ".git" || /^\p{White_Space}|\p{White_Space}$/u.test(segment))) {
		throw new TypeError("repository path contains a prohibited segment");
	}
	return value as RepoPath;
}

export function parseResource(value: unknown): Resource {
	if (!isRecord(value) || Object.keys(value).length !== 2 || !("kind" in value) || !("path" in value)) throw new TypeError("resource must contain only kind and path");
	if (value.kind !== "file" && value.kind !== "directory") throw new TypeError("resource kind must be file or directory");
	return { kind: value.kind, path: parseRepoPath(value.path) };
}

export function resourceCovers(authority: Resource, candidate: Resource): boolean {
	if (authority.path === candidate.path) return authority.kind === candidate.kind;
	return authority.kind === "directory" && candidate.path.startsWith(`${authority.path}/`);
}

export function resourcesOverlap(left: Resource, right: Resource): boolean {
	if (left.path === right.path) return true;
	return (left.kind === "directory" && right.path.startsWith(`${left.path}/`))
		|| (right.kind === "directory" && left.path.startsWith(`${right.path}/`));
}

export function authorizeResourceForSources(resource: Resource, sourcePlanIds: readonly string[], planned: readonly PlannedResourceScope[], access: "write" | "read"): ResourceAuthorityIssue[] {
	const errors: ResourceAuthorityIssue[] = [];
	const plans = new Map(planned.map((scope) => [scope.id, scope]));
	authorizeForSources(resource, sourcePlanIds, plans, access, errors);
	return errors;
}

export function groupConnectedResourceScopes(scopes: readonly ResourceScope[]): OwnershipGroup[] {
	const groups: OwnershipGroup[] = [];
	for (const [index, scope] of scopes.entries()) {
		const matches = groups.filter((group) => group.resources.some((left) => scope.resources.some((right) => resourcesOverlap(left, right))));
		if (matches.length === 0) {
			groups.push({ memberIndexes: [index], resources: uniqueResources(scope.resources), sourcePlanIds: [...new Set(scope.sourcePlanIds)] });
			continue;
		}
		const target = matches[0];
		target.memberIndexes.push(index);
		target.resources = uniqueResources([...target.resources, ...scope.resources]);
		target.sourcePlanIds = [...new Set([...target.sourcePlanIds, ...scope.sourcePlanIds])];
		for (const extra of matches.slice(1)) {
			target.memberIndexes.push(...extra.memberIndexes);
			target.resources = uniqueResources([...target.resources, ...extra.resources]);
			target.sourcePlanIds = [...new Set([...target.sourcePlanIds, ...extra.sourcePlanIds])];
			groups.splice(groups.indexOf(extra), 1);
		}
	}
	return groups;
}

export function compileRepositoryAuthority(plannedInput: readonly PlannedResourceScope[], groundedInput: readonly GroundedResourceScope[]): RepositoryAuthorityResult {
	const errors: ResourceAuthorityIssue[] = [];
	const planned = plannedInput.map((scope, index) => admitPlannedScope(scope, index, errors));
	const grounded = groundedInput.map((scope, index) => admitGroundedScope(scope, index, errors));
	const plans = new Map<string, PlannedResourceScope>();
	for (const [index, scope] of planned.entries()) {
		if (!canonicalId(scope.id)) add(errors, "invalid-plan-id", "plan id must be a non-empty canonical string", `planned[${index}].id`);
		else if (plans.has(scope.id)) add(errors, "duplicate-plan-id", `duplicate plan id ${scope.id}`, `planned[${index}].id`);
		else plans.set(scope.id, scope);
	}

	for (const [index, scope] of grounded.entries()) {
		if (scope.sourcePlanIds.length === 0) add(errors, "missing-source-plan-id", "grounded scope must cite at least one source plan", `grounded[${index}].sourcePlanIds`);
		if (scope.ownedResources.length === 0) add(errors, "missing-owned-resource", "grounded scope must own at least one resource", `grounded[${index}].ownedResources`);
		for (const resource of scope.ownedResources) authorizeForSources(resource, scope.sourcePlanIds, plans, "write", errors, `grounded[${index}].ownedResources`);
		for (const dependency of scope.readDependencies) authorizeForSources(dependency.resource, scope.sourcePlanIds, plans, "read", errors, `grounded[${index}].readDependencies`);
	}

	for (const source of planned) for (const resource of source.writeResources) {
		const covered = grounded.some((scope) => scope.sourcePlanIds.includes(source.id) && scope.ownedResources.some((candidate) => resourceCovers(resource, candidate)));
		if (!covered) add(errors, "planned-write-not-grounded", `${show(resource)} from ${source.id} has no same-source grounding`);
	}

	const forbiddenWriteResources = uniqueResources([...planned.flatMap((scope) => scope.forbiddenWriteResources), ...grounded.flatMap((scope) => scope.forbiddenWriteResources)]);
	const ownershipGroups = groupOwnership(grounded);
	for (const group of ownershipGroups) for (const owned of group.resources) for (const forbidden of forbiddenWriteResources) {
		if (resourcesOverlap(owned, forbidden)) add(errors, "owned-forbidden-overlap", `${show(owned)} overlaps forbidden ${show(forbidden)}`);
	}

	const readEdges: ReadEdge[] = [];
	const edgeKeys = new Set<string>();
	for (const [readerIndex, group] of ownershipGroups.entries()) {
		const dependencies = group.memberIndexes.flatMap((index) => grounded[index].readDependencies);
		for (const dependency of dependencies) {
			if (dependency.timing === "baseline-context") continue;
			if (dependency.timing !== "post-change-required") {
				add(errors, "invalid-read-timing", `invalid read timing ${String(dependency.timing)}`);
				continue;
			}
			const owners = ownershipGroups.flatMap((owner, ownerIndex) => ownerIndex !== readerIndex && owner.resources.some((resource) => resourcesOverlap(resource, dependency.resource)) ? [ownerIndex] : []);
			if (owners.length === 0) add(errors, "post-change-read-ownerless", `${show(dependency.resource)} has no other ownership group`);
			for (const ownerIndex of owners) {
				const key = `${ownerIndex}\0${readerIndex}\0${resourceKey(dependency.resource)}`;
				if (!edgeKeys.has(key)) {
					edgeKeys.add(key);
					readEdges.push({ fromGroup: ownerIndex, toGroup: readerIndex, resource: dependency.resource });
				}
			}
		}
	}
	return { ok: errors.length === 0, errors, ownershipGroups, readEdges, forbiddenWriteResources };
}

export function decodeGitPathList(bytes: Uint8Array): RepoPath[] {
	if (bytes.byteLength === 0) return [];
	if (bytes[bytes.byteLength - 1] !== 0) throw new TypeError("Git path list must be NUL terminated");
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const encoder = new TextEncoder();
	const paths: RepoPath[] = [];
	let start = 0;
	for (let index = 0; index < bytes.byteLength; index++) {
		if (bytes[index] !== 0) continue;
		if (index === start) throw new TypeError("Git path list contains an empty path");
		const raw = bytes.slice(start, index);
		const decoded = decoder.decode(raw);
		const encoded = encoder.encode(decoded);
		if (!sameBytes(raw, encoded)) throw new TypeError("Git path did not round-trip as exact UTF-8");
		paths.push(parseRepoPath(decoded));
		start = index + 1;
	}
	return paths;
}

export function authorizeObservedChanges(changes: readonly ObservedChange[], ownedResources: readonly Resource[], forbiddenWriteResources: readonly Resource[]): { ok: boolean; errors: ResourceAuthorityIssue[] } {
	const errors: ResourceAuthorityIssue[] = [];
	const owned = admitResourceList(ownedResources, "ownedResources", errors);
	const forbidden = admitResourceList(forbiddenWriteResources, "forbiddenWriteResources", errors);
	for (const [index, change] of changes.entries()) {
		const entries = change?.type === "change" ? [change.entry] : change?.type === "rename" || change?.type === "copy" ? [change.from, change.to] : [];
		if (entries.length === 0) {
			add(errors, "invalid-observed-change", "observed change must be change, rename, or copy", `changes[${index}]`);
			continue;
		}
		for (const entry of entries) {
			if (!entry || !(["regular", "symlink", "gitlink"] as unknown[]).includes(entry.kind)) {
				add(errors, "invalid-observed-entry-kind", "observed entry kind must be regular, symlink, or gitlink", `changes[${index}]`);
				continue;
			}
			let path: RepoPath;
			try {
				path = parseRepoPath(entry.path);
			} catch (error) {
				add(errors, "invalid-observed-path", errorMessage(error), `changes[${index}]`);
				continue;
			}
			const identity: Resource = { kind: "file", path };
			if (!owned.some((resource) => resourceCovers(resource, identity))) add(errors, "observed-path-not-owned", `${path} is outside owned resources`, path);
			if (forbidden.some((resource) => resourceCovers(resource, identity))) add(errors, "observed-path-forbidden", `${path} is forbidden`, path);
		}
	}
	return { ok: errors.length === 0, errors };
}

function admitPlannedScope(scope: PlannedResourceScope, index: number, errors: ResourceAuthorityIssue[]): PlannedResourceScope {
	return {
		...scope,
		writeResources: admitResourceList(scope?.writeResources, `planned[${index}].writeResources`, errors),
		readResources: admitResourceList(scope?.readResources, `planned[${index}].readResources`, errors),
		forbiddenWriteResources: admitResourceList(scope?.forbiddenWriteResources, `planned[${index}].forbiddenWriteResources`, errors),
	};
}

function admitGroundedScope(scope: GroundedResourceScope, index: number, errors: ResourceAuthorityIssue[]): GroundedResourceScope {
	const dependencies: ReadDependency[] = [];
	for (const [dependencyIndex, dependency] of (Array.isArray(scope?.readDependencies) ? scope.readDependencies : []).entries()) {
		try {
			const reason = typeof dependency?.reason === "string" ? dependency.reason : "";
			if (!reason.trim()) add(errors, "missing-read-reason", "read dependency reason is required", `grounded[${index}].readDependencies[${dependencyIndex}].reason`);
			dependencies.push({ resource: parseResource(dependency?.resource), timing: dependency?.timing, reason });
		} catch (error) {
			add(errors, "invalid-resource", errorMessage(error), `grounded[${index}].readDependencies[${dependencyIndex}].resource`);
		}
	}
	return {
		...scope,
		sourcePlanIds: Array.isArray(scope?.sourcePlanIds) ? scope.sourcePlanIds : [],
		ownedResources: admitResourceList(scope?.ownedResources, `grounded[${index}].ownedResources`, errors),
		readDependencies: dependencies,
		forbiddenWriteResources: admitResourceList(scope?.forbiddenWriteResources, `grounded[${index}].forbiddenWriteResources`, errors),
	};
}

function admitResourceList(value: unknown, path: string, errors: ResourceAuthorityIssue[]): Resource[] {
	if (!Array.isArray(value)) {
		add(errors, "invalid-resource-list", "resource list must be an array", path);
		return [];
	}
	const resources: Resource[] = [];
	for (const [index, resource] of value.entries()) {
		try {
			resources.push(parseResource(resource));
		} catch (error) {
			add(errors, "invalid-resource", errorMessage(error), `${path}[${index}]`);
		}
	}
	return uniqueResources(resources);
}

function groupOwnership(scopes: GroundedResourceScope[]): OwnershipGroup[] {
	return groupConnectedResourceScopes(scopes.map((scope) => ({ resources: scope.ownedResources, sourcePlanIds: scope.sourcePlanIds })));
}

function authorizeForSources(resource: Resource, sourcePlanIds: readonly string[], plans: Map<string, PlannedResourceScope>, access: "write" | "read", errors: ResourceAuthorityIssue[], path?: string): void {
	for (const sourceId of sourcePlanIds) {
		const source = plans.get(sourceId);
		if (!source) {
			add(errors, "unknown-source-plan-id", `unknown source plan id ${sourceId}`, path);
			continue;
		}
		const authorities = access === "write" ? source.writeResources : [...source.readResources, ...source.writeResources];
		if (!authorities.some((authority) => resourceCovers(authority, resource))) add(errors, `${access}-not-authorized`, `${show(resource)} is not authorized by source ${sourceId}`, path);
	}
}

function uniqueResources(resources: readonly Resource[]): Resource[] {
	return [...new Map(resources.map((resource) => [resourceKey(resource), resource])).values()];
}

function resourceKey(resource: Resource): string {
	return `${resource.kind}\0${resource.path}`;
}

function show(resource: Resource): string {
	return `${resource.kind}:${resource.path}`;
}

function canonicalId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			if (++index >= value.length || value.charCodeAt(index) < 0xdc00 || value.charCodeAt(index) > 0xdfff) return true;
		} else if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function add(errors: ResourceAuthorityIssue[], code: string, message: string, path?: string): void {
	errors.push({ code, message, path });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
