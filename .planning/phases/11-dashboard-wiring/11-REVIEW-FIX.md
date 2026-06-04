---
phase: 11-dashboard-wiring
fixed_at: 2026-06-04T00:00:00Z
review_path: .planning/phases/11-dashboard-wiring/11-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 4
skipped: 1
status: partial
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-06-04T00:00:00Z
**Source review:** .planning/phases/11-dashboard-wiring/11-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (1 warning, 4 info; fix_scope=all)
- Fixed: 4
- Skipped: 1 (IN-03 — intentional, no code change required)

## Fixed Issues

### WR-01 / IN-01: `mode` union drift consolidated into a shared `AccountMode` type

**Files modified:** `packages/dashboard-web/src/api.ts`, `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx`, `packages/dashboard-web/src/components/AccountsTab.tsx`
**Commit:** 1d4986d2
**Applied fix:** Added a single exported `AccountMode` union in `api.ts` (the only module both components already import) including `ollama-cloud` so the form-reachable mode is no longer absent from the shared type (resolves IN-01). Replaced all four hand-maintained literal unions with `AccountMode`: the `newAccount.mode` state cast, the `accountParams.mode` field (removing the silent narrowing `as` assertion), the `onValueChange` arg, and the `onAddAccount` prop. Propagated the shared type to `AccountsTab.handleAddAccount` and `api.initAddAccount` so the OAuth path remains type-consistent end-to-end. A future mode that does not early-return now produces a compile error instead of silently passing an out-of-union value. `tsc --noEmit` passes.

WR-01 and IN-01 were resolved by a single indivisible change (extracting the shared type and including `ollama-cloud`), so they share one atomic commit.

### IN-02: Form-reset duplication removed via hoisted `INITIAL_ACCOUNT`

**Files modified:** `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx`
**Commit:** ee4d491a
**Applied fix:** Hoisted a module-level `INITIAL_ACCOUNT` constant holding the 14-field default form state, then replaced the `useState` initializer and all 17 copy-pasted reset blocks with `setNewAccount({ ...INITIAL_ACCOUNT })`. Future field additions or default changes now touch one site. `tsc --noEmit` passes. (Review estimated ~14 sites; the actual count was 17.)

### IN-04: Malformed bedrock `customEndpoint` now surfaced instead of silently dropped

**Files modified:** `packages/dashboard-web/src/components/accounts/AccountListItem.tsx`
**Commit:** bcb07a99
**Applied fix:** Applied the optional fallback suggested in the review. When `account.provider === "bedrock"` and a `customEndpoint` is present but does not match the `bedrock:<profile>:<region>` regex, the raw endpoint string is now rendered (in the warning color with an explanatory tooltip) so a malformed/legacy value is visible rather than producing a bedrock row with no profile/region and no indication why. Display-only change. `tsc --noEmit` passes.

### Follow-up: biome import spacing in dashboard api

**Files modified:** `packages/dashboard-web/src/api.ts`
**Commit:** d11f37ae
**Applied fix:** `bun run lint` auto-fixed an import-spacing nit introduced by the new `AccountMode` export block. Committed separately so the working tree is clean and no uncommitted changes remain. Not a review finding.

## Skipped Issues

### IN-03: `console.*` used directly instead of project `Logger`

**File:** `packages/dashboard-web/src/api.ts:111-124`; `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx:244`
**Reason:** Skipped intentionally — no code change required. The review itself classifies this as informational ("if so, no change needed") and notes this is browser-side dashboard code where the server SSE-backed `Logger` does not apply. The dashboard is intentionally exempt from the server `Logger` convention; the `console.*` usage is correct for the browser context. No fix applied.
**Original issue:** CLAUDE.md says use the `Logger` class (not `console.*`); the dashboard `API` class wraps `console.*` and `AccountAddForm:244` calls `console.error` in the AWS-profiles catch.

---

_Fixed: 2026-06-04T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
