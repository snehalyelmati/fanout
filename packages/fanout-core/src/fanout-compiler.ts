import {
	buildExecutionGraph,
	EXECUTION_PACKET_SCHEMA,
	EXECUTION_PACKET_VERSION,
	validateExecutionPacket,
	type FanoutExecutionPacket,
	type FanoutTierPlan,
	type FanoutWorkUnit,
	type TierName,
	type WorkUnitKind,
	type WorkUnitTierAssignment,
} from "./execution-packet.ts";

export const IMPLEMENTATION_PLAN_SCHEMA = "fanout.implementation-plan";
export const IMPLEMENTATION_PLAN_VERSION = 1;
export const IMPLEMENTATION_DETAILS_SCHEMA = "fanout.implementation-details";
export const IMPLEMENTATION_DETAILS_VERSION = 2;

type ReadDependencyClassification = "baseline-context" | "post-change-required";
export type UnclassifiedOverlapPolicy = "error" | "sequential";

export interface CompilerValidationResult {
	ok: boolean;
	errors: string[];
	itemCount: number;
}

export interface RequiredReadClassification {
	readerPlanId: string;
	readFile: string;
	ownerPlanId: string;
	ownerFile: string;
}

export interface CompileExecutionPacketInput {
	implementationPlan: unknown;
	implementationDetails: unknown;
	tierPlan: FanoutTierPlan;
	nodeKindTierPolicy?: { tier2Eligible?: string[]; tier1Only?: string[]; fallbackTier?: TierName | string };
	unclassifiedOverlapPolicy?: UnclassifiedOverlapPolicy;
	artifactDir?: string;
	createdAt?: Date | string;
}

export interface CompileExecutionPacketResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
	packet?: FanoutExecutionPacket;
}

interface PlanItem {
	id: string;
	goal: string;
	rationale: string;
	filesToChange: string[];
	filesToRead: string[];
	dependencies: string[];
	validation: string[];
	acceptanceCriteria: string[];
	risks: string[];
}

interface PlanArtifact {
	objective: string;
	createdAt: string;
	artifactDir: string;
	userContext: string[];
	discoveredRepoFacts: string[];
	assumptions: string[];
	implementationItems: PlanItem[];
	validationPlan: string[];
	risks: string[];
}

interface ExistingFileEdit {
	file: string;
	symbolName?: string;
	section?: string;
	anchorText?: string;
	lineRangeHint?: string;
	editIntent: string;
}

interface NewFileDetail {
	path: string;
	intendedSections: string[];
	contentIntent: string;
}

interface ReadDependency {
	file: string;
	classification: ReadDependencyClassification;
	reason: string;
}

interface DetailItem {
	sourcePlanIds: string[];
	ownedResources: string[];
	existingFileEdits: ExistingFileEdit[];
	newFiles: NewFileDetail[];
	readDependencies: ReadDependency[];
	forbiddenChanges: string[];
	validationCommands: string[];
}

interface DetailsArtifact {
	objective: string;
	artifactDir: string;
	sourcePlanPath: string;
	finalValidationCommands: string[];
	items: DetailItem[];
}

interface Group {
	items: DetailItem[];
	resources: string[];
	id?: string;
}

const DEFAULT_TIER2_ELIGIBLE = new Set(["implement", "test", "docs", "inspect", "validate-shard", "review-shard"]);
const DEFAULT_TIER1_ONLY = new Set(["plan", "clarify", "packet-validation", "dag-safety", "final-review", "synthesis", "final-validation", "final-response"]);

export function validateImplementationDetailsArtifact(details: unknown, expected: { objective?: string; artifactDir?: string; sourcePlanPath?: string; planIds?: Iterable<string> } = {}): CompilerValidationResult {
	const errors: string[] = [];
	parseDetails(details, expected, errors);
	return { ok: errors.length === 0, errors, itemCount: isRecord(details) && Array.isArray(details.items) ? details.items.length : 0 };
}

