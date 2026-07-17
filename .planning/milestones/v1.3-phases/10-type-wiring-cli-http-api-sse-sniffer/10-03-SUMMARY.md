---
phase: 10-type-wiring-cli-http-api-sse-sniffer
plan: 03
subsystem: proxy/sse-sniffer
tags: [failover, sse, openrouter-anthropic, rate-limit]
requires:
  - "10-01"
provides:
  - "openrouter-anthropic overloaded_error mid-stream failover via ANTHROPIC_SHAPE_PROVIDERS membership"
affects:
  - packages/proxy/src/handlers/sse-rate-limit-sniffer.ts
tech-stack:
  added: []
  patterns:
    - "FORK PATCH protective comment guarding a one-line shape-set extension against upstream §3C revert"
key-files:
  created: []
  modified:
    - packages/proxy/src/handlers/sse-rate-limit-sniffer.ts
    - packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts
key-decisions:
  - "Authority for the shape-set extension is ROADMAP SC#4 / CONTEXT.md D-01, overriding ARCHITECTURE.md §3C which incorrectly conflated OAI-shape openrouter with the native Anthropic endpoint hit by openrouter-anthropic"
requirements-completed:
  - FAIL-01
duration: 6 min
completed: 2026-06-04
---

# Phase 10 Plan 03: openrouter-anthropic SSE overloaded_error Failover Summary

TDD-verified extension of `ANTHROPIC_SHAPE_PROVIDERS` to include `openrouter-anthropic`, so mid-stream `overloaded_error` SSE frames on that provider trigger account failover (FAIL-01) instead of being silently ignored.

## What Was Built

- **RED:** Two new test cases in `sse-rate-limit-sniffer.test.ts` — a positive case (`openrouter-anthropic` fires on `overloaded_error`, `firedReason === "overloaded_error"`) and a negative regression guard (OAI-shape `openrouter` does NOT fire on `overloaded_error`).
- **GREEN:** One-line membership change adding `"openrouter-anthropic"` to `ANTHROPIC_SHAPE_PROVIDERS`, wrapped in a protective FORK PATCH comment citing ROADMAP SC#4 / CONTEXT.md D-01 and explicitly warning against reverting to match the incorrect ARCHITECTURE.md §3C.

The `overloaded_error` matching is gated behind `ANTHROPIC_SHAPE_PROVIDERS.has(provider)` via the `isAnthropicShape` flag, so the single set-membership change is sufficient to enable failover for the new provider while leaving OAI-shape providers (`openrouter`, `openai-compatible`) untouched.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | RED — failing tests for openrouter-anthropic failover | 3d639d03 |
| 2 | GREEN — extend ANTHROPIC_SHAPE_PROVIDERS with protective comment | 6f26ff2b |

- Task count: 2
- Files modified: 2
- Start: 2026-06-04
- Duration: ~6 min

## Verification Results

- `bun test packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts` → 16 pass, 0 fail (includes both new cases + existing anthropic/claude-oauth/openai-compatible cases — no regression)
- `grep -n "openrouter-anthropic" sse-rate-limit-sniffer.ts` → present in the set (line 51) and in the FORK PATCH comment (lines 43, 47)
- `grep -n "§3C" sse-rate-limit-sniffer.ts` → comment references §3C as INCORRECT (lines 45–46)
- `grep -c "openrouter-anthropic" ...test.ts` → 2 (two new test cases)
- RED confirmed before GREEN: the positive openrouter-anthropic test failed prior to the source edit (15 pass / 1 fail), then passed after.

## Deviations from Plan

None - plan executed exactly as written.

## Deferred Issues

`bun run typecheck` reports `TS2307: Cannot find module './inline-worker'` (and sibling `inline-vacuum-worker`, `inline-integrity-check-worker`, `embedded-tiktoken-wasm`) errors. These are PRE-EXISTING and unrelated to this plan: they reference auto-generated build artifacts (per CLAUDE.md, `inline-worker.ts` et al. are generated and excluded from edits) that are absent in this worktree because `bun run build` has not been run here. None of the modified files (`sse-rate-limit-sniffer.ts`, its test) produce any typecheck error — verified via `bun run typecheck 2>&1 | grep sse-rate-limit` returning no matches. Scope-boundary item (not introduced by this task).

## Self-Check: PASSED

- `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` — FOUND, contains `"openrouter-anthropic"`
- `packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts` — FOUND, contains 2 `openrouter-anthropic` references
- Commit 3d639d03 (test) — FOUND
- Commit 6f26ff2b (fix) — FOUND
