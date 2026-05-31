---
phase: 08-real-cost-persistence
plan: 01
subsystem: providers
tags: [openrouter, cost, streaming, sse, COST-04]
requires: []
provides:
  - "OpenRouterProvider.extractStreamingUsage override returning real usage.cost as costUsd"
affects:
  - "live response-processor streaming cost path for OpenRouter"
tech-stack:
  added: []
  patterns:
    - "clone-before-delegate (clone.clone() before super consumes the body reader)"
    - "provider-override convention (override in concrete provider, base untouched)"
key-files:
  created: []
  modified:
    - packages/providers/src/providers/openrouter/provider.ts
    - packages/providers/src/providers/openrouter/__tests__/provider.test.ts
decisions:
  - "When no real numeric usage.cost is present, OpenRouter cost is authoritative: costUsd is left undefined rather than surfacing the base estimate"
metrics:
  duration: ~12m
  completed: 2026-05-31
---

# Phase 8 Plan 01: Streaming OpenRouter Cost Extraction Summary

Added an `extractStreamingUsage` override to `OpenRouterProvider` so the live
response-processor streaming path returns OpenRouter's real `usage.cost` (read from
the final SSE `message_delta`) as `costUsd`, matching the non-streaming
`extractUsageInfo` override shipped in Phase 7 (closes COST-04 streaming half / D-01).

## What Was Built

- **Test (RED):** Added a `describe` group with a `makeStreamingResponse(cost)` SSE
  fixture (`message_start` + `message_delta` events, `text/event-stream`) covering four
  case shapes through the streaming `extractUsageInfo` path — numeric cost, `0` (free
  model), null/absent, and string-type-confusion. The SSE streaming fixture was a Wave 0
  gap from 08-VALIDATION.md and is authored here.
- **Implementation (GREEN):** `protected override async extractStreamingUsage(clone, originalHeaders)`
  on `OpenRouterProvider`:
  1. `const costClone = clone.clone()` BEFORE delegating (super consumes the single-use body reader, Pitfall 2).
  2. `const base = await super.extractStreamingUsage(clone, originalHeaders)`; `if (!base) return base`.
  3. Private `readFinalSseCost(costClone)` does a bounded buffered read (capped at
     `BUFFER_SIZES.ANTHROPIC_STREAM_CAP_BYTES`) and parses the final `message_delta`
     `usage.cost`.
  4. `typeof realCost === "number"` guard (T-7-01 tampering mitigation): numeric →
     `{ ...base, costUsd: realCost }` (real `$0` survives); non-numeric/absent →
     `{ ...base, costUsd: undefined }`; read/parse failure → `base` unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing `BUFFER_SIZES` import**
- **Found during:** Task 2
- **Issue:** `provider.ts` did not import `BUFFER_SIZES`; the buffered read needs it for the byte cap.
- **Fix:** Added `import { BUFFER_SIZES } from "@better-ccflare/core";` (same source the base class uses).
- **Files modified:** packages/providers/src/providers/openrouter/provider.ts
- **Commit:** d7b28c55

### Clarified Behavior (plan ambiguity)

The plan `<behavior>` said null/absent/string "falls back to base estimate" yet the
acceptance test asserts `costUsd === undefined`. For the test model
(`anthropic/claude-3-5-sonnet`) the base estimate is a non-undefined number, so these
conflicted. Resolved per the acceptance criteria (authoritative): when no real numeric
provider cost is present, the override sets `costUsd: undefined` — OpenRouter cost is
authoritative for this provider and the estimate is not surfaced as `costUsd`. Recorded
as a decision above.

## Verification

- `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — 31 pass, 0 fail (all 5 new streaming cases green; Phase 7 COST-01 non-streaming cases still green).
- `git diff --name-only -- packages/providers/src/providers/base-anthropic-compatible.ts` — EMPTY (base class untouched, D-02).
- `grep -c "override async extractStreamingUsage" provider.ts` — 1.
- Biome lint of the two changed files: no new warnings introduced (the 16 warnings are pre-existing `any` usages in unrelated OpenRouter cache-control code).

## Out-of-Scope / Pre-existing

- `bun run typecheck` reports errors for missing generated modules (`inline-worker.ts`,
  `inline-vacuum-worker.ts`, `embedded-tiktoken-wasm`, etc.). These are auto-generated
  build artifacts absent from the worktree and unrelated to this change (CLAUDE.md marks
  them as never-edit generated files). Not introduced by this plan.
- Repo-wide lint warnings (218, mostly dashboard) are pre-existing and out of scope.

## Self-Check: PASSED

- FOUND: packages/providers/src/providers/openrouter/provider.ts (override present)
- FOUND: packages/providers/src/providers/openrouter/__tests__/provider.test.ts (streaming cases present)
- FOUND commit b16caf7c (test/RED)
- FOUND commit d7b28c55 (feat/GREEN)
