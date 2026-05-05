# Phase 3: Data Model — Research

**Researched:** 2026-05-05
**Domain:** SQLite schema migration + TypeScript type chain extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `openrouter_provider_preference` is typed as `string | null` in both `AccountRow` and `Account` — raw JSON string, consistent with the `model_mappings` pattern. Phase 4 will `JSON.parse()` when constructing `provider.order`.
- **D-02:** Inline field comment on both `AccountRow` and `Account`: `// FORK PATCH: JSON string for OpenRouter provider.order preference`
- **D-03:** Phase 3 completes the full type chain — `openrouterProviderPreference: string[] | null` is added to `AccountResponse` and `toAccountResponse()` parses the raw JSON string into an array (same pattern as `modelMappings`). Phases 5 and 6 can read/display the field without further type changes.

### Claude's Discretion

- Repository method naming and placement (dedicated `updateOpenrouterProviderPreference()` vs inline query) — follow the existing pattern for similar fields (e.g., `billing_type`)
- Whether to add a try/catch around the JSON parse in `toAccountResponse()` — follow the same guard pattern used for `modelMappings`

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROV-02 | Account schema extended with `openrouter_provider_preference TEXT DEFAULT NULL` column; account type, repository SELECT/UPDATE queries, and `database-operations.ts` facade updated; all changes annotated with `// FORK PATCH:` | Migration pattern, type chain, repository pattern, facade pattern — all verified from source |
</phase_requirements>

---

## Summary

Phase 3 adds a single nullable TEXT column to the `accounts` table and propagates it through the complete type chain: `migrations.ts` → `AccountRow` → `Account` → `AccountResponse`. The pattern is established and well-worn — the `model_mappings` field (JSON string stored in DB, parsed to object in `toAccountResponse()`) is an exact template. The `billing_type` field is an exact template for the repository UPDATE method.

The codebase uses `bun:sqlite` directly; migrations run as a single transaction inside `runMigrations()` using `!columnNames.includes(...)` guards, which makes them idempotent and safe for existing databases. No new migration versioning system exists — columns are guarded by PRAGMA column inspection, not by a version number.

**Primary recommendation:** Follow the `model_mappings` / `billing_type` template exactly. Four files touch this change: `migrations.ts`, `packages/types/src/account.ts`, `packages/database/src/repositories/account.repository.ts`, `packages/database/src/database-operations.ts`.

---

## Standard Stack

### Core (all verified from codebase)

| Component | Location | Purpose |
|-----------|----------|---------|
| `bun:sqlite` | Bun runtime built-in | SQLite database driver |
| `migrations.ts` | `packages/database/src/migrations.ts` | All schema changes — single function `runMigrations()` |
| `AccountRow` | `packages/types/src/account.ts` line 83 | DB row type — snake_case field names |
| `Account` | `packages/types/src/account.ts` line 117 | Domain model — snake_case field names |
| `AccountResponse` | `packages/types/src/account.ts` line 162 | API response — camelCase field names |
| `toAccount()` | `packages/types/src/account.ts` line 283 | Mapper: `AccountRow` → `Account` |
| `toAccountResponse()` | `packages/types/src/account.ts` line 318 | Mapper: `Account` → `AccountResponse` |
| `AccountRepository` | `packages/database/src/repositories/account.repository.ts` | DB queries |
| `DatabaseOperations` | `packages/database/src/database-operations.ts` | Facade over repositories |

No new packages are required. [VERIFIED: codebase grep]

---

## Architecture Patterns

### Migration Pattern

**What:** Each new `accounts` column is added inside the `migrationTx` transaction in `runMigrations()` using an idempotency guard: read `PRAGMA table_info(accounts)` into `initialAccountsColumnNames` at the top of the function, then `if (!initialAccountsColumnNames.includes("column_name"))` before calling `ALTER TABLE`. [VERIFIED: migrations.ts lines 337–471]

**Column type to use:** `TEXT DEFAULT NULL` — exactly matching `model_mappings` (line 422) and `billing_type` (line 441). [VERIFIED: migrations.ts]

**Example (billing_type at line 441):**
```typescript
// Source: packages/database/src/migrations.ts lines 441-446
if (!initialAccountsColumnNames.includes("billing_type")) {
    db.prepare(
        "ALTER TABLE accounts ADD COLUMN billing_type TEXT DEFAULT NULL",
    ).run();
    log.info("Added billing_type column to accounts table");
}
```

