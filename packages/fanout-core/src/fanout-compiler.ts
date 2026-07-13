import { parseArtifactIdentity, parseGitCommitId, parseGitTreeId, type ArtifactIdentity } from "./artifact-identity.ts";
import { parseResource, resourcesOverlap, type Resource } from "./repository-resource.ts";
import { parseValidationCommands } from "./validation-command.ts";
import { compileWorkContracts, type GroundedWorkInput, type PlannedWorkSource } from "./work-contract-compiler.ts";
import { derivePreferredTier, deriveTierAssignment, validateExecutionPacket, EXECUTION_PACKET_SCHEMA, EXECUTION_PACKET_VERSION, type FanoutExecutionPacket, type FanoutRuntimePolicy, type FanoutTierPlan, type FanoutPacketNode, type WorkUnitKind } from "./execution-packet.ts";
import { FIXED_WORKER_CAPABILITIES, WORK_CONTRACT_SCHEMA, WORK_CONTRACT_VERSION, validateWorkContract, type AdvisoryNote, type ChangeIntent, type ForbiddenWrite, type WorkContractIssue, type WorkReadDependency } from "./work-contract.ts";

export const IMPLEMENTATION_PLAN_SCHEMA = "fanout.implementation-plan";
export const IMPLEMENTATION_PLAN_VERSION = 2;
export const IMPLEMENTATION_DETAILS_SCHEMA = "fanout.implementation-details";
export const IMPLEMENTATION_DETAILS_VERSION = 3;

export interface ImplementationPlan {
	schema: typeof IMPLEMENTATION_PLAN_SCHEMA;
	version: typeof IMPLEMENTATION_PLAN_VERSION;
	planId: string;
	createdAt: string;
	planningHost: { platform: NodeJS.Platform };
	planningBase: { headCommit: string; tree: string };
	objective: string;
	userContext: string[];
	discoveredRepoFacts: string[];
	assumptions: string[];
	implementationItems: PlannedWorkSource[];
}

export interface ImplementationDetails {
	schema: typeof IMPLEMENTATION_DETAILS_SCHEMA;
	version: typeof IMPLEMENTATION_DETAILS_VERSION;
	detailsId: string;
	createdAt: string;
	plan: ArtifactIdentity;
	items: GroundedWorkInput[];
	finalValidationCommands: ReturnType<typeof parseValidationCommands>;
}

export interface RequiredReadClassification {
	readerPlanId: string;
	readResource: Resource;
	ownerPlanId: string;
	ownerResource: Resource;
}

export interface CompileExecutionPacketInput {
	implementationPlan: unknown;
	implementationDetails: unknown;
	planIdentity: ArtifactIdentity;
	detailsIdentity: ArtifactIdentity;
	tierPlan: FanoutTierPlan;
	runtimePolicy: FanoutRuntimePolicy;
	sequentialReadFallback?: boolean;
	createdAt?: Date | string;
}

export interface CompileExecutionPacketResult { ok: boolean; errors: string[]; warnings: string[]; issues: WorkContractIssue[]; warningIssues: WorkContractIssue[]; packet?: FanoutExecutionPacket; }

const PLAN_FIELDS = new Set(["schema", "version", "planId", "createdAt", "planningHost", "planningBase", "objective", "userContext", "discoveredRepoFacts", "assumptions", "implementationItems"]);
const PLAN_ITEM_FIELDS = new Set(["id", "goals", "writeResources", "readResources", "forbiddenWrites", "semanticReviewCriteria", "advisoryNotes"]);
const DETAILS_FIELDS = new Set(["schema", "version", "detailsId", "createdAt", "plan", "items", "finalValidationCommands"]);
const DETAIL_ITEM_FIELDS = new Set(["id", "kind", "changes", "readDependencies", "forbiddenWrites", "validationCommands", "advisoryNotes"]);
export function validateImplementationPlan(value: unknown): { ok: boolean; errors: string[]; itemCount: number; plan?: ImplementationPlan } {
	const errors: string[] = [];
	const plan = parsePlan(value, errors);
	return { ok: errors.length === 0, errors, itemCount: plan?.implementationItems.length ?? 0, ...(errors.length || !plan ? {} : { plan }) };
}

export function validateImplementationDetailsArtifact(value: unknown, expected: { planIdentity?: ArtifactIdentity; planIds?: Iterable<string> } = {}): { ok: boolean; errors: string[]; itemCount: number; details?: ImplementationDetails } {
	const errors: string[] = [];
	const details = parseDetails(value, expected, errors);
	return { ok: errors.length === 0, errors, itemCount: details?.items.length ?? 0, ...(errors.length || !details ? {} : { details }) };
}

