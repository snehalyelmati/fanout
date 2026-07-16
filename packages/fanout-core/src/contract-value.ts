export function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

export function contractRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactContractRecord(value: unknown, fields: string[], optional: string[], path: string): Record<string, unknown> {
	if (!contractRecord(value)) throw new TypeError(`${path} must be an object`);
	const allowed = new Set(fields);
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${path} has unknown field ${key}`);
	for (const field of fields) if (!optional.includes(field) && !Object.hasOwn(value, field)) throw new TypeError(`${path} is missing ${field}`);
	return value;
}

export function contractIdentity(value: unknown, path: string): string {
	if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError(`${path} must be a non-empty identity`);
	return value;
}

export function contractString(value: unknown, path: string): string {
	if (typeof value !== "string") throw new TypeError(`${path} must be a string`);
	return value;
}

export function positiveSafeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError(`${path} must be a positive safe integer`);
	return Number(value);
}

export function nonNegativeSafeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${path} must be a non-negative safe integer`);
	return Number(value);
}

export function nonNegativeFiniteNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be a finite non-negative number`);
	return value;
}

export function canonicalTimestamp(value: unknown, path: string): string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError(`${path} must be a canonical ISO timestamp`);
	return value;
}
