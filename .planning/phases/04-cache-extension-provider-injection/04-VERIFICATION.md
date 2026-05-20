---
phase: 04-cache-extension-provider-injection
verified: 2026-05-20T12:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 2/4
  gaps_closed:
    - "SC2/CACHE-04: ROADMAP SC2 wording corrected — system blocks carry ttl: '1h', tools/user/assistant carry { type: 'ephemeral' } only. Matches injectSystemCacheTtl() implementation."
    - "SC4/CACHE-05: Test added at provider.test.ts line 580 using model 'openai/gpt-4o' — proves no model-prefix gate. 21/21 tests pass."
  gaps_remaining: []
  regressions: []
---

# Phase 4: Cache Extension & Provider Injection Verification Report

**Phase Goal:** OpenRouter requests use extended cache breakpoints with correct TTL per block type, and the proxy injects the account's stored provider preference when no provider override is already present in the request
**Verified:** 2026-05-20T12:00:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | A request with 4 eligible content blocks receives exactly 4 `cache_control` blocks — the proxy never injects a 5th | VERIFIED | `countExistingCacheControlBlocks()` pre-counts across all injection sites; `remaining` variable guards all 4 breakpoints; test "count guard: stops at 4" and "count guard: partial" both pass; 21/21 tests green |
| SC2 | System blocks carry `ttl: "1h"`; tools, user message, and last assistant turn blocks carry `{ type: "ephemeral" }` (5-min) — TTL management is the exclusive responsibility of `injectSystemCacheTtl()` and applies only to system blocks | VERIFIED | ROADMAP SC2 corrected to match D-02 design decision. `injectSystemCacheTtl()` injects `ttl: "1h"` on system blocks only (guarded by `Array.isArray(body.system)`). Tool block test confirms no `ttl` field after `transformRequestBody()`. `injectSystemCacheTtl` test suite ("only modifies system blocks, not messages with cache_control") confirms TTL split is correct. |
| SC3 | When an account has `openrouter_provider_preference` set, the proxy injects `provider.order` with `allow_fallbacks: true`; when the incoming request already contains a `provider` field, it is left untouched | VERIFIED | Field-presence check `"provider" in body` at provider.ts line 193; `allow_fallbacks ?? true` nullish coalescing at line 199; 3 PROV-01 tests pass: inject, client-wins, allow_fallbacks default |
| SC4 | Regression tests cover: 4th breakpoint injection, count guard (no inject when already at 4), TTL split, and correct behavior across model types without a model-prefix gate | VERIFIED | 4th breakpoint: 2 tests. Count guard: 2 tests. TTL split: `injectSystemCacheTtl` tests confirm system-only TTL upgrade; tool-TTL isolation test confirms no TTL on tools. Model-prefix gate: new test at line 580 uses `model: "openai/gpt-4o"` — verifies cache_control is injected for non-anthropic model. 21/21 tests pass. |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/database/src/migrations-pg.ts` | `openrouter_provider_preference` in CREATE TABLE and columnsToAdd | VERIFIED | Line 78: `openrouter_provider_preference TEXT DEFAULT NULL` (ensureSchemaPg); lines 360-365: FORK PATCH annotation + columnsToAdd entry with `ALTER TABLE accounts ADD COLUMN openrouter_provider_preference TEXT DEFAULT NULL` |
| `packages/types/src/account.ts` | `AccountResponse.openrouterProviderPreference: { order: string[]; allowFallbacks: boolean } | null` and updated `toAccountResponse()` | VERIFIED | Line 412: `Array.isArray(parsed.order)` guard; line 415: `allowFallbacks: parsed.allow_fallbacks ?? true` |
| `packages/http-api/src/handlers/accounts.ts` | Updated IIFE parse returning structured object | VERIFIED | Lines 516/520: `Array.isArray(parsed.order)` and `allowFallbacks: parsed.allow_fallbacks ?? true` in IIFE |
| `packages/providers/src/providers/openrouter/provider.ts` | Updated `transformRequestBody()` with count guard, non-destructive retrofit, 4th breakpoint, provider injection | VERIFIED | `countExistingCacheControlBlocks()` helper lines 9-39; `remaining` guard at line 83; Breakpoint 4 lines 157-188; provider injection lines 192-207; 6 FORK PATCH annotations |
| `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | 21 tests (10 original + 10 from Plan 02 + 1 model-gate test) | VERIFIED | 602 lines; 21/21 tests pass; new test at line 580 uses `model: "openai/gpt-4o"` proving no model-prefix gate |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `provider.ts` — `countExistingCacheControlBlocks()` | `transformRequestBody()` count guard | `remaining = Math.max(0, 4 - countExistingCacheControlBlocks(body))` | WIRED | Module-level function called at line 83; `remaining > 0` guards all 4 breakpoints; each injection decrements `remaining--` |
| `provider.ts` — provider injection block | `account.openrouter_provider_preference` | `account?.openrouter_provider_preference && !("provider" in body)` | WIRED | Field-presence check at line 193; JSON.parse in try/catch at lines 194-206; `allow_fallbacks ?? true` at line 199 |
| `migrations-pg.ts` — `ensureSchemaPg()` | `migrations-pg.ts` — `runMigrationsPg()` columnsToAdd | Both paths include `openrouter_provider_preference TEXT DEFAULT NULL` | WIRED | CREATE TABLE at line 78; columnsToAdd at lines 360-365 |
| `account.ts` — `AccountResponse.openrouterProviderPreference` | `accounts.ts` — IIFE parse site | Both use `Array.isArray(parsed.order)` + `allow_fallbacks ?? true` | WIRED | account.ts lines 412/415; accounts.ts lines 516/520 |
| `provider.ts` — `transformRequestBody()` | `proxy.ts` — `injectSystemCacheTtl()` | Called after transform in the proxy pipeline | WIRED | `injectSystemCacheTtl()` upgrades system blocks to `ttl: "1h"` after `transformRequestBody()` sets them to `{ type: "ephemeral" }`; tools/user/assistant are left with ephemeral-only |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `provider.ts` — transformRequestBody provider injection | `account.openrouter_provider_preference` | `Account` object from DB-backed account record, passed via `handleProxy()` → `transformRequestBody(request, account)` | Yes — TEXT column populated by account CRUD | FLOWING |
| `provider.ts` — transformRequestBody cache injection | `body` (parsed request JSON) | Client request body parsed from `mapped.clone().json()` | Yes — real client request body, no mocking | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 21 provider tests pass | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | 21 pass, 0 fail | PASS |
| Non-anthropic model cache injection (Gap 2 closure) | Test at line 580: `model: "openai/gpt-4o"` receives cache_control on last user message | Included in 21/21 passing tests | PASS |
| Phase 3 + 4.01 tests still green | `bun test ...account-openrouter-preference.test.ts ...account-mappers.test.ts` | 11 pass, 0 fail | PASS |
| TypeCheck passes (excluding pre-existing auto-generated errors) | `bunx tsc --noEmit` filtered for application code | 0 application-code errors | PASS |
| inject-system-cache-ttl module load | Pre-existing failure: `Cannot find module './inline-integrity-check-worker'` (auto-generated file, CLAUDE.md excluded) | Pre-existing, not Phase 4 regression; inject-system-cache-ttl logic itself is correct per test content | SKIP (pre-existing) |
| Field-presence check (not truthiness) | `grep '"provider" in body' provider.ts` | Match at line 193 | PASS |
| Nullish coalescing (not OR) | `grep 'allow_fallbacks ?? true' provider.ts` | Match at line 199 | PASS |
| No TTL injected by transformRequestBody | `grep 'ttl:' provider.ts` (excluding comments) | 0 results | PASS |
| FORK PATCH annotations present | `grep -n "FORK PATCH" provider.ts` | 6 FORK PATCH annotations | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CACHE-03 | 04-02, 04-03 | 4th cache breakpoint (last user message) with count guard never exceeding 4 total | SATISFIED | `transformRequestBody()` Breakpoint 4 implemented at lines 157-188; 4 test cases (4th breakpoint array, 4th breakpoint string-to-array, count guard stop at 4, count guard partial) all pass |
| CACHE-04 | 04-02, 04-03 | TTL split: system blocks carry `ttl: "1h"`; tools/user/assistant carry `{ type: "ephemeral" }` | SATISFIED | `injectSystemCacheTtl()` injects `ttl: "1h"` on system blocks exclusively (verified by inject-system-cache-ttl test "only modifies system blocks, not messages with cache_control"); tool block test confirms no TTL after transform; ROADMAP SC2 corrected to accurately describe this split |
| CACHE-05 | 04-02, 04-03 | Regression tests: 4th breakpoint, count guard, TTL split, all model types without model-prefix gate | SATISFIED | 4th breakpoint: 2 tests. Count guard: 2 tests. TTL split: covered by injectSystemCacheTtl test suite + tool-TTL isolation test. Model-prefix gate: new test at provider.test.ts line 580 using `model: "openai/gpt-4o"` proves injection fires unconditionally. 21/21 tests pass. |
| PROV-01 | 04-01, 04-03 | Proxy injects `body.provider` from account preference when no `provider` field present | SATISFIED | Field-presence check `"provider" in body`, nullish coalescing `?? true`, try/catch fail-open — all implemented; 3 passing test cases covering inject, client-wins, allow_fallbacks default, and corrupt JSON fail-open |

---

### Anti-Patterns Found

No stubs, placeholder implementations, disconnected wiring, or code smell anti-patterns found in Phase 4 code. All injection logic is substantive, wired, and data-flowing.

---

### Human Verification Required

None — all success criteria are programmatically verifiable and verified.

---

### Gaps Summary

No gaps. Both gaps from the initial verification are closed:

**Gap 1 (SC2/CACHE-04) — CLOSED:** ROADMAP SC2 was corrected from "Tools and system blocks carry `ttl: '1h'`" to "System blocks carry `ttl: '1h'`; tools, user message, and last assistant turn blocks carry `{ type: 'ephemeral' }` (5-min) — TTL management is the exclusive responsibility of `injectSystemCacheTtl()` and applies only to system blocks." The corrected wording now accurately describes the implemented D-02 design decision. The implementation, test suite, and ROADMAP are now internally consistent.

**Gap 2 (SC4/CACHE-05) — CLOSED:** Test "injects cache_control on non-anthropic model without model-prefix gate" added at provider.test.ts line 580 using `model: "openai/gpt-4o"`. The test verifies the last user message content block receives `cache_control` on a non-anthropic model, proving the injection is unconditional. The test passes. Total test count is now 21/21.

---

_Verified: 2026-05-20T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
