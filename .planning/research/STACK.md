# Stack Research — v1.1

**Project:** better-ccflare personal fork
**Researched:** 2026-05-05
**Mode:** Ecosystem / targeted stack additions

---

## Summary

All three v1.1 features (4th cache breakpoint, 1-hour TTL, per-account provider preference) require **zero new npm dependencies**. Every capability needed already exists in the codebase or in the OpenRouter/Anthropic API surface. Work is purely TypeScript logic changes to the OpenRouter provider and the existing SQLite schema extension pattern the codebase already follows.

---

## New Dependencies

**None required.** Rationale for each feature:

| Feature | Why no new dep needed |
|---|---|
| 4th cache breakpoint | Pure logic change in `transformRequestBody` — add one more `if` block targeting high-token user messages |
| 1-hour TTL cache blocks | API format change: add `"ttl": "1h"` to existing `{ type: "ephemeral" }` objects — no library needed |
| Per-account provider preference | Store JSON string in new `openrouter_provider_preference` column (same pattern as `model_mappings`); inject into request body in `transformRequestBody` |

---

## Integration Points

### Feature 1: 4th cache breakpoint (high-token user message)

**File:** `packages/providers/src/providers/openrouter/provider.ts`
**Function:** `transformRequestBody` (existing FORK PATCH block, lines 40–117)

The current implementation handles 3 breakpoints (tools, system, last assistant turn). The 4th breakpoint targets the last user message in `messages[]`. Anthropic's documented ordering for cache placement is:

1. tools (already done — breakpoint 1)
2. system (already done — breakpoint 2)
3. last assistant turn (already done — breakpoint 3)
4. last user message (new — breakpoint 4)

Implementation: find the last message with `role === "user"` in `body.messages`, apply `cache_control` to its last content block using the same pattern as breakpoint 3 (assistant turn). If content is a string, convert to array form first.

**Constraint verified (HIGH confidence — official Anthropic docs):** 4 is the hard limit. If 4 explicit block-level breakpoints exist and automatic caching is also requested, the API returns a 400. The current 3-breakpoint implementation leaves the 4th slot open; adding a 4th explicit breakpoint is safe. The codebase never sends a top-level `cache_control` field.

