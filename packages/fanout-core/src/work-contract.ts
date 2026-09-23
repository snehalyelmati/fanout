import { parseResource, resourcesOverlap, type Resource } from "./repository-resource.ts";
import { parseValidationCommands, type ValidationCommand } from "./validation-command.ts";

export const WORK_CONTRACT_SCHEMA = "fanout.work-contract";
export const WORK_CONTRACT_VERSION = 6;

export type AdvisoryValidationMode = "fail-fast" | "collect-independent";

export function parseAdvisoryValidationMode(value: unknown): AdvisoryValidationMode {
	if (value !== "fail-fast" && value !== "collect-independent") throw new TypeError("advisoryValidationMode must be fail-fast or collect-independent");
	return value;
}

export type WorkAnchor =
	| { kind: "symbol"; symbol: string }
	| { kind: "section"; section: string }
	| { kind: "stable-text"; text: string }
	| { kind: "line-range-hint"; start: number; end: number };

export interface AuthorizedEndpoint {
	resource: Resource;
	sourcePlanIds: string[];
}

export type ChangeIntent =
	| { kind: "modify"; target: AuthorizedEndpoint; intent: string; anchors: WorkAnchor[] }
	| { kind: "create"; target: AuthorizedEndpoint; contentIntent: string; intendedSections?: string[]; intendedShape?: string }
	| { kind: "delete"; target: AuthorizedEndpoint; reason: string }
	| { kind: "move"; from: AuthorizedEndpoint; to: AuthorizedEndpoint; intent: string };

export interface WorkReadDependency {
	resource: Resource;
	timing: "baseline-context" | "post-change-required";
	timingSource: "phase-b" | "sequential-fallback";
	sourcePlanIds: string[];
	reason: string;
}

export interface ForbiddenWrite {
	resource: Resource;
	sourcePlanIds: string[];
	reason: string;
}

export interface SourceLinkedStatement {
	sourcePlanId: string;
	statement: string;
}

export type AdvisoryNoteKind = "rationale" | "risk" | "validation-intent" | "constraint" | "context";
export interface AdvisoryNote {
	kind: AdvisoryNoteKind;
	source: { phase: "phase-a" | "phase-b" | "compiler"; reference: string };
	text: string;
}

const FIXED_MODEL_TOOLS = Object.freeze(["read", "grep", "find", "ls", "edit", "write", "fanout_validate"] as const);
export const FIXED_WORKER_CAPABILITIES = Object.freeze({
	modelCallableTools: FIXED_MODEL_TOOLS,
	validationExecution: "worker-advisory-controller-authoritative" as const,
	shell: "unavailable" as const,
	extensionTools: "fanout-validate-only" as const,
});

export interface WorkContract {
	schema: typeof WORK_CONTRACT_SCHEMA;
	version: typeof WORK_CONTRACT_VERSION;
	goals: SourceLinkedStatement[];
	changes: ChangeIntent[];
	readDependencies: WorkReadDependency[];
	forbiddenWrites: ForbiddenWrite[];
	validationCommands: ValidationCommand[];
	advisoryValidationMode: AdvisoryValidationMode;
	capabilities: typeof FIXED_WORKER_CAPABILITIES;
	semanticReviewCriteria: SourceLinkedStatement[];
	advisoryNotes: AdvisoryNote[];
}

export interface WorkContractNode {
	id: string;
	kind: string;
	workContract: WorkContract;
}

export interface WorkContractIssue {
	code: string;
	message: string;
	path?: string;
}

const CONTRACT_FIELDS = new Set(["schema", "version", "goals", "changes", "readDependencies", "forbiddenWrites", "validationCommands", "advisoryValidationMode", "capabilities", "semanticReviewCriteria", "advisoryNotes"]);
const CAPABILITY_FIELDS = new Set(["modelCallableTools", "validationExecution", "shell", "extensionTools"]);
const CAPABILITY_TOOLS = [...FIXED_WORKER_CAPABILITIES.modelCallableTools];
const NOTE_KINDS = new Set(["rationale", "risk", "validation-intent", "constraint", "context"]);
const CHANGE_FIELDS = {
	modify: new Set(["kind", "target", "intent", "anchors"]),
	create: new Set(["kind", "target", "contentIntent", "intendedSections", "intendedShape"]),
	delete: new Set(["kind", "target", "reason"]),
	move: new Set(["kind", "from", "to", "intent"]),
};

