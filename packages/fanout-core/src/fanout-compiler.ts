import { isDeepStrictEqual } from "node:util";
import { parseArtifactIdentity, parseGitCommitId, parseGitTreeId, type ArtifactIdentity } from "./artifact-identity.ts";
import { parseResource, resourcesOverlap, type Resource } from "./repository-resource.ts";
import {
	IMPLEMENTATION_DETAILS_SCHEMA,
	IMPLEMENTATION_DETAILS_VERSION,
	IMPLEMENTATION_PLAN_SCHEMA,
	IMPLEMENTATION_PLAN_VERSION,
	ImplementationDetailsArtifactSchema,
	ImplementationPlanArtifactSchema,
	planningSchemaErrors,
} from "./planning-artifact-schema.ts";
import { parseValidationCommands } from "./validation-command.ts";
import type { ProjectExecutionProfile } from "./project-execution-profile.ts";
import { compileWorkContracts, type GroundedWorkInput, type PlannedWorkSource } from "./work-contract-compiler.ts";
import { derivePreferredTier, deriveTierAssignment, validateExecutionPacket, EXECUTION_PACKET_SCHEMA, EXECUTION_PACKET_VERSION, type FanoutExecutionPacket, type FanoutRuntimePolicy, type FanoutTierPlan, type FanoutPacketNode, type WorkUnitKind } from "./execution-packet.ts";
import { FIXED_WORKER_CAPABILITIES, WORK_CONTRACT_SCHEMA, WORK_CONTRACT_VERSION, validateWorkContract, type AdvisoryNote, type ChangeIntent, type WorkContractIssue, type WorkReadDependency } from "./work-contract.ts";
import { FINAL_VALIDATION_NODE_ID } from "./work-contract-graph.ts";
import { fuseVerticalSerialChains } from "./vertical-chain-fusion.ts";

export { IMPLEMENTATION_DETAILS_SCHEMA, IMPLEMENTATION_DETAILS_VERSION, IMPLEMENTATION_PLAN_SCHEMA, IMPLEMENTATION_PLAN_VERSION };

export interface ImplementationPlan {
	schema: typeof IMPLEMENTATION_PLAN_SCHEMA;
	version: typeof IMPLEMENTATION_PLAN_VERSION;
	planId: string;
	createdAt: string;
	planningHost: { platform: NodeJS.Platform };
	planningBase: { headCommit: string; tree: string };
	profile: ArtifactIdentity;
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
	profile?: ProjectExecutionProfile;
	sequentialReadFallback?: boolean;
	createdAt?: Date | string;
}

export interface CompileExecutionPacketResult { ok: boolean; errors: string[]; warnings: string[]; issues: WorkContractIssue[]; warningIssues: WorkContractIssue[]; packet?: FanoutExecutionPacket; }

export function validateImplementationPlan(value: unknown): { ok: boolean; errors: string[]; itemCount: number; plan?: ImplementationPlan } {
	const errors = planningSchemaErrors(ImplementationPlanArtifactSchema, value);
	const plan = errors.length ? undefined : parsePlan(value as Record<string, unknown>, errors);
	return { ok: errors.length === 0, errors, itemCount: plan?.implementationItems.length ?? 0, ...(errors.length || !plan ? {} : { plan }) };
}

export function validateImplementationDetailsArtifact(value: unknown, expected: { planIdentity?: ArtifactIdentity; planIds?: Iterable<string>; plan?: ImplementationPlan; profile?: ProjectExecutionProfile } = {}): { ok: boolean; errors: string[]; itemCount: number; details?: ImplementationDetails } {
	const errors = planningSchemaErrors(ImplementationDetailsArtifactSchema, value);
	const planIds = expected.plan?.implementationItems.map((item) => item.id) ?? expected.planIds;
	const details = errors.length ? undefined : parseDetails(value as Record<string, unknown>, { planIdentity: expected.planIdentity, planIds }, errors);
	if (details && expected.profile) errors.push(...profileGateDuplicateErrors(details, expected.profile));
	if (details && details.finalValidationCommands.length === 0 && !expected.profile?.requiredFinalGates.length) errors.push("finalValidationCommands may be empty only when the exact bound Project Execution Profile supplies at least one required final gate");
	return { ok: errors.length === 0, errors, itemCount: details?.items.length ?? 0, ...(errors.length || !details ? {} : { details }) };
}

