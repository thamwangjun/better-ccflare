# Feature Research — v1.3 OpenRouter Anthropic Messages Provider

**Domain:** New provider/account type for a Bun-based Claude API load-balancer proxy
**Researched:** 2026-06-02
**Confidence:** HIGH (OpenRouter endpoint schema, caching behavior, provider routing fields); MEDIUM (native Anthropic usage field names on the Messages endpoint — field names confirmed via Anthropic native format cross-reference, but direct JSON schema from OpenRouter /api/v1/messages usage object was not fully extractable from documentation); LOW (cost field on native streaming — extrapolated from v1.2 behavior patterns)

---

## Context: What v1.3 Adds

This is a new account/provider type (`openrouter-anthropic`) that routes to `POST https://openrouter.ai/api/v1/messages` using `Authorization: Bearer <key>` auth. Unlike the existing `openrouter` provider (which translates Anthropic Messages → OpenAI Chat Completions → back), this new type is a true passthrough: Claude Code's native Anthropic Messages requests arrive verbatim at OpenRouter's Anthropic-native endpoint.

The new provider extends `AnthropicCompatibleProvider` (which extends `BaseAnthropicCompatibleProvider`). It coexists with the existing `openrouter` provider, which is left unchanged.

Four fork features from previous milestones must carry over:
1. **Cost tracking** — persist real USD cost to `requests.cost_usd`
2. **Provider preference injection** — reuse existing `openrouter_provider_preference` column/type chain
3. **Native cache_control passthrough** — no breakpoint-injection needed (passthrough is sufficient)
4. **Dashboard provider-order dialog** — gate on the new provider type in addition to existing `openrouter`

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a usable provider must have. Missing these = provider is broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Correct endpoint routing** | Without it the provider does nothing | LOW | `https://openrouter.ai/api/v1/messages`, `Authorization: Bearer`, strip `/v1` prefix deduplication already in `AnthropicCompatibleProvider.buildUrl()` — need to override `buildUrl()` and `getEndpoint()` as `OpenRouterProvider` does, but pointing to `/api/v1/messages` base |
| **API key auth (Bearer)** | OpenRouter uses Bearer, not x-api-key | LOW | `authHeader: "authorization"`, `authType: "bearer"` — same as existing `OpenRouterProvider`; `BaseAnthropicCompatibleProvider.prepareHeaders()` already handles this pattern |
| **Verbatim request passthrough** | The whole value prop of native endpoint | LOW | `transformRequestBody` does model mapping via super; no further transformation needed — `cache_control` blocks from Claude Code pass through untouched |
| **Cost tracking from `usage.cost`** | Without it `requests.cost_usd` stays null | MEDIUM | The native Anthropic Messages endpoint returns a usage object with native field names (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) PLUS OpenRouter's added `cost` field (USD). The `cost` field was already confirmed in the existing `OpenRouterProvider.extractUsageInfo()` for the OpenAI endpoint — same pattern applies here. Override `extractUsageInfo` + `extractStreamingUsage` + `parseUsage` mirroring the existing `OpenRouterProvider` implementation, but reading native Anthropic field names instead of `prompt_tokens_details.*` |
| **Native cache token field names** | Base class reads `cache_creation_input_tokens` / `cache_read_input_tokens` — these are the correct native field names | LOW | Unlike the OpenAI-format OpenRouter provider (which required `prompt_tokens_details.cache_write_tokens` / `cached_tokens`), the native endpoint returns standard Anthropic field names. `BaseAnthropicCompatibleProvider.extractUsageInfo()` already reads these correctly. The only override needed is to also capture `usage.cost` |
| **Provider preference injection** | Power users expect the same routing controls as the existing OpenRouter account | MEDIUM | Reuse existing `openrouter_provider_preference` column (already in DB schema, types, repository). Inject `body.provider = { order, allow_fallbacks }` in `transformRequestBody` using the same `"provider" in body` guard pattern. The native endpoint accepts the `provider` routing object directly in the request body |
| **Dashboard provider-order dialog** | Without it, stored preferences cannot be managed | LOW | Gate the existing `AccountOpenrouterProviderPreferenceDialog` on `account.provider === "openrouter" \|\| account.provider === "openrouter-anthropic"`. One-line change in the dialog visibility condition |
| **Model string pass-through** | Claude Code sends `claude-sonnet-4-5` etc.; OpenRouter needs `anthropic/claude-sonnet-4-5` | LOW-MEDIUM | OpenRouter's Anthropic Messages endpoint accepts both bare Anthropic model IDs (e.g., `claude-sonnet-4-5`) and prefixed slugs (e.g., `anthropic/claude-sonnet-4-5`). The base `transformRequestBody` model mapping via `mapModelName` handles existing account-level model overrides. No additional transformation required unless the user has set an explicit model mapping |
| **Rate limit header parsing** | Without it the load balancer cannot detect rate limits | LOW | `BaseAnthropicCompatibleProvider.parseRateLimit()` already reads `anthropic-ratelimit-unified-*` headers — these are the same headers Anthropic sends natively, which OpenRouter proxies through on the native endpoint |
| **Streaming support** | Claude Code always streams | LOW | Native endpoint is SSE format identical to Anthropic's own (`message_start` / `content_block_delta` / `message_delta` / `message_stop`). `BaseAnthropicCompatibleProvider.extractStreamingUsage()` already handles this format |

