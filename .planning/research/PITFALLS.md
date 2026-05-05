# Pitfalls Research — v1.1

**Project:** better-ccflare (personal fork) — v1.1 milestone
**Researched:** 2026-05-05
**Scope:** Pitfalls specific to adding three features to the existing proxy:
1. Extended cache breakpoints (4th breakpoint: high-token user message)
2. 1-hour TTL cache blocks (replacing ephemeral-only)
3. Per-account OpenRouter provider preference (ENV var + Dashboard UI)

---

## Summary

The highest-risk area in v1.1 is **breakpoint count management**: injecting a 4th cache breakpoint without knowing how many were already present in the incoming request will silently exceed Anthropic's hard 4-breakpoint limit, causing the cache to be applied to the wrong blocks or ignored entirely. The second major risk is **scope creep in the TTL implementation**: the proxy already has `injectSystemCacheTtl` applied globally in `proxy.ts`, so any new block-level TTL injection in the OpenRouter provider layer will interact with this — potentially doubling or conflicting with TTL values. The per-account provider preference feature carries the lowest technical risk but the highest **upstream merge surface risk**: every layer it touches (DB schema, Account type, HTTP API handler, AccountResponse type, Dashboard components) is shared with upstream, and changes to any of them create merge conflicts.

---

## Pitfall 1: Exceeding the 4-breakpoint Hard Limit

**Risk:** Anthropic's cache API enforces a hard limit of 4 `cache_control` breakpoints per request. The existing v1.0 implementation injects 3 unconditionally (tools, system, last assistant turn). Adding the 4th breakpoint (high-token user message) without checking how many breakpoints the *incoming request already contains* can push the total above 4. If the Claude Code client already placed a `cache_control` on the user message, the proxy adds a duplicate, exceeding the limit. OpenRouter passes this to Anthropic which returns a 400 error. The error is silent in the proxy logs because `transformRequestBody` catches and swallows all exceptions (line 112 of `provider.ts`).

**Warning signs:**
- Requests from Claude Code sessions start returning 400 errors intermittently, but only on long sessions where the client begins adding its own cache hints
- `cache_write_tokens` in the response drops to 0 and a `400 validation_error` appears in the error event stream
- The 400 is swallowed by the `catch` block, so the proxy falls back to the unmodified request, masking the root cause

**Prevention:**
- Before injecting the 4th breakpoint, count the total existing `cache_control` occurrences across `body.tools`, `body.system`, and all `body.messages[*].content[*]`. Only inject if the count is currently below 4.
- Do not assume the incoming request has zero breakpoints — Claude Code adds its own.
- Add a regression test case: request with 3 pre-existing `cache_control` markers should NOT receive a 4th injection.

**Phase to address:** Phase 1 (breakpoint extension). This check must be in place before the 4th breakpoint injection is shipped.

---

## Pitfall 2: TTL Injection Double-Application

**Risk:** The proxy already applies `injectSystemCacheTtl` globally in `packages/proxy/src/proxy.ts` (line 131) — this patches every existing `cache_control: { type: "ephemeral" }` in the `system` array to add `ttl: "1h"` when the `SYSTEM_PROMPT_CACHE_TTL_1H` config flag is enabled. If the v1.1 work also injects `ttl: "1h"` directly inside `OpenRouterProvider.transformRequestBody`, the same block will be processed by both layers. The result: any block already modified by the proxy-level injection will be processed again by the provider-level injection, which may try to re-set `ttl` on a block that already has it. This is harmless today because `injectSystemCacheTtl` checks `!block.cache_control.ttl` before writing — but that check only covers the system array, and only one specific field. If the v1.1 provider-level code handles the user message breakpoint differently, it may produce inconsistent TTL values across blocks in the same request.

**Warning signs:**
- System blocks have `ttl: "1h"` but the new user message breakpoint has `ttl: "ephemeral"` with no TTL (or vice versa)
- Requests with `SYSTEM_PROMPT_CACHE_TTL_1H=true` behave differently from those without it for the same input
- Cache hit rates are inconsistent across blocks: system hits but user message never hits

