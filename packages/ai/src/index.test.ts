import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AI_MAX_IMAGE_DATA_LENGTH,
	AiClientError,
	type AiConnection,
	aiProviderIds,
	generateAiText,
	providerPresets,
	registerAiFetchFactory,
} from "./index";

type RecordedRequest = {
	input: RequestInfo | URL;
	init?: RequestInit;
};

const openAiResponse = (model = "test-model") => ({
	id: "chatcmpl-test",
	object: "chat.completion",
	created: 0,
	model,
	choices: [
		{
			index: 0,
			message: { role: "assistant", content: "ok" },
			finish_reason: "stop",
		},
	],
	usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
});

function mockFetch(
	response: unknown,
	status = 200,
	requests: RecordedRequest[] = [],
) {
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push({ input, init });
		return new Response(JSON.stringify(response), {
			status,
			headers: { "content-type": "application/json" },
		});
	});
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

function connection(
	provider: AiConnection["provider"],
	baseURL: string,
	model = "test-model",
): AiConnection {
	return { provider, baseURL, model, apiKey: "test-key" };
}

function bodyOf(request: RecordedRequest): Record<string, unknown> {
	return JSON.parse(String(request.init?.body)) as Record<string, unknown>;
}

function hideAbortSignalStatics(): () => void {
	const names = ["any", "timeout"] as const;
	const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(AbortSignal, name));
	for (const name of names) Object.defineProperty(AbortSignal, name, { configurable: true, value: undefined });
	return () => {
		for (const [index, name] of names.entries()) {
			const descriptor = descriptors[index];
			if (descriptor) Object.defineProperty(AbortSignal, name, descriptor);
			else Reflect.deleteProperty(AbortSignal, name);
		}
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("minimum WebView AbortSignal API compatibility", () => {
	it("uses the real provider path and disposes the caller and timer after success without static helpers", async () => {
		vi.useFakeTimers();
		const restore = hideAbortSignalStatics();
		const web = mockFetch(openAiResponse());
		const native = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(JSON.stringify(openAiResponse()), { headers: { "content-type": "application/json" } }));
		const removeFactory = registerAiFetchFactory(() => native as typeof fetch);
		const caller = new AbortController();
		const add = vi.spyOn(caller.signal, "addEventListener");
		const remove = vi.spyOn(caller.signal, "removeEventListener");
		try {
			expect((await generateAiText(connection("compatible", "https://minimum-api.synthetic.test/v1"),
				{ prompt: "synthetic", signal: caller.signal })).text).toBe("ok");
			expect(native).toHaveBeenCalledOnce();
			expect(web).not.toHaveBeenCalled();
			expect(String(native.mock.calls[0][0])).toBe("https://minimum-api.synthetic.test/v1/chat/completions");
			expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
			expect(vi.getTimerCount()).toBe(0);
			caller.abort();
			expect(native.mock.calls[0][1]?.signal?.aborted).toBe(false);
		} finally { restore(); removeFactory(); }
	});

	it.each([30_000, 120_000])("keeps the exact %i ms deadline and one provider request without static helpers", async (duration) => {
		vi.useFakeTimers();
		const restore = hideAbortSignalStatics();
		const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
			const abort = () => reject(new DOMException("Aborted", "AbortError"));
			if (init?.signal?.aborted) abort();
			else init?.signal?.addEventListener("abort", abort, { once: true });
		}));
		vi.stubGlobal("fetch", fetch);
		try {
			let settled = false;
			const pending = generateAiText(connection("compatible", "https://minimum-api.synthetic.test/v1"),
				{ prompt: "synthetic", ...(duration === 30_000 ? {} : { timeoutMs: duration }) })
				.catch((error: unknown) => { settled = true; return error; });
			await vi.advanceTimersByTimeAsync(duration - 1);
			expect(fetch).toHaveBeenCalledOnce();
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			expect(await pending).toMatchObject({ code: "timeout", message: "timeout" });
			expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
			expect(fetch).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);
		} finally { restore(); }
	});

	it("cancels an in-flight provider request and disposes its deadline without static helpers", async () => {
		vi.useFakeTimers();
		const restore = hideAbortSignalStatics();
		const caller = new AbortController();
		const add = vi.spyOn(caller.signal, "addEventListener");
		const remove = vi.spyOn(caller.signal, "removeEventListener");
		const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
			const abort = () => reject(new DOMException("Aborted", "AbortError"));
			if (init?.signal?.aborted) abort();
			else init?.signal?.addEventListener("abort", abort, { once: true });
		}));
		vi.stubGlobal("fetch", fetch);
		try {
			const pending = generateAiText(connection("compatible", "https://minimum-api.synthetic.test/v1"),
				{ prompt: "synthetic", timeoutMs: 120_000, signal: caller.signal }).catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(10);
			expect(fetch).toHaveBeenCalledOnce();
			caller.abort();
			expect(await pending).toMatchObject({ code: "cancelled", message: "cancelled" });
			expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
			expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
			expect(vi.getTimerCount()).toBe(0);
		} finally { restore(); }
	});
});