export function buildRequiredReadClassifications(implementationPlan: unknown): RequiredReadClassification[] {
	const errors: string[] = [];
	const plan = parsePlan(implementationPlan, errors);
	if (!plan || errors.length) return [];
	const rows: RequiredReadClassification[] = [];
	const seen = new Set<string>();
	for (const reader of plan.implementationItems) for (const readFile of reader.filesToRead) {
		for (const owner of plan.implementationItems) {
			if (owner.id === reader.id) continue;
			for (const ownerFile of owner.filesToChange) {
				if (!resourcesOverlap(readFile, ownerFile)) continue;
				const row = { readerPlanId: reader.id, readFile: normalizeResource(readFile), ownerPlanId: owner.id, ownerFile: normalizeResource(ownerFile) };
				const key = JSON.stringify(row);
				if (!seen.has(key)) {
					seen.add(key);
					rows.push(row);
				}
			}
		}
	}
	return rows;
}

export function compileExecutionPacket(input: CompileExecutionPacketInput): CompileExecutionPacketResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const plan = parsePlan(input.implementationPlan, errors);
	const planIds = new Set(plan?.implementationItems.map((item) => item.id) ?? []);
	const details = parseDetails(input.implementationDetails, { objective: plan?.objective, artifactDir: input.artifactDir ?? plan?.artifactDir, planIds }, errors);
	if (!plan || !details || errors.length) return { ok: false, errors, warnings };

	const planItems = new Map(plan.implementationItems.map((item) => [item.id, item]));
	for (const item of plan.implementationItems) if (!details.items.some((detail) => detail.sourcePlanIds.includes(item.id))) errors.push(`implementation item ${item.id} has no implementation details`);
	for (const item of plan.implementationItems) if (item.acceptanceCriteria.length === 0) errors.push(`implementation item ${item.id} is missing contract inputs`);
	validatePlanWriteCoverage(plan.implementationItems, details.items, errors);
	if (errors.length) return { ok: false, errors, warnings };

	const groups = groupByOwnership(details.items);
	const usedGroupIds = new Set<string>(["final-validation"]);
	for (const [index, group] of groups.entries()) {
		group.id = groupId(group, index, usedGroupIds);
	}
	const dependencies = new Map(groups.map((group) => [group, new Set<Group>()]));
	validatePlanReadOverlaps(groups, planItems, dependencies, input.unclassifiedOverlapPolicy ?? "error", errors, warnings);
	if (errors.length) return { ok: false, errors, warnings };
	for (const reader of groups) for (const dependency of groupReadDependencies(reader)) {
		if (dependency.classification !== "post-change-required") continue;
		for (const owner of groups) if (owner !== reader && groupOwnsFile(owner, dependency.file)) dependencies.get(reader)?.add(owner);
	}

	const units = groups.map((group) => workUnitForGroup(group, planItems, dependencies.get(group) ?? new Set(), input.tierPlan, input.nodeKindTierPolicy));
	const finalValidationPlan = unique(details.finalValidationCommands);
	const finalUnit = finalValidationUnit(plan, details, units, finalValidationPlan, input.tierPlan);
	const workUnits = [...units, finalUnit];
	const graph = buildExecutionGraph(workUnits);
	if (graph.topologicalOrder.length !== workUnits.length) errors.push("compiled packet dependencies contain a cycle");
	if (errors.length) return { ok: false, errors, warnings };

	const packet: FanoutExecutionPacket = {
		schema: EXECUTION_PACKET_SCHEMA,
		version: EXECUTION_PACKET_VERSION,
		status: "ready",
		objective: plan.objective,
		createdAt: createdAt(input.createdAt),
		artifactDir: input.artifactDir ?? plan.artifactDir,
		tierPlan: input.tierPlan,
		userContext: plan.userContext,
		discoveredRepoFacts: plan.discoveredRepoFacts,
		assumptions: plan.assumptions,
		blockers: [],
		workUnits,
		estimates: {
			activeWait: "review compiled packet before execution",
			backgroundCompletion: units.some((unit) => unit.tier.assigned === "tier2") ? "depends on tier2 worker latency" : "none",
			cost: "one planning pass plus worker execution",
			criticalPath: graph.criticalPath,
			parallelGroups: graph.parallelGroups,
		},
		stopRules: unique(details.items.flatMap((item) => item.forbiddenChanges)).map((change) => `Stop if required to change: ${change}`),
		risks: unique([...plan.risks, ...warnings]),
		finalValidationPlan,
	};

	const validation = validateExecutionPacket(packet);
	if (!validation.ok) return { ok: false, errors: validation.errors.map((issue) => `${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ""}`), warnings };
	return { ok: true, errors: [], warnings, packet };
}

