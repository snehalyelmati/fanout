import { closeSync, fstatSync, readSync } from "node:fs";
import { ACTIVE_PACKET_SCHEMA, ACTIVE_PACKET_VERSION, validateActivePacketPointer } from "../../fanout-core/src/active-packet.ts";
import { artifactIdentity, type ArtifactIdentity } from "../../fanout-core/src/artifact-identity.ts";
import { inspectExecutionEventLogEnvelope, parseExecutionEventLog } from "../../fanout-core/src/execution-event-log.ts";
import { EXECUTION_EVENT_SCHEMA, EXECUTION_EVENT_VERSION, type ExecutionEvent } from "../../fanout-core/src/execution-event.ts";
import { EXECUTION_PACKET_SCHEMA, EXECUTION_PACKET_VERSION, deriveExecutionGraph, validateExecutionPacket, type FanoutExecutionPacket } from "../../fanout-core/src/execution-packet.ts";
import { EXECUTION_PROJECTION_SCHEMA, EXECUTION_PROJECTION_VERSION, replayExecutionEvents, type ExecutionRunProjection } from "../../fanout-core/src/execution-projection.ts";
import { IMPLEMENTATION_DETAILS_SCHEMA, IMPLEMENTATION_DETAILS_VERSION, IMPLEMENTATION_PLAN_SCHEMA, IMPLEMENTATION_PLAN_VERSION, validateImplementationDetailsArtifact, validateImplementationPlan, type ImplementationDetails, type ImplementationPlan } from "../../fanout-core/src/fanout-compiler.ts";
import type { WorkContractGraph } from "../../fanout-core/src/work-contract-graph.ts";
import {
	assertRoot,
	canonicalRoot,
	fingerprint,
	openReadOnlyContained,
	ReferenceIssuer,
	rootIdentity,
	sameFingerprint,
	sourceMatches,
	type RootIdentity,
	type SourceReference,
	type StoredReference,
} from "./catalog-source";

export type CatalogAdmission = "Current" | "Planning-only" | "Legacy" | "Invalid" | "Unverifiable";

export type { SourceReference } from "./catalog-source";

export interface CatalogPlanningRun {
	readonly id: string;
	readonly admission: CatalogAdmission;
	readonly reason: string;
	readonly createdAt: string | null;
	readonly objective: string | null;
	readonly plan: ImplementationPlan | null;
	readonly details: ImplementationDetails | null;
	readonly packet: FanoutExecutionPacket | null;
	readonly graph: WorkContractGraph | null;
	readonly sources: readonly SourceReference[];
}

export interface CatalogExecutionRun {
	readonly id: string;
	readonly selectionId: string;
	readonly planningRunId: string;
	readonly admission: CatalogAdmission;
	readonly label: string;
	readonly reason: string;
	readonly createdAt: string | null;
	readonly updatedAt: string | null;
	readonly projection: ExecutionRunProjection | null;
	readonly events: readonly ExecutionEvent[];
	readonly sources: readonly SourceReference[];
}

export interface CatalogWorkflowLineage {
	readonly id: string;
	readonly admission: CatalogAdmission;
	readonly reason: string;
	readonly planningRun: CatalogPlanningRun | null;
	readonly packet: FanoutExecutionPacket | null;
	readonly graph: WorkContractGraph | null;
	readonly executionRuns: readonly CatalogExecutionRun[];
}

export interface CatalogSupportingEvidence {
	readonly id: string;
	readonly admission: "Current" | "Invalid";
	readonly reason: string;
	readonly source: SourceReference | null;
}

export interface CatalogSnapshot {
	readonly generation: number;
	readonly refreshedAt: string;
	readonly planningRuns: readonly CatalogPlanningRun[];
	readonly executionRuns: readonly CatalogExecutionRun[];
	readonly lineages: readonly CatalogWorkflowLineage[];
	readonly supportingEvidence: readonly CatalogSupportingEvidence[];
	readonly activePointer: { readonly admission: CatalogAdmission; readonly reason: string; readonly source: SourceReference | null } | null;
	readonly selectedExecutionRunId: string | null;
}

export function requireExecutionRun(snapshot: CatalogSnapshot, requested?: string): CatalogExecutionRun {
	const id = requested ?? snapshot.selectedExecutionRunId;
	const run = snapshot.executionRuns.find((candidate) => candidate.selectionId === id);
	if (!run) throw new TypeError("execution run is not in the active snapshot");
	return run;
}

