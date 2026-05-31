---
phase: 07-openrouter-response-cost-extraction
plan: 02
subsystem: proxy-worker
tags: [openrouter, cost, worker, sse, usage]
requires:
  - "RequestState.usage interface in post-processor.worker.ts"
provides:
  - "RequestState.usage.providerCostUsd field (D-06)"
  - "extractUsageFromData() SSE cost extraction (D-03, COST-02)"
  - "extractUsageFromJson() non-streaming JSON cost extraction (D-05, COST-03)"
  - "handleEnd() providerCostUsd gating over estimateCostUSD() (D-04)"
affects:
  - "packages/proxy/src/post-processor.worker.ts"
tech-stack:
  added: []
  patterns:
    - "typeof === number guard before assigning provider-controlled numeric"
key-files:
  created:
    - "packages/proxy/src/__tests__/extract-usage-from-json.test.ts"
  modified:
    - "packages/proxy/src/post-processor.worker.ts"
    - "packages/proxy/src/__tests__/sse-parsing.test.ts"
decisions:
  - "Pre-existing typecheck errors (missing generated build artifacts: inline-worker, embedded-tiktoken-wasm, dashboard-web/dist) are out of scope — they require `bun run build` and are unrelated to this plan's changes"
  - "Pre-existing 218 dashboard Biome warnings are out of scope (documented tech debt); changed files lint clean"
metrics:
  duration: ~10m
  completed: 2026-05-31
requirements: [COST-02, COST-03]
---

# Phase 7 Plan 02: OpenRouter Worker Cost Extraction Summary

Threaded actual OpenRouter USD cost (`usage.cost`) through both post-processor worker response paths (SSE `message_delta` and non-streaming JSON body) into a new `RequestState.usage.providerCostUsd` field, and wired `handleEnd()` to use the provider-returned cost when present instead of calling `estimateCostUSD()`.

## What Was Built

- **D-06:** Added `providerCostUsd?: number` to the `RequestState.usage` interface, distinct from `costUsd` (which holds the final estimate-or-provider value).
- **D-03 / COST-02:** `extractUsageFromData()` reads `parsed.usage.cost` from SSE `message_delta` events with a `typeof parsed.usage.cost === "number"` guard.
- **D-05 / COST-03:** `extractUsageFromJson()` reads `usageObj.cost` from non-streaming JSON response bodies with a `typeof usageObj.cost === "number"` guard; added `cost?: number` to the JSON type annotation.
- **D-04:** `handleEnd()` now uses `providerCostUsd` directly when set (`!== undefined`), otherwise falls back to `estimateCostUSD()`.

## Tasks Completed

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Field + SSE + JSON cost extraction (TDD) | 79687ce8 (RED), 2e3cbc9d (GREEN) |
| 2 | handleEnd() gating (TDD) | f2f54197 (RED), 1751afc2 (GREEN) |
| 3 | Integration verification (typecheck/lint/format) | verification-only, no code changes |

## Verification

- `bun test packages/proxy/src/__tests__/sse-parsing.test.ts packages/proxy/src/__tests__/extract-usage-from-json.test.ts` — 18 pass, 0 fail.
- Changed files lint clean (`biome check` on the 3 files — no diagnostics) and are already formatted.
- `inline-worker.ts` untouched (verified via `git diff --name-only 4132b386 HEAD`).
- `providerCostUsd` appears only in the 4 expected locations in `post-processor.worker.ts`: interface (L48), extractUsageFromJson (L316), extractUsageFromData (L380), handleEnd gating (L678-679).
- Non-OpenRouter providers degrade gracefully — missing `cost` field leaves `providerCostUsd` undefined, so `handleEnd()` falls through to `estimateCostUSD()` (no regression).

## Deviations from Plan

### Out-of-scope discoveries (not fixed — pre-existing)

- **`bun run typecheck` reports 7 errors** for missing generated build modules (`./inline-worker`, `./embedded-tiktoken-wasm`, `@better-ccflare/dashboard-web/dist/*`, vacuum/integrity workers). These are build artifacts produced by `bun run build`, absent in the fresh worktree. None reference this plan's changes. Out of scope per the executor scope boundary.
- **`bun run lint` reports 218 dashboard warnings** — documented pre-existing tech debt (PROJECT.md / STATE.md: "27 Biome lint errors in dashboard React components, unrelated to fork patches"). Out of scope. The 3 files changed by this plan lint clean.

No auto-fixes (Rules 1–3) were required. No architectural decisions (Rule 4) arose.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: packages/proxy/src/__tests__/extract-usage-from-json.test.ts
- FOUND: packages/proxy/src/post-processor.worker.ts (modified)
- FOUND commits: 79687ce8, 2e3cbc9d, f2f54197, 1751afc2