function parsePlan(value: unknown, errors: string[]): PlanArtifact | undefined {
	if (!isRecord(value)) {
		errors.push("implementation plan must be an object");
		return undefined;
	}
	if (value.schema !== IMPLEMENTATION_PLAN_SCHEMA) errors.push(`implementation plan schema must be ${IMPLEMENTATION_PLAN_SCHEMA}`);
	if (value.version !== IMPLEMENTATION_PLAN_VERSION) errors.push(`implementation plan version must be ${IMPLEMENTATION_PLAN_VERSION}`);
	if (value.status !== "ready") errors.push("implementation plan status must be ready");
	for (const key of ["objective", "createdAt", "artifactDir"] as const) if (!nonEmptyString(value[key])) errors.push(`implementation plan ${key} is required`);
	const implementationItems = array(value.implementationItems, "implementation plan implementationItems", errors).map((item, index) => parsePlanItem(item, index, errors)).filter((item): item is PlanItem => Boolean(item));
	if (implementationItems.length === 0) errors.push("implementation plan implementationItems must not be empty");
	const ids = new Set<string>();
	for (const [index, item] of implementationItems.entries()) {
		if (ids.has(item.id)) errors.push(`implementationItems[${index}].id is duplicate`);
		ids.add(item.id);
	}
	for (const item of implementationItems) for (const dependency of item.dependencies) {
		if (dependency === item.id) errors.push(`implementation item ${item.id} depends on itself`);
		else if (!ids.has(dependency)) errors.push(`implementation item ${item.id} depends on unknown id ${dependency}`);
	}
	return {
		objective: stringField(value.objective),
		createdAt: stringField(value.createdAt),
		artifactDir: stringField(value.artifactDir),
		userContext: stringArray(value.userContext, "implementation plan userContext", errors),
		discoveredRepoFacts: stringArray(value.discoveredRepoFacts, "implementation plan discoveredRepoFacts", errors),
		assumptions: stringArray(value.assumptions, "implementation plan assumptions", errors),
		implementationItems,
		validationPlan: stringArray(value.validationPlan, "implementation plan validationPlan", errors),
		risks: stringArray(value.risks, "implementation plan risks", errors),
	};
}

function parsePlanItem(value: unknown, index: number, errors: string[]): PlanItem | undefined {
	const path = `implementationItems[${index}]`;
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return undefined;
	}
	for (const key of ["id", "goal", "rationale"] as const) if (!nonEmptyString(value[key])) errors.push(`${path}.${key} is required`);
	return {
		id: stringField(value.id),
		goal: stringField(value.goal),
		rationale: stringField(value.rationale),
		filesToChange: bareRepositoryPathArray(value.filesToChange, `${path}.filesToChange`, errors),
		filesToRead: bareRepositoryPathArray(value.filesToRead, `${path}.filesToRead`, errors),
		dependencies: stringArray(value.dependencies, `${path}.dependencies`, errors),
		validation: stringArray(value.validation, `${path}.validation`, errors),
		acceptanceCriteria: stringArray(value.acceptanceCriteria, `${path}.acceptanceCriteria`, errors),
		risks: stringArray(value.risks, `${path}.risks`, errors),
	};
}