function profileGateDuplicateErrors(details: ImplementationDetails, profile: ProjectExecutionProfile): string[] {
	const gates = profile.requiredFinalGates.map((entry) => entry.command);
	const duplicate = (command: ImplementationDetails["finalValidationCommands"][number]) => gates.findIndex((gate) => isDeepStrictEqual({ ...command, env: command.env ?? {} }, { ...gate, env: gate.env ?? {} }));
	const errors = details.items.flatMap((item, itemIndex) => item.validationCommands.flatMap((command, commandIndex) => {
		const gateIndex = duplicate(command);
		return gateIndex < 0 ? [] : [`items[${itemIndex}].validationCommands[${commandIndex}] duplicates Project Execution Profile requiredFinalGates[${gateIndex}].command`];
	}));
	for (const [commandIndex, command] of details.finalValidationCommands.entries()) {
		const gateIndex = duplicate(command);
		if (gateIndex >= 0) errors.push(`finalValidationCommands[${commandIndex}] duplicates Project Execution Profile requiredFinalGates[${gateIndex}].command`);
	}
	return errors.length ? [...errors, "remove each duplicate when another focused check remains, otherwise replace it with a focused task-specific check, then resubmit this Phase B artifact draft"] : [];
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
	const detailsResult = validateImplementationDetailsArtifact(input.implementationDetails, { planIdentity: input.planIdentity, plan: planResult.plan, profile: input.profile });
	const errors = [...planResult.errors, ...detailsResult.errors];
	if (!planResult.plan || !detailsResult.details || errors.length) return { ok: false, errors, warnings: [], issues: errors.map((message) => ({ code: "artifact-admission", message })), warningIssues: [] };
	const compiled = compileWorkContracts(planResult.plan.implementationItems, detailsResult.details.items, detailsResult.details.finalValidationCommands, { sequentialReadFallback: input.sequentialReadFallback, profileFinalGateCount: input.profile?.requiredFinalGates.length });
	if (!compiled.ok) return { ok: false, errors: compiled.errors.map(showIssue), warnings: compiled.warnings.map(showIssue), issues: compiled.errors, warningIssues: compiled.warnings };
	const initialNodes: FanoutPacketNode[] = compiled.nodes.map((node) => {
		const tier = deriveTierAssignment(derivePreferredTier(node.kind as WorkUnitKind), input.tierPlan);
		return { id: node.id, kind: node.kind as WorkUnitKind, tier, active: tier.assigned === "tier2" ? "background" : "active", workContract: node.workContract };
	});
	const nodes = fuseVerticalSerialChains(initialNodes, compiled.graph!);
	const packetValue = {
		schema: EXECUTION_PACKET_SCHEMA,
		version: EXECUTION_PACKET_VERSION,
		createdAt: createdAt(input.createdAt),
		sourceArtifacts: { plan: input.planIdentity, details: input.detailsIdentity },
		profile: planResult.plan.profile,
		planningHost: planResult.plan.planningHost,
		planningBase: planResult.plan.planningBase,
		objective: planResult.plan.objective,
		userContext: planResult.plan.userContext,
		discoveredRepoFacts: planResult.plan.discoveredRepoFacts,
		assumptions: planResult.plan.assumptions,
		tierPlan: input.tierPlan,
		runtimePolicy: input.runtimePolicy,
		compilationPolicy: { sequentialReadFallback: input.sequentialReadFallback ?? false },
		nodes,
	};
	const admitted = validateExecutionPacket(packetValue);
	return admitted.packet ? { ok: true, errors: [], warnings: compiled.warnings.map(showIssue), issues: [], warningIssues: compiled.warnings, packet: admitted.packet } : { ok: false, errors: admitted.errors.map(showIssue), warnings: compiled.warnings.map(showIssue), issues: admitted.errors, warningIssues: compiled.warnings };
}

