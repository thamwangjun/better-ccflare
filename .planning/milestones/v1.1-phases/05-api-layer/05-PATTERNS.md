# Phase 5: API Layer - Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 3 (2 modified, 1 created)
**Analogs found:** 3 / 3

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/http-api/src/handlers/accounts.ts` | handler | request-response (CRUD) | same file — `createAccountOpenrouterProviderPreferenceHandler` (lines 3594–3656) | exact |
| `packages/http-api/src/router.ts` | router | request-response | same file — PUT dispatch block (lines 619–629) | exact |
| `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` | test | CRUD | `packages/http-api/src/handlers/__tests__/model-mappings-update.test.ts` (lines 1–205) | exact |

---

## Pattern Assignments

### `packages/http-api/src/handlers/accounts.ts` — add DELETE handler

**Analog:** `createAccountOpenrouterProviderPreferenceHandler` in the same file, lines 3594–3656.

**Imports pattern** (lines 1–23) — all needed imports already present:
```typescript
import type { DatabaseOperations } from "@better-ccflare/database";
import {
    BadRequest,
    errorResponse,
    NotFound,
} from "@better-ccflare/http-common";
```

**Missing `// FORK PATCH:` annotation fix** — add above line 3594 (the existing PUT handler):
```typescript
// FORK PATCH: set per-account OpenRouter provider preference
export function createAccountOpenrouterProviderPreferenceHandler(
```

**New DELETE handler** — add immediately after line 3656, before the next function:
```typescript
// FORK PATCH: clear per-account OpenRouter provider preference
export function createAccountOpenrouterProviderPreferenceDeleteHandler(
    dbOps: DatabaseOperations,
) {
    return async (_req: Request, accountId: string): Promise<Response> => {
        try {
            const db = dbOps.getAdapter();
            const account = await db.get<{ name: string }>(
                "SELECT name FROM accounts WHERE id = ?",
                [accountId],
            );
            if (!account) {
                return errorResponse(NotFound("Account not found"));
            }
            await dbOps.setAccountOpenrouterProviderPreference(accountId, null);
            return new Response(null, { status: 204 });
        } catch (error) {
            log.error("Account OpenRouter provider preference clear error:", error);
            return errorResponse(
                error instanceof Error
                    ? error
                    : new Error("Failed to clear OpenRouter provider preference"),
            );
        }
    };
}
```

**Core pattern** — 404 guard (lines 3622–3630 of analog):
```typescript
const db = dbOps.getAdapter();
const account = await db.get<{ name: string }>(
    "SELECT name FROM accounts WHERE id = ?",
    [accountId],
);
if (!account) {
    return errorResponse(NotFound("Account not found"));
}
```

**204 response pattern** (line 3646 of analog):
```typescript
return new Response(null, { status: 204 });
```

**Error handling pattern** (lines 3647–3655 of analog):
```typescript
} catch (error) {
    log.error("Account OpenRouter provider preference update error:", error);
    return errorResponse(
        error instanceof Error
            ? error
            : new Error("Failed to update OpenRouter provider preference"),
    );
}
```

---

### `packages/http-api/src/router.ts` — add DELETE route dispatch

**Analog:** PUT dispatch block at lines 619–629 of the same file.

**Import change** — add `createAccountOpenrouterProviderPreferenceDeleteHandler` to the named import block from `"../handlers/accounts"` (lines 3–35). Follow alphabetical order of existing names:
```typescript
// Add alongside existing import:
createAccountOpenrouterProviderPreferenceDeleteHandler,
createAccountOpenrouterProviderPreferenceHandler,
```

**Route dispatch pattern** (lines 619–629 — the existing PUT block):
```typescript
// Account OpenRouter provider preference update
if (
    path.endsWith("/openrouter-provider-preference") &&
    method === "PUT"
) {
    const openrouterPrefHandler =
        createAccountOpenrouterProviderPreferenceHandler(this.context.dbOps);
    return await this.wrapHandler((req) =>
        openrouterPrefHandler(req, accountId),
    )(req, url);
}
```

