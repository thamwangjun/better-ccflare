# Phase 3: Data Model - Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 5 (4 modified + 1 new test)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/database/src/migrations.ts` | migration | batch | `billing_type` block at line 441 | exact |
| `packages/types/src/account.ts` | model | transform | `model_mappings` / `billing_type` fields in same file | exact |
| `packages/database/src/repositories/account.repository.ts` | repository | CRUD | `setBillingType` method at line 203 | exact |
| `packages/database/src/database-operations.ts` | service (facade) | CRUD | `setAccountBillingType` method at line 447 | exact |
| `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts` | test | CRUD | `account-pause-reason.test.ts` (full file) | exact |

---

## Pattern Assignments

### `packages/database/src/migrations.ts` (migration, batch)

**Analog:** `billing_type` block at lines 440–446 of same file.

**Insertion point:** Append after the `pause_reason` block (last accounts-table migration, around line 487). This is the tail of the `migrationTx` accounts section.

**Core migration pattern** (lines 440–446):
```typescript
// Add billing_type column for per-account billing classification
if (!initialAccountsColumnNames.includes("billing_type")) {
	db.prepare(
		"ALTER TABLE accounts ADD COLUMN billing_type TEXT DEFAULT NULL",
	).run();
	log.info("Added billing_type column to accounts table");
}
```

**New block to add (copy this pattern exactly):**
```typescript
// FORK PATCH: add openrouter_provider_preference for per-account provider.order injection
if (!initialAccountsColumnNames.includes("openrouter_provider_preference")) {
	db.prepare(
		"ALTER TABLE accounts ADD COLUMN openrouter_provider_preference TEXT DEFAULT NULL",
	).run();
	log.info("Added openrouter_provider_preference column to accounts table");
}
```

**Key rules:**
- Goes inside the `migrationTx` transaction body, NOT in `ensureSchema()`
- `initialAccountsColumnNames` is already declared at the top of `runMigrations()` — do not redeclare
- The `TEXT DEFAULT NULL` type matches `billing_type` and `model_mappings` exactly
- The `// FORK PATCH:` comment is a standalone line directly preceding the `if` block

---

### `packages/types/src/account.ts` (model, transform)

**Analog:** `model_mappings` / `billing_type` fields in the same file. Five locations within the file must be updated.

#### Location 1 — `AccountRow` interface (lines 83–114)

**Analog field** (line 108):
```typescript
model_mappings?: string | null; // JSON string for OpenAI-compatible providers
```

**New field to add after `billing_type` (line 111):**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouter_provider_preference?: string | null;
```

Pattern: optional `?` (columns added via migration may be absent on old rows), type `string | null`, inline comment on same line (but decision D-02 puts the `// FORK PATCH:` on the line before).

#### Location 2 — `Account` domain interface (lines 117–148)

**Analog field** (line 142–145):
```typescript
model_mappings: string | null; // JSON string for OpenAI-compatible providers
// ...
billing_type: string | null;
```

**New field to add after `billing_type` (line 145):**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouter_provider_preference: string | null;
```

Pattern: non-optional (no `?`), type `string | null`.

#### Location 3 — `AccountResponse` interface (lines 162–194)

**Analog field** (line 184, 192):
```typescript
modelMappings: { [key: string]: string | string[] } | null;
// ...
billingType?: string | null;
```

**New field to add after `billingType` (line 192):**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouterProviderPreference: string[] | null;
```

Pattern: camelCase, parsed type (`string[]` not `string`), non-optional (decision D-03 states Phase 6 reads this directly).

#### Location 4 — `toAccount()` mapper (lines 283–316)

**Analog mapping** (lines 309–312):
```typescript
model_mappings: row.model_mappings || null,
cross_region_mode: row.cross_region_mode || null,
model_fallbacks: row.model_fallbacks || null,
billing_type: row.billing_type || null,
```