// Empty commands require caller-verified profile-backed final validation or derived final-repair context.
export function validateWorkContract(value: unknown, options: { finalValidation?: boolean; allowEmptyValidation?: boolean } = {}): { ok: boolean; errors: WorkContractIssue[]; contract?: WorkContract } {
	const errors: WorkContractIssue[] = [];
	if (!isRecord(value)) return { ok: false, errors: [{ code: "contract-not-object", message: "work contract must be an object" }] };
	unknownFields(value, CONTRACT_FIELDS, "", errors);
	if (value.schema !== WORK_CONTRACT_SCHEMA) add(errors, "invalid-schema", `schema must be ${WORK_CONTRACT_SCHEMA}`, "schema");
	if (value.version !== WORK_CONTRACT_VERSION) add(errors, "invalid-version", `version must be ${WORK_CONTRACT_VERSION}`, "version");
	const goals = sourceStatements(value.goals, "goals", errors);
	const changes = changeIntents(value.changes, "changes", errors);
	const readDependencies = reads(value.readDependencies, "readDependencies", errors);
	const forbiddenWrites = forbiddens(value.forbiddenWrites, "forbiddenWrites", errors);
	let validationCommands: ValidationCommand[] = [];
	try { validationCommands = parseValidationCommands(value.validationCommands); }
	catch (error) { add(errors, "invalid-validation-command", errorMessage(error), "validationCommands"); }
	let advisoryValidationMode: AdvisoryValidationMode = "fail-fast";
	try { advisoryValidationMode = parseAdvisoryValidationMode(value.advisoryValidationMode); }
	catch (error) { add(errors, "invalid-advisory-validation-mode", errorMessage(error), "advisoryValidationMode"); }
	validateCapabilities(value.capabilities, errors);
	const semanticReviewCriteria = sourceStatements(value.semanticReviewCriteria, "semanticReviewCriteria", errors);
	const advisoryNotes = notes(value.advisoryNotes, "advisoryNotes", errors);

	if (goals.length === 0) add(errors, "missing-goal", "work contract needs at least one source-linked goal", "goals");
	if (semanticReviewCriteria.length === 0) add(errors, "missing-criterion", "work contract needs at least one source-linked semantic review criterion", "semanticReviewCriteria");
	if (options.finalValidation) {
		if (advisoryValidationMode !== "fail-fast") add(errors, "final-validation-mode", "final-validation contract must use fail-fast", "advisoryValidationMode");
		if (changes.length) add(errors, "final-validation-writes", "final-validation contract must not contain changes", "changes");
		if (validationCommands.length === 0 && !options.allowEmptyValidation) add(errors, "missing-final-validation", "final-validation contract needs commands", "validationCommands");
	} else if (changes.length > 0 && validationCommands.length === 0 && !options.allowEmptyValidation) {
		add(errors, "missing-validation", "a mutating work contract needs validation commands", "validationCommands");
	}
	validateChangeExistence(changes, errors);
	const writeResources = changeWriteResources(changes);
	for (const [index, forbidden] of forbiddenWrites.entries()) if (writeResources.some((write) => resourcesOverlap(write, forbidden.resource))) {
		add(errors, "write-forbidden-overlap", `${show(forbidden.resource)} overlaps a typed change endpoint`, `forbiddenWrites[${index}]`);
	}
	if (errors.length) return { ok: false, errors };
	return { ok: true, errors, contract: { schema: WORK_CONTRACT_SCHEMA, version: WORK_CONTRACT_VERSION, goals, changes, readDependencies, forbiddenWrites, validationCommands, advisoryValidationMode, capabilities: FIXED_WORKER_CAPABILITIES, semanticReviewCriteria, advisoryNotes } };
}

export function changeWriteResources(changes: readonly ChangeIntent[]): Resource[] {
	return uniqueResources(changeEndpoints(changes).map((endpoint) => endpoint.resource));
}

export function contractWriteResources(contract: WorkContract): Resource[] {
	return changeWriteResources(contract.changes);
}

