# Phase 5: API Layer - Research

**Researched:** 2026-05-20
**Domain:** HTTP API handler authoring + TDD test setup in `packages/http-api/`
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Add `DELETE /api/accounts/:id/openrouter-provider-preference` — sets `openrouter_provider_preference` to NULL. Separate endpoint; no changes to PUT body contract.
- **D-02:** DELETE returns `204 No Content` on success. Consistent with the existing PUT response.
- **D-03:** DELETE on a non-existent account returns `404 Not Found` (same guard as PUT).
- **D-04:** The existing PUT returns `204 No Content` — no change needed. Dashboard re-fetches the account list after updating.
- **D-05:** No full account object returned from PUT or DELETE. `GET /api/accounts` list is the source of truth for current state.
- **D-06:** No `GET /api/accounts/:id` endpoint added in Phase 5.
- **D-07:** Phase 5 uses TDD with two plans: RED gate (write failing tests) then GREEN gate (add DELETE endpoint + make all tests pass).
- **D-08:** Required test cases for the RED gate:
  1. `PUT` sets preference — valid `order` array persists, returns 204
  2. `DELETE` clears preference — returns 204, preference is null afterward
  3. `PUT` with invalid input — empty `order` array, missing `order` field, non-string items all return 400
  4. `PUT` on non-existent account returns 404
  5. `DELETE` on non-existent account returns 404

### Claude's Discretion

- Test file location: follow existing pattern in `packages/http-api/src/handlers/__tests__/` (co-located in `__tests__/` subdirectory — confirmed by repo scan)
- DELETE handler naming: `createAccountOpenrouterProviderPreferenceDeleteHandler` or similar — follow existing naming convention
- Whether to extract a shared `getAccountOrNotFound()` helper between PUT and DELETE, or keep the guard inline
- Additional test cases beyond D-08 (e.g., `allow_fallbacks` defaulting to true, malformed JSON in stored preference)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROV-03 | REST API supports PATCH to set or clear `openrouter_provider_preference` per account (mirrors existing `model_mappings` handler pattern) | PUT handler exists (Phase 4). DELETE handler is new. Test suite covers both. DB facade `setAccountOpenrouterProviderPreference(id, null)` already accepts null, so no new DB method is needed. |
</phase_requirements>

---

## Summary

Phase 5 adds a `DELETE /api/accounts/:id/openrouter-provider-preference` endpoint alongside the existing `PUT` endpoint committed in Phase 4, and writes a full TDD test suite covering both. The codebase already provides all infrastructure needed: the handler factory pattern is established, the DB facade method accepts `null` to clear, and the router dispatch pattern is present and ready for a second method branch.

The canonical test file to mirror is `packages/http-api/src/handlers/__tests__/model-mappings-update.test.ts`. It uses `bun:test`, `DatabaseFactory` with a real file-based SQLite DB (path `/tmp/test-*.db`), raw SQL inserts to seed test rows, and calls the handler factory directly — no HTTP server involved. All 7 tests in that file pass today.

**Primary recommendation:** Mirror the `model-mappings-update.test.ts` pattern exactly. Place the new test file at `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts`. The DELETE handler body is three lines: check account exists, call `dbOps.setAccountOpenrouterProviderPreference(accountId, null)`, return `new Response(null, { status: 204 })`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:test` | built-in (Bun 1.3.13) | Test runner | Project-wide; already used in all 69 test files |
| `@better-ccflare/database` (`DatabaseFactory`, `DatabaseOperations`) | workspace | DB setup/teardown in tests | Same pattern as `model-mappings-update.test.ts` |
| `@better-ccflare/http-common` (`BadRequest`, `NotFound`, `errorResponse`) | workspace | Error response helpers | Used throughout `accounts.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs` (`existsSync`, `unlinkSync`) | Node built-in | Clean up test DB file | In `beforeAll` / `afterAll` |
| `crypto.randomUUID()` | built-in | Generate account IDs for test rows | In test helper `insertAccount()` |

**No new dependencies.** Everything is already in the workspace.

---

## Architecture Patterns

### Relevant Project Structure

```
packages/http-api/src/
├── handlers/
│   ├── accounts.ts                          # All account handlers — add DELETE handler here
│   └── __tests__/
│       ├── model-mappings-update.test.ts    # CANONICAL test pattern to mirror
│       └── openrouter-provider-preference.test.ts  # NEW file for Phase 5
├── router.ts                                # Route dispatch — add DELETE branch here
```

### Pattern 1: Handler Factory

**What:** Every handler is a factory function `createXxxHandler(dbOps)` that returns `async (req, accountId) => Promise<Response>`. The handler is instantiated inside the route dispatch and invoked immediately.

**When to use:** Always — every handler in `accounts.ts` follows this pattern.

**Example (existing PUT handler, verified in repo):**
```typescript
// Source: packages/http-api/src/handlers/accounts.ts ~line 3594
export function createAccountOpenrouterProviderPreferenceHandler(
    dbOps: DatabaseOperations,
) {
    return async (req: Request, accountId: string): Promise<Response> => {
        // ... validation, 404 guard, DB write ...
        return new Response(null, { status: 204 });
    };
}
```

**DELETE handler (new — same shape, no body parsing):**
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
            return errorResponse(
                error instanceof Error
                    ? error
                    : new Error("Failed to clear OpenRouter provider preference"),
            );
        }
    };
}
```

