import { parseRepoPath, type RepoPath } from "./repository-resource.ts";

export interface ValidationCommand {
	executable: string;
	args: string[];
	cwd?: RepoPath;
	env?: Record<string, string>;
}

const COMMAND_FIELDS = new Set(["executable", "args", "cwd", "env"]);
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROL = /\p{Cc}/u;

export function parseValidationCommand(value: unknown, platform: NodeJS.Platform = process.platform): ValidationCommand {
	if (!isRecord(value)) throw new TypeError("validation command must be an object");
	for (const field of Object.keys(value)) if (!COMMAND_FIELDS.has(field)) throw new TypeError(`validation command has unknown field: ${field}`);

	const executable = stringWithoutControls(value.executable, "executable");
	if (!executable || executable !== executable.trim()) throw new TypeError("executable must be non-empty without leading or trailing whitespace");
	if (!Array.isArray(value.args)) throw new TypeError("args must be an array");
	const args = value.args.map((arg, index) => stringWithoutControls(arg, `args[${index}]`));

	let cwd: RepoPath | undefined;
	if (value.cwd !== undefined) cwd = parseRepoPath(value.cwd);

	let env: Record<string, string> | undefined;
	if (value.env !== undefined) {
		if (!isRecord(value.env)) throw new TypeError("env must be an object");
		const entries: Array<[string, string]> = [];
		const names = new Set<string>();
		for (const [name, raw] of Object.entries(value.env)) {
			if (!ENVIRONMENT_NAME.test(name)) throw new TypeError(`invalid environment name: ${name}`);
			const identity = platform === "win32" ? name.toUpperCase() : name;
			if (names.has(identity)) throw new TypeError(`environment names collide on ${platform}: ${name}`);
			names.add(identity);
			entries.push([name, stringWithoutControls(raw, `env.${name}`)]);
		}
		env = Object.fromEntries(entries);
	}

	return { executable, args, ...(cwd === undefined ? {} : { cwd }), ...(env === undefined ? {} : { env }) };
}

export function parseValidationCommands(value: unknown, platform: NodeJS.Platform = process.platform): ValidationCommand[] {
	if (!Array.isArray(value)) throw new TypeError("validation commands must be an array");
	return value.map((command) => parseValidationCommand(command, platform));
}

function stringWithoutControls(value: unknown, path: string): string {
	if (typeof value !== "string" || CONTROL.test(value)) throw new TypeError(`${path} must be a string without control characters`);
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
