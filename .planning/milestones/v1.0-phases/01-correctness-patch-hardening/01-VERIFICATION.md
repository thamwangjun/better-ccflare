---
phase: 01-correctness-patch-hardening
verified: 2026-05-04T10:10:59Z
status: human_needed
score: 3/4 must-haves verified
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Send a request with a non-Anthropic model (e.g., z-ai/glm-4.5-air:free or openai/gpt-4o) via the proxy to an OpenRouter account and confirm it completes without a 400 error and that cache headers are not silently dropped"
    expected: "The request completes with a 2xx response. No HTTP 400 errors. The cache_control fields injected per-block are forwarded to OpenRouter without causing rejection."
    why_human: "Cannot verify live API behavior without making real upstream network calls. The implementation applies cache_control to all models without prefix gating (D-04), which satisfies ROADMAP SC-2's intent. Whether OpenRouter silently drops or rejects these blocks for non-Anthropic models requires a real request."
---

# Phase 1: Correctness & Patch Hardening — Verification Report

**Phase Goal:** The proxy accurately reports OpenRouter cache token costs and all fork patches are identifiable and test-covered so they survive upstream merges without silent regression.
**Verified:** 2026-05-04T10:10:59Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | A non-streaming OpenRouter response shows non-zero cache write token counts in usage stats | VERIFIED | `extractUsageInfo` override reads `usage.prompt_tokens_details.cache_write_tokens` (line 154 of `openrouter/provider.ts`). Test asserts `usage?.cacheCreationInputTokens === 50` when `cache_write_tokens: 50` is present — 10/10 tests pass. |
| SC-2 | Sending a request to a non-Anthropic model via OpenRouter completes without 400 errors or silently dropped cache headers | HUMAN NEEDED | Implementation applies `cache_control` per-block with no model-prefix gating (D-04). Whether non-Anthropic models (e.g., GPT-4, Gemini) receive these blocks without 400 errors or silent drops requires a live API call. Tests only cover `anthropic/claude-sonnet-4-6` model strings. |
| SC-3 | The `cache_write_tokens` extraction line in `openai/provider.ts` carries a `// FORK PATCH:` comment | VERIFIED | Line 262 of `openai/provider.ts`: `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)` immediately above `const cacheCreationInputTokens =`. Confirmed by `grep -A1`. Exactly 1 line added per commit `372e085`. |
| SC-4 | Running `bun test` fails immediately if the non-streaming cache token extraction patch is removed or regressed | VERIFIED | Test `"reads cache_write_tokens from prompt_tokens_details as cacheCreationInputTokens"` calls `provider.extractUsageInfo()` with `cache_write_tokens: 50` in `prompt_tokens_details` and asserts `cacheCreationInputTokens === 50`. If the override is removed, the inherited `BaseAnthropicCompatibleProvider.extractUsageInfo()` reads `cache_creation_input_tokens` (absent in the test fixture), returning 0 — the assertion fails. All 10 tests pass. |

**Score:** 3/4 truths verified (1 requires human testing)

### Deferred Items

None identified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/providers/src/providers/openrouter/provider.ts` | OpenRouterProvider with `extractUsageInfo` override (CACHE-01) and 3-breakpoint `transformRequestBody` (CACHE-02) | VERIFIED | File exists, 174 lines. Contains `extractUsageInfo` override (line 118), `prompt_tokens_details` read (line 146), `cache_write_tokens` read (line 154), 7 `cache_control` occurrences, no `body.cache_control = ...` top-level injection. |
| `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | Per-block CACHE-02 assertions + PATCH-02 extractUsageInfo regression guard | VERIFIED | File exists, 241 lines. Contains `extractUsageInfo` describe block (line 8), `cacheCreationInputTokens` assertion (line 30), `toBeUndefined()` for top-level cache_control (line 216), no old `result.cache_control).toEqual({ type: "ephemeral" })` assertions. |
| `packages/providers/src/providers/openai/provider.ts` | FORK PATCH comment on `cacheCreationInputTokens` line | VERIFIED | File exists. Line 262: `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)` immediately above `const cacheCreationInputTokens =` (line 263). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `OpenRouterProvider.extractUsageInfo` | `usage.prompt_tokens_details.cache_write_tokens` | direct field read | WIRED | Lines 146–154 of `openrouter/provider.ts`: declares `promptTokensDetails` from `json.usage.prompt_tokens_details`, reads `.cache_write_tokens` to produce `cacheCreationInputTokens`. |
| `OpenRouterProvider.transformRequestBody` | `body.tools / body.system / body.messages` | per-block mutation | WIRED | Lines 46–98 of `openrouter/provider.ts`: three distinct blocks mutate `body.tools`, `body.system`, and `body.messages`. All return via `new Request(...)` with mutated body. |
| `upstream merge reviewer` | `openai/provider.ts` cacheCreationInputTokens line | `// FORK PATCH:` comment | WIRED | Line 262 adjacent to line 263. Comment appears in `git diff` output (commit `372e085`). |
| `OpenRouterProvider.extractUsageInfo regression guard test` | `OpenRouterProvider.extractUsageInfo` override | direct method call | WIRED | Test calls `provider.extractUsageInfo(response)` (line 27 of test file) and asserts `usage?.cacheCreationInputTokens === 50`. The method is correctly dispatched to the override in `openrouter/provider.ts`. |