### Pattern 2: Router Dispatch (method-based branching)

**What:** The router checks `path.endsWith("/openrouter-provider-preference") && method === "PUT"`. The DELETE route is a second `if` block immediately after, same path condition, `method === "DELETE"`.

**Verified in repo (router.ts ~lines 619–629):**
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

**DELETE block to add immediately after:**
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

**Note:** The DELETE branch must be placed BEFORE the `// Account removal` block (`parts.length === 4 && method === "DELETE"` at line ~632) to avoid the DELETE being matched by the generic account-removal handler.

### Pattern 3: TDD Test Setup (canonical pattern from `model-mappings-update.test.ts`)

**What:** Real SQLite file at `/tmp/test-*.db`, initialized with `DatabaseFactory.initialize()`, torn down with `DatabaseFactory.reset()` + `unlinkSync`. Rows seeded with raw SQL. Handler called directly (no HTTP server).

**Verified working:** `bun test packages/http-api/src/handlers/__tests__/model-mappings-update.test.ts` → 7 pass, 0 fail.

```typescript
// Source: packages/http-api/src/handlers/__tests__/model-mappings-update.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import type { DatabaseOperations } from "@better-ccflare/database";
import { DatabaseFactory } from "@better-ccflare/database";

const TEST_DB_PATH = "/tmp/test-openrouter-provider-preference.db";

async function insertAccount(dbOps: DatabaseOperations, name: string): Promise<string> {
    const db = dbOps.getAdapter();
    const id = crypto.randomUUID();
    await db.run(
        `INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, name, "openrouter", "tok", Date.now(), 0],
    );
    return id;
}

async function readPreference(
    dbOps: DatabaseOperations,
    id: string,
): Promise<string | null> {
    const db = dbOps.getAdapter();
    const row = await db.get<{ openrouter_provider_preference: string | null }>(
        "SELECT openrouter_provider_preference FROM accounts WHERE id = ?",
        [id],
    );
    return row?.openrouter_provider_preference ?? null;
}

describe("openrouter-provider-preference handlers", () => {
    let dbOps: DatabaseOperations;

    beforeAll(() => {
        if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
        DatabaseFactory.initialize(TEST_DB_PATH);
        dbOps = DatabaseFactory.getInstance();
    });

    afterAll(() => {
        DatabaseFactory.reset();
        try { if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH); } catch { }
    });

    beforeEach(async () => {
        await dbOps.getAdapter().run("DELETE FROM accounts", []);
    });

    // ... tests ...
});
```

### Anti-Patterns

- **Placing DELETE before PUT in router:** Keep existing PUT block in place; add DELETE immediately after it. Reordering is unnecessary churn.
- **Skipping the 404 guard in DELETE handler:** Even for a no-body operation, account existence must be checked first — deleting a non-existent row silently succeeds in SQLite (`UPDATE` with no matching row does not error), so without the guard, DELETE would return 204 for missing accounts.
- **Calling `setAccountOpenrouterProviderPreference` with `"null"` (string):** Must pass JavaScript `null`, not the string `"null"`. The SQL parameterized query will bind it as SQL NULL.
- **Adding `// FORK PATCH:` only on the handler, not the route block:** Both the handler function definition and the router dispatch block are fork-specific. Both need annotations.

---

## Solved Problems

| Problem | Build Nothing — Use Instead | Why |
|---------|-----------------------------|-----|
| Clear preference in DB | `dbOps.setAccountOpenrouterProviderPreference(accountId, null)` | Method signature is `(accountId: string, preference: string \| null)` — null is already handled. No new DB method needed. |
| 404 guard | `db.get<{ name: string }>("SELECT name FROM accounts WHERE id = ?", [accountId])` | Identical to the PUT handler — copy verbatim. |
| 204 response | `new Response(null, { status: 204 })` | Already used by PUT. |
| Error response | `errorResponse(NotFound(...))`, `errorResponse(BadRequest(...))` | Already imported in `accounts.ts`; no new imports needed. |