### Differentiators (Competitive Advantage)

Features that unlock native-only capabilities unavailable through the OpenAI-format provider.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`session_id` injection** | Routes all turns of one Claude Code session to the same OpenRouter backend, maximizing Anthropic prompt cache hits from turn 1 (not just after first observed cache hit) | MEDIUM | OpenRouter-specific extension field in request body. Claude Code does not send `session_id`. The proxy can inject a stable per-connection or per-account session identifier. Without `session_id`, sticky routing only activates after a cache hit is observed; with it, sticky routing activates from the first request in the session. Implementation: extract a stable session token from the incoming request (e.g., hash of account + connection) and inject as `body.session_id` if not already present |
| **`openrouter_metadata` routing visibility** | Surfaces which backend served each request for debugging routing/caching issues | LOW | Opt-in via `X-OpenRouter-Experimental-Metadata: enabled` header. For streaming responses, `openrouter_metadata` arrives in the terminal `message_stop` event. Useful for debugging but not critical. Can be surfaced in debug logs without client-visible changes |
| **Extended provider routing fields** | Full `provider` object supports `sort` (price/throughput/latency), `data_collection` (deny), `zdr` (Zero Data Retention), `require_parameters`, `max_price`, `quantizations` | HIGH | Current `openrouter_provider_preference` stores only `{order, allow_fallbacks}`. Supporting `sort`, `zdr`, `data_collection` etc. would require a schema migration and UI expansion. Defer to future milestone — the existing JSON object storage format is forward-compatible |
| **`thinking` passthrough** | Claude Code's extended thinking requests pass through natively without shape transformation errors | LOW | The native endpoint supports the full `thinking` object (`enabled`/`disabled`/`adaptive`). The OpenAI-format provider cannot represent this without transformation. For the passthrough provider, no action needed — Claude Code's `thinking` blocks pass through verbatim |
| **`output_config.format` (structured outputs)** | Structured JSON output requests from Claude Code pass through without shape issues | LOW | `output_config.format` with `json_schema` is a native endpoint extension. OpenRouter auto-applies the `anthropic-beta: structured-outputs-2024-10-22` header when routing to Anthropic (does NOT require `strict: true` on the proxy side). No implementation needed — passthrough handles it |
| **`context_management.edits` passthrough** | Context compression and tool-use clearing requests pass through natively | LOW | `context_management.edits` (`clear_tool_uses_20250919`, `clear_thinking_20251015`, `compact_20260112`) are native endpoint extensions. Passthrough handles these automatically — no proxy logic needed |
| **Top-level automatic caching** | Single `cache_control` field at request root triggers OpenRouter's automatic breakpoint placement, currently only supported when routing to the direct Anthropic provider | LOW | The existing `openrouter` provider's per-block `cache_control` injection is bypassed on the new provider (passthrough). Claude Code may already send top-level `cache_control` in some configurations. The new provider passes it through; the constraint (routes only to direct Anthropic, excludes Bedrock/Vertex) is enforced by OpenRouter transparently |