function changeIntents(value: unknown, path: string, errors: WorkContractIssue[]): ChangeIntent[] {
	if (!Array.isArray(value)) { add(errors, "invalid-change-list", "changes must be an array", path); return []; }
	return value.flatMap<ChangeIntent>((change, index) => {
		const current = `${path}[${index}]`;
		if (!isRecord(change) || typeof change.kind !== "string" || !(change.kind in CHANGE_FIELDS)) { add(errors, "invalid-change-kind", "change kind must be modify, create, delete, or move", current); return []; }
		unknownFields(change, CHANGE_FIELDS[change.kind as keyof typeof CHANGE_FIELDS], current, errors);
		if (change.kind === "modify") {
			const anchors = anchorList(change.anchors, `${current}.anchors`, errors);
			const target = endpoint(change.target, `${current}.target`, errors);
			if (target.resource.kind === "file" && !anchors.some((anchor) => anchor.kind !== "line-range-hint")) add(errors, "missing-stable-anchor", "file modify requires a non-line stable anchor", `${current}.anchors`);
			return [{ kind: "modify" as const, target, intent: semanticText(change.intent, `${current}.intent`, errors), anchors }];
		}
		if (change.kind === "create") return [{ kind: "create" as const, target: endpoint(change.target, `${current}.target`, errors), contentIntent: semanticText(change.contentIntent, `${current}.contentIntent`, errors), ...(change.intendedSections === undefined ? {} : { intendedSections: semanticStrings(change.intendedSections, `${current}.intendedSections`, errors) }), ...(change.intendedShape === undefined ? {} : { intendedShape: semanticText(change.intendedShape, `${current}.intendedShape`, errors) }) }];
		if (change.kind === "delete") return [{ kind: "delete" as const, target: endpoint(change.target, `${current}.target`, errors), reason: semanticText(change.reason, `${current}.reason`, errors) }];
		const from = endpoint(change.from, `${current}.from`, errors); const to = endpoint(change.to, `${current}.to`, errors);
		if (from.resource.kind !== to.resource.kind) add(errors, "move-kind-change", "move endpoints must use the same resource kind", current);
		if (from.resource.kind === to.resource.kind && from.resource.path === to.resource.path) add(errors, "move-same-endpoint", "move endpoints must be distinct", current);
		return [{ kind: "move" as const, from, to, intent: semanticText(change.intent, `${current}.intent`, errors) }];
	});
}

function validateChangeExistence(changes: readonly ChangeIntent[], errors: WorkContractIssue[]): void {
	const requirements = new Map<string, [boolean, boolean]>();
	for (const [index, change] of changes.entries()) {
		const endpoints: Array<[Resource, boolean, boolean]> = change.kind === "move"
			? [[change.from.resource, true, false], [change.to.resource, false, true]]
			: [[change.target.resource, change.kind !== "create", change.kind !== "delete"]];
		for (const [resource, before, after] of endpoints) {
			const key = `${resource.kind}\0${resource.path}`;
			const previous = requirements.get(key);
			if (previous && (previous[0] !== before || previous[1] !== after)) add(errors, "contradictory-change-intent", `${show(resource)} has incompatible before/after existence requirements`, `changes[${index}]`);
			else requirements.set(key, [before, after]);
		}
	}
}

function endpoint(value: unknown, path: string, errors: WorkContractIssue[]): AuthorizedEndpoint {
	if (!isRecord(value)) { add(errors, "invalid-endpoint", "endpoint must be an object", path); return { resource: fallbackResource(), sourcePlanIds: [] }; }
	unknownFields(value, new Set(["resource", "sourcePlanIds"]), path, errors);
	let resource = fallbackResource();
	try { resource = parseResource(value.resource); } catch (error) { add(errors, "invalid-resource", errorMessage(error), `${path}.resource`); }
	const sourcePlanIds = ids(value.sourcePlanIds, `${path}.sourcePlanIds`, errors);
	return { resource, sourcePlanIds };
}

