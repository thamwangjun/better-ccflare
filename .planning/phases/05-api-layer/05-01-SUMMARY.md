---
phase: 05-api-layer
plan: "01"
subsystem: http-api
tags: [tdd, red-gate, openrouter, provider-preference, testing]
dependency_graph:
  requires: []
  provides: [openrouter-provider-preference-test-suite]
  affects: [packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts]
tech_stack:
  added: []
  patterns: [bun-test, tdd-red-gate, factory-functions, db-isolation-beforeEach]
key_files:
  created:
    - packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts
  modified: []
decisions:
  - "Copied auto-generated inline worker files from main repo to worktree to resolve test environment blocking issue (Rule 3 deviation)"
  - "Used provider=openrouter in insertAccount helper to reflect realistic account setup"
  - "readPreference helper uses raw SQL SELECT for direct DB state inspection independent of any handler logic"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-20"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 05 Plan 01: RED Gate Test Suite for OpenRouter Provider Preference

## Objective

Write the complete failing test suite (RED gate) for the PUT set-preference endpoint and the not-yet-existing DELETE clear-preference endpoint. Tests must fail at import/compile time because `createAccountOpenrouterProviderPreferenceDeleteHandler` does not exist yet in `accounts.ts`.

## What Was Created

**Test file:** `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts`
- 197 lines, 11 test cases (T-01 through T-11)
- Mirrors the canonical pattern from `model-mappings-update.test.ts`

## Test Cases

| ID | Category | Description |
|----|----------|-------------|
| T-01 | PUT success | Valid order `["openai", "anthropic"]` returns 204 |
| T-02 | PUT persistence | Valid order persists to DB with correct values |
| T-05 | PUT validation | Empty order array `[]` returns 400 |
| T-06 | PUT validation | Missing order field `{}` returns 400 |
| T-07 | PUT validation | Non-string items in order `[123]` returns 400 |
| T-08 | PUT 404 | Non-existent accountId returns 404 |
| T-10 | PUT defaults | No `allow_fallbacks` field defaults to `true` |
| T-11 | PUT explicit | `allow_fallbacks: false` persists as `false` |
| T-03 | DELETE success | DELETE on account with existing preference returns 204 |
| T-04 | DELETE clears | DELETE sets `openrouter_provider_preference` to null |
| T-09 | DELETE 404 | Non-existent accountId returns 404 |

## RED Gate Confirmation

Running `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` produces:

```
SyntaxError: Export named 'createAccountOpenrouterProviderPreferenceDeleteHandler' not found in module
'packages/http-api/src/handlers/accounts.ts'.
  0 pass
  1 fail
  1 error
```

RED gate is confirmed. All 11 tests fail at import/compile time because `createAccountOpenrouterProviderPreferenceDeleteHandler` is not yet exported from `accounts.ts`.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: Write RED gate test file | `30f9ec5f` | `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Missing auto-generated inline worker files in worktree**
- **Found during:** Task 1 verification
- **Issue:** The worktree was initialized from commit b93b656c which predates the auto-generated inline worker files (`inline-integrity-check-worker.ts`, `inline-vacuum-worker.ts`, `inline-incremental-vacuum-worker.ts`, `inline-worker.ts`). These files are referenced at import time but not tracked in git (auto-generated). Without them, `bun test` fails on module resolution before even reaching the test code.
- **Fix:** Copied the current versions of these files from the main repo into the worktree. They are gitignored so they are not committed.
- **Files modified:** Worktree-local copies only — not committed
- **Commit:** N/A (files are gitignored)

## Known Stubs

None — this plan only creates tests, not implementation. The "stub" is intentional: the DELETE handler is deliberately absent until Wave 2 (GREEN gate).

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. Test file only — no production code modified.

## Self-Check

- [x] Test file exists at `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts`
- [x] File has exactly 11 `it()` blocks
- [x] File imports `createAccountOpenrouterProviderPreferenceDeleteHandler` from `../accounts`
- [x] File imports `createAccountOpenrouterProviderPreferenceHandler` from `../accounts`
- [x] TEST_DB_PATH is `/tmp/test-openrouter-provider-preference.db` (unique)
- [x] `bun test` on the file produces failures (RED gate confirmed)
- [x] Task commit `30f9ec5f` exists

## Self-Check: PASSED
