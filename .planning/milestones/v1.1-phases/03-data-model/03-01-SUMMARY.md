---
phase: 03-data-model
plan: 01
subsystem: database, types
tags: [tdd, test-scaffold, prov-02, openrouter, data-model]
dependency_graph:
  requires: []
  provides:
    - "Failing repository test scaffold for AccountRepository.setOpenrouterProviderPreference()"
    - "Failing type mapper tests for toAccount() and toAccountResponse() openrouter_provider_preference field"
  affects:
    - packages/database/src/repositories/account.repository.ts
    - packages/types/src/account.ts
tech_stack:
  added: []
  patterns:
    - "bun:test with in-memory SQLite — matches account-pause-reason.test.ts template"
    - "makeRow()/makeAccount() factory pattern for type test isolation"
key_files:
  created:
    - packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts
    - packages/types/src/__tests__/account-mappers.test.ts
  modified: []
decisions:
  - "makeAccount() factory in type mapper tests uses `as Account` cast to allow testing the pre-implementation state where openrouter_provider_preference does not yet exist on Account"
  - "makeDb() schema in repository tests includes openrouter_provider_preference TEXT column even though production DB does not have it yet — this lets the column-exists tests fail for the right reason (SELECT not returning the column) rather than schema errors"
  - "packages/types/src/__tests__/ directory created new — no pre-existing type tests in this package"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-05T11:35:21Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 03 Plan 01: TDD Test Scaffolds for PROV-02 Data Model Summary

## What Was Built

Two failing test scaffold files that define the behavioral contract for the PROV-02 data model change (per-account OpenRouter provider preference). These tests are intentionally RED — they will remain failing until Plan 02 implements the schema migration, repository method, and type mapper changes.

## Files Created

### 1. `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts`
- 4 tests in `describe("AccountRepository — openrouter provider preference")`
- Covers: `setOpenrouterProviderPreference(id, value)`, `setOpenrouterProviderPreference(id, null)`, `findById()` SELECT coverage, `findAll()` SELECT coverage
- In-memory SQLite schema includes `openrouter_provider_preference TEXT` column
- Follows `account-pause-reason.test.ts` pattern exactly (same imports, lifecycle, helper shapes)
- `// FORK PATCH: PROV-02` comment on module-level doc block per fork annotation convention

### 2. `packages/types/src/__tests__/account-mappers.test.ts`
- 5 tests across two `describe` blocks
- `toAccount()` block: JSON string passthrough and undefined→null coercion
- `toAccountResponse()` block: JSON parse to `string[]`, null passthrough, invalid JSON → null (try/catch guard)
- `makeRow()` and `makeAccount()` factory helpers using `as AccountRow` and `as Account` casts

## RED State Verification

```
bun test packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts \
         packages/types/src/__tests__/account-mappers.test.ts --timeout 10000

0 pass
9 fail
9 expect() calls
Ran 9 tests across 2 files. [25.00ms]
```

Failure modes (as expected):
- Repository tests: 2× `TypeError: repo.setOpenrouterProviderPreference is not a function` (method not on repository yet)
- Repository tests: 2× `undefined` instead of JSON string / `null` (column not in SELECT list yet)
- Mapper tests: 5× `undefined` instead of expected values (property not on Account/AccountRow/AccountResponse yet)

Zero import errors, zero syntax errors.

## Structural Decisions

**makeAccount() with `as Account` cast:** The `Account` interface does not yet include `openrouter_provider_preference`. Using `as Account` allows the factory to inject the field for testing, making the factory forward-compatible — when Plan 02 adds the field to the interface, the cast becomes unnecessary but harmless.

**In-memory schema includes the new column:** The test DB schema adds `openrouter_provider_preference TEXT` even though the production DB migration hasn't run yet. This isolates the test failures to the correct layer (repository logic / SELECT list) rather than SQLite "no such column" errors.

**New `__tests__/` directory for `packages/types`:** No existing test directory existed. Created fresh to avoid placing tests at the package root level.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 6b0485e | Repository test scaffold — 4 RED tests for SELECT/UPDATE |
| 2 | b242aa0 | Type mapper test scaffold — 5 RED tests for toAccount/toAccountResponse |

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None — test files only, no new network endpoints, auth paths, or schema changes in production code.

## Self-Check: PASSED

- [x] `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts` exists
- [x] `packages/types/src/__tests__/account-mappers.test.ts` exists
- [x] Commit 6b0485e exists: `git log --oneline | grep 6b0485e`
- [x] Commit b242aa0 exists: `git log --oneline | grep b242aa0`
- [x] 9 total failures, 0 passes — RED state confirmed
- [x] Zero syntax/import errors in test output
