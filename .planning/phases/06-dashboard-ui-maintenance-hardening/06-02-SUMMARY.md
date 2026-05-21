---
phase: 06-dashboard-ui-maintenance-hardening
plan: 02
subsystem: dashboard-web
tags: [tdd, green-gate, openrouter, provider-preference, PROV-04, dialog, api-client]
dependency_graph:
  requires: [06-01-PLAN.md — TDD RED gate test file]
  provides: [AccountOpenrouterProviderPreferenceDialog component, putAccountOpenrouterProviderPreference, deleteAccountOpenrouterProviderPreference API methods, full prop threading from AccountsTab to AccountListItem]
  affects: [packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx, packages/dashboard-web/src/api.ts, packages/dashboard-web/src/components/accounts/AccountListItem.tsx, packages/dashboard-web/src/components/accounts/AccountList.tsx, packages/dashboard-web/src/components/AccountsTab.tsx]
tech_stack:
  added: []
  patterns: [React useState + useEffect dialog pattern, shadcn/ui Dialog + Switch + Input + Label + Button, lucide-react Settings2 icon, optional prop threading through component hierarchy]
key_files:
  created:
    - packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx
  modified:
    - packages/dashboard-web/src/components/accounts/index.ts
    - packages/dashboard-web/src/api.ts
    - packages/dashboard-web/src/components/accounts/AccountListItem.tsx
    - packages/dashboard-web/src/components/accounts/AccountList.tsx
    - packages/dashboard-web/src/components/AccountsTab.tsx
decisions:
  - "Used Settings2 from lucide-react 1.7.0 (available, no substitution needed) for provider preferences dropdown icon"
  - "DialogFooter uses mt-2 shrink-0 matching AccountModelMappingsDialog template per UI-SPEC"
  - "Content area uses space-y-4 py-2 without overflow-y-auto — dialog has only two controls and will not overflow"
  - "PUT body uses allow_fallbacks (snake_case) matching the accounts.ts handler which reads body.allow_fallbacks"
  - "Cancel button labeled 'Discard Changes' per UI-SPEC copywriting contract"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 5
---

# Phase 06 Plan 02: Provider Preferences Dialog Implementation Summary

## Objective

Implement the Provider Preferences dialog and wire it throughout the dashboard, turning Plan 01's RED TDD tests GREEN. Delivers PROV-04 — operators can configure and clear per-account OpenRouter provider preferences through the dashboard UI.

## What Was Built

### Task 1: AccountOpenrouterProviderPreferenceDialog + GREEN Gate

Created `packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx` with:

- Three exported pure helper functions matching the Plan 01 test contract:
  - `parseProviderOrder(input)` — comma-split, trim, filter empty
  - `resolveProviderPreferenceSaveAction(parsed)` — "clear" if empty array, "set" otherwise
  - `syncProviderPreferenceState(account)` — reads `openrouterProviderPreference`, returns `{ providerOrder: "", allowFallbacks: true }` if null
- Dialog component with `isOpen`, `account`, `onOpenChange`, `onSetProviderPreference`, `onClearProviderPreference` props
- `useEffect([account])` populates form from account state via `syncProviderPreferenceState`
- `handleSave` routes to DELETE (empty input → clear) or PUT (non-empty → set) then closes dialog
- JSX per UI-SPEC: `sm:max-w-[500px]`, two-control layout without overflow-y-auto, "Discard Changes" cancel button
- `// FORK PATCH: Provider preferences dialog — PROV-04` file header

All 12 TDD tests from Plan 01 turned GREEN. Typecheck clean.

### Task 2: API Client Methods + Full Prop Threading

**api.ts** — Two new methods annotated with `// FORK PATCH: OpenRouter provider preference API methods (PROV-04)`:
- `putAccountOpenrouterProviderPreference(accountId, order, allowFallbacks)` — PUT with `{ order, allow_fallbacks: allowFallbacks }` (snake_case key per accounts.ts handler)
- `deleteAccountOpenrouterProviderPreference(accountId)` — DELETE with no body