function parsePlan(value: Record<string, unknown>, errors: string[]): ImplementationPlan | undefined {
	const planId = canonical(value.planId, "planId", errors);
	const created = iso(value.createdAt, "createdAt", errors);
	const planningHost = host(value.planningHost);
	const planningBase = base(value.planningBase, errors);
	let profile: ArtifactIdentity | undefined;
	try { profile = parseArtifactIdentity(value.profile); } catch (error) { errors.push(`invalid project execution profile identity: ${message(error)}`); }
	const objective = semantic(value.objective, "objective", errors);
	const userContext = strings(value.userContext, "userContext", errors);
	const discoveredRepoFacts = strings(value.discoveredRepoFacts, "discoveredRepoFacts", errors);
	const assumptions = strings(value.assumptions, "assumptions", errors);
	const implementationItems = (value.implementationItems as unknown[]).flatMap((item, index) => planItem(item, index, errors));
	if (new Set(implementationItems.map((item) => item.id)).size !== implementationItems.length) errors.push("implementation item ids must be unique");
	for (const [itemIndex, item] of implementationItems.entries()) for (const [forbiddenIndex, forbidden] of item.forbiddenWrites.entries()) {
		if (implementationItems.some((candidate) => candidate.writeResources.some((resource) => resourcesOverlap(resource, forbidden.resource)))) {
			errors.push(`implementationItems[${itemIndex}].forbiddenWrites[${forbiddenIndex}] overlaps planned write authority; forbiddenWrites are packet-global and worker ownership is already defined by writeResources`);
		}
	}
	return planningHost && planningBase && profile ? { schema: IMPLEMENTATION_PLAN_SCHEMA, version: IMPLEMENTATION_PLAN_VERSION, planId, createdAt: created, planningHost, planningBase, profile, objective, userContext, discoveredRepoFacts, assumptions, implementationItems } : undefined;
}

function planItem(value: unknown, index: number, errors: string[]): PlannedWorkSource[] {
	const path = `implementationItems[${index}]`;
	if (!record(value)) return [];
	const id = canonical(value.id, `${path}.id`, errors);
	if (id === FINAL_VALIDATION_NODE_ID) {
		errors.push(`${path} must omit reserved final-validation work; Phase B finalValidationCommands create the compiler-owned node`);
		return [];
	}
	const goals = strings(value.goals, `${path}.goals`, errors);
	const writeResources = resources(value.writeResources, `${path}.writeResources`, errors);
	const readResources = resources(value.readResources, `${path}.readResources`, errors);
	const forbiddenWrites = forbiddenPlans(value.forbiddenWrites, `${path}.forbiddenWrites`, errors);
	const semanticReviewCriteria = strings(value.semanticReviewCriteria, `${path}.semanticReviewCriteria`, errors);
	const advisoryNotes = notes(value.advisoryNotes, `${path}.advisoryNotes`, errors, "phase-a");
	if (!goals.length || !semanticReviewCriteria.length) errors.push(`${path} needs goals and semanticReviewCriteria`);
	return [{ id, goals, writeResources, readResources, forbiddenWrites, semanticReviewCriteria, advisoryNotes }];
}

function parseDetails(value: Record<string, unknown>, expected: { planIdentity?: ArtifactIdentity; planIds?: Iterable<string> }, errors: string[]): ImplementationDetails | undefined {
	const detailsId = canonical(value.detailsId, "detailsId", errors);
	const created = iso(value.createdAt, "createdAt", errors);
	let plan: ArtifactIdentity | undefined;
	try { plan = parseArtifactIdentity(value.plan); } catch (error) { errors.push(`invalid plan identity: ${message(error)}`); }
	if (plan && expected.planIdentity && JSON.stringify(plan) !== JSON.stringify(expected.planIdentity)) errors.push("implementation details plan identity does not match the accepted plan bytes; rerun /fanout-plan");
	const planIds = new Set(expected.planIds ?? []);
	const items = (value.items as unknown[]).flatMap((item, index) => detailItem(item, index, planIds, errors));
	let finalValidationCommands: ReturnType<typeof parseValidationCommands> = [];
	try { finalValidationCommands = parseValidationCommands(value.finalValidationCommands); } catch (error) { errors.push(`finalValidationCommands: ${message(error)}`); }
	return plan ? { schema: IMPLEMENTATION_DETAILS_SCHEMA, version: IMPLEMENTATION_DETAILS_VERSION, detailsId, createdAt: created, plan, items, finalValidationCommands } : undefined;
}

