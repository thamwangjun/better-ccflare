---
phase: 08-real-cost-persistence
fixed_at: 2026-05-31T00:00:00Z
review_path: .planning/phases/08-real-cost-persistence/08-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 8
skipped: 1
status: partial
---

# Phase 08: Code Review Fix Report

**Fixed at:** 2026-05-31
**Source review:** .planning/phases/08-real-cost-persistence/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (--all)
- Fixed: 8
- Skipped: 1

## Fixed Issues

### CR-01: `readFinalSseCost` 32KB front-truncation drops cost for large streams

**Files modified:** `packages/providers/src/providers/openrouter/provider.ts`
**Commit:** 6d05b3e3
**Applied fix:** Replaced the `while (buffered.length < maxBytes)` loop with an unbounded read that retains only a sliding TAIL window (`buffered.slice(-maxBytes)`), so the trailing `message_delta` carrying `usage.cost` is never lost while memory stays bounded.

### WR-02: streaming `extractStreamingUsage` silently records no cost

**Files modified:** `packages/providers/src/providers/openrouter/provider.ts`
**Commit:** 6d05b3e3
**Applied fix:** Added a `log.warn` (Logger, not console) when a streaming OpenRouter response yields no `usage.cost`, making the gap observable. Kept `costUsd: undefined` semantics (OpenRouter cost authoritative) per the original design; only logging was added.

### WR-03: missing final TextDecoder flush

**Files modified:** `packages/providers/src/providers/openrouter/provider.ts`
**Commit:** 6d05b3e3
**Applied fix:** Added `buffered += decoder.decode();` after the read loop so a final chunk ending mid multi-byte UTF-8 sequence is flushed before line splitting.

### WR-04: non-streaming return omits `inputTokens`/`outputTokens`

**Files modified:** `packages/providers/src/providers/openrouter/provider.ts`
**Commit:** 6d05b3e3
**Applied fix:** Added `inputTokens: promptTokens` and `outputTokens: completionTokens` to the non-streaming return object to match the base contract (return type already declared these fields).

### WR-01: `message_start` branch never reads `usage.cost`

**Files modified:** `packages/proxy/src/post-processor.worker.ts`
**Commit:** 876473f7
**Applied fix:** Mirrored the `typeof usage.cost === "number"` guard inside the `isMessageStart` block, assigning `state.usage.providerCostUsd`. Edited the SOURCE worker file only (not the generated inline-worker.ts).

### IN-02: redundant `console.log` worker-start artifact

**Files modified:** `packages/proxy/src/post-processor.worker.ts`
**Commit:** 876473f7
**Applied fix:** Removed `console.log("[WORKER] ...")`; the adjacent `log.info` already covers it (CLAUDE.md Logger convention).

### IN-03: DEBUG env gate duplicated ~7 times in `handleEnd`

**Files modified:** `packages/proxy/src/post-processor.worker.ts`
**Commit:** 876473f7
**Applied fix:** Hoisted a single `const debugWorker = ...` at the top of `handleEnd` and replaced all 7 inline gate conditions with it.

### WR-05: token columns use `|| null`, collapsing a real 0 to null

**Files modified:** `packages/database/src/repositories/request.repository.ts`
**Commit:** 1cc3ed83
**Applied fix:** Switched all token-count columns (promptTokens, completionTokens, totalTokens, inputTokens, cacheReadInputTokens, cacheCreationInputTokens, outputTokens) and tokensPerSecond from `|| null` to `?? null` in both the INSERT and `updateUsage` statements, matching the zero-vs-null discipline already applied to `cost_usd`. 0 is a meaningful value for token counts (e.g. `:free`/cached requests).

## Skipped Issues

### IN-01: inline-duplicated parsing functions in tests can drift

**File:** `packages/proxy/src/__tests__/extract-usage-from-json.test.ts`, `packages/proxy/src/__tests__/sse-parsing.test.ts`
**Reason:** skipped: extraction would require restructuring `post-processor.worker.ts` (the source that is bundled into the generated `inline-worker.ts`). Pulling the pure parsing functions into an importable module changes the worker's module structure and risks breaking the fork's clean-patch / inline-worker generation workflow (CLAUDE.md forbids editing the generated `inline-worker.ts`, and the review itself notes the worker is hard to import due to `declare var self` + top-level await). The risk to the patch workflow outweighs the test-confidence benefit for an Info-tier finding.
**Original issue:** Test files re-implement worker parsing logic as inline copies that are not imported from the worker, so worker changes won't fail these tests (false confidence).

---

_Fixed: 2026-05-31_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