---

## DB Facade Verification

`setAccountOpenrouterProviderPreference` signature (verified in `packages/database/src/database-operations.ts` line 750):

```typescript
// FORK PATCH: set per-account OpenRouter provider preference
async setAccountOpenrouterProviderPreference(
    accountId: string,
    preference: string | null,
): Promise<void>
```

The underlying repository method (`packages/database/src/repositories/account.repository.ts` line 225):

```typescript
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

Passing `null` writes SQL NULL to the column. **No new DB method needed.** [VERIFIED: repo grep]

---

## Fork Patch Annotation Convention

**Verified placement:** The `// FORK PATCH:` comment goes on the line **directly before** the fork-specific code block. Examples found in repo:

- `packages/database/src/database-operations.ts` line 749: `// FORK PATCH: set per-account OpenRouter provider preference`
- `packages/database/src/repositories/account.repository.ts` line 224: `// FORK PATCH: update openrouter_provider_preference for per-account provider.order injection`
- `packages/types/src/account.ts` line 216: `// FORK PATCH: JSON string for OpenRouter provider.order preference`

**Required for Phase 5:**
1. Above `createAccountOpenrouterProviderPreferenceDeleteHandler` in `accounts.ts`
2. Above the DELETE route dispatch block in `router.ts`

The PUT handler (`createAccountOpenrouterProviderPreferenceHandler`) was added in Phase 4 (commit `28703cc2`) **without** a `// FORK PATCH:` annotation on the function definition — only inline comments exist inside the handler. Phase 5 should add a `// FORK PATCH:` JSDoc line above the function to align with the convention. [VERIFIED: repo grep]

---

## Common Pitfalls

### Pitfall 1: DELETE matched by generic account-removal handler

**What goes wrong:** The generic account DELETE handler checks `parts.length === 4 && method === "DELETE"`. The path `/api/accounts/:id/openrouter-provider-preference` has 5 parts, so it would not match — but if the new DELETE block is placed AFTER the generic block, a future refactor could cause a mismatch.

**Root cause:** Router dispatches sequentially; wrong block order can shadow the specific handler.

**Prevention:** Place the specific `openrouter-provider-preference` DELETE block immediately after the PUT block, before the generic `// Account removal` block.

**Warning signs:** DELETE returns 404 with "Account not found" when the account exists — indicates the wrong handler ran.

### Pitfall 2: `setAccountOpenrouterProviderPreference(id, null)` does not error on missing account

**What goes wrong:** SQLite `UPDATE` on a non-matching row completes silently with 0 rows affected. Without the 404 guard, DELETE returns 204 for non-existent account IDs.

**Root cause:** SQLite UPDATE does not throw on zero rows affected.

**Prevention:** Always check account existence with `db.get<{ name: string }>("SELECT name FROM accounts WHERE id = ?", [accountId])` before calling the DB method.

### Pitfall 3: `DatabaseFactory` singleton state leaking between test files

**What goes wrong:** If another test file has called `DatabaseFactory.initialize()` without calling `DatabaseFactory.reset()`, the second `initialize()` call will throw.

**Root cause:** `DatabaseFactory` is a singleton.

**Prevention:** Use a unique `TEST_DB_PATH` per test file (e.g., `/tmp/test-openrouter-provider-preference.db`). Call `DatabaseFactory.reset()` in `afterAll`.

### Pitfall 4: Missing `// FORK PATCH:` annotation on router dispatch block

**What goes wrong:** Phase 6 (MAINT-05) requires every fork-specific code block to carry the annotation. Missing annotations will fail the pre-commit review gate.

**Prevention:** Add `// FORK PATCH:` on the line before both the handler function definition and the router dispatch block.

---

## Test Cases Map (D-08 + discretionary)

| # | Test | Type | Expect |
|---|------|------|--------|
| T-01 | PUT valid `order` array — returns 204 | Unit (handler) | `response.status === 204` |
| T-02 | PUT persists preference to DB | Unit (handler + DB) | `readPreference(id)` equals JSON string with `order` and `allow_fallbacks: true` |
| T-03 | DELETE clears preference — returns 204 | Unit (handler) | `response.status === 204` |
| T-04 | DELETE sets DB column to null | Unit (handler + DB) | `readPreference(id) === null` |
| T-05 | PUT with empty `order` array returns 400 | Unit (handler) | `response.status === 400` |
| T-06 | PUT with missing `order` field returns 400 | Unit (handler) | `response.status === 400` |
| T-07 | PUT with non-string item in `order` returns 400 | Unit (handler) | `response.status === 400` |
| T-08 | PUT on non-existent account returns 404 | Unit (handler) | `response.status === 404` |
| T-09 | DELETE on non-existent account returns 404 | Unit (handler) | `response.status === 404` |
| T-10 | PUT `allow_fallbacks` defaults to true | Unit (handler + DB) | stored JSON has `allow_fallbacks: true` |
| T-11 | PUT explicit `allow_fallbacks: false` is persisted | Unit (handler + DB) | stored JSON has `allow_fallbacks: false` |

