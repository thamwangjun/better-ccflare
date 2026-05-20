---
phase: 05-api-layer
reviewed: 2026-05-20T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts
  - packages/http-api/src/handlers/accounts.ts
  - packages/http-api/src/router.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-05-20
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the new `createAccountOpenrouterProviderPreferenceDeleteHandler` in `accounts.ts`, its registration in `router.ts`, and the accompanying test file. The implementation is correct and the SQL operations are safe (parameterized). The route ordering in the router is sound — the DELETE preference branch is evaluated before the catch-all account-deletion branch, so there is no ambiguity. One warning concerns a missing test case for the idempotent-delete path; three info-level items cover minor style and consistency gaps.

---

## Warnings

### WR-01: Missing test for idempotent DELETE (preference already NULL)

**File:** `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts:169`
**Issue:** The DELETE test suite covers: preference exists → 204 (T-03), preference cleared after delete (T-04), and non-existent account → 404 (T-09). It does not test the case where an account exists but `openrouter_provider_preference` is already `NULL`. `setAccountOpenrouterProviderPreference(accountId, null)` will run a SQL UPDATE that matches zero rows without error, so the handler returns 204 — but this behavior is untested. If the underlying DB method changes its semantics (e.g., throws when the value is already null, or a future version adds a guard), no test will catch the regression.

**Fix:** Add a test case such as:

```typescript
// T-12: DELETE on account with no prior preference → 204 (idempotent)
it("T-12: DELETE on account with no existing preference returns 204", async () => {
    const id = await insertAccount(dbOps, "acc10");
    // No PUT call — preference starts as NULL
    const response = await deleteHandler(makeDeleteRequest(), id);
    expect(response.status).toBe(204);
    const pref = await readPreference(dbOps, id);
    expect(pref).toBeNull();
});
```

---

## Info

### IN-01: DELETE handler instantiated inline in router, not pre-created in registerHandlers

**File:** `packages/http-api/src/router.ts:632-645`
**Issue:** Every other account sub-resource handler (pause, resume, reload, rename, priority, auto-fallback, etc.) is instantiated once in `registerHandlers()` and then closed over. The new DELETE handler for `openrouter-provider-preference` is constructed freshly on every matching request via `createAccountOpenrouterProviderPreferenceDeleteHandler(this.context.dbOps)`. This is inconsistent with the codebase pattern and allocates a new closure per request.

**Fix:** Instantiate the handler once alongside the PUT handler in `registerHandlers()`:

```typescript
// In registerHandlers(), alongside the PUT handler variable (if one were pre-created):
const openrouterPrefDeleteHandler =
    createAccountOpenrouterProviderPreferenceDeleteHandler(dbOps);
```

Then reference `openrouterPrefDeleteHandler` in the routing block instead of calling the factory inline. Note: the PUT handler for this same endpoint also instantiates inline (line 625-629), so a consistent fix should update both.

---

### IN-02: makeDeleteRequest uses hardcoded non-matching account ID in URL

**File:** `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts:61-68`
**Issue:** `makeDeleteRequest()` always builds a URL with `/api/accounts/x/openrouter-provider-preference` regardless of the real account ID being tested. Because the handlers in this codebase receive the account ID as a separate parameter (not parsed from the URL), this does not cause test failures — but it is misleading to a reader who expects the URL to match the account under test.

**Fix:** Update `makeDeleteRequest` to accept the account ID:

```typescript
function makeDeleteRequest(accountId = "x"): Request {
    return new Request(
        `http://localhost/api/accounts/${accountId}/openrouter-provider-preference`,
        { method: "DELETE" },
    );
}
```

Then pass `id` at the call sites. The same applies to `makePutRequest`.

---

### IN-03: Missing JSDoc on the new DELETE handler export

**File:** `packages/http-api/src/handlers/accounts.ts:3660`
**Issue:** `createAccountOpenrouterProviderPreferenceDeleteHandler` has no JSDoc comment. Every other exported handler in this file has at least a one-line doc block (e.g., `/** Create an account pause handler */`). The companion PUT handler at line 3591 also has a multi-line JSDoc including the HTTP method and body shape. The DELETE handler has only a `// FORK PATCH:` inline comment.

**Fix:**

```typescript
/**
 * Clear the OpenRouter provider preference for an account.
 * DELETE /api/accounts/:id/openrouter-provider-preference
 * Sets openrouter_provider_preference to NULL, restoring default provider routing.
 */
export function createAccountOpenrouterProviderPreferenceDeleteHandler(
```

---

_Reviewed: 2026-05-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
