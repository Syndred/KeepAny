import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createMiniMax } from "@ai-sdk/minimax";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
	type FinishReason,
	generateText,
	type LanguageModel,
	type ModelMessage,
} from "ai";

export const aiProviderIds = [
	"openai",
	"anthropic",
	"google",
	"deepseek",
	"qwen",
	"doubao",
	"moonshot",
	"minimax",
	"openrouter",
	"ollama",
	"compatible",
] as const;

export type AiProviderId = (typeof aiProviderIds)[number];

export type AiConnection = {
	provider: AiProviderId;
	baseURL: string;
	model: string;
	apiKey: string;
};

export type AiFetchFactory = (connection: Readonly<AiConnection>, options: { timeoutMs: number }) => typeof fetch;
let platformFetchFactory: AiFetchFactory | undefined;
/** Platform bootstrap only. Web keeps its standard fetch; no global patch. */
export function registerAiFetchFactory(factory: AiFetchFactory): () => void {
	platformFetchFactory = factory;
	return () => { if (platformFetchFactory === factory) platformFetchFactory = undefined; };
}

export type AiProviderPreset = {
	baseURL: string;
	model: string;
	label?: string;
	vision?: boolean;
};

/**
 * Editable defaults for the settings screen. A preset is only metadata; it
 * never supplies a credential and selecting it does not make a request.
 */
export const providerPresets: Record<AiProviderId, AiProviderPreset> = {
	openai: {
		label: "OpenAI",
		baseURL: "https://api.openai.com/v1",
		model: "gpt-5.4-mini",
		vision: true,
	},
	anthropic: {
		label: "Anthropic",
		baseURL: "https://api.anthropic.com/v1",
		model: "claude-haiku-4-5",
		vision: true,
	},
	google: {
		label: "Google Gemini",
		baseURL: "https://generativelanguage.googleapis.com/v1beta",
		model: "gemini-3.8-flash",
		vision: true,
	},
	deepseek: {
		label: "DeepSeek",
		baseURL: "https://api.deepseek.com",
		model: "deepseek-flash",
		vision: true,
	},
	qwen: {
		label: "Qwen",
		baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		model: "qwen-plus",
		vision: false,
	},
	doubao: {
		label: "Doubao",
		baseURL: "https://ark.cn-beijing.volces.com/api/v3",
		model: "doubao-seed-1-6-flash-250828",
		vision: true,
	},
	moonshot: {
		label: "Moonshot / Kimi",
		baseURL: "https://api.moonshot.ai/v1",
		model: "kimi-k3",
		vision: true,
	},
	minimax: {
		label: "MiniMax",
		baseURL: "https://api.minimax.io/anthropic/v1",
		model: "minimax-m3",
		vision: true,
	},
	openrouter: {
		label: "OpenRouter",
		baseURL: "https://openrouter.ai/api/v1",
		model: "openai/gpt-5.4-mini",
		vision: true,
	},
	ollama: {
		label: "Ollama",
		baseURL: "http://127.0.0.1:11434/v1",
		model: "llama3.2",
		vision: false,
	},
	compatible: {
		label: "OpenAI-compatible gateway",
		baseURL: "https://api.example.com/v1",
		model: "model",
		vision: false,
	},
};

export type AiImageInput = {
	data: string;
	mediaType: string;
};

export type GenerateAiTextOptions = {
	system?: string;
	prompt: string;
	image?: AiImageInput;
	signal?: AbortSignal;
	json?: boolean;
	maxOutputTokens?: number;
	timeoutMs?: number;
};

export type AiUsage = {
	inputTokens: number | null;
	outputTokens: number | null;
};

export type GenerateAiTextResult = {
	text: string;
	usage: AiUsage;
	model: string | null;
	finishReason?: FinishReason;
};

export type AiErrorCode =
	| "invalid-connection"
	| "invalid-image"
	| "request-failed"
	| "cancelled"
	| "timeout";

/** Stable, non-provider error codes for UI and tests. Provider diagnostics are intentionally omitted. */
export class AiClientError extends Error {
	readonly code: AiErrorCode;

	constructor(code: AiErrorCode) {
		super(code);
		this.code = code;
		this.name = "AiClientError";
	}
}

export const AI_REQUEST_TIMEOUT_MS = 30_000;
export const AI_MIN_REQUEST_TIMEOUT_MS = 1_000;
export const AI_MAX_REQUEST_TIMEOUT_MS = 120_000;
export const AI_DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
export const AI_MAX_OUTPUT_TOKENS = 8_192;
export const AI_MAX_IMAGE_DATA_LENGTH = 14_000_000;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const IMAGE_MEDIA_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/jpg",
	"image/webp",
	"image/gif",
	"image/bmp",
	"image/heic",
	"image/heif",
]);
// The native SDK lists these V4 models and recognizes the unversioned Pro
// alias. Keep legacy/custom model IDs on their existing server defaults.
// https://api-docs.deepseek.com/guides/thinking_mode/
const DEEPSEEK_JSON_NON_THINKING_MODELS = new Set([
	"deepseek-flash",
	"deepseek-pro",
	"deepseek-v4-flash",
	"deepseek-v4-pro",
	"deepseek-v4-flash-vision-exp",
]);

function readUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new AiClientError("invalid-connection");
	}
	const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.href.length > 2_048
	) {
		throw new AiClientError("invalid-connection");
	}
	return url;
}

function normalizeBaseURL(
	value: string,
	stripChatCompletions: boolean,
): string {
	const url = readUrl(value);
	if (stripChatCompletions) {
		const path = url.pathname.replace(/\/+$/, "");
		const suffix = "/chat/completions";
		if (path.endsWith(suffix)) {
			url.pathname = path.slice(0, -suffix.length) || "/";
		}
	}
	return url.href.replace(/\/$/, "");
}

function validateConnection(connection: AiConnection): AiConnection {
	if (
		!connection ||
		!aiProviderIds.includes(connection.provider) ||
		typeof connection.baseURL !== "string" ||
		typeof connection.model !== "string" ||
		typeof connection.apiKey !== "string"
	) {
		throw new AiClientError("invalid-connection");
	}
	const model = connection.model.trim();
	const apiKey = connection.apiKey;
	if (!model || model.length > 200 || apiKey.length > 4_096)
		throw new AiClientError("invalid-connection");
	const url = readUrl(connection.baseURL);
	return {
		provider: connection.provider,
		baseURL: url.href.replace(/\/$/, ""),
		model,
		apiKey,
	};
}

function normalizeImage(input: AiImageInput): AiImageInput {
	if (
		!input ||
		typeof input.data !== "string" ||
		typeof input.mediaType !== "string"
	)
		throw new AiClientError("invalid-image");
	let data = input.data.trim();
	const mediaType = input.mediaType.trim().toLowerCase();
	const dataUrl = /^data:([^;,]+);base64,(.*)$/is.exec(data);
	if (dataUrl) {
		if (dataUrl[1].toLowerCase() !== mediaType)
			throw new AiClientError("invalid-image");
		data = dataUrl[2];
	}
	if (
		!IMAGE_MEDIA_TYPES.has(mediaType) ||
		!data ||
		data.length > AI_MAX_IMAGE_DATA_LENGTH ||
		data.startsWith("http://") ||
		data.startsWith("https://") ||
		!/^[A-Za-z0-9+/_-]*={0,2}$/.test(data) ||
		(data.includes("=") && !/={1,2}$/.test(data))
	) {
		throw new AiClientError("invalid-image");
	}
	return { data, mediaType };
}

function isChatCompletionsProvider(provider: AiProviderId): boolean {
	return [
		"openai",
		"deepseek",
		"qwen",
		"doubao",
		"moonshot",
		"openrouter",
		"ollama",
		"compatible",
	].includes(provider);
}

function secureFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
	fetcher: typeof fetch = globalThis.fetch,
): Promise<Response> {
	const headers = new Headers(init?.headers !== undefined ? init.headers : input instanceof Request ? input.headers : undefined);
	return fetcher(input, {
		...init,
		credentials: "omit",
		redirect: "error",
		referrerPolicy: "no-referrer",
		headers,
	});
}

function createCombinedSignal(
	requestSignal: AbortSignal | undefined,
	timeoutSignal: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
	if (!requestSignal) return { signal: timeoutSignal, dispose: () => {} };
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (requestSignal.aborted || timeoutSignal.aborted) controller.abort();
	else {
		requestSignal.addEventListener("abort", abort, { once: true });
		timeoutSignal.addEventListener("abort", abort, { once: true });
	}
	return {
		signal: controller.signal,
		dispose: () => {
			requestSignal.removeEventListener("abort", abort);
			timeoutSignal.removeEventListener("abort", abort);
		},
	};
}

function compatibleBaseURL(connection: AiConnection): string {
	return normalizeBaseURL(connection.baseURL, true);
}

