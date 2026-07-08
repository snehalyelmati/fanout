import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const EXECUTION_PACKET_SCHEMA = "fanout.execution-packet";
export const EXECUTION_PACKET_VERSION = 3;
export const ACTIVE_PACKET_SCHEMA = "fanout.active-packet";

export type PacketStatus = "ready";
export type WorkActiveState = "active" | "background";
export type TierName = "tier1" | "tier2";
export type TierStatus = "available" | "unavailable";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "auto";
export type WorkUnitKind = "plan" | "clarify" | "packet-validation" | "dag-safety" | "implement" | "test" | "docs" | "inspect" | "validate-shard" | "review-shard" | "final-review" | "synthesis" | "final-validation" | "final-response";

export interface TierModelSummary {
	provider: string;
	model: string;
	thinking: ThinkingLevel | string;
	source: string;
	status: TierStatus;
	reason: string;
}

export interface FanoutTierPlan {
	tier1: TierModelSummary;
	tier2: TierModelSummary & { fallback?: TierName };
}

export interface WorkUnitTierAssignment {
	preferred: TierName;
	assigned: TierName;
	fallback: TierName;
	provider: string;
	model: string;
	thinking: ThinkingLevel | string;
	reason: string;
}

export interface WorkerPacket {
	sourcePlanIds: string[];
	targetAnchors: string[];
	requiredChanges: string[];
	contractInputs: string[];
	readDependencies: string[];
	forbiddenChanges: string[];
	handoffContext: string[];
}

export interface FanoutWorkUnit {
	id: string;
	kind: WorkUnitKind;
	goal: string;
	dependencies: string[];
	ownedFiles: string[];
	readOnlyFiles: string[];
	steps: string[];
	validationCommands: string[];
	acceptanceCriteria: string[];
	rollbackNotes: string[];
	tier: WorkUnitTierAssignment;
	workerPacket: WorkerPacket;
	active?: WorkActiveState;
}

export interface FanoutExecutionPacket {
	schema: typeof EXECUTION_PACKET_SCHEMA;
	version: typeof EXECUTION_PACKET_VERSION;
	status: PacketStatus;
	objective: string;
	createdAt: string;
	artifactDir: string;
	tierPlan: FanoutTierPlan;
	userContext: string[];
	discoveredRepoFacts: string[];
	assumptions: string[];
	blockers: string[];
	workUnits: FanoutWorkUnit[];
	estimates: {
		activeWait: string;
		backgroundCompletion: string;
		cost: string;
		criticalPath: string[];
		parallelGroups: string[][];
	};
	stopRules: string[];
	risks: string[];
	finalValidationPlan: string[];
}

export interface PacketValidationIssue {
	code: string;
	message: string;
	path?: string;
	unitId?: string;
}

export interface ExecutionGraph {
	nodes: string[];
	edges: Array<[string, string]>;
	topologicalOrder: string[];
	parallelGroups: string[][];
	criticalPath: string[];
}

export interface PacketValidationResult {
	ok: boolean;
	executable: boolean;
	errors: PacketValidationIssue[];
	warnings: PacketValidationIssue[];
	graph?: ExecutionGraph;
}

const VALID_STATUSES = new Set(["ready"]);
const VALID_ACTIVE_STATES = new Set(["active", "background"]);
const VALID_TIERS = new Set(["tier1", "tier2"]);
const VALID_TIER_STATUSES = new Set(["available", "unavailable"]);
const VALID_KINDS = new Set(["plan", "clarify", "packet-validation", "dag-safety", "implement", "test", "docs", "inspect", "validate-shard", "review-shard", "final-review", "synthesis", "final-validation", "final-response"]);
const TIER2_ELIGIBLE_KINDS = new Set(["implement", "test", "docs", "inspect", "validate-shard", "review-shard"]);
const UNSAFE_COMMANDS: Array<[string, RegExp]> = [
	["rm-recursive-force", /(^|\s)rm\s+(?=[^\n;]*?(?:-[^\s;]*[rR][^\s;]*|--recursive)\b)(?=[^\n;]*?(?:-[^\s;]*f[^\s;]*|--force)\b)/],
	["sudo", /(^|\s)sudo\b/],
	["git-reset-hard", /\bgit\s+reset\s+--hard\b/],
	["git-clean", /\bgit\s+clean\b/],
	["git-push", /\bgit\s+push\b/],
	["npm-publish", /\bnpm\s+publish\b/],
	["curl-pipe-shell", /\b(curl|wget)\b[^\n|;]*\|\s*(sh|bash)\b/],
	["chmod-recursive", /\bchmod\s+-R\b/],
	["chown-recursive", /\bchown\s+-R\b/],
	["mkfs", /\bmkfs(\.|\s|$)/],
	["dd", /\bdd\s+[^\n;]*\bof=/],
];

