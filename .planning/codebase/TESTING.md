# Testing Patterns

**Analysis Date:** 2026-05-04

## Test Framework

**Runner:** Bun's built-in test runner (`bun:test`)
- No separate config file — Bun discovers `*.test.ts` files automatically
- One anomaly: `packages/core/src/pricing.test.ts` imports `vi` from `vitest` for mocking; this is inconsistent with the rest of the codebase and should be migrated to `bun:test`'s `mock()`

**Assertion Library:** `bun:test` built-in `expect` (Jest-compatible API)

**Run Commands:**
```bash
bun test                        # Run all tests across the monorepo
bun test apps/cli/__tests__     # Run only CLI tests (alias: bun run test:cli)
bun test packages/proxy         # Run tests in a specific package
bun test --watch                # Watch mode (standard Bun flag)
```

**No explicit coverage tooling detected** — no `--coverage` flag in `package.json` scripts.

## Test File Organization

**Location pattern — two conventions coexist:**

1. **`__tests__/` subdirectory** (majority pattern): Tests live in a `__tests__/` folder adjacent to the source they test
   ```
   packages/proxy/src/handlers/
   ├── proxy-operations.ts
   └── __tests__/
       ├── proxy-operations-failover.test.ts
       └── response-processor.test.ts
   ```

2. **Co-located** (minority pattern, used in `packages/core/src/`): Test file sits beside the source file
   ```
   packages/core/src/
   ├── utils.ts
   ├── utils.test.ts
   ├── pricing.ts
   └── pricing.test.ts
   ```

3. **Root-level integration tests** (`__tests__/` at repo root):
   - `__tests__/api-auth.test.ts` — full integration test against real database

**Naming:** `<subject>.test.ts` — no `.spec.ts` files found.

**Test file exclusion from typecheck:** `**/__tests__` and `**/*.test.ts` are excluded in `tsconfig.json`, so tests are not typechecked by `bun run typecheck`.

## Types of Tests Present

**Unit tests** (majority): Test a single module in isolation, dependency-injecting stubs or using `makeX()` fixture factories.

**Integration tests with in-memory SQLite** (common for database layer): Use `bun:sqlite`'s `:memory:` database with real migrations run against it.
- Examples: `packages/database/src/__tests__/cleanup-old-requests.test.ts`, `packages/database/src/repositories/__tests__/stats-session-cost.test.ts`

**Integration tests with real file-based SQLite** (for auth/API scenarios): Use `/tmp/test-*.db` path, cleaned up in `afterAll`.
- Example: `__tests__/api-auth.test.ts`

**Handler/behaviour tests** (proxy layer): Construct minimal mock contexts using `makeProxyContext()` factory with `mock()` functions for DB and provider surfaces. No HTTP server is started.
- Examples: `packages/proxy/src/handlers/__tests__/proxy-operations-failover.test.ts`

**No E2E tests detected** — no browser automation, Playwright, or Cypress found.

## Test Structure

**Suite Organization:**
```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

describe("Subject — filename.test.ts", () => {
    // Setup
    beforeAll(async () => { /* one-time setup */ });
    beforeEach(async () => { /* per-test reset */ });
    afterAll(() => { /* cleanup */ });

    describe("Feature group", () => {
        it("should <behavior description>", async () => {
            // arrange
            // act
            // assert
            expect(result).toBe(expected);
        });
    });
});
```

**Assertion style:** Always `expect(value).toBe(...)` / `.toEqual(...)` / `.toMatch(...)` — never `assert()`.

**Test naming:** `it("should <verb> <subject>", ...)` or `it("<condition> → <outcome>", ...)` for provider-level tests.

## Mocking

**Framework:** `mock` from `bun:test` (for most packages); `vi` from `vitest` used anomalously in `packages/core/src/pricing.test.ts`

**Standard mock pattern:**
```typescript
import { describe, expect, it, mock } from "bun:test";

// Mock a function
const mockFn = mock(() => Promise.resolve(someValue));

// Inline mock as part of a context object
const ctx = {
    dbOps: {
        markAccountRateLimited: mock(() => Promise.resolve()),
        updateAccountUsage: mock(() => Promise.resolve()),
    } as never,
};
```

