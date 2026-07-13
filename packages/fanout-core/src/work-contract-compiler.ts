import {
	authorizeResourceForSources,
	compileRepositoryAuthority,
	groupConnectedResourceScopes,
	parseResource,
	resourcesOverlap,
	type PlannedResourceScope,
	type Resource,
} from "./repository-resource.ts";
import type { ValidationCommand } from "./validation-command.ts";
import {
	FIXED_WORKER_CAPABILITIES,
	WORK_CONTRACT_SCHEMA,
	WORK_CONTRACT_VERSION,
	changeWriteResources,
	validateWorkContract,
	type AdvisoryNote,
	type ChangeIntent,
	type ForbiddenWrite,
	type WorkContract,
	type WorkContractIssue,
	type WorkContractNode,
	type WorkReadDependency,
} from "./work-contract.ts";
import { deriveWorkContractGraph, deriveWorkContractWarnings, type WorkContractGraph } from "./work-contract-graph.ts";

export interface PlannedWorkSource {
	id: string;
	goals: string[];
	writeResources: Resource[];
	readResources: Resource[];
	forbiddenWrites: Array<{ resource: Resource; reason: string }>;
	semanticReviewCriteria: string[];
	advisoryNotes: AdvisoryNote[];
}

export interface GroundedWorkInput {
	id: string;
	kind: string;
	changes: ChangeIntent[];
	readDependencies: WorkReadDependency[];
	forbiddenWrites: ForbiddenWrite[];
	validationCommands: ValidationCommand[];
	advisoryNotes: AdvisoryNote[];
}

export interface WorkContractCompilation {
	ok: boolean;
	errors: WorkContractIssue[];
	warnings: WorkContractIssue[];
	nodes: WorkContractNode[];
	graph?: WorkContractGraph;
}

export function compileWorkContracts(plannedInput: readonly PlannedWorkSource[], groundedInput: readonly GroundedWorkInput[], finalValidationCommands: readonly ValidationCommand[]): WorkContractCompilation {
	const errors: WorkContractIssue[] = [];
	const warnings: WorkContractIssue[] = [];
	const planned = admitPlannedSources(plannedInput, errors);
	const plannedScopes = planned.map(resourceScope);
	const grounded = admitGroundedInputs(groundedInput, planned, errors);

	const endpointScopes = grounded.flatMap((input) => changeEndpoints(input.changes).map((endpoint) => ({
		sourcePlanIds: endpoint.sourcePlanIds,
		ownedResources: [endpoint.resource],
		readDependencies: [],
		forbiddenWriteResources: input.forbiddenWrites.map((entry) => entry.resource),
	})));
	const authority = compileRepositoryAuthority(plannedScopes, endpointScopes);
	errors.push(...authority.errors);
	for (const [inputIndex, input] of grounded.entries()) for (const [readIndex, read] of input.readDependencies.entries()) {
		for (const issue of authorizeResourceForSources(read.resource, read.sourcePlanIds, plannedScopes, "read")) errors.push({ ...issue, path: `grounded[${inputIndex}].readDependencies[${readIndex}]` });
	}
	const planIds = new Set(planned.map((plan) => plan.id));
	for (const [inputIndex, input] of grounded.entries()) for (const [forbiddenIndex, forbiddenWrite] of input.forbiddenWrites.entries()) for (const sourcePlanId of forbiddenWrite.sourcePlanIds) {
		if (!planIds.has(sourcePlanId)) add(errors, "unknown-source-plan-id", `unknown source plan id ${sourcePlanId}`, `grounded[${inputIndex}].forbiddenWrites[${forbiddenIndex}]`);
	}
	const forbidden = [...planned.flatMap((plan) => plan.forbiddenWrites.map((entry) => entry.resource)), ...grounded.flatMap((input) => input.forbiddenWrites.map((entry) => entry.resource))];
	for (const input of grounded) for (const write of changeWriteResources(input.changes)) if (forbidden.some((resource) => resourcesOverlap(write, resource))) add(errors, "write-forbidden-overlap", `${show(write)} overlaps a typed forbidden write`);
	if (errors.length) return { ok: false, errors, warnings, nodes: [] };

	const groups = groupConnectedResourceScopes(grounded.map((input) => ({ resources: changeWriteResources(input.changes), sourcePlanIds: contractSourceIds(input) })))
		.map((group) => [...group.memberIndexes].sort((left, right) => left - right).map((index) => grounded[index]));
	const usedIds = new Set(["final-validation"]);
	const nodes: WorkContractNode[] = [];
	for (const group of groups) {
		const ids = unique(group.flatMap(contractSourceIds));
		const related = planned.filter((plan) => ids.includes(plan.id));
		const kinds = unique(group.map((input) => input.kind));
		if (kinds.length !== 1) { add(errors, "mixed-node-kind", `overlapping grounded work has mixed kinds: ${kinds.join(", ")}`); continue; }
		const id = uniqueId(group.length === 1 ? group[0].id : group.map((input) => input.id).join("-"), usedIds);
		const validation = validateWorkContract(makeContract(planned, related, group));
		if (!validation.ok || !validation.contract) {
			for (const issue of validation.errors) errors.push({ ...issue, path: issue.path ? `nodes.${id}.workContract.${issue.path}` : `nodes.${id}.workContract` });
			continue;
		}
		nodes.push({ id, kind: kinds[0], workContract: validation.contract });
	}

	const finalValidation = validateWorkContract(makeFinalContract(planned, finalValidationCommands), { finalValidation: true });
	if (!finalValidation.ok || !finalValidation.contract) for (const issue of finalValidation.errors) errors.push({ ...issue, path: issue.path ? `nodes.final-validation.workContract.${issue.path}` : "nodes.final-validation.workContract" });
	else nodes.push({ id: "final-validation", kind: "final-validation", workContract: finalValidation.contract });
	if (errors.length) return { ok: false, errors, warnings, nodes };

	const derived = deriveWorkContractGraph(nodes);
	warnings.push(...deriveWorkContractWarnings(nodes));
	return { ok: derived.errors.length === 0, errors: derived.errors, warnings, nodes, graph: derived.graph };
}

