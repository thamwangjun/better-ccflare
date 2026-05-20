---
phase: 04-cache-extension-provider-injection
verified: 2026-05-20T10:00:00Z
status: gaps_found
score: 2/4 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Tools and system blocks carry ttl: '1h'; user message and last assistant turn blocks carry { type: 'ephemeral' } (5-min)"
    status: failed
    reason: "injectSystemCacheTtl() in proxy.ts only injects ttl: '1h' on system blocks — tools are deliberately left with { type: 'ephemeral' } only. This contradicts the ROADMAP success criterion wording ('Tools and system blocks carry ttl: \"1h\"') but matches the authoritative RESEARCH.md D-02 decision ('system blocks only'). The ROADMAP SC text is inaccurate against the implemented design."
    artifacts:
      - path: "packages/proxy/src/proxy.ts"
        issue: "injectSystemCacheTtl() guards on Array.isArray(body.system) only — no tools[] TTL injection path exists anywhere"
      - path: "packages/providers/src/providers/openrouter/__tests__/provider.test.ts"
        issue: "CACHE-04 scope test confirms tools have no ttl field — this is coded as expected behavior, but it contradicts the ROADMAP SC"
    missing:
      - "Either: (a) extend injectSystemCacheTtl() to also apply ttl: '1h' to tools[] blocks with cache_control, and add a test for it — OR (b) correct the ROADMAP SC2 to match the implemented behavior (system-only TTL) so the success criterion is accurate"

  - truth: "Regression tests cover correct behavior across all model types without a model-prefix gate"
    status: failed
    reason: "Every new test in provider.test.ts uses anthropic/* prefixed models. No test verifies that cache injection applies to non-anthropic model identifiers (e.g., openai/gpt-4o, mistralai/mistral-large). While the implementation has no model-prefix gate in the code, the CACHE-05 requirement explicitly calls for 'correct behavior across all model types (no model-prefix gate)' test coverage."
    artifacts:
      - path: "packages/providers/src/providers/openrouter/__tests__/provider.test.ts"
        issue: "All 16 transformRequestBody tests use model: 'anthropic/claude-sonnet-4-6' — no non-anthropic model tested"
    missing:
      - "Add at least one test case that uses a non-anthropic model (e.g., openai/gpt-4o or mistralai/*) and verifies that cache_control injection still occurs — proving there is no model-prefix gate"
---

# Phase 4: Cache Extension & Provider Injection Verification Report

**Phase Goal:** OpenRouter requests use extended cache breakpoints with correct TTL per block type, and the proxy injects the account's stored provider preference when no provider override is already present in the request
**Verified:** 2026-05-20T10:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | A request with 4 eligible content blocks receives exactly 4 `cache_control` blocks — the proxy never injects a 5th | VERIFIED | `countExistingCacheControlBlocks()` pre-counts; `remaining` variable guards all 4 injection sites; test "count guard: stops at 4" passes (20/20 tests green) |
| SC2 | Tools and system blocks carry `ttl: "1h"`; user message and last assistant turn blocks carry `{ type: "ephemeral" }` (5-min) | FAILED | `injectSystemCacheTtl()` only injects `ttl: "1h"` on system blocks (guards with `Array.isArray(body.system)`); tools blocks are left with `{ type: "ephemeral" }` only; CACHE-04 test explicitly validates tool blocks have no TTL — contradicts ROADMAP SC2 wording; RESEARCH.md D-02 documents this as intentional (system-only TTL) |
| SC3 | When an account has `openrouter_provider_preference` set, the proxy injects `provider.order` with `allow_fallbacks: true`; when the incoming request already contains a `provider` field, it is left untouched | VERIFIED | Field-presence check `"provider" in body` implemented; `allow_fallbacks ?? true` nullish coalescing; 3 PROV-01 tests pass (inject, client-wins, allow_fallbacks default) |
| SC4 | Regression tests cover: 4th breakpoint injection, count guard (no inject when already at 4), TTL split, and correct behavior across all model types without a model-prefix gate | FAILED | 4th breakpoint: 2 tests pass. Count guard: 2 tests pass. TTL split: tool-TTL isolation test passes but no test verifies system blocks receive `ttl: "1h"` via the full transform+injectSystemCacheTtl pipeline. No model-prefix gate test: all 16 transformRequestBody tests use `anthropic/claude-sonnet-4-6` only — no non-anthropic model tested. |

**Score:** 2/4 truths verified