export function buildRequiredReadClassifications(value: unknown): RequiredReadClassification[] {
	const admitted = validateImplementationPlan(value);
	if (!admitted.plan) return [];
	const rows: RequiredReadClassification[] = [];
	for (const reader of admitted.plan.implementationItems) for (const readResource of reader.readResources) for (const owner of admitted.plan.implementationItems) {
		if (reader.id === owner.id) continue;
		for (const ownerResource of owner.writeResources) if (resourcesOverlap(readResource, ownerResource)) rows.push({ readerPlanId: reader.id, readResource, ownerPlanId: owner.id, ownerResource });
	}
	return rows;
}

export function compileExecutionPacket(input: CompileExecutionPacketInput): CompileExecutionPacketResult {
	const planResult = validateImplementationPlan(input.implementationPlan);
	const detailsResult = validateImplementationDetailsArtifact(input.implementationDetails, { planIdentity: input.planIdentity, planIds: planResult.plan?.implementationItems.map((item) => item.id) });
	const errors = [...planResult.errors, ...detailsResult.errors];
	if (!planResult.plan || !detailsResult.details || errors.length) return { ok: false, errors, warnings: [], issues: errors.map((message) => ({ code: "artifact-admission", message })), warningIssues: [] };
	const compiled = compileWorkContracts(planResult.plan.implementationItems, detailsResult.details.items, detailsResult.details.finalValidationCommands, { sequentialReadFallback: input.sequentialReadFallback });
	if (!compiled.ok) return { ok: false, errors: compiled.errors.map(showIssue), warnings: compiled.warnings.map(showIssue), issues: compiled.errors, warningIssues: compiled.warnings };
	const nodes: FanoutPacketNode[] = compiled.nodes.map((node) => {
		const tier = deriveTierAssignment(derivePreferredTier(node.kind as WorkUnitKind), input.tierPlan);
		return { id: node.id, kind: node.kind as WorkUnitKind, tier, active: tier.assigned === "tier2" ? "background" : "active", workContract: node.workContract };
	});
	const packetValue = {
		schema: EXECUTION_PACKET_SCHEMA,
		version: EXECUTION_PACKET_VERSION,
		createdAt: createdAt(input.createdAt),
		sourceArtifacts: { plan: input.planIdentity, details: input.detailsIdentity },
		planningHost: planResult.plan.planningHost,
		planningBase: planResult.plan.planningBase,
		objective: planResult.plan.objective,
		userContext: planResult.plan.userContext,
		discoveredRepoFacts: planResult.plan.discoveredRepoFacts,
		assumptions: planResult.plan.assumptions,
		tierPlan: input.tierPlan,
		runtimePolicy: input.runtimePolicy,
		nodes,
	};
	const admitted = validateExecutionPacket(packetValue);
	return admitted.packet ? { ok: true, errors: [], warnings: compiled.warnings.map(showIssue), issues: [], warningIssues: compiled.warnings, packet: admitted.packet } : { ok: false, errors: admitted.errors.map(showIssue), warnings: compiled.warnings.map(showIssue), issues: admitted.errors, warningIssues: compiled.warnings };
}

function parsePlan(value: unknown, errors: string[]): ImplementationPlan | undefined {
	if (!record(value)) { errors.push("implementation plan must be an object; rerun /fanout-plan"); return; }
	unknown(value, PLAN_FIELDS, "implementation plan", errors);
	if (value.schema !== IMPLEMENTATION_PLAN_SCHEMA || value.version !== IMPLEMENTATION_PLAN_VERSION) errors.push(`implementation plan must be ${IMPLEMENTATION_PLAN_SCHEMA} v${IMPLEMENTATION_PLAN_VERSION}; rerun /fanout-plan`);
	const planId = canonical(value.planId, "planId", errors);
	const created = iso(value.createdAt, "createdAt", errors);
	const planningHost = host(value.planningHost, errors);
	const planningBase = base(value.planningBase, errors);
	const objective = semantic(value.objective, "objective", errors);
	const userContext = strings(value.userContext, "userContext", errors);
	const discoveredRepoFacts = strings(value.discoveredRepoFacts, "discoveredRepoFacts", errors);
	const assumptions = strings(value.assumptions, "assumptions", errors);
	const implementationItems = Array.isArray(value.implementationItems) ? value.implementationItems.flatMap((item, index) => planItem(item, index, errors)) : (errors.push("implementationItems must be an array"), []);
	if (!implementationItems.length) errors.push("implementationItems must not be empty");
	if (new Set(implementationItems.map((item) => item.id)).size !== implementationItems.length) errors.push("implementation item ids must be unique");
	return planningHost && planningBase ? { schema: IMPLEMENTATION_PLAN_SCHEMA, version: IMPLEMENTATION_PLAN_VERSION, planId, createdAt: created, planningHost, planningBase, objective, userContext, discoveredRepoFacts, assumptions, implementationItems } : undefined;
}