export function readExecutionPacket(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

export function validateExecutionPacket(packet: unknown): PacketValidationResult {
	const errors: PacketValidationIssue[] = [];
	const warnings: PacketValidationIssue[] = [];

	if (!isRecord(packet)) return { ok: false, executable: false, errors: [{ code: "packet-not-object", message: "packet must be an object" }], warnings };

	if (packet.schema !== EXECUTION_PACKET_SCHEMA) add(errors, "invalid-schema", `schema must be ${EXECUTION_PACKET_SCHEMA}`, "schema");
	if (packet.version !== EXECUTION_PACKET_VERSION) add(errors, "invalid-version", `version must be ${EXECUTION_PACKET_VERSION}`, "version");
	if (typeof packet.status !== "string" || !VALID_STATUSES.has(packet.status)) add(errors, "invalid-status", "status must be ready", "status");
	if (!nonEmptyString(packet.objective)) add(errors, "missing-objective", "objective is required", "objective");
	if (!nonEmptyString(packet.createdAt)) add(errors, "missing-created-at", "createdAt is required", "createdAt");
	if (!nonEmptyString(packet.artifactDir)) add(errors, "missing-artifact-dir", "artifactDir is required", "artifactDir");
	validateTierPlan(packet.tierPlan, errors);

	for (const key of ["userContext", "discoveredRepoFacts", "assumptions", "blockers", "stopRules", "risks", "finalValidationPlan"]) requireStringArray(packet, key, errors);

	if (Array.isArray(packet.finalValidationPlan)) {
		for (const [index, value] of packet.finalValidationPlan.entries()) {
			if (typeof value !== "string") continue;
			const unsafe = unsafeCommand(value);
			if (unsafe) add(errors, "unsafe-command", `finalValidationPlan contains unsafe command pattern: ${unsafe}`, `finalValidationPlan[${index}]`);
		}
	}

	if (Array.isArray(packet.blockers) && packet.blockers.length > 0) add(errors, "ready-has-blockers", "ready packets cannot have blockers", "blockers");

	if (!isRecord(packet.estimates)) {
		add(errors, "missing-estimates", "estimates object is required", "estimates");
	} else {
		for (const key of ["activeWait", "backgroundCompletion", "cost"]) if (!nonEmptyString(packet.estimates[key])) add(errors, "invalid-estimate", `estimates.${key} is required`, `estimates.${key}`);
		requireStringArray(packet.estimates, "criticalPath", errors, "estimates.criticalPath");
		requireStringMatrix(packet.estimates, "parallelGroups", errors, "estimates.parallelGroups");
	}

	if (!Array.isArray(packet.workUnits)) {
		add(errors, "missing-work-units", "workUnits array is required", "workUnits");
		return finish(packet, errors, warnings);
	}
	if (packet.workUnits.length === 0) add(errors, "ready-without-work", "ready packets need at least one work unit", "workUnits");

	const workUnits: FanoutWorkUnit[] = [];
	const ids = new Set<string>();
	for (const [index, unit] of packet.workUnits.entries()) {
		const path = `workUnits[${index}]`;
		if (!isRecord(unit)) {
			add(errors, "work-unit-not-object", "work unit must be an object", path);
			continue;
		}
		const id = typeof unit.id === "string" ? unit.id.trim() : "";
		if (!id) add(errors, "missing-unit-id", "work unit id is required", `${path}.id`);
		else if (ids.has(id)) add(errors, "duplicate-unit-id", `duplicate work unit id: ${id}`, `${path}.id`, id);
		else ids.add(id);
		if (!nonEmptyString(unit.goal)) add(errors, "missing-unit-goal", "work unit goal is required", `${path}.goal`, id || undefined);
		const kind = typeof unit.kind === "string" ? unit.kind : "";
		if (!VALID_KINDS.has(kind)) add(errors, "invalid-kind", `kind must be one of ${Array.from(VALID_KINDS).join(", ")}`, `${path}.kind`, id || undefined);
		validateTierAssignment(unit.tier, `${path}.tier`, errors, id || undefined);
		validateWorkerPacket(unit.workerPacket, `${path}.workerPacket`, errors, id || undefined);

		const dependencies = stringArray(unit.dependencies, errors, `${path}.dependencies`, "dependencies", id);
		const ownedFiles = stringArray(unit.ownedFiles, errors, `${path}.ownedFiles`, "ownedFiles", id);
		const readOnlyFiles = stringArray(unit.readOnlyFiles, errors, `${path}.readOnlyFiles`, "readOnlyFiles", id);
		const steps = stringArray(unit.steps, errors, `${path}.steps`, "steps", id);
		const validationCommands = stringArray(unit.validationCommands, errors, `${path}.validationCommands`, "validationCommands", id);
		const acceptanceCriteria = stringArray(unit.acceptanceCriteria, errors, `${path}.acceptanceCriteria`, "acceptanceCriteria", id);
		const rollbackNotes = stringArray(unit.rollbackNotes, errors, `${path}.rollbackNotes`, "rollbackNotes", id);

		if (unit.active !== undefined && (typeof unit.active !== "string" || !VALID_ACTIVE_STATES.has(unit.active))) add(errors, "invalid-active-state", "active must be active or background", `${path}.active`, id || undefined);
		if (ownedFiles.length > 0 && validationCommands.length === 0) add(errors, "missing-validation", "work units that own files need validationCommands", `${path}.validationCommands`, id || undefined);
		if (acceptanceCriteria.length === 0) add(errors, "missing-acceptance", "work units need acceptanceCriteria", `${path}.acceptanceCriteria`, id || undefined);

		for (const [field, values] of [["steps", steps], ["validationCommands", validationCommands]] as const) {
			for (const value of values) {
				const unsafe = unsafeCommand(value);
				if (unsafe) add(errors, "unsafe-command", `${field} contains unsafe command pattern: ${unsafe}`, `${path}.${field}`, id || undefined);
			}
		}

		if (id) workUnits.push({ id, kind: kind as WorkUnitKind, goal: typeof unit.goal === "string" ? unit.goal : "", dependencies, ownedFiles, readOnlyFiles, steps, validationCommands, acceptanceCriteria, rollbackNotes, tier: unit.tier as WorkUnitTierAssignment, workerPacket: unit.workerPacket as WorkerPacket, active: unit.active as WorkActiveState | undefined });
	}

	const byId = new Map(workUnits.map((unit) => [unit.id, unit]));
	for (const unit of workUnits) for (const dependency of unit.dependencies) if (!byId.has(dependency)) add(errors, "missing-dependency", `${unit.id} depends on missing unit ${dependency}`, `workUnits.${unit.id}.dependencies`, unit.id);

	const graph = buildExecutionGraph(workUnits);
	if (graph.topologicalOrder.length !== workUnits.length) add(errors, "cycle", "work unit dependencies contain a cycle", "workUnits");
	checkOwnershipConflicts(workUnits, graph, errors, warnings);
	checkEstimateGraph(packet, graph, errors);
	checkTierPolicy(workUnits, packet.tierPlan, errors, warnings);

	return finish(packet, errors, warnings, graph);
}

export function formatPacketValidationResult(result: PacketValidationResult): string {
	const lines = [`valid=${result.ok}`, `executable=${result.executable}`];
	if (result.errors.length) {
		lines.push("errors:");
		for (const issue of result.errors) lines.push(`- ${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ""}`);
	}
	if (result.warnings.length) {
		lines.push("warnings:");
		for (const issue of result.warnings) lines.push(`- ${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ""}`);
	}
	if (result.graph) {
		lines.push(`topologicalOrder=${result.graph.topologicalOrder.join(" -> ")}`);
		lines.push(`parallelGroups=${result.graph.parallelGroups.map((group) => `[${group.join(", ")}]`).join(" ")}`);
	}
	return `${lines.join("\n")}\n`;
}

export function writeExecutionPacketArtifacts(packet: FanoutExecutionPacket, outDir: string, options: { activePointerPath?: string } = {}) {
	const validation = validateExecutionPacket(packet);
	if (!validation.ok) throw new Error(formatPacketValidationResult(validation));

	mkdirSync(outDir, { recursive: true });
	const packetPath = join(outDir, "execution-packet.json");
	const planPath = join(outDir, "execution-plan.md");
	const dagPath = join(outDir, "execution-dag.mmd");
	writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
	writeFileSync(planPath, renderExecutionPlanMarkdown(packet, validation, outDir), "utf8");
	writeFileSync(dagPath, renderExecutionDagMermaid(packet, validation), "utf8");

	let activePointerPath: string | undefined;
	if (options.activePointerPath && validation.executable) {
		activePointerPath = options.activePointerPath;
		mkdirSync(dirname(activePointerPath), { recursive: true });
		writeFileSync(activePointerPath, `${JSON.stringify({ schema: ACTIVE_PACKET_SCHEMA, version: 1, updatedAt: new Date().toISOString(), packetPath: resolve(packetPath) }, null, 2)}\n`, "utf8");
	}

	return { packetPath, planPath, dagPath, activePointerPath, validation };
}

export function renderExecutionPlanMarkdown(packet: FanoutExecutionPacket, validation = validateExecutionPacket(packet), artifactDir = packet.artifactDir): string {
	return `# Fanout Execution Plan

\`\`\`text
Fanout plan ${validation.executable ? "ready ✅" : "not executable"}
Artifacts: ${artifactDir}
\`\`\`

## Tier/model plan

\`\`\`text
${renderTierPlan(packet)}\`\`\`

## Execution flow

\`\`\`text
${renderAsciiDag(packet, validation)}\`\`\`

## Files

${renderFilesSection(packet)}

## Metrics

\`\`\`text
${renderMetrics(packet, validation)}\`\`\`

## Context

### User context
${bullets(packet.userContext)}

### Discovered repo facts
${bullets(packet.discoveredRepoFacts)}

### Assumptions
${bullets(packet.assumptions)}

## Stop rules
${bullets(packet.stopRules)}

## Risks
${bullets(packet.risks)}

## Final validation plan
${bullets(packet.finalValidationPlan)}

## Validator output

\`\`\`text
${formatPacketValidationResult(validation).trim()}
\`\`\`
`;
}

export function renderExecutionDagMermaid(packet: FanoutExecutionPacket, validation = validateExecutionPacket(packet)): string {
	const units = packet.workUnits;
	const ids = new Map(units.map((unit, index) => [unit.id, `n${index}`]));
	const lines = ["flowchart TD"];
	for (const unit of units) lines.push(`  ${ids.get(unit.id)}["${escapeMermaid(unit.id)}: ${escapeMermaid(unit.goal)}\\n${escapeMermaid(unit.tier.assigned)} ${escapeMermaid(unit.tier.model)}"]`);
	const edges = validation.graph?.edges ?? units.flatMap((unit) => unit.dependencies.map((dependency) => [dependency, unit.id] as [string, string]));
	for (const [from, to] of edges) {
		const fromId = ids.get(from);
		const toId = ids.get(to);
		if (fromId && toId) lines.push(`  ${fromId} --> ${toId}`);
	}
	return `${lines.join("\n")}\n`;
}

function validateTierPlan(value: unknown, errors: PacketValidationIssue[]): void {
	if (!isRecord(value)) {
		add(errors, "missing-tier-plan", "tierPlan object is required", "tierPlan");
		return;
	}
	validateTierSummary(value.tier1, "tierPlan.tier1", errors);
	validateTierSummary(value.tier2, "tierPlan.tier2", errors);
	if (isRecord(value.tier1) && value.tier1.status !== "available") add(errors, "tier1-unavailable", "tier1 is required and must be available", "tierPlan.tier1.status");
}

function validateTierSummary(value: unknown, path: string, errors: PacketValidationIssue[]): void {
	if (!isRecord(value)) {
		add(errors, "invalid-tier-summary", `${path} must be an object`, path);
		return;
	}
	for (const key of ["provider", "model", "thinking", "source", "reason"]) if (!nonEmptyString(value[key])) add(errors, "invalid-tier-summary", `${path}.${key} is required`, `${path}.${key}`);
	if (typeof value.status !== "string" || !VALID_TIER_STATUSES.has(value.status)) add(errors, "invalid-tier-status", `${path}.status must be available or unavailable`, `${path}.status`);
}

function validateTierAssignment(value: unknown, path: string, errors: PacketValidationIssue[], unitId?: string): void {
	if (!isRecord(value)) {
		add(errors, "missing-tier", "work unit tier object is required", path, unitId);
		return;
	}
	for (const key of ["preferred", "assigned", "fallback"]) if (typeof value[key] !== "string" || !VALID_TIERS.has(value[key])) add(errors, "invalid-tier", `${path}.${key} must be tier1 or tier2`, `${path}.${key}`, unitId);
	for (const key of ["provider", "model", "thinking", "reason"]) if (!nonEmptyString(value[key])) add(errors, "invalid-tier", `${path}.${key} is required`, `${path}.${key}`, unitId);
}

function validateWorkerPacket(value: unknown, path: string, errors: PacketValidationIssue[], unitId?: string): void {
	if (!isRecord(value)) {
		add(errors, "missing-worker-packet", "work unit workerPacket object is required", path, unitId);
		return;
	}
	const requiredNonEmpty = new Set(["sourcePlanIds", "requiredChanges", "contractInputs"]);
	for (const key of ["sourcePlanIds", "targetAnchors", "requiredChanges", "contractInputs", "readDependencies", "forbiddenChanges", "handoffContext"] as const) {
		const values = stringArray(value[key], errors, `${path}.${key}`, key, unitId);
		if (requiredNonEmpty.has(key) && values.length === 0) add(errors, "invalid-worker-packet", `${path}.${key} must not be empty`, `${path}.${key}`, unitId);
	}
}

function checkTierPolicy(workUnits: FanoutWorkUnit[], tierPlan: unknown, errors: PacketValidationIssue[], warnings: PacketValidationIssue[]): void {
	const tier2Available = isRecord(tierPlan) && isRecord(tierPlan.tier2) && tierPlan.tier2.status === "available";
	for (const unit of workUnits) {
		if (!isRecord(unit.tier)) continue;
		if (!tier2Available && unit.tier.assigned === "tier2") add(errors, "tier2-unavailable-assignment", `${unit.id} is assigned to tier2 but tier2 is unavailable`, `workUnits.${unit.id}.tier`, unit.id);
		if (unit.tier.assigned === "tier2" && !TIER2_ELIGIBLE_KINDS.has(unit.kind)) add(errors, "tier2-ineligible-kind", `${unit.kind} nodes must run on tier1`, `workUnits.${unit.id}.tier`, unit.id);
		if (unit.tier.preferred === "tier2" && unit.tier.assigned === "tier1" && tier2Available) add(warnings, "tier2-candidate-on-tier1", `${unit.id} preferred tier2 but is assigned tier1 while tier2 is available`, `workUnits.${unit.id}.tier`, unit.id);
	}
}

function finish(packet: Record<string, unknown>, errors: PacketValidationIssue[], warnings: PacketValidationIssue[], graph?: ExecutionGraph): PacketValidationResult {
	const ok = errors.length === 0;
	return { ok, executable: ok, errors, warnings, graph };
}

export function buildExecutionGraph(workUnits: FanoutWorkUnit[]): ExecutionGraph {
	const nodes = workUnits.map((unit) => unit.id);
	const nodeSet = new Set(nodes);
	const edges: Array<[string, string]> = [];
	const adjacency = new Map(nodes.map((id) => [id, [] as string[]]));
	const indegree = new Map(nodes.map((id) => [id, 0]));

	for (const unit of workUnits) for (const dependency of unit.dependencies) if (nodeSet.has(dependency)) {
		edges.push([dependency, unit.id]);
		adjacency.get(dependency)?.push(unit.id);
		indegree.set(unit.id, (indegree.get(unit.id) ?? 0) + 1);
	}

	const topologicalOrder: string[] = [];
	const parallelGroups: string[][] = [];
	let ready = nodes.filter((id) => (indegree.get(id) ?? 0) === 0);
	while (ready.length) {
		parallelGroups.push(ready);
		topologicalOrder.push(...ready);
		const next: string[] = [];
		for (const id of ready) for (const child of adjacency.get(id) ?? []) {
			const count = (indegree.get(child) ?? 0) - 1;
			indegree.set(child, count);
			if (count === 0) next.push(child);
		}
		ready = next;
	}

	const distance = new Map(nodes.map((id) => [id, 1]));
	const parent = new Map<string, string>();
	for (const id of topologicalOrder) for (const child of adjacency.get(id) ?? []) {
		const candidate = (distance.get(id) ?? 1) + 1;
		if (candidate > (distance.get(child) ?? 1)) {
			distance.set(child, candidate);
			parent.set(child, id);
		}
	}
	let tail = topologicalOrder[0];
	for (const id of topologicalOrder) if ((distance.get(id) ?? 0) > (distance.get(tail) ?? 0)) tail = id;
	const criticalPath: string[] = [];
	while (tail) {
		criticalPath.unshift(tail);
		const next = parent.get(tail);
		if (!next) break;
		tail = next;
	}

	return { nodes, edges, topologicalOrder, parallelGroups, criticalPath };
}

function checkOwnershipConflicts(workUnits: FanoutWorkUnit[], graph: ExecutionGraph, errors: PacketValidationIssue[], warnings: PacketValidationIssue[]): void {
	const owned = workUnits.flatMap((unit) => unit.ownedFiles.map(normalizeFile).filter(Boolean).map((file) => ({ unit, file })));
	for (let i = 0; i < owned.length; i++) for (let j = i + 1; j < owned.length; j++) {
		const a = owned[i];
		const b = owned[j];
		if (a.unit.id !== b.unit.id && pathsOverlap(a.file, b.file) && !hasPath(graph, a.unit.id, b.unit.id) && !hasPath(graph, b.unit.id, a.unit.id)) add(errors, "ownership-conflict", `${a.file} and ${b.file} are owned by parallel units ${a.unit.id} and ${b.unit.id}`, "workUnits", `${a.unit.id},${b.unit.id}`);
	}

	for (const owner of workUnits) {
		const ownedFiles = owner.ownedFiles.map(normalizeFile).filter(Boolean);
		for (const reader of workUnits) {
			if (owner.id === reader.id) continue;
			for (const readOnlyFile of reader.readOnlyFiles.map(normalizeFile).filter(Boolean)) if (ownedFiles.some((ownedFile) => pathsOverlap(ownedFile, readOnlyFile)) && !hasPath(graph, owner.id, reader.id) && !hasPath(graph, reader.id, owner.id) && !hasBaselineContextRead(reader, readOnlyFile)) add(warnings, "read-write-overlap", `${readOnlyFile} is read by ${reader.id} while overlapping owned files from parallel unit ${owner.id}`, "workUnits", reader.id);
		}
	}
}

function hasBaselineContextRead(unit: FanoutWorkUnit, file: string): boolean {
	const readDependencies = Array.isArray(unit.workerPacket?.readDependencies) ? unit.workerPacket.readDependencies : [];
	return readDependencies.some((dependency) => {
		if (typeof dependency !== "string") return false;
		const marker = " (baseline-context)";
		const index = dependency.indexOf(marker);
		return index > 0 && pathsOverlap(normalizeFile(dependency.slice(0, index)), file);
	});
}

function hasPath(graph: ExecutionGraph, from: string, to: string): boolean {
	const adjacency = new Map<string, string[]>();
	for (const [edgeFrom, edgeTo] of graph.edges) {
		const list = adjacency.get(edgeFrom) ?? [];
		list.push(edgeTo);
		adjacency.set(edgeFrom, list);
	}
	const seen = new Set<string>();
	const stack = [from];
	while (stack.length) {
		const id = stack.pop();
		if (!id || seen.has(id)) continue;
		if (id === to) return true;
		seen.add(id);
		stack.push(...(adjacency.get(id) ?? []));
	}
	return false;
}

function stringArray(value: unknown, errors: PacketValidationIssue[], path: string, field: string, unitId?: string): string[] {
	if (!Array.isArray(value)) {
		add(errors, "invalid-string-array", `${field} must be an array of strings`, path, unitId);
		return [];
	}
	const result: string[] = [];
	for (const [index, item] of value.entries()) {
		if (typeof item !== "string") add(errors, "invalid-string-array", `${field} item must be a string`, `${path}[${index}]`, unitId);
		else result.push(item.trim());
	}
	return result.filter(Boolean);
}

function requireStringArray(record: Record<string, unknown>, key: string, errors: PacketValidationIssue[], path = key): void {
	stringArray(record[key], errors, path, key);
}

function requireStringMatrix(record: Record<string, unknown>, key: string, errors: PacketValidationIssue[], path = key): void {
	const value = record[key];
	if (!Array.isArray(value)) {
		add(errors, "invalid-string-matrix", `${key} must be an array of string arrays`, path);
		return;
	}
	for (const [index, item] of value.entries()) stringArray(item, errors, `${path}[${index}]`, key);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringMatrix(value: unknown): value is string[][] {
	return Array.isArray(value) && value.every(isStringArray);
}

function sameStringArray(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringMatrix(left: string[][], right: string[][]): boolean {
	return left.length === right.length && left.every((group, index) => sameStringArray(group, right[index] ?? []));
}

function checkEstimateGraph(packet: Record<string, unknown>, graph: ExecutionGraph, errors: PacketValidationIssue[]): void {
	if (!isRecord(packet.estimates)) return;
	if (isStringArray(packet.estimates.criticalPath) && !sameStringArray(packet.estimates.criticalPath, graph.criticalPath)) add(errors, "critical-path-mismatch", "estimates.criticalPath must match the computed DAG critical path", "estimates.criticalPath");
	if (isStringMatrix(packet.estimates.parallelGroups) && !sameStringMatrix(packet.estimates.parallelGroups, graph.parallelGroups)) add(errors, "parallel-groups-mismatch", "estimates.parallelGroups must match the computed DAG parallel groups", "estimates.parallelGroups");
}

function renderTierPlan(packet: FanoutExecutionPacket): string {
	const lines = ["Tier/model plan", "===============", "", "Tier1 realtime", ...tierLines(packet.tierPlan.tier1), "", "Tier2 async", ...tierLines(packet.tierPlan.tier2)];
	if (packet.tierPlan.tier2.status === "unavailable") lines.push("", "Fallback", "  if tier2 unavailable: use tier1 for executable worker nodes");
	return `${lines.join("\n")}\n`;
}

function tierLines(tier: TierModelSummary & { fallback?: string }): string[] {
	const lines = [`  provider : ${tier.provider}`, `  model    : ${tier.model}`, `  thinking : ${tier.thinking}`, `  status   : ${tier.status}`, `  reason   : ${tier.reason}`];
	if (tier.fallback) lines.push(`  fallback : ${tier.fallback}`);
	return lines;
}

function renderAsciiDag(packet: FanoutExecutionPacket, validation: PacketValidationResult): string {
	const graph = validation.graph;
	if (!graph || packet.workUnits.length === 0) return "Execution flow\n==============\n\n(no executable work units)\n";
	const units = new Map(packet.workUnits.map((unit) => [unit.id, unit]));
	const lines = ["Execution flow", "==============", ""];
	let connectorAlreadyDrawn = false;
	graph.parallelGroups.forEach((group, groupIndex) => {
		const groupUnits = group.map((id) => units.get(id)).filter((unit): unit is FanoutWorkUnit => Boolean(unit));
		if (groupUnits.length === 0) return;
		if (groupIndex > 0 && !connectorAlreadyDrawn) {
			const previousGroup = graph.parallelGroups[groupIndex - 1] ?? [];
			if (groupUnits.length > 1 && previousGroup.length === 1 && hasEdgesToAll(graph, previousGroup[0], group)) lines.push(...branchConnector(groupUnits, "fork"));
			else if (groupUnits.length === 1) lines.push("        |", "        v");
			else lines.push("");
		}
		connectorAlreadyDrawn = false;
		if (groupUnits.length > 1) lines.push(...boxNodeRow(groupUnits), "");
		else lines.push(...boxNode(groupUnits[0]), "");
		const nextGroup = graph.parallelGroups[groupIndex + 1] ?? [];
		if (groupUnits.length > 1 && nextGroup.length === 1 && hasEdgesFromAll(graph, group, nextGroup[0])) {
			lines.push(...branchConnector(groupUnits, "join"));
			connectorAlreadyDrawn = true;
		}
	});
	return `${lines.join("\n").trimEnd()}\n`;
}

function hasEdgesFromAll(graph: ExecutionGraph, fromIds: string[], toId: string): boolean {
	return fromIds.every((id) => graph.edges.some(([from, to]) => from === id && to === toId));
}

function hasEdgesToAll(graph: ExecutionGraph, fromId: string, toIds: string[]): boolean {
	return toIds.every((id) => graph.edges.some(([from, to]) => from === fromId && to === id));
}

function boxNodeRow(units: FanoutWorkUnit[]): string[] {
	const boxes = units.map(boxNode);
	return boxes[0].map((_, row) => boxes.map((box) => box[row]).join("   "));
}

function branchConnector(units: FanoutWorkUnit[], direction: "fork" | "join"): string[] {
	const widths = units.map((unit) => boxNode(unit)[0].length);
	const centers: number[] = [];
	let offset = 0;
	for (const width of widths) {
		centers.push(offset + Math.floor(width / 2));
		offset += width + 3;
	}
	const width = offset - 3;
	const bar = Array(width).fill(" ");
	for (let index = centers[0]; index <= centers.at(-1)!; index++) bar[index] = "-";
	for (const center of centers) bar[center] = "+";
	const stems = Array(width).fill(" ");
	const arrows = Array(width).fill(" ");
	for (const center of centers) {
		stems[center] = "|";
		arrows[center] = "v";
	}
	const middle = centeredLine(width, "|");
	return direction === "fork"
		? [middle, centeredLine(width, "v"), bar.join(""), stems.join(""), arrows.join("")]
		: [stems.join(""), bar.join(""), middle, centeredLine(width, "v")];
}

function centeredLine(width: number, value: string): string {
	const line = Array(Math.max(1, width)).fill(" ");
	line[Math.floor(line.length / 2)] = value;
	return line.join("").trimEnd();
}

function boxNode(unit: FanoutWorkUnit): string[] {
	const content = [
		`[${unit.id}] ${unit.kind}`,
		`goal : ${shorten(unit.goal, 44)}`,
		`tier : ${unit.tier.assigned} ${shorten(unit.tier.model, 32)}`,
		`owns : ${shortPathList(unit.ownedFiles)}`,
	];
	const width = Math.max(...content.map((line) => line.length)) + 2;
	const border = `+${"-".repeat(width)}+`;
	return [border, ...content.map((line) => `| ${line.padEnd(width - 1)}|`), border];
}

function renderFilesSection(packet: FanoutExecutionPacket): string {
	const planned = unique(packet.workUnits.flatMap((unit) => unit.ownedFiles)).sort();
	const readOnly = unique(packet.workUnits.flatMap((unit) => unit.readOnlyFiles)).filter((file) => !planned.includes(file)).sort();
	return `### Planned writes\n${bullets(planned)}\n\n### Read-only context\n${bullets(readOnly)}\n`;
}

function renderMetrics(packet: FanoutExecutionPacket, validation: PacketValidationResult): string {
	const graph = validation.graph;
	const planned = unique(packet.workUnits.flatMap((unit) => unit.ownedFiles));
	const readOnly = unique(packet.workUnits.flatMap((unit) => unit.readOnlyFiles));
	const validationCommands = unique([...packet.finalValidationPlan, ...packet.workUnits.flatMap((unit) => unit.validationCommands)]);
	const tier1 = packet.workUnits.filter((unit) => unit.tier.assigned === "tier1").length;
	const tier2 = packet.workUnits.filter((unit) => unit.tier.assigned === "tier2").length;
	return twoColumnMetrics([
		["Work units", String(packet.workUnits.length)],
		["DAG depth", String(graph?.criticalPath.length ?? 0)],
		["Max parallel width", String(Math.max(0, ...(graph?.parallelGroups.map((group) => group.length) ?? [0])))],
		["Planned write files", String(planned.length)],
		["Read-only files", String(readOnly.length)],
		["Validation commands", String(validationCommands.length)],
		["Tier1 nodes", String(tier1)],
		["Tier2 nodes", String(tier2)],
		["Active wait", packet.estimates.activeWait],
		["Background work", packet.estimates.backgroundCompletion],
		["Tier plan", tier2 > 0 ? "mixed" : "tier1"],
		["Status", validation.executable ? "ready" : packet.status],
	]);
}

function twoColumnMetrics(items: Array<[string, string]>): string {
	const rows: string[] = [];
	for (let index = 0; index < items.length; index += 2) {
		const left = formatMetric(items[index]);
		const right = items[index + 1] ? formatMetric(items[index + 1]) : "";
		rows.push(`${left.padEnd(42)}${right}`.trimEnd());
	}
	return `${rows.join("\n")}\n`;
}

function formatMetric([label, value]: [string, string]): string {
	return `${label.padEnd(21)}${value}`;
}

function unsafeCommand(command: string): string | undefined {
	for (const [name, pattern] of UNSAFE_COMMANDS) if (pattern.test(command)) return name;
	return undefined;
}

function add(issues: PacketValidationIssue[], code: string, message: string, path?: string, unitId?: string): void {
	issues.push({ code, message, path, unitId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function normalizeFile(file: string): string {
	let normalized = file.trim().replace(/\\/g, "/");
	while (normalized.startsWith("./")) normalized = normalized.slice(2);
	return normalized.replace(/\/+$/g, "");
}

function pathsOverlap(left: string, right: string): boolean {
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function bullets(items: string[]): string {
	return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function shortPathList(paths: string[]): string {
	if (paths.length === 0) return "none";
	const joined = paths.map((path) => shortenPath(path)).join(", ");
	return shorten(joined, 44);
}

function shortenPath(path: string): string {
	const parts = path.split("/");
	if (parts.length <= 2) return path;
	return `${parts[0]}/.../${parts.at(-1)}`;
}

function shorten(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function escapeMermaid(value: string): string {
	return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}
