---
phase: 06-dashboard-ui-maintenance-hardening
reviewed: 2026-05-21T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - packages/dashboard-web/src/api.ts
  - packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.ts
  - packages/dashboard-web/src/components/accounts/AccountList.tsx
  - packages/dashboard-web/src/components/accounts/AccountListItem.tsx
  - packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx
  - packages/dashboard-web/src/components/accounts/index.ts
  - packages/dashboard-web/src/components/AccountsTab.tsx
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-05-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the dashboard UI layer for the phase-06 maintenance and hardening work. The files cover the new OpenRouter provider preference dialog (PROV-04 fork patch), the account list components, the accounts tab orchestrator, and the API client.

The new dialog code is well-structured with good test coverage of the three exported pure functions. The main issues are: two URL-construction bugs in `api.ts` where account names are interpolated without `encodeURIComponent`, a silent error swallow in the dialog save handler that gives users no feedback on failure, and a stale-form-state risk in the dialog's `useEffect` dependency.

## Warnings

### WR-01: `removeAccount` URL uses unencoded account name

**File:** `packages/dashboard-web/src/api.ts:731`
**Issue:** The DELETE request constructs its URL by interpolating the raw `name` string directly: `` `/api/accounts/${name}` ``. Account names are user-supplied text. A name containing `/`, `?`, `#`, or `%` will produce a malformed URL — for example, `my/account` would resolve to `/api/accounts/my/account` and hit a non-existent route, or `my?key=val` would corrupt the query string. This can cause silent delete failures for accounts with special characters in their names.
**Fix:**
```typescript
const url = `/api/accounts/${encodeURIComponent(name)}`;
```

### WR-02: `getAccountTokenHealth` URL uses unencoded account name

**File:** `packages/dashboard-web/src/api.ts:1893`
**Issue:** Same class of bug as WR-01. The token health request interpolates the raw `accountName` parameter: `` `/api/token-health/account/${accountName}` ``. An account name with special characters will produce a malformed URL.
**Fix:**
```typescript
const url = `/api/token-health/account/${encodeURIComponent(accountName)}`;
```

### WR-03: Dialog save errors are silently swallowed — no user feedback

**File:** `packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx:85-88`
**Issue:** The `handleSave` catch block logs to console but never surfaces the error to the user. The dialog stays open (because `onOpenChange(false)` is only called in the `try` block), but there is no error message, toast, or visible indicator. This is consistent with some other dialogs in the codebase, but the pattern is particularly visible here because `onSetProviderPreference` and `onClearProviderPreference` both re-throw errors from `AccountsTab.tsx` (lines 528 and 537), making a failed save a fully silent no-op to the user.

```typescript
// Current
} catch (error) {
  console.error("Failed to save provider preference:", error);
} finally {
```

**Fix:** Add local error state and render it in the dialog footer, matching the pattern used in `AccountsTab` for `actionError`:
```typescript
const [saveError, setSaveError] = useState<string | null>(null);

// in handleSave catch:
} catch (error) {
  setSaveError(error instanceof Error ? error.message : "Failed to save provider preference");
} finally {

// in JSX, before DialogFooter:
{saveError && (
  <p className="text-sm text-destructive">{saveError}</p>
)}
```
Also call `setSaveError(null)` at the top of `handleSave` to clear stale errors on retry.

## Info

### IN-01: Dialog `useEffect` may show stale form state on re-open

**File:** `packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx:66-70`
**Issue:** The `useEffect` depends on `[account]`. In `AccountsTab.tsx` (line 762-765), when the dialog closes, the state is set to `{ isOpen: false, account: open ? providerPreferenceDialog.account : null }`. The `account` object is preserved from the original open call and is only cleared when `open` becomes `false`. If a save succeeds, `loadAccounts()` runs and the query cache updates, but the `providerPreferenceDialog.account` reference in local state still points to the stale `Account` object from before the save. If the user opens the dialog again for the same account without an intervening render that replaces the account reference, `useEffect` will not re-run (referential equality) and the form will show the pre-save values.

This is a minor timing issue since in practice `loadAccounts()` triggers a re-render that replaces the accounts array, but the dialog's `account` prop is only updated at `setProviderPreferenceDialog` call time, not reactively from the accounts query.

**Fix:** Reset the dialog account to `null` on close (as is already done for `isOpen: false`), and re-pass the fresh account from the accounts array when re-opening. Alternatively, inside the dialog's `useEffect`, add `isOpen` to the dependency array so the form always resets when the dialog reopens:
```typescript
React.useEffect(() => {
  if (!isOpen) return; // skip when closing
  const state = syncProviderPreferenceState(account);
  setProviderOrder(state.providerOrder);
  setAllowFallbacks(state.allowFallbacks);
}, [account, isOpen]);
```
This requires `isOpen` to be added to the dialog's props dependency, which it already receives.

### IN-02: `mostRecentAccountId` reduce has O(n²) inner find

**File:** `packages/dashboard-web/src/components/accounts/AccountList.tsx:50-64`
**Issue:** The reducer calls `accounts.find(a => a.id === mostRecent)` on every iteration, making the overall algorithm O(n²). For typical small account counts this is harmless, but the `find` also returns `undefined` when `mostRecent` refers to an ID not present in the current `accounts` snapshot, which causes the `if (!mostRecentAccount?.lastUsed) return account.id` branch to incorrectly advance the accumulator.

**Fix:** Compute a lookup map before the reduce, or track the full account object in the accumulator rather than just its ID:
```typescript
const mostRecentAccountId = accounts.reduce(
  (mostRecentAcc, account) => {
    if (!account.lastUsed) return mostRecentAcc;
    if (!mostRecentAcc) return account;
    return new Date(account.lastUsed).getTime() >
      new Date(mostRecentAcc.lastUsed!).getTime()
      ? account
      : mostRecentAcc;
  },
  null as Account | null,
)?.id ?? null;
```

---

_Reviewed: 2026-05-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