export interface EvidencePage {
	readonly status: "Current" | "Changed since refresh";
	readonly rows: readonly string[];
	readonly nextOffset: number | null;
}

interface SnapshotState { snapshot: CatalogSnapshot; references: ReadonlyMap<string, StoredReference> }
interface PacketContext { packet: FanoutExecutionPacket; identity: ArtifactIdentity }

const PLAN_FILES = new Set(["implementation-plan.json", "implementation-details.json", "execution-packet.json", "executions"]);
const MAX_EVIDENCE_ROWS = 500;
const MAX_EVIDENCE_LINE_BYTES = 1024 * 1024;

export class ProfilerCatalog {
	readonly #root: string;
	readonly #rootIdentity: RootIdentity;
	#state: SnapshotState;
	#refreshTail: Promise<void> = Promise.resolve();

	constructor(artifactRoot: string) {
		const root = canonicalRoot(artifactRoot);
		const identity = rootIdentity(root);
		this.#root = root;
		this.#rootIdentity = identity;
		this.#state = buildSnapshot(root, identity, 1, null);
	}

	snapshot(): CatalogSnapshot {
		return this.#state.snapshot;
	}

	selectExecutionRun(id: string): CatalogSnapshot {
		if (!this.#state.snapshot.executionRuns.some((run) => run.selectionId === id)) throw new Error("execution run is not in the active snapshot");
		this.#state = { ...this.#state, snapshot: freeze({ ...this.#state.snapshot, selectedExecutionRunId: id }) };
		return this.#state.snapshot;
	}

	refresh(): Promise<CatalogSnapshot> {
		let result: CatalogSnapshot;
		const operation = this.#refreshTail.then(() => {
			const candidate = buildSnapshot(this.#root, this.#rootIdentity, this.#state.snapshot.generation + 1, this.#state.snapshot.selectedExecutionRunId);
			this.#state = candidate;
			result = candidate.snapshot;
		});
		this.#refreshTail = operation.catch(() => undefined);
		return operation.then(() => result!);
	}

	async readEvidencePage(referenceId: string, options: { offset?: number; limit?: number } = {}): Promise<EvidencePage> {
		const reference = this.#state.references.get(referenceId);
		if (!reference || reference.reference.kind !== "supporting-evidence") throw new Error("Source Reference was not issued by the active snapshot");
		const offset = options.offset ?? 0;
		const limit = options.limit ?? 100;
		if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("evidence offset must be a non-negative safe integer");
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVIDENCE_ROWS) throw new TypeError("evidence pages are limited to 500 rows");

