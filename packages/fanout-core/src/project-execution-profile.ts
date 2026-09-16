import { parseValidationCommand, type ValidationCommand } from "./validation-command.ts";
import {
	ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA,
	ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION,
	PROJECT_EXECUTION_PROFILE_SCHEMA,
	PROJECT_EXECUTION_PROFILE_VERSION,
	ProjectExecutionProfileArtifactSchema,
	planningSchemaErrors,
} from "./planning-artifact-schema.ts";

export { ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA, ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION, PROJECT_EXECUTION_PROFILE_SCHEMA, PROJECT_EXECUTION_PROFILE_VERSION };

export interface ProfileCommandDeclaration {
	command: ValidationCommand;
	purpose: string;
	expectedMutations: "none" | "ignored-only" | "candidate-owned";
	networkAccess: boolean;
	lifecycleScripts: boolean;
}

export interface ProjectExecutionProfile {
	schema: typeof PROJECT_EXECUTION_PROFILE_SCHEMA;
	version: typeof PROJECT_EXECUTION_PROFILE_VERSION;
	profileId: string;
	createdAt: string;
	preparation: ProfileCommandDeclaration[];
	readiness: ProfileCommandDeclaration[];
	candidateNormalization: ProfileCommandDeclaration[];
	requiredFinalGates: ProfileCommandDeclaration[];
}

export interface ActiveProjectExecutionProfile {
	schema: typeof ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA;
	version: typeof ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION;
	publishedAt: string;
	profile: { path: string; sha256: string; byteLength: number };
}

export function parseProjectExecutionProfile(value: unknown): ProjectExecutionProfile {
	const structuralErrors = planningSchemaErrors(ProjectExecutionProfileArtifactSchema, value);
	if (structuralErrors.length) throw new TypeError(structuralErrors.join("; "));
	const root = value as Record<string, unknown>;
	const profileId = nonempty(root.profileId, "profileId");
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profileId)) throw new TypeError("profileId must be one canonical path segment");
	const createdAt = nonempty(root.createdAt, "createdAt");
	if (!Number.isFinite(Date.parse(createdAt))) throw new TypeError("createdAt must be an ISO timestamp");
	return {
		schema: PROJECT_EXECUTION_PROFILE_SCHEMA,
		version: PROJECT_EXECUTION_PROFILE_VERSION,
		profileId,
		createdAt,
		preparation: declarations(root.preparation, "preparation"),
		readiness: declarations(root.readiness, "readiness"),
		candidateNormalization: declarations(root.candidateNormalization, "candidateNormalization"),
		requiredFinalGates: declarations(root.requiredFinalGates, "requiredFinalGates"),
	};
}

export function projectExecutionProfileBytes(profile: ProjectExecutionProfile): Buffer {
	return Buffer.from(`${JSON.stringify(parseProjectExecutionProfile(profile), null, 2)}\n`);
}

function declarations(value: unknown, field: string): ProfileCommandDeclaration[] {
	if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
	return value.map((entry, index) => {
		const item = entry as Record<string, unknown>;
		const expectedMutations = item.expectedMutations;
		if (expectedMutations !== "none" && expectedMutations !== "ignored-only" && expectedMutations !== "candidate-owned") throw new TypeError(`${field}[${index}].expectedMutations is invalid`);
		if (expectedMutations === "candidate-owned" && field !== "candidateNormalization") throw new TypeError(`${field}[${index}].expectedMutations may be candidate-owned only for candidate normalization`);
		if (typeof item.networkAccess !== "boolean" || typeof item.lifecycleScripts !== "boolean") throw new TypeError(`${field}[${index}] disclosure flags must be boolean`);
		return {
			command: parseValidationCommand(item.command),
			purpose: nonempty(item.purpose, `${field}[${index}].purpose`),
			expectedMutations,
			networkAccess: item.networkAccess,
			lifecycleScripts: item.lifecycleScripts,
		};
	});
}

function nonempty(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
	return value;
}
