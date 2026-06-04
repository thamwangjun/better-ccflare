# Architecture Patterns — v1.3 OpenRouter Anthropic Messages Provider

**Domain:** New provider integration into existing Bun/TypeScript Claude API load-balancer proxy
**Researched:** 2026-06-02
**Confidence:** HIGH (primary source: direct codebase reading; grep-backed enumeration of every `"openrouter"` literal site)

---

## Executive Summary

Adding `openrouter-anthropic` is a bounded integration: one new provider class, one registry entry, plus propagating the new mode string through a fixed set of type unions and UI branches. The hard work (DB column, REST endpoints, dashboard dialog, cost infrastructure, SSE parsing) is already done. No new DB migrations, no new npm deps, no changes to base classes.

The blast radius is larger than it looks at first glance. The mode string `"openrouter"` appears in **eleven distinct files** across six packages — every one needs a sibling `"openrouter-anthropic"` entry. Missing even one causes a TypeScript error, a dashboard blank, or a silent routing failure.

---

## 1. Provider Class

### Location

```
packages/providers/src/providers/openrouter-anthropic/
  provider.ts          (new class)
  index.ts             (re-export barrel)
  __tests__/
    provider.test.ts   (bun:test unit tests)
```

### Inheritance Chain

```
BaseProvider                            (packages/providers/src/base.ts)
  └── BaseAnthropicCompatibleProvider   (providers/base-anthropic-compatible.ts)
        └── AnthropicCompatibleProvider (providers/anthropic-compatible/provider.ts)
              └── OpenRouterAnthropicProvider   ← NEW
```

Do NOT extend `OpenRouterProvider`. That class overrides `extractUsageInfo` to read OAI-format `prompt_tokens_details`, runs 4-breakpoint `cache_control` injection, and reads `message_delta.usage.cost` for streaming cost — all incorrect for the native Anthropic Messages endpoint.

### Constructor Config

```typescript
super({
  name: "openrouter-anthropic",
  baseUrl: "https://openrouter.ai/api/v1",
  authHeader: "authorization",
  authType: "bearer",
  supportsStreaming: true,
});
```

### Required Method Overrides

| Method | Why Override | Implementation Notes |
|--------|-------------|----------------------|
| `getEndpoint()` | Return hardcoded `"https://openrouter.ai/api/v1"` | Simple one-liner; no env var needed |
| `buildUrl()` | Deduplicate `/api/v1` path prefix | `AnthropicCompatibleProvider.buildUrl()` already has deduplication logic via `URL.pathname` comparison. Since `baseUrl` ends with `/api/v1` and the request path is `/v1/messages`, the base's deduplication will fire incorrectly (it strips `/v1` prefix from `/v1/messages` to `/messages`). Either copy the `buildUrl` override from `OpenRouterProvider` (which uses `cleanPathname` replacement) or add a `buildUrl` that joins `baseUrl + /messages` directly. Verify at implementation. |
| `transformRequestBody()` | Inject `body.provider` from `openrouter_provider_preference`; do NOT inject `cache_control` | Call `super.transformRequestBody()` first (model mapping), then copy the FORK PATCH provider-injection block from `openrouter/provider.ts` lines 194–208 verbatim. Skip all cache_control logic — the native endpoint accepts it natively and Claude Code sends it already. |
| `extractUsageInfo()` | Read Anthropic-native cache field names + attach `usage.cost` | `super.extractUsageInfo()` (base class) correctly reads `cache_creation_input_tokens` and `cache_read_input_tokens` from the non-streaming JSON (these are the native field names on this endpoint). After calling super, re-read `json.usage.cost` with `typeof === "number"` guard and attach as `costUsd`. Pattern: clone response once, parse JSON once, call super with the clone, then attach cost from the already-parsed JSON. |
| `extractStreamingUsage()` | Return `costUsd: undefined` — no cost field exists in any SSE event on this endpoint | `super.extractStreamingUsage()` reads `message_start` and `message_delta` events correctly for Anthropic-native token fields. Override to call `super`, then replace `costUsd` with `undefined`. This prevents `estimateCostUSD()` from being used and avoids persisting a guessed cost as a real amount. |