function planItem(value: unknown, index: number, errors: string[]): PlannedWorkSource[] {
	const path = `implementationItems[${index}]`;
	if (!record(value)) { errors.push(`${path} must be an object`); return []; }
	unknown(value, PLAN_ITEM_FIELDS, path, errors);
	const id = canonical(value.id, `${path}.id`, errors);
	const goals = strings(value.goals, `${path}.goals`, errors);
	const writeResources = resources(value.writeResources, `${path}.writeResources`, errors);
	const readResources = resources(value.readResources, `${path}.readResources`, errors);
	const forbiddenWrites = forbiddenPlans(value.forbiddenWrites, `${path}.forbiddenWrites`, errors);
	const semanticReviewCriteria = strings(value.semanticReviewCriteria, `${path}.semanticReviewCriteria`, errors);
	const advisoryNotes = notes(value.advisoryNotes, `${path}.advisoryNotes`, errors, "phase-a");
	if (!goals.length || !semanticReviewCriteria.length) errors.push(`${path} needs goals and semanticReviewCriteria`);
	return [{ id, goals, writeResources, readResources, forbiddenWrites, semanticReviewCriteria, advisoryNotes }];
}

function parseDetails(value: unknown, expected: { planIdentity?: ArtifactIdentity; planIds?: Iterable<string> }, errors: string[]): ImplementationDetails | undefined {
	if (!record(value)) { errors.push("implementation details must be an object; rerun /fanout-plan"); return; }
	unknown(value, DETAILS_FIELDS, "implementation details", errors);
	if (value.schema !== IMPLEMENTATION_DETAILS_SCHEMA || value.version !== IMPLEMENTATION_DETAILS_VERSION) errors.push(`implementation details must be ${IMPLEMENTATION_DETAILS_SCHEMA} v${IMPLEMENTATION_DETAILS_VERSION}; rerun /fanout-plan`);
	const detailsId = canonical(value.detailsId, "detailsId", errors);
	const created = iso(value.createdAt, "createdAt", errors);
	let plan: ArtifactIdentity | undefined;
	try { plan = parseArtifactIdentity(value.plan); } catch (error) { errors.push(`invalid plan identity: ${message(error)}`); }
	if (plan && expected.planIdentity && JSON.stringify(plan) !== JSON.stringify(expected.planIdentity)) errors.push("implementation details plan identity does not match the accepted plan bytes; rerun /fanout-plan");
	const planIds = new Set(expected.planIds ?? []);
	const items = Array.isArray(value.items) ? value.items.flatMap((item, index) => detailItem(item, index, planIds, errors)) : (errors.push("items must be an array"), []);
	let finalValidationCommands: ReturnType<typeof parseValidationCommands> = [];
	try { finalValidationCommands = parseValidationCommands(value.finalValidationCommands); } catch (error) { errors.push(`invalid final validation commands: ${message(error)}`); }
	if (!items.length || !finalValidationCommands.length) errors.push("details need grounded items and finalValidationCommands");
	return plan ? { schema: IMPLEMENTATION_DETAILS_SCHEMA, version: IMPLEMENTATION_DETAILS_VERSION, detailsId, createdAt: created, plan, items, finalValidationCommands } : undefined;
}

function detailItem(value: unknown, index: number, planIds: Set<string>, errors: string[]): GroundedWorkInput[] {
	const path = `items[${index}]`;
	if (!record(value)) { errors.push(`${path} must be an object`); return []; }
	unknown(value, DETAIL_ITEM_FIELDS, path, errors);
	const id = canonical(value.id, `${path}.id`, errors);
	const kind = canonical(value.kind, `${path}.kind`, errors);
	const detailNotes = notes(value.advisoryNotes, `${path}.advisoryNotes`, errors, "phase-b");
	const admitted = validateWorkContract({
		schema: WORK_CONTRACT_SCHEMA,
		version: WORK_CONTRACT_VERSION,
		goals: [{ sourcePlanId: "details-admission", statement: "Validate grounded detail fields." }],
		changes: value.changes,
		readDependencies: value.readDependencies,
		forbiddenWrites: value.forbiddenWrites,
		validationCommands: value.validationCommands,
		capabilities: FIXED_WORKER_CAPABILITIES,
		semanticReviewCriteria: [{ sourcePlanId: "details-admission", statement: "Grounded detail fields are strict." }],
		advisoryNotes: detailNotes,
	});
	if (!admitted.contract) { for (const issue of admitted.errors) errors.push(`${path}.${issue.path ?? "workContract"}: ${issue.code}: ${issue.message}`); return []; }
	const { changes, readDependencies, forbiddenWrites, validationCommands, advisoryNotes } = admitted.contract;
	if (!validationCommands.length) errors.push(`${path}.validationCommands must not be empty`);
	for (const source of sourceIds(changes, readDependencies, forbiddenWrites)) if (planIds.size && !planIds.has(source)) errors.push(`${path} references unknown source plan id ${source}`);
	return [{ id, kind, changes, readDependencies, forbiddenWrites, validationCommands, advisoryNotes }];
}