function parseDetails(value: unknown, expected: { objective?: string; artifactDir?: string; sourcePlanPath?: string; planIds?: Iterable<string> }, errors: string[]): DetailsArtifact | undefined {
	if (!isRecord(value)) {
		errors.push("implementation details must be an object");
		return undefined;
	}
	if (value.schema !== IMPLEMENTATION_DETAILS_SCHEMA) errors.push(`implementation details schema must be ${IMPLEMENTATION_DETAILS_SCHEMA}`);
	if (value.version !== IMPLEMENTATION_DETAILS_VERSION) errors.push(`implementation details version must be ${IMPLEMENTATION_DETAILS_VERSION}`);
	if (value.status !== "ready") errors.push("implementation details status must be ready");
	for (const key of ["objective", "artifactDir", "sourcePlanPath"] as const) if (!nonEmptyString(value[key])) errors.push(`implementation details ${key} is required`);
	if (expected.objective !== undefined && value.objective !== expected.objective) errors.push("implementation details objective does not match implementation plan");
	if (expected.artifactDir !== undefined && value.artifactDir !== expected.artifactDir) errors.push("implementation details artifactDir does not match current run");
	if (expected.sourcePlanPath !== undefined && value.sourcePlanPath !== expected.sourcePlanPath) errors.push("implementation details sourcePlanPath does not match current run");
	const planIds = new Set(expected.planIds ?? []);
	const finalValidationCommands = validationCommandArray(value.finalValidationCommands, "implementation details finalValidationCommands", errors);
	if (finalValidationCommands.length === 0) errors.push("implementation details finalValidationCommands must not be empty");
	const items = array(value.items, "implementation details items", errors).map((item, index) => parseDetailItem(item, index, errors)).filter((item): item is DetailItem => Boolean(item));
	if (items.length === 0) errors.push("implementation details items must not be empty");
	for (const [index, item] of items.entries()) {
		for (const sourcePlanId of item.sourcePlanIds) if (planIds.size && !planIds.has(sourcePlanId)) errors.push(`items[${index}].sourcePlanIds references unknown Phase A id ${sourcePlanId}`);
		if (writeResources(item).length === 0) errors.push(`items[${index}] must declare at least one owned resource or writable file`);
		if (item.existingFileEdits.length === 0 && item.newFiles.length === 0) errors.push(`items[${index}] must include existingFileEdits or newFiles`);
	}
	return { objective: stringField(value.objective), artifactDir: stringField(value.artifactDir), sourcePlanPath: stringField(value.sourcePlanPath), finalValidationCommands, items };
}

function parseDetailItem(value: unknown, index: number, errors: string[]): DetailItem | undefined {
	const path = `items[${index}]`;
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return undefined;
	}
	const sourcePlanIds = stringArray(value.sourcePlanIds, `${path}.sourcePlanIds`, errors);
	if (sourcePlanIds.length === 0) errors.push(`${path}.sourcePlanIds must not be empty`);
	const existingFileEdits = array(value.existingFileEdits, `${path}.existingFileEdits`, errors).map((edit, editIndex) => parseExistingFileEdit(edit, `${path}.existingFileEdits[${editIndex}]`, errors)).filter((edit): edit is ExistingFileEdit => Boolean(edit));
	const newFiles = array(value.newFiles, `${path}.newFiles`, errors).map((file, fileIndex) => parseNewFile(file, `${path}.newFiles[${fileIndex}]`, errors)).filter((file): file is NewFileDetail => Boolean(file));
	const readDependencies = array(value.readDependencies, `${path}.readDependencies`, errors).map((dependency, dependencyIndex) => parseReadDependency(dependency, `${path}.readDependencies[${dependencyIndex}]`, errors)).filter((dependency): dependency is ReadDependency => Boolean(dependency));
	return {
		sourcePlanIds,
		ownedResources: bareRepositoryPathArray(value.ownedResources, `${path}.ownedResources`, errors),
		existingFileEdits,
		newFiles,
		readDependencies,
		forbiddenChanges: stringArray(value.forbiddenChanges, `${path}.forbiddenChanges`, errors),
		validationCommands: validationCommandArray(value.validationCommands, `${path}.validationCommands`, errors),
	};
}