**Key constraint:** The base `extractUsageInfo()` for non-streaming currently calls `estimateCostUSD()` and sets `costUsd` to the estimate. The override must replace that estimate with the real `usage.cost` when present, keeping the estimate only when `usage.cost` is absent (unlikely on this endpoint — the OpenRouter spec shows it as `number | null`, where `null` means the cost is not yet known).

### Registry Registration

File: `packages/providers/src/index.ts`

Add two lines (following the `OpenRouterProvider` pattern at lines 47 and 59):

```typescript
// Import (line ~47 area):
import { OpenRouterAnthropicProvider } from "./providers/openrouter-anthropic/provider";

// Registration (line ~68 area, after AnthropicCompatibleProvider):
registry.registerProvider(new OpenRouterAnthropicProvider());
```

File: `packages/providers/src/providers/index.ts`

Add one export following the `OpenRouterProvider` export at line 24:

```typescript
export { OpenRouterAnthropicProvider } from "./openrouter-anthropic/index";
```

---

## 2. CLI `--mode openrouter-anthropic` Wiring

### Files to Change

**`packages/cli-commands/src/commands/account.ts`**

Four sites:

1. **Line 47 — `AddAccountOptionsWithAdapter.mode` union** — add `| "openrouter-anthropic"` after `"openrouter"`.
2. **Line 79 — `AccountListItemWithMode.mode` union** — add `| "openrouter-anthropic"` after `"openrouter"`.
3. **Line 1334 — `addAccount()` dispatch** — add a new `else if (mode === "openrouter-anthropic")` branch immediately after the `"openrouter"` branch. The new branch mirrors `"openrouter"` almost exactly: prompt for API key, prompt for priority, prompt for model mappings, then call a new `createOpenRouterAnthropicAccount()` helper that inserts `provider: "openrouter-anthropic"` instead of `"openrouter"`. The display label should read `"OpenRouter Anthropic Messages (API key)"` and the endpoint confirmation prints `"https://openrouter.ai/api/v1"`.
4. **Line 1659 — `mode` inference in `listAccounts()`** — the switch-like block that maps `account.provider` back to a mode string. Add `account.provider === "openrouter-anthropic"` to the same `if` branch as `"openrouter"` (or add a sibling return).

**`packages/cli-commands/src/commands/help.ts`**

Lines 9 and 20 — extend the mode list and mode description table:
- Add `openrouter-anthropic` to the `--mode` option list in the usage string.
- Add a description line: `openrouter-anthropic: OpenRouter native Anthropic Messages endpoint (API key)`.

### `createOpenRouterAnthropicAccount()` Helper

Mirrors `createOpenRouterAccount()` (lines ~310–363) but stores `provider: "openrouter-anthropic"`. No custom endpoint column needed — the endpoint is hardcoded in the provider class. No separate `createAnthropicCompatibleAccount()` call — that function writes an arbitrary `provider` string parameter and could be reused with `provider = "openrouter-anthropic"` as the fifth argument, but creating a dedicated helper matches the existing per-mode pattern and is clearer.

### How `--mode openrouter` Wiring Works Today (Reference)

1. Mode string `"openrouter"` in `AddAccountOptionsWithAdapter` union.
2. `addAccount()` dispatches to `createOpenRouterAccount()` which INSERTs `provider: "openrouter"`.
3. `listAccounts()` maps `account.provider === "openrouter"` back to `mode: "openrouter"`.
4. The `openrouter` branch prompts for API key + priority + model mappings.

`openrouter-anthropic` follows the same four-step pattern with its own provider name string.

---

## 3. Full Type Chain — Every `"openrouter"` Site Needing a Sibling Branch

The following is a grep-backed exhaustive enumeration. Every site either needs `"openrouter-anthropic"` added to a union, or a sibling `=== "openrouter-anthropic"` condition added next to the existing `=== "openrouter"` check.

### A. Type Unions (add `| "openrouter-anthropic"`)

