import { createRequire } from "node:module";
import Type, { type Static, type TSchema } from "typebox";

const Schema = createRequire(import.meta.url)("typebox/schema") as typeof import("typebox/schema");

export const PROJECT_EXECUTION_PROFILE_SCHEMA = "fanout.project-execution-profile";
export const PROJECT_EXECUTION_PROFILE_VERSION = 1;
export const ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA = "fanout.active-project-execution-profile";
export const ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION = 1;
export const IMPLEMENTATION_PLAN_SCHEMA = "fanout.implementation-plan";
export const IMPLEMENTATION_PLAN_VERSION = 4;
export const IMPLEMENTATION_DETAILS_SCHEMA = "fanout.implementation-details";
export const IMPLEMENTATION_DETAILS_VERSION = 8;

export const ORDINARY_WORK_KINDS = ["implement", "test", "docs", "inspect", "validate-shard", "review-shard"] as const;

const closed = { additionalProperties: false } as const;
const semanticText = Type.String({ minLength: 1 });
const canonicalText = Type.String({ minLength: 1, pattern: "^\\S(?:.*\\S)?$|^\\S$" });
const sourcePlanIds = Type.Array(canonicalText, { minItems: 1, uniqueItems: true });
const platform = Type.Enum(["aix", "android", "darwin", "freebsd", "haiku", "linux", "openbsd", "sunos", "win32", "cygwin", "netbsd"] as const);

export const RepositoryResourceSchema = Type.Object({
	kind: Type.Enum(["file", "directory"] as const),
	path: semanticText,
}, closed);

const fileResource = Type.Object({ kind: Type.Literal("file"), path: semanticText }, closed);
const directoryResource = Type.Object({ kind: Type.Literal("directory"), path: semanticText }, closed);

export const ArtifactIdentitySchema = Type.Object({
	path: semanticText,
	sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
	byteLength: Type.Integer({ minimum: 0 }),
}, closed);

export const DirectArgvCommandSchema = Type.Object({
	executable: semanticText,
	args: Type.Array(Type.String()),
	cwd: Type.Optional(semanticText),
	env: Type.Optional(Type.Record(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }), Type.String(), closed)),
}, closed);

export const ProfileDeclarationSchema = Type.Object({
	command: DirectArgvCommandSchema,
	purpose: semanticText,
	expectedMutations: Type.Enum(["none", "ignored-only", "candidate-owned"] as const),
	networkAccess: Type.Boolean(),
	lifecycleScripts: Type.Boolean(),
}, closed);

export const ProjectExecutionProfileBodySchema = Type.Object({
	preparation: Type.Array(ProfileDeclarationSchema),
	readiness: Type.Array(ProfileDeclarationSchema),
	candidateNormalization: Type.Array(ProfileDeclarationSchema),
	requiredFinalGates: Type.Array(ProfileDeclarationSchema),
}, closed);

export const ProjectExecutionProfileArtifactSchema = Type.Object({
	schema: Type.Literal(PROJECT_EXECUTION_PROFILE_SCHEMA),
	version: Type.Literal(PROJECT_EXECUTION_PROFILE_VERSION),
	profileId: canonicalText,
	createdAt: semanticText,
	...ProjectExecutionProfileBodySchema.properties,
}, closed);

const advisoryKind = Type.Enum(["rationale", "risk", "validation-intent", "constraint", "context"] as const);
export const AdvisoryNoteBodySchema = Type.Object({ kind: advisoryKind, reference: canonicalText, text: semanticText }, closed);

const forbiddenPlan = Type.Object({ resource: RepositoryResourceSchema, reason: semanticText }, closed);
const implementationPlanItem = Type.Object({
	id: canonicalText,
	goals: Type.Array(semanticText, { minItems: 1 }),
	writeResources: Type.Array(RepositoryResourceSchema),
	readResources: Type.Array(RepositoryResourceSchema),
	forbiddenWrites: Type.Array(forbiddenPlan),
	semanticReviewCriteria: Type.Array(semanticText, { minItems: 1 }),
	advisoryNotes: Type.Array(AdvisoryNoteBodySchema),
}, closed);

