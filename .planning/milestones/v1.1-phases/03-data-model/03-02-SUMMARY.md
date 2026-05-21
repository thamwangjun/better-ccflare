---
phase: 03-data-model
plan: 02
subsystem: database, types, http-api, proxy
tags: [implementation, prov-02, openrouter, data-model, migration, repository, types]
dependency_graph:
  requires:
    - "03-01 (TDD test scaffolds — RED tests to turn GREEN)"
  provides:
    - "DB migration: openrouter_provider_preference TEXT DEFAULT NULL column in accounts table"
    - "Type chain: AccountRow → Account → AccountResponse with openrouter_provider_preference"
    - "Repository: findAll/findById SELECT coverage + setOpenrouterProviderPreference() method"
    - "Facade: setAccountOpenrouterProviderPreference() in DatabaseOperations"
  affects:
    - packages/database/src/migrations.ts
    - packages/types/src/account.ts
    - packages/database/src/repositories/account.repository.ts
    - packages/database/src/database-operations.ts
    - packages/http-api/src/handlers/accounts.ts
    - packages/proxy/src/auto-refresh-scheduler.ts
tech_stack:
  added: []
  patterns:
    - "Idempotency-guarded ALTER TABLE inside migrationTx (same pattern as billing_type, pause_reason)"
    - "Optional field on AccountRow (|| null coercion), non-optional on Account"
    - "JSON.parse with try/catch guard in toAccountResponse() — same pattern as modelMappings"
    - "setBillingType() template for setOpenrouterProviderPreference() without withDatabaseRetry()"
key_files:
  created: []
  modified:
    - packages/database/src/migrations.ts (+8 lines — migration block)
    - packages/types/src/account.ts (+30 lines — 5 interface/mapper edits)
    - packages/database/src/repositories/account.repository.ts (+16 lines — 2 SELECT edits + new method)
    - packages/database/src/database-operations.ts (+8 lines — facade method)
    - packages/http-api/src/handlers/accounts.ts (+15 lines — SELECT + type + return object)
    - packages/proxy/src/auto-refresh-scheduler.ts (+6 lines — 3 Account literal fixes)
decisions:
  - "Fix d=1 dependents inline per CLAUDE.md requirement — accounts.ts handler and auto-refresh-scheduler.ts needed the new Account field to pass typecheck"
  - "accounts.ts handler SELECT extended with openrouter_provider_preference — handler constructs AccountResponse from raw SQL query, not via toAccountResponse(), so field must be added to both its local type and SELECT list"
  - "setAccountOpenrouterProviderPreference() does NOT wrap in withDatabaseRetry() — follows setBillingType() template exactly per RESEARCH.md guidance"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-05"
  tasks_completed: 3
  files_created: 0
  files_modified: 6
---

# Phase 03 Plan 02: PROV-02 Data Model Implementation Summary

## What Was Built

Complete implementation of the PROV-02 data model change: DB migration, type chain (AccountRow -> Account -> AccountResponse), repository SELECT/UPDATE, and facade delegate. All 9 Plan 01 RED tests now pass GREEN.

## Files Modified

### 1. `packages/database/src/migrations.ts` (+8 lines)
- Migration block inside `migrationTx` after `pause_reason` block
- Idempotency guard: `if (!initialAccountsColumnNames.includes("openrouter_provider_preference"))`
- `ALTER TABLE accounts ADD COLUMN openrouter_provider_preference TEXT DEFAULT NULL`
- FORK PATCH annotation at line 490

### 2. `packages/types/src/account.ts` (+30 lines)
- `AccountRow`: `openrouter_provider_preference?: string | null` (optional — old rows may lack it)
- `Account`: `openrouter_provider_preference: string | null` (non-optional — toAccount() normalizes)
- `AccountResponse`: `openrouterProviderPreference: string[] | null` (parsed array per D-03)
- `toAccount()`: `openrouter_provider_preference: row.openrouter_provider_preference || null`
- `toAccountResponse()`: parse block with JSON.parse/try-catch, Array.isArray guard

### 3. `packages/database/src/repositories/account.repository.ts` (+16 lines)
- `findAll()` SELECT: added `openrouter_provider_preference` after `refresh_token_issued_at`
- `findById()` SELECT: same addition (both lists updated per RESEARCH.md Pitfall 1)
- `setOpenrouterProviderPreference()` method: parameterized UPDATE query (T-03-02-01 mitigation)

### 4. `packages/database/src/database-operations.ts` (+8 lines)
- `setAccountOpenrouterProviderPreference()` facade delegates to `accounts.setOpenrouterProviderPreference()`
- No `withDatabaseRetry()` wrapper — follows `setBillingType` template

### 5. `packages/http-api/src/handlers/accounts.ts` (+15 lines) — deviation fix
- Added `openrouter_provider_preference: string | null` to inline query type
- Added `openrouter_provider_preference` to raw SQL SELECT list
- Added `openrouterProviderPreference` to AccountResponse return object with try/catch parse

### 6. `packages/proxy/src/auto-refresh-scheduler.ts` (+6 lines) — deviation fix
- Added `openrouter_provider_preference: null` to 3 `Account` object literals (lines ~297, ~770, ~895)

## Test GREEN Confirmation

```
bun test packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts \
         packages/types/src/__tests__/account-mappers.test.ts --timeout 10000

 9 pass
 0 fail
 11 expect() calls
Ran 9 tests across 2 files. [23.00ms]
```

