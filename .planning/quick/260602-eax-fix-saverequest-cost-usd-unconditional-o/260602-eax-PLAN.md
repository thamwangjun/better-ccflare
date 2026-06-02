---
quick_id: 260602-eax
plan: quick
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/database/src/repositories/request.repository.ts
  - packages/database/src/repositories/__tests__/request-cost-zero.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "save() ON CONFLICT DO UPDATE uses COALESCE(EXCLUDED.cost_usd, requests.cost_usd) for the cost_usd column"
    - "save() with undefined costUsd does not null out a previously-persisted real cost"
    - "Existing tests continue to pass"
  artifacts:
    - path: "packages/database/src/repositories/request.repository.ts"
      provides: "Fixed save() ON CONFLICT clause"
      contains: "COALESCE(EXCLUDED.cost_usd, requests.cost_usd)"
    - path: "packages/database/src/repositories/__tests__/request-cost-zero.test.ts"
      provides: "Regression test for COALESCE in ON CONFLICT"
      contains: "COALESCE(EXCLUDED.cost_usd"
  key_links:
    - from: "save() INSERT ... ON CONFLICT"
      to: "cost_usd column"
      via: "COALESCE(EXCLUDED.cost_usd, requests.cost_usd)"
      pattern: "COALESCE\\(EXCLUDED\\.cost_usd, requests\\.cost_usd\\)"
---

<objective>
Fix an unconditional cost_usd overwrite in request.repository.ts save() ON CONFLICT clause, and add a regression test.

Purpose: The save() method's ON CONFLICT DO UPDATE clause writes `cost_usd = EXCLUDED.cost_usd` unconditionally. When a request row is first inserted with a real cost (e.g., $0.0042 from a provider response) and later re-saved by a background worker that only has {model, ...} without costUsd, the EXCLUDED.cost_usd is NULL (from `usage?.costUsd ?? null`), wiping out the previously-persisted real cost. The updateUsage() method already guards against this with `cost_usd = COALESCE(?, cost_usd)`. The save() method needs the same guard.

Output: Patched request.repository.ts (line 87 COALESCE fix), extended test file, confirmed no equivalent fix needed in migrations-pg.ts
</objective>

<context>
Existing code:

- `packages/database/src/repositories/request.repository.ts` line 87: `cost_usd = EXCLUDED.cost_usd` (unconditional overwrite)
- `packages/database/src/repositories/request.repository.ts` line 148: `cost_usd = COALESCE(?, cost_usd)` (correct pattern in updateUsage)
- `packages/database/src/migrations-pg.ts`: DDL only (CREATE TABLE, ALTER TABLE) -- contains no ON CONFLICT DO UPDATE for the requests table
- `packages/database/src/repositories/__tests__/request-cost-zero.test.ts`: existing tests use mock adapter capturing `{sql, params}` calls

Note: `request.repository.ts` is the shared repository for both SQLite and PostgreSQL adapters. Both backends use the same `save()` method. The COALESCE fix in this single file covers both.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix cost_usd COALESCE in save() ON CONFLICT clause</name>
  <files>packages/database/src/repositories/request.repository.ts</files>
  <behavior>
    - Line 87 change: `cost_usd = EXCLUDED.cost_usd` becomes `cost_usd = COALESCE(EXCLUDED.cost_usd, requests.cost_usd)`
    - The surrounding ON CONFLICT DO UPDATE SET block is unchanged for all other columns
    - The INSERT VALUES params (index 14, costUsd) are unchanged -- the `?? null` collapse for undefined is correct for the INSERT path
    - migrations-pg.ts has no matching ON CONFLICT clause to mirror (DDL only); note this in the commit body
  </behavior>
  <action>
    In packages/database/src/repositories/request.repository.ts line 87:
    Change `cost_usd = EXCLUDED.cost_usd` to `cost_usd = COALESCE(EXCLUDED.cost_usd, requests.cost_usd)`.

    This matches the pattern already used at line 148 in updateUsage(): `cost_usd = COALESCE(?, cost_usd)`.
    The fix ensures that when save() is called with `costUsd: undefined` on a row that already has a persisted real cost_usd, the existing value is preserved rather than nulled out.

    Verify migrations-pg.ts has no equivalent ON CONFLICT clause: the file contains only DDL (CREATE TABLE, ALTER TABLE), and no ON CONFLICT DO UPDATE for the requests table. The request.repository.ts change is the sole fix needed.
  </action>
  <verify>
    <automated>cd /home/thamw/development/remote-dev/better-ccflare && bun test packages/database/src/repositories/__tests__/request-cost-zero.test.ts</automated>
  </verify>
  <done>
    Line 87 reads `cost_usd = COALESCE(EXCLUDED.cost_usd, requests.cost_usd)`. Existing tests pass (they test positional params, which are unchanged for the INSERT path).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add regression test asserting ON CONFLICT COALESCE</name>
  <files>packages/database/src/repositories/__tests__/request-cost-zero.test.ts</files>
  <behavior>
    - New test: save() emits COALESCE(EXCLUDED.cost_usd, requests.cost_usd) in the ON CONFLICT clause of the generated SQL
    - The test uses the existing `createRepoCapturingRun()` helper to capture the SQL string from adapter.run()
    - Assert the SQL string contains the COALESCE pattern for cost_usd (not the bare `cost_usd = EXCLUDED.cost_usd` or `cost_usd=EXCLUDED.cost_usd` without a preceding COALESCE)
    - Prevent false positive from a later column name containing "cost_usd" or the INSERT VALUES clause: assert specifically on the ON CONFLICT portion of the SQL using grep -v '^#' | grep pattern to filter comment-only lines
  </behavior>
  <action>
    In packages/database/src/repositories/__tests__/request-cost-zero.test.ts, add a new test to the existing `describe("RequestRepository zero-cost persistence (D-03)")` block:

    ```
    it("save() ON CONFLICT uses COALESCE for cost_usd so a re-save without cost does not null out a persisted cost", async () => {
        const { repo, calls } = createRepoCapturingRun();
        await repo.save(makeRequestData(undefined) as any);
        expect(calls.length).toBe(1);
        // The ON CONFLICT DO UPDATE SET clause must use COALESCE for cost_usd
        const sql = calls[0].sql;
        expect(sql).toContain("COALESCE(EXCLUDED.cost_usd, requests.cost_usd)");
    });
    ```

    Place it after the existing "save() collapses costUsd: undefined to null" test and before the updateUsage tests.
  </action>
  <verify>
    <automated>cd /home/thamw/development/remote-dev/better-ccflare && bun test packages/database/src/repositories/__tests__/request-cost-zero.test.ts</automated>
  </verify>
  <done>
    All 5 tests pass (4 existing + 1 new). The new test verifies the SQL string contains `COALESCE(EXCLUDED.cost_usd, requests.cost_usd)`. If the COALESCE were removed from the ON CONFLICT clause, this test would fail.
  </done>
</task>

</tasks>

<verification>
cd /home/thamw/development/remote-dev/better-ccflare && bun test packages/database/src/repositories/__tests__/request-cost-zero.test.ts && bun run typecheck
</verification>

<success_criteria>
- Line 87 of request.repository.ts uses `COALESCE(EXCLUDED.cost_usd, requests.cost_usd)` instead of bare `EXCLUDED.cost_usd`
- All 5 tests in request-cost-zero.test.ts pass
- Typecheck passes
- migrations-pg.ts confirmed to have no matching ON CONFLICT clause (DDL only)
</success_criteria>