function reads(value: unknown, path: string, errors: WorkContractIssue[]): WorkReadDependency[] {
	if (!Array.isArray(value)) { add(errors, "invalid-read-list", "readDependencies must be an array", path); return []; }
	return value.flatMap((read, index) => {
		const current = `${path}[${index}]`;
		if (!isRecord(read)) { add(errors, "invalid-read", "read dependency must be an object", current); return []; }
		unknownFields(read, new Set(["resource", "timing", "timingSource", "sourcePlanIds", "reason"]), current, errors);
		let resource = fallbackResource(); try { resource = parseResource(read.resource); } catch (error) { add(errors, "invalid-resource", errorMessage(error), `${current}.resource`); }
		if (read.timing !== "baseline-context" && read.timing !== "post-change-required") add(errors, "invalid-read-timing", "timing must be baseline-context or post-change-required", `${current}.timing`);
		if (read.timingSource !== "phase-b" && read.timingSource !== "sequential-fallback") add(errors, "invalid-timing-source", "timingSource must be phase-b or sequential-fallback", `${current}.timingSource`);
		return [{ resource, timing: read.timing as WorkReadDependency["timing"], timingSource: read.timingSource as WorkReadDependency["timingSource"], sourcePlanIds: ids(read.sourcePlanIds, `${current}.sourcePlanIds`, errors), reason: semanticText(read.reason, `${current}.reason`, errors) }];
	});
}

function forbiddens(value: unknown, path: string, errors: WorkContractIssue[]): ForbiddenWrite[] {
	if (!Array.isArray(value)) { add(errors, "invalid-forbidden-list", "forbiddenWrites must be an array", path); return []; }
	return value.flatMap((entry, index) => {
		const current = `${path}[${index}]`;
		if (!isRecord(entry)) { add(errors, "invalid-forbidden", "forbidden write must be an object", current); return []; }
		unknownFields(entry, new Set(["resource", "sourcePlanIds", "reason"]), current, errors);
		let resource = fallbackResource(); try { resource = parseResource(entry.resource); } catch (error) { add(errors, "invalid-resource", errorMessage(error), `${current}.resource`); }
		return [{ resource, sourcePlanIds: ids(entry.sourcePlanIds, `${current}.sourcePlanIds`, errors), reason: semanticText(entry.reason, `${current}.reason`, errors) }];
	});
}

function anchorList(value: unknown, path: string, errors: WorkContractIssue[]): WorkAnchor[] {
	if (!Array.isArray(value)) { add(errors, "invalid-anchor-list", "anchors must be an array", path); return []; }
	return value.flatMap((anchor, index) => {
		const current = `${path}[${index}]`;
		if (!isRecord(anchor) || !["symbol", "section", "stable-text", "line-range-hint"].includes(String(anchor.kind))) { add(errors, "invalid-anchor-kind", "unknown anchor kind", current); return []; }
		if (anchor.kind === "line-range-hint") {
			unknownFields(anchor, new Set(["kind", "start", "end"]), current, errors);
			if (!Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) || Number(anchor.start) < 1 || Number(anchor.end) < Number(anchor.start)) add(errors, "invalid-line-range", "line range must use positive ordered integers", current);
			return [{ kind: "line-range-hint" as const, start: Number(anchor.start), end: Number(anchor.end) }];
		}
		const field = anchor.kind === "stable-text" ? "text" : anchor.kind as "symbol" | "section";
		unknownFields(anchor, new Set(["kind", field]), current, errors);
		return [{ kind: anchor.kind, [field]: semanticText(anchor[field], `${current}.${field}`, errors) } as WorkAnchor];
	});
}

function notes(value: unknown, path: string, errors: WorkContractIssue[]): AdvisoryNote[] {
	if (!Array.isArray(value)) { add(errors, "invalid-note-list", "advisoryNotes must be an array", path); return []; }
	return value.flatMap((note, index) => {
		const current = `${path}[${index}]`;
		if (!isRecord(note)) { add(errors, "invalid-note", "advisory note must be an object", current); return []; }
		unknownFields(note, new Set(["kind", "source", "text"]), current, errors);
		if (!NOTE_KINDS.has(String(note.kind))) add(errors, "invalid-note-kind", "unknown advisory note kind", `${current}.kind`);
		if (!isRecord(note.source)) add(errors, "invalid-note-source", "advisory note source must be an object", `${current}.source`);
		else {
			unknownFields(note.source, new Set(["phase", "reference"]), `${current}.source`, errors);
			if (!["phase-a", "phase-b", "compiler"].includes(String(note.source.phase))) add(errors, "invalid-note-phase", "unknown advisory note source phase", `${current}.source.phase`);
			semanticText(note.source.reference, `${current}.source.reference`, errors);
		}
		return [{ kind: note.kind as AdvisoryNoteKind, source: { phase: (isRecord(note.source) ? note.source.phase : "compiler") as AdvisoryNote["source"]["phase"], reference: isRecord(note.source) && typeof note.source.reference === "string" ? note.source.reference : "invalid" }, text: semanticText(note.text, `${current}.text`, errors) }];
	});
}

