# Architecture Research — v1.1

**Researched:** 2026-05-05
**Confidence:** HIGH (all claims verified against OpenRouter docs and codebase inspection)

---

## Summary

Three features add to the existing OpenRouter provider patch surface. Extended cache breakpoints and 1-hour TTL are entirely contained inside `openrouter/provider.ts` — single-file changes with no schema or API surface impact. Per-account OpenRouter provider preference cuts across all layers (DB schema, repository, types, API handler, dashboard) and is the only feature requiring multi-package coordination. Build order is therefore: schema and types first, then provider logic, then API, then UI.

---

## Components to Modify

| Component | File | What Changes | Risk |
|-----------|------|--------------|------|
| OpenRouter provider | `packages/providers/src/providers/openrouter/provider.ts` | Add 4th cache breakpoint (last user message content block); add `ttl: "1h"` computation from session count; inject `body.provider.order` from account field | MEDIUM — single file but fork patch surface grows; upstream merge conflict if tombii adds caching upstream |
| OpenRouter test suite | `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | New test cases for 4th breakpoint, TTL injection, provider.order injection | LOW — test-only change |
| Account type | `packages/types/src/account.ts` | Add `openrouter_provider_preference: string \| null` to `AccountRow` and `Account`; add field to `toAccount()` mapper; add `openrouterProviderPreference: string \| null` to `AccountResponse` and `toAccountResponse()` | LOW — additive; TypeScript enforces completeness at compile time |
| DB migrations | `packages/database/src/migrations.ts` | Add `ALTER TABLE accounts ADD COLUMN openrouter_provider_preference TEXT DEFAULT NULL` block following the existing `if (!columnNames.includes(...))` guard pattern | LOW — additive, idempotent |
| Account repository | `packages/database/src/repositories/account.repository.ts` | Add `openrouter_provider_preference` to SELECT columns in `findAll()` and `findById()`; add `updateOpenRouterProviderPreference(accountId: string, value: string \| null): Promise<void>` method | LOW — pure additive |
| DB operations facade | `packages/database/src/database-operations.ts` | Expose `updateOpenRouterProviderPreference` through the facade | LOW |
| Config | `packages/config/src/index.ts` | Add `openrouterDefaultProvider: string \| undefined` read from `OPENROUTER_DEFAULT_PROVIDER` env var | LOW — optional env var, undefined when unset |
| HTTP API accounts handler | `packages/http-api/src/handlers/accounts.ts` | Extend the account update endpoint to accept `openrouterProviderPreference` body field; validate as string \| null; persist via facade | LOW — follows existing `billingType` pattern exactly |

---

## New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Provider preference dialog | `packages/dashboard-web/src/components/accounts/AccountOpenRouterProviderDialog.tsx` | Mirrors `AccountCustomEndpointDialog.tsx` — single text input for provider slug (e.g. `"anthropic"`, `"together"`), save/cancel, visible only for openrouter accounts |
| Dialog export | `packages/dashboard-web/src/components/accounts/index.ts` | Add export for the new dialog component |

No new packages, no new DB tables, no new workers.

---

## Data Flow Changes

### Feature 1: Extended Cache Breakpoints (4th breakpoint)

Current: tools → system → last assistant turn (3 breakpoints).

New: tools → system → last assistant turn → last user turn (4 breakpoints).

The 4th breakpoint targets the last user message when it contains a content array with at least one text block. This is the correct Anthropic placement for caching large user-side context (RAG chunks, file contents passed by Claude Code).

```
transformRequestBody(request, account)
  → inject on tools[] last entry                    (breakpoint 1 — unchanged)
  → inject on system[] last block                   (breakpoint 2 — unchanged)
  → inject on last assistant turn content           (breakpoint 3 — unchanged)
  → inject on last user turn content block          (breakpoint 4 — NEW)
    condition: last user msg content is an array with a text block
    placement: last content block in that user message
    cache_control: { type: "ephemeral", ...(ttl ? { ttl } : {}) }