**Prevention:**
- Decide at design time: should TTL be controlled at the proxy level (global) or provider level (per-block)? Pick one path and keep it consistent.
- The cleanest approach: keep `injectSystemCacheTtl` in `proxy.ts` for system blocks, and have the OpenRouter provider read the same config flag to decide whether to inject `ttl: "1h"` on the new user message breakpoint. This gives uniform TTL across all breakpoints without duplicating logic.
- Add a test that verifies: given `SYSTEM_PROMPT_CACHE_TTL_1H=true`, all injected breakpoints (not just system) have `ttl: "1h"`.

**Phase to address:** Phase 2 (1-hour TTL). Before shipping, verify the two injection paths do not conflict.

---

## Pitfall 3: Non-Anthropic Models Receiving the 4th Breakpoint

**Risk:** The existing 3-breakpoint injection in the OpenRouter provider is currently ungated by model — it applies to all models routed through OpenRouter, including non-Anthropic ones (`openai/gpt-4o`, `google/gemini-2.5-pro`, etc.). This is deliberate and currently safe because OpenRouter silently ignores `cache_control` on models that do not support it. However, the 4th breakpoint targets the "high-token user message" — a heuristic selection (largest user message by character count or token estimate). This heuristic will apply the mutation to user messages in all requests, not just Claude requests. For non-Anthropic models, injecting `cache_control` into a user message content block is more likely to trigger a 400 than injecting it into tools or system, because some providers validate the messages array schema strictly.

**Warning signs:**
- Non-Anthropic model requests through the OpenRouter account return `400 invalid_request_error` after the 4th breakpoint is shipped
- Errors are swallowed by the `catch` block; the proxy silently falls back and the caller sees a different response than expected
- OpenRouter test account (e.g., `z-ai/glm-4.5-air:free`) starts returning errors on previously-working requests

**Prevention:**
- Gate the 4th breakpoint injection on model prefix: only inject on `anthropic/*` model slugs. This is a reversal of the v1.0 decision to omit the gate (documented in PROJECT.md as a deliberate choice) — but the 4th breakpoint is higher-risk than the first 3.
- Add a regression test: a request with model `openai/gpt-4o` should not receive any user message `cache_control` injection.
- Test with `z-ai/glm-4.5-air:free` via the OpenRouter account using `x-better-ccflare-account-id` to confirm no 400 errors before shipping.

**Phase to address:** Phase 1 (breakpoint extension). The gate must be added alongside the 4th breakpoint.

---

## Pitfall 4: Provider Preference Injected Upstream of Account-Level `transformRequestBody`

**Risk:** The OpenRouter `provider.order` field must be injected into the outgoing request body. The most obvious place is inside `OpenRouterProvider.transformRequestBody`. However, `transformRequestBody` is called *before* the body reaches the upstream, and the account object is passed as an optional parameter (`account?: Account`). If `provider_order` is a new field on `Account` (added to the DB schema and type), it will be available in `transformRequestBody`. But if the feature instead reads from a global config or ENV var that is not account-scoped, the injection will apply to *all* accounts routed through OpenRouter, not just the configured one — silently overriding the intent.

The `Account` interface and `AccountRow` interface in `packages/types/src/account.ts` are shared with upstream. Adding a `provider_order` field there will create a merge conflict on the next upstream sync.

**Warning signs:**
- Provider preference set for one account bleeds into requests from other OpenRouter accounts
- ENV var `OPENROUTER_PROVIDER_ORDER_<ACCOUNT_NAME>` parsing is brittle against account names with special characters
- Account PATCH endpoint changes `provider_order` but the proxy does not pick it up until server restart (if caching the Account object in memory)

**Prevention:**
- Store `provider_order` as a JSON string in a new `openrouter_provider_order` column on the `accounts` table — follow the exact same pattern as `model_mappings` (TEXT NULL, JSON encoded). This is the established per-account JSON config pattern in this codebase.
- Add the migration as a non-destructive `ALTER TABLE accounts ADD COLUMN openrouter_provider_order TEXT` migration step — no table rebuild required.
- Add `openrouter_provider_order?: string | null` to `AccountRow` and `openrouter_provider_order: string | null` to `Account`. Annotate both with `// FORK PATCH:` — upstream does not have this field and it will be a guaranteed merge conflict to manage.
- In `transformRequestBody`, parse the JSON string and inject `provider: { order: [...] }` only when the field is non-null and the model is not already specifying a provider override.