**Test file:** `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — add test cases to the existing `describe` block following the existing `makeRequest` factory pattern.

---

### Feature 2: 1-hour TTL cache blocks

**File:** `packages/providers/src/providers/openrouter/provider.ts`
**Function:** `transformRequestBody`

**API format (HIGH confidence — official OpenRouter docs, cross-verified with Anthropic docs):**
- 5-minute default (current): `{ "type": "ephemeral" }`
- 1-hour extended: `{ "type": "ephemeral", "ttl": "1h" }`

The `ttl` field is additive to the existing object — same `type`, new `ttl` key. No structural change to the injection pattern.

**How the provider knows which TTL to use:** Store a per-account setting in the DB using a new column `openrouter_cache_ttl TEXT DEFAULT NULL`. Values: `null` (default, means 5-min ephemeral), `"1h"` (extended). This is consistent with the project's per-account field pattern and is user-controllable without redeployment.

**Schema change:** Add column `openrouter_cache_ttl TEXT DEFAULT NULL` to `accounts` table in `packages/database/src/migrations.ts` (`runMigrations` transaction block, idempotent `ALTER TABLE` pattern — see existing examples at lines 337–471).

**Type changes required:**

| File | Change |
|---|---|
| `packages/types/src/account.ts` — `AccountRow` | Add `openrouter_cache_ttl?: string \| null` |
| `packages/types/src/account.ts` — `Account` | Add `openrouter_cache_ttl: string \| null` |
| `packages/types/src/account.ts` — `toAccount()` | Map `row.openrouter_cache_ttl \|\| null` |
| `packages/types/src/account.ts` — `AccountResponse` | Add `openrouterCacheTtl?: string \| null` |
| `packages/types/src/account.ts` — `toAccountResponse()` | Pass `account.openrouter_cache_ttl` through |

---

### Feature 3: Per-account OpenRouter provider preference

**API format (HIGH confidence — official OpenRouter provider routing docs):**
```json
{
  "provider": {
    "order": ["anthropic", "openai"],
    "allow_fallbacks": true
  }
}
```

The `provider` field goes at the top level of the request body alongside `model` and `messages`. `provider.order` is an array of provider slug strings. `allow_fallbacks: true` is the default and must always be set (project constraint: never use `provider.only`).

**Storage:** Follow the `model_mappings` pattern exactly — store as a JSON string (`["anthropic","openai"]`) in a new `openrouter_provider_preference TEXT DEFAULT NULL` column. Parse it in `transformRequestBody` and inject.

**ENV var path for global default:** A simple global `OPENROUTER_PROVIDER_ORDER` env var (comma-separated slugs, e.g. `anthropic,openai`) read in `transformRequestBody` as a fallback when no per-account setting is present. This requires no schema change for the global case. The per-account DB setting takes precedence over the global ENV var.

**Files to change:**

| File | Change |
|---|---|
| `packages/database/src/migrations.ts` | Add `ALTER TABLE accounts ADD COLUMN openrouter_provider_preference TEXT` in idempotent migration block; add `ALTER TABLE accounts ADD COLUMN openrouter_cache_ttl TEXT` in same block |
| `packages/types/src/account.ts` — `AccountRow` | Add `openrouter_provider_preference?: string \| null` |
| `packages/types/src/account.ts` — `Account` | Add `openrouter_provider_preference: string \| null` |
| `packages/types/src/account.ts` — `toAccount()` | Map `row.openrouter_provider_preference \|\| null` |
| `packages/types/src/account.ts` — `AccountResponse` | Add `openrouterProviderPreference?: string[] \| null` (parsed array form for dashboard) |
| `packages/types/src/account.ts` — `toAccountResponse()` | Parse JSON, pass through array |
| `packages/providers/src/providers/openrouter/provider.ts` — `transformRequestBody` | After cache injection: if `account.openrouter_provider_preference` set, parse JSON and inject `body.provider = { order: parsed, allow_fallbacks: true }`; fall back to `OPENROUTER_PROVIDER_ORDER` env var if no per-account setting |
| `packages/http-api/src/handlers/accounts.ts` | Add PATCH handler to update the new column (follow the `model_mappings` update pattern at ~line 2128) |
| `packages/database/src/repositories/account.repository.ts` | Include both new columns in SELECT and UPDATE queries |
| `packages/dashboard-web/src/components/accounts/` | New `AccountOpenRouterProviderDialog.tsx` component modeled on `AccountModelMappingsDialog.tsx` — text input for comma-separated provider slugs, saved as JSON array |

---

## What NOT to Add

**Do not add a caching middleware layer.** The 1-hour TTL is a field value change in the request body, not a response caching concern. No in-process cache or Redis needed.

**Do not use `provider.only`.** Project constraint: always use `provider.order` with `allow_fallbacks: true`. Using `only` eliminates fallback routing and would cause hard failures if the preferred provider is rate-limited or down.

**Do not create a new provider subclass for OpenRouter-with-preferences.** Extend `OpenRouterProvider.transformRequestBody` directly. The conditional logic is localized and isolated from upstream code (upstream does not touch the FORK PATCH injection blocks).

**Do not abstract a "cache TTL manager" class.** The TTL is one field on two to four objects per request. Over-engineering this adds indirection without benefit.

**Do not reuse the `model_mappings` column to store provider preference.** `model_mappings` is used by multiple providers and has its own parsing semantics in the dashboard. A dedicated `openrouter_provider_preference` column is cleaner and prevents future confusion.

**Do not add a `provider.quantizations` or `provider.sort` field.** OpenRouter supports these in the same `provider` object but they are out of scope for v1.1 and would require additional UI work.

---

## Sources

- OpenRouter prompt caching docs (TTL format, breakpoint limit): https://openrouter.ai/docs/guides/best-practices/prompt-caching — HIGH confidence (verified via WebFetch 2026-05-05)
- OpenRouter provider routing docs (`provider.order` format): https://openrouter.ai/docs/guides/routing/provider-selection — HIGH confidence (verified via WebFetch 2026-05-05)
- Anthropic prompt caching docs (4-breakpoint hard limit, TTL values): https://platform.claude.com/docs/en/build-with-claude/prompt-caching — HIGH confidence (verified via WebFetch 2026-05-05)
- Codebase direct inspection: `packages/types/src/account.ts`, `packages/database/src/migrations.ts`, `packages/providers/src/providers/openrouter/provider.ts`, `packages/http-api/src/handlers/accounts.ts`