```

Single file: `openrouter/provider.ts`. Injection block follows the identical pattern to breakpoint 3, with `.find((m: any) => m.role === "user")` instead of `"assistant"`. Ordering within `transformRequestBody` puts this after the assistant breakpoint so the user turn is processed last (matches Anthropic's tools → system → messages processing order — user messages are always last in messages[]).

Confidence: HIGH — OpenRouter docs confirm 4-breakpoint limit for Anthropic-routed requests; user message placement is explicitly documented and demonstrated with examples.

### Feature 2: 1-hour TTL Cache Blocks

OpenRouter supports `{ type: "ephemeral", ttl: "1h" }` (1-hour) alongside the default `{ type: "ephemeral" }` (5-minute). No new cache type — it is the same `ephemeral` type with an optional `ttl` field.

TTL selection is computed once at the top of `transformRequestBody` and applied to all breakpoints in that request:

```
transformRequestBody(request, account)
  → const useExtendedTtl = (account?.session_request_count ?? 0) > SESSION_COUNT_THRESHOLD
  → const cacheControl = useExtendedTtl
      ? { type: "ephemeral", ttl: "1h" }
      : { type: "ephemeral" }
  → inject cacheControl at each breakpoint
```

`account.session_request_count` is already on the `Account` object, which is already passed to `transformRequestBody`. No DB schema change required. `SESSION_COUNT_THRESHOLD` should be a named constant (e.g., `5`) in the provider file.

Confidence: HIGH — OpenRouter docs show `ttl: "1h"` as the exact syntax on the ephemeral cache_control object. The `ttl` key is absent by default (5-minute window).

### Feature 3: Per-Account OpenRouter Provider Preference

This is the cross-layer feature. Complete data flow:

```
OPENROUTER_DEFAULT_PROVIDER env var (optional, read at startup)
  → Config.openrouterDefaultProvider
      ↓
Per-account override:
  Dashboard UI (AccountOpenRouterProviderDialog)
    → PATCH /api/accounts/:id { openrouterProviderPreference: "anthropic" }
    → accounts.ts handler validates and calls dbOps.updateOpenRouterProviderPreference()
    → account.repository.ts UPDATE accounts SET openrouter_provider_preference = ?
      ↓
  Account object loaded from DB:
    account.openrouter_provider_preference = "anthropic" | null
      ↓
  transformRequestBody(request, account):
    const providerPref = account?.openrouter_provider_preference
      ?? config.openrouterDefaultProvider
      ?? null
    if (providerPref && !body.provider) {
      body.provider = { order: [providerPref] }
    }
      ↓
  Outbound OpenRouter request:
    { ..., "provider": { "order": ["anthropic"] } }
```

Key design decisions baked into this flow:

1. **Client `provider` field wins**: The guard `if (!body.provider)` ensures a client that already sends `provider.order` is not overridden by the account default. Explicit client intent always takes precedence.

2. **Config is the fallback, not the override**: ENV var provides a system-wide default, useful when all OpenRouter accounts should prefer the same backend. Per-account DB value overrides it.

3. **`provider.order` not `provider.only`**: Per PROJECT.md constraint. `provider.only` eliminates all fallback and can cause hard failures. `provider.order` expresses preference while allowing OpenRouter to fall back to other providers if the preferred one is down.

4. **No API call to OpenRouter**: OpenRouter has no account-level provider preference API — their `provider.order` is request-body-only. Storing it in our DB and injecting at request time is the only correct approach.

Confidence: MEDIUM for the overall design (single-source verified for OpenRouter API; DB pattern extrapolated from existing `billing_type` precedent which is confirmed in codebase). HIGH for the `provider.order` injection point.

---

## Build Order

Dependencies run bottom-up: DB schema → types → DB layer → config → provider logic → API → UI.

**Phase 1: Data model** (no provider changes, no UI)

1. `packages/database/src/migrations.ts` — add `openrouter_provider_preference` migration
2. `packages/types/src/account.ts` — add field to `AccountRow`, `Account`, `toAccount()`, `AccountResponse`, `toAccountResponse()`
3. `packages/database/src/repositories/account.repository.ts` — add to SELECT queries; add `updateOpenRouterProviderPreference` method
4. `packages/database/src/database-operations.ts` — expose the new repository method
5. `packages/config/src/index.ts` — add `openrouterDefaultProvider` from env

All other phases depend on `Account.openrouter_provider_preference` existing in the type. Phase 1 must ship first. Run `bun run typecheck` after Phase 1 to confirm no regressions.

**Phase 2: Provider logic** (all three features land together)

6. `packages/providers/src/providers/openrouter/provider.ts`:
   - Compute TTL from `session_request_count`
   - Inject 4th breakpoint (user message)
   - Apply computed TTL to all 4 breakpoints
   - Inject `provider.order` from resolved preference
7. `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — new test cases for all three behaviors