function sourceStatements(value: unknown, path: string, errors: WorkContractIssue[]): SourceLinkedStatement[] {
	if (!Array.isArray(value)) { add(errors, "invalid-statement-list", `${path} must be an array`, path); return []; }
	return value.flatMap((entry, index) => {
		const current = `${path}[${index}]`;
		if (!isRecord(entry)) { add(errors, "invalid-statement", "source-linked statement must be an object", current); return []; }
		unknownFields(entry, new Set(["sourcePlanId", "statement"]), current, errors);
		return [{ sourcePlanId: canonicalText(entry.sourcePlanId, `${current}.sourcePlanId`, errors), statement: semanticText(entry.statement, `${current}.statement`, errors) }];
	});
}

function validateCapabilities(value: unknown, errors: WorkContractIssue[]): void {
	if (!isRecord(value)) { add(errors, "invalid-capabilities", "capabilities must be an object", "capabilities"); return; }
	unknownFields(value, CAPABILITY_FIELDS, "capabilities", errors);
	if (JSON.stringify(value.modelCallableTools) !== JSON.stringify(CAPABILITY_TOOLS) || value.validationExecution !== "worker-advisory-controller-authoritative" || value.shell !== "unavailable" || value.extensionTools !== "fanout-validate-only") add(errors, "capability-profile-mismatch", "capabilities must match the fixed worker profile", "capabilities");
}

function ids(value: unknown, path: string, errors: WorkContractIssue[]): string[] {
	if (!Array.isArray(value) || value.length === 0) { add(errors, "missing-source-plan-id", "sourcePlanIds must be a non-empty array", path); return []; }
	const result = value.map((entry, index) => canonicalText(entry, `${path}[${index}]`, errors));
	if (new Set(result).size !== result.length) add(errors, "duplicate-source-plan-id", "sourcePlanIds must not contain duplicates", path);
	return result;
}

function changeEndpoints(changes: readonly ChangeIntent[]): AuthorizedEndpoint[] {
	return changes.flatMap((change) => change.kind === "move" ? [change.from, change.to] : [change.target]);
}
function uniqueResources(values: readonly Resource[]): Resource[] { return [...new Map(values.map((resource) => [`${resource.kind}\0${resource.path}`, resource])).values()]; }
function semanticStrings(value: unknown, path: string, errors: WorkContractIssue[]): string[] { if (!Array.isArray(value)) { add(errors, "invalid-string-list", `${path} must be an array`, path); return []; } return value.map((entry, index) => semanticText(entry, `${path}[${index}]`, errors)); }
function semanticText(value: unknown, path: string, errors: WorkContractIssue[]): string { if (!semantic(value)) { add(errors, "invalid-semantic-text", "semantic text must be non-empty and contain no controls", path); return "invalid"; } return value; }
function canonicalText(value: unknown, path: string, errors: WorkContractIssue[]): string { if (!canonicalId(value)) { add(errors, "invalid-canonical-text", "value must be a non-empty canonical string", path); return "invalid"; } return value; }
function semantic(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && !/\p{Cc}/u.test(value); }
function canonicalId(value: unknown): value is string { return semantic(value) && value === value.trim(); }
function fallbackResource(): Resource { return { kind: "file", path: "invalid" as Resource["path"] }; }
function show(resource: Resource): string { return `${resource.kind}:${resource.path}`; }
function unknownFields(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: WorkContractIssue[]): void { for (const field of Object.keys(value)) if (!allowed.has(field)) add(errors, "unknown-field", `unknown field ${field}`, path ? `${path}.${field}` : field); }
function add(errors: WorkContractIssue[], code: string, message: string, path?: string): void { errors.push({ code, message, ...(path ? { path } : {}) }); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
