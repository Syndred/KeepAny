# KeepAny AI connection layer

`packages/ai/src` exposes one browser-safe text generation entry point for the
settings, assistant, and AI import flows. The connection object contains the
selected provider, base URL, model, and an in-memory API key:

```ts
import { generateAiText, type AiConnection } from "./src";

const connection: AiConnection = {
  provider: "deepseek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-flash",
  apiKey: "key-held-by-the-current-session",
};

const result = await generateAiText(connection, {
  system: "Answer from the supplied records only.",
  prompt: "Summarize these records.",
  maxOutputTokens: 1200,
});
```

`providerPresets` is a `Record<AiProviderId, { baseURL, model, label?, vision? }>`
used only to fill editable settings. It does not contain credentials or make a
request. The current adapters are OpenAI Chat Completions, Anthropic Messages,
Gemini `generateContent`, official DeepSeek, Alibaba/Qwen, Moonshot/Kimi,
MiniMax, OpenRouter, and OpenAI-compatible routes for Doubao, Ollama, and custom
gateways. A custom gateway may be entered either as its base URL or as a full
`.../chat/completions` URL; the latter is normalized before the SDK call.

The adapter accepts HTTPS endpoints and HTTP loopback endpoints only. URL
credentials, query strings, and fragments are rejected. Requests use omitted
credentials, redirect errors, no referrer, no retries, a finite timeout, and an
output token cap. SDK telemetry is disabled, provider errors are reduced to
stable `AiClientError` codes, and no key or raw SDK diagnostic is logged. The
`json` option asks the model for JSON text; the calling workflow remains
responsible for validating it with its own Zod schema.

The implementation follows the [AI SDK `generateText` contract](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)
and the provider adapters documented by [Anthropic](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic),
[Google](https://ai-sdk.dev/providers/ai-sdk-providers/google),
[OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers),
and [OpenRouter](https://openrouter.ai/docs).

The root dependency lock uses exact versions that passed the repository's
release-age policy on 2026-09-29:

| Adapter | npm package | Version |
| --- | --- | --- |
| Core | `ai` | `7.0.122` |
| OpenAI | `@ai-sdk/openai` | `4.0.81` |
| Anthropic | `@ai-sdk/anthropic` | `4.0.68` |
| Gemini | `@ai-sdk/google` | `4.0.85` |
| DeepSeek | `@ai-sdk/deepseek` | `3.0.56` |
| Qwen | `@ai-sdk/alibaba` | `2.0.58` |
| MiniMax | `@ai-sdk/minimax` | `3.0.45` |
| Moonshot | `@ai-sdk/moonshotai` | `3.0.60` |
| Compatible | `@ai-sdk/openai-compatible` | `3.0.59` |
| OpenRouter | `@openrouter/ai-sdk-provider` | `3.1.0` |

The module tests use deterministic fetch mocks for the OpenAI, Anthropic,
Gemini, and compatible wire protocols, plus image, cancellation, URL, retry,
and error-boundary cases. They never send a real credential. A real provider
acceptance check must be run separately with an explicitly supplied key.