**New mapping to add after `billing_type`:**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouter_provider_preference: row.openrouter_provider_preference || null,
```

Pattern: `row.field || null` normalises `undefined` (from old rows) to `null`.

#### Location 5 — `toAccountResponse()` JSON parse block + return (lines 318–402)

**Analog parse block** (lines 331–354):
```typescript
// Parse model mappings (supported for any provider)
let modelMappings: { [key: string]: string } | null = null;
if (account.model_mappings) {
	try {
		const parsed = JSON.parse(account.model_mappings);
		modelMappings =
			typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		// If parsing fails, ignore model mappings
		modelMappings = null;
	}
}
```

**New parse block (before the `return` statement, after `modelFallbacks` block):**
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

**Analog return field** (line 400):
```typescript
billingType: account.billing_type,
```

**New return field to add after `billingType`:**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouterProviderPreference,
```

---

### `packages/database/src/repositories/account.repository.ts` (repository, CRUD)

**Analog:** `setBillingType` method at lines 203–211; SELECT column lists at lines 10–31 and 34–61.

#### SELECT list (both `findAll()` and `findById()`)

**Analog SELECT tail** (lines 24–27 for `findAll`, mirrored in `findById`):
```typescript
model_mappings,
cross_region_mode,
model_fallbacks,
billing_type,
pause_reason,
refresh_token_issued_at
```

**Add after `refresh_token_issued_at` in BOTH SELECT lists:**
```sql
openrouter_provider_preference
```

No `COALESCE` — TEXT nullable fields pass `NULL` through directly. Boolean fields use `COALESCE(col, 0)`; this is not boolean.

**WARNING:** Both `findAll()` (lines 10–31) and `findById()` (lines 34–61) have separate explicit SELECT lists. Both must be updated in the same edit.

#### New UPDATE method

**Analog** (lines 203–211):
```typescript
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

**New method to add after `setBillingType`:**
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

---

### `packages/database/src/database-operations.ts` (service/facade, CRUD)

**Analog:** `setAccountBillingType` at lines 447–452.

**Analog method:**
```typescript
async setAccountBillingType(
	accountId: string,
	billingType: string | null,
): Promise<void> {
	await this.accounts.setBillingType(accountId, billingType);
}
```

**New facade method to add after `setAccountBillingType`:**
```typescript
// FORK PATCH: set per-account OpenRouter provider preference
async setAccountOpenrouterProviderPreference(
	accountId: string,
	preference: string | null,
): Promise<void> {
	await this.accounts.setOpenrouterProviderPreference(accountId, preference);
}
```

**Key rule:** `setAccountBillingType` does NOT use `withDatabaseRetry()`. Follow the same pattern — no retry wrapper for this method.

---

### `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts` (test, CRUD)

**Analog:** `packages/database/src/repositories/__tests__/account-pause-reason.test.ts` (full file, lines 1–185).

**Imports pattern** (lines 10–17):
```typescript
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import "@better-ccflare/core";
import { BunSqlAdapter } from "../../adapters/bun-sql-adapter";
import { AccountRepository } from "../account.repository";
```

**In-memory DB helper pattern** (lines 23–63):
```typescript
function makeDb(): { db: Database; repo: AccountRepository } {
	const db = new Database(":memory:");

	// Minimal schema — only the columns AccountRepository touches
	db.run(`
		CREATE TABLE accounts (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			provider TEXT DEFAULT 'anthropic',
			...
			billing_type TEXT,
			pause_reason TEXT
		)
	`);

	const adapter = new BunSqlAdapter(db);
	const repo = new AccountRepository(adapter);
	return { db, repo };
}
```

**Adaptation required:** Add `openrouter_provider_preference TEXT` to the minimal schema CREATE TABLE. All other existing columns in the schema must remain — the SELECT queries in `findAll()`/`findById()` reference them and will fail if they are absent.

**Insert helper pattern** (lines 65–70):
```typescript
function insertAccount(db: Database, id: string): void {
	db.run(
		`INSERT INTO accounts (id, name, created_at) VALUES (?, ?, ?)`,
		[id, id, Date.now()],
	);
}
```

**Raw query helper pattern** (lines 72–83):
```typescript
interface RawAccount {
	openrouter_provider_preference: string | null;
}