### Data-Flow Trace (Level 4)

Not applicable — these are provider utility methods (not components rendering dynamic data). The key data flow is usage extraction → return value → caller (billing display), which is verified by the regression guard tests.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `extractUsageInfo` returns cacheCreationInputTokens=50 for cache_write_tokens=50 | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | 10 pass, 0 fail | PASS |
| No top-level `body.cache_control` in transformed request | test "does NOT have a top-level cache_control key" | `result.cache_control` is `undefined` | PASS |
| Last tool gets `cache_control: {type:"ephemeral"}` | test "injects cache_control on the last tool" | First tool undefined, last tool `{type:"ephemeral"}` | PASS |
| String system converted to array with cache_control | test "converts string system to array" | array with `cache_control` on single block | PASS |
| FORK PATCH comment present and adjacent to declaration | `grep -A1 "FORK PATCH" openai/provider.ts` | `const cacheCreationInputTokens =` on next line | PASS |
| Non-Anthropic model request completes without 400 | requires live API call | — | SKIP (human needed) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CACHE-01 | 01-01-PLAN.md | Non-streaming OpenRouter responses report accurate cache token counts | SATISFIED | `extractUsageInfo` override reads `prompt_tokens_details.cache_write_tokens`; regression guard test asserts correct value. |
| CACHE-02 | 01-01-PLAN.md, 01-03-PLAN.md | `cache_control` ephemeral injection per-block (last system, last tool, last assistant turn) | SATISFIED (with note) | Per-block injection at 3 breakpoints implemented and tested. Note: REQUIREMENTS.md CACHE-02 says "gated on anthropic/* model prefix" but the ROADMAP SC-2 and PLAN D-04 both require no model-prefix gating — the implementation (no gating) correctly satisfies the ROADMAP contract. The REQUIREMENTS.md wording is inconsistent with the ROADMAP. |
| PATCH-01 | 01-02-PLAN.md | `// FORK PATCH:` comment on `cache_write_tokens` extraction line in `openai/provider.ts` | SATISFIED | Line 262 of `openai/provider.ts`, immediately above `const cacheCreationInputTokens =`. Visible in git diff. |
| PATCH-02 | 01-03-PLAN.md | Unit test covers OpenRouter non-streaming cache token extraction; fails if patch removed | SATISFIED | 4 tests in `extractUsageInfo` describe block. Regression guard (test "reads cache_write_tokens...") will fail if override is removed because inherited method reads the absent `cache_creation_input_tokens` field. |

**Orphaned requirements:** MAINT-01, MAINT-02, MAINT-03 are mapped to Phase 2 in REQUIREMENTS.md — not orphaned in Phase 1. No Phase 1-mapped requirements are missing from plans.

**REQUIREMENTS.md discrepancy (CACHE-02):** The REQUIREMENTS.md definition of CACHE-02 states "gated on anthropic/* model prefix." The ROADMAP success criteria (SC-2) states the opposite intent: non-Anthropic models must complete without errors. The PLAN decision D-04 explicitly chose no model-prefix gating. The implementation matches the ROADMAP (authoritative) and PLAN, not the literal REQUIREMENTS.md wording. This is an inconsistency in REQUIREMENTS.md, not a gap in implementation.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No `TODO`, `FIXME`, empty returns, or placeholder patterns detected in any modified file.

### Human Verification Required

#### 1. Non-Anthropic Model Request Completes Without 400 Error (SC-2)

**Test:** Using a non-Anthropic account (e.g., an OpenRouter account with `z-ai/glm-4.5-air:free`), send a request via the proxy:

```bash
curl -X POST http://localhost:8081/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d '{"model":"z-ai/glm-4.5-air:free","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

**Expected:** HTTP 2xx response. No `400 Bad Request`. The `cache_control` per-block injection on the request body does not cause OpenRouter to reject the request for non-Anthropic model strings.

**Why human:** Cannot make real upstream API calls during verification. The implementation injects `cache_control` blocks for all models (no prefix gating per D-04). Whether OpenRouter silently drops or forwards these fields for non-Anthropic models requires a live test against the real OpenRouter API.

### Gaps Summary

No implementation gaps found. All artifacts exist, are substantive, and are correctly wired. All tests pass (10/10). SC-1, SC-3, and SC-4 are fully verified.

SC-2 requires one human spot-check (live API call with a non-Anthropic model) to confirm that injecting per-block `cache_control` does not cause 400 errors. This is behavioral verification that cannot be automated without real API access.

Additionally, REQUIREMENTS.md CACHE-02 wording ("gated on anthropic/* model prefix") is inconsistent with ROADMAP SC-2 and PLAN D-04. The implementation correctly follows the ROADMAP. Consider updating REQUIREMENTS.md CACHE-02 to remove the "gated on anthropic/* model prefix" clause and replace it with "applied per-block with no model-prefix gating."

---

_Verified: 2026-05-04T10:10:59Z_
_Verifier: Claude (gsd-verifier)_