**AccountListItem.tsx** — Added `Settings2` icon import, `onProviderPreferenceChange?` prop, extended separator gate condition, and new dropdown item gated on `account.provider === "openrouter"` with state indicator (orange Settings2 + "set" badge when preference is set).

**AccountList.tsx** — Added `onProviderPreferenceChange?` to props interface, destructure, and forwarding to AccountListItem.

**AccountsTab.tsx** — Added:
- `AccountOpenrouterProviderPreferenceDialog` import from `"./accounts"`
- `providerPreferenceDialog` state (same shape as `modelMappingsDialog`)
- `handleProviderPreferenceChange` open handler
- `handleSetProviderPreference` and `handleClearProviderPreference` async handlers (try/await api.method()/await loadAccounts()/catch setActionError/throw pattern)
- `onProviderPreferenceChange={handleProviderPreferenceChange}` prop on `AccountList`
- Dialog mount block conditional on `providerPreferenceDialog.isOpen && providerPreferenceDialog.account`

## Verification Results

```
bun test packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.ts
# 12 pass, 0 fail — GREEN gate achieved

bun test packages/dashboard-web/src/
# 70 pass, 0 fail — all dashboard tests pass

bun run typecheck
# 0 errors (excluding pre-existing inline-worker auto-generated file errors)

grep "allow_fallbacks" packages/dashboard-web/src/api.ts
# Match found — snake_case key confirmed

grep "account.provider.*openrouter" packages/dashboard-web/src/components/accounts/AccountListItem.tsx
# Match found — gate confirmed

grep "// FORK PATCH" packages/dashboard-web/src/api.ts
# Match found — annotation confirmed
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 91349261 | feat(06-02): implement AccountOpenrouterProviderPreferenceDialog (PROV-04) |
| 2 | b0c24784 | feat(06-02): wire provider preferences dialog through AccountListItem/AccountList/AccountsTab (PROV-04) |

## Deviations from Plan

None — plan executed exactly as written. Settings2 was available in lucide-react 1.7.0 (no substitution needed). DialogFooter template from AccountModelMappingsDialog used `mt-2 shrink-0` which matched UI-SPEC Layout Contract.

## Known Stubs

None. All data is wired end-to-end: dialog reads from `account.openrouterProviderPreference`, calls real API methods on save, and triggers `loadAccounts()` to refresh UI state.

## Threat Flags

None. The threat mitigations from the plan's threat model are all in place:
- T-06-02-01 (PUT body key casing): `allow_fallbacks` snake_case key confirmed in `putAccountOpenrouterProviderPreference`
- T-06-02-02 (Malformed provider names): handled server-side per accounts.ts; client `filter(Boolean)` in `parseProviderOrder` removes blanks
- T-06-02-03 (XSS via title attribute): React renders title as text attribute (not innerHTML); no risk

## Self-Check: PASSED

- [x] File exists: `packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx`
- [x] File exports: `parseProviderOrder`, `resolveProviderPreferenceSaveAction`, `syncProviderPreferenceState`, `AccountOpenrouterProviderPreferenceDialog` (all named, no default)
- [x] File header contains `// FORK PATCH: Provider preferences dialog — PROV-04`
- [x] `index.ts` exports `AccountOpenrouterProviderPreferenceDialog`
- [x] `api.ts` contains `putAccountOpenrouterProviderPreference` and `deleteAccountOpenrouterProviderPreference` with FORK PATCH annotation
- [x] `api.ts` PUT body uses `allow_fallbacks` (snake_case)
- [x] `AccountListItem.tsx` dropdown item gated on `account.provider === "openrouter"`
- [x] `AccountsTab.tsx` contains `providerPreferenceDialog` state variable
- [x] `AccountsTab.tsx` mounts dialog with both `onSetProviderPreference` and `onClearProviderPreference`
- [x] Commit 91349261 exists in git log
- [x] Commit b0c24784 exists in git log
- [x] 12 TDD tests GREEN
- [x] 70 total dashboard tests pass
- [x] typecheck exits 0 (for dashboard-web scope)