**The new migration block for this phase:**
```typescript
// FORK PATCH: add openrouter_provider_preference for per-account provider.order injection
if (!initialAccountsColumnNames.includes("openrouter_provider_preference")) {
    db.prepare(
        "ALTER TABLE accounts ADD COLUMN openrouter_provider_preference TEXT DEFAULT NULL",
    ).run();
    log.info("Added openrouter_provider_preference column to accounts table");
}
```

### AccountRow Type Pattern

`AccountRow` uses optional `?` for fields that were added after the initial table creation (they may be absent on very old rows). [VERIFIED: account.ts lines 94–113]

```typescript
// Source: packages/types/src/account.ts (example: model_mappings field)
model_mappings?: string | null; // JSON string for OpenAI-compatible providers
```

**New field for `AccountRow`:**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouter_provider_preference?: string | null;
```

### Account Domain Model Pattern

`Account` uses non-optional fields for all persisted columns — the mapper `toAccount()` normalizes undefined to `null` via `row.field || null`. [VERIFIED: account.ts lines 117–148]

```typescript
// Source: packages/types/src/account.ts (example: model_mappings on Account)
model_mappings: string | null; // JSON string for OpenAI-compatible providers
```

**New field for `Account`:**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouter_provider_preference: string | null;
```

**Corresponding `toAccount()` mapping:**
```typescript
openrouter_provider_preference: row.openrouter_provider_preference || null,
```

### AccountResponse + toAccountResponse() Pattern

`AccountResponse` carries the parsed form. `toAccountResponse()` parses JSON with a try/catch guard. [VERIFIED: account.ts lines 162–402]

**Template (from modelMappings, lines 332–354):**
```typescript
let modelMappings: { [key: string]: string } | null = null;
if (account.model_mappings) {
    try {
        const parsed = JSON.parse(account.model_mappings);
        modelMappings =
            typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
        modelMappings = null;
    }
}
```

**New field in `AccountResponse`:**
```typescript
openrouterProviderPreference: string[] | null;
```

**New parse block in `toAccountResponse()` (before the return):**
```typescript
// FORK PATCH: parse openrouter_provider_preference JSON string to string[]
let openrouterProviderPreference: string[] | null = null;
if (account.openrouter_provider_preference) {
    try {
        const parsed = JSON.parse(account.openrouter_provider_preference);
        openrouterProviderPreference = Array.isArray(parsed) ? parsed : null;
    } catch {
        openrouterProviderPreference = null;
    }
}
```

**In the return object:**
```typescript
openrouterProviderPreference,
```

### Repository SELECT Pattern

Both `findAll()` and `findById()` maintain explicit SELECT column lists. All columns that should be available on `AccountRow` must appear in both lists. [VERIFIED: account.repository.ts lines 10–61]

**New column to add to both SELECT lists:**
```sql
openrouter_provider_preference
```

No COALESCE needed — it's a nullable TEXT field with no boolean coercion required.

**Important gap found:** `peak_hours_pause_enabled` is NOT in the repository SELECT list (confirmed by grep), yet it exists in `Account` and `AccountRow`. It is set via the facade directly (`adapter.run(...)` in `database-operations.ts` line 487). The new field should be added to the SELECT list to avoid this gap. [VERIFIED: codebase grep]

### Repository UPDATE Method Pattern

`setBillingType` is the direct template: a dedicated method accepting `string | null`, single `UPDATE` query. [VERIFIED: account.repository.ts lines 203–211]

```typescript
// Source: packages/database/src/repositories/account.repository.ts lines 203-211
async setBillingType(
    accountId: string,
    billingType: string | null,
): Promise<void> {
    await this.run(`UPDATE accounts SET billing_type = ? WHERE id = ?`, [
        billingType,
        accountId,
    ]);
}
```

**New repository method:**
```typescript
// FORK PATCH: update openrouter_provider_preference for per-account provider.order injection
async setOpenrouterProviderPreference(
    accountId: string,
    preference: string | null,
): Promise<void> {
    await this.run(
        `UPDATE accounts SET openrouter_provider_preference = ? WHERE id = ?`,
        [preference, accountId],
    );
}
```

### Facade Pattern

`DatabaseOperations` wraps repository methods with `withDatabaseRetry()`. The `setAccountBillingType` method at line 447 is the template. [VERIFIED: database-operations.ts lines 447–453]

```typescript
// Source: packages/database/src/database-operations.ts lines 447-453
async setAccountBillingType(
    accountId: string,
    billingType: string | null,
): Promise<void> {
    await this.accounts.setBillingType(accountId, billingType);
}
```