T-01 through T-09 are required (D-08). T-10 and T-11 are Claude's discretion.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun 1.3.13 built-in) |
| Config file | none — Bun discovers test files automatically |
| Quick run command | `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-03 | PUT sets preference, returns 204 | unit | `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` | no — Wave 0 |
| PROV-03 | DELETE clears preference, returns 204 | unit | same | no — Wave 0 |
| PROV-03 | Validation returns 400 for bad input | unit | same | no — Wave 0 |
| PROV-03 | Missing account returns 404 | unit | same | no — Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts`
- **Per wave merge:** `bun run lint && bun run typecheck && bun run format && bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` — covers PROV-03 (written in RED gate plan)

---

## Project Constraints (from CLAUDE.md)

| Constraint | Impact on Phase 5 |
|-----------|-------------------|
| Never curl Anthropic endpoint | Not applicable — no curl in tests; use DB + handler directly |
| TDD mode: write tests first | RED gate plan (test file only, tests fail) then GREEN gate plan (implement DELETE + pass all tests) |
| Run `bun run lint && bun run typecheck && bun run format` after changes | Required after every plan |
| Never touch `inline-worker.ts` or `inline-vacuum-worker.ts` | Not relevant to Phase 5 |
| `// FORK PATCH:` annotation on all fork-specific code | Required on DELETE handler function and router dispatch block |
| Every DB migration must be ported to PG | Not applicable — Phase 5 adds no new DB columns |
| Use `git add <specific-files>` not `git add .` | Required in commit steps |
| `biome.json` style: tabs, double quotes | Enforced by `bun run format` |
| `import type { ... }` for pure type imports | Apply to handler imports |
| Named exports only — no `export default` | `export function createAccountOpenrouterProviderPreferenceDeleteHandler` |

---

## Open Questions

1. **Should the PUT handler's missing `// FORK PATCH:` annotation be added in Phase 5?**
   - What we know: The PUT handler was added in Phase 4 (commit `28703cc2`) without a `// FORK PATCH:` annotation on the function definition itself (only inline comments inside the body).
   - What is unclear: Whether MAINT-05 (Phase 6) will catch this, or whether Phase 5 should fix it preemptively.
   - Recommendation: Add the annotation in Phase 5 GREEN gate when modifying `accounts.ts` and `router.ts` — it's a one-line add alongside the other changes and avoids a separate Phase 6 cleanup commit.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

**All claims in this research were verified against the repo source. No assumed claims.**

---

## Sources

### Primary (HIGH confidence)

- `packages/http-api/src/handlers/accounts.ts` lines 3594–3656 — existing PUT handler shape (read directly) [VERIFIED: repo]
- `packages/http-api/src/router.ts` lines 1–30, 619–638 — import list and route dispatch pattern (read directly) [VERIFIED: repo]
- `packages/http-api/src/handlers/__tests__/model-mappings-update.test.ts` — canonical test setup pattern (read directly) [VERIFIED: repo]
- `packages/database/src/database-operations.ts` lines 749–755 — facade method signature (read directly) [VERIFIED: repo]
- `packages/database/src/repositories/account.repository.ts` lines 224–233 — repository method (grep verified) [VERIFIED: repo]
- `packages/types/src/account.ts` lines 217–220 — `AccountResponse.openrouterProviderPreference` type (read directly) [VERIFIED: repo]
- `bun test packages/http-api/src/handlers/__tests__/model-mappings-update.test.ts` — test setup works, 7 pass [VERIFIED: executed]

---

## Metadata

**Confidence breakdown:**
- Handler pattern: HIGH — read existing PUT handler and model-mappings handler directly
- Router dispatch pattern: HIGH — read existing dispatch block directly; DELETE block placement confirmed safe
- Test setup: HIGH — test executed successfully; pattern verified line-by-line
- DB facade null handling: HIGH — method signature explicitly accepts `string | null`

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (stable codebase; no fast-moving ecosystem dependencies)