### Anti-Features (Avoid)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **`cache_control` breakpoint injection** | Existing `openrouter` provider does it | Redundant on the native endpoint — Claude Code already sends `cache_control` blocks correctly. Injecting additional breakpoints on top of Claude Code's own would exceed the 4-breakpoint limit. The 4-breakpoint injection was a workaround for the OpenAI-format translation that stripped `cache_control` | Pure passthrough; zero injection |
| **`provider.only`** | Eliminates routing uncertainty | Removes all fallback — causes hard failures when the preferred provider is down | Always use `provider.order` with `allow_fallbacks: true` (same decision as v1.1, applies equally here) |
| **`plugins` injection** | Web search, context compression etc. are useful | Plugins alter the request/response shape in ways Claude Code doesn't expect (e.g., `web` plugin adds tool use rounds, `context-compression` truncates messages). Proxy-side plugin injection would break Claude Code's context management | Leave `plugins` as client-controlled; do not inject |
| **Model prefix normalization (`anthropic/` prefix stripping)** | Some clients send `anthropic/claude-...` | OpenRouter's native endpoint accepts both bare (`claude-sonnet-4-5`) and prefixed (`anthropic/claude-sonnet-4-5`) model IDs. Stripping/normalizing creates risk of model misidentification | Trust the model string from Claude Code; let OpenRouter handle both formats |
| **Per-provider `cache_control` TTL upgrade** | 1hr TTL gives better cache persistence | The TTL upgrade logic in `proxy.ts` (`SYSTEM_PROMPT_CACHE_TTL_1H`) already applies to ALL Anthropic-compatible responses via `injectSystemCacheTtl()` — not a provider-specific concern. Adding duplicate TTL injection in the new provider would conflict | Let existing `injectSystemCacheTtl()` in `proxy.ts` handle TTL upgrades as before |
| **Dual-account automatic failover** | If OpenRouter native endpoint is down, fall back to OpenAI-format provider | The load balancer already handles multi-account failover. Having one account of each type and letting the load balancer fail over is the correct approach — do not build cross-provider-type fallback inside a single account | Users add both `openrouter` and `openrouter-anthropic` accounts; SessionStrategy handles failover |

---

## Feature Dependencies

```
[Correct endpoint routing + Bearer auth]
    └──required by──> [All other features]

[Cost tracking from usage.cost]
    └──requires──> [extractUsageInfo override (non-streaming)]
    └──requires──> [extractStreamingUsage override (streaming)]
    └──requires──> [parseUsage override (streaming dispatch)]
    └──depends on──> [v1.2 cost chain] (already ships: AsyncDbWriter, resolveCostUsd, COALESCE ON CONFLICT)

[Provider preference injection]
    └──requires──> [openrouter_provider_preference column] (already ships from v1.1)
    └──requires──> [Account type includes provider === "openrouter-anthropic"]

[Dashboard dialog extension]
    └──requires──> [Provider preference injection] (dialog controls the preference)
    └──requires──> [Account.provider === "openrouter-anthropic" recognized by UI]

[session_id injection] (differentiator)
    └──requires──> [Correct endpoint routing]
    └──enhances──> [Provider preference injection] (session_id + provider.order = maximum cache stickiness)
```

### Dependency Notes

- **Cost tracking requires the full v1.2 chain:** `resolveCostUsd`, `providerCostUsd` threading in the post-processor worker, COALESCE in `save()` ON CONFLICT — all already shipped. The new provider only needs to surface `costUsd` from `extractUsageInfo`/`extractStreamingUsage`; the downstream persistence path is unchanged.
- **Provider preference injection depends on v1.1 schema:** The `openrouter_provider_preference` column (TEXT, JSON), `AccountRow` and `Account` type fields, repository read/write, and PUT/DELETE endpoints are all already in place. The new provider only needs to read the existing field in `transformRequestBody`.
- **Dashboard dialog is a gate change only:** The existing `AccountOpenrouterProviderPreferenceDialog` component needs the `account.provider` check widened. No new API endpoints or state management required.
- **Native cache field names align with base class:** `BaseAnthropicCompatibleProvider.extractUsageInfo()` already reads `cache_creation_input_tokens` and `cache_read_input_tokens` from `json.usage`. The native endpoint returns these exact field names. The only delta from the base class behavior is capturing `usage.cost` — identical to the existing `OpenRouterProvider` override but without the `prompt_tokens_details` translation.

---

## Caching Behavior on the Native Endpoint (Research Findings)

**How `cache_control` works (HIGH confidence — OpenRouter docs):**

