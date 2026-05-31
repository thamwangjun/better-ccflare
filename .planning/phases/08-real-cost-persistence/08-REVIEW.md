---
phase: 08-real-cost-persistence
reviewed: 2026-05-31T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - packages/database/src/repositories/request.repository.ts
  - packages/database/src/repositories/__tests__/request-cost-zero.test.ts
  - packages/providers/src/providers/openrouter/provider.ts
  - packages/providers/src/providers/openrouter/__tests__/provider.test.ts
  - packages/proxy/src/post-processor.worker.ts
  - packages/proxy/src/__tests__/extract-usage-from-json.test.ts
  - packages/proxy/src/__tests__/sse-parsing.test.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-05-31
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

This phase persists real provider-returned cost (OpenRouter `usage.cost`) instead of estimates, distinguishing a genuine `$0` from a missing/estimate-`$0`. The core zero-vs-null discipline (`costUsd ?? null` in the repository, `est === 0 ? undefined` in the worker, `typeof === "number"` tampering guards) is implemented consistently and well-tested.

However, the streaming cost extraction in `OpenRouterProvider.readFinalSseCost` has a correctness bug that silently drops cost for any streaming response larger than 32KB — which is the common case for the agentic/Claude Code sessions this fork targets. There are also several robustness gaps around the streaming `message_start` cost path and the `costUsd: undefined` override.

## Critical Issues

### CR-01: `readFinalSseCost` caps reading at 32KB but cost is in the FINAL SSE event — cost silently dropped for large streams

**File:** `packages/providers/src/providers/openrouter/provider.ts:333-351`
**Issue:** `readFinalSseCost` reads the stream with `while (buffered.length < maxBytes)` where `maxBytes = ANTHROPIC_STREAM_CAP_BYTES = 32768` (32KB, per `packages/core/src/constants.ts:98`). The loop stops accumulating once the buffer hits 32KB, then cancels the reader. But OpenRouter's `usage.cost` arrives in the **final** `message_delta` event at the END of the stream. For any streaming response whose body exceeds 32KB — routine for agentic/Claude Code sessions with large tool outputs or long completions — the loop fills 32KB from the *start* of the stream and never reaches the trailing `message_delta`. `lastCost` stays `undefined`, and `extractStreamingUsage` (line 319-324) then sets `costUsd: undefined`, discarding the real provider cost. The entire COST-04 feature degrades to "no cost recorded" precisely for the high-cost requests that matter most.

The existing tests only exercise tiny (<1KB) synthetic SSE bodies (`makeStreamingResponse`), so this never surfaces in the suite.

**Fix:** Read the whole stream (or at minimum a tail window), not just the leading 32KB. Drop the byte cap on this read, or maintain a sliding tail buffer that always retains the final events:
```typescript
// Read the full body; the cost is only ever in the final message_delta.
// If a hard cap is required for safety, keep a sliding tail window instead
// of truncating from the front:
let buffered = "";
try {
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        if (buffered.length > maxBytes) {
            // Retain only the tail so the final message_delta is never lost.
            buffered = buffered.slice(-maxBytes);
        }
    }
} finally {
    reader.cancel().catch(() => {});
}
```
Note the post-processor worker's own extraction (`extractUsageFromData`) does NOT have this cap and persists cost correctly, so the persisted DB value may diverge from the live summary value the provider produces — making the bug intermittently invisible while still corrupting the live dashboard/cost feed.

## Warnings

### WR-01: OpenRouter streaming `usage.cost` delivered on `message_start` is never captured by the worker

**File:** `packages/proxy/src/post-processor.worker.ts:340-352, 378-381`
**Issue:** In `extractUsageFromData`, the `message_delta` branch extracts `parsed.usage.cost` (lines 378-381), but the `message_start` branch (lines 340-352) only reads token fields and never inspects `usage.cost`. If OpenRouter (or a relayed provider) ever emits cost on the `message_start` usage object, it is dropped. The non-streaming JSON path (`extractUsageFromJson`) and the `message_delta` path handle cost, but `message_start` is an inconsistent blind spot.
**Fix:** Mirror the `typeof ... === "number"` cost guard inside the `isMessageStart` block:
```typescript
if (parsed.message?.usage) {
    const usage = parsed.message.usage;
    // ... existing token assignments ...
    if (typeof usage.cost === "number") {
        state.usage.providerCostUsd = usage.cost;
    }
}
```

### WR-02: Provider `extractStreamingUsage` overrides a valid base cost estimate with `undefined`

**File:** `packages/providers/src/providers/openrouter/provider.ts:319-324`
**Issue:** When `readFinalSseCost` returns no number (absent cost, OR the truncation bug in CR-01, OR any read failure that yields `undefined` rather than throwing), the code deliberately sets `costUsd: undefined`, discarding the base class's computed estimate. The comment justifies this ("OpenRouter cost is authoritative"), but combined with CR-01 this means large streaming requests get *no* cost at all — neither real nor estimated. Even setting CR-01 aside, a transient absence of `usage.cost` (e.g., a provider variation) now silently yields zero cost data instead of a best-effort estimate.
**Fix:** After fixing CR-01, reconsider whether `undefined` is the right fallback. Consider falling back to `base.costUsd` (the estimate) when no real cost is present, or at minimum log at `warn` when a streaming OpenRouter response yields no `usage.cost` so the gap is observable rather than silent.