function detailItem(value: unknown, index: number, planIds: Set<string>, errors: string[]): GroundedWorkInput[] {
	const path = `items[${index}]`;
	if (!record(value)) return [];
	const id = canonical(value.id, `${path}.id`, errors);
	const kind = canonical(value.kind, `${path}.kind`, errors);
	if (id === FINAL_VALIDATION_NODE_ID || kind === "final-validation") {
		errors.push(`${path} must omit reserved final-validation work; use top-level finalValidationCommands`);
		return [];
	}
	const detailNotes = notes(value.advisoryNotes, `${path}.advisoryNotes`, errors, "phase-b");
	const admitted = validateWorkContract({
		schema: WORK_CONTRACT_SCHEMA,
		version: WORK_CONTRACT_VERSION,
		goals: [{ sourcePlanId: "details-admission", statement: "Validate grounded detail fields." }],
		changes: value.changes,
		readDependencies: value.readDependencies,
		forbiddenWrites: [],
		validationCommands: value.validationCommands,
		advisoryValidationMode: value.advisoryValidationMode,
		capabilities: FIXED_WORKER_CAPABILITIES,
		semanticReviewCriteria: [{ sourcePlanId: "details-admission", statement: "Grounded detail fields are strict." }],
		advisoryNotes: detailNotes,
	});
	if (!admitted.contract) { for (const issue of admitted.errors) errors.push(`${path}.${issue.path ?? "workContract"}: ${issue.code}: ${issue.message}`); return []; }
	const { changes, readDependencies, validationCommands, advisoryValidationMode, advisoryNotes } = admitted.contract;
	for (const source of sourceIds(changes, readDependencies)) if (planIds.size && !planIds.has(source)) errors.push(`${path} references unknown source plan id ${source}`);
	return [{ id, kind, changes, readDependencies, validationCommands, advisoryValidationMode, advisoryNotes }];
}

function host(value: unknown): ImplementationPlan["planningHost"] { return { platform: (value as { platform: NodeJS.Platform }).platform }; }
function base(value: unknown, errors: string[]): ImplementationPlan["planningBase"] | undefined { try { const item = value as Record<string, unknown>; return { headCommit: parseGitCommitId(item.headCommit), tree: parseGitTreeId(item.tree) }; } catch (error) { errors.push(`invalid planningBase: ${message(error)}`); } }
function resources(value: unknown, path: string, errors: string[]): Resource[] { if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return []; } return value.flatMap((item, index) => { try { return [parseResource(item)]; } catch (error) { errors.push(`${path}[${index}]: ${message(error)}`); return []; } }); }
function forbiddenPlans(value: unknown, path: string, errors: string[]): Array<{ resource: Resource; reason: string }> { return (value as unknown[]).flatMap((entry, index) => { const item = entry as Record<string, unknown>; try { return [{ resource: parseResource(item.resource), reason: semantic(item.reason, `${path}[${index}].reason`, errors) }]; } catch (error) { errors.push(`${path}[${index}].resource: ${message(error)}`); return []; } }); }
function notes(value: unknown, path: string, errors: string[], phase: "phase-a" | "phase-b"): AdvisoryNote[] { return (value as Array<Record<string, unknown>>).map((item, index) => ({ kind: item.kind as AdvisoryNote["kind"], source: { phase, reference: canonical(item.reference, `${path}[${index}].reference`, errors) }, text: semantic(item.text, `${path}[${index}].text`, errors) })); }
function sourceIds(changes: ChangeIntent[], reads: WorkReadDependency[]): string[] { return [...changes.flatMap((change) => change.kind === "move" ? [...change.from.sourcePlanIds, ...change.to.sourcePlanIds] : change.target.sourcePlanIds), ...reads.flatMap((read) => read.sourcePlanIds)]; }
function strings(value: unknown, path: string, errors: string[]): string[] { if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return []; } return value.map((item, index) => semantic(item, `${path}[${index}]`, errors)); }
function semantic(value: unknown, path: string, errors: string[]): string { if (typeof value !== "string" || !value.trim() || /\p{Cc}/u.test(value)) { errors.push(`${path} must be non-empty without controls`); return "invalid"; } return value; }
function canonical(value: unknown, path: string, errors: string[]): string { const result = semantic(value, path, errors); if (typeof value === "string" && value !== value.trim()) errors.push(`${path} must be canonical`); return result; }
function iso(value: unknown, path: string, errors: string[]): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) { errors.push(`${path} must be an ISO timestamp`); return new Date(0).toISOString(); } return value; }
function createdAt(value: Date | string | undefined): string { return value instanceof Date ? value.toISOString() : typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString(); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function showIssue(issue: { code: string; message: string; path?: string }): string { return `${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ""}`; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
