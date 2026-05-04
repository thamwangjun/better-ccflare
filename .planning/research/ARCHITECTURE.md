# OpenRouter Provider — Architecture

**Researched:** 2026-05-04
**Confidence:** HIGH (all findings from direct source reading)

---

## Current buildRequest() behavior

The OpenRouter provider does not have a `buildRequest()` method — the codebase uses `transformRequestBody()` instead. Here is what the actual call chain does:

**Class hierarchy:**
`OpenRouterProvider` extends `AnthropicCompatibleProvider` extends `BaseAnthropicCompatibleProvider` extends `BaseProvider`

**`transformRequestBody()` chain (called in `proxy-operations.ts` at the point of dispatching):**

1. `BaseAnthropicCompatibleProvider.transformRequestBody()` runs first (via `super.transformRequestBody()`). It calls `transformRequestBodyModel()` which rewrites `body.model` using `mapModelName()` — handling array mappings, fallbacks, env overrides, and defaults from the account config.

2. `OpenRouterProvider.transformRequestBody()` then takes the model-mapped request, clones it, parses the JSON body, injects `cache_control: { type: "ephemeral" }` at the top level, and rebuilds a new `Request` with the modified body.

**Fields set after the full chain:**
- `model` — rewritten by model mapping logic
- `cache_control: { type: "ephemeral" }` — injected by OpenRouter override
- All original client fields are preserved (messages, max_tokens, stream, etc.)

**URL building** (`buildUrl()`): Prefers `account.custom_endpoint` over the hardcoded default `https://openrouter.ai/api/v1`. Strips trailing slash and appends pathname + search directly (no path deduplication, unlike `AnthropicCompatibleProvider.buildUrl()` which strips duplicate path prefixes).

**Header preparation** (`prepareHeaders()`): Inherited from `BaseAnthropicCompatibleProvider`. Deletes `authorization` and `x-api-key` from the client request, then sets `Authorization: Bearer <token>` (because `authHeader = "Authorization"` and `authType = "bearer"`). Also deletes `host` and both compression headers (`accept-encoding`, `content-encoding`).

---

## Token/Usage extraction

