# Phase 5: API Layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 5-API Layer
**Areas discussed:** Clearing mechanism, Response shape, Single-account GET, Test plan

---

## Clearing Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Extend PUT to accept null order | Send `{ order: null }` or omit order to clear. One endpoint handles both set and clear. | |
| Add DELETE endpoint | `DELETE /api/accounts/:id/openrouter-provider-preference` clears the preference. Clean REST semantics. | ✓ |
| Allow empty array to clear | `{ order: [] }` means clear. Consistent with model_mappings pattern. | |

**User's choice:** Add DELETE endpoint
**Notes:** DELETE returns 204 No Content on success, 404 on non-existent account.

---

## Response Shape (PUT)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep 204 No Content | No change. Dashboard re-fetches the account list after updating. | ✓ |
| Return lightweight success JSON | `{ success: true, openrouterProviderPreference: {...} }` — mirrors model_mappings pattern. | |
| Return full account object | Matches ROADMAP success criteria literally. Heavier. | |

**User's choice:** Keep 204 No Content
**Notes:** Both PUT and DELETE return 204. Dashboard uses the list endpoint for current state.

---

## Single-Account GET

| Option | Description | Selected |
|--------|-------------|----------|
| No — list endpoint is sufficient | `GET /api/accounts` already returns `openrouterProviderPreference` per account. | ✓ |
| Yes — add GET /api/accounts/:id | Matches ROADMAP success criteria literally. Useful for direct API consumers. | |

**User's choice:** No — list endpoint is sufficient
**Notes:** No new GET endpoint in Phase 5. ROADMAP success criteria 3 is met by the list endpoint.

---

## Test Plan

| Option | Description | Selected |
|--------|-------------|----------|
| TDD: write failing tests first (RED gate) | Tests for PUT set + DELETE clear + validation + 404. Then GREEN gate. | ✓ |
| Write tests alongside implementation | Add DELETE and tests in one plan. Skip the RED gate. | |

**User's choice:** TDD — write failing tests first

**Required test cases (all 4 selected by user):**
- PUT sets preference (happy path) — valid order array persists, returns 204
- DELETE clears preference (happy path) — returns 204, preference is null afterward
- PUT with invalid input — empty order array, missing order, non-string items → 400
- Both endpoints on non-existent account return 404

**Notes:** Two plans: 05-01-PLAN.md (RED gate) + 05-02-PLAN.md (GREEN gate / DELETE implementation).

---

## Claude's Discretion

- Test file location: follow the existing pattern in `packages/http-api/src/`
- DELETE handler naming convention
- Whether to extract a shared `getAccountOrNotFound()` helper between PUT and DELETE

## Deferred Ideas

None — discussion stayed within phase scope.