---

### Root Cause Grouping

**Gap Group A — TTL split coverage (SC2 + SC4 partial)**
SC2 and the TTL portion of SC4 share the same root cause: the ROADMAP success criterion says "tools AND system carry `ttl: '1h'`" but the design decision D-02 (RESEARCH.md, CONTEXT.md) says TTL is only injected into system blocks. The test suite was written to match D-02 (correct per design), not SC2 (incorrect wording). This is a planning-documentation inconsistency. The implementation is coherent with D-02. Resolution options: fix the ROADMAP SC or extend the implementation to match the SC.

**Gap Group B — Model-type test coverage (SC4 partial)**
The `transformRequestBody()` implementation has no model-prefix gate — cache injection is unconditional. But CACHE-05 requires a test that proves this. One non-anthropic model test case would close this gap.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/database/src/migrations-pg.ts` | `openrouter_provider_preference` in CREATE TABLE and columnsToAdd | VERIFIED | Line 78: `openrouter_provider_preference TEXT DEFAULT NULL`; line 363-365: columnsToAdd entry with ALTER TABLE definition; FORK PATCH annotation at line 360 |
| `packages/types/src/account.ts` | `AccountResponse.openrouterProviderPreference: { order: string[]; allowFallbacks: boolean } | null` and updated `toAccountResponse()` | VERIFIED | Line 217-219: structured type; lines 412-415: `Array.isArray(parsed.order)` + `allow_fallbacks ?? true` |
| `packages/http-api/src/handlers/accounts.ts` | Updated IIFE parse returning structured object | VERIFIED | Line 509-520: IIFE with `Array.isArray(parsed.order)` and `allow_fallbacks ?? true` |
| `packages/providers/src/providers/openrouter/provider.ts` | Updated `transformRequestBody()` with count guard, non-destructive retrofit, 4th breakpoint, provider injection | VERIFIED | `countExistingCacheControlBlocks()` helper at lines 10-39; count guard at line 83; 4th breakpoint at lines 157-188; provider injection at lines 192-207; 6 FORK PATCH annotations |
| `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | 10 new test cases (20 total) | VERIFIED | 575 lines; 20 tests pass (0 fail); covers 4th breakpoint, count guard, non-destructive guard, PROV-01, tool TTL isolation |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `provider.ts` — `countExistingCacheControlBlocks()` | `transformRequestBody()` count guard | `remaining = Math.max(0, 4 - countExistingCacheControlBlocks(body))` | WIRED | Module-level function called at line 83; `remaining > 0` guards all 4 breakpoints |
| `provider.ts` — provider injection block | `account.openrouter_provider_preference` | `account?.openrouter_provider_preference && !("provider" in body)` | WIRED | Field-presence check at line 193; JSON.parse in try/catch at line 195 |
| `migrations-pg.ts` — `ensureSchemaPg()` | `migrations-pg.ts` — `runMigrationsPg()` columnsToAdd | Both paths include `openrouter_provider_preference TEXT DEFAULT NULL` | WIRED | CREATE TABLE line 78 + columnsToAdd lines 360-365 |
| `account.ts` — `AccountResponse.openrouterProviderPreference` | `accounts.ts` — IIFE parse site | Both use `Array.isArray(parsed.order)` + `allow_fallbacks ?? true` | WIRED | Type declared line 217; accounts.ts IIFE at line 509; both sites use identical guard and default logic |
| `provider.ts` — `transformRequestBody()` | `proxy.ts` — `injectSystemCacheTtl()` | Called at proxy.ts line 203 after transform | WIRED | `injectSystemCacheTtl()` runs after `transformRequestBody()` in the proxy pipeline; upgrades system blocks only (no tools path) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `provider.ts` — transformRequestBody provider injection | `account.openrouter_provider_preference` | `Account` object passed from proxy via `handleProxy()` → `transformRequestBody(request, account)` | Yes — reads from DB-backed `Account` type; field is TEXT column populated by account CRUD | FLOWING |
| `provider.ts` — transformRequestBody cache injection | `body` (parsed request JSON) | Client request body parsed from `mapped.clone().json()` | Yes — real client request body, not mocked | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 20 provider tests pass | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | 20 pass, 0 fail | PASS |
| Phase 3+4.01 tests still green | `bun test packages/database/src/.../account-openrouter-preference.test.ts packages/types/src/.../account-mappers.test.ts` | 11 pass, 0 fail | PASS |
| TypeCheck passes (excluding pre-existing inline-worker errors) | `bunx tsc --noEmit` | 2 errors only: `inline-integrity-check-worker` and `inline-incremental-vacuum-worker` — both are auto-generated files excluded by CLAUDE.md, not introduced by Phase 4 | PASS |
| inject-system-cache-ttl tests | `bun test packages/proxy/src/__tests__/inject-system-cache-ttl.test.ts` | 0 pass, 1 fail — pre-existing failure: `Cannot find module './inline-integrity-check-worker'` (auto-generated file absent from worktree) | SKIP (pre-existing, not Phase 4 regression) |
| Field-presence check (not truthiness) | `grep '"provider" in body' provider.ts` | Match at line 193 | PASS |
| Nullish coalescing (not OR) | `grep 'allow_fallbacks ?? true' provider.ts` | Match at line 199 | PASS |
| No TTL injected by transformRequestBody | `grep 'ttl:' provider.ts` (excluding comments) | 0 results | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CACHE-03 | 04-02, 04-03 | 4th cache breakpoint (last user message) with count guard never exceeding 4 total | SATISFIED | `transformRequestBody()` Breakpoint 4 implemented; 4 test cases covering 4th breakpoint injection and count guard pass |
| CACHE-04 | 04-02, 04-03 | TTL split: tools/system get `ttl: "1h"`; user/assistant get `{ type: "ephemeral" }` | BLOCKED | `injectSystemCacheTtl()` only applies to system blocks — tools do not receive `ttl: "1h"`. RESEARCH.md D-02 documents this as intentional, but ROADMAP SC2 says otherwise. The requirement as written in REQUIREMENTS.md is unmet for the tools-TTL half. |
| CACHE-05 | 04-02, 04-03 | Regression tests covering 4th breakpoint, count guard, TTL split, all model types | BLOCKED | 4th breakpoint and count guard covered. TTL split: no integration test of system-blocks getting `ttl: "1h"` after full pipeline. No test with non-anthropic model prefix to prove no model gate. |
| PROV-01 | 04-01, 04-03 | Proxy injects `body.provider` from account preference when no `provider` field present | SATISFIED | Field-presence check, nullish coalescing, try/catch fail-open — all implemented and tested; 3 passing test cases |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | All transformRequestBody tests use `anthropic/claude-sonnet-4-6` — no non-anthropic model tested | Warning | Does not prove absence of model-prefix gate; CACHE-05 requires this coverage |

