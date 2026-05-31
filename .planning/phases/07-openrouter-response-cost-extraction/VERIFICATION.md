---
phase: 07-openrouter-response-cost-extraction
verified: 2026-05-31T00:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 7: OpenRouter Response Cost Extraction Verification Report

**Phase Goal:** OpenRouter responses (streaming and non-streaming) yield actual USD cost from the provider's `usage.cost` field, making it available downstream.
**Verified:** 2026-05-31
**Status:** passed
**Re-verification:** No — independent verification (prior VERIFICATION.md had no `gaps:` section; treated as initial)

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Non-streaming OpenRouter requests have `usage.cost` extracted from response JSON and returned as `costUsd` in `extractUsageInfo()` | ✓ VERIFIED | `packages/providers/src/providers/openrouter/provider.ts:273-274` — `const costUsd = typeof json.usage.cost === "number" ? json.usage.cost : undefined;`; returned in the result object at `:283`. Return type already declares `costUsd?: number` at `:232`. The non-streaming branch is reached only after `if (!json.usage) return null;` (`:253`), and the streaming branch is delegated to the parent (`:243-248`). Integration test calls the REAL `OpenRouterProvider` and asserts `usage?.costUsd` for present (0.0012), null, absent, zero, and string-type-confusion cases (`__tests__/provider.test.ts:115-217`). |
| 2 | SSE streaming OpenRouter requests have `usage.cost` extracted from the final SSE chunk and surfaced to the post-processor worker | ✓ VERIFIED | `post-processor.worker.ts:378-381` — inside the `isMessageDelta` → `if (parsed.usage)` block, `if (typeof parsed.usage.cost === "number") { state.usage.providerCostUsd = parsed.usage.cost; }`. Wiring: `processSSELine` (`:283`) calls `extractUsageFromData` only when `shouldParseSSEData` allows the event; `message_delta` is in that allowlist (`:258`). `message_delta` is the terminal usage-bearing SSE event (carries final `output_tokens`), satisfying "final SSE chunk." Tests `sse-parsing.test.ts:146-171` (present/absent/null). |
| 3 | Non-streaming OpenRouter response bodies processed by the post-processor worker have `usage.cost` read from response JSON | ✓ VERIFIED | `post-processor.worker.ts:314-317` — `if (typeof usageObj.cost === "number") { state.usage.providerCostUsd = usageObj.cost; }`; `cost?: number` added to the `usage` type annotation at `:296`. Wiring: `handleEnd` decodes the base64 response body and calls `extractUsageFromJson(json, state)` at `:651` for non-stream responses. Tests `extract-usage-from-json.test.ts:55-110` (present/absent/no-usage/zero/gating). |
| 4 | Cost extraction does NOT break non-OpenRouter providers (Anthropic, Bedrock, Qwen, etc. continue to function) | ✓ VERIFIED | grep for `usage.cost` extraction in base classes `base-anthropic-compatible.ts` and `openai/provider.ts` returns zero matches (exit 1) — these classes never read `usage.cost`. (Note: they DO reference `costUsd` via the pre-existing `estimateCostUSD()` path — that is the legacy estimate, not OpenRouter extraction.) For non-OR providers `usage.cost` is absent → `typeof undefined === "number"` is false → `providerCostUsd` stays undefined → `handleEnd():678` falls through to the unchanged `estimateCostUSD()` branch (`:681-687`). Full phase suite 44 pass / 0 fail (this run); task context reports full repo 735 pass / 0 fail. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/providers/src/providers/openrouter/provider.ts` | costUsd extraction in extractUsageInfo() | ✓ VERIFIED | Exists, substantive, wired. `costUsd` const (`:273-274`) + return (`:283`). `extractUsageInfo` is an `override` consumed by the proxy response path. |
| `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | COST-01 test coverage | ✓ VERIFIED | 5 `costUsd` assertions (`:134,:155,:175,:196,:217`). Calls the REAL provider — true integration coverage. |
| `packages/proxy/src/post-processor.worker.ts` | providerCostUsd field + SSE/JSON extraction + handleEnd gating | ✓ VERIFIED | `providerCostUsd` appears in exactly the 4 expected logical sites: interface (`:48`), `extractUsageFromJson` (`:316`), `extractUsageFromData` (`:380`), `handleEnd` gating (`:678-679`). Both extractors wired (`:283` SSE, `:651` JSON). |
| `packages/proxy/src/__tests__/sse-parsing.test.ts` | COST-02 SSE coverage | ✓ VERIFIED | `providerCostUsd` assertions `:146-171`. Uses an INLINE copy of the function (`:85-87`) that mirrors the real guard verbatim. |
| `packages/proxy/src/__tests__/extract-usage-from-json.test.ts` | COST-03 JSON coverage | ✓ VERIFIED | Created; 5 tests incl. gating-pattern (`:55-110`). Uses an INLINE copy (`:42-44`) mirroring the real implementation. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| openrouter/provider.ts extractUsageInfo() | json.usage.cost | typeof guard, non-streaming path | ✓ WIRED | `provider.ts:273-274` → returned `:283` |
| processSSELine → extractUsageFromData() message_delta | state.usage.providerCostUsd | typeof parsed.usage.cost guard | ✓ WIRED | called `:283`; `message_delta` allowed `:258`; assign `:378-381` |
| handleEnd body-decode → extractUsageFromJson() | state.usage.providerCostUsd | typeof usageObj.cost guard | ✓ WIRED | called `:651`; assign `:314-317` |
| handleEnd() cost calc | state.usage.costUsd | if providerCostUsd set use it, else estimateCostUSD() | ✓ WIRED | `:678-687` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| COST-01 | 07-01 | OpenRouter extractUsageInfo() reads usage.cost, returns costUsd | ✓ SATISFIED | provider.ts:273-283 + 5 real-provider tests |
| COST-02 | 07-02 | Worker reads usage.cost from SSE final chunk and response JSON | ✓ SATISFIED | worker:378-381 (SSE) + 314-317 (JSON) + tests |
| COST-03 | 07-02 | Skip estimateCostUSD() when provider costUsd available | ✓ SATISFIED | worker:678-687 handleEnd gating |
| COST-04 | — | cost_usd column persistence | DEFERRED | Scoped to Phase 8 per ROADMAP/PROJECT; not a Phase 7 gap |