### WR-03: `readFinalSseCost` reader cancellation can race / swallow partial-event boundary

**File:** `packages/providers/src/providers/openrouter/provider.ts:342-351`
**Issue:** The loop appends `decoder.decode(value, { stream: true })` but never calls `decoder.decode()` (final flush) after the loop ends. If the stream's final chunk ends mid multi-byte UTF-8 sequence right at the `usage.cost` value, the trailing bytes are lost and `JSON.parse` of that `data:` line throws (caught and ignored at line 372), dropping cost. The worker path handles this correctly with a trailing `streamDecoder.decode()` flush (post-processor.worker.ts:636); this path does not.
**Fix:** After the read loop, flush the decoder: `buffered += decoder.decode();` before splitting into lines.

### WR-04: `extractUsageInfo` non-streaming return omits `inputTokens`/`outputTokens` present in base contract

**File:** `packages/providers/src/providers/openrouter/provider.ts:277-285`
**Issue:** The override's non-streaming return object sets `model`, `promptTokens`, `completionTokens`, `totalTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `costUsd` — but omits `inputTokens` and `outputTokens`, which the base class (`base-anthropic-compatible.ts:311-321`) and the declared return type both include. Any consumer reading `usage.inputTokens`/`usage.outputTokens` from the non-streaming OpenRouter path gets `undefined` where the base provider would supply a number, an inconsistency at the API boundary.
**Fix:** Add `inputTokens: promptTokens` (or the raw `json.usage.prompt_tokens`) and `outputTokens: completionTokens` to the returned object to match the base contract.

### WR-05: `costUsd ?? null` correct, but other usage fields use `|| null` — a real `0` token count collapses to null

**File:** `packages/database/src/repositories/request.repository.ts:112-119, 154-162`
**Issue:** The phase correctly switched `cost_usd` to `?? null` (line 115, 158) so a real `$0` persists. But the adjacent token columns still use `|| null` (`promptTokens || null`, `completionTokens || null`, `inputTokens || null`, `outputTokens || null`, etc.). A legitimate `0` output-token or `0` cache-read count is therefore written as `NULL`, not `0`. This is the exact zero-vs-null defect the phase set out to fix — applied to cost but not to the token columns that share the same failure mode. For `:free`/cached requests, a genuine `cacheCreationInputTokens: 0` becomes indistinguishable from "unknown."
**Fix:** If zero is a meaningful value for these columns (it is for token counts), switch them to `?? null` as well, consistent with `cost_usd`. If intentionally kept as `|| null` (treating 0 tokens as "not worth recording"), document the rationale, since it now diverges from the cost handling in the same statement.

## Info

### IN-01: Inline-duplicated function bodies in tests can silently drift from source

**File:** `packages/proxy/src/__tests__/extract-usage-from-json.test.ts:5-53`, `packages/proxy/src/__tests__/sse-parsing.test.ts:5-91`
**Issue:** Both test files re-implement `extractUsageFromJson` / `parseSSELine` / `extractUsageFromData` as inline copies "mirroring" the worker. These copies are not imported from the worker, so a change in `post-processor.worker.ts` will not fail these tests — they validate a fork of the logic, not the logic. The worker is a hard-to-import module (`declare var self: Worker`, top-level `await`), which explains the copy, but the tests give false confidence.
**Fix:** Extract the pure parsing functions into an importable module (e.g., `sse-usage.ts`) and import them in both the worker and the tests, so the tests exercise the real code path.

### IN-02: `console.log` debug artifact left in worker startup

**File:** `packages/proxy/src/post-processor.worker.ts:66`
**Issue:** `console.log("[WORKER] Post-processor worker started");` violates the project convention (CLAUDE.md: "use the `Logger` class (not `console.*`)"). The very next line already logs the same message via `log.info`. There are also raw `console.error` calls at lines 98 (acceptable as a last-resort during logger/encoder init failure, but still bypasses `logBus`).
**Fix:** Remove the redundant `console.log` at line 66; the `log.info` on line 67 already covers it.

### IN-03: Repeated `process.env.DEBUG` gate duplicated ~5 times in `handleEnd`

**File:** `packages/proxy/src/post-processor.worker.ts:705-773, 780-783, 925-934`
**Issue:** The `process.env.DEBUG?.includes("worker") || process.env.DEBUG === "true" || process.env.NODE_ENV === "development"` condition is copy-pasted in five places within the tokens-per-second block. This is maintenance-fragile and obscures the actual calculation logic.
**Fix:** Hoist to a single `const debugWorker = ...` computed once at the top of `handleEnd` (or a module-level helper), and reference it.

---

_Reviewed: 2026-05-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