**New DELETE block** — insert immediately after line 629, before the `// Account removal` block at line 631:
```typescript
// FORK PATCH: clear OpenRouter provider preference
if (
    path.endsWith("/openrouter-provider-preference") &&
    method === "DELETE"
) {
    const deleteHandler =
        createAccountOpenrouterProviderPreferenceDeleteHandler(this.context.dbOps);
    return await this.wrapHandler((req) =>
        deleteHandler(req, accountId),
    )(req, url);
}
```

**Placement constraint:** Must appear BEFORE the generic account-removal block at line 631 (`parts.length === 4 && method === "DELETE"`). The preference path has 5 parts and would not match the generic block, but ordering the specific block first is the established convention for all other sub-resource handlers.

---

### `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` — new test file

**Analog:** `packages/http-api/src/handlers/__tests__/model-mappings-update.test.ts` (lines 1–205).

**Imports pattern** (lines 1–12 of analog):
```typescript
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import type { DatabaseOperations } from "@better-ccflare/database";
import { DatabaseFactory } from "@better-ccflare/database";
import {
    createAccountOpenrouterProviderPreferenceDeleteHandler,
    createAccountOpenrouterProviderPreferenceHandler,
} from "../accounts";
```

**DB path constant** (line 14 of analog pattern):
```typescript
const TEST_DB_PATH = "/tmp/test-openrouter-provider-preference.db";
```

**insertAccount helper** (lines 17–36 of analog):
```typescript
async function insertAccount(
    dbOps: DatabaseOperations,
    name: string,
): Promise<string> {
    const db = dbOps.getAdapter();
    const id = crypto.randomUUID();
    await db.run(
        `INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, name, "openrouter", "tok", Date.now(), 0],
    );
    return id;
}
```

**readPreference helper** (pattern derived from `readMappings` at lines 39–50 of analog):
```typescript
async function readPreference(
    dbOps: DatabaseOperations,
    id: string,
): Promise<{ order: string[]; allow_fallbacks: boolean } | null> {
    const db = dbOps.getAdapter();
    const row = await db.get<{ openrouter_provider_preference: string | null }>(
        "SELECT openrouter_provider_preference FROM accounts WHERE id = ?",
        [id],
    );
    if (!row || row.openrouter_provider_preference === null) return null;
    return JSON.parse(row.openrouter_provider_preference);
}
```

**Request factory helpers** — two separate factories (PUT body, DELETE no body):
```typescript
function makePutRequest(body: unknown): Request {
    return new Request(
        "http://localhost/api/accounts/x/openrouter-provider-preference",
        {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        },
    );
}

function makeDeleteRequest(): Request {
    return new Request(
        "http://localhost/api/accounts/x/openrouter-provider-preference",
        { method: "DELETE" },
    );
}
```

**Lifecycle pattern** (lines 65–84 of analog):
```typescript
beforeAll(() => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    DatabaseFactory.initialize(TEST_DB_PATH);
    dbOps = DatabaseFactory.getInstance();
    putHandler = createAccountOpenrouterProviderPreferenceHandler(dbOps);
    deleteHandler = createAccountOpenrouterProviderPreferenceDeleteHandler(dbOps);
});

afterAll(() => {
    DatabaseFactory.reset();
    try {
        if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    } catch {
        // ignore
    }
});

