# Pitfalls Research

**Domain:** Adding a new "openrouter-anthropic" provider to the better-ccflare proxy fork (v1.3)
**Researched:** 2026-06-02
**Confidence:** HIGH (based on direct codebase inspection + confirmed OpenRouter OpenAPI spec from STACK.md sibling research)

---

## Critical Pitfalls

### Pitfall 1: Copying readFinalSseCost() for the new provider's streaming cost path

**What goes wrong:**
The developer copies `OpenRouterProvider.extractStreamingUsage()` (and its private `readFinalSseCost()`) into the new provider, expecting it to populate `costUsd` from the SSE stream. It always returns `undefined`. Cost for streaming requests silently persists as whatever `estimateCostUSD()` produces — either a token-estimate dollar figure or `null` for unknown models. The database records wrong or null costs for all streaming requests from `openrouter-anthropic` accounts.

**Why it happens:**
`OpenRouterProvider.readFinalSseCost()` reads `usage.cost` from the final `message_delta` SSE event. On the OpenAI-format `/api/v1/chat/completions` endpoint this works because OpenRouter injects `usage.cost` into the final delta. On the native Anthropic Messages endpoint `/api/v1/messages`, the `MessagesDeltaEvent.usage` schema has **no `cost` field** (confirmed from OpenRouter's OpenAPI spec, schema `MessagesDeltaEvent` — see STACK.md). Copying the method produces a reader that loops over the entire SSE stream and always returns `undefined` — functionally a silent no-op.

**How to avoid:**
- Do NOT copy `readFinalSseCost()` into `OpenRouterAnthropicProvider`.
- In `extractStreamingUsage()`, call `super.extractStreamingUsage(clone, originalHeaders)` to get correct token counts, then return `{ ...base, costUsd: undefined }` explicitly. This suppresses the `readFinalSseCost` attempt and leaves cost resolution to `resolveCostUsd()` in the worker (which falls back to `estimateCostUSD()` when `providerCostUsd` is `undefined`).
- The estimate fallback is acceptable and consistent with all other non-OpenRouter providers. Document this explicitly in a `// FORK PATCH:` comment: "no `cost` field in SSE on native Anthropic Messages endpoint — falls back to estimate."

**Warning signs:**
- Streaming requests show costs that vary in a pattern matching token count rather than actual OpenRouter billing amounts.
- If `readFinalSseCost()` is copied and always returns `undefined`, the `log.warn` about "no usage.cost" fires for every streaming request.

**Phase to address:**
Phase 1 (Provider class implementation). The `extractStreamingUsage` override must be written correctly from the start. Covered by a unit test with a mock SSE stream containing `message_delta` events with no `cost` field — asserting `costUsd` is `undefined`.

---

### Pitfall 2: Inheriting OpenRouterProvider's cache_control injector via the wrong parent class

**What goes wrong:**
The new provider accidentally extends `OpenRouterProvider` instead of `AnthropicCompatibleProvider`. It inherits `transformRequestBody()` with the 4-breakpoint injector. Claude Code already sends `cache_control` blocks on its own requests (up to 4 total). The injector's `countExistingCacheControlBlocks()` pre-count guard respects the limit — but only if Claude Code sent exactly 4 blocks. Requests where Claude Code sent fewer than 4 blocks (common for short conversations) will have additional blocks injected by the inherited provider. The native `/api/v1/messages` endpoint enforces a 4-block maximum. When the combined count exceeds 4, the endpoint returns a 400 validation error and the request fails.

**Why it happens:**
Two OpenRouter-related providers both start with `openrouter`. A developer reaching for a pre-wired OpenRouter base class may reach for `OpenRouterProvider` because it already has `buildUrl`, auth config, and `name: "openrouter"` close to what is needed. The STACK research explicitly flags this as the wrong parent.

**How to avoid:**
- Extend `AnthropicCompatibleProvider` — the only safe parent.
- In `transformRequestBody()`: call `super.transformRequestBody()` for model mapping, then inject `body.provider` from `account.openrouter_provider_preference`. Copy ONLY the preference-injection block from `openrouter/provider.ts` lines 194–209. Do NOT copy any of the `cache_control` injection blocks (lines 83–189).
- Add a `// FORK PATCH:` comment in `transformRequestBody()` explicitly noting: "NO cache_control injection — native passthrough; Claude Code sends its own blocks."
- Unit test: feed a request body with 4 existing `cache_control` blocks; assert the outgoing body still has exactly 4 blocks (none added).

**Warning signs:**
- HTTP 400 responses from OpenRouter with a message about exceeding prompt cache block limits.
- Requests succeed on short conversations but start failing after a few turns as Claude Code adds more blocks.

**Phase to address:**
Phase 1 (Provider class implementation).

---

### Pitfall 3: extractUsageInfo reads OpenAI-format usage fields (prompt_tokens_details)

**What goes wrong:**
The developer copies `OpenRouterProvider.extractUsageInfo()` into the new provider. The OpenRouter OpenAI-format endpoint returns `usage.prompt_tokens_details.cache_write_tokens` and `usage.prompt_tokens_details.cached_tokens`. The native Anthropic Messages endpoint returns `usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens` at the top level of the `usage` object (Anthropic-native field names — confirmed from spec schema `AnthropicUsage`). The copied `extractUsageInfo()` reads `prompt_tokens_details` fields that do not exist on this endpoint — cache token counts are always `0` in the database for `openrouter-anthropic` accounts.

**Why it happens:**
`OpenRouterProvider.extractUsageInfo()` was written to fix the OAI-format / Anthropic-native field mismatch. That fix is correct for the OAI endpoint and wrong for the native endpoint. Copying it reverses the fix.

**How to avoid:**
- Do NOT copy `OpenRouterProvider.extractUsageInfo()`.
- For the non-streaming path, call `super.extractUsageInfo(response)` — the base class `BaseAnthropicCompatibleProvider` reads `cache_creation_input_tokens` and `cache_read_input_tokens` correctly at the top level. After calling super, re-read `json.usage.cost` and attach with the `typeof` guard:
  ```typescript
  const costUsd = typeof json.usage.cost === "number" ? json.usage.cost : undefined;
  return { ...base, costUsd };
  ```
- Unit test: mock non-streaming response body with `{ usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, cost: 0.001 } }`. Assert all five values are correctly populated in the returned object.

**Warning signs:**
- `cache_read_input_tokens` and `cache_creation_input_tokens` are always `0` for `openrouter-anthropic` requests even on long conversations where caching should be active.
- Dashboard cost tracking shows `$0` cache writes for an account that should be accumulating prompt cache.

**Phase to address:**
Phase 1 (Provider class implementation).

---

### Pitfall 4: Provider name string missing from type/config registration sites

**What goes wrong:**
`"openrouter-anthropic"` is added to the provider registry but omitted from one or more of the six required registration locations. The result depends on which location is missed:
- Missing from `PROVIDER_NAMES` / `PROVIDER_CONFIG` in `packages/types/src/provider-config.ts`: `isKnownProvider()` returns `false`; `getDefaultEndpoint()` falls through to `"https://api.anthropic.com"` — routing requests to the real Anthropic endpoint (account ban risk).
- Missing from `account.ts` union type: TypeScript compile-time gap; may pass if the field is typed as `string` at runtime.
- Missing from CLI `mode` union (two locations at lines 47 and 79 of `account.ts`): `--add-account --mode openrouter-anthropic` falls through to interactive prompts.
- Missing from CLI `--list` mode mapper (line 1659 region): accounts show mode `undefined` or fall through to the `claude-oauth` case.
- Missing from dashboard `AccountAddForm` mode unions and `SelectItem`: the "Add Account" form does not surface the new type to users.
- Missing from `HTTP API /api/accounts/openrouter-anthropic` route: `POST` returns 404 from the dashboard.

**Why it happens:**
Provider registration is scattered across six-plus files with no central schema. Adding a new provider to the registry does not trigger TypeScript errors in most of the scattered string-comparison sites, so missing locations are not caught at compile time.

**How to avoid:**
Use the existing `"openrouter"` string as a reference. Every file that contains `"openrouter"` as a string literal that is NOT the new provider must also contain `"openrouter-anthropic"` after this feature. Run this check before marking Phase 2 complete:
```bash
grep -rn '"openrouter"' packages/ --include="*.ts" | grep -v test | grep -v "openrouter-anthropic"
```
Any hit that should have a parallel `"openrouter-anthropic"` entry is a missed registration.

The complete required list (from codebase inspection):
1. `packages/types/src/provider-config.ts` — `PROVIDER_NAMES` object, `PROVIDER_CONFIG` keyed entry
2. `packages/types/src/account.ts` — `Account.provider` union (line 281), `AccountResponse.provider` union (line 305), `AddAccountOptions.mode` union (line 305 region)
3. `packages/cli-commands/src/commands/account.ts` — `mode` union at line 47, `mode` union at line 79, `createOpenRouterAnthropicAccount` function, `else if (mode === "openrouter-anthropic")` handler, `--list` mode display mapper (line 1659 region)
4. `packages/http-api/src/handlers/accounts.ts` — new `createOpenRouterAnthropicAccountAddHandler` + route registration; `accountToResponse` mode mapper (line 566 region); all `SELECT` queries must include the new provider if they filter by provider
5. `packages/providers/src/index.ts` — `registerProvider(new OpenRouterAnthropicProvider())`
6. `packages/providers/src/providers/index.ts` — `export { OpenRouterAnthropicProvider }`
7. `packages/dashboard-web/src/api.ts` — provider union at line 259; new `addOpenRouterAnthropicAccount()` method targeting `POST /api/accounts/openrouter-anthropic`
8. `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` — mode unions at lines 28, 157, 431, 1020; new `SelectItem`; new form branch for `mode === "openrouter-anthropic"`
9. `packages/dashboard-web/src/components/AccountsTab.tsx` — provider union at line 120

**Warning signs:**
- `bun run typecheck` fails on missing union members.
- `bun run cli --add-account test --mode openrouter-anthropic --api-key sk-test` falls through to interactive mode.
- Warning in server logs: `Unknown provider: openrouter-anthropic. Defaulting to no session tracking.`
- HTTP 404 on `POST /api/accounts/openrouter-anthropic` from dashboard.

**Phase to address:**
Phase 1 creates the provider class. Phase 2 (Wiring / CLI / API) completes all registrations. Verification: run the grep check above at the end of Phase 2 before the phase is marked done.

---

### Pitfall 5: Dashboard provider-preference dialog gate not extended to openrouter-anthropic

**What goes wrong:**
`AccountListItem.tsx` line 350 gates the provider preferences settings button on `account.provider === "openrouter"`. Users with `openrouter-anthropic` accounts cannot access the dialog to set `openrouter_provider_preference`. The column, injection, and HTTP endpoints all work — only the UI gate is missing.

**Why it happens:**
The gate is a string equality check written in v1.1 when `"openrouter"` was the only relevant provider. Adding a new provider requires extending the condition in a separate file that is easy to overlook when the main focus is the provider class.

**How to avoid:**
Change line 350 of `AccountListItem.tsx` from:
```tsx
account.provider === "openrouter"
```
to:
```tsx
(account.provider === "openrouter" || account.provider === "openrouter-anthropic")
```
Also update the `AccountsTab.tsx` provider union (line 120) and `dashboard/src/api.ts` provider union (line 259) to include `"openrouter-anthropic"` or the TypeScript widening will cause the condition to always match via `string` fallthrough.

**Warning signs:**
- No settings gear icon on `openrouter-anthropic` account cards.
- PUT to `/api/accounts/:id/openrouter-provider-preference` succeeds via curl but the UI never exposes it.

**Phase to address:**
Phase 3 (Dashboard) — same phase as `AccountAddForm` extension. Both are UI-only changes.

---

### Pitfall 6: SSE rate-limit sniffer not extended for openrouter-anthropic as Anthropic-shape

**What goes wrong:**
`ANTHROPIC_SHAPE_PROVIDERS` in `sse-rate-limit-sniffer.ts` is a hardcoded `Set(["anthropic", "claude-oauth"])`. The sniffer is instantiated with `{ provider: account.provider }` (`response-handler.ts:194`). An `openrouter-anthropic` account passes `"openrouter-anthropic"` → `isAnthropicShape` is `false` → the type pattern is `"rate_limit_error"` only. `overloaded_error` mid-stream frames are silently ignored. OpenRouter overload errors on `openrouter-anthropic` accounts do not trigger account failover — the account keeps receiving requests while overloaded.

**Why it happens:**
`ANTHROPIC_SHAPE_PROVIDERS` was defined for two Anthropic-native providers and has never been extended. The native Anthropic Messages endpoint on OpenRouter emits the same SSE error envelope as the Anthropic API (Anthropic-shape), so `openrouter-anthropic` should be in this set.

**How to avoid:**
Add `"openrouter-anthropic"` to `ANTHROPIC_SHAPE_PROVIDERS` in `sse-rate-limit-sniffer.ts` — a one-line change:
```typescript
const ANTHROPIC_SHAPE_PROVIDERS = new Set(["anthropic", "claude-oauth", "openrouter-anthropic"]);
```
This file is NOT currently in `HIGH_RISK_FILES` — it is low-conflict-risk because upstream is unlikely to touch this set. Add a unit test asserting that `createSseRateLimitSniffer({ provider: "openrouter-anthropic" })` fires on `overloaded_error` frames.

**Warning signs:**
- Overloaded `openrouter-anthropic` accounts are not marked rate-limited after mid-stream overload errors.
- Requests that should failover continue on the same account until an explicit 429 arrives.

**Phase to address:**
Phase 2 (Wiring) — treated as a coexistence wiring task alongside the other string-extension changes.

---

### Pitfall 7: buildUrl double-segment on the native messages path

**What goes wrong:**
The new provider sets `baseUrl: "https://openrouter.ai/api/v1"`. Claude Code's requests arrive with `pathname = /v1/messages`. `AnthropicCompatibleProvider.buildUrl()` deduplicates only when `pathname` starts with the base URL's path component (`/api/v1`). The path `/v1/messages` does NOT start with `/api/v1`, so deduplication does not fire. Final URL: `https://openrouter.ai/api/v1/v1/messages`. OpenRouter returns 404 for all requests.

**Why it happens:**
`OpenRouterProvider` has an explicit `buildUrl()` override that strips a leading `/v1` from `pathname` (lines 56–69). This override exists precisely for this case. The base class dedup logic is insufficient because it requires a full path prefix match (`/api/v1` vs `/v1`). A developer who does not study `OpenRouterProvider.buildUrl()` will assume the base class handles it.

**How to avoid:**
Copy the `buildUrl()` override from `OpenRouterProvider` verbatim:
```typescript
override buildUrl(pathname: string, search: string, account?: Account): string {
  const baseUrl = (account?.custom_endpoint || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const cleanPathname = pathname.startsWith("/v1") ? pathname.slice(3) : pathname;
  return `${baseUrl}${cleanPathname}${search}`;
}
```
Write a unit test at Phase 1: `provider.buildUrl("/v1/messages", "")` must return exactly `"https://openrouter.ai/api/v1/messages"`.

**Warning signs:**
- All requests to `openrouter-anthropic` accounts return HTTP 404 immediately on first test.
- Server logs show outgoing URL containing `/api/v1/v1/messages`.

**Phase to address:**
Phase 1 (Provider class) — blocks all functionality; must be caught by a unit test before the phase is complete.

---

### Pitfall 8: HTTP API handler reuses the existing /api/accounts/openrouter route instead of creating a dedicated one

**What goes wrong:**
The developer modifies the existing `createOpenRouterAccountAddHandler` to conditionally insert `provider: "openrouter-anthropic"` based on a body flag. Any missed `if` condition silently registers the account with `provider: "openrouter"`, causing the load balancer to route it to `OpenRouterProvider` (OAI-format) instead of `OpenRouterAnthropicProvider`. The 4-breakpoint `cache_control` injector fires on a passthrough-intent account. Requests fail intermittently with 400 cache-breakpoint errors.

**Why it happens:**
The new provider is similar to the existing one — same auth, same endpoint base. Modifying the existing handler looks faster than creating a new one.

**How to avoid:**
Create a dedicated `POST /api/accounts/openrouter-anthropic` route and handler modeled on `createOpenRouterAccountAddHandler` (line 3424 of `accounts.ts`). The only differences are: `provider` column value is `"openrouter-anthropic"`, and UI labels. Never modify an existing provider's handler to serve two providers — the risk of a missed string literal is too high.

**Warning signs:**
- Accounts added as `openrouter-anthropic` show `provider: "openrouter"` in the database.
- Dashboard account type shows "OpenRouter" instead of "OpenRouter (Anthropic Messages)".

**Phase to address:**
Phase 2 (Wiring / API).

---

### Pitfall 9: Fork patch annotations omitted and HIGH_RISK_FILES not updated

**What goes wrong:**
New fork-specific code in `accounts.ts`, `AccountListItem.tsx`, and `sse-rate-limit-sniffer.ts` does not have `// FORK PATCH:` comments. When `pre-merge-check.sh` runs before an upstream merge, only the five files in `HIGH_RISK_FILES` are surfaced. A future upstream change to `accounts.ts` (e.g. a new provider type) merges cleanly in git but silently drops the fork's `openrouter-anthropic` branch because the developer does not know to inspect that section.

**Why it happens:**
Developers annotate high-profile files (the provider class) but forget incidental changes to infrastructure files. The existing `HIGH_RISK_FILES` list in `pre-merge-check.sh` currently covers 5 files — none of which are `sse-rate-limit-sniffer.ts` or `AccountListItem.tsx`.

**How to avoid:**
- Every fork-specific change outside `openrouter-anthropic/` must have a `// FORK PATCH:` comment with a brief rationale.
- Extend `HIGH_RISK_FILES` in `.planning/scripts/pre-merge-check.sh` with:
  - `packages/cli-commands/src/commands/account.ts` (new mode union entries + handler)
  - `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` (provider gate extension)
  - `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` (ANTHROPIC_SHAPE_PROVIDERS extension)
- The new provider directory (`packages/providers/src/providers/openrouter-anthropic/`) is fork-only with no upstream counterpart — no conflict risk, does not need to be in `HIGH_RISK_FILES`.
- The `HIGH_RISK_FILES` update is a dedicated task at the end of Phase 2.

**Warning signs:**
- `git diff upstream/main -- packages/cli-commands/src/commands/account.ts` shows additions without `// FORK PATCH:` annotations.
- Post-upstream-merge: `bun run typecheck` fails with "missing union member `openrouter-anthropic`".

**Phase to address:**
Phase 2 (Wiring) — annotations added alongside wiring changes; `HIGH_RISK_FILES` update is the final task of Phase 2.

---

### Pitfall 10: Testing with Anthropic-routed models — account ban risk

**What goes wrong:**
The developer tests the new provider using a `claude-3-*` model via an OpenRouter key. OpenRouter routes the request to Anthropic. More critically: if `x-better-ccflare-account-id` is omitted, the load balancer may select the real `claude` account (Anthropic OAuth) and hit Anthropic directly — violating the ban-risk rule.

**Why it happens:**
The new provider speaks native Anthropic Messages format, so Claude models feel natural to test with. The tester forgets to force-route via `x-better-ccflare-account-id`.

**How to avoid:**
- Always use the `z-ai/glm-4.5-air:free` model (or another confirmed non-Anthropic OpenRouter model) during tests. Verify at Phase 1 that this model is available on the `/api/v1/messages` endpoint; if not, identify an alternative before writing tests.
- Always set `x-better-ccflare-account-id: <openrouter-anthropic-account-uuid>` on every test curl request.
- Start the test server on port 8081 (`bun start --serve --port 8081`), never on 8082 (production).
- Unit tests: use mock fetch — never call any live endpoint in `bun:test`.
- Reference test command:
  ```bash
  curl -X POST http://localhost:8081/v1/messages \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test" \
    -H "x-better-ccflare-account-id: <uuid>" \
    -d '{"model":"z-ai/glm-4.5-air:free","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
  ```

**Warning signs:**
- Test curl lacks `x-better-ccflare-account-id`.
- Model in test request is any `claude-*` slug.
- Proxy logs show the `claude` account as the selected account for a test request.

**Phase to address:**
All phases — standing constraint, not phase-specific. Must be the first item in every phase plan's "Testing" section.

---

### Pitfall 11: Test model not available on native /api/v1/messages endpoint

**What goes wrong:**
The developer uses `z-ai/glm-4.5-air:free` for tests because it is the established safe test model for the OAI-format OpenRouter provider. The native Anthropic Messages endpoint has different model support — some OpenRouter models are only routed via the OAI-format endpoint. If `z-ai/glm-4.5-air:free` is unavailable on `/api/v1/messages`, the request returns 404 or 422 from OpenRouter, making it appear as if the provider is broken when the model is the issue.

**Why it happens:**
The test model was chosen for the OAI-format `openrouter` provider. Availability is not automatically the same on the native Messages endpoint.

**How to avoid:**
Before writing tests, verify model availability on `/api/v1/messages`. Use a `provider.order` preference in the test account to constrain routing to a specific non-Anthropic provider (e.g. `{ order: ["ZhipuAI"] }`) to keep the request away from Anthropic's infrastructure. Document the chosen model in test file comments with a note explaining why it was selected. If `z-ai/glm-4.5-air:free` is confirmed unavailable, identify an alternative at Phase 1 start — do not discover this mid-implementation.

**Warning signs:**
- HTTP 422 "model not supported" or 404 from OpenRouter on test requests.
- The error looks identical to a routing misconfiguration.

**Phase to address:**
Phase 1 (Provider class) — identify and confirm the test model before writing tests.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Copy `extractUsageInfo` from `OpenRouterProvider` | Saves 20 lines of code | Reads OAI-format fields — cache tokens always 0; OAI-format `prompt_tokens` absent on this endpoint → null object errors | Never |
| Extend `OpenRouterProvider` instead of `AnthropicCompatibleProvider` | Inherits `buildUrl`, auth config, name | Also inherits 4-breakpoint `cache_control` injector; injector runs on passthrough provider → 400 errors | Never |
| Rely on base `buildUrl` path dedup | Saves 7 lines | Double-segment URL `/api/v1/v1/messages` — all requests 404 | Never |
| Use `estimateCostUSD()` for streaming cost | Non-null cost record | Potentially misleading dollar figures for real-money accounts until OpenRouter adds `cost` to SSE events | Acceptable if documented clearly and consistent with `OpenRouterProvider` behavior |
| Omit `// FORK PATCH:` on wiring changes | Faster first commit | Invisible to `pre-merge-check.sh`; silently dropped on upstream merge | Never for files under `packages/` |
| Skip `HIGH_RISK_FILES` update | Saves one file edit | Fork changes in newly-touched files go undetected at merge time | Never |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenRouter `/api/v1/messages` auth | `authHeader: "x-api-key"` (Anthropic-native default) | Must be `authHeader: "authorization"`, `authType: "bearer"` — OpenRouter uses `Authorization: Bearer`, identical to the existing `OpenRouterProvider` |
| Non-streaming response usage | Reading `usage.prompt_tokens` (OAI-format) | Read `usage.input_tokens` / `usage.output_tokens`; `prompt_tokens` does not exist on this endpoint |
| Non-streaming response cache fields | Reading `usage.prompt_tokens_details.cache_write_tokens` | Read `usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens` (top-level, Anthropic-native) |
| Streaming response cost | Reading `message_delta.usage.cost` | No `cost` field in any SSE event on this endpoint (confirmed from spec); only available in non-streaming JSON response |
| `openrouter_provider_preference` injection guard | `!body.provider` (falsy check) | Must use `!("provider" in body)` — preserves `body.provider = {}` which is a valid OpenRouter spec; `{}` is falsy, so the falsy check would re-inject over it |
| Provider registration completeness | Adding only to `providers/src/index.ts` | Must add to `PROVIDER_NAMES`, `PROVIDER_CONFIG`, all union types, CLI handler, HTTP handler, dashboard — see Pitfall 4 full list |
| `buildUrl` for `/v1/messages` path | Relying on `AnthropicCompatibleProvider.buildUrl()` dedup | Must override `buildUrl()` — base dedup requires the base path to be a prefix of the pathname; `/api/v1` is not a prefix of `/v1`, so dedup does not fire |

---

## "Looks Done But Isn't" Checklist

- [ ] **buildUrl:** `provider.buildUrl("/v1/messages", "")` returns exactly `"https://openrouter.ai/api/v1/messages"` (unit test asserts)
- [ ] **cache_control passthrough:** request body with 4 existing `cache_control` blocks exits `transformRequestBody()` with exactly 4 blocks — none added (unit test asserts)
- [ ] **cache token fields (non-streaming):** `extractUsageInfo()` populates `cache_creation_input_tokens` and `cache_read_input_tokens` from Anthropic-native field names (unit test with mock response)
- [ ] **streaming cost:** `extractStreamingUsage()` returns `costUsd: undefined` (not a value from `message_delta`) on a stream with no `cost` field (unit test with mock SSE)
- [ ] **cost on non-streaming:** `extractUsageInfo()` attaches `costUsd` from `usage.cost` when present (unit test with `usage.cost: 0.002` mock)
- [ ] **Provider registration complete:** `grep -rn '"openrouter"' packages/ --include="*.ts" | grep -v test | grep -v "openrouter-anthropic"` shows no unextended hits that should have a parallel entry
- [ ] **CLI mode works:** `bun run cli --add-account test --mode openrouter-anthropic --api-key sk-test` completes without falling through to interactive prompts
- [ ] **HTTP API route exists:** `POST /api/accounts/openrouter-anthropic` returns 200 and inserts `provider: "openrouter-anthropic"` (not `"openrouter"`) in the DB
- [ ] **Dashboard dialog:** Provider preferences button visible for `openrouter-anthropic` accounts in `AccountListItem`
- [ ] **SSE sniffer:** `createSseRateLimitSniffer({ provider: "openrouter-anthropic" })` fires on `overloaded_error` frames (unit test)
- [ ] **FORK PATCH annotations:** all fork-specific wiring changes in `accounts.ts`, `AccountListItem.tsx`, `sse-rate-limit-sniffer.ts` have `// FORK PATCH:` comments
- [ ] **HIGH_RISK_FILES extended:** `pre-merge-check.sh` has 3 new entries covering the wiring-change files
- [ ] **Test constraint:** every live test request uses `x-better-ccflare-account-id` + a non-Anthropic model; `claude` account was never selected during testing

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 — readFinalSseCost copied into streaming path | Phase 1: Provider class | Unit test: mock SSE stream with no `cost` field → `costUsd: undefined` returned |
| 2 — cache_control injector inherited from wrong parent | Phase 1: Provider class | Unit test: 4-block body → assert zero new blocks added |
| 3 — extractUsageInfo reads OAI-format cache fields | Phase 1: Provider class | Unit test: mock response with `cache_creation_input_tokens: 100` → asserted in returned object |
| 4 — Provider name missing from type/config sites | Phase 2: Wiring / CLI / API | Grep check passes; `bun run typecheck` passes; CLI add-account works; HTTP 200 on new route |
| 5 — Dashboard dialog gate not extended | Phase 3: Dashboard | Visual check; TypeScript union includes `"openrouter-anthropic"` in `AccountListItem` |
| 6 — SSE sniffer not extended for Anthropic-shape | Phase 2: Wiring | Unit test: provider `"openrouter-anthropic"` sniffer fires on `overloaded_error` |
| 7 — buildUrl double-segment | Phase 1: Provider class | Unit test: `buildUrl("/v1/messages", "")` returns `"https://openrouter.ai/api/v1/messages"` |
| 8 — HTTP handler reuses existing route | Phase 2: Wiring / API | DB inspection: `provider` column is `"openrouter-anthropic"` after account creation |
| 9 — Fork annotations omitted; HIGH_RISK_FILES not updated | Phase 2: Wiring (final task) | `pre-merge-check.sh` covers 3 new files; all wiring changes have `// FORK PATCH:` annotations |
| 10 — Testing with Anthropic-routed models (ban risk) | All phases (standing constraint) | Every test request has `x-better-ccflare-account-id`; model is non-Anthropic |
| 11 — Test model unavailable on native endpoint | Phase 1: Provider class (setup step) | Confirm model availability before writing tests; document chosen model in test file |

---

## Sources

- `packages/providers/src/providers/openrouter/provider.ts` — codebase inspection, HIGH confidence
- `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` — codebase inspection, HIGH confidence
- `packages/proxy/src/usage-extraction.ts` — codebase inspection, HIGH confidence
- `packages/proxy/src/post-processor.worker.ts` — codebase inspection, HIGH confidence
- `packages/types/src/provider-config.ts` — codebase inspection, HIGH confidence
- `packages/types/src/account.ts` — codebase inspection, HIGH confidence
- `packages/cli-commands/src/commands/account.ts` — codebase inspection, HIGH confidence
- `packages/http-api/src/handlers/accounts.ts` — codebase inspection, HIGH confidence
- `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` — codebase inspection, HIGH confidence
- `packages/providers/src/providers/anthropic-compatible/provider.ts` — codebase inspection, HIGH confidence
- `.planning/research/STACK.md` — sibling STACK researcher, HIGH confidence (OpenRouter OpenAPI spec `MessagesDeltaEvent` schema confirming no `cost` field in SSE; `AnthropicUsage` schema confirming Anthropic-native cache field names)
- `.planning/scripts/pre-merge-check.sh` — codebase inspection, HIGH confidence
- `.planning/PROJECT.md` — codebase inspection, HIGH confidence

---
*Pitfalls research for: Adding openrouter-anthropic provider to better-ccflare fork (v1.3)*
*Researched: 2026-06-02*