No stubs, placeholder implementations, or disconnected wiring found in Phase 4 code.

---

### Human Verification Required

None — all gaps are programmatically verifiable.

---

### Gaps Summary

Two gaps block full goal achievement:

**Gap 1 — SC2 / CACHE-04: TTL behavior mismatch between ROADMAP and implementation**

The ROADMAP success criterion states "Tools and system blocks carry `ttl: '1h'`". The implementation only applies `ttl: "1h"` to system blocks (`injectSystemCacheTtl()` is system-only). Tools carry `{ type: "ephemeral" }` only. The RESEARCH.md D-02 decision documents this as intentional: "TTL management is the exclusive responsibility of `injectSystemCacheTtl()` path in proxy.ts... system blocks only". The CACHE-04 test explicitly validates the tools-no-TTL behavior as correct.

This is a planning document inconsistency (ROADMAP SC says tools get 1h, design says they don't). The implementation is self-consistent with its design decisions. Resolution requires choosing one of two paths: (a) extend `injectSystemCacheTtl()` to also inject `ttl: "1h"` into tools[] with `cache_control`, or (b) update the ROADMAP SC to correctly state "system blocks carry `ttl: '1h'`; tools, user message, and last assistant turn carry `{ type: 'ephemeral' }`".

**Gap 2 — SC4 / CACHE-05: No non-anthropic model test for model-prefix gate proof**

CACHE-05 requires "correct behavior across all model types (no model-prefix gate)". The implementation has no gate — cache injection is unconditional. But no test uses a non-anthropic model identifier. One additional test case (e.g., `model: "openai/gpt-4o"` or `model: "mistralai/mistral-large"`) verifying that cache_control is injected proves the absence of a model gate.

These two gaps are related (both under CACHE-05 / SC4 partial) but have separate root causes. Gap 1 requires either a design decision revision or an implementation extension. Gap 2 requires adding one test case.

---

_Verified: 2026-05-20T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
