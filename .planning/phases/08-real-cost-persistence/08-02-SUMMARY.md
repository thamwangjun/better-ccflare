---
phase: 08-real-cost-persistence
plan: 02
subsystem: cost-persistence
tags: [cost, persistence, openrouter, writers, worker]
requires:
  - "08-01 streaming/JSON provider cost extraction (providerCostUsd)"
provides:
  - "Real provider $0 persisted as 0 (not null) in cost_usd via ?? null in both writers"
  - "Estimate-$0 for unknown models collapses to null (worker estimate 0 -> undefined guard)"
affects:
  - packages/database/src/repositories/request.repository.ts
  - packages/proxy/src/post-processor.worker.ts
tech-stack:
  added: []
  patterns:
    - "Nullish coalescing (?? null) for cost_usd to distinguish 0 from absent"
    - "Upstream estimate 0 -> undefined map (RESEARCH Strategy B) to keep real/estimate distinct"
key-files:
  created:
    - packages/database/src/repositories/__tests__/request-cost-zero.test.ts
  modified:
    - packages/database/src/repositories/request.repository.ts
    - packages/proxy/src/post-processor.worker.ts
    - packages/proxy/src/__tests__/sse-parsing.test.ts
    - packages/proxy/src/__tests__/extract-usage-from-json.test.ts
decisions:
  - "D-03: only the two cost_usd writer lines move to ?? null; sibling token columns keep || null"
  - "D-04: estimate 0 -> undefined enforced in worker handleEnd() estimate branch ONLY (Strategy B), leaving the providerCostUsd real-cost branch and base-anthropic-compatible.ts untouched"
metrics:
  duration: ~30m
  completed: 2026-05-31
requirements: [COST-04]
---

# Phase 8 Plan 02: Zero-Cost Persistence + Estimate-$0 Guard Summary

Real OpenRouter `usage.cost` (including a genuine `$0` for `:free` models) now persists as `0` in `requests.cost_usd` for both DB writers via `?? null`, while an estimate-$0 for an unknown model is mapped to `undefined` upstream in the worker so it collapses to `null` instead of masquerading as a real `0`.

## What Was Built

- **Writers (`request.repository.ts`):** Changed the `cost_usd` positional param from `|| null` to `?? null` in both `save()` (15th param) and `updateUsage()` (5th param). All sibling token columns intentionally keep `|| null` (0 and absent are equivalent for token counts — D-03 scope).
- **Worker (`post-processor.worker.ts` `handleEnd()`):** The `providerCostUsd !== undefined` real-cost branch is untouched (a real `0` persists). The `else`/estimate branch now captures the estimate into a local and maps `est === 0 ? undefined : est` (D-04 / RESEARCH Strategy B), because `estimateCostUSD()` returns a literal `0` for unknown models. This prevents the new `?? null` from persisting an estimate-$0 as a literal `0`.
- **Tests:** New `request-cost-zero.test.ts` (writer-level, real adapter capture) proves `costUsd: 0` lands as `0` and `undefined` as `null` for both writers. Extended `sse-parsing.test.ts` and `extract-usage-from-json.test.ts` with handleEnd-gating cases: estimate-$0 → undefined, real providerCostUsd 0 → survives as 0, non-OpenRouter estimate branch still runs.

## TDD Cycle

- **RED** (commit `7111bc97`): New writer tests + extended worker tests; 2 writer tests failed (real `0` dropped to `null`), 27 passed.
- **GREEN** (commit `aa6e85d1`): Applied `?? null` switch and worker estimate guard; all 29 target tests pass.

## Deviations from Plan

None — plan executed exactly as written. The plan's worker estimate-guard tests were authored as inline `handleEnd()`-gating simulations, consistent with the existing simulation pattern in those two test files (they have never imported the real worker). The genuine RED signal came from `request-cost-zero.test.ts`, which imports the real `RequestRepository`.

## Verification

- `command grep -c "costUsd ?? null" request.repository.ts` → 2; `costUsd || null` → 0.
- `command grep -E "=== 0 \? undefined" post-processor.worker.ts` → matches the estimate-branch guard.
- `git diff --name-only` shows NO change to `packages/proxy/src/inline-worker.ts` or `packages/providers/src/providers/base-anthropic-compatible.ts`.
- Target suites: `29 pass, 0 fail`.
- `bunx tsc --noEmit`: no errors in any file I modified. `biome format`: no changes to my files.

## Known Issues / Deferred (out of scope, pre-existing)

These pre-existing failures/errors exist in this fresh worktree and are unrelated to this plan's two-file change (confirmed: my diff touches only `request.repository.ts` and `post-processor.worker.ts`):

- `bun test packages/proxy packages/database`: 34 failures in unrelated suites — `AutoRefreshScheduler`, `AccountRepository` (openrouter provider preference), `proxy.ts pool-exhausted`. None exercise the cost write path or worker cost gating.
- `bunx tsc --noEmit` reports missing generated modules (`inline-worker`, `inline-vacuum-worker`, `inline-integrity-check-worker`, `embedded-tiktoken-wasm`) because `bun run build` has not been run in this worktree. These are auto-generated artifacts, not source.
- `bun run lint`: 221 pre-existing dashboard warnings. The only warnings in my files are `as any` test-harness casts matching the existing `stats-session-cost.test.ts` convention.