export const ImplementationPlanBodySchema = Type.Object({
	objective: semanticText,
	userContext: Type.Array(semanticText),
	discoveredRepoFacts: Type.Array(semanticText),
	assumptions: Type.Array(semanticText),
	implementationItems: Type.Array(implementationPlanItem, { minItems: 1 }),
}, closed);

export const ImplementationPlanArtifactSchema = Type.Object({
	schema: Type.Literal(IMPLEMENTATION_PLAN_SCHEMA),
	version: Type.Literal(IMPLEMENTATION_PLAN_VERSION),
	planId: canonicalText,
	createdAt: semanticText,
	planningHost: Type.Object({ platform }, closed),
	planningBase: Type.Object({
		headCommit: Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" }),
		tree: Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" }),
	}, closed),
	profile: ArtifactIdentitySchema,
	...ImplementationPlanBodySchema.properties,
}, closed);

const authorizedEndpoint = (resource: TSchema = RepositoryResourceSchema) => Type.Object({ resource, sourcePlanIds }, closed);
const stableAnchor = Type.Union([
	Type.Object({ kind: Type.Literal("symbol"), symbol: semanticText }, closed),
	Type.Object({ kind: Type.Literal("section"), section: semanticText }, closed),
	Type.Object({ kind: Type.Literal("stable-text"), text: semanticText }, closed),
]);
const lineAnchor = Type.Object({
	kind: Type.Literal("line-range-hint"),
	start: Type.Integer({ minimum: 1 }),
	end: Type.Integer({ minimum: 1 }),
}, closed);
export const AnchorSchema = Type.Union([stableAnchor, lineAnchor]);

const fileModify = Type.Object({
	kind: Type.Literal("modify"),
	target: authorizedEndpoint(fileResource),
	intent: semanticText,
	anchors: Type.Array(AnchorSchema, { minItems: 1, contains: stableAnchor, minContains: 1 }),
}, closed);
const directoryModify = Type.Object({
	kind: Type.Literal("modify"),
	target: authorizedEndpoint(directoryResource),
	intent: semanticText,
	anchors: Type.Array(AnchorSchema, { minItems: 1 }),
}, closed);
const createChange = Type.Object({
	kind: Type.Literal("create"),
	target: authorizedEndpoint(),
	contentIntent: semanticText,
	intendedSections: Type.Optional(Type.Array(semanticText)),
	intendedShape: Type.Optional(semanticText),
}, closed);
const deleteChange = Type.Object({
	kind: Type.Literal("delete"),
	target: authorizedEndpoint(),
	reason: semanticText,
}, closed);
const moveChange = Type.Object({
	kind: Type.Literal("move"),
	from: authorizedEndpoint(),
	to: authorizedEndpoint(),
	intent: semanticText,
}, closed);
export const ChangeIntentSchema = Type.Union([fileModify, directoryModify, createChange, deleteChange, moveChange]);

export const ReadDependencySchema = Type.Object({
	resource: RepositoryResourceSchema,
	timing: Type.Enum(["baseline-context", "post-change-required"] as const),
	timingSource: Type.Enum(["phase-b", "sequential-fallback"] as const),
	sourcePlanIds,
	reason: semanticText,
}, closed);

const detailItemProperties = {
	id: canonicalText,
	kind: Type.Enum(ORDINARY_WORK_KINDS),
	changes: Type.Array(ChangeIntentSchema),
	readDependencies: Type.Array(ReadDependencySchema),
	validationCommands: Type.Array(DirectArgvCommandSchema, { minItems: 1 }),
};
const advisoryValidationMode = Type.Enum(["fail-fast", "collect-independent"] as const, {
	description: "Prefer collect-independent when you establish that every ordered command checks the same candidate independently of previous success, consumes no other check's generated outputs, and is not a mutating prerequisite chain. Use fail-fast when checks depend on previous success or their independence is uncertain. Choose explicitly; omission conservatively persists fail-fast. Advisory worker execution only; commands remain sequential and controller gates fail-fast.",
});
const detailsItemBody = Type.Object({
	...detailItemProperties,
	advisoryValidationMode: Type.Optional(advisoryValidationMode),
	advisoryNotes: Type.Optional(Type.Array(AdvisoryNoteBodySchema)),
}, closed);
const detailsItemArtifact = Type.Object({
	...detailItemProperties,
	advisoryValidationMode,
	advisoryNotes: Type.Array(AdvisoryNoteBodySchema),
}, closed);