describe("AI provider connection layer", () => {
	it("keeps Web fetch by default and replaces only the selected generation through an explicit platform factory", async () => {
		const web = mockFetch(openAiResponse());
		web.mockRejectedValue(new TypeError("synthetic browser fetch failure"));
		const input = connection("openai", "https://ai.synthetic.test/v1");
		await expect(generateAiText(input, { prompt: "synthetic" })).rejects.toMatchObject({ code: "request-failed" });
		const native = vi.fn(async () => new Response(JSON.stringify(openAiResponse()), { headers: { "content-type": "application/json" } }));
		const factory = vi.fn((_connection: AiConnection, _options: { timeoutMs: number }) => native as typeof fetch), remove = registerAiFetchFactory(factory);
		try {
			expect((await generateAiText(input, { prompt: "synthetic", timeoutMs: 120000 })).text).toBe("ok");
			expect(factory).toHaveBeenCalledWith(input, { timeoutMs: 120000 });
			expect(Object.isFrozen(factory.mock.calls[0][0])).toBe(true);
			expect(native).toHaveBeenCalledOnce(); expect(web).toHaveBeenCalledOnce();
		} finally { remove(); }
		web.mockResolvedValue(new Response(JSON.stringify(openAiResponse()), { headers: { "content-type": "application/json" } }));
		expect((await generateAiText(input, { prompt: "synthetic" })).text).toBe("ok");
		expect(web).toHaveBeenCalledTimes(2); expect(native).toHaveBeenCalledOnce();
	});
	it("exposes editable presets for every supported provider", () => {
		expect(Object.keys(providerPresets).sort()).toEqual(
			[...aiProviderIds].sort(),
		);
		for (const id of aiProviderIds) {
			expect(providerPresets[id].baseURL).toMatch(
				/^(https:\/\/|http:\/\/127\.0\.0\.1)/,
			);
			expect(providerPresets[id].model).toBeTruthy();
		}
		expect(providerPresets.ollama.baseURL).toMatch(/^http:\/\/127\.0\.0\.1/);
	});

	it("uses the native OpenAI Chat Completions protocol", async () => {
		const requests: RecordedRequest[] = [];
		mockFetch(openAiResponse("gpt-test"), 200, requests);
		const result = await generateAiText(
			connection("openai", "https://api.openai.test/v1", "gpt-test"),
			{ system: "system", prompt: "hello", maxOutputTokens: 16 },
		);
		expect(result).toEqual({
			text: "ok",
			usage: { inputTokens: 3, outputTokens: 4 },
			model: "gpt-test",
			finishReason: "stop",
		});
		expect(String(requests[0].input)).toBe(
			"https://api.openai.test/v1/chat/completions",
		);
		expect(bodyOf(requests[0])).toMatchObject({
			model: "gpt-test",
			max_tokens: 16,
			messages: [
				{ role: "system", content: "system" },
				{ role: "user", content: "hello" },
			],
		});
	});

	it("uses the native Anthropic Messages protocol", async () => {
		const requests: RecordedRequest[] = [];
		mockFetch(
			{
				id: "msg-test",
				type: "message",
				role: "assistant",
				model: "claude-test",
				content: [{ type: "text", text: "anthropic ok" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 5, output_tokens: 6 },
			},
			200,
			requests,
		);
		const result = await generateAiText(
			connection("anthropic", "https://anthropic.test/v1", "claude-test"),
			{ system: "system", prompt: "hello" },
		);
		expect(result.text).toBe("anthropic ok");
		expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 6 });
		expect(String(requests[0].input)).toBe(
			"https://anthropic.test/v1/messages",
		);
		expect(bodyOf(requests[0])).toMatchObject({
			model: "claude-test",
			max_tokens: 2048,
			system: [{ type: "text", text: "system" }],
			messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
		});
	});

	it("uses the native Gemini generateContent protocol", async () => {
		const requests: RecordedRequest[] = [];
		mockFetch(
			{
				candidates: [
					{
						content: { role: "model", parts: [{ text: "gemini ok" }] },
						finishReason: "STOP",
					},
				],
				usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 8 },
				modelVersion: "gemini-test",
			},
			200,
			requests,
		);
		const result = await generateAiText(
			connection(
				"google",
				"https://generativelanguage.test/v1beta",
				"gemini-test",
			),
			{ prompt: "hello" },
		);
		expect(result.text).toBe("gemini ok");
		expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 8 });
		expect(String(requests[0].input)).toBe(
			"https://generativelanguage.test/v1beta/models/gemini-test:generateContent",
		);
		expect(bodyOf(requests[0])).toMatchObject({
			contents: [{ role: "user", parts: [{ text: "hello" }] }],
		});
	});
	it.each([
		"deepseek-flash",
		"deepseek-pro",
		"deepseek-v4-flash",
		"deepseek-v4-pro",
		"deepseek-v4-flash-vision-exp",
	])(
		"disables native DeepSeek thinking for bounded JSON requests to %s",
		async (model) => {
			const requests: RecordedRequest[] = [];
			mockFetch(openAiResponse(model), 200, requests);
			await generateAiText(
				connection("deepseek", "https://api.deepseek.test", model),
				{
					prompt: "Build a JSON reminder plan",
					json: true,
					maxOutputTokens: 1600,
				},
			);
			expect(String(requests[0].input)).toBe(
				"https://api.deepseek.test/chat/completions",
			);
			expect(bodyOf(requests[0])).toMatchObject({
				model,
				thinking: { type: "disabled" },
				max_tokens: 1600,
			});
			expect(bodyOf(requests[0]).reasoning_effort).toBeUndefined();
			expect(bodyOf(requests[0]).tools).toBeUndefined();
		},
	);

	it("preserves native DeepSeek thinking defaults for ordinary questions", async () => {
		const requests: RecordedRequest[] = [];
		mockFetch(openAiResponse("deepseek-flash"), 200, requests);
		await generateAiText(
			connection("deepseek", "https://api.deepseek.test", "deepseek-flash"),
			{ prompt: "Analyze the selected notes", maxOutputTokens: 1600 },
		);
		expect(bodyOf(requests[0]).thinking).toBeUndefined();
		expect(bodyOf(requests[0]).reasoning_effort).toBeUndefined();
		expect(bodyOf(requests[0]).max_tokens).toBe(1600);
	});

	it.each(["deepseek-chat", "deepseek-reasoner", "custom-deepseek-model"])(
		"preserves native legacy or custom DeepSeek JSON defaults for %s",
		async (model) => {
			const requests: RecordedRequest[] = [];
			mockFetch(openAiResponse(model), 200, requests);
			await generateAiText(
				connection("deepseek", "https://api.deepseek.test", model),
				{ prompt: "Return JSON", json: true },
			);
			expect(bodyOf(requests[0]).thinking).toBeUndefined();
		},
	);

	it.each(["openai", "compatible", "doubao", "ollama"] as const)(
		"does not add DeepSeek thinking controls to the %s protocol",
		async (provider) => {
			const requests: RecordedRequest[] = [];
			mockFetch(openAiResponse("deepseek-flash"), 200, requests);
			await generateAiText(
				connection(provider, "https://gateway.test/v1", "deepseek-flash"),
				{ prompt: "Return JSON", json: true },
			);
			expect(bodyOf(requests[0]).thinking).toBeUndefined();
			expect(bodyOf(requests[0]).reasoning_effort).toBeUndefined();
		},
	);

	it("normalizes a full compatible chat/completions URL and applies request guards", async () => {
		const requests: RecordedRequest[] = [];
		mockFetch(openAiResponse(), 200, requests);
		await generateAiText(
			connection("compatible", "https://gateway.test/api/v1/chat/completions"),
			{ system: "Use JSON", prompt: "hello", json: true },
		);
		expect(String(requests[0].input)).toBe(
			"https://gateway.test/api/v1/chat/completions",
		);
		expect(requests[0].init?.credentials).toBe("omit");
		expect(requests[0].init?.redirect).toBe("error");
		expect(requests[0].init?.referrerPolicy).toBe("no-referrer");
		const body = bodyOf(requests[0]);
		expect(body.tools).toBeUndefined();
		expect(
			(body.messages as Array<Record<string, unknown>>)[0].content,
		).toContain("Return only valid JSON");
	});

	it("maps image input to provider image content and rejects remote image URLs", async () => {
		const requests: RecordedRequest[] = [];
		mockFetch(openAiResponse(), 200, requests);
		await generateAiText(connection("openai", "https://api.openai.test/v1"), {
			prompt: "describe",
			image: { data: "aGVsbG8=", mediaType: "image/png" },
		});
		const messages = bodyOf(requests[0]).messages as Array<
			Record<string, unknown>
		>;
		const content = (messages.at(-1) as Record<string, unknown>).content;
		expect(content).toEqual([
			{ type: "text", text: "describe" },
			{
				type: "image_url",
				image_url: { url: "data:image/png;base64,aGVsbG8=" },
			},
		]);
		await expect(
			generateAiText(connection("openai", "https://api.openai.test/v1"), {
				prompt: "describe",
				image: {
					data: "https://example.test/image.png",
					mediaType: "image/png",
				},
			}),
		).rejects.toMatchObject({ code: "invalid-image" });
	});

	it("does not retry or expose provider error details", async () => {
		const requests: RecordedRequest[] = [];
		mockFetch(
			{ error: { message: "private-key-should-not-escape" } },
			401,
			requests,
		);
		const error = await generateAiText(
			connection("deepseek", "https://api.deepseek.test"),
			{ prompt: "hello" },
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(AiClientError);
		expect(error).toMatchObject({
			code: "request-failed",
			message: "request-failed",
		});
		expect(String(error)).not.toContain("private-key");
		expect(requests).toHaveLength(1);
	});

	it("returns null for missing or invalid provider usage counters", async () => {
		const requests: RecordedRequest[] = [];
		const response = openAiResponse();
		response.usage = {
			prompt_tokens: -1,
			completion_tokens: 1.5,
			total_tokens: 0,
		};
		mockFetch(response, 200, requests);
		const result = await generateAiText(
			connection("openai", "https://api.openai.test/v1"),
			{ prompt: "hello" },
		);
		expect(result.usage).toEqual({ inputTokens: null, outputTokens: null });
	});

	it("cancels a request through the caller signal", async () => {
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					const abort = () => reject(new DOMException("Aborted", "AbortError"));
					if (init?.signal?.aborted) abort();
					else init?.signal?.addEventListener("abort", abort, { once: true });
				}),
		);
		vi.stubGlobal("fetch", fetch);
		const controller = new AbortController();
		const pending = generateAiText(
			connection("openai", "https://api.openai.test/v1"),
			{ prompt: "hello", signal: controller.signal },
		);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: "cancelled" });
	});

	it.each([
		{ timeoutMs: undefined, duration: 30_000 },
		{ timeoutMs: 120_000, duration: 120_000 },
	])(
		"uses the bounded total timeout without retrying: $duration ms",
		async ({ timeoutMs, duration }) => {
			vi.useFakeTimers();
			const fetch = vi.fn(
				async (_input: RequestInfo | URL, init?: RequestInit) =>
					await new Promise<Response>((_resolve, reject) => {
						const abort = () =>
							reject(new DOMException("Aborted", "AbortError"));
						if (init?.signal?.aborted) abort();
						else init?.signal?.addEventListener("abort", abort, { once: true });
					}),
			);
			vi.stubGlobal("fetch", fetch);
			let settled = false;
			const pending = generateAiText(
				connection("openai", "https://api.openai.test/v1"),
				{
					prompt: "synthetic",
					...(timeoutMs === undefined ? {} : { timeoutMs }),
				},
			).catch((error: unknown) => {
				settled = true;
				return error;
			});
			await vi.advanceTimersByTimeAsync(duration - 1);
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			expect(await pending).toMatchObject({
				code: "timeout",
				message: "timeout",
			});
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);

	it("cancels a long request immediately without waiting for its timeout", async () => {
		vi.useFakeTimers();
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					const abort = () => reject(new DOMException("Aborted", "AbortError"));
					if (init?.signal?.aborted) abort();
					else init?.signal?.addEventListener("abort", abort, { once: true });
				}),
		);
		vi.stubGlobal("fetch", fetch);
		const controller = new AbortController();
		const pending = generateAiText(
			connection("openai", "https://api.openai.test/v1"),
			{ prompt: "synthetic", timeoutMs: 120_000, signal: controller.signal },
		).catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(30_001);
		controller.abort();
		expect(await pending).toMatchObject({
			code: "cancelled",
			message: "cancelled",
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it.each([0, 999, 120_001, 1.5, NaN, Infinity])(
		"rejects an invalid timeout before network access: %s",
		async (timeoutMs) => {
			const fetch = mockFetch(openAiResponse());
			await expect(
				generateAiText(connection("openai", "https://api.openai.test/v1"), {
					prompt: "synthetic",
					timeoutMs,
				}),
			).rejects.toMatchObject({ code: "invalid-connection" });
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it("returns only the SDK-normalized finish reason", async () => {
		const response = openAiResponse();
		response.choices[0].finish_reason = "length";
		mockFetch(response);
		const result = await generateAiText(
			connection("openai", "https://api.openai.test/v1"),
			{ prompt: "synthetic" },
		);
		expect(result.finishReason).toBe("length");
		expect(result).not.toHaveProperty("rawFinishReason");
	});

	it("enforces the image and output limits before network access", async () => {
		const fetch = mockFetch(openAiResponse());
		await expect(
			generateAiText(connection("openai", "https://api.openai.test/v1"), {
				prompt: "hello",
				maxOutputTokens: 8_193,
			}),
		).rejects.toMatchObject({ code: "invalid-connection" });
		await expect(
			generateAiText(connection("openai", "https://api.openai.test/v1"), {
				prompt: "hello",
				image: {
					data: "a".repeat(AI_MAX_IMAGE_DATA_LENGTH + 1),
					mediaType: "image/png",
				},
			}),
		).rejects.toMatchObject({ code: "invalid-image" });
		expect(fetch).not.toHaveBeenCalled();
	});
});
