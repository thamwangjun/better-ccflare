---
phase: 10-type-wiring-cli-http-api-sse-sniffer
reviewed: 2026-06-04T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - packages/types/src/provider-config.ts
  - packages/types/src/account.ts
  - packages/cli-commands/src/commands/account.ts
  - packages/cli-commands/src/commands/help.ts
  - packages/http-api/src/handlers/accounts.ts
  - packages/http-api/src/router.ts
  - packages/proxy/src/handlers/sse-rate-limit-sniffer.ts
  - packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts
  - packages/providers/src/providers/openrouter-anthropic/provider.ts
  - packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-06-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 10 wires the new `openrouter-anthropic` provider into shared types
(`PROVIDER_NAMES`, `PROVIDER_CONFIG`, account mode unions), the CLI
(`addAccount` dispatch + `createOpenRouterAnthropicAccount` helper), the HTTP API
(`createOpenRouterAnthropicAccountAddHandler` + route registration), the SSE
rate-limit sniffer (`ANTHROPIC_SHAPE_PROVIDERS`), and the provider class itself.

The wiring is consistent and closely mirrors the existing `openrouter` provider
patterns. Type unions are updated in all relevant places, the
`PROVIDER_CONFIG` entry satisfies the `Record<ProviderName, ProviderConfig>`
exhaustiveness check, and the SSE sniffer correctly includes the new provider in
the Anthropic-shape set with explicit regression tests (including a guard that
the OAI-shape `openrouter` does NOT fire on `overloaded_error`). The provider
class is well-tested (buildUrl dedup, cache passthrough, provider/session_id/usage
injection, real-cost extraction with type-confusion guards). The account-creation
handlers reuse the established `validateString`/`validateApiKey`/`validatePriority`
validators and parameterized SQL — no injection or secret-handling regressions
were found.

Findings are limited to two correctness/consistency warnings and minor
informational items.

## Warnings

### WR-01: `getAccountsList` mode mapping diverges from the API handler — `nanogpt`, `kilo`, `alibaba-coding-plan` fall through to a wrong mode

**File:** `packages/cli-commands/src/commands/account.ts:1730-1745`
**Issue:** The `mode` resolver in `getAccountsList` only maps `zai`, `minimax`,
`anthropic-compatible`, `bedrock`, `openrouter`, `openrouter-anthropic`, and
`codex` to their own provider name. Any other provider (e.g. `nanogpt`, `kilo`,
`alibaba-coding-plan`, `vertex-ai`, `qwen`, `ollama`, `ollama-cloud`) falls
through to `account.access_token ? "claude-oauth" : "console"`. The
`openrouter-anthropic` addition is correct here, but this confirms the resolver
is an incomplete allow-list. This is pre-existing for several providers, but
worth flagging because the new provider relies on this exact branch and a future
provider added without touching this list will silently mis-map. Since
`openrouter-anthropic` accounts have no `access_token` (key stored only in
`api_key`), the new entry is required — without it the account would have
displayed as `console`. The entry is present, so the new provider is correct; the
warning is that the surrounding pattern is fragile and untested.
**Fix:** Consider deriving `mode` from a shared provider→mode map (e.g. keyed off
`PROVIDER_NAMES`) rather than an inline allow-list, so new providers cannot be
omitted. At minimum add a unit test asserting `openrouter-anthropic` maps to
mode `"openrouter-anthropic"`.

### WR-02: `openrouter-anthropic` account stored with no `refresh_token`/`access_token`, so `tokenStatus` and `hasRefreshToken` reporting differs from streaming-key providers

**File:** `packages/http-api/src/handlers/accounts.ts:3643-3663` and `packages/cli-commands/src/commands/account.ts:391-412`
**Issue:** Both the HTTP handler and CLI helper insert the API key into `api_key`
only, leaving `refresh_token`/`access_token` NULL (matching the existing
`openrouter` helper). In `createAccountsListHandler` (accounts.ts:559-561),
`hasRefreshToken` is computed as `!!account.refresh_token && refresh_token !==
access_token`. For these accounts both are NULL, so `hasRefreshToken` is `false`
(correct), but `tokenStatus` in the list query is driven by `expires_at`
(set to now+1yr), yielding `"valid"`, while `toAccountResponse` (account.ts:368)
computes `tokenStatus` from `access_token` (NULL → `"expired"`). The two
code paths therefore report opposite token statuses for the same account. This
mirrors the existing `openrouter` behaviour, so it is not a new regression, but
the new provider inherits the inconsistency.
**Fix:** Confirm the intended `tokenStatus` for key-only OpenRouter accounts and
align the two computation sites. If `expires_at`-driven `"valid"` is correct,
`toAccountResponse` should also consider `expires_at` for API-key providers.

## Info

### IN-01: `console.warn` used in `provider-config.ts` instead of the project `Logger`

**File:** `packages/types/src/provider-config.ts:170,194,218,241`
**Issue:** CLAUDE.md conventions require the `Logger` class over `console.*`.
These `console.warn` calls predate Phase 10 and the new `OPENROUTER_ANTHROPIC`
entry does not add any, but the unknown-provider warnings will now never fire for
this provider name (it is a known provider), so no action is strictly required.
**Fix:** No change needed for Phase 10; noted for consistency.

### IN-02: Doc comment in `createSseRateLimitSniffer` is stale

**File:** `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts:79-83`
**Issue:** The JSDoc still says overloaded_error is "only matched for
Anthropic-shape providers ("anthropic", "claude-oauth")" — it omits
`openrouter-anthropic`, which was just added to `ANTHROPIC_SHAPE_PROVIDERS`
(line 48-52). The runtime behaviour is correct and tested; only the comment lags.
**Fix:** Update the JSDoc to list `openrouter-anthropic` alongside the other two.

### IN-03: Help text mode list omits several supported modes

**File:** `packages/cli-commands/src/commands/help.ts:9`
**Issue:** The `--mode` enumeration in the usage line lists
`openrouter-anthropic` (correctly added) but omits `zai`, `minimax`, `bedrock`,
`vertex-ai`, `alibaba-coding-plan`, `codex`, `qwen` that the dispatch in
`addAccount` accepts. Pre-existing; the new mode is documented correctly in both
the usage line and the expanded mode descriptions (help.ts:21).
**Fix:** No Phase 10 action needed; the new provider is documented.

### IN-04: Provider-preference parsing logic is duplicated across three sites

**File:** `packages/types/src/account.ts:420-432`, `packages/http-api/src/handlers/accounts.ts:566-584`, `packages/providers/src/providers/openrouter-anthropic/provider.ts:84-98`
**Issue:** The `openrouter_provider_preference` JSON parse + `allow_fallbacks ??
true` defaulting is implemented three times with subtly different shapes (the
provider reads `pref.order`/`pref.allow_fallbacks`; the type mapper and HTTP
handler emit `allowFallbacks`). All three are individually correct and tested,
but duplication risks future drift.
**Fix:** Extract a shared `parseOpenrouterProviderPreference()` helper in
`@better-ccflare/types` and reuse it in all three call sites.

---

_Reviewed: 2026-06-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