function parseExistingFileEdit(value: unknown, path: string, errors: string[]): ExistingFileEdit | undefined {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return undefined;
	}
	if (!nonEmptyString(value.file)) errors.push(`${path}.file is required`);
	if (!nonEmptyString(value.editIntent)) errors.push(`${path}.editIntent is required`);
	if (![value.anchorText, value.symbolName, value.section, value.lineRangeHint].some(nonEmptyString)) errors.push(`${path} is missing anchorText, symbolName, section, or lineRangeHint`);
	return {
		file: bareRepositoryPath(value.file, `${path}.file`, errors),
		symbolName: optionalString(value.symbolName),
		section: optionalString(value.section),
		anchorText: optionalString(value.anchorText),
		lineRangeHint: optionalString(value.lineRangeHint),
		editIntent: stringField(value.editIntent),
	};
}

function parseNewFile(value: unknown, path: string, errors: string[]): NewFileDetail | undefined {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return undefined;
	}
	if (!nonEmptyString(value.path)) errors.push(`${path}.path is required`);
	if (!nonEmptyString(value.contentIntent)) errors.push(`${path}.contentIntent is required`);
	return { path: bareRepositoryPath(value.path, `${path}.path`, errors), intendedSections: stringArray(value.intendedSections, `${path}.intendedSections`, errors), contentIntent: stringField(value.contentIntent) };
}

function parseReadDependency(value: unknown, path: string, errors: string[]): ReadDependency | undefined {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return undefined;
	}
	if (!nonEmptyString(value.file)) errors.push(`${path}.file is required`);
	if (value.classification !== "baseline-context" && value.classification !== "post-change-required") errors.push(`${path}.classification is ambiguous; use baseline-context or post-change-required`);
	if (!nonEmptyString(value.reason)) errors.push(`${path}.reason is required`);
	return { file: bareRepositoryPath(value.file, `${path}.file`, errors), classification: value.classification as ReadDependencyClassification, reason: stringField(value.reason) };
}

function groupByOwnership(items: DetailItem[]): Group[] {
	const groups: Group[] = [];
	for (const item of items) {
		const resources = writeResources(item);
		const matches = groups.filter((group) => group.resources.some((left) => resources.some((right) => resourcesOverlap(left, right))));
		if (matches.length === 0) {
			groups.push({ items: [item], resources });
			continue;
		}
		const target = matches[0];
		target.items.push(item);
		target.resources = unique([...target.resources, ...resources]);
		for (const extra of matches.slice(1)) {
			target.items.push(...extra.items);
			target.resources = unique([...target.resources, ...extra.resources]);
			groups.splice(groups.indexOf(extra), 1);
		}
	}
	return groups;
}

function workUnitForGroup(group: Group, planItems: Map<string, PlanItem>, dependencyGroups: Set<Group>, tierPlan: FanoutTierPlan, policy?: CompileExecutionPacketInput["nodeKindTierPolicy"]): FanoutWorkUnit {
	const sourcePlanIds = groupPlanIds(group);
	const relatedPlanItems = sourcePlanIds.map((id) => planItems.get(id)).filter((item): item is PlanItem => Boolean(item));
	const ownedFiles = unique(group.resources);
	const readOnlyFiles = unique([...relatedPlanItems.flatMap((item) => item.filesToRead), ...groupReadDependencies(group).map((dependency) => dependency.file)]).filter((file) => !ownedFiles.some((owned) => resourcesOverlap(owned, file)));
	const kind = inferKind(ownedFiles);
	const validationCommands = unique(group.items.flatMap((item) => item.validationCommands));
	const tier = tierAssignment(kind, tierPlan, policy);
	return {
		id: group.id!,
		kind,
		goal: relatedPlanItems.map((item) => item.goal).join("; ") || `Update ${ownedFiles.join(", ")}`,
		dependencies: Array.from(dependencyGroups).map((dependency) => dependency.id!).sort(),
		ownedFiles,
		readOnlyFiles,
		steps: unique([...group.items.flatMap(itemSteps), `Traces to Phase A items: ${sourcePlanIds.join(", ")}`]),
		validationCommands,
		acceptanceCriteria: unique([...relatedPlanItems.flatMap((item) => item.acceptanceCriteria), `Traces to Phase A items: ${sourcePlanIds.join(", ")}`]),
		rollbackNotes: ownedFiles.length ? [`Revert edits to ${ownedFiles.join(", ")}.`] : ["No writable files."],
		tier,
		workerPacket: {
			sourcePlanIds,
			targetAnchors: unique(group.items.flatMap(targetAnchors)),
			requiredChanges: unique([...group.items.flatMap(itemSteps), ...relatedPlanItems.map((item) => item.goal)]),
			contractInputs: contractInputs(relatedPlanItems),
			readDependencies: readDependencySummaries(groupReadDependencies(group)),
			forbiddenChanges: unique(group.items.flatMap((item) => item.forbiddenChanges)),
			handoffContext: unique([...relatedPlanItems.flatMap((item) => item.filesToRead.map((file) => `Read ${file}`)), ...relatedPlanItems.flatMap((item) => item.validation.map((intent) => `Validation intent: ${intent}`)), ...relatedPlanItems.flatMap((item) => item.risks.map((risk) => `Risk: ${risk}`))]),
		},
		active: tier.assigned === "tier2" ? "background" : "active",
	};
}