beforeEach(async () => {
    await dbOps.getAdapter().run("DELETE FROM accounts", []);
});
```

**Required test cases** (D-08 + discretionary T-10, T-11):

| ID | Description | Assert |
|----|-------------|--------|
| T-01 | PUT valid `order` array returns 204 | `response.status === 204` |
| T-02 | PUT persists preference JSON to DB | `readPreference(id).order` equals input |
| T-03 | DELETE returns 204 | `response.status === 204` |
| T-04 | DELETE sets DB column to null | `readPreference(id) === null` |
| T-05 | PUT empty `order` array returns 400 | `response.status === 400` |
| T-06 | PUT missing `order` field returns 400 | `response.status === 400` |
| T-07 | PUT non-string item in `order` returns 400 | `response.status === 400` |
| T-08 | PUT non-existent account returns 404 | `response.status === 404` |
| T-09 | DELETE non-existent account returns 404 | `response.status === 404` |
| T-10 | PUT `allow_fallbacks` defaults to true | stored JSON has `allow_fallbacks: true` |
| T-11 | PUT explicit `allow_fallbacks: false` persisted | stored JSON has `allow_fallbacks: false` |

---

## Shared Patterns

### Handler Factory Pattern
**Source:** `packages/http-api/src/handlers/accounts.ts` lines 3594–3656
**Apply to:** `createAccountOpenrouterProviderPreferenceDeleteHandler`

Every handler is a factory `createXxxHandler(dbOps: DatabaseOperations)` returning `async (req: Request, accountId: string): Promise<Response>`. The factory is instantiated inside the route dispatch and invoked immediately. `req` is prefixed `_req` if unused (DELETE body is absent).

### 404 Guard Pattern
**Source:** `packages/http-api/src/handlers/accounts.ts` lines 3622–3630
**Apply to:** DELETE handler (same as PUT handler)

```typescript
const db = dbOps.getAdapter();
const account = await db.get<{ name: string }>(
    "SELECT name FROM accounts WHERE id = ?",
    [accountId],
);
if (!account) {
    return errorResponse(NotFound("Account not found"));
}
```

Required even for DELETE because SQLite `UPDATE` with no matching row completes silently — without this guard, DELETE returns 204 for non-existent accounts.

### 204 No Content Response
**Source:** `packages/http-api/src/handlers/accounts.ts` line 3646
**Apply to:** DELETE handler

```typescript
return new Response(null, { status: 204 });
```

### Fork Patch Annotation
**Source:** `packages/database/src/database-operations.ts` line 749
**Apply to:** All fork-specific code blocks — the DELETE handler function definition, the router dispatch block for DELETE, and the missing annotation on the existing PUT handler function

```typescript
// FORK PATCH: <one-line description>
```

Goes on the line directly before the fork-specific code block (function definition or `if` dispatch block).

### Error Response Helpers
**Source:** `packages/http-api/src/handlers/accounts.ts` lines 17–23 (already imported)
**Apply to:** DELETE handler — `errorResponse`, `NotFound` are already in scope in `accounts.ts`

```typescript
import {
    BadRequest,
    errorResponse,
    NotFound,
} from "@better-ccflare/http-common";
```

### Test Lifecycle (DatabaseFactory)
**Source:** `packages/http-api/src/handlers/__tests__/model-mappings-update.test.ts` lines 65–84
**Apply to:** New test file

Use `DatabaseFactory.initialize(TEST_DB_PATH)` / `DatabaseFactory.reset()` with a unique path per test file (`/tmp/test-openrouter-provider-preference.db`). Raw SQL insert for seeding. Call `DELETE FROM accounts` in `beforeEach` for isolation.

---

## No Analog Found

None — all three files have exact or near-exact analogs in the codebase.

---

## DB Facade — No Changes Needed

`packages/database/src/database-operations.ts` line 750:
```typescript
// FORK PATCH: set per-account OpenRouter provider preference
async setAccountOpenrouterProviderPreference(
    accountId: string,
    preference: string | null,
): Promise<void>
```

Accepts `null` already. Calling `dbOps.setAccountOpenrouterProviderPreference(accountId, null)` from the DELETE handler writes SQL NULL to the column. No new method or migration needed.

---

## Metadata

**Analog search scope:** `packages/http-api/src/`, `packages/database/src/`
**Files scanned:** 4 (accounts.ts, router.ts, model-mappings-update.test.ts, database-operations.ts)
**Pattern extraction date:** 2026-05-20