function admitPlannedSources(value: readonly PlannedWorkSource[], errors: WorkContractIssue[]): PlannedWorkSource[] {
	const result: PlannedWorkSource[] = [];
	const ids = new Set<string>();
	for (const [index, plan] of value.entries()) {
		const path = `planned[${index}]`;
		if (!isRecord(plan) || !canonical(plan.id)) { add(errors, "invalid-plan-id", "planned source id must be canonical", `${path}.id`); continue; }
		if (ids.has(plan.id)) { add(errors, "duplicate-plan-id", `duplicate plan id ${plan.id}`, `${path}.id`); continue; }
		ids.add(plan.id);
		const goals = strings(plan.goals, `${path}.goals`, errors);
		const criteria = strings(plan.semanticReviewCriteria, `${path}.semanticReviewCriteria`, errors);
		if (!goals.length) add(errors, "missing-plan-goal", "planned source needs a goal", `${path}.goals`);
		if (!criteria.length) add(errors, "missing-plan-criterion", "planned source needs semantic review criteria", `${path}.semanticReviewCriteria`);
		result.push({ ...plan, goals, writeResources: resources(plan.writeResources, `${path}.writeResources`, errors), readResources: resources(plan.readResources, `${path}.readResources`, errors), forbiddenWrites: forbiddenPlans(plan.forbiddenWrites, `${path}.forbiddenWrites`, errors), semanticReviewCriteria: criteria });
	}
	return result;
}

function admitGroundedInputs(value: readonly GroundedWorkInput[], plans: PlannedWorkSource[], errors: WorkContractIssue[]): GroundedWorkInput[] {
	const statements = plans.flatMap((plan) => plan.goals.map((statement) => ({ sourcePlanId: plan.id, statement })));
	const criteria = plans.flatMap((plan) => plan.semanticReviewCriteria.map((statement) => ({ sourcePlanId: plan.id, statement })));
	return value.flatMap((input, index) => {
		const path = `grounded[${index}]`;
		if (!isRecord(input) || !canonical(input.id) || !canonical(input.kind)) { add(errors, "invalid-grounded-input", "grounded work needs canonical id and kind", path); return []; }
		const validation = validateWorkContract({ schema: WORK_CONTRACT_SCHEMA, version: WORK_CONTRACT_VERSION, goals: statements, changes: input.changes, readDependencies: input.readDependencies, forbiddenWrites: input.forbiddenWrites, validationCommands: input.validationCommands, capabilities: FIXED_WORKER_CAPABILITIES, semanticReviewCriteria: criteria, advisoryNotes: input.advisoryNotes });
		if (!validation.ok || !validation.contract) { for (const issue of validation.errors) errors.push({ ...issue, path: issue.path ? `${path}.${issue.path}` : path }); return []; }
		return [{ id: input.id, kind: input.kind, changes: validation.contract.changes, readDependencies: validation.contract.readDependencies, forbiddenWrites: validation.contract.forbiddenWrites, validationCommands: validation.contract.validationCommands, advisoryNotes: validation.contract.advisoryNotes }];
	});
}

function resourceScope(plan: PlannedWorkSource): PlannedResourceScope {
	return { id: plan.id, writeResources: plan.writeResources, readResources: plan.readResources, forbiddenWriteResources: plan.forbiddenWrites.map((entry) => entry.resource) };
}