function finalValidationUnit(plan: PlanArtifact, details: DetailsArtifact, units: FanoutWorkUnit[], validationCommands: string[], tierPlan: FanoutTierPlan): FanoutWorkUnit {
	const sourcePlanIds = unique(plan.implementationItems.map((item) => item.id));
	return {
		id: "final-validation",
		kind: "final-validation",
		goal: "Validate compiled worker packets against the Phase A plan.",
		dependencies: units.map((unit) => unit.id).sort(),
		ownedFiles: [],
		readOnlyFiles: unique(units.flatMap((unit) => unit.ownedFiles)),
		steps: ["Run the final validation plan.", "Review worker packets for Phase A traceability."],
		validationCommands,
		acceptanceCriteria: ["Execution packet validates.", "Every worker packet traces to Phase A implementation items."],
		rollbackNotes: ["Do not update the active packet if final validation fails."],
		tier: tierAssignment("final-validation", tierPlan),
		workerPacket: {
			sourcePlanIds,
			targetAnchors: unique(details.items.flatMap(targetAnchors)),
			requiredChanges: ["Run final validation and review compiled handoff context."],
			contractInputs: contractInputs(plan.implementationItems),
			readDependencies: readDependencySummaries(details.items.flatMap((item) => item.readDependencies)),
			forbiddenChanges: unique(details.items.flatMap((item) => item.forbiddenChanges)),
			handoffContext: unique(["Final validation only; no implementation edits.", ...plan.validationPlan.map((intent) => `Final validation intent: ${intent}`)]),
		},
		active: "active",
	};
}

function tierAssignment(kind: WorkUnitKind, tierPlan: FanoutTierPlan, policy?: CompileExecutionPacketInput["nodeKindTierPolicy"]): WorkUnitTierAssignment {
	const tier2Eligible = new Set(policy?.tier2Eligible ?? Array.from(DEFAULT_TIER2_ELIGIBLE));
	const tier1Only = new Set(policy?.tier1Only ?? Array.from(DEFAULT_TIER1_ONLY));
	const preferred: TierName = !tier1Only.has(kind) && tier2Eligible.has(kind) ? "tier2" : "tier1";
	const assigned: TierName = preferred === "tier2" && tierPlan.tier2.status === "available" ? "tier2" : "tier1";
	const tier = assigned === "tier2" ? tierPlan.tier2 : preferred === "tier2" ? tierPlan.tier2Fallback : tierPlan.tier1;
	return {
		preferred,
		assigned,
		fallback: "tier1",
		provider: tier.provider,
		model: tier.model,
		thinking: tier.thinking,
		reason: assigned === "tier2" ? "safe parallel implementation worker" : preferred === "tier2" ? "tier2 unavailable; realtime fallback" : "tier1 control-plane node",
	};
}

function groupId(group: Group, index: number, used: Set<string>): string {
	const ids = groupPlanIds(group);
	const base = ids.length === 1 ? ids[0] : `work-${index + 1}-${ids.join("-")}`;
	const fallback = slug(base) || `work-${index + 1}`;
	let id = fallback;
	for (let suffix = 2; used.has(id); suffix++) id = `${fallback}-${suffix}`;
	used.add(id);
	return id;
}