**New facade method:**
```typescript
// FORK PATCH: set per-account OpenRouter provider preference
async setAccountOpenrouterProviderPreference(
    accountId: string,
    preference: string | null,
): Promise<void> {
    await this.accounts.setOpenrouterProviderPreference(accountId, preference);
}
```

Note: `setBillingType` does NOT use `withDatabaseRetry` in the facade (unlike most other account methods). Follow the same pattern — no retry wrapper.

### FORK PATCH Annotation Style

Annotation goes inline on the line directly preceding the fork-specific code block. [VERIFIED: packages/providers/src/providers/openrouter/provider.ts lines 39, 119]

```typescript
// FORK PATCH: 3-breakpoint cache_control injection (tools, system, last assistant turn)
```

No block comment (`/* */`). No trailing description on the annotated code line itself — the comment sits on its own line immediately before.

### Anti-Patterns

- **Omitting COALESCE for boolean-like fields:** Only boolean columns need `COALESCE(col, 0)` in SELECT. TEXT nullable fields do not need it. Do not add `COALESCE(openrouter_provider_preference, '')` — pass NULL through directly.
- **Adding the column to `ensureSchema()` instead of `runMigrations()`:** `ensureSchema()` defines the base schema for fresh installs via `CREATE TABLE IF NOT EXISTS`. The `accounts` table in `ensureSchema()` does NOT include columns added via migration (confirmed: `model_mappings`, `billing_type`, `peak_hours_pause_enabled` all absent from `ensureSchema()`). Adding to `runMigrations()` only is correct — the migration guard handles both fresh and existing databases.
- **Missing field in `toAccount()`:** If `openrouter_provider_preference` is added to `AccountRow` and `Account` but not mapped in `toAccount()`, Phase 4 will read `undefined` instead of `null`. Map it.
- **Missing field in both SELECT queries:** `findAll()` and `findById()` both have explicit column lists. Both must be updated.

---

## Solved Problems

| Problem | Existing Solution |
|---------|------------------|
| Idempotent ALTER TABLE | PRAGMA column inspection guard (already in `runMigrations()`) |
| JSON string round-trip | `JSON.parse` with try/catch (already in `toAccountResponse()` for `modelMappings`) |
| Nullable TEXT column update | Parameterized query with `null` literal (already in `setBillingType`) |
| Retry on DB contention | `withDatabaseRetry()` wrapper (available in `database-operations.ts`) |

---

## Common Pitfalls

### Pitfall 1: Column missing from one SELECT query

**What goes wrong:** `findAll()` returns `openrouter_provider_preference` but `findById()` does not (or vice versa), causing inconsistency between list views and single-account lookups.
**Root cause:** The two SELECT queries in `account.repository.ts` are duplicated; modifying one without the other.
**Prevention:** Update both SELECT lists in the same edit. Tests that fetch by ID vs. list will catch this.
**Warning signs:** `account.openrouter_provider_preference` is `undefined` in one path but `null` in another.

### Pitfall 2: Field absent from `toAccount()` mapper

**What goes wrong:** `Account.openrouter_provider_preference` is `undefined` at runtime even though the column exists in the DB row.
**Root cause:** `AccountRow` and `Account` declared the field but `toAccount()` return object was not updated.
**Prevention:** After updating `AccountRow` and `Account`, immediately update the `toAccount()` return object.

### Pitfall 3: FORK PATCH annotation on wrong line

**What goes wrong:** Annotation placed on the same line as code (`await this.run(... // FORK PATCH:`) rather than on a preceding standalone comment line.
**Root cause:** Misreading the annotation style from existing examples.
**Prevention:** The annotation is always a `// FORK PATCH:` comment on its own line directly before the code block.

### Pitfall 4: Adding column to `ensureSchema()` instead of `runMigrations()`

**What goes wrong:** Existing databases never receive the column (they skip `CREATE TABLE IF NOT EXISTS`); fresh installs get the column but without the migration guard.
**Root cause:** Confusion about the two-phase schema setup (`ensureSchema` = base table structure; `runMigrations` = column additions for existing DBs).
**Prevention:** All column additions go into `runMigrations()` inside the `migrationTx` transaction with the PRAGMA guard. [VERIFIED: migrations.ts — `model_mappings`, `billing_type`, `peak_hours_pause_enabled` all in `runMigrations()` only]

---

## Files to Change