Two modes exist on the native endpoint:

1. **Explicit per-block breakpoints:** `cache_control` placed on individual content blocks (tools, system, messages). Hard limit of 4 breakpoints. Works across Anthropic, Bedrock, and Vertex routing. Claude Code already sends these — the passthrough provider requires zero injection.

2. **Automatic top-level caching:** A single `cache_control` at the request root; OpenRouter automatically advances the breakpoint to the last cacheable block as conversations grow. Only supported when routing to the direct Anthropic provider (Bedrock and Vertex excluded when this is present).

**TTL values:** `{ type: "ephemeral" }` = 5-minute default; `{ type: "ephemeral", ttl: "1h" }` = 1-hour. Cache write cost: 5-min = 1.25x base input; 1-hr = 2x base input. Cache read cost: 0.1x base input for both. The proxy's existing `injectSystemCacheTtl()` in `proxy.ts` handles TTL upgrades — no new logic needed in the provider.

**Sticky routing:** After a cache hit, OpenRouter remembers the backend and routes subsequent requests for the same model to the same provider. With `session_id` set, sticky routing activates from the first request (not just after first cache hit). This is the key differentiator of `session_id` injection.

**OpenRouter response-cache behavior:** On an OpenRouter layer cache hit (identical request), `usage.input_tokens` and `usage.output_tokens` are zeroed on the native endpoint. `usage.cost` is also effectively 0 (cache hits are free). The proxy handles this correctly — `?? null` semantics in the cost writer preserve a genuine `$0` rather than collapsing it to `null`.

**Usage object field names on native endpoint (MEDIUM confidence — cross-referenced from Anthropic native format + OpenRouter docs):**

The native Anthropic Messages endpoint returns:
```
usage: {
  input_tokens: number,           // non-cached input tokens
  output_tokens: number,          // completion tokens
  cache_creation_input_tokens: number,   // tokens written to cache (Anthropic naming)
  cache_read_input_tokens: number,       // tokens read from cache (Anthropic naming)
  cost: number,                   // OpenRouter-added USD cost field (as in existing provider)
  service_tier: string            // returned inside usage on Messages endpoint (not top-level)
}
```

This is the native Anthropic field naming — different from the OpenAI-format endpoint which uses `prompt_tokens_details.cache_write_tokens` / `prompt_tokens_details.cached_tokens`. The base class `extractUsageInfo` reads `cache_creation_input_tokens` and `cache_read_input_tokens` correctly. The override only needs to additionally capture `cost`.

**Important note on recent change:** As of early 2026, OpenRouter now always includes the full usage object (including cache write tokens) in every response. `include_usage: true` is deprecated and has no effect. The prior gap (only cache read tokens returned, not write tokens) no longer applies.

---

## Provider Routing Behavior (HIGH confidence — OpenRouter docs)

The `provider` object in the request body maps directly to `openrouter_provider_preference`. Fields confirmed:

| Field | Type | Default | Maps to existing preference |
|-------|------|---------|----------------------------|
| `order` | `string[]` | — | `openrouter_provider_preference.order` |
| `allow_fallbacks` | `boolean` | `true` | `openrouter_provider_preference.allow_fallbacks` |
| `require_parameters` | `boolean` | `false` | not stored (future) |
| `data_collection` | `"allow"\|"deny"` | `"allow"` | not stored (future) |
| `zdr` | `boolean` | — | not stored (future) |
| `only` | `string[]` | — | explicitly out-of-scope |
| `ignore` | `string[]` | — | not stored (future) |
| `sort` | `string\|object` | — | not stored (future) |
| `max_price` | `object` | — | not stored (future) |
| `quantizations` | `string[]` | — | not stored (future) |
| `preferred_min_throughput` | `number\|object` | — | not stored (future) |
| `preferred_max_latency` | `number\|object` | — | not stored (future) |

The injection guard `!("provider" in body)` (already in `OpenRouterProvider`) is correct — it preserves explicit `body.provider = {}` from the client.

**Provider slugs for `order`:** `"Anthropic"`, `"AWS Bedrock"`, `"Google Vertex"`, `"Together"`, `"Fireworks"` etc. — OpenRouter's display names or internal slugs. These are user-supplied; the proxy stores and injects verbatim.

---

## MVP Definition (v1.3)

### Launch With

