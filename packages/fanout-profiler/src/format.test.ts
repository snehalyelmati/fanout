import { expect, test } from "bun:test";
import { formatDelta, formatDuration, formatValue } from "./format.js";

test("presentation values stay compact and readable", () => {
	expect(formatDuration(296_987)).toBe("4m 57s");
	expect(formatDuration(738)).toBe("738ms");
	expect(formatDuration(3_660_000)).toBe("1h 1m");
	expect(formatValue(424_187, "tokens")).toBe("424.2k tokens");
	expect(formatValue(0.972786, "USD")).toBe("$0.97");
	expect(formatValue(0.0003, "USD")).toBe("$0.0003");
	expect(formatDelta(-61_000, "ms")).toBe("↓ −1m 1s");
	expect(formatValue(null, "ms")).toBe("unavailable");
});
