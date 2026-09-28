// Persist money as integer minor units. Avoid floating point conversion at the UI boundary.
export function parseMinorUnits(value: string, currency: string): number {
	const input = value.trim();
	if (!input) return 0;
	const decimals = currency === "JPY" ? 0 : 2;
	if (!(decimals === 0 ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(input)) return NaN;
	const [whole, fraction = ""] = input.split(".");
	const units = BigInt(whole) * BigInt(decimals === 0 ? 1 : 100) +
		BigInt(decimals === 0 ? 0 : fraction.padEnd(2, "0"));
	return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : NaN;
}

export function inputFromMinorUnits(value: number, currency: string): string {
	if (currency === "JPY") return String(value);
	const units = BigInt(value);
	return `${units / 100n}.${String(units % 100n).padStart(2, "0")}`;
}

export function formatMinorUnits(amount: number | bigint, currency: string, lang: string): string {
	if (typeof amount === "number" && !Number.isSafeInteger(amount)) return "—";
	const units = BigInt(amount);
	if (units < 0n) return "—";
	const isYen = currency === "JPY";
	const formatter = new Intl.NumberFormat(lang, {
		style: "currency",
		currency,
		minimumFractionDigits: isYen ? 0 : 2,
		maximumFractionDigits: isYen ? 0 : 2,
	});
	if (isYen) return formatter.format(units);
	const fraction = String(units % 100n).padStart(2, "0");
	return formatter.formatToParts(units / 100n)
		.map((part) => part.type === "fraction" ? fraction : part.value).join("");
}
