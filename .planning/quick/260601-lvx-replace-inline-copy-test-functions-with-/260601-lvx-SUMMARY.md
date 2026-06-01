---
quick_id: 260601-lvx
title: Replace inline-copy test functions with imports of real production functions
mode: quick
date: 2026-06-01
status: complete
commit: f5ab21cb
---

# Quick Task 260601-lvx Summary

Replaced the inline test-only copies of `extractUsageFromData` / `extractUsageFromJson`
with imports of the real production functions, extracted verbatim into a new shared
non-worker module `packages/proxy/src/usage-extraction.ts`. The worker and both test
files now import from this single source of truth, so COST-02/COST-03 cost-guard tests
assert against the same bodies the worker ships. Pure refactor — no behavior change.

## Files Changed

- `packages/proxy/src/usage-extraction.ts` (new) — exports `UsageExtractionState`,
  `extractUsageFromJson(json, state)`, and
  `extractUsageFromData(data, eventType, state, tokenEncoder?, log?)`. Function bodies
  moved verbatim from the worker; `RequestState` references retyped to
  `UsageExtractionState`; `tokenEncoder` and `log` injected as optional trailing params;
  token-count catch uses `log?.debug(...)`. All guard comments (D-03, D-05, WR-01)
  preserved.
- `packages/proxy/src/post-processor.worker.ts` — deleted the two local definitions,
  added `import { extractUsageFromData, extractUsageFromJson } from "./usage-extraction";`,
  and updated the `processSSELine` call site to pass `tokenEncoder, log`. `RequestState`
  unchanged (structurally satisfies `UsageExtractionState`).
- `packages/proxy/src/__tests__/sse-parsing.test.ts` — deleted inline
  `extractUsageFromData`, added import from `../usage-extraction`. `parseSSELine` and
  `handleEnd cost gating` (`resolveCostUsd`) blocks left untouched.
- `packages/proxy/src/__tests__/extract-usage-from-json.test.ts` — deleted inline
  `extractUsageFromJson`, added import from `../usage-extraction`. `handleEnd estimate
  0 -> undefined guard` (`resolveCostUsd`) block left untouched.

## Verification

- `bun test sse-parsing.test.ts extract-usage-from-json.test.ts`: **25 pass, 0 fail**
  (36 expect() calls) — all prior cases preserved.
- `bun run typecheck`: clean.
- `bun run lint`: 221 pre-existing warnings, all in unrelated dashboard/recharts files;
  **zero** on the four touched files.
- `bun run format`: no fixes applied (already formatted).
- `inline-worker.ts` confirmed NOT modified / NOT committed.

## Deviations

- **[Rule 3 - blocking type error] `log` param type.** The plan specified
  `log?: { debug: (...args: unknown[]) => void }`, but that signature is not assignable
  from the worker's `Logger.debug` (`(message: string, data?: any) => void`) — `tsc`
  rejected the call site with TS2345. Changed the param type to
  `log?: { debug: (message: string, data?: unknown) => void }`, which both the worker's
  `Logger` satisfies and the single `log?.debug("Failed to count tokens:", err)` call uses.
  No behavior change.

## Self-Check: PASSED

- `packages/proxy/src/usage-extraction.ts`: FOUND
- Commit `f5ab21cb`: FOUND in git log
