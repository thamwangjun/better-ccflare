# Phase 5: API Layer - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a `DELETE /api/accounts/:id/openrouter-provider-preference` endpoint to clear an account's OpenRouter provider preference, and write the full TDD test suite covering both the existing PUT (set) and the new DELETE (clear) endpoints. The PUT endpoint was committed during Phase 4 execution — Phase 5 completes its test coverage and adds the missing clear operation.

No dashboard UI (Phase 6). No proxy injection changes. No single-account GET endpoint (list endpoint is sufficient).

</domain>

<decisions>
## Implementation Decisions

### Clearing Mechanism

- **D-01:** Add `DELETE /api/accounts/:id/openrouter-provider-preference` to clear the preference (sets `openrouter_provider_preference` to NULL in the DB). Separate endpoint per REST semantics — no changes to the existing PUT endpoint body contract.
- **D-02:** DELETE returns `204 No Content` on success. Consistent with the existing PUT response.
- **D-03:** DELETE on a non-existent account returns `404 Not Found` (same guard as PUT).

### Response Shape

- **D-04:** The existing PUT returns `204 No Content` — no change needed. Dashboard re-fetches the account list after updating.
- **D-05:** No full account object returned from PUT or DELETE. `GET /api/accounts` (list) is the source of truth for current state.

### Single-Account GET

- **D-06:** No `GET /api/accounts/:id` endpoint added in Phase 5. The `GET /api/accounts` list already returns `openrouterProviderPreference` per account, which is sufficient for v1.1.

### Test Plan (TDD)

- **D-07:** Phase 5 uses TDD with two plans: RED gate (write failing tests) then GREEN gate (add DELETE endpoint + make all tests pass).
- **D-08:** Required test cases for the RED gate:
  1. `PUT` sets preference — valid `order` array persists, returns 204
  2. `DELETE` clears preference — returns 204, preference is null afterward
  3. `PUT` with invalid input — empty `order` array, missing `order` field, non-string items all return 400
  4. `PUT` on non-existent account returns 404
  5. `DELETE` on non-existent account returns 404
- **D-09:** Additional test cases are Claude's discretion (e.g., `allow_fallbacks` defaulting to true, malformed JSON in stored preference, etc.)

### Claude's Discretion

- Test file location: follow the existing pattern in `packages/http-api/src/` (look for existing handler test files for co-location guidance)
- DELETE handler naming: `createAccountOpenrouterProviderPreferenceDeleteHandler` or similar — follow the existing naming convention
- Whether to extract a shared `getAccountOrNotFound()` helper between PUT and DELETE, or keep the guard inline

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` §PROV-03 — Locked requirement: REST API supports PATCH/PUT/DELETE to set or clear `openrouter_provider_preference` per account

### Existing Endpoint (Phase 4 committed, must be test-covered in Phase 5)

- `packages/http-api/src/handlers/accounts.ts` — `createAccountOpenrouterProviderPreferenceHandler` at ~line 3594: existing PUT handler. Phase 5 tests cover this + adds the DELETE handler here.
- `packages/http-api/src/router.ts` — Lines ~619–635: routing for `PUT /api/accounts/:id/openrouter-provider-preference`. Phase 5 adds the DELETE route here.

### Patterns to Mirror

- `packages/http-api/src/handlers/accounts.ts` — `createAccountModelMappingsUpdateHandler` (~line 2483): pattern for validation, error responses, and response shape (used as style reference)
- `packages/database/src/database-operations.ts` — `setAccountOpenrouterProviderPreference()`: facade method used by the existing PUT handler. Phase 5 DELETE will call this with `null` to clear, or add a dedicated `clearAccountOpenrouterProviderPreference()` method.

### Type Chain

- `packages/types/src/account.ts` — `AccountResponse.openrouterProviderPreference` typed as `{ order: string[], allowFallbacks: boolean } | null` (updated in Phase 4)

### Fork Patch Convention

- `.planning/PROJECT.md` §Key Decisions — `// FORK PATCH:` annotation required on all fork-specific code blocks

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `createAccountOpenrouterProviderPreferenceHandler` in `packages/http-api/src/handlers/accounts.ts` (~line 3594) — existing PUT handler. The DELETE handler is a simpler variant: verify account exists, set preference to null, return 204.
- `setAccountOpenrouterProviderPreference(accountId, preferenceJson)` in `packages/database/src/database-operations.ts` — called by the PUT handler. Calling it with `null` may be sufficient to clear, or a new `clearAccountOpenrouterProviderPreference()` method may be added — follow the existing pattern.

### Established Patterns

- **Handler factory pattern:** `createAccountXxxHandler(dbOps)` returns `async (req, accountId) => Response` — every account handler in `accounts.ts` follows this pattern
- **404 guard:** Check account existence with `db.get<{ name: string }>("SELECT name FROM accounts WHERE id = ?", [accountId])` — same as PUT handler
- **204 response:** `return new Response(null, { status: 204 })` — used by PUT; DELETE matches this
- **Route registration in router.ts:** `path.endsWith("/openrouter-provider-preference") && method === "DELETE"` — follows the existing method-dispatch pattern at lines ~619–635
- **`// FORK PATCH:` annotation:** Goes on the line directly before fork-specific code blocks

### Integration Points

- `packages/http-api/src/router.ts` ~lines 619–635: add the DELETE route alongside the existing PUT dispatch
- `packages/http-api/src/handlers/accounts.ts`: add `createAccountOpenrouterProviderPreferenceDeleteHandler` export, import it in `router.ts`
- `packages/database/src/database-operations.ts`: verify or add `clearAccountOpenrouterProviderPreference()` (or confirm `setAccountOpenrouterProviderPreference(id, null)` works)

</code_context>

<specifics>
## Specific Ideas

- The DELETE endpoint is symmetric with PUT: same path, same 404 guard, same 204 response — just sets the value to null instead of a JSON string.
- Tests should use a real in-memory test DB (follow the existing test pattern in `packages/http-api/` — check for `__tests__/` subdirectory or co-located `.test.ts` files to find the setup pattern).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-API Layer*
*Context gathered: 2026-05-20*