function groupPlanIds(group: Group): string[] {
	return unique(group.items.flatMap((item) => item.sourcePlanIds)).sort();
}

function groupReadDependencies(group: Group): ReadDependency[] {
	return group.items.flatMap((item) => item.readDependencies);
}

function readDependencySummaries(dependencies: ReadDependency[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const dependency of dependencies) {
		const file = normalizeResource(dependency.file);
		const key = `${file}\0${dependency.classification}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(`${file} (${dependency.classification}): ${dependency.reason}`);
	}
	return result;
}

function validatePlanWriteCoverage(items: PlanItem[], details: DetailItem[], errors: string[]): void {
	for (const item of items) {
		const resources = unique(details.filter((detail) => detail.sourcePlanIds.includes(item.id)).flatMap(writeResources));
		for (const file of item.filesToChange) {
			if (!resources.some((resource) => resourcesOverlap(resource, file))) errors.push(`implementation item ${item.id} filesToChange ${file} is not covered by Phase B writable resources`);
		}
	}
}

function validatePlanReadOverlaps(groups: Group[], planItems: Map<string, PlanItem>, dependencies: Map<Group, Set<Group>>, policy: UnclassifiedOverlapPolicy, errors: string[], warnings: string[]): void {
	for (const reader of groups) {
		const planReads = unique(groupPlanIds(reader).flatMap((id) => planItems.get(id)?.filesToRead ?? []));
		if (planReads.length === 0) continue;
		const classifications = groupReadDependencies(reader);
		for (const read of planReads) for (const owner of groups) {
			if (owner === reader || !groupOwnsFile(owner, read)) continue;
			const matchingClassifications = classifications.filter((dependency) => resourcesOverlap(dependency.file, read) && groupOwnsFile(owner, dependency.file));
			const requiredDependency = taskDeclaredValidationDependency(reader, owner, read, planItems);
			const requiredClassifications = requiredDependency
				? reader.items.filter((item) => item.sourcePlanIds.includes(requiredDependency.readerId)).flatMap((item) => item.readDependencies).filter((dependency) => resourcesOverlap(dependency.file, read) && groupOwnsFile(owner, dependency.file))
				: [];
			if (requiredDependency && (requiredClassifications.some((dependency) => dependency.classification === "baseline-context") || !requiredClassifications.some((dependency) => dependency.classification === "post-change-required"))) {
				errors.push(`ambiguous Phase A filesToRead overlap: task-declared dependency ${requiredDependency.readerId} -> ${requiredDependency.ownerId} overlaps ${read}; classify it as post-change-required, not baseline-context`);
				continue;
			}
			if (matchingClassifications.length > 0) continue;
			const message = `unclassified read overlap: group ${reader.id} reads ${read} while group ${owner.id} owns ${owner.resources.join(", ")}`;
			if (policy === "sequential") {
				dependencies.get(reader)?.add(owner);
				warnings.push(`Implicit post-change-required fallback for ${message}`);
			} else {
				errors.push(`ambiguous Phase A filesToRead overlap: ${message}; classify it in Phase B readDependencies as baseline-context or post-change-required`);
			}
		}
	}
}

function taskDeclaredValidationDependency(reader: Group, owner: Group, read: string, planItems: Map<string, PlanItem>): { readerId: string; ownerId: string } | undefined {
	const ownerIds = new Set(groupPlanIds(owner));
	for (const readerId of groupPlanIds(reader)) {
		const item = planItems.get(readerId);
		if (!item?.filesToRead.some((file) => resourcesOverlap(file, read))) continue;
		for (const ownerId of item.dependencies) {
			const ownerItem = planItems.get(ownerId);
			if (ownerIds.has(ownerId) && ownerItem?.filesToChange.some((file) => resourcesOverlap(file, read))) return { readerId, ownerId };
		}
	}
	return undefined;
}

function groupOwnsFile(group: Group, file: string): boolean {
	return group.resources.some((resource) => resourcesOverlap(resource, file));
}

function writeResources(item: DetailItem): string[] {
	return unique([...item.ownedResources, ...item.existingFileEdits.map((edit) => edit.file), ...item.newFiles.map((file) => file.path)]).map(normalizeOwnedResource).filter(Boolean);
}

function itemSteps(item: DetailItem): string[] {
	return [...item.existingFileEdits.map((edit) => `${edit.file}: ${edit.editIntent}`), ...item.newFiles.map((file) => `${file.path}: ${file.contentIntent}`)];
}

function targetAnchors(item: DetailItem): string[] {
	return [
		...item.existingFileEdits.map((edit) => `${edit.file}: ${[edit.symbolName && `symbol ${edit.symbolName}`, edit.section && `section ${edit.section}`, edit.anchorText && `anchor ${edit.anchorText}`, edit.lineRangeHint && `lines ${edit.lineRangeHint}`].filter(Boolean).join("; ")}`),
		...item.newFiles.map((file) => `${file.path}: new file${file.intendedSections.length ? ` sections ${file.intendedSections.join(", ")}` : ""}`),
	];
}

function contractInputs(items: PlanItem[]): string[] {
	return unique(items.flatMap((item) => [`${item.id}: ${item.goal}`, `Rationale: ${item.rationale}`, ...item.acceptanceCriteria.map((criterion) => `Acceptance: ${criterion}`)]));
}

function inferKind(ownedFiles: string[]): WorkUnitKind {
	return ownedFiles.length > 0 && ownedFiles.every((file) => /(^|\/)(README|CHANGELOG|docs\/)|\.mdx?$/i.test(file)) ? "docs" : "implement";
}

function createdAt(value: Date | string | undefined): string {
	if (value instanceof Date) return value.toISOString();
	return typeof value === "string" && value.trim() ? value : new Date().toISOString();
}

function array(value: unknown, path: string, errors: string[]): unknown[] {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array`);
		return [];
	}
	return value;
}

