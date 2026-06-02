# Stack Research — v1.3

**Project:** better-ccflare personal fork
**Researched:** 2026-06-02
**Mode:** Targeted stack additions for OpenRouter Anthropic Messages provider
**Confidence:** HIGH (primary source: OpenRouter OpenAPI spec at https://openrouter.ai/openapi.yaml, accessed 2026-06-02; schemas `MessagesResult`, `AnthropicUsage`, `MessagesDeltaEvent`, `MessagesStopEvent`, `MessagesStartEvent`)

---

## TL;DR for Implementers

No new npm dependencies. One new class (`OpenRouterAnthropicProvider`), one `index.ts` barrel, two CLI union type entries, one dashboard gate change. The new provider extends `AnthropicCompatibleProvider` (not `OpenRouterProvider`) and overrides `transformRequestBody` (provider preference injection only, no cache_control injection) and `extractUsageInfo` (attach `usage.cost`). The base class SSE streaming reader handles this endpoint's events correctly — with one confirmed gap: **no `cost` field exists in any SSE event on the native Anthropic Messages endpoint**. Cost is only available in non-streaming responses.

---

## Confirmed API Facts

Source: `https://openrouter.ai/openapi.yaml` (fetched 2026-06-02). Confidence: HIGH.

### 1. Endpoint

```
POST https://openrouter.ai/api/v1/messages
```

### 2. Auth

- **Required:** `Authorization: Bearer <api_key>`
- **Optional:** `X-OpenRouter-Experimental-Metadata: enabled` — surfaces routing metadata under `openrouter_metadata` on the response; defaults to `disabled`; not needed for normal operation
- `HTTP-Referer` and `X-Title` are **not listed** in the spec's parameter block for this endpoint. They are undocumented courtesy headers with no verified effect on this endpoint. Do not add.
- `x-session-id` header (or body `session_id` field) enables sticky routing per session

Config for new provider: `authHeader: "authorization"`, `authType: "bearer"` — identical to existing `OpenRouterProvider`.

### 3. Non-Streaming Response Usage Object

The full non-streaming response schema is `MessagesResult` = `BaseMessagesResult` + OpenRouter extensions.

**`AnthropicUsage` (the base usage schema, confirmed from spec):**

```typescript
{
  input_tokens: number,                          // required
  output_tokens: number,                         // required
  cache_creation_input_tokens: number | null,    // nullable integer — Anthropic-native name
  cache_read_input_tokens: number | null,        // nullable integer — Anthropic-native name
  cache_creation: {                              // nullable sub-object
    ephemeral_5m_input_tokens: number,
    ephemeral_1h_input_tokens: number,
  } | null,
  output_tokens_details: AnthropicOutputTokensDetails | null,
  server_tool_use: AnthropicServerToolUsage | null,
  service_tier: string,   // e.g. "standard" or "default"
  inference_geo: string | null,
}
```

**OpenRouter additions on `MessagesResult.usage` (confirmed from spec):**

```typescript
{
  cost: number | null,   // format: double — USD cost; the key field for cost tracking
  cost_details: {
    upstream_inference_completions_cost: number,   // format: double
    upstream_inference_prompt_cost: number,        // format: double
    upstream_inference_cost: number | null,        // format: double, nullable
  } | null,
  is_byok: boolean,
  speed: AnthropicSpeed,
  iterations: AnthropicUsageIteration[],
}
```

**Critical confirmed facts:**
- Field name is `usage.cost` (type `number | null`, format double). The existing `typeof json.usage.cost === "number"` guard from `OpenRouterProvider.extractUsageInfo()` applies identically.
- `cache_creation_input_tokens` and `cache_read_input_tokens` use **Anthropic-native names** on this endpoint. They are NOT under `prompt_tokens_details`. The `OpenRouterProvider` override that reads `prompt_tokens_details.cached_tokens` and `prompt_tokens_details.cache_write_tokens` is **wrong** for this endpoint and must not be inherited.
- No `prompt_tokens` / `completion_tokens` / `total_tokens` / `prompt_tokens_details` fields — those are OpenAI-format only and do not appear in this endpoint's response.

### 4. Streaming SSE Events

All standard Anthropic event types: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`, `ping`, `error`.

**OpenRouter-specific additions:**
- `message_stop` carries an optional `openrouter_metadata` field (routing metadata) when `X-OpenRouter-Experimental-Metadata: enabled` was sent. Otherwise identical to Anthropic's `message_stop`.
- `ping` events occur as keepalives — present in Anthropic spec too, parsers should ignore.

**`MessagesStartEvent.message.usage` (from spec):**
```typescript
{
  input_tokens: number,
  output_tokens: number,         // 0 at stream start
  cache_creation_input_tokens: number | null,
  cache_read_input_tokens: number | null,
  cache_creation: { ... } | null,
  inference_geo: string | null,
  server_tool_use: null,
  service_tier: string,
  // No cost field.
}
```

**`MessagesDeltaEvent.usage` (from spec — exact schema):**
```typescript
{
  input_tokens: number | null,              // final input count
  output_tokens: number,                    // required — final output count
  output_tokens_details: AnthropicOutputTokensDetails | null,
  cache_creation_input_tokens: number | null,
  cache_read_input_tokens: number | null,
  server_tool_use: { web_search_requests: number, web_fetch_requests: number } | null,
  iterations: AnthropicUsageIteration[],
  // No cost field. Confirmed absent from the MessagesDeltaEvent schema.
}
```

**`MessagesStopEvent` (from spec):** `type: "message_stop"` + optional `openrouter_metadata`. No usage. No cost.

**STREAMING COST GAP — CONFIRMED:** No `cost` field exists in any SSE event on the native Anthropic Messages endpoint (`/api/v1/messages`). This differs from the OpenAI-format `/api/v1/chat/completions` endpoint, where OpenRouter injects `usage.cost` into the final `message_delta`. The existing `OpenRouterProvider.readFinalSseCost()` behavior **does not apply here**. Cost for streaming requests on `openrouter-anthropic` accounts will be `null` in the database unless `estimateCostUSD()` is used as a fallback.

### 5. Provider Routing Extension

The `provider` field is fully supported in the request body. `ProviderPreferences` in `MessagesRequest.provider` includes (among others): `order` (provider slug array), `allow_fallbacks` (boolean). The existing `openrouter_provider_preference` injection pattern (`body.provider = { order, allow_fallbacks }`) works unchanged on this endpoint. The guard `!("provider" in body)` for non-destructive injection is correct.

---

## New Dependencies

**None required.** The implementation is pure TypeScript using existing packages. No new npm packages.

---

## Integration Points

### New Provider Class

**File:** `packages/providers/src/providers/openrouter-anthropic/provider.ts`

**Class hierarchy:**
```
BaseProvider
  └── BaseAnthropicCompatibleProvider   (base-anthropic-compatible.ts)
        └── AnthropicCompatibleProvider (anthropic-compatible/provider.ts)
              └── OpenRouterAnthropicProvider  ← NEW
```

Do NOT extend `OpenRouterProvider`. That class inherits the wrong `extractUsageInfo` (reads OAI-format `prompt_tokens_details`), the 4-breakpoint `cache_control` injector, and `readFinalSseCost()` — none applicable here.

**Minimum constructor config:**
```typescript
super({
  name: "openrouter-anthropic",
  baseUrl: "https://openrouter.ai/api/v1",
  authHeader: "authorization",
  authType: "bearer",
  supportsStreaming: true,
});
```

**Required overrides:**

| Override | Reason |
|----------|--------|
| `getEndpoint()` | Return `"https://openrouter.ai/api/v1"` |
| `transformRequestBody()` | Inject `body.provider` from `account.openrouter_provider_preference`; do NOT inject `cache_control` (passthrough natively) |
| `extractUsageInfo()` | Delegate streaming path to `extractStreamingUsage`; for non-streaming, call `super` (which correctly reads Anthropic-native cache fields), then attach `usage.cost` with `typeof` guard |
| `extractStreamingUsage()` or `parseUsage()` | Return `costUsd: undefined` explicitly (no real cost available in SSE); avoids persisting a wrong estimate as `cost_usd` |

**`buildUrl()` note:** `AnthropicCompatibleProvider.buildUrl()` deduplicates the `/v1` path prefix when `baseUrl` ends with `/api/v1` and the incoming path is `/v1/messages`. Net result: `https://openrouter.ai/api/v1/messages`. Verify this at implementation time — if deduplication misfires, add the same `cleanPathname` override as `OpenRouterProvider.buildUrl()` uses.

**`transformRequestBody()` design:** Call `super.transformRequestBody()` first (applies model mapping), then inject `body.provider` from `account.openrouter_provider_preference`. Copy the injection block from `OpenRouterProvider.transformRequestBody()` verbatim (lines 194–209 of `openrouter/provider.ts`). Do not copy the `cache_control` injection blocks.

**`extractUsageInfo()` design for non-streaming:**
```typescript
// Call super first — base reads input_tokens, output_tokens,
// cache_creation_input_tokens, cache_read_input_tokens correctly.
const base = await super.extractUsageInfo(response);  // but NOT with streaming branch
// Then re-read json.usage.cost and attach:
const costUsd = typeof json.usage.cost === "number" ? json.usage.cost : undefined;
return { ...base, costUsd };
```
The base class `extractUsageInfo` also calls `estimateCostUSD()`. Since real `usage.cost` is available on non-streaming responses, the estimate should be overridden with the real value.

**`extractStreamingUsage()` design:** The base class implementation correctly reads `message_start` and `message_delta` SSE events for token counts on this endpoint. The only change: since no `cost` is available in SSE, return `costUsd: undefined` instead of the estimate. Pattern:
```typescript
const base = await super.extractStreamingUsage(clone, originalHeaders);
if (!base) return null;
return { ...base, costUsd: undefined };  // no real cost in SSE on this endpoint
```

### Files to Change

| File | Change |
|------|--------|
| `packages/providers/src/providers/openrouter-anthropic/provider.ts` | New class (create) |
| `packages/providers/src/providers/openrouter-anthropic/index.ts` | Re-export barrel (create) |
| `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` | Unit tests with bun:test (create) |
| `packages/providers/src/providers/index.ts` | Add `export { OpenRouterAnthropicProvider }` |
| `packages/providers/src/index.ts` | Add `import` + `registry.registerProvider(new OpenRouterAnthropicProvider())` |
| `packages/cli-commands/src/commands/account.ts` | Add `"openrouter-anthropic"` to two `mode` union type literals (~line 47 and ~line 79); add `mode === "openrouter-anthropic"` branch in the `addAccount` flow (mirrors the `openrouter` branch with different label) |
| `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` | Extend the provider preference dialog gate from `account.provider === "openrouter"` to also include `"openrouter-anthropic"` (line ~350) |

### No Database Changes Required

The `openrouter_provider_preference` column was added in v1.1 and is already on the `accounts` table (SQLite + PostgreSQL). No new columns needed. The new provider reads the same column.

### No New Types Required

`AccountRow`, `Account`, and `AccountResponse` already include `openrouter_provider_preference`. The new provider name just needs to be a valid string in the registry. No type union changes beyond the `mode` field in the CLI command module.

---

## What NOT to Add

| Avoid | Why |
|-------|-----|
| Extending `OpenRouterProvider` | Its `extractUsageInfo` reads OAI-format `prompt_tokens_details` — wrong for this endpoint; its `cache_control` injector would double-inject on top of Claude Code's own blocks |
| `cache_control` injection in `transformRequestBody` | This endpoint passes cache_control through natively; Claude Code already sends cache_control; injection is not needed and would corrupt prompts |
| `readFinalSseCost()` or similar streaming cost reader | No `cost` field exists in any SSE event on this endpoint per the spec; would always return undefined |
| New npm dependencies | None needed |
| Modifying `base-anthropic-compatible.ts` or `AnthropicCompatibleProvider` | Upstream-shared code; modifications break upstream merge hygiene |
| Modifying `OpenRouterProvider` | Fork-safety requirement: leave it untouched |
| `HTTP-Referer` / `X-Title` headers | Not in spec's parameter block; no documented effect |
| `X-OpenRouter-Experimental-Metadata` header | Optional, defaults off, not needed for basic operation or cost tracking |
| Global `OPENROUTER_ANTHROPIC_PROVIDER_ORDER` env var | Out of scope for v1.3; per-account preference is sufficient |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Extend `AnthropicCompatibleProvider` | Extend `OpenRouterProvider` | `OpenRouterProvider` overrides `extractUsageInfo` for OAI-format fields, injects 4 cache_control breakpoints, reads streaming cost from `message_delta.usage.cost` — all incorrect for this endpoint |
| Separate `openrouter-anthropic` provider name | Reuse `openrouter` with a flag | Would require conditional logic in already-patched `OpenRouterProvider`; coexistence is cleaner and safer for upstream merges |
| `costUsd: undefined` for streaming | Use `estimateCostUSD()` as fallback | Consistent with `OpenRouterProvider`'s approach; avoids persisting estimated costs for real-money accounts where the actual cost is unknown |
| Passthrough `cache_control` | Copy 4-breakpoint injection | The native endpoint accepts cache_control natively; Claude Code sends its own cache_control; injection would double-inject breakpoints |

---

## Sources

- `https://openrouter.ai/openapi.yaml` (fetched 2026-06-02 via Bash curl) — **PRIMARY SOURCE, HIGH confidence**
  - `AnthropicUsage`: `input_tokens`, `output_tokens`, `cache_creation_input_tokens` (nullable), `cache_read_input_tokens` (nullable), `cache_creation`, `service_tier`, `inference_geo`
  - `MessagesResult.usage` additions: `cost: number | null` (format: double), `cost_details`, `is_byok`, `speed`, `iterations`
  - `MessagesDeltaEvent.usage`: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens_details`, `server_tool_use`, `iterations` — **no `cost` field confirmed absent**
  - `MessagesStopEvent`: `type` + optional `openrouter_metadata` only — no cost
  - `MessagesStartEvent.message.usage`: `AnthropicUsage` shape — no cost
  - `MessagesRequest.provider` = `ProviderPreferences`: `order`, `allow_fallbacks`, and extended routing fields — confirmed supported
  - Auth: `Authorization: Bearer` required; `X-OpenRouter-Experimental-Metadata` optional
- `https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages` (fetched 2026-06-02) — MEDIUM confidence (page truncated before response schemas; used for auth header confirmation)
- Web search + openrouter.ai/docs/guides/best-practices/prompt-caching (2026-06-02) — MEDIUM confidence; corroborates Anthropic-native field names on `/api/v1/messages` and confirms OAI-format endpoint uses different field names
- Codebase reading of `base-anthropic-compatible.ts`, `openrouter/provider.ts`, `anthropic-compatible/provider.ts`, `providers/src/index.ts`, `AccountListItem.tsx` — HIGH confidence (ground truth for integration points)

---

*Stack research for: OpenRouter Anthropic Messages provider (v1.3)*
*Researched: 2026-06-02*
