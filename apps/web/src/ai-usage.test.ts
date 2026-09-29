import { describe, expect, it } from "vitest";
import { estimateAiCost, readAiUsage } from "./ai-usage";

describe("AI response usage and user-rate estimate", () => {
	it("reads only valid standard Chat Completions input and output counts", () => {
		expect(readAiUsage({ usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } }))
			.toEqual({ inputTokens: 123, outputTokens: 45 });
		expect(readAiUsage({ usage: { prompt_tokens: 0, completion_tokens: -1, total_tokens: 10 } }))
			.toEqual({ inputTokens: 0, outputTokens: null });
		expect(readAiUsage({ usage: { prompt_tokens: "123", completion_tokens: 1.5 } }))
			.toEqual({ inputTokens: null, outputTokens: null });
		expect(readAiUsage({ usage: { total_tokens: 168 } }))
			.toEqual({ inputTokens: null, outputTokens: null });
		expect(readAiUsage(null)).toEqual({ inputTokens: null, outputTokens: null });
	});

	it("estimates only with both reported counts and both entered rates", () => {
		const usage = { inputTokens: 123, outputTokens: 45 };
		expect(estimateAiCost(usage, "2", "8", "USD")).toBeCloseTo(0.000606);
		expect(estimateAiCost(usage, "0", "0", "CNY")).toBe(0);
		expect(estimateAiCost({ ...usage, outputTokens: null }, "2", "8", "USD")).toBeNull();
		expect(estimateAiCost(usage, "", "8", "USD")).toBeNull();
		expect(estimateAiCost(usage, "-1", "8", "USD")).toBeNull();
		expect(estimateAiCost(usage, "2", "Infinity", "USD")).toBeNull();
		expect(estimateAiCost(usage, "2", "8", "US")).toBeNull();
	});
});
