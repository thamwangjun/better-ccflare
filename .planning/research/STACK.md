# OpenRouter — Caching & Provider Selection

**Researched:** 2026-05-04
**Overall confidence:** MEDIUM-HIGH (official docs verified via WebFetch; some field-level details cross-checked against open-source issue trackers)

---

## Prompt Caching

### How OpenRouter exposes caching

OpenRouter has two distinct caching features. Do not confuse them:

1. **Prompt caching** — provider-side token reuse. Saves on billing by not re-processing repeated prompt prefixes. The focus of this document.
2. **Response caching** — OpenRouter-level exact-match deduplication. A fully identical request returns the cached response for free (all usage counters zeroed). Orthogonal to prompt caching.

### Which providers support prompt caching

| Provider | Type | Configuration required |
|---|---|---|
| Anthropic (direct) | Explicit via `cache_control` | Yes — `cache_control` blocks on content |
| OpenAI | Automatic (1024-token minimum) | None |
| Google Gemini 2.5 | Implicit/automatic | None (explicit breakpoints supported) |
| DeepSeek | Automatic | None |
| Grok (xAI) | Automatic | None |
| Groq | Automatic (Kimi K2 only) | None |
| Moonshot AI | Automatic | None |
| Anthropic via Bedrock/Vertex | Not supported | N/A — excluded by OpenRouter when top-level `cache_control` is set |

### Request shapes

**Automatic caching (top-level field — Anthropic only, direct routing):**
```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "cache_control": { "type": "ephemeral" },
  "messages": [...]
}
```
This is what `OpenRouterProvider.transformRequestBody` currently injects. OpenRouter advances the cache breakpoint to the last cacheable block automatically. CONSTRAINT: when this field is present, OpenRouter excludes Bedrock and Vertex backends, routing only to direct Anthropic.

**Explicit breakpoints (fine-grained, Anthropic + Gemini):**
```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "<large document>",
          "cache_control": { "type": "ephemeral" }
        }
      ]
    }
  ]
}
```
Anthropic limits to 4 explicit breakpoints per request. Gemini has no limit.

**TTL extension (Anthropic only):**
```json
"cache_control": { "type": "ephemeral", "ttl": "1h" }
```
Supported TTL values: `5m` (default) and `1h`. 1-hour TTL costs 2x base input price to write but avoids repeated writes in long sessions.

### Response usage structure (OpenRouter format)

OpenRouter normalises cache token reporting into its own field names, which differ from Anthropic's native API. The full usage object returned by OpenRouter:

```json
{
  "usage": {
    "prompt_tokens": 10339,
    "completion_tokens": 60,
    "total_tokens": 10399,
    "prompt_tokens_details": {
      "cached_tokens": 10318,
      "cache_write_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0
    },
    "cost": 0.00041356,
    "cost_details": {
      "upstream_inference_cost": 0.00041356
    }
  }
}
```

**Field semantics:**

| OpenRouter field | Meaning | Anthropic native equivalent |
|---|---|---|
| `usage.prompt_tokens` | Total prompt tokens including all cache variants | sum of `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` |
| `usage.prompt_tokens_details.cached_tokens` | Tokens read from cache (cache hit) | `cache_read_input_tokens` |
| `usage.prompt_tokens_details.cache_write_tokens` | Tokens written to cache (cache miss / first write) | `cache_creation_input_tokens` |
| `usage.completion_tokens` | Output tokens | `output_tokens` |

**There is no `cache_read_input_tokens` or `cache_creation_input_tokens` at the top level of the OpenRouter `usage` object.** These field names belong to Anthropic's native API format. OpenRouter translates them into `prompt_tokens_details.cached_tokens` and `prompt_tokens_details.cache_write_tokens`.

### Current codebase gap

