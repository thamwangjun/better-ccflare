---
phase: 07-openrouter-response-cost-extraction
plan: 01
subsystem: providers
tags: [openrouter, cost, usage, provider]
requires: []
provides:
  - "OpenRouterProvider.extractUsageInfo() returns costUsd from json.usage.cost (non-streaming)"
affects:
  - "packages/proxy response-processor.ts → dbOps.updateRequestUsage → cost_usd column (downstream, unchanged)"
tech-stack:
  added: []
  patterns:
    - "typeof guard for provider-controlled numeric fields (tampering mitigation)"
key-files:
  created: []
  modified:
    - packages/providers/src/providers/openrouter/provider.ts
    - packages/providers/src/providers/openrouter/__tests__/provider.test.ts
decisions:
  - "costUsd set only when typeof json.usage.cost === 'number' — rejects null/absent/string (D-01, T-7-01)"
  - "Scoped to OpenRouterProvider only; base classes untouched (D-02)"
metrics:
  duration: "~10 min"
  completed: "2026-05-31"
  tasks: 2
  files: 2
---

# Phase 7 Plan 01: OpenRouter Response Cost Extraction Summary

Added `usage.cost` extraction to `OpenRouterProvider.extractUsageInfo()`, returning `costUsd: number | undefined` for non-streaming JSON responses, guarded by a `typeof === "number"` check so null/absent/string costs resolve to `undefined`.

## What Was Built

- **Task 1 (TDD COST-01):** Added 5 test cases (cost present, null, absent, zero, string-type-confusion) to the existing `extractUsageInfo` describe block, then implemented `const costUsd = typeof json.usage.cost === "number" ? json.usage.cost : undefined;` and added `costUsd` to the return object. The `costUsd?: number` field already existed in the override's return type, so no signature change was needed.
- **Task 2 (Verification):** Ran the provider test suite (26 pass / 0 fail), typecheck, lint, and format. Confirmed base classes (`base-anthropic-compatible.ts`, `openai/provider.ts`) contain no `usage.cost` references (per D-02).

The field flows automatically through `response-processor.ts → updateRequestUsage → cost_usd` column; no other files required changes.

## Verification Results

- `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` → 26 pass, 0 fail
- `bun run typecheck` → only pre-existing errors for generated/build-artifact modules (inline-worker, dashboard-web/dist, embedded-tiktoken-wasm) not built in this worktree; NONE reference openrouter or my changes
- `bun run lint` / biome on target files → only pre-existing `any` warnings in existing code; no new errors
- `bun run format` (biome) → no changes to target files
- Base classes: `base-anthropic-compatible.ts` (0), `openai/provider.ts` (0) `usage.cost` references — D-02 satisfied

## Acceptance Criteria

- [x] `extractUsageInfo()` returns `costUsd` when `json.usage.cost` is a number (incl. 0)
- [x] `costUsd` is `undefined` when cost is null, absent, or non-numeric (string)
- [x] All extractUsageInfo tests pass (4 existing CACHE-01 + 5 new COST-01 = 9 in that block; 26 total in file)
- [x] Typecheck (no new errors), lint (no new errors), format (clean)
- [x] No changes to base provider classes

## Deviations from Plan

None — plan executed exactly as written. (Note: the openai-compatible base referenced in the plan as `openai-compatible/provider.ts` actually lives at `openai/provider.ts`; verified untouched regardless.)

## Self-Check

- FOUND: packages/providers/src/providers/openrouter/provider.ts (contains `typeof json.usage.cost === "number"` + `costUsd` in return)
- FOUND: packages/providers/src/providers/openrouter/__tests__/provider.test.ts (5 costUsd assertions)
- FOUND commit 7b691551 (test RED)
- FOUND commit 65b5c51c (feat GREEN)

## Self-Check: PASSED