Rationale: All three provider features share the same method (`transformRequestBody`). Landing them together minimizes the number of times the fork patch is touched, keeping the diff reviewable. Tests go in the same commit as the implementation.

**Phase 3: API layer**

8. `packages/http-api/src/handlers/accounts.ts` — extend update endpoint for `openrouterProviderPreference`

This phase only applies to Feature 3 (per-account preference). Features 1 and 2 have no API surface — they are purely provider-internal.

**Phase 4: Dashboard UI**

9. `packages/dashboard-web/src/components/accounts/AccountOpenRouterProviderDialog.tsx` — new dialog
10. `packages/dashboard-web/src/components/accounts/index.ts` — export
11. `AccountListItem.tsx` — wire in the dialog, gate on `account.provider === "openrouter"`
12. Mutation hook or inline query invalidation

Rationale: UI is entirely dependent on Phase 3 API and Phase 1 types. Cannot meaningfully develop or test UI without the API endpoint existing.

---

## Integration Risks

| Risk | Severity | Where | Mitigation |
|------|----------|-------|------------|
| Upstream adds its own cache injection in `openrouter/provider.ts` | HIGH | `openrouter/provider.ts` | `// FORK PATCH:` annotation already flags the entire `transformRequestBody` override for `pre-merge-check.sh`. The SOP handles this. No additional action needed, but during every upstream merge: manually verify the cache injection still works after merge. |
| 4th breakpoint + 1h TTL applied when client already has `cache_control` on user message | MEDIUM | `openrouter/provider.ts` | Follow existing breakpoint pattern: only inject if the target block does not already have `cache_control`. Add guard: `if (!lastBlock.cache_control)` before injecting. Prevents double-injection. |
| `provider.order` injection clobbers client-supplied provider routing | MEDIUM | `openrouter/provider.ts` | Resolved by `if (!body.provider)` guard (detailed in data flow above). Client always wins. |
| `toAccount()` mapper fails silently for existing DBs without the new column | LOW | `packages/types/src/account.ts` | Existing pattern handles this: `row.openrouter_provider_preference \|\| null`. SQLite returns undefined for missing columns; the `\|\| null` coercion converts to null safely. Migration runs before any request is served. |
| `AccountResponse` missing `openrouterProviderPreference` in some code paths | LOW | `packages/types/src/account.ts` | TypeScript enforces the field in `toAccountResponse()`. Compile-time catch. Run `bun run typecheck` after Phase 1. |
| Dashboard dialog visible for non-OpenRouter accounts | LOW | `AccountListItem.tsx` | `account.provider === "openrouter"` gate on the menu item render. Straightforward conditional. |
| TTL upgrade fires on very short high-frequency sessions | LOW | `openrouter/provider.ts` | Threshold constant is tunable. Default of 5 turns is conservative — at session_request_count 0 (first request), TTL is always 5 minutes. Adjust `SESSION_COUNT_THRESHOLD` as needed post-deployment. |

---

## Sources

- OpenRouter prompt caching docs (verified 2026-05-05): https://openrouter.ai/docs/guides/best-practices/prompt-caching — confirms `{ type: "ephemeral", ttl: "1h" }` syntax; 4-breakpoint limit for Anthropic models; user message placement supported
- OpenRouter provider routing docs (verified 2026-05-05): https://openrouter.ai/docs/guides/routing/provider-selection — confirms `provider.order` is a request-body-only field; no account-level order setting exists in OpenRouter's API; proxy-side injection is the correct implementation approach
- Codebase (verified 2026-05-05):
  - `packages/providers/src/providers/openrouter/provider.ts` — 3-breakpoint `transformRequestBody` and `extractUsageInfo` override
  - `packages/types/src/account.ts` — `Account`, `AccountRow`, `toAccount`, `AccountResponse`, `toAccountResponse`
  - `packages/database/src/repositories/account.repository.ts` — additive column SELECT pattern
  - `packages/database/src/migrations.ts` — `if (!columnNames.includes(...))` guard pattern for safe column additions
  - `packages/dashboard-web/src/components/accounts/AccountCustomEndpointDialog.tsx` — UI template for the new dialog