| File | Line(s) | Type | Action |
|------|---------|------|--------|
| `packages/types/src/account.ts` | 281 | `AccountListItem.mode` union | Add `\| "openrouter-anthropic"` |
| `packages/types/src/account.ts` | 305 | `AddAccountOptions.mode` union | Add `\| "openrouter-anthropic"` |
| `packages/types/src/provider-config.ts` | 15 | `PROVIDER_NAMES` object | Add `OPENROUTER_ANTHROPIC: "openrouter-anthropic"` entry |
| `packages/types/src/provider-config.ts` | ~110 | `PROVIDER_CONFIG` record | Add entry for `"openrouter-anthropic"` with same config shape as `"openrouter"` (no session tracking, no usage tracking, no OAuth, endpoint `https://openrouter.ai/api/v1`) |
| `packages/cli-commands/src/commands/account.ts` | 47, 79 | Two mode unions | Add `\| "openrouter-anthropic"` |
| `packages/dashboard-web/src/api.ts` | 259 | `initAddAccount` mode parameter union | Add `\| "openrouter-anthropic"` |
| `packages/dashboard-web/src/components/AccountsTab.tsx` | 120 | `handleAddAccount` mode parameter union | Add `\| "openrouter-anthropic"` |
| `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` | 28, 157, 431, 1020 | Four local mode union type literals | Add `\| "openrouter-anthropic"` to each |

### B. Runtime Special-Case Conditions (add sibling branch)

| File | Line | Condition | Action |
|------|------|-----------|--------|
| `packages/cli-commands/src/commands/account.ts` | 1334 | `else if (mode === "openrouter")` | Add `else if (mode === "openrouter-anthropic")` branch after it |
| `packages/cli-commands/src/commands/account.ts` | 1659 | `account.provider === "openrouter"` in `listAccounts()` mode inference | Add `\|\| account.provider === "openrouter-anthropic"` to the same condition |
| `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` | 350 | `account.provider === "openrouter"` — provider preference button gate | Widen to `account.provider === "openrouter" \|\| account.provider === "openrouter-anthropic"` |
| `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` | 710 | `newAccount.mode === "openrouter"` — form submit handler | Add `\|\| newAccount.mode === "openrouter-anthropic"` (or separate branch if the new mode calls a different API endpoint) |
| `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` | 1051 | `<SelectItem value="openrouter">` | Add sibling `<SelectItem value="openrouter-anthropic">OpenRouter Anthropic Messages (API Key)</SelectItem>` |
| `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` | 1665 | `{newAccount.mode === "openrouter" && (` — form section render gate | Add sibling or extend to `"openrouter-anthropic"` |
| `packages/http-api/src/handlers/accounts.ts` | 3495 | `"openrouter"` string literal in INSERT | Add a parallel `createOpenRouterAnthropicAccountAddHandler` inserting `"openrouter-anthropic"` |
| `packages/http-api/src/router.ts` | 248–249 | `POST:/api/accounts/openrouter` route | Add `POST:/api/accounts/openrouter-anthropic` route |

### C. Sites That Do NOT Need Changes

These files reference `openrouter` but the logic generalizes correctly:

| File | Why No Change Needed |
|------|---------------------|
| `packages/proxy/src/handlers/response-processor.ts` | No `provider === "openrouter"` special-case at all. The only per-provider branches are `account.provider === "zai"` (line 232) and `account.provider === "codex"` (line 93). Usage extraction dispatches through the provider's own methods — fully polymorphic. |
| `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` | ⚠️ **CORRECTION (Phase 10 discuss, 2026-06-04): THIS ROW IS WRONG — `"openrouter-anthropic"` MUST be added to `ANTHROPIC_SHAPE_PROVIDERS`.** The original claim conflated `openrouter-anthropic` with the OAI-shape `openrouter` provider. The native Anthropic Messages endpoint emits genuine Anthropic-shape `overloaded_error` SSE frames, and the sniffer GATES `overloaded_error` matching behind this set (lines 79–81) — the default `typePattern` matches `rate_limit_error` ONLY, not `overloaded_error`. ROADMAP SC#4 requires this change. See Phase 10 CONTEXT.md D-01. (`"openrouter"` itself correctly stays out — it is OAI-shape and does not emit Anthropic `overloaded_error`.) |
| `packages/proxy/src/usage-extraction.ts` | Reads `usage.cost` generically from any SSE frame via `typeof === "number"` guard. Works for `openrouter-anthropic` streaming already (no `cost` field in SSE means `providerCostUsd` stays `undefined`, which is the correct behavior). No change needed. |
| `packages/proxy/src/post-processor.worker.ts` | `resolveCostUsd()` pathway is provider-agnostic. For `openrouter-anthropic` streaming, `providerCostUsd` will remain `undefined` (no cost in SSE), so `resolveCostUsd` falls through to `estimateCostUSD()`. Intended behavior. No change needed. |
| `packages/database/src/migrations.ts` and `migrations-pg.ts` | `openrouter_provider_preference` column already exists. No new columns needed. |
| `packages/database/src/repositories/account.repository.ts` | Column reads/writes are string-based and provider-agnostic. No change needed. |
| `packages/proxy/src/auto-refresh-scheduler.ts` | Inline Account objects at lines 314, 796, 927 include `openrouter_provider_preference: null` as a structural field of the `Account` type — not a special-case for `"openrouter"`. No change needed. |
| `packages/types/src/account.ts` — `toAccount()`, `toAccountResponse()` | FORK PATCH for `openrouter_provider_preference` parsing is unconditional — runs for any account that has the column populated, regardless of provider. No change needed. |

