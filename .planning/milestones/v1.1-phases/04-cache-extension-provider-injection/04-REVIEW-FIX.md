---
phase: 04-cache-extension-provider-injection
fixed_at: 2026-05-20T00:00:00Z
review_path: .planning/phases/04-cache-extension-provider-injection/04-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 04: Code Review Fix Report

**Fixed at:** 2026-05-20
**Source review:** `.planning/phases/04-cache-extension-provider-injection/04-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

## Fixed Issues

### WR-01: `toNumOrNull` returns `null` for valid zero timestamps

**Files modified:** `packages/types/src/account.ts`
**Commit:** `6b1e5cbd`
**Applied fix:** Replaced the broken ternary with a clean two-step guard: return `null` if `v == null`, otherwise coerce to `Number` and return `null` only if not finite. Zero timestamps now correctly return `0`.

### WR-02: No HTTP endpoint to write `openrouter_provider_preference`

**Files modified:** `packages/http-api/src/handlers/accounts.ts`, `packages/http-api/src/router.ts`
**Commit:** `28703cc2`
**Applied fix:** Added `createAccountOpenrouterProviderPreferenceHandler` to `accounts.ts` — validates that `order` is a non-empty array of non-empty strings, accepts optional `allow_fallbacks` boolean, checks account existence, and calls `dbOps.setAccountOpenrouterProviderPreference()`. Registered the route in `router.ts` as `PUT /api/accounts/:id/openrouter-provider-preference`. Returns 204 on success.

### WR-03: PostgreSQL `information_schema` query uses `?` placeholders

**Files modified:** `packages/database/src/migrations-pg.ts`
**Commit:** `a32f7460`
**Applied fix:** Updated both `columnExists` to use `$1`, `$2` and `_tableExists` (before removal in IN-01) to use `$1` — replacing non-standard `?` markers with PostgreSQL positional parameters. Both queries now use standard PG placeholder syntax.

### IN-01: `_tableExists` is defined but never called

**Files modified:** `packages/database/src/migrations-pg.ts`
**Commit:** `be4de5ab`
**Applied fix:** Removed the `_tableExists` function entirely. All table creation paths in `runMigrationsPg` use `CREATE TABLE IF NOT EXISTS` directly, making the helper redundant.

### IN-02: `require()` dynamic imports in `accounts.ts`

**Files modified:** `packages/http-api/src/handlers/accounts.ts`
**Commits:** `1b389dfa`, `12e6e4a5`
**Applied fix:** Moved all four provider utility function pairs (`getRepresentativeNanoGPTUtilization/Window`, `getRepresentativeZaiUtilization/Window`, `getRepresentativeKiloUtilization/Window`, `getRepresentativeAlibabaCodingPlanUtilization/Window`) to static named imports at the top of the file. Also imported the specific usage data types (`NanoGPTUsageData`, `ZaiUsageData`, `KiloUsageData`, `AlibabaCodingPlanUsageData`) and added `as` casts at the call sites — this was required because the static imports exposed pre-existing type mismatches that `require()` had silently suppressed.

### IN-03: `any` type assertions in provider test file

**Files modified:** `packages/providers/src/providers/openrouter/__tests__/provider.test.ts`
**Commit:** `1bfc0dd2`
**Applied fix:** Added five inline interfaces at the top of the test file (`TestCacheControl`, `TestContentBlock`, `TestMessage`, `TestTool`, `TestSystemBlock`) and replaced all `(m: any)`, `(t: any)`, `(s: any)`, `(b: any)` casts with the typed interfaces. The `flatMap` call-site was also updated to use `TestContentBlock[]` casts where needed.

### IN-04: Test file comment about old format

**Files modified:** `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts`
**Commit:** `8175367a`
**Applied fix:** Added a multi-line comment above the `setOpenrouterProviderPreference` test suite explaining that the HTTP API (`toAccountResponse`) only surfaces preferences in `{"order":[...], "allow_fallbacks": bool}` object format, and that a bare JSON array string persisted by the repository will be returned as `null` by the API layer.

## Skipped / Not Fixed

None — all findings were successfully fixed.

## Post-Fix Verification

**Lint:** Pass (218 pre-existing warnings, 0 errors — all pre-existing before this phase)
**Typecheck:** Pass (only pre-existing errors from auto-generated inline worker files which must never be touched per CLAUDE.md)
**Format:** Pass

---

_Fixed: 2026-05-20_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
