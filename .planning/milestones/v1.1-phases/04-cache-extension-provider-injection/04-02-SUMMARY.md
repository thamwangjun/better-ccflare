---
phase: 04-cache-extension-provider-injection
plan: "02"
subsystem: providers-tests
tags: [tdd, red-gate, openrouter, cache-control, provider-injection, prov-01, cache-03, cache-04]
dependency_graph:
  requires: [04-01]
  provides: [failing tests for CACHE-03 4th breakpoint, count guard, PROV-01 provider injection]
  affects: [packages/providers]
tech_stack:
  added: []
  patterns: [tdd-red-gate, fixture-as-any-cast, bun-test]
key_files:
  created: []
  modified:
    - packages/providers/src/providers/openrouter/__tests__/provider.test.ts
decisions:
  - "7 of 10 new tests are RED (not 9 as planned) — 3 negative-contract tests pass immediately because the current code doesn't inject provider at all, making those assertions trivially true before Plan 03 is implemented"
  - "Non-destructive guard test uses { type: 'ephemeral', ttl: '5m' } as fixture to force RED — current code overwrites cache_control, dropping the ttl key"
  - "Count guard partial test uses 3 pre-existing tools (not 2) to produce total=5 with current code vs expected 4 — clearly RED"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-20T08:00:00Z"
  tasks_completed: 1
  files_modified: 1
---

# Phase 4 Plan 02: TDD RED Gate — Cache Count Guard, 4th Breakpoint, Provider Injection Summary

## One-Liner

Added 10 new test cases to `provider.test.ts` establishing the RED gate contract for Plan 03: 7 fail (RED) against the current implementation, 3 pass immediately (negative-contract tests), and all 10 original tests continue to pass.

## Objective Achieved

- TDD RED gate established: failing tests exist for all new behavior Plan 03 must implement
- Contract fully specified across 4 feature areas: CACHE-03 4th breakpoint (array + string user content), count guard (stop at 4), non-destructive guard (preserve existing cache_control), PROV-01 provider preference injection
- Test suite grows from 10 to 20 cases; no existing tests were modified

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write 10 new failing test cases (TDD RED gate) | `1502cd73` | `provider.test.ts` |

## Test Results (RED Gate State)

| Test | RED/GREEN | Requirement |
|------|-----------|-------------|
| injects cache_control on last content block of last user message (array content) | RED | CACHE-03 |
| converts string user content to array with cache_control on last user message | RED | CACHE-03 |
| count guard: stops at 4 cache_control injections total (no 5th injection) | RED | CACHE-03 |
| count guard: partial — injects only remaining slots when some already exist | RED | CACHE-03 |
| non-destructive guard: existing cache_control object is not overwritten | RED | D-01 |
| injects body.provider when account has openrouter_provider_preference | RED | PROV-01 |
| allow_fallbacks defaults to true when absent from stored JSON | RED | D-10 |
| tool block cache_control has { type: "ephemeral" } with no ttl field after transform | GREEN (documents existing behavior) | CACHE-04 |
| does NOT inject body.provider when request already has a provider field | GREEN (negative contract) | PROV-01 |
| corrupt openrouter_provider_preference JSON is ignored | GREEN (negative contract) | D-12 |

## Decisions Made

- Using `{ type: "ephemeral", ttl: "5m" }` as fixture for the non-destructive guard test — current code overwrites with `{ type: "ephemeral" }` only, losing the `ttl` key, so this is a genuine RED failure.
- Count guard partial test uses 3 pre-existing tool cache_controls so current code reaches total=5 (3 tools + system + assistant = 5), clearly failing against the expected 4.
- Two negative-contract tests (client provider preserved, corrupt JSON fail-open) pass immediately and will continue to pass after Plan 03 — they guard against regressions in the new injection logic.
- `as any` cast used for account fixtures per plan spec — no real credentials in test files.

## Deviations from Plan

### Deviation 1: 7 RED tests (not 9 as planned)

**Found during:** Task 1 — running tests after writing all 10 new cases

**Issue:** Plan specified "all 9 new tests FAIL (RED)" but 3 negative-contract tests pass immediately:
1. "does NOT inject body.provider when request already has a provider field" — passes because current code doesn't inject at all; `result.provider` equals the client's value regardless
2. "corrupt openrouter_provider_preference JSON is ignored" — passes because no injection logic exists; `result.provider` is undefined (expected behavior)
3. "tool block cache_control has no ttl field" — explicitly noted in plan as the expected GREEN test (CACHE-04 scope confirmation)

**Resolution:** Kept tests as-is. These are valid regression guards that verify negative behavior both before and after Plan 03. The 7 RED tests cover all positive implementation requirements. The 2 "unexpectedly green" negative-contract tests will remain green after correct implementation — they protect against the new injection logic accidentally overriding client fields or throwing on bad input.

**Files modified:** none (no plan changes needed; deviation documented here)

## Known Stubs

None — this plan only adds tests, no production code.

## Threat Flags

None — test-only changes, no new network endpoints or auth paths.

## Self-Check: PASSED

Files exist:
- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — 575 lines, contains 20 test cases

Commits exist:
- `1502cd73` — test(04-02): add failing tests for cache count guard, 4th breakpoint, provider injection

Tests: 13 pass (10 original + 3 new-green), 7 fail (7 RED gate tests).
