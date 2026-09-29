export type AiUsage = { inputTokens: number | null; outputTokens: number | null };

function tokenCount(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

// Chat Completions usage is provider-reported. A total alone cannot establish
// the input/output split needed for a two-rate estimate.
export function readAiUsage(response: unknown): AiUsage {
	if (!response || typeof response !== "object")
		return { inputTokens: null, outputTokens: null };
	const usage = (response as { usage?: unknown }).usage;
	if (!usage || typeof usage !== "object")
		return { inputTokens: null, outputTokens: null };
	const counts = usage as { prompt_tokens?: unknown; completion_tokens?: unknown };
	return {
		inputTokens: tokenCount(counts.prompt_tokens),
		outputTokens: tokenCount(counts.completion_tokens),
	};
}

export function readUnitPrice(value: string): number | null {
	const trimmed = value.trim();
	if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
	const price = Number(trimmed);
	return Number.isFinite(price) && price >= 0 ? price : null;
}

export function estimateAiCost(
	usage: AiUsage,
	inputPrice: string,
	outputPrice: string,
	currency: string,
): number | null {
	const input = readUnitPrice(inputPrice);
	const output = readUnitPrice(outputPrice);
	if (
		usage.inputTokens === null ||
		usage.outputTokens === null ||
		input === null ||
		output === null ||
		!(/^[A-Z]{3}$/.test(currency.trim()))
	) return null;
	const result = (usage.inputTokens * input + usage.outputTokens * output) / 1_000_000;
	return Number.isFinite(result) ? result : null;
}
