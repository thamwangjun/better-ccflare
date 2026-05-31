---
phase: 08-real-cost-persistence
verified: 2026-05-31T14:10:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
---

# Phase 8: Real Cost Persistence — Verification Report

**Phase Goal:** Actual OpenRouter cost is persisted to the `requests` table instead of unreliable client-side estimates that return $0 for unknown models.
**Verified:** 2026-05-31T14:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When OpenRouter `costUsd` is available, `estimateCostUSD()` is skipped and the API value is used | VERIFIED | `post-processor.worker.ts:678-692` — `if (state.usage.providerCostUsd !== undefined) { state.usage.costUsd = providerCostUsd }` (real branch, no estimate call); `else` branch calls `estimateCostUSD`. Non-streaming/streaming extraction sets `providerCostUsd` at L316/L380. |
| 2 | `cost_usd` column contains real USD amounts from `usage.cost` for streaming and non-streaming | VERIFIED | Non-streaming: `provider.ts:274-275` extractUsageInfo reads `usage.cost`. Streaming: `provider.ts:295-329` `extractStreamingUsage` override + `readFinalSseCost` reads final SSE `message_delta usage.cost`. Persisted via `request.repository.ts:115` and `:158` `costUsd ?? null` (genuine 0 survives). |
| 3 | Non-OpenRouter providers continue using `estimateCostUSD()` with no regression | VERIFIED | Worker estimate branch (`worker.ts:685-691`) runs whenever `providerCostUsd === undefined` (all non-OpenRouter). `base-anthropic-compatible.ts` untouched by phase 08 (no phase-08 commits). Token columns retain `|| null` (D-03 scope). Estimate-$0 maps to undefined→null (no false 0). |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/providers/src/providers/openrouter/provider.ts` | extractStreamingUsage override | VERIFIED | L295-384: override + clone-before-delegate (L310) + typeof guard (L319) + readFinalSseCost. Wired — called by base streaming path via override. |
| `.../openrouter/__tests__/provider.test.ts` | streaming cost cases | VERIFIED | 8 matches for streaming markers; suite 31 pass / 0 fail. |
| `packages/database/src/repositories/request.repository.ts` | `?? null` on both cost writers | VERIFIED | `costUsd ?? null` at L115 (save 15th param) and L158 (updateUsage 5th param). Token columns keep `\|\| null`. |
| `.../repositories/__tests__/request-cost-zero.test.ts` | writer-level zero-cost test | VERIFIED | Uses real RequestRepository + capturing adapter, asserts params[14]/params[4] === 0 vs null. Not hollow. |
| `packages/proxy/src/post-processor.worker.ts` | estimate 0→undefined guard | VERIFIED | L691 `state.usage.costUsd = est === 0 ? undefined : est`; real branch L680 untouched. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| OpenRouterProvider.extractStreamingUsage | super.extractStreamingUsage | clone.clone() before delegate | WIRED | L310 `costClone = clone.clone()` then L312 `super.extractStreamingUsage` |
| extractStreamingUsage | SSE message_delta usage.cost | typeof === number guard | WIRED | L319 guard; readFinalSseCost L369-371 reads `data.usage.cost` |
| request.repository.save() | cost_usd column | `costUsd ?? null` (15th param) | WIRED | L115 |
| request.repository.updateUsage() | cost_usd column | `costUsd ?? null` (5th param) | WIRED | L158, COALESCE(?, cost_usd) |
| handleEnd() estimate branch | state.usage.costUsd | `est === 0 ? undefined` | WIRED | L691 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Provider streaming/non-streaming cost cases | `bun test .../openrouter/__tests__/provider.test.ts` | 31 pass, 0 fail | PASS |
| Writer + worker zero-cost suites | `bun test request-cost-zero.test.ts sse-parsing.test.ts extract-usage-from-json.test.ts` | 29 pass, 0 fail | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| COST-04 | 08-01, 08-02 | Skip estimateCostUSD when provider costUsd available; cost_usd ends up in requests table for OpenRouter | SATISFIED | Worker gating L678-692 + writers `?? null`; streaming + non-streaming extraction. REQUIREMENTS.md:39 maps COST-04 → Phase 8. No orphaned requirements. |

### Anti-Patterns Found

None. No TBD/FIXME/XXX markers in modified files. Empty returns (`return null`, `return base`) are intentional error fallbacks in extractUsageInfo/extractStreamingUsage, not stubs.

### Gaps Summary

No gaps. All three ROADMAP success criteria are observably true in the codebase, all artifacts exist and are wired, both DB writers distinguish genuine $0 from absent via `?? null`, and the worker prevents estimate-$0 from masquerading as a real 0. Base class and generated inline-worker.ts confirmed untouched by phase 08. Targeted suites pass (31 + 29).

---

_Verified: 2026-05-31T14:10:00Z_
_Verifier: Claude (gsd-verifier)_
