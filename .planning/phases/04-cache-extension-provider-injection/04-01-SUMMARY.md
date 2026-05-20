---
phase: 04-cache-extension-provider-injection
plan: "01"
subsystem: database-migrations, types, http-api
tags: [pg-migration, type-chain, openrouter, fork-patch, prov-01]
dependency_graph:
  requires: [03-02]
  provides: [openrouter_provider_preference PG migration, structured AccountResponse type]
  affects: [packages/database, packages/types, packages/http-api]
tech_stack:
  added: []
  patterns: [structured-type-parse, nullish-coalescing-default, IIFE-parse-site]
key_files:
  created: []
  modified:
    - packages/database/src/migrations-pg.ts
    - packages/types/src/account.ts
    - packages/http-api/src/handlers/accounts.ts
    - packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts
    - packages/types/src/__tests__/account-mappers.test.ts
decisions:
  - "Store openrouter_provider_preference as JSON object with .order array, not bare array — enables adding allow_fallbacks flag without breaking the shape"
  - "allow_fallbacks defaults to true via nullish coalescing (not ||) to distinguish explicit false from absent"
  - "Old bare-array JSON format now parses to null — enforced by Array.isArray(parsed.order) guard"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-20T06:08:35Z"
  tasks_completed: 2
  files_modified: 5
---

# Phase 4 Plan 01: PG Migration Gap + Type Chain Update Summary

## One-Liner

Ported `openrouter_provider_preference` to both PostgreSQL migration paths and upgraded `AccountResponse.openrouterProviderPreference` from the Phase 3 `string[] | null` placeholder to the production type `{ order: string[]; allowFallbacks: boolean } | null`.

## Objective Achieved

- CLAUDE.md violation closed: every SQLite migration is now ported to PG (both `ensureSchemaPg` CREATE TABLE and `runMigrationsPg` columnsToAdd).
- Type chain unified: `AccountResponse`, `toAccountResponse()`, and the accounts.ts IIFE parse site all carry the structured object shape required by downstream provider injection tests (PROV-01).
- All 11 Phase 3 + Phase 4 tests pass; `bunx tsc --noEmit` returns 0 application-code errors.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix PostgreSQL migration gap | `6dfdb902` | `migrations-pg.ts`, `account-openrouter-preference.test.ts` |
| 2 | Update type chain — AccountResponse shape change | `1f894d36` | `account.ts`, `accounts.ts`, `account-mappers.test.ts` |
| — | Biome formatting fixes (auto) | `c21fbdb6` | 4 files (format only) |

## Decisions Made

- Structured object shape `{ order: string[], allow_fallbacks?: boolean }` chosen as the storage format to support the `provider.order` + `provider.allow_fallbacks` OpenRouter API fields in a single JSON column.
- `allow_fallbacks ?? true` (nullish coalescing) used — preserves explicit `false` values unlike `|| true`.
- Old bare-array format (`["openai","anthropic"]`) now returns `null` rather than being silently promoted — guards against stale data from Phase 3 dev installs being misinterpreted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing test schema missing columns**
- **Found during:** Task 1 — running baseline tests before any changes
- **Issue:** `account-openrouter-preference.test.ts` in-memory SQLite schema was missing `rate_limited_reason`, `rate_limited_at`, and `peak_hours_pause_enabled` columns, causing `SQLiteError: no such column: rate_limited_reason` on 2 of 9 tests
- **Fix:** Added the three missing columns to the `makeDb()` CREATE TABLE statement in the test file
- **Files modified:** `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts`
- **Commit:** `6dfdb902`

**2. [Rule 1 - Bug] Updated outdated test asserting Phase 3 string[] shape**
- **Found during:** Task 2 — running tests after updating parse logic
- **Issue:** `account-mappers.test.ts` had a test asserting `toAccountResponse()` returned `["openai","anthropic"]` (bare array) — no longer correct after the shape change
- **Fix:** Replaced the single old test with 5 tests covering the new structured format: valid object shape, `allowFallbacks` default (true when absent), bare-array format returns null (backwards compat guard), null input, invalid JSON
- **Files modified:** `packages/types/src/__tests__/account-mappers.test.ts`
- **Commit:** `1f894d36`

**3. [Auto - Format] Biome formatting auto-fixes**
- **Found during:** `bun run lint` step
- **Issue:** Biome reformatted multi-property inline types to multi-line style; replaced non-null assertions (`!`) with optional chaining in two unrelated test files
- **Fix:** Committed biome's auto-formatted output
- **Commit:** `c21fbdb6`

## Known Stubs

None — all type fields are fully wired. `openrouterProviderPreference` in `AccountResponse` is parsed from real DB data.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes beyond the planned column.

## Self-Check: PASSED

Files exist:
- packages/database/src/migrations-pg.ts — contains `openrouter_provider_preference TEXT DEFAULT NULL` at line 78
- packages/types/src/account.ts — contains `{ order: string[]; allowFallbacks: boolean } | null` at line 217
- packages/http-api/src/handlers/accounts.ts — contains `Array.isArray(parsed.order)` at line 513

Commits exist:
- `6dfdb902` — fix(04-01): port openrouter_provider_preference to PG migration paths
- `1f894d36` — update(04-01): change AccountResponse.openrouterProviderPreference type to structured object
- `c21fbdb6` — refactor(04-01): apply biome formatting fixes

Tests: 11 pass, 0 fail.
TypeCheck: 0 application-code errors.
