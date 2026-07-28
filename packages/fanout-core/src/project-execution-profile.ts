import { parseValidationCommand, type ValidationCommand } from "./validation-command.ts";

export const PROJECT_EXECUTION_PROFILE_SCHEMA = "fanout.project-execution-profile";
export const PROJECT_EXECUTION_PROFILE_VERSION = 1;
export const ACTIVE_PROJECT_EXECUTION_PROFILE_SCHEMA = "fanout.active-project-execution-profile";
export const ACTIVE_PROJECT_EXECUTION_PROFILE_VERSION = 1;

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

const PROFILE_FIELDS = new Set(["schema", "version", "profileId", "createdAt", "preparation", "readiness", "candidateNormalization", "requiredFinalGates"]);
const DECLARATION_FIELDS = new Set(["command", "purpose", "expectedMutations", "networkAccess", "lifecycleScripts"]);

export function parseProjectExecutionProfile(value: unknown): ProjectExecutionProfile {
	const root = record(value, "project execution profile");
	exactFields(root, PROFILE_FIELDS, "project execution profile");
	if (root.schema !== PROJECT_EXECUTION_PROFILE_SCHEMA || root.version !== PROJECT_EXECUTION_PROFILE_VERSION) throw new TypeError(`project execution profile must be ${PROJECT_EXECUTION_PROFILE_SCHEMA} v${PROJECT_EXECUTION_PROFILE_VERSION}`);
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
		const item = record(entry, `${field}[${index}]`);
		exactFields(item, DECLARATION_FIELDS, `${field}[${index}]`);
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

function record(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
	return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, fields: Set<string>, name: string): void {
	const unknown = Object.keys(value).filter((field) => !fields.has(field));
	const missing = [...fields].filter((field) => !Object.hasOwn(value, field));
	if (unknown.length || missing.length) throw new TypeError(`${name} has unknown or missing fields: ${[...unknown, ...missing].join(", ")}`);
}

function nonempty(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
	return value;
}
