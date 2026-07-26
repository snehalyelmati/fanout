import { basename, join } from "node:path";
import { ProfilerCatalog, type CatalogSnapshot } from "./catalog";
import { assertRoot, canonicalRoot, ReferenceIssuer, rootIdentity, type RootIdentity } from "./catalog-source";

declare const projectIdBrand: unique symbol;
export type ProjectId = string & { readonly [projectIdBrand]: true };

export interface ProfilerProject {
	readonly id: ProjectId;
	readonly objective: string | null;
	readonly planningRuns: number;
	readonly executionRuns: number;
	readonly updatedAt: string | null;
}

export interface ProjectSelection {
	readonly project: ProfilerProject;
	readonly catalog: ProfilerCatalog;
}

export interface ProjectRefresh {
	readonly selection: ProjectSelection | null;
	readonly projects: readonly ProfilerProject[];
	readonly selectedProjectId: ProjectId | null;
	readonly disappearedProjectId: string | null;
}

type RegistryOptions =
	| { artifactRoot: string }
	| { storageRoot: string; preferredProjectId?: string };

interface Discovery { catalogs: Map<ProjectId, ProfilerCatalog>; projects: ProfilerProject[] }

export class ProjectRegistry {
	readonly #root: string;
	readonly #rootIdentity: RootIdentity;
	readonly #singleProjectId: ProjectId | null;
	readonly #preferredProjectId: string | null;
	#catalogs = new Map<ProjectId, ProfilerCatalog>();
	#projects: readonly ProfilerProject[] = [];
	#refreshTail: Promise<void> = Promise.resolve();

	constructor(options: RegistryOptions) {
		this.#root = canonicalRoot("artifactRoot" in options ? options.artifactRoot : options.storageRoot);
		this.#rootIdentity = rootIdentity(this.#root);
		this.#singleProjectId = "artifactRoot" in options ? admitProjectId(basename(this.#root)) : null;
		this.#preferredProjectId = "storageRoot" in options ? options.preferredProjectId ?? null : this.#singleProjectId;
		const initial = this.#discover();
		this.#catalogs = initial.catalogs;
		this.#projects = initial.projects;
	}

	overview(requested?: string): { projects: readonly ProfilerProject[]; selectedProjectId: ProjectId | null } {
		const requestedId = requested === undefined ? undefined : this.#admittedProjectId(requested);
		if (requested !== undefined && !requestedId) throw new TypeError("project is not in the active storage root");
		return { projects: this.#projects, selectedProjectId: requestedId ?? this.#defaultProjectId() };
	}

	require(requested?: string): ProjectSelection {
		const id = requested === undefined ? this.#defaultProjectId() : this.#admittedProjectId(requested);
		const catalog = id ? this.#catalogs.get(id) : undefined;
		const project = id ? this.#projects.find((candidate) => candidate.id === id) : undefined;
		if (!catalog || !project) throw new TypeError(requested ? "project is not in the active storage root" : "no Fanout project evidence is available");
		return { project, catalog };
	}

	refresh(requested?: string): Promise<ProjectRefresh> {
		let result: ProjectRefresh;
		const operation = this.#refreshTail.then(async () => {
			const candidate = this.#discover();
			const requestedId = requested === undefined ? undefined : candidate.projects.find(({ id }) => id === requested)?.id;
			if (requested !== undefined && !requestedId) {
				this.#adopt(candidate);
				result = { selection: null, projects: this.#projects, selectedProjectId: this.#defaultProjectId(), disappearedProjectId: requested };
				return;
			}
			const id = requestedId ?? this.#defaultProjectId(candidate.projects);
			const catalog = id ? candidate.catalogs.get(id) : undefined;
			if (!id || !catalog) {
				this.#adopt(candidate);
				result = { selection: null, projects: this.#projects, selectedProjectId: null, disappearedProjectId: null };
				return;
			}
			await catalog.refresh();
			candidate.projects = candidate.projects.map((project) => project.id === id ? summarize(id, catalog.snapshot()) : project).sort(projectOrder);
			this.#adopt(candidate);
			result = { selection: { project: this.#projects.find((project) => project.id === id)!, catalog }, projects: this.#projects, selectedProjectId: id, disappearedProjectId: null };
		});
		this.#refreshTail = operation.catch(() => undefined);
		return operation.then(() => result!);
	}

	#admittedProjectId(value: string): ProjectId | undefined {
		return this.#projects.find(({ id }) => id === value)?.id;
	}

	#defaultProjectId(projects = this.#projects): ProjectId | null {
		return projects.find(({ id }) => id === this.#preferredProjectId)?.id ?? projects[0]?.id ?? null;
	}

	#adopt(candidate: Discovery): void {
		this.#catalogs = candidate.catalogs;
		this.#projects = candidate.projects;
	}

	#discover(): Discovery {
		assertRoot(this.#root, this.#rootIdentity);
		if (this.#singleProjectId) {
			const catalog = currentCatalog(this.#catalogs.get(this.#singleProjectId), this.#root);
			return { catalogs: new Map([[this.#singleProjectId, catalog]]), projects: [summarize(this.#singleProjectId, catalog.snapshot())] };
		}
		const issuer = new ReferenceIssuer(this.#root, this.#rootIdentity, 0);
		const catalogs = new Map<ProjectId, ProfilerCatalog>();
		const projects: ProfilerProject[] = [];
		for (const name of issuer.readdir().sort()) {
			try {
				if (issuer.kind(name) !== "directory") continue;
				const id = admitProjectId(name), catalog = currentCatalog(this.#catalogs.get(id), join(this.#root, name)), snapshot = catalog.snapshot();
				if (!hasFanoutRun(snapshot)) continue;
				catalogs.set(id, catalog);
				projects.push(summarize(id, snapshot));
			} catch { /* Ignore non-canonical, unreadable, or replaced children. */ }
		}
		return { catalogs, projects: projects.sort(projectOrder) };
	}
}

function currentCatalog(existing: ProfilerCatalog | undefined, root: string): ProfilerCatalog {
	if (existing) {
		try { existing.assertCurrentRoot(); return existing; }
		catch { /* Replaced roots must build a new snapshot. */ }
	}
	return new ProfilerCatalog(root);
}

function hasFanoutRun(snapshot: CatalogSnapshot): boolean {
	return (snapshot.activePointer !== null && snapshot.activePointer.source !== null)
		|| snapshot.planningRuns.some(({ sources }) => sources.length > 0)
		|| snapshot.executionRuns.some(({ sources }) => sources.length > 0);
}

function summarize(id: ProjectId, snapshot: CatalogSnapshot): ProfilerProject {
	const planning = [...snapshot.planningRuns].sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
	const updatedAt = [...snapshot.executionRuns.flatMap((run) => [run.updatedAt, run.createdAt]), ...snapshot.planningRuns.map((run) => run.createdAt)]
		.filter((value): value is string => value !== null)
		.sort().at(-1) ?? null;
	return Object.freeze({ id, objective: planning.find(({ objective }) => objective)?.objective ?? null, planningRuns: snapshot.planningRuns.length, executionRuns: snapshot.executionRuns.length, updatedAt });
}

function projectOrder(left: ProfilerProject, right: ProfilerProject): number {
	return timestamp(right.updatedAt) - timestamp(left.updatedAt) || left.id.localeCompare(right.id);
}

function timestamp(value: string | null): number {
	const time = value === null ? Number.NEGATIVE_INFINITY : Date.parse(value);
	return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function admitProjectId(value: string): ProjectId { return value as ProjectId; }