- [ ] New `openrouter-anthropic` provider class extending `AnthropicCompatibleProvider`, pointing at `https://openrouter.ai/api/v1/messages` with Bearer auth — **passthrough, no body transformation beyond model mapping**
- [ ] Register `openrouter-anthropic` in the provider registry and `accounts` table `mode` enum
- [ ] `extractUsageInfo` override: read `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`, `usage.cost` (typeof-guarded) — mirrors base class for token fields, adds `costUsd` from `cost`
- [ ] `extractStreamingUsage` + `parseUsage` overrides for live streaming cost — same clone-before-super pattern as existing `OpenRouterProvider`
- [ ] Provider preference injection in `transformRequestBody` — read `account.openrouter_provider_preference`, inject `body.provider = { order, allow_fallbacks }` using `"provider" in body` guard
- [ ] Dashboard dialog gate widened to `account.provider === "openrouter" || account.provider === "openrouter-anthropic"`
- [ ] CLI `--add-account` mode string `openrouter-anthropic` registered

### Add After Validation (v1.3.x)

- [ ] `session_id` injection — stable per-session identifier derived from connection/account context; adds significant cache warmth improvement for agentic sessions
- [ ] `openrouter_metadata` logging — opt-in debug visibility into routing decisions

### Future Consideration (v2+)

- [ ] Extended `provider` routing fields in `openrouter_provider_preference` schema (`sort`, `data_collection`, `zdr`, `max_price`) — requires schema migration, UI expansion, type changes
- [ ] Per-request OpenRouter provider selection via `x-better-ccflare-openrouter-provider` header — deferred from v1.1, applies equally to `openrouter-anthropic`

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Endpoint routing + Bearer auth | HIGH | LOW | P1 |
| Verbatim passthrough | HIGH | LOW | P1 |
| Cost tracking (extractUsageInfo + streaming) | HIGH | MEDIUM | P1 |
| Provider preference injection | HIGH | LOW | P1 |
| Dashboard dialog gate extension | MEDIUM | LOW | P1 |
| CLI mode registration | HIGH | LOW | P1 |
| `session_id` injection | MEDIUM | MEDIUM | P2 |
| `openrouter_metadata` logging | LOW | LOW | P2 |
| Extended provider routing fields | LOW | HIGH | P3 |
| Per-request provider selection header | LOW | MEDIUM | P3 |

---

## Sources

- OpenRouter Anthropic Messages API schema: https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages (HIGH confidence — fetched directly; response usage schema truncated but extensions confirmed)
- OpenRouter prompt caching guide: https://openrouter.ai/docs/guides/best-practices/prompt-caching (HIGH confidence — fetched directly)
- OpenRouter provider routing: https://openrouter.ai/docs/guides/routing/provider-selection (HIGH confidence — fetched directly; field table confirmed)
- OpenRouter response caching: https://openrouter.ai/docs/guides/features/response-caching (HIGH confidence — fetched directly; Anthropic Messages endpoint zeroes `input_tokens`/`output_tokens` on cache hit confirmed)
- OpenRouter router metadata: https://openrouter.ai/docs/guides/features/router-metadata (HIGH confidence — fetched directly; `openrouter_metadata` structure, streaming delivery in `message_stop` confirmed)
- OpenRouter Claude Code integration guide: https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration (MEDIUM confidence — fetched directly; confirms native Anthropic Messages passthrough pattern)
- Community analysis of OpenRouter cache write token reporting change: https://www.proredcat.xyz/blog/openrouter-cache-write-calculation (MEDIUM confidence — external blog, corroborated by WebSearch findings re: early 2026 change)
- Existing codebase — `packages/providers/src/providers/openrouter/provider.ts` — v1.2 cost extraction pattern, cache injection, provider preference injection (HIGH confidence — direct read)
- Existing codebase — `packages/providers/src/providers/base-anthropic-compatible.ts` — base `extractUsageInfo` reading `cache_creation_input_tokens`/`cache_read_input_tokens`, streaming SSE parsing (HIGH confidence — direct read)
- Existing codebase — `packages/providers/src/providers/anthropic-compatible/provider.ts` — `buildUrl` deduplication pattern to mirror (HIGH confidence — direct read)

---
*Feature research for: v1.3 OpenRouter Anthropic Messages Provider*
*Researched: 2026-06-02*