`extractUsageFromJson` in `post-processor.worker.ts` only handles Anthropic-native field names (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`). OpenRouter non-streaming responses use `prompt_tokens`, `completion_tokens`, and `prompt_tokens_details`. When a non-streaming OpenRouter response comes through the `handleEnd` path, `state.usage.model` is checked first — if streaming already populated the model, this code is skipped. But for non-streaming OpenRouter requests, none of the cache fields will be populated.

The streaming path in `post-processor.worker.ts` already handles `prompt_tokens_details` (lines 260–276) for the OpenAI-format streaming chunks that OpenRouter emits. This path is correct.

The `base-anthropic-compatible.ts` `extractUsageInfo` path (used by `OpenRouterProvider` which inherits from `AnthropicCompatibleProvider`) expects `json.usage.input_tokens` and `json.usage.cache_creation_input_tokens` — neither of which exists in OpenRouter responses. This means the base provider's non-streaming usage extraction returns zeros for cache tokens when handling OpenRouter.

### Sticky routing

OpenRouter automatically routes subsequent requests for the same model to the same provider backend after a cached request, to keep the cache warm. This is tracked per-account, per-model, per-conversation (identified by hashing the first system message and first non-system message). Manual `provider.order` overrides sticky routing — if you pin a provider explicitly, sticky routing is bypassed.

### Minimum token thresholds for caching to activate

| Provider | Minimum |
|---|---|
| Anthropic Claude 3 | 2048 tokens |
| Anthropic Claude 3.5+ | 1024 tokens (some models require 4096) |
| OpenAI | 1024 tokens |
| Google Gemini 2.5 | 4096 tokens |

---

## Provider Selection

### The `provider` object

Sent at the top level of the request body alongside `model` and `messages`:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "provider": {
    "order": ["Anthropic", "Together"],
    "allow_fallbacks": true,
    "only": ["Anthropic"],
    "ignore": ["Together"],
    "require_parameters": false,
    "data_collection": "allow",
    "zdr": false,
    "sort": "throughput",
    "quantizations": ["fp8", "fp16"],
    "preferred_min_throughput": 100,
    "preferred_max_latency": 2,
    "max_price": {
      "prompt": 1,
      "completion": 2,
      "request": 0.50,
      "image": 0.10
    }
  },
  "messages": [...]
}
```

### All `provider` fields

| Field | Type | Default | Hard constraint? | Purpose |
|---|---|---|---|---|
| `order` | `string[]` | — | No (fallbacks still apply) | Ordered list of provider slugs to attempt first |
| `allow_fallbacks` | `boolean` | `true` | Yes when `false` | Whether to try other providers if preferred fails |
| `only` | `string[]` | — | Yes — hard allow-list | Restrict routing exclusively to these providers |
| `ignore` | `string[]` | — | Yes — hard deny-list | Never route to these providers |
| `require_parameters` | `boolean` | `false` | Yes | Exclude providers that silently ignore unknown params |
| `data_collection` | `"allow" \| "deny"` | `"allow"` | Yes | `"deny"` = only providers with zero data retention |
| `zdr` | `boolean` | — | Yes | Enforce Zero Data Retention endpoints only |
| `sort` | `string \| object` | — | No (deprioritises) | Optimise for `"price"`, `"throughput"`, or `"latency"` |
| `quantizations` | `string[]` | — | Yes | Filter by quantization: `int4 \| int8 \| fp4 \| fp6 \| fp8 \| fp16 \| bf16 \| fp32 \| unknown` |
| `preferred_min_throughput` | `number \| object` | — | No (deprioritises) | Deprioritise low-throughput endpoints |
| `preferred_max_latency` | `number \| object` | — | No (deprioritises) | Deprioritise high-latency endpoints |
| `max_price` | `object` | — | Yes — blocks execution | Refuse to route if all providers exceed this price |
| `enforce_distillable_text` | `boolean` | — | Yes | Only route to distillable-text-enabled providers |

### `order` vs `only` — key distinction

These are not the same:

- `order: ["Anthropic", "Together"]` — try Anthropic first, then Together, then any other provider (unless `allow_fallbacks: false`)
- `only: ["Anthropic"]` — hard allow-list; only Anthropic is ever considered, period

To pin a single provider with no fallbacks: use `only: ["Anthropic"]` and `allow_fallbacks: false`. Using `order` alone still allows OpenRouter to fall through to unlisted providers.

### Provider slug format

Base slugs (e.g. `"Anthropic"`, `"Together"`) match all variants and regions. Full slugs (e.g. `"google-vertex/us-east5"`) target a specific endpoint. The same format applies to `order`, `only`, and `ignore`.

### `sort` parameter

Simple string form:
```json
{ "sort": "price" }
```

Advanced object form with cross-model partitioning:
```json
{
  "sort": {
    "by": "throughput",
    "partition": "none"
  }
}
```
`partition: "none"` disables per-model grouping, enabling selection across multiple fallback models by global performance. Setting `sort` disables OpenRouter's default load balancing.

### Performance threshold fields

`preferred_min_throughput` and `preferred_max_latency` accept either a scalar (applied at p50) or a percentile object:
```json
{
  "preferred_min_throughput": { "p50": 100, "p90": 50 },
  "preferred_max_latency": { "p50": 1.0, "p90": 3.0 }
}
```
IMPORTANT: these deprioritise but never exclude. Requests always execute even if no provider meets the threshold.

### Model shortcut suffixes

- `model:nitro` — equivalent to `provider: { sort: "throughput" }`
- `model:floor` — equivalent to `provider: { sort: "price" }`

### Default routing behaviour (no `provider` object)

1. Prioritise providers with no recent outages
2. Among stable providers, weight by inverse-square-of-price
3. Use remaining providers as fallbacks

### Interaction with model fallbacks (`models` array)

The `models` array and `provider` object are orthogonal. `models` is a priority-ordered list of model IDs for model-level fallback:
```json
{
  "models": ["anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-3-5"],
  "provider": { "only": ["Anthropic"] }
}
```
The `model` field in the response indicates which model was ultimately used.

---

## Gotchas & Constraints

### Caching

1. **Top-level `cache_control` locks you to direct Anthropic.** The current `transformRequestBody` injection of `cache_control: { type: "ephemeral" }` prevents routing to Bedrock and Vertex. This is intentional for caching but unintentional if you ever want Bedrock/Vertex routing for a non-Anthropic model while keeping the same provider.

2. **OpenRouter usage fields are not Anthropic-native fields.** `prompt_tokens_details.cached_tokens` is the cache read count. `prompt_tokens_details.cache_write_tokens` is the cache write count. There is no `cache_read_input_tokens` or `cache_creation_input_tokens` at the top level of OpenRouter responses. Code that assumes Anthropic field names will silently read zeros from OpenRouter responses.

3. **`cache_write_tokens` was added in January 2026.** Before this, OpenRouter did not return cache write tokens at all; they had to be derived algebraically. The `include_usage: true` parameter is now deprecated — full usage is always returned.

4. **Non-streaming OpenRouter responses through `extractUsageFromJson` will miss all cache tokens** because that function only looks at `input_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`, none of which exist in OpenRouter's response format. The streaming path is already handled correctly.

5. **Sticky routing is per-model, per-conversation.** If your first system message changes between requests, sticky routing picks a different provider and you lose your cache. Keep the system prompt stable.

6. **4 explicit breakpoint limit on Anthropic.** The automatic top-level `cache_control` injection counts as one of them.

7. **Minimum token thresholds are model-specific.** If a prompt is under the minimum, caching is silently skipped with no error. The `cache_write_tokens` field will be 0.

### Provider routing

1. **`order` alone does not prevent fallback.** You must also set `allow_fallbacks: false` if you want strict provider pinning.

2. **`sort` or `order` disables load balancing.** OpenRouter's default weighted routing across stable providers is turned off.

3. **`max_price` is the only performance field that can block execution.** All throughput/latency threshold fields merely deprioritise; the request will always go somewhere.

4. **Account-level privacy settings merge with per-request `data_collection`.** The more restrictive wins — if your account is set to deny data collection, a per-request `"allow"` has no effect.

5. **`require_parameters: true` has a broad exclusion effect.** Many providers silently drop unknown fields. This flag narrows the pool significantly, potentially leaving few or no viable providers for requests with unusual parameters.

6. **Anthropic beta features require the `x-anthropic-beta` header.** Without it, OpenRouter may strip certain fields (e.g. `strict` in structured outputs). Multiple features: comma-separated. This header must be forwarded from the client; the proxy should not strip it.

---

## Confidence

| Claim | Confidence | Source |
|---|---|---|
| OpenRouter usage field names (`prompt_tokens_details.cached_tokens`, `cache_write_tokens`) | HIGH | Official OpenRouter docs (WebFetch confirmed) + usage accounting docs |
| `cache_write_tokens` added January 2026 | MEDIUM | WebSearch + GitHub issue #18440 cross-reference; no exact date in official docs |
| Provider `order` vs `only` distinction | HIGH | Official provider routing docs (WebFetch confirmed) |
| Full `provider` object field list | HIGH | Official provider routing docs (WebFetch confirmed) |
| `extractUsageFromJson` gap for non-streaming OpenRouter | HIGH | Direct code reading of `post-processor.worker.ts` |
| Top-level `cache_control` excludes Bedrock/Vertex | HIGH | Official caching docs explicitly stated |
| Anthropic breakpoint limit of 4 | HIGH | Official caching docs |
| Sticky routing mechanism | MEDIUM | Official caching docs (stated) but exact hash inputs verified only from docs prose, not code |
| `cache_write_tokens` release date range (Dec 2025 – Jan 2026) | LOW | Single blog post and one GitHub issue; no official changelog URL found |