function createLanguageModel(connection: AiConnection, timeoutMs: number): LanguageModel {
	const platformFetch = platformFetchFactory?.(Object.freeze({ ...connection }), { timeoutMs }) ?? globalThis.fetch;
	const fetcher: typeof fetch = (input, init) => secureFetch(input, init, platformFetch);
	const baseURL = isChatCompletionsProvider(connection.provider)
		? compatibleBaseURL(connection)
		: normalizeBaseURL(connection.baseURL, false);
	const common = { apiKey: connection.apiKey, baseURL, fetch: fetcher };

	switch (connection.provider) {
		case "openai":
			return createOpenAI({ ...common, name: "keepany-openai" }).chat(
				connection.model,
			);
		case "anthropic":
			return createAnthropic({ ...common, name: "keepany-anthropic" }).messages(
				connection.model,
			);
		case "google":
			return createGoogle({ ...common, name: "keepany-google" }).chat(
				connection.model,
			);
		case "deepseek":
			return createDeepSeek({ ...common }).chat(connection.model);
		case "qwen":
			return createAlibaba({ ...common }).chatModel(connection.model);
		case "doubao":
		case "ollama":
		case "compatible":
			return createOpenAICompatible({
				name: `keepany-${connection.provider}`,
				baseURL,
				apiKey: connection.apiKey,
				fetch: fetcher,
				includeUsage: true,
			}).chatModel(connection.model);
		case "moonshot":
			return createMoonshotAI({ ...common }).chatModel(connection.model);
		case "minimax":
			return createMiniMax({ ...common }).chat(connection.model);
		case "openrouter":
			return createOpenRouter({
				...common,
				compatibility: "strict",
			}).chat(connection.model);
	}
}

function asPrompt(
	system: string | undefined,
	json: boolean,
): string | undefined {
	const instruction = json
		? "Return only valid JSON. Do not wrap it in Markdown fences or add commentary."
		: "";
	const value = [system?.trim(), instruction].filter(Boolean).join("\n\n");
	return value || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toClientError(
	error: unknown,
	requestSignal: AbortSignal | undefined,
	timeoutSignal: AbortSignal,
): AiClientError {
	if (requestSignal?.aborted) return new AiClientError("cancelled");
	if (timeoutSignal.aborted) return new AiClientError("timeout");
	if (
		isRecord(error) &&
		(error.name === "TimeoutError" || error.code === "TIMEOUT")
	)
		return new AiClientError("timeout");
	return new AiClientError("request-failed");
}

function normalizeUsage(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

/**
 * Generate one text response through the selected provider. The function only
 * requests text: no tools are registered or executed. JSON requests add a
 * strict instruction for the caller's schema validation and disable thinking
 * for known native DeepSeek V4 models so reasoning cannot consume the bounded
 * output budget before a final JSON answer is returned.
 */
export async function generateAiText(
	inputConnection: AiConnection,
	options: GenerateAiTextOptions,
): Promise<GenerateAiTextResult> {
	const connection = validateConnection(inputConnection);
	if (!options || typeof options.prompt !== "string" || !options.prompt.trim())
		throw new AiClientError("invalid-connection");
	const maxOutputTokens =
		options.maxOutputTokens ?? AI_DEFAULT_MAX_OUTPUT_TOKENS;
	if (
		!Number.isSafeInteger(maxOutputTokens) ||
		maxOutputTokens < 1 ||
		maxOutputTokens > AI_MAX_OUTPUT_TOKENS
	)
		throw new AiClientError("invalid-connection");
	const timeoutMs = options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
	if (
		!Number.isSafeInteger(timeoutMs) ||
		timeoutMs < AI_MIN_REQUEST_TIMEOUT_MS ||
		timeoutMs > AI_MAX_REQUEST_TIMEOUT_MS
	)
		throw new AiClientError("invalid-connection");
	const image = options.image ? normalizeImage(options.image) : undefined;
	if (options.signal?.aborted) throw new AiClientError("cancelled");

	const timeoutController = new AbortController();
	const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
	const combined = createCombinedSignal(
		options.signal,
		timeoutController.signal,
	);
	try {
		const content = image
			? ([
					{ type: "text", text: options.prompt },
					{ type: "file", data: image.data, mediaType: image.mediaType },
				] as unknown as ModelMessage["content"])
			: options.prompt;
		const result = await generateText({
			model: createLanguageModel(connection, timeoutMs),
			messages: [{ role: "user", content } as ModelMessage],
			system: asPrompt(options.system, options.json === true),
			providerOptions:
				options.json === true &&
				connection.provider === "deepseek" &&
				DEEPSEEK_JSON_NON_THINKING_MODELS.has(connection.model)
					? { deepseek: { thinking: { type: "disabled" } } }
					: undefined,
			maxOutputTokens,
			maxRetries: 0,
			abortSignal: combined.signal,
			timeout: { totalMs: timeoutMs },
			telemetry: {
				isEnabled: false,
				recordInputs: false,
				recordOutputs: false,
			},
		});
		return {
			text: result.text,
			usage: {
				inputTokens: normalizeUsage(result.usage.inputTokens),
				outputTokens: normalizeUsage(result.usage.outputTokens),
			},
			model: result.response.modelId || null,
			finishReason: result.finishReason,
		};
	} catch (error) {
		throw toClientError(error, options.signal, timeoutController.signal);
	} finally {
		clearTimeout(timeoutId);
		combined.dispose();
	}
}