### D. The `PROVIDER_NAMES` / `PROVIDER_CONFIG` Gap

`packages/types/src/provider-config.ts` defines the canonical provider metadata used by `requiresSessionDurationTracking()`, `supportsUsageTracking()`, `getDefaultEndpoint()`, and `isKnownProvider()`.

Without adding `"openrouter-anthropic"` here, `isKnownProvider("openrouter-anthropic")` returns `false`, triggering a `console.warn` and defaulting to `"https://api.anthropic.com"` for every diagnostic path that calls `getDefaultEndpoint()`. This is not a crash but it is incorrect and produces misleading logs.

Add to `PROVIDER_NAMES`:
```typescript
OPENROUTER_ANTHROPIC: "openrouter-anthropic",
```

Add to `PROVIDER_CONFIG`:
```typescript
[PROVIDER_NAMES.OPENROUTER_ANTHROPIC]: {
  requiresSessionTracking: false,
  supportsUsageTracking: false,
  supportsOAuth: false,
  defaultEndpoint: "https://openrouter.ai/api/v1",
},
```

---

## 4. Provider-Preference Infra Reuse

### Can the Existing Column + Endpoints + Dashboard Dialog Serve Both Providers?

**Column:** Yes, unconditionally. `openrouter_provider_preference` already exists on `accounts` (SQLite + PostgreSQL). No migration needed.

**REST endpoints (`PUT`/`DELETE` `/api/accounts/:id/openrouter-provider-preference`):** Yes, as-is. These endpoints operate on `accountId` — they do not check `account.provider`. Any account can have its preference set.

**Dashboard dialog (`AccountOpenrouterProviderPreferenceDialog.tsx`):** Yes, the dialog itself needs no changes. The **gate in `AccountListItem.tsx` must be widened** from `account.provider === "openrouter"` to `account.provider === "openrouter" || account.provider === "openrouter-anthropic"`.

**`dashboard-web/src/api.ts` — `updateOpenRouterProviderPreference` and `deleteOpenRouterProviderPreference`:** These call `/api/accounts/${accountId}/openrouter-provider-preference` with no provider check on the client side. Works for both providers as-is once the dialog gate is widened.

**Injection in the new provider class:** The new `transformRequestBody()` copies the FORK PATCH injection block from `openrouter/provider.ts` lines 194–208 verbatim. The DB column name and JSON shape are identical.

**Summary:** Provider-preference infra is reusable with exactly one change — widen the `AccountListItem.tsx` gate at line 350.

---

## 5. Dashboard Add-Account Flow

The `AccountAddForm.tsx` pattern for adding an OpenRouter account:
1. Mode `"openrouter"` in SelectItem → show API key input + model mappings + endpoint label.
2. On submit: `api.addOpenRouterAccount()` → `POST /api/accounts/openrouter`.

For `openrouter-anthropic`:
1. Mode `"openrouter-anthropic"` in new SelectItem → show same API key input + model mappings + endpoint label `https://openrouter.ai/api/v1/messages`.
2. On submit: `api.addOpenRouterAnthropicAccount()` → `POST /api/accounts/openrouter-anthropic`.

**New route in `packages/http-api/src/router.ts`:** `POST:/api/accounts/openrouter-anthropic` → `createOpenRouterAnthropicAccountAddHandler()`.