Full package suite:
```
bun test packages/database packages/types --timeout 10000

 74 pass
 0 fail
 188 expect() calls
Ran 74 tests across 10 files. [2.13s]
```

## typecheck / lint / format Status

- `bun run typecheck`: PASS (0 errors in application code; inline-worker/tiktoken build artifact errors are pre-existing)
- `bun run lint`: 27 errors, 158 warnings — ALL PRE-EXISTING in dashboard React components (noted in STATE.md; do not fix unless Phase 6 touches those files)
- `bun run format`: PASS — no fixes needed after lint auto-applied

## FORK PATCH Annotation Locations

| File | Line | Annotation |
|------|------|------------|
| `packages/database/src/migrations.ts` | 490 | `// FORK PATCH: add openrouter_provider_preference for per-account provider.order injection` |
| `packages/types/src/account.ts` | 114 | `// FORK PATCH: JSON string for OpenRouter provider.order preference` (AccountRow) |
| `packages/types/src/account.ts` | 150 | `// FORK PATCH: JSON string for OpenRouter provider.order preference` (Account) |
| `packages/types/src/account.ts` | 197 | `// FORK PATCH: JSON string for OpenRouter provider.order preference` (AccountResponse) |
| `packages/types/src/account.ts` | 321 | `// FORK PATCH: JSON string for OpenRouter provider.order preference` (toAccount) |
| `packages/types/src/account.ts` | 374 | `// FORK PATCH: parse openrouter_provider_preference JSON string to string[]` (toAccountResponse) |
| `packages/types/src/account.ts` | 420 | `// FORK PATCH: JSON string for OpenRouter provider.order preference` (toAccountResponse return) |
| `packages/database/src/repositories/account.repository.ts` | 215 | `// FORK PATCH: update openrouter_provider_preference for per-account provider.order injection` |
| `packages/database/src/database-operations.ts` | 454 | `// FORK PATCH: set per-account OpenRouter provider preference` |

## setAccountOpenrouterProviderPreference() Does NOT Use withDatabaseRetry()

Confirmed: `setAccountOpenrouterProviderPreference()` delegates directly to `accounts.setOpenrouterProviderPreference()` without `withDatabaseRetry()` wrapper — consistent with the `setBillingType` template pattern (per RESEARCH.md guidance).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] accounts.ts handler constructs AccountResponse from raw SQL, not toAccountResponse()**
- **Found during:** Task 2 typecheck verification
- **Issue:** The accounts list handler in `packages/http-api/src/handlers/accounts.ts` builds `AccountResponse` objects from a raw `db.query()` result rather than calling `toAccountResponse()`. Adding `openrouterProviderPreference` to `AccountResponse` made it required, breaking the handler's return type.
- **Fix:** Added `openrouter_provider_preference` to the handler's inline TypeScript type, to the SQL SELECT list, and added try/catch JSON parse in the return object.
- **Files modified:** `packages/http-api/src/handlers/accounts.ts`
- **Commit:** a752d39

**2. [Rule 1 - Bug] auto-refresh-scheduler.ts creates bare Account literals missing new field**
- **Found during:** Task 2 typecheck verification
- **Issue:** `auto-refresh-scheduler.ts` has 3 inline `const account: Account = { ... }` objects (for OAuth, Qwen, and Codex refresh loops). Adding `openrouter_provider_preference` as non-optional to `Account` broke all three.
- **Fix:** Added `openrouter_provider_preference: null` to each of the 3 Account literals.
- **Files modified:** `packages/proxy/src/auto-refresh-scheduler.ts`
- **Commit:** a752d39

## Known Stubs

None — all data flows are wired. The `openrouterProviderPreference` field is properly mapped from DB through the type chain to the API response.

## Threat Flags

No new threat surface introduced beyond what was analyzed in the plan's threat model. All T-03-02-0x mitigations are implemented:
- T-03-02-01: Parameterized UPDATE query in `setOpenrouterProviderPreference()`
- T-03-02-04: try/catch guard in `toAccountResponse()` and `accounts.ts` handler
- T-03-02-05: Idempotency guard + `TEXT DEFAULT NULL` in migration

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 65676a5 | Migration block in migrations.ts |
| 2 | a752d39 | Type chain + d=1 downstream fixes |
| 3 | ed09d2f | Repository SELECT/UPDATE + facade |

## Self-Check: PASSED

- [x] `packages/database/src/migrations.ts` — grep "openrouter_provider_preference TEXT DEFAULT NULL" returns match
- [x] `packages/types/src/account.ts` — all 5 edits present (AccountRow, Account, AccountResponse, toAccount, toAccountResponse)
- [x] `packages/database/src/repositories/account.repository.ts` — setOpenrouterProviderPreference() present, both SELECTs updated
- [x] `packages/database/src/database-operations.ts` — setAccountOpenrouterProviderPreference() present, no withDatabaseRetry
- [x] Commit 65676a5 exists: migration
- [x] Commit a752d39 exists: types
- [x] Commit ed09d2f exists: repository + facade
- [x] 9/9 Plan 01 tests GREEN
- [x] 74/74 packages/database + packages/types tests GREEN
- [x] typecheck passes (0 application-code errors)
- [x] format passes (no fixes needed)
