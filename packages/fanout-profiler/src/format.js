const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const money = (digits) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatDuration(value) {
	if (!Number.isFinite(value)) return "unavailable";
	const sign = value < 0 ? "−" : "", milliseconds = Math.abs(value);
	if (milliseconds < 1000) return `${sign}${number.format(milliseconds < 10 ? Math.round(milliseconds * 10) / 10 : Math.round(milliseconds))}ms`;
	const seconds = Math.round(milliseconds / 1000);
	if (seconds < 60) return `${sign}${number.format(seconds < 10 ? Math.round(milliseconds / 100) / 10 : seconds)}s`;
	if (seconds < 3600) return `${sign}${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${sign}${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}

function formatCount(value) {
	const absolute = Math.abs(value), units = [[1e9, "b"], [1e6, "m"], [1e3, "k"]];
	for (const [size, suffix] of units) if (absolute >= size) return `${compact.format(value / size)}${suffix}`;
	return number.format(value);
}

export function formatValue(value, unit = "") {
	if (!Number.isFinite(value)) return "unavailable";
	if (unit === "ms") return formatDuration(value);
	if (unit === "USD") {
		const absolute = Math.abs(value), digits = absolute === 0 || absolute >= .01 ? 2 : absolute >= .0001 ? 4 : 6;
		return money(digits).format(value);
	}
	if (unit === "%") return `${number.format(value)}%`;
	const shown = formatCount(value);
	return unit ? `${shown} ${unit}` : shown;
}

export function formatDelta(value, unit) {
	if (!Number.isFinite(value)) return "unavailable";
	if (value === 0) return `— ${formatValue(0, unit)}`;
	return `${value > 0 ? "↑ +" : "↓ −"}${formatValue(Math.abs(value), unit)}`;
}