**New handler in `packages/http-api/src/handlers/accounts.ts`:** Mirrors `createOpenRouterAccountAddHandler` but inserts `provider: "openrouter-anthropic"`.

---

## 6. Cost Tracking Integration

### Non-Streaming (CONFIRMED WORKING)

The OpenRouter native Anthropic endpoint returns `usage.cost` in the non-streaming JSON response body (OpenRouter spec: `number | null`, format double). The existing `extractUsageFromJson()` in `usage-extraction.ts` already reads `usageObj.cost` with a `typeof === "number"` guard and sets `state.usage.providerCostUsd`. The new `extractUsageInfo()` override in `OpenRouterAnthropicProvider` attaches this as `costUsd` directly on the provider path (which feeds `updateRequestUsage()` and `save()` with COALESCE protection).

### Streaming (GAP — CONFIRMED)

No `cost` field exists in any SSE event on `/api/v1/messages` (confirmed from OpenRouter OpenAPI spec — `MessagesDeltaEvent.usage` schema has no `cost` field). The `extractStreamingUsage()` override returns `costUsd: undefined`. The post-processor worker will call `estimateCostUSD()` as fallback. If `estimateCostUSD()` returns 0 for an unknown model, `resolveCostUsd()` maps it to `undefined`, and the DB writer's `?? null` collapses to `null`. This matches the handling for unknown models on all other providers.

**Implication for roadmap:** Streaming cost on `openrouter-anthropic` accounts will be `null` in the DB for requests where `estimateCostUSD()` returns 0. Acceptable for v1.3 — identical behavior to existing `openrouter` for unknown model names.

---

## 7. Suggested Build Order

Dependencies flow: provider class → registry → type unions → CLI wiring → HTTP API → dashboard.

| Step | Work Item | Files | Dependency |
|------|-----------|-------|------------|
| 1 | Provider class + tests | `packages/providers/src/providers/openrouter-anthropic/` | None |
| 2 | Registry registration + barrel exports | `packages/providers/src/index.ts`, `packages/providers/src/providers/index.ts` | Step 1 |
| 3 | `PROVIDER_NAMES` + `PROVIDER_CONFIG` | `packages/types/src/provider-config.ts` | None (parallel with 1) |
| 4 | `Account`/`AccountListItem`/`AddAccountOptions` type unions | `packages/types/src/account.ts` | Step 3 |
| 5 | CLI mode unions + `addAccount` dispatch + `listAccounts` inference + help text | `packages/cli-commands/src/commands/account.ts`, `help.ts` | Steps 3–4 |
| 6 | HTTP API handler + route | `packages/http-api/src/handlers/accounts.ts`, `router.ts` | Steps 3–4 |
| 7 | Dashboard type unions + add-form mode branch + API method | `packages/dashboard-web/src/api.ts`, `AccountAddForm.tsx`, `AccountsTab.tsx` | Step 6 |
| 8 | Dashboard provider-preference dialog gate | `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` | Step 7 |
| 9 | Integration test via `:free` model on `openrouter-anthropic` account | Manual curl with `x-better-ccflare-account-id` | Steps 1–8 |

**Parallelizable:** Steps 1 and 3 can be done simultaneously. Steps 5 and 6 can be done simultaneously once 3–4 are done.

**TypeScript enforcement:** Running `bun run typecheck` after Step 4 will surface every remaining union gap — use as a checkpoint before wiring runtime branches.

---

## Component Summary

### New Components

| Component | File | Type |
|-----------|------|------|
| `OpenRouterAnthropicProvider` | `packages/providers/src/providers/openrouter-anthropic/provider.ts` | New class |
| Provider barrel | `packages/providers/src/providers/openrouter-anthropic/index.ts` | New file |
| Provider unit tests | `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` | New file |
| `createOpenRouterAnthropicAccountAddHandler` | `packages/http-api/src/handlers/accounts.ts` | New function in existing file |
| `addOpenRouterAnthropicAccount()` | `packages/dashboard-web/src/api.ts` | New method in existing class |

### Modified Components