function stringArray(value: unknown, path: string, errors: string[]): string[] {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array`);
		return [];
	}
	const result: string[] = [];
	for (const [index, item] of value.entries()) {
		if (typeof item !== "string") errors.push(`${path}[${index}] must be a string`);
		else if (item.trim()) result.push(item.trim());
	}
	return result;
}

function bareRepositoryPathArray(value: unknown, path: string, errors: string[]): string[] {
	return stringArray(value, path, errors).map((item, index) => bareRepositoryPath(item, `${path}[${index}]`, errors));
}

function bareRepositoryPath(value: unknown, path: string, errors: string[]): string {
	const result = stringField(value);
	if (result.includes("`")) errors.push(`${path} must be a bare repository path without Markdown backticks`);
	return result;
}

function validationCommandArray(value: unknown, path: string, errors: string[]): string[] {
	const commands = stringArray(value, path, errors);
	for (const [index, command] of commands.entries()) {
		if (command.includes("`")) errors.push(`${path}[${index}] must be a literal executable shell command without Markdown backticks`);
		if (looksLikeValidationProse(command)) errors.push(`${path}[${index}] must be an executable shell command, not validation prose`);
	}
	return commands;
}

function looksLikeValidationProse(value: string): boolean {
	return /^(?:Run|Confirm|Review|Repeat|Exercise|Inspect|Ensure)\b/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
	return nonEmptyString(value) ? value.trim() : undefined;
}

function stringField(value: unknown): string {
	return optionalString(value) ?? "";
}

function normalizeResource(value: string): string {
	let normalized = value.trim().replace(/\\/g, "/");
	while (normalized.startsWith("./")) normalized = normalized.slice(2);
	return normalized.replace(/\/+$/g, "");
}

function normalizeOwnedResource(value: string): string {
	const directory = /[\\/]$/.test(value.trim());
	const normalized = normalizeResource(value);
	return directory && normalized ? `${normalized}/` : normalized;
}

function resourcesOverlap(left: string, right: string): boolean {
	const a = normalizeResource(left);
	const b = normalizeResource(right);
	return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}