function host(value: unknown, errors: string[]): ImplementationPlan["planningHost"] | undefined { if (!exact(value, ["platform"]) || typeof value.platform !== "string") { errors.push("planningHost must contain platform only"); return; } return { platform: value.platform as NodeJS.Platform }; }
function base(value: unknown, errors: string[]): ImplementationPlan["planningBase"] | undefined { try { if (!exact(value, ["headCommit", "tree"])) throw new TypeError("planningBase has unknown or missing fields"); return { headCommit: parseGitCommitId(value.headCommit), tree: parseGitTreeId(value.tree) }; } catch (error) { errors.push(`invalid planningBase: ${message(error)}`); } }
function resources(value: unknown, path: string, errors: string[]): Resource[] { if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return []; } return value.flatMap((item, index) => { try { return [parseResource(item)]; } catch (error) { errors.push(`${path}[${index}]: ${message(error)}`); return []; } }); }
function forbiddenPlans(value: unknown, path: string, errors: string[]): Array<{ resource: Resource; reason: string }> { if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return []; } return value.flatMap((item, index) => { if (!exact(item, ["resource", "reason"])) { errors.push(`${path}[${index}] has unknown or missing fields`); return []; } try { return [{ resource: parseResource(item.resource), reason: semantic(item.reason, `${path}[${index}].reason`, errors) }]; } catch (error) { errors.push(`${path}[${index}].resource: ${message(error)}`); return []; } }); }
function notes(value: unknown, path: string, errors: string[], phase: "phase-a" | "phase-b"): AdvisoryNote[] { if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return []; } return value.flatMap((item, index) => { if (!exact(item, ["kind", "reference", "text"])) { errors.push(`${path}[${index}] has unknown or missing fields`); return []; } if (!new Set(["rationale", "risk", "validation-intent", "constraint", "context"]).has(String(item.kind))) { errors.push(`${path}[${index}].kind is invalid`); return []; } return [{ kind: item.kind as AdvisoryNote["kind"], source: { phase, reference: canonical(item.reference, `${path}[${index}].reference`, errors) }, text: semantic(item.text, `${path}[${index}].text`, errors) }]; }); }
function sourceIds(changes: ChangeIntent[], reads: WorkReadDependency[], forbidden: ForbiddenWrite[]): string[] { return [...changes.flatMap((change) => change.kind === "move" ? [...change.from.sourcePlanIds, ...change.to.sourcePlanIds] : change.target.sourcePlanIds), ...reads.flatMap((read) => read.sourcePlanIds), ...forbidden.flatMap((item) => item.sourcePlanIds)]; }
function strings(value: unknown, path: string, errors: string[]): string[] { if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return []; } return value.map((item, index) => semantic(item, `${path}[${index}]`, errors)); }
function semantic(value: unknown, path: string, errors: string[]): string { if (typeof value !== "string" || !value.trim() || /\p{Cc}/u.test(value)) { errors.push(`${path} must be non-empty without controls`); return "invalid"; } return value; }
function canonical(value: unknown, path: string, errors: string[]): string { const result = semantic(value, path, errors); if (typeof value === "string" && value !== value.trim()) errors.push(`${path} must be canonical`); return result; }
function iso(value: unknown, path: string, errors: string[]): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) { errors.push(`${path} must be an ISO timestamp`); return new Date(0).toISOString(); } return value; }
function createdAt(value: Date | string | undefined): string { return value instanceof Date ? value.toISOString() : typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString(); }
function unknown(value: Record<string, unknown>, fields: Set<string>, path: string, errors: string[]): void { for (const field of Object.keys(value)) if (!fields.has(field)) errors.push(`${path} has unknown field ${field}`); }
function exact(value: unknown, fields: string[]): value is Record<string, unknown> { return record(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function showIssue(issue: { code: string; message: string; path?: string }): string { return `${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ""}`; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