### Anti-Patterns Found

None. No TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER markers in either modified source file (grep exit 1). Generated files `inline-worker.ts`, `inline-vacuum-worker.ts`, `inline-integrity-check-worker.ts` confirmed untouched in `git diff 4132b386 HEAD` (grep exit 1). Modified-file diffs: provider.ts +6, post-processor.worker.ts +29/-6 — substantive, plan-consistent.

### Disconfirmation Pass (Confirmation Bias Counter)

1. **Partially-met requirement check — inline-copy test risk (WARNING):** The COST-02 (SSE) and COST-03 (JSON) tests assert against INLINE COPIES of `extractUsageFromData`/`extractUsageFromJson` (`sse-parsing.test.ts:85-87`, `extract-usage-from-json.test.ts:42-44`), NOT the production functions exported from `post-processor.worker.ts`. A future drift between the inline copy and the real worker would not be caught by these tests. Mitigation applied during verification: I read the REAL worker source directly (`:314-317`, `:378-381`, `:678-687`) and confirmed the inline copies replicate the same `typeof` guard and assignment verbatim. Criterion 1 additionally has TRUE integration coverage (instantiates the real `OpenRouterProvider`). The behavior is genuinely present in production code; the test-structure limitation does not invalidate the criteria. Logged as a non-blocking quality note.
2. **Test that passes but may not test stated behavior:** The inline-copy tests above pass but exercise a copy, not the shipped function — covered by point 1; production code independently confirmed.
3. **Uncovered error path:** `extractUsageFromJson`'s call site wraps decode/parse in `try { } catch { }` (`:648-654`) so a malformed body silently no-ops — pre-existing behavior, not introduced by this phase, and acceptable (cost simply falls back to estimate). The `extractUsageInfo` override also has a bare `catch { return null; }` (`:285-287`) — pre-existing, unchanged.
4. **Zero-cost edge:** `cost: 0` correctly sets `providerCostUsd = 0` (valid number, distinct from null/absent → undefined). Verified by dedicated tests in all three suites (`provider.test.ts:178`, `extract-usage-from-json.test.ts:84`).
5. **NaN edge (documented in threat model T-7-02/T-7-05):** `typeof NaN === "number"` is true, so a literal `NaN` cost would pass the guard. This is explicitly accepted in the plan threat model as a pre-existing concern shared with the estimate path, and OpenRouter does not emit NaN in JSON. Non-blocking.

### Human Verification Required

None. All criteria are verifiable via code inspection and passing unit tests. Live end-to-end USD flow into the DB belongs to Phase 8 / COST-04 and, if tested, MUST use a non-Anthropic account per CLAUDE.md.

### Gaps Summary

No gaps. All four success criteria are genuinely met in the codebase: provider-level extraction (criterion 1, with real-provider integration tests), SSE worker extraction (criterion 2), non-streaming worker extraction (criterion 3), and non-regression for other providers (criterion 4, confirmed by zero `usage.cost` reads in base classes and the undefined → `estimateCostUSD()` fallback). One WARNING-level quality note: COST-02/COST-03 unit tests exercise inline copies rather than the production worker functions; the production behavior was independently verified by direct source reading and is correct. COST-04 (DB persistence) is intentionally out of Phase 7 scope.

---

_Verified: 2026-05-31_
_Verifier: Claude (gsd-verifier)_