export const ImplementationDetailsBodySchema = Type.Object({
	items: Type.Array(detailsItemBody, { minItems: 1 }),
	finalValidationCommands: Type.Array(DirectArgvCommandSchema),
}, closed);

export const ImplementationDetailsArtifactSchema = Type.Object({
	schema: Type.Literal(IMPLEMENTATION_DETAILS_SCHEMA),
	version: Type.Literal(IMPLEMENTATION_DETAILS_VERSION),
	detailsId: canonicalText,
	createdAt: semanticText,
	plan: ArtifactIdentitySchema,
	items: Type.Array(detailsItemArtifact, { minItems: 1 }),
	finalValidationCommands: Type.Array(DirectArgvCommandSchema),
}, closed);

export const ProfileSubmissionParametersSchema = Type.Object({ artifact: ProjectExecutionProfileBodySchema }, closed);
export const ImplementationPlanSubmissionParametersSchema = Type.Object({ artifact: ImplementationPlanBodySchema }, closed);
export const ImplementationDetailsSubmissionParametersSchema = Type.Object({ artifact: ImplementationDetailsBodySchema }, closed);
export const CombinedPlanningBodySchema = Type.Object({ plan: ImplementationPlanBodySchema, details: ImplementationDetailsBodySchema }, closed);
export const CombinedPlanningSubmissionParametersSchema = Type.Object({ artifact: CombinedPlanningBodySchema }, closed);
export const PlanningRepairBodySchema = Type.Object({
	revision: Type.Integer({ minimum: 1 }),
	replacePlanItems: Type.Array(implementationPlanItem),
	replaceDetailItems: Type.Array(detailsItemBody),
	finalValidationCommands: Type.Optional(Type.Array(DirectArgvCommandSchema)),
}, closed);
export const PlanningRepairSubmissionParametersSchema = Type.Object({ artifact: PlanningRepairBodySchema }, closed);
export type CombinedPlanningBody = Static<typeof CombinedPlanningBodySchema>;
export type PlanningRepairBody = Static<typeof PlanningRepairBodySchema>;

export type RepositoryResourceStructure = Static<typeof RepositoryResourceSchema>;
export type ArtifactIdentityStructure = Static<typeof ArtifactIdentitySchema>;
export type DirectArgvCommandStructure = Static<typeof DirectArgvCommandSchema>;
export type ProfileDeclarationStructure = Static<typeof ProfileDeclarationSchema>;
export type ProjectExecutionProfileBody = Static<typeof ProjectExecutionProfileBodySchema>;
export type ProjectExecutionProfileArtifactStructure = Static<typeof ProjectExecutionProfileArtifactSchema>;
export type ImplementationPlanBody = Static<typeof ImplementationPlanBodySchema>;
export type ImplementationPlanArtifactStructure = Static<typeof ImplementationPlanArtifactSchema>;
export type ChangeIntentStructure = Static<typeof ChangeIntentSchema>;
export type ReadDependencyStructure = Static<typeof ReadDependencySchema>;
export type ImplementationDetailsBody = Static<typeof ImplementationDetailsBodySchema>;
export type ImplementationDetailsArtifactStructure = Static<typeof ImplementationDetailsArtifactSchema>;

export function planningSchemaErrors(schema: TSchema, value: unknown): string[] {
	const [, errors] = Schema.Errors(schema, value);
	return errors.map((error) => {
		const path = pointerPath(error.instancePath);
		const extra = error.keyword === "additionalProperties" && "additionalProperties" in error.params
			? `: ${(error.params as { additionalProperties: string[] }).additionalProperties.join(", ")}`
			: "";
		return `${path || "value"}: ${error.message}${extra}`;
	});
}

function pointerPath(pointer: string): string {
	if (!pointer) return "";
	return pointer.split("/").slice(1).map((part, index) => {
		const value = part.replaceAll("~1", "/").replaceAll("~0", "~");
		return /^\d+$/.test(value) ? `[${value}]` : `${index ? "." : ""}${value}`;
	}).join("");
}
