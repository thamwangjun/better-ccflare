---
phase: 05-api-layer
plan: "02"
subsystem: http-api
tags: [tdd, green-gate, openrouter, provider-preference, delete-endpoint, fork-patch]
dependency_graph:
  requires: [openrouter-provider-preference-test-suite]
  provides: [openrouter-provider-preference-delete-endpoint]
  affects:
    - packages/http-api/src/handlers/accounts.ts
    - packages/http-api/src/router.ts
tech_stack:
  added: []
  patterns: [tdd-green-gate, fork-patch-annotation, rest-delete-204]
key_files:
  created: []
  modified:
    - packages/http-api/src/handlers/accounts.ts
    - packages/http-api/src/router.ts
decisions:
  - "DELETE handler uses getAdapter().get() for account existence check consistent with PUT handler pattern"
  - "Import order in router.ts sorted alphabetically by biome lint auto-fix; createAccountOpenrouterProviderPreferenceDeleteHandler precedes Handler variant"
  - "Pre-existing typecheck error (embedded-tiktoken-wasm in post-processor.worker.ts) documented as pre-existing deviation"
  - "Pre-existing test failures (2 fail, 7 errors: disk I/O + AsyncDbWriter health) confirmed pre-existing, not caused by this plan"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 2
---

# Phase 05 Plan 02: GREEN Gate — DELETE handler for OpenRouter Provider Preference

## Objective

GREEN gate: Add the DELETE handler to accounts.ts, add the FORK PATCH annotation to the existing PUT handler, register the DELETE route in router.ts — then verify all 11 tests pass.

## What Was Built

**Modified:** `packages/http-api/src/handlers/accounts.ts`
- Added `// FORK PATCH: set per-account OpenRouter provider preference` annotation on the line immediately before `createAccountOpenrouterProviderPreferenceHandler` function definition
- Added `createAccountOpenrouterProviderPreferenceDeleteHandler` export: checks account existence via `SELECT name FROM accounts WHERE id = ?`, returns 404 if not found, calls `setAccountOpenrouterProviderPreference(accountId, null)` to clear the column, returns 204 No Content on success

**Modified:** `packages/http-api/src/router.ts`
- Added `createAccountOpenrouterProviderPreferenceDeleteHandler` import (alphabetical position, before Handler variant)
- Added `// FORK PATCH: clear OpenRouter provider preference` dispatch block immediately after the PUT block and before the generic Account removal block (parts.length === 4 && method === "DELETE")

## New Export

`createAccountOpenrouterProviderPreferenceDeleteHandler` from `packages/http-api/src/handlers/accounts.ts`

Signature: `(dbOps: DatabaseOperations) => (_req: Request, accountId: string) => Promise<Response>`

## Test Results

| Suite | Result |
|-------|--------|
| openrouter-provider-preference.test.ts | 11/11 pass |
| Full test suite | 1453 pass, 2 fail (pre-existing), 7 errors (pre-existing) |

All 11 TDD tests pass: T-01 through T-11 including T-03 (DELETE 204), T-04 (DELETE clears to null), T-09 (DELETE 404).

## FORK PATCH Annotations Added

| File | Location | Annotation |
|------|----------|------------|
| `packages/http-api/src/handlers/accounts.ts` | Line before `createAccountOpenrouterProviderPreferenceHandler` | `// FORK PATCH: set per-account OpenRouter provider preference` |
| `packages/http-api/src/handlers/accounts.ts` | Line before `createAccountOpenrouterProviderPreferenceDeleteHandler` | `// FORK PATCH: clear per-account OpenRouter provider preference` |
| `packages/http-api/src/router.ts` | DELETE dispatch block | `// FORK PATCH: clear OpenRouter provider preference` |

## Lint / Typecheck / Format

| Check | Result |
|-------|--------|
| `bun run lint` | 0 errors, 218 warnings (all pre-existing) |
| `bun run typecheck` | Pre-existing error in `post-processor.worker.ts` (embedded-tiktoken-wasm) — not caused by this plan |
| `bun run format` | "No fixes applied" after lint auto-formatted import order |

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: Add DELETE handler + FORK PATCH annotation to PUT | `fd98a7d7` | `packages/http-api/src/handlers/accounts.ts` |
| Task 2: Register DELETE route in router.ts | `2f6301bf` | `packages/http-api/src/router.ts` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Missing auto-generated inline worker files in worktree**
- **Found during:** Task 1 verification
- **Issue:** Same as Plan 01: the worktree lacks gitignored auto-generated inline worker files (`inline-integrity-check-worker.ts`, `inline-vacuum-worker.ts`, `inline-incremental-vacuum-worker.ts`, `inline-worker.ts`). These are needed at test time for module resolution.
- **Fix:** Copied current versions from main repo into the worktree (not committed; gitignored).
- **Files modified:** Worktree-local copies only — not committed
- **Commit:** N/A (files are gitignored)

**2. [Rule 1 - Pre-existing] Import order reordered by biome lint**
- **Found during:** Task 2 verification (`bun run lint`)
- **Issue:** Biome lint auto-fixed import order in router.ts to alphabetical, placing `createAccountForceResetRateLimitHandler` before the new `createAccountOpenrouterProviderPreferenceDeleteHandler` and `createAccountOpenrouterProviderPreferenceHandler`.
- **Fix:** Accepted biome's auto-formatting (consistent with project style). Import order is now fully alphabetical.
- **Impact:** None — functionality unchanged, imports correctly resolved.

## Known Stubs

None. The DELETE endpoint is fully wired: handler reads from DB, clears the column via `setAccountOpenrouterProviderPreference(accountId, null)`, and returns 204.

## Threat Surface Scan

No new network endpoints beyond the DELETE route specified in the plan's threat model. The T-05-06 mitigation (DELETE block placed before generic account-removal block) is confirmed — DELETE dispatch at line 632 precedes Account removal at line 647 in router.ts.

## Self-Check

- [x] `packages/http-api/src/handlers/accounts.ts` modified with DELETE handler and FORK PATCH annotation on PUT
- [x] `packages/http-api/src/router.ts` modified with import and DELETE dispatch block
- [x] `grep "// FORK PATCH: set per-account OpenRouter provider preference" accounts.ts` → match at line 3594
- [x] `grep "// FORK PATCH: clear per-account OpenRouter provider preference" accounts.ts` → match at line 3659
- [x] `grep "setAccountOpenrouterProviderPreference(accountId, null)" accounts.ts` → match at line 3675
- [x] `grep "FORK PATCH: clear OpenRouter provider preference" router.ts` → match at line 632
- [x] DELETE dispatch block (line 632) appears before Account removal block (line 647)
- [x] Task 1 commit `fd98a7d7` exists
- [x] Task 2 commit `2f6301bf` exists
- [x] All 11 tests pass (0 failures)
- [x] No regressions in full test suite (pre-existing 2 fail confirmed pre-existing)

## Self-Check: PASSED