| File | Change | Lines of Impact |
|------|--------|----------------|
| `packages/database/src/migrations.ts` | Add migration block inside `migrationTx` after `billing_type` block | ~6 lines |
| `packages/types/src/account.ts` | Add field to `AccountRow`, `Account`, `AccountResponse`; update `toAccount()`, `toAccountResponse()` | ~10 lines across 5 locations |
| `packages/database/src/repositories/account.repository.ts` | Add to both SELECT lists; add `setOpenrouterProviderPreference()` method | ~3 lines in SELECTs + ~8 lines method |
| `packages/database/src/database-operations.ts` | Add `setAccountOpenrouterProviderPreference()` facade method | ~6 lines |

**Total estimated diff:** ~35 lines across 4 files.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in Bun test runner) |
| Config file | No separate config — runs via `bun test` |
| Quick run command | `bun test packages/database` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-02 | Migration adds column without data loss | integration | `bun test packages/database/src/migrations.test.ts` | yes |
| PROV-02 | SELECT queries return new field | unit | `bun test packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts` | no — Wave 0 |
| PROV-02 | UPDATE persists value and NULL correctly | unit | `bun test packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts` | no — Wave 0 |
| PROV-02 | `toAccount()` maps field correctly | unit | `bun test packages/types` | no — Wave 0 |
| PROV-02 | `toAccountResponse()` parses JSON to string[] | unit | `bun test packages/types` | no — Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test packages/database packages/types`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts` — covers repository SELECT/UPDATE for PROV-02
  - Template: `packages/database/src/repositories/__tests__/account-pause-reason.test.ts` (uses in-memory DB, minimal schema, `BunSqlAdapter`, `AccountRepository`)
  - Must add `openrouter_provider_preference TEXT` to the minimal schema in the test helper
- [ ] Type mapper tests for `toAccount()` and `toAccountResponse()` — can be added to a new `packages/types/src/__tests__/account-mappers.test.ts` or inline in the existing test if one exists

Note: `packages/database/src/migrations.test.ts` already exists and tests column presence. The migration test should be extended to assert `openrouter_provider_preference` is present after `runMigrations()`.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all changes are code/schema only; `bun:sqlite` is a Bun built-in).

---

## Security Domain

Security enforcement is enabled (absent from config = enabled).

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes (on write) | Phase 5 (REST API) will validate; Phase 3 (data model) just stores TEXT — no validation at this layer |
| V2 Authentication | no | No auth change |
| V3 Session Management | no | No session change |
| V4 Access Control | no | No access control change |
| V6 Cryptography | no | Field value is not sensitive |

**Known threat patterns:** The `openrouter_provider_preference` field stores a JSON array of provider names (e.g., `["openai", "anthropic"]`). At the data model layer:
- Parameterized queries prevent SQL injection (existing pattern, unchanged) [VERIFIED: repository uses `this.run()` with `[value, id]` parameters]
- JSON is stored opaque; no server-side execution of the string
- Input validation (length limits, valid JSON, valid provider names) is a Phase 5 concern

---

## Assumptions Log

All claims in this research were verified directly from the codebase source files. No assumptions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

**All claims verified from source.**

---

## Open Questions

None blocking planning. The pattern is fully established in the codebase.

---

## Sources

### Primary (HIGH confidence — verified from source)

- `packages/database/src/migrations.ts` — migration transaction structure, column guard pattern, `billing_type` and `model_mappings` templates [VERIFIED: full file read]
- `packages/types/src/account.ts` — `AccountRow`, `Account`, `AccountResponse`, `toAccount()`, `toAccountResponse()`, `modelMappings` JSON parse pattern [VERIFIED: full file read]
- `packages/database/src/repositories/account.repository.ts` — SELECT column lists, `setBillingType` UPDATE method template [VERIFIED: full file read]
- `packages/database/src/database-operations.ts` — facade method pattern, `setAccountBillingType` template [VERIFIED: full file read]
- `packages/providers/src/providers/openrouter/provider.ts` — `// FORK PATCH:` annotation style [VERIFIED: grep output]
- `packages/database/src/repositories/__tests__/account-pause-reason.test.ts` — test template for repository unit tests [VERIFIED: full file read]
- `~/.config/better-ccflare/better-ccflare.db` — live column list via `PRAGMA table_info(accounts)` [VERIFIED: sqlite3 query]

---

## Metadata

**Confidence breakdown:**
- Migration pattern: HIGH — read from source, confirmed against live DB
- Type chain pattern: HIGH — read from source, direct template identified
- Repository pattern: HIGH — read from source, direct template identified
- Facade pattern: HIGH — read from source, direct template identified
- Test infrastructure: HIGH — confirmed `bun:test`, existing test files read

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (stable library pattern — no external dependencies)