**Phase to address:** Phase 3 (per-account provider preference). Schema migration and type changes must happen before the injection logic.

---

## Pitfall 5: Dashboard UI PATCH Route Missing or Inconsistent with Account Update Path

**Risk:** The Dashboard UI for per-account provider preference requires a PATCH endpoint to save the `openrouter_provider_order` field. The existing pattern in `packages/http-api/src/handlers/accounts.ts` for updating `model_mappings` is a dedicated route (`PUT /api/accounts/:id/model-mappings`). If the v1.1 work adds `openrouter_provider_order` to the existing account PATCH body without a dedicated handler, upstream merges that touch `accounts.ts` (which has 2000+ lines) will conflict. If it adds a new dedicated route, it must also be reflected in the `AccountResponse` type, the dashboard API client, and the React component — four files that all touch the account data shape.

**Warning signs:**
- Dashboard saves the provider preference but a page refresh shows the old value (field not persisted to DB, only to in-memory state)
- `AccountResponse` type in `packages/types/src/account.ts` does not include `openrouterProviderOrder`, so the dashboard client TypeScript type does not know about it and the field is dropped in serialization
- The `accounts.ts` handler serializes accounts without the new field (it has multiple `SELECT` queries that must all be updated)

**Prevention:**
- Follow the `model_mappings` handler as the template exactly. It is the established precedent for per-account JSON config fields: dedicated GET, dedicated PATCH, field in `AccountResponse`.
- Grep for every `SELECT ... FROM accounts WHERE` in `accounts.ts` and verify the new column is included in all of them — there are at least 4 such queries in the file.
- Add `openrouterProviderOrder: string | null` to `AccountResponse` in `packages/types/src/account.ts`. Annotate with `// FORK PATCH:`.
- Write an integration test: set `openrouter_provider_order` via PATCH, fetch the account, assert the field is present in the response.

**Phase to address:** Phase 4 (Dashboard UI). Needs the DB column (Phase 3) before the UI can save values.

---

## Pitfall 6: Regression Test Scope Does Not Cover New Injection Paths

**Risk:** The existing 10 regression tests in `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` cover:
- `extractUsageInfo` reading `prompt_tokens_details` (CACHE-01)
- `transformRequestBody` injecting cache_control at 3 breakpoints (CACHE-02)

They do NOT cover:
- Breakpoint count checking (guard against exceeding 4)
- The 4th user message breakpoint injection
- `ttl: "1h"` being present on injected breakpoints
- Non-Anthropic model requests not receiving user message injection
- `provider.order` being injected when `openrouter_provider_order` is set

If these paths are shipped without regression tests, the existing 10 tests will continue passing even when new code is broken. The tests will give a false green signal.

**Warning signs:**
- All 10 existing tests pass after new code is added
- Manual inspection reveals the new injection paths are untested
- A future PR removes the 4th breakpoint guard because it "looks like dead code" (no test enforces it)

**Prevention:**
- Add tests for every new injection path alongside the code. Minimum required additions:
  - Breakpoint count guard: request with 3 existing `cache_control` markers does not get a 4th
  - 4th breakpoint injection: request with large user message and `anthropic/*` model gets `cache_control` on the high-token user block
  - Model gate: request with `openai/*` model does not get user message injection
  - TTL: when config flag is true, all injected breakpoints have `ttl: "1h"`
  - Provider order: when `account.openrouter_provider_order` is set, the outgoing body contains `provider.order`
- Run `bun test packages/providers/src/providers/openrouter/` before every commit touching the provider.

**Phase to address:** Every phase. Tests ship with the feature, not after.

---

## Pitfall 7: Pre-merge Check Script Does Not Cover New Files

**Risk:** The pre-merge check script at `.planning/scripts/pre-merge-check.sh` has a hardcoded `HIGH_RISK_FILES` list with 3 files:
- `packages/providers/src/providers/openai/provider.ts`
- `packages/providers/src/providers/openrouter/provider.ts`
- `packages/types/src/account.ts`