| Component | File | Change |
|-----------|------|--------|
| Provider registry | `packages/providers/src/index.ts` | Import + `registerProvider()` call |
| Provider barrel | `packages/providers/src/providers/index.ts` | Export line |
| `PROVIDER_NAMES` / `PROVIDER_CONFIG` | `packages/types/src/provider-config.ts` | New enum entry + config record entry |
| `AccountListItem.mode` union | `packages/types/src/account.ts` | Union extension (line 281) |
| `AddAccountOptions.mode` union | `packages/types/src/account.ts` | Union extension (line 305) |
| CLI mode unions (2 types) | `packages/cli-commands/src/commands/account.ts` | Lines 47, 79 |
| CLI `addAccount()` dispatch | `packages/cli-commands/src/commands/account.ts` | New `else if` branch (~line 1360) |
| CLI `listAccounts()` mode inference | `packages/cli-commands/src/commands/account.ts` | Extend condition at line 1659 |
| CLI help text | `packages/cli-commands/src/commands/help.ts` | Lines 9, 20 |
| HTTP API router | `packages/http-api/src/router.ts` | New route `POST:/api/accounts/openrouter-anthropic` |
| Dashboard API client | `packages/dashboard-web/src/api.ts` | Union extension (line 259) + new method |
| Dashboard AccountsTab | `packages/dashboard-web/src/components/AccountsTab.tsx` | Union extension (line 120) |
| Dashboard AccountAddForm | `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` | 4 union extensions + new mode branch + new SelectItem |
| Dashboard AccountListItem | `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` | Widen provider preference gate (line 350) |

### Unchanged Components

| Component | File | Reason |
|-----------|------|--------|
| `BaseAnthropicCompatibleProvider` | `base-anthropic-compatible.ts` | Upstream code; modifications break merge hygiene |
| `AnthropicCompatibleProvider` | `anthropic-compatible/provider.ts` | Upstream code; used as parent class only |
| `OpenRouterProvider` | `openrouter/provider.ts` | Fork-safety requirement; left untouched |
| `response-processor.ts` | proxy package | No `"openrouter"` special-case; polymorphic dispatch |
| `sse-rate-limit-sniffer.ts` | proxy package | ⚠️ **WRONG — see §3C correction (2026-06-04): `"openrouter-anthropic"` MUST be added** to `ANTHROPIC_SHAPE_PROVIDERS` so `overloaded_error` triggers failover (ROADMAP SC#4 / CONTEXT D-01). Only `"openrouter"` (OAI-shape) stays out. |
| `usage-extraction.ts` | proxy package | Generic `usage.cost` reader; works for both providers |
| `post-processor.worker.ts` | proxy package | `resolveCostUsd` is provider-agnostic |
| DB migrations (SQLite + PG) | database package | `openrouter_provider_preference` column exists; no new columns |
| Account repository | database package | String-based column operations; provider-agnostic |
| `AccountOpenrouterProviderPreferenceDialog.tsx` | dashboard package | Dialog itself unchanged; only gate in `AccountListItem.tsx` changes |

---

## Sources

- Direct codebase reading via `Read` tool (HIGH confidence — ground truth):
  - `packages/providers/src/providers/base-anthropic-compatible.ts`
  - `packages/providers/src/providers/anthropic-compatible/provider.ts`
  - `packages/providers/src/providers/openrouter/provider.ts`
  - `packages/providers/src/providers/index.ts`
  - `packages/providers/src/index.ts`
  - `packages/proxy/src/handlers/response-processor.ts`
  - `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts`
  - `packages/proxy/src/usage-extraction.ts`
  - `packages/proxy/src/post-processor.worker.ts`
  - `packages/types/src/account.ts`
  - `packages/types/src/provider-config.ts`
  - `packages/cli-commands/src/commands/account.ts`
  - `packages/http-api/src/handlers/accounts.ts`
  - `packages/http-api/src/router.ts`
  - `packages/dashboard-web/src/api.ts`
  - `packages/dashboard-web/src/components/AccountsTab.tsx`
  - `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx`
  - `packages/dashboard-web/src/components/accounts/AccountListItem.tsx`
- Grep-backed enumeration: all `"openrouter"` literal sites across `packages/**` (HIGH confidence)
- `.planning/research/STACK.md` — sibling researcher's API findings (HIGH confidence — OpenRouter OpenAPI spec)

---

*Architecture research for: v1.3 OpenRouter Anthropic Messages provider integration*
*Researched: 2026-06-02*