		assertRoot(this.#root, this.#rootIdentity);
		let fd: number;
		try { fd = openReadOnlyContained(this.#root, this.#rootIdentity, reference.reference.path); }
		catch { return changedPage(); }
		try {
			if (!sameFingerprint(reference.fingerprint, fingerprint(fstatSync(fd, { bigint: true })))) return changedPage();
			const { rows, more } = readRows(fd, offset, limit);
			if (!sameFingerprint(reference.fingerprint, fingerprint(fstatSync(fd, { bigint: true }))) || !sourceMatches(this.#root, this.#rootIdentity, reference.reference.path, reference.fingerprint)) return changedPage();
			return freeze({ status: "Current", rows, nextOffset: more ? offset + rows.length : null });
		} finally { closeSync(fd); }
	}
}

function buildSnapshot(root: string, rootIdentity: RootIdentity, generation: number, previousSelection: string | null): SnapshotState {
	assertRoot(root, rootIdentity);
	const issuer = new ReferenceIssuer(root, rootIdentity, generation);
	const planningRuns: CatalogPlanningRun[] = [];
	const executionRuns: CatalogExecutionRun[] = [];
	const supportingEvidence: CatalogSupportingEvidence[] = [];
	let activePointer: CatalogSnapshot["activePointer"] = null;

	for (const name of issuer.readdir().sort()) {
		if (name === "active-packet.json") {
			try { activePointer = inspectPointer(issuer); }
			catch (error) { activePointer = freeze({ admission: "Invalid", reason: message(error), source: null }); }
			continue;
		}
		if (name === "observability") {
			supportingEvidence.push(...inspectObservability(issuer));
			continue;
		}
		try { if (issuer.kind(name) !== "directory") continue; }
		catch (error) { planningRuns.push(invalidPlanning(name, message(error))); continue; }
		const relativeDir = name;
		let names: string[];
		try { names = issuer.readdir(relativeDir); }
		catch (error) {
			planningRuns.push(invalidPlanning(name, message(error)));
			continue;
		}
		if (!names.some((name) => PLAN_FILES.has(name))) continue;
		const inspected = inspectPlanningRun(issuer, name, names);
		if (inspected.planning) planningRuns.push(inspected.planning);
		executionRuns.push(...inspected.executions);
	}

	executionRuns.sort((a, b) => (Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0) - (Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0) || b.id.localeCompare(a.id));
	const lineages = [...new Set([...planningRuns.map(({ id }) => id), ...executionRuns.map(({ planningRunId }) => planningRunId)])].sort().map((id) => {
		const planningRun = planningRuns.find((run) => run.id === id) ?? null;
		const runs = executionRuns.filter((run) => run.planningRunId === id);
		const admission = runs.some((run) => run.admission === "Current") ? "Current" : planningRun?.admission ?? runs[0]?.admission ?? "Unverifiable";
		return freeze({ id, admission, reason: admission === "Current" ? "authoritative current Workflow Lineage" : planningRun?.reason ?? runs[0]?.reason ?? "Workflow Lineage is unverifiable", planningRun, packet: planningRun?.packet ?? null, graph: planningRun?.graph ?? null, executionRuns: runs });
	});
	const selectedExecutionRunId = previousSelection && executionRuns.some(({ selectionId }) => selectionId === previousSelection)
		? previousSelection
		: executionRuns[0]?.selectionId ?? null;
	const publicSnapshot = freeze({
		generation,
		refreshedAt: new Date().toISOString(),
		planningRuns: planningRuns.sort((a, b) => a.id.localeCompare(b.id)),
		executionRuns,
		lineages,
		supportingEvidence: supportingEvidence.sort((a, b) => a.id.localeCompare(b.id)),
		activePointer,
		selectedExecutionRunId,
	});
	return { snapshot: publicSnapshot, references: issuer.references };
}

function inspectPlanningRun(issuer: ReferenceIssuer, id: string, names: string[]): { planning: CatalogPlanningRun | null; executions: CatalogExecutionRun[] } {
	const sources: SourceReference[] = [];
	let admission: CatalogAdmission = "Planning-only";
	let reason = "Planning Run has no Execution Packet or Execution Run";
	let createdAt: string | null = null;
	let objective: string | null = null;
	let admittedPlan: ReturnType<typeof validateImplementationPlan>["plan"];
	let admittedDetails: ImplementationDetails | undefined;
	let admittedPacket: FanoutExecutionPacket | undefined;
	let graph: WorkContractGraph | undefined;
	let planBytes: Buffer | undefined;
	let detailsBytes: Buffer | undefined;
	let packetContext: PacketContext | undefined;

	if (names.includes("implementation-plan.json")) {
		try {
			const read = issuer.read(`${id}/implementation-plan.json`, "planning", true);
			sources.push(read.reference);
			planBytes = read.bytes;
			const value = parseJson(read.bytes);
			const generation = schemaGeneration(value, IMPLEMENTATION_PLAN_SCHEMA, IMPLEMENTATION_PLAN_VERSION);
			if (generation === "legacy") { admission = "Legacy"; reason = "recognized older Implementation Plan generation"; }
			else {
				const result = validateImplementationPlan(value);
				if (!result.plan) { admission = "Invalid"; reason = result.errors.join("; "); }
				else { admittedPlan = result.plan; createdAt = result.plan.createdAt; objective = result.plan.objective; }
			}
		} catch (error) { admission = "Invalid"; reason = message(error); }
	} else if (names.includes("implementation-details.json") || names.includes("execution-packet.json")) {
		admission = "Unverifiable";
		reason = "Planning Run is missing implementation-plan.json";
	}

	if (names.includes("implementation-details.json")) {
		try {
			const read = issuer.read(`${id}/implementation-details.json`, "planning", true);
			sources.push(read.reference);
			detailsBytes = read.bytes;
			const value = parseJson(read.bytes);
			if (schemaGeneration(value, IMPLEMENTATION_DETAILS_SCHEMA, IMPLEMENTATION_DETAILS_VERSION) === "legacy") {
				if (admission !== "Invalid") { admission = "Legacy"; reason = "recognized older planning artifact generation"; }
			}
			else if (admittedPlan && planBytes) {
				const result = validateImplementationDetailsArtifact(value, { plan: admittedPlan, planIdentity: artifactIdentity("implementation-plan.json", planBytes) });
				if (!result.details) { admission = "Invalid"; reason = result.errors.join("; "); }
				else admittedDetails = result.details;
			}
			else if (admission !== "Invalid" && admission !== "Legacy") { admission = "Unverifiable"; reason = "Implementation Details cannot be linked to an admitted Implementation Plan"; }
		} catch (error) { admission = "Invalid"; reason = message(error); }
	}

	if (names.includes("execution-packet.json")) {
		try {
			const read = issuer.read(`${id}/execution-packet.json`, "planning", true);
			sources.push(read.reference);
			const value = parseJson(read.bytes);
			if (schemaGeneration(value, EXECUTION_PACKET_SCHEMA, EXECUTION_PACKET_VERSION) === "legacy") {
				if (admission !== "Invalid") { admission = "Legacy"; reason = "recognized older Execution Packet generation"; }
			}
			else {
				const result = validateExecutionPacket(value);
				if (!result.packet) { admission = "Invalid"; reason = result.errors.map(({ message }) => message).join("; "); }
				else if (!admittedPlan || !admittedDetails || !planBytes || !detailsBytes) { if (admission !== "Invalid") { admission = "Unverifiable"; reason = "Execution Packet cannot be linked to admitted planning source artifacts"; } }
				else if (!sameArtifact(result.packet.sourceArtifacts.plan, artifactIdentity("implementation-plan.json", planBytes)) || !sameArtifact(result.packet.sourceArtifacts.details, artifactIdentity("implementation-details.json", detailsBytes))) { admission = "Invalid"; reason = "Execution Packet source artifact identity does not match admitted planning bytes"; }
				else {
					admittedPacket = result.packet;
					graph = deriveExecutionGraph(result.packet);
					packetContext = { packet: result.packet, identity: artifactIdentity(`${id}/execution-packet.json`, read.bytes) };
					if (admission === "Planning-only") { admission = "Current"; reason = "current Planning Run and Execution Packet"; }
				}
			}
		} catch (error) { admission = "Invalid"; reason = message(error); }
	}

	const executions = names.includes("executions") ? inspectExecutions(issuer, id, packetContext) : [];
	return {
		planning: names.includes("implementation-plan.json") || names.includes("implementation-details.json") || names.includes("execution-packet.json")
			? freeze({ id, admission, reason, createdAt, objective, plan: admittedPlan ?? null, details: admittedDetails ?? null, packet: admittedPacket ?? null, graph: graph ?? null, sources })
			: null,
		executions,
	};
}

function inspectExecutions(issuer: ReferenceIssuer, planningRunId: string, packet: PacketContext | undefined): CatalogExecutionRun[] {
	const base = `${planningRunId}/executions`;
	try {
		return issuer.readdir(base).sort().flatMap((id) => {
			const relativeDir = `${base}/${id}`;
			try {
				if (issuer.kind(relativeDir) !== "directory") return [];
				const names = issuer.readdir(relativeDir);
				if (!names.includes("events.jsonl") && !names.includes("execution-run.json")) return [];
				return [inspectExecution(issuer, planningRunId, id, names, packet)];
			} catch (error) { return [invalidExecution(id, planningRunId, message(error))]; }
		});
	} catch (error) {
		return [invalidExecution("executions", planningRunId, message(error))];
	}
}

function inspectExecution(issuer: ReferenceIssuer, planningRunId: string, id: string, names: string[], packet: PacketContext | undefined): CatalogExecutionRun {
	const relativeDir = `${planningRunId}/executions/${id}`;
	const sources: SourceReference[] = [];
	try {
		if (names.includes("events.jsonl")) {
			const relativePath = `${relativeDir}/events.jsonl`;
			const header = issuer.readFirstLine(relativePath, "execution");
			const first = parseJson(header.bytes);
			const createdAt = stringField(first, "occurredAt");
			const selectionId = `${relativeDir}`;
			sources.push(header.reference);
			if (!isRecord(first) || first.schema !== EXECUTION_EVENT_SCHEMA || !Number.isSafeInteger(first.version)) return invalidExecution(id, planningRunId, "Event Log begins with an unrecognized event", sources, createdAt);
			if (first.version !== EXECUTION_EVENT_VERSION) {
				try {
					const read = issuer.read(relativePath, "execution", true);
					sources.splice(0, 1, read.reference);
					const metadata = inspectExecutionEventLogEnvelope(read.bytes.toString("utf8"));
					if (metadata.runId !== id) throw new Error("Execution Event Log run identity does not match its execution directory");
					const legacy = (first.version as number) < EXECUTION_EVENT_VERSION;
					return classifiedExecution(id, planningRunId, legacy ? "Legacy" : "Unverifiable", legacy ? "recognized older Execution Event generation" : "future Execution Event generation is unsupported", metadata.createdAt, metadata.updatedAt, sources);
				} catch (error) { return invalidExecution(id, planningRunId, message(error), sources, createdAt); }
			}
			try {
				const read = issuer.read(relativePath, "execution", true);
				sources.splice(0, 1, read.reference);
				const events = parseExecutionEventLog(read.bytes.toString("utf8"));
				const projection = replayExecutionEvents(events);
				const last = events.at(-1)!;
				if (projection.runId !== id) return invalidExecution(id, planningRunId, "Event Log run identity does not match its execution directory", sources, createdAt, last.occurredAt);
				if (!packet) return classifiedExecution(id, planningRunId, "Unverifiable", "current Event Log cannot be linked to an admitted Execution Packet", createdAt, last.occurredAt, sources);
				if (!sameArtifact(projection.packet, packet.identity) || projection.planningBaseTree !== packet.packet.planningBase.tree || !sameNodeIds(projection.nodes.map(({ id }) => id), packet.packet.nodes.filter(({ kind }) => kind !== "final-validation").map(({ id }) => id)) || !samePolicy(projection.policy, packet.packet.runtimePolicy)) {
					return classifiedExecution(id, planningRunId, "Unverifiable", "Event Log authority does not match its linked Execution Packet", createdAt, last.occurredAt, sources);
				}
				return freeze({ id, selectionId, planningRunId, admission: "Current", label: projection.terminalOutcome?.outcome ?? lastAdmissionLabel(last), reason: "authoritative Event Log replayed through fanout-core", createdAt: projection.startedAt, updatedAt: projection.updatedAt, projection, events, sources });
			} catch (error) { return invalidExecution(id, planningRunId, message(error), sources, createdAt); }
		}

		const read = issuer.read(`${relativeDir}/execution-run.json`, "execution", true);
		sources.push(read.reference);
		const value = parseJson(read.bytes);
		const createdAt = stringField(value, "startedAt");
		const updatedAt = stringField(value, "updatedAt") ?? stringField(value, "finishedAt") ?? createdAt;
		const selectionId = `${relativeDir}`;
		if (!isRecord(value) || value.schema !== EXECUTION_PROJECTION_SCHEMA || !Number.isSafeInteger(value.version)) return invalidExecution(id, planningRunId, "projection has an unrecognized schema or version", sources, createdAt);
		if ((value.version as number) < EXECUTION_PROJECTION_VERSION) return classifiedExecution(id, planningRunId, "Legacy", "recognized older Execution Projection generation", createdAt, updatedAt, sources);
		return classifiedExecution(id, planningRunId, "Unverifiable", "projection-only execution has no authoritative Event Log", createdAt, updatedAt, sources);
	} catch (error) {
		return invalidExecution(id, planningRunId, message(error), sources);
	}
}

function inspectObservability(issuer: ReferenceIssuer): CatalogSupportingEvidence[] {
	try {
		return issuer.readdir("observability").sort().flatMap((id) => {
			const dir = `observability/${id}`;
			try {
				if (issuer.kind(dir) !== "directory" || !issuer.readdir(dir).includes("observability.jsonl")) return [];
				return [freeze({ id, admission: "Current", reason: "planning observability is loaded only when inspected", source: issuer.reference(`${dir}/observability.jsonl`, "supporting-evidence") })];
			} catch (error) { return [freeze({ id, admission: "Invalid", reason: message(error), source: null })]; }
		});
	} catch (error) {
		return [freeze({ id: "observability", admission: "Invalid", reason: message(error), source: null })];
	}
}

function inspectPointer(issuer: ReferenceIssuer): CatalogSnapshot["activePointer"] {
	const read = issuer.read("active-packet.json", "pointer", true);
	const value = parseJson(read.bytes);
	const generation = schemaGeneration(value, ACTIVE_PACKET_SCHEMA, ACTIVE_PACKET_VERSION);
	if (generation === "legacy") return freeze({ admission: "Legacy", reason: "recognized older Active Packet Pointer generation", source: read.reference });
	const admitted = validateActivePacketPointer(value);
	return admitted.pointer
		? freeze({ admission: "Current", reason: "current Active Packet Pointer", source: read.reference })
		: freeze({ admission: "Invalid", reason: admitted.errors.join("; "), source: read.reference });
}

function parseJson(bytes: Uint8Array): unknown { return JSON.parse(Buffer.from(bytes).toString("utf8")); }
function schemaGeneration(value: unknown, schema: string, currentVersion: number): "current-or-future" | "legacy" { return isRecord(value) && value.schema === schema && Number.isSafeInteger(value.version) && (value.version as number) > 0 && (value.version as number) < currentVersion ? "legacy" : "current-or-future"; }
function stringField(value: unknown, field: string): string | null { return isRecord(value) && typeof value[field] === "string" && Number.isFinite(Date.parse(value[field] as string)) ? value[field] as string : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function invalidPlanning(id: string, reason: string): CatalogPlanningRun { return freeze({ id, admission: "Invalid", reason, createdAt: null, objective: null, plan: null, details: null, packet: null, graph: null, sources: [] }); }
function invalidExecution(id: string, planningRunId: string, reason: string, sources: SourceReference[] = [], createdAt: string | null = null, updatedAt = createdAt): CatalogExecutionRun { return classifiedExecution(id, planningRunId, "Invalid", reason, createdAt, updatedAt, sources); }
function classifiedExecution(id: string, planningRunId: string, admission: "Legacy" | "Invalid" | "Unverifiable", reason: string, createdAt: string | null, updatedAt: string | null, sources: SourceReference[]): CatalogExecutionRun { return freeze({ id, selectionId: `${planningRunId}/executions/${id}`, planningRunId, admission, label: admission, reason, createdAt, updatedAt, projection: null, events: [], sources }); }
export function sameArtifact(left: ArtifactIdentity, right: ArtifactIdentity): boolean { return left.path === right.path && left.sha256 === right.sha256 && left.byteLength === right.byteLength; }
function sameNodeIds(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function samePolicy(left: ExecutionRunProjection["policy"], right: FanoutExecutionPacket["runtimePolicy"]): boolean { return left.maxConcurrency === right.maxConcurrency && left.failFast === right.failFast && left.fallbackAllowed === right.fallbackAllowed; }
function lastAdmissionLabel(event: ExecutionEvent): string { return `Last admitted: ${event.event} at ${event.occurredAt}`; }
function changedPage(): EvidencePage { return freeze({ status: "Changed since refresh", rows: [], nextOffset: null }); }
function readRows(fd: number, offset: number, limit: number): { rows: string[]; more: boolean } {
	const rows: string[] = [];
	const decoder = new TextDecoder();
	const chunk = Buffer.allocUnsafe(64 * 1024);
	let pending = "";
	let position = 0;
	let row = 0;
	const accept = (line: string): boolean => {
		if (row++ < offset) return false;
		if (rows.length === limit) return true;
		rows.push(line.endsWith("\r") ? line.slice(0, -1) : line);
		return false;
	};
	for (;;) {
		const count = readSync(fd, chunk, 0, chunk.length, position);
		if (!count) break;
		position += count;
		const lines = `${pending}${decoder.decode(chunk.subarray(0, count), { stream: true })}`.split("\n");
		pending = lines.pop()!;
		if (Buffer.byteLength(pending) > MAX_EVIDENCE_LINE_BYTES) throw new Error("evidence row exceeds 1 MiB");
		for (const line of lines) if (accept(line)) return { rows, more: true };
	}
	pending += decoder.decode();
	return { rows, more: pending.length > 0 ? accept(pending) : false };
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