OpenRouter uses the **Anthropic SSE wire format** (not OpenAI's `data: [DONE]` format), so usage comes from `message_start` and `message_delta` events.

**Where it happens:** `BaseAnthropicCompatibleProvider.extractUsageInfo()` — inherited unchanged by `OpenRouterProvider`. No OpenRouter-specific override exists.

**Non-streaming path:** Parses `response.json()`, reads `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`, and `usage.cache_read_input_tokens`. Computes `promptTokens = input + cacheCreation + cacheRead`.

**Streaming path:** `extractStreamingUsage()` scans the SSE stream for `event: message_start` (captures `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `model`) and `event: message_delta` (captures final `output_tokens` and `cache_read_input_tokens`). `message_delta` values are treated as authoritative — they override `message_start` values when present.

**`prompt_tokens_details` handling:** This is in `packages/providers/src/providers/openai/provider.ts` and `packages/openai-formats/src/stream.ts` — NOT in the OpenRouter provider. Those files extract `cache_write_tokens` and `cached_tokens` from `prompt_tokens_details` for providers that return OpenAI-format responses (Qwen/DashScope, generic OpenAI-compatible). OpenRouter uses the Anthropic SSE format so it does not go through those paths.

**Dispatch point in proxy layer:** `response-processor.ts` (`updateAccountMetadata`) checks `ctx.provider.isStreamingResponse(response)`. If streaming and `provider.parseUsage` exists, it calls `parseUsage`. Otherwise it calls `extractUsageInfo`. `OpenRouterProvider` does not implement `parseUsage`, so it always goes through `extractUsageInfo` — which itself delegates to `extractStreamingUsage` for SSE responses.

**Cost calculation:** `estimateCostUSD()` from `@better-ccflare/core` is called with the model name from the `message_start` event and the token counts.

---

## Provider selection integration point

"Provider selection" here means pinning a request to a specific upstream model provider through OpenRouter's `provider` parameter (e.g., `{ "provider": { "order": ["Anthropic"] } }`).

**Recommended integration point: `OpenRouterProvider.transformRequestBody()`**

This is already where OpenRouter-specific request mutations happen (`cache_control` injection). Adding provider selection here is consistent, contained, and does not require changes to the proxy layer or the base class.

The pattern would be:
1. Accept the desired provider preference (e.g., from account config or a request header like `x-better-ccflare-openrouter-provider`).
2. In `transformRequestBody()`, after parsing the body and before rebuilding the Request, inject `body.provider = { order: [selectedProvider] }` (or `allow_fallbacks: false`, etc.).

**Why not a request transform in the proxy layer:** `proxy-operations.ts` already applies a model override (`body.model = modelOverride`) directly on the buffer before `transformRequestBody` is called. Any additional OpenRouter-specific mutation there would couple the proxy layer to provider-specific knowledge. The provider owns its own request shape.

**Why not `prepareHeaders()`:** Provider selection is a body-level field, not a header. OpenRouter's provider routing is part of the JSON request body.

**Source of the preference:** It can come from:
- `account.custom_endpoint` is already used for URL; a similar `account.provider_options` JSON field would be the cleanest DB-level approach.
- A passthrough header (`x-better-ccflare-openrouter-provider`) is simpler if no DB schema change is wanted. Headers are available in `transformRequestBody` via `request.headers`.

---

## Streaming considerations

OpenRouter uses the **Anthropic SSE event format** for Anthropic-family models (Claude), not the OpenAI `data: {"choices":[...]}` / `data: [DONE]` format. This means:

1. **Tool call chunks are cumulative, not incremental.** Unlike Qwen/DashScope (which sends incremental argument chunks), OpenRouter forwards Anthropic's native SSE events where `input_json_delta` chunks are already well-formed partial strings. No special buffering is needed for tool calls on the OpenRouter path — the base Anthropic SSE handling works correctly.

2. **`message_delta` is the source of truth for final token counts.** The `extractStreamingUsage` implementation already breaks out of its read loop as soon as `messageDeltaUsage` is populated, treating it as authoritative. This is correct for OpenRouter.

3. **`cache_control` injection at the body level is the right approach for prompt caching.** OpenRouter's prompt caching for Anthropic models is triggered by the `cache_control` field at the request body level (not per-message-block). This is already implemented.

4. **No `parseUsage` override.** `OpenRouterProvider` does not implement `parseUsage`. The proxy layer falls back to `extractUsageInfo`, which correctly dispatches to `extractStreamingUsage` for SSE responses. This works but means usage extraction reads the cloned response body independently of the forwarding path — acceptable given that the clone is made before the response is forwarded.

5. **Non-Anthropic models via OpenRouter** (e.g., GPT-4o, Gemini) will return OpenAI-format SSE. The current `extractStreamingUsage` will not find `message_start`/`message_delta` events and return null. Usage tracking silently drops for non-Anthropic models routed through OpenRouter. This is a known gap.

---

## Extension pattern

The codebase has a clean, established pattern for adding capabilities to an existing provider without breaking inherited behavior:

**Step 1: Override `transformRequestBody()` in `OpenRouterProvider`**

Always call `super.transformRequestBody(request, account)` first to get model mapping applied, then apply OpenRouter-specific mutations. The current `cache_control` injection demonstrates this pattern exactly.

```typescript
override async transformRequestBody(request: Request, account?: Account): Promise<Request> {
  const mapped = await super.transformRequestBody(request, account);
  // ... mutate body ...
  return new Request(mapped.url, { method, headers, body: JSON.stringify(body) });
}
```

**Step 2: Override `extractUsageInfo()` only if OpenRouter's response shape diverges**

Currently it inherits the Anthropic-compatible streaming parser which is correct. Only override if you need to handle `prompt_tokens_details` for non-Anthropic model responses routed through OpenRouter.

**Step 3: Do not touch the proxy layer (`proxy-operations.ts`) for provider-specific logic**

The proxy layer is provider-agnostic by design. Provider-specific knowledge belongs in the provider class. The only proxy-layer mutation that is provider-aware today is the `modelOverride` patch, which is a combo-slot feature — not provider-specific.

**Step 4: Add optional configuration to the provider constructor**

The `AnthropicCompatibleConfig` interface is the right place to add new provider-level options. `OpenRouterProvider` currently hard-codes its config in the constructor. To support runtime configuration (e.g., per-account provider preferences), read from `account` in `transformRequestBody` rather than from constructor config — the `account` parameter is always passed by the proxy layer.

**Step 5: Write tests in `__tests__/provider.test.ts`**

The existing test file (`packages/providers/src/providers/openrouter/__tests__/provider.test.ts`) tests `transformRequestBody` directly against a Request object. Add new tests that cover each new mutation path, following the exact pattern already there (construct a `Request`, call `transformRequestBody`, assert on `result.json()`).