**Stub objects:** Use TypeScript `as never` cast to satisfy interface requirements when only a subset of methods is needed — this avoids maintaining full mock implementations.

**Global fetch mocking (anomaly in pricing.test.ts):**
```typescript
// Only in packages/core/src/pricing.test.ts — using vitest instead of bun:test
global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockResponse,
});
```

**Mock these:**
- External HTTP calls (provider endpoints, fetch)
- Database operations when testing non-DB logic
- Logger instances (use a plain `{ warn: mock(...), debug: mock(...) }` object)

**Do not mock these:**
- SQLite adapter when testing repository/DB logic — use real in-memory `bun:sqlite` database

## Fixtures and Factories

**Account fixture factory** (repeated across many test files — not centralized):
```typescript
function makeAccount(overrides: Partial<Account> = {}): Account {
    return {
        id: "acct-1",
        name: "test-account",
        provider: "anthropic",
        api_key: null,
        refresh_token: "rt",
        access_token: "at",
        expires_at: Date.now() + 3_600_000,
        request_count: 0,
        // ... all required fields ...
        ...overrides,
    };
}
```

This `makeAccount` pattern is **duplicated in at least 5 test files**. There is no shared test fixture library.

**In-memory DB helper** (pattern in database tests):
```typescript
function makeDb(): Database {
    const db = new Database(":memory:");
    ensureSchema(db);
    runMigrations(db);
    return db;
}
```

**Location:** Fixtures are defined inline at the top of each test file. No shared `fixtures/` or `helpers/` directory exists.

## Coverage

**Requirements:** None enforced — no coverage threshold configured in any script or config.

**View Coverage:**
```bash
bun test --coverage    # Bun supports this flag natively
```

No `lcov`, `istanbul`, or coverage reporters are configured.

## Common Patterns

**Async Testing:**
```typescript
it("should resolve correctly", async () => {
    const result = await someAsyncFn();
    expect(result).toBe(expected);
});
```

**Error/Rejection Testing:**
```typescript
it("should throw on invalid input", async () => {
    await expect(generateApiKey(dbOps, "")).rejects.toThrow("API key name cannot be empty");
});
```

**Database isolation between tests:**
```typescript
beforeEach(async () => {
    await dbOps.clearApiKeys(); // Reset state between tests
});
```

**Cleanup of file-based test databases:**
```typescript
afterAll(() => {
    if (require("fs").existsSync(TEST_DB_PATH)) {
        require("fs").unlinkSync(TEST_DB_PATH);
    }
    DatabaseFactory.reset();
});
```

## Known Gaps in Test Coverage

**No centralized fixture library:** `makeAccount()` is duplicated in 5+ test files. Inconsistencies between duplicates can cause silent test drift. Fix: extract to `packages/types/src/test-fixtures.ts` or a dedicated `packages/test-utils` package.

**`packages/core/src/pricing.test.ts` uses `vitest`:** This is the only file importing from `vitest`. It uses `vi.fn()` and `vi.clearAllMocks()`. Bun's `mock()` from `bun:test` is the correct approach and should replace this.

**No E2E or HTTP-level integration tests:** The proxy's full request pipeline (inbound HTTP → load balancer → provider → response) has no end-to-end test. All handler tests construct mock contexts, not live HTTP requests.

**`inline-worker.ts` excluded from all tooling:** `packages/proxy/src/inline-worker.ts` is auto-generated and explicitly excluded from reads, edits, and commits per project rules. It has no test coverage.

**Large files with minimal tests:**
- `packages/http-api/src/handlers/accounts.ts` (3211 lines) is tested via integration tests in `packages/http-api/src/handlers/__tests__/accounts-integration.test.ts` but many handler branches are untested
- `apps/server/src/server.ts` (1410 lines) has no corresponding test file

**Coverage tooling not enforced:** No minimum coverage threshold exists. Adding `bun test --coverage` to CI would establish a baseline.

---

*Testing analysis: 2026-05-04*
