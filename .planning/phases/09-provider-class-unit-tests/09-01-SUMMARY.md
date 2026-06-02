---
phase: 09-provider-class-unit-tests
plan: 01
subsystem: providers
tags: [openrouter, bun-test, tdd, provider, streaming, cost-extraction, session-id, sha256]

# Dependency graph
requires:
  - phase: 08-cost-persistence
    provides: parseUsage / extractStreamingUsage patterns on OpenRouterProvider; COALESCE save()
provides:
  - OpenRouterAnthropicProvider class extending AnthropicCompatibleProvider
  - buildUrl override stripping /v1 prefix for native endpoint
  - transformRequestBody with 3 FORK-PATCH injections (provider pref, session_id, usage)
  - extractUsageInfo / extractStreamingUsage / parseUsage / readFinalSseCost real-cost path
  - 34-test bun:test suite proving all five success criteria
affects:
  - phase-10-wiring (type union, registry registration, sse-rate-limit-sniffer FAIL-01)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extend AnthropicCompatibleProvider (not OpenRouterProvider) for native-endpoint providers"
    - "Copy cost methods verbatim instead of inheriting (avoids dragging in the cache_control injector)"
    - "stable session_id via SHA-256 of account.id (first 32 hex chars) using Web Crypto API"
    - "FORK PATCH annotation on every fork-specific injection in transformRequestBody"
    - "typeof guard for usage.cost — rejects null/string, accepts 0 and positive numbers"

key-files:
  created:
    - packages/providers/src/providers/openrouter-anthropic/provider.ts
    - packages/providers/src/providers/openrouter-anthropic/index.ts
    - packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts
  modified: []

key-decisions:
  - "D-00a: Extend AnthropicCompatibleProvider, not OpenRouterProvider — avoids inheriting 4-breakpoint cache_control injector and OAI-format extractUsageInfo"
  - "D-00b: buildUrl strips /v1 prefix; native endpoint base https://openrouter.ai/api/v1; Bearer auth"
  - "D-00c: Zero cache_control injection — passthrough only; Claude Code sends its own blocks"
  - "D-00d: Real cost on both streaming and non-streaming — port readFinalSseCost; no estimate fallback for streaming"
  - "D-01/02: session_id is stable SHA-256 hash of account.id — always-on, no env flag, FORK PATCH"
  - "D-03: usage:{include:true} always injected when client omits it — guarantees usage.cost in response"
  - "D-04: Captured-real streaming fixture (cost: 0.0000070581) used for streaming happy-path test"

patterns-established:
  - "Provider coexistence: new directory under providers/ with no modifications to existing files"
  - "TDD: test file created first (RED = Cannot find module), then provider implemented (GREEN = 34 pass)"

requirements-completed: [PROV-01, PROV-02, PROV-03, CACHE-01, ROUTE-01, ROUTE-02, COST-01, COST-02]

# Metrics
duration: 25min
completed: 2026-06-02
---

# Phase 09 Plan 01: Provider Class + Unit Tests Summary

**OpenRouterAnthropicProvider class with buildUrl/transformRequestBody/extractUsageInfo/streaming-cost overrides, proven by 34 bun:test cases including captured-real streaming fixture at cost 0.0000070581**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-02T00:00:00Z
- **Completed:** 2026-06-02T00:25:00Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments

- Created `OpenRouterAnthropicProvider` extending `AnthropicCompatibleProvider` with all four override groups
- Zero cache_control injection — native passthrough proven by test asserting 4-block-in = 4-block-out
- All five success criteria (SC#1–SC#5) proven by 34 passing bun:test cases
- Captured-real streaming fixture from empirical probe (cost: 0.0000070581) used verbatim for D-04
- No existing files modified — clean coexistence with `openrouter/` sibling (PROV-03)

## Task Commits

1. **Task 1: OpenRouterAnthropicProvider class + barrel export** - `aec661f9` (feat)
2. **Task 2: TDD proof suite — all five success criteria** - `9e171b9a` (test)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `packages/providers/src/providers/openrouter-anthropic/provider.ts` — OpenRouterAnthropicProvider class: buildUrl, transformRequestBody (3 FORK-PATCH injections), extractUsageInfo, parseUsage, extractStreamingUsage, readFinalSseCost
- `packages/providers/src/providers/openrouter-anthropic/index.ts` — Barrel re-export: `export { OpenRouterAnthropicProvider } from "./provider"`
- `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` — 34-test bun:test suite covering all five SC scenarios

## Decisions Made

All implementation decisions were locked in 09-CONTEXT.md before execution. No new decisions were required during execution. Followed plan exactly as specified.

## Deviations from Plan

None — plan executed exactly as written. TDD protocol followed: test file written first (RED: "Cannot find module"), then provider implemented to make tests pass (GREEN: 34 pass, 0 fail).

## Issues Encountered

Pre-existing typecheck errors in `packages/proxy/src/inline-worker.ts` and `packages/database/src/inline-vacuum-worker.ts` (auto-generated files not present in the worktree; per CLAUDE.md these are generated by `bun run build`). These errors are out of scope — no new TypeScript errors were introduced by this plan.

## User Setup Required

None — no external service configuration required. Provider class exists and compiles; Phase 10 wiring adds it to the registry and type union.

## Next Phase Readiness

- Phase 10 can now register `OpenRouterAnthropicProvider` in `registry.ts`, add `"openrouter-anthropic"` to the mode type union, add the CLI `--mode` option, and extend `ANTHROPIC_SHAPE_PROVIDERS` in `sse-rate-limit-sniffer.ts` (FAIL-01)
- The exported class is the only Phase 10 dependency — no other Phase 9 artifacts needed

---
*Phase: 09-provider-class-unit-tests*
*Completed: 2026-06-02*