function makeContract(allPlans: PlannedWorkSource[], plans: PlannedWorkSource[], inputs: GroundedWorkInput[]): WorkContract {
	return {
		schema: WORK_CONTRACT_SCHEMA, version: WORK_CONTRACT_VERSION,
		goals: plans.flatMap((plan) => plan.goals.map((statement) => ({ sourcePlanId: plan.id, statement }))),
		changes: inputs.flatMap((input) => input.changes),
		readDependencies: inputs.flatMap((input) => input.readDependencies),
		forbiddenWrites: [...allPlans.flatMap((plan) => plan.forbiddenWrites.map((entry) => ({ resource: entry.resource, sourcePlanIds: [plan.id], reason: entry.reason }))), ...inputs.flatMap((input) => input.forbiddenWrites)],
		validationCommands: inputs.flatMap((input) => input.validationCommands), capabilities: FIXED_WORKER_CAPABILITIES,
		semanticReviewCriteria: plans.flatMap((plan) => plan.semanticReviewCriteria.map((statement) => ({ sourcePlanId: plan.id, statement }))),
		advisoryNotes: [...plans.flatMap((plan) => plan.advisoryNotes), ...inputs.flatMap((input) => input.advisoryNotes)],
	};
}

function makeFinalContract(plans: PlannedWorkSource[], validationCommands: readonly ValidationCommand[]): WorkContract {
	return {
		schema: WORK_CONTRACT_SCHEMA, version: WORK_CONTRACT_VERSION,
		goals: plans.flatMap((plan) => plan.goals.map((statement) => ({ sourcePlanId: plan.id, statement }))), changes: [], readDependencies: [],
		forbiddenWrites: plans.flatMap((plan) => plan.forbiddenWrites.map((entry) => ({ resource: entry.resource, sourcePlanIds: [plan.id], reason: entry.reason }))),
		validationCommands: [...validationCommands], capabilities: FIXED_WORKER_CAPABILITIES,
		semanticReviewCriteria: plans.flatMap((plan) => plan.semanticReviewCriteria.map((statement) => ({ sourcePlanId: plan.id, statement }))),
		advisoryNotes: [{ kind: "context", source: { phase: "compiler", reference: "final-validation" }, text: "Run authoritative integrated validation after every ordinary node." }],
	};
}

function changeEndpoints(changes: readonly ChangeIntent[]) { return changes.flatMap((change) => change.kind === "move" ? [change.from, change.to] : [change.target]); }
function contractSourceIds(input: GroundedWorkInput): string[] { return unique([...changeEndpoints(input.changes).flatMap((endpoint) => endpoint.sourcePlanIds), ...input.readDependencies.flatMap((read) => read.sourcePlanIds), ...input.forbiddenWrites.flatMap((entry) => entry.sourcePlanIds)]); }
function resources(value: unknown, path: string, errors: WorkContractIssue[]): Resource[] { if (!Array.isArray(value)) { add(errors, "invalid-resource-list", "resource list must be an array", path); return []; } return value.flatMap((entry, index) => { try { return [parseResource(entry)]; } catch (error) { add(errors, "invalid-resource", message(error), `${path}[${index}]`); return []; } }); }
function forbiddenPlans(value: unknown, path: string, errors: WorkContractIssue[]): Array<{ resource: Resource; reason: string }> { if (!Array.isArray(value)) { add(errors, "invalid-forbidden-list", "forbiddenWrites must be an array", path); return []; } return value.flatMap((entry, index) => { if (!isRecord(entry) || !text(entry.reason)) { add(errors, "invalid-forbidden", "forbidden write needs a resource and reason", `${path}[${index}]`); return []; } try { return [{ resource: parseResource(entry.resource), reason: entry.reason }]; } catch (error) { add(errors, "invalid-resource", message(error), `${path}[${index}].resource`); return []; } }); }
function strings(value: unknown, path: string, errors: WorkContractIssue[]): string[] { if (!Array.isArray(value)) { add(errors, "invalid-string-list", "value must be an array", path); return []; } return value.flatMap((entry, index) => text(entry) ? [entry] : (add(errors, "invalid-semantic-text", "value must be non-empty without controls", `${path}[${index}]`), [])); }
function uniqueId(value: string, used: Set<string>): string { let id = value; for (let suffix = 2; used.has(id); suffix++) id = `${value}-${suffix}`; used.add(id); return id; }
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function canonical(value: unknown): value is string { return text(value) && value === value.trim(); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && !/\p{Cc}/u.test(value); }
function show(resource: Resource): string { return `${resource.kind}:${resource.path}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function add(errors: WorkContractIssue[], code: string, message: string, path?: string): void { errors.push({ code, message, ...(path ? { path } : {}) }); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