function getAccount(db: Database, id: string): RawAccount {
	return db
		.query<RawAccount, [string]>(
			"SELECT openrouter_provider_preference FROM accounts WHERE id = ?",
		)
		.get(id) as RawAccount;
}
```

**Test structure — what to cover:**
1. `setOpenrouterProviderPreference(id, '["openai","anthropic"]')` — persists the JSON string
2. `setOpenrouterProviderPreference(id, null)` — stores NULL
3. `findById(id)` — returns `openrouter_provider_preference` from SELECT list
4. `findAll()` — returns `openrouter_provider_preference` from SELECT list (verify not undefined)

**Test lifecycle pattern** (lines 89–99):
```typescript
describe("AccountRepository — openrouter provider preference", () => {
	let db: Database;
	let repo: AccountRepository;

	beforeEach(() => {
		({ db, repo } = makeDb());
	});

	afterEach(() => {
		db.close();
	});
	// ...
});
```

---

## Shared Patterns

### FORK PATCH Annotation Style
**Source:** `packages/providers/src/providers/openrouter/provider.ts` (grep confirmed lines 39, 119)
**Apply to:** All five change locations across the four modified files

```typescript
// FORK PATCH: <description of what this patch does>
<fork-specific code line or block>
```

Rules:
- Comment is a standalone `// FORK PATCH:` line on its own — never inline at end of a code line
- Sits directly above the first line of the fork-specific code block
- No block comment (`/* */`) form

### Parameterized Query (SQL Injection Prevention)
**Source:** `packages/database/src/repositories/account.repository.ts` lines 207–210
**Apply to:** The new `setOpenrouterProviderPreference()` method

```typescript
await this.run(`UPDATE accounts SET billing_type = ? WHERE id = ?`, [
	billingType,
	accountId,
]);
```

Always use `?` placeholders with a parameter array — never string interpolation.

### JSON Parse with try/catch Guard
**Source:** `packages/types/src/account.ts` lines 331–354 (`modelMappings` block)
**Apply to:** `toAccountResponse()` parse block for `openrouter_provider_preference`

```typescript
let field: ParsedType | null = null;
if (account.raw_field) {
	try {
		const parsed = JSON.parse(account.raw_field);
		field = <type-check> ? parsed : null;
	} catch {
		field = null;
	}
}
```

The `catch` block always assigns `null` — never re-throws. The `try` wraps both `JSON.parse` and the type check.

### `|| null` Normalization in `toAccount()`
**Source:** `packages/types/src/account.ts` lines 308–312
**Apply to:** The new `openrouter_provider_preference` mapping in `toAccount()`

```typescript
model_mappings: row.model_mappings || null,
```

`AccountRow` fields added via migration are optional (`?`) and may be `undefined` on old rows. The `|| null` coerces `undefined` to `null`, ensuring `Account` always has a typed `string | null` (never `undefined`).

---

## No Analog Found

None — all five files have direct exact analogs in the codebase.

---

## Anti-Patterns to Avoid

| Anti-Pattern | Where It Would Appear | Correct Pattern |
|---|---|---|
| Adding column to `ensureSchema()` | `migrations.ts` | Add to `runMigrations()` migrationTx only |
| `COALESCE(openrouter_provider_preference, '')` in SELECT | `account.repository.ts` SELECT lists | No COALESCE — TEXT nullable fields pass NULL through |
| Updating only `findAll()` SELECT, not `findById()` | `account.repository.ts` | Both SELECT lists must have the column |
| `await this.withDatabaseRetry(...)` wrapper | `database-operations.ts` facade method | No retry wrapper — matches `setAccountBillingType` pattern |
| `// FORK PATCH:` comment inline at end of code line | All modified files | Standalone comment line directly preceding the code block |

---

## Metadata

**Analog search scope:** `packages/database/src/`, `packages/types/src/`, `packages/providers/src/providers/openrouter/`
**Files read:** 6 source files + 1 test file
**Pattern extraction date:** 2026-05-05