The v1.1 work adds fork patches to additional files not in this list:
- `packages/config/src/index.ts` (new config getter for TTL behavior, possibly provider preference)
- `packages/database/src/migrations.ts` (new column migration)
- `packages/http-api/src/handlers/accounts.ts` (new PATCH handler)
- `packages/types/src/stats.ts` (if config settings surface is extended)

If these files are not in `HIGH_RISK_FILES`, the pre-merge SOP will not surface conflicts in them during upstream merge preparation. A merge may proceed with undetected conflicts in these files.

**Warning signs:**
- Upstream merge completes cleanly according to the SOP but `bun run typecheck` fails afterward
- A config getter that was added for v1.1 is silently overwritten by upstream's refactor of `config/src/index.ts`

**Prevention:**
- After shipping each v1.1 phase, update `HIGH_RISK_FILES` in `pre-merge-check.sh` to include every file that received a `// FORK PATCH:` annotation.
- Document this as a mandatory step in the phase transition checklist.

**Phase to address:** At the end of each phase, before marking it complete.

---

## Fork-Specific Risks

### Annotation discipline

Every new fork-specific line must carry a `// FORK PATCH:` comment. The v1.1 additions touch at least 5 files across 3 packages. Without consistent annotation, the next upstream merge author (or future self) cannot distinguish fork additions from upstream code during conflict resolution.

- Schema column: `-- FORK PATCH: openrouter_provider_order for per-account provider preference` in the migration comment
- Type additions: `// FORK PATCH: v1.1 per-account OpenRouter provider preference` on `AccountRow` and `Account`
- Config additions: `// FORK PATCH: v1.1 TTL/provider preference config` on new getters
- HTTP handler additions: `// FORK PATCH: v1.1 openrouter_provider_order endpoint`

### Upstream merge surface for v1.1

New files that will require attention on the next upstream merge (not previously in the merge risk set):

| File | Risk | Likely conflict cause |
|------|------|-----------------------|
| `packages/database/src/migrations.ts` | LOW | Upstream adds columns to accounts table (ongoing) |
| `packages/config/src/index.ts` | MEDIUM | Upstream adds/renames config keys |
| `packages/http-api/src/handlers/accounts.ts` | HIGH | Upstream adds account endpoints; 2000+ line file |
| `packages/types/src/account.ts` | HIGH | Already in risk list; new fields add conflict surface |
| `packages/proxy/src/proxy.ts` | MEDIUM | `injectSystemCacheTtl` is a fork patch; upstream may touch nearby lines |

### Regression test continuity

The 10 existing tests in `openrouter/__tests__/provider.test.ts` are the regression baseline. All 10 must continue passing after every v1.1 change. The fastest way to verify this during development:

```bash
bun test packages/providers/src/providers/openrouter/
```

Run this after every meaningful edit to `provider.ts`. Do not wait for full test suite runs.

### Testing constraint reminder

The `z-ai/glm-4.5-air:free` model via the OpenRouter account (forced with `x-better-ccflare-account-id`) is the only permitted live test target. Never route through the `claude` account. For cache behavior specifically, a live test is the only way to verify that `cache_write_tokens` appears in the response — unit tests cannot substitute.

---

## Sources

- Codebase: `packages/providers/src/providers/openrouter/provider.ts` — PRIMARY (confirmed current implementation)
- Codebase: `packages/proxy/src/proxy.ts` lines 131, 356-378 — `injectSystemCacheTtl` implementation (confirmed)
- Codebase: `packages/config/src/index.ts` lines 355-366 — `getSystemPromptCacheTtl1h` (confirmed)
- Codebase: `packages/types/src/account.ts` lines 83-148 — `AccountRow` and `Account` interfaces (confirmed)
- Codebase: `.planning/scripts/pre-merge-check.sh` — `HIGH_RISK_FILES` list (confirmed 3 files only)
- [OpenRouter Prompt Caching Docs](https://openrouter.ai/docs/guides/best-practices/prompt-caching) — 4-breakpoint limit, TTL format `{ type: "ephemeral", ttl: "1h" }` (HIGH confidence, official)
- [OpenRouter Provider Routing Docs](https://openrouter.ai/docs/guides/routing/provider-selection) — `provider.order` is request-level only, no account-level equivalent (HIGH confidence, official)
- .planning/PROJECT.md — v1.1 requirements, key decisions, fork patch inventory (PRIMARY)
