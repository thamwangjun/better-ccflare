---
phase: 11-dashboard-wiring
plan: "01"
subsystem: dashboard
tags: [tdd, ssr-test, provider-gate, openrouter-anthropic, MGMT-04, MGMT-03]
dependency_graph:
  requires: []
  provides: [MGMT-04-gate, MGMT-03-red-gate]
  affects:
    - packages/dashboard-web/src/components/accounts/AccountListItem.tsx
    - packages/dashboard-web/src/components/accounts/__tests__/AccountListItem.test.tsx
    - packages/dashboard-web/src/components/accounts/__tests__/AccountAddForm.test.tsx
tech_stack:
  added: []
  patterns:
    - SSR test harness using renderToStaticMarkup (from RateLimitProgress.test.tsx)
    - FORK PATCH annotation convention for upstream-merge safety
    - RED gate test pattern (write failing test before implementation)
key_files:
  created:
    - packages/dashboard-web/src/components/accounts/__tests__/AccountListItem.test.tsx
    - packages/dashboard-web/src/components/accounts/__tests__/AccountAddForm.test.tsx
  modified:
    - packages/dashboard-web/src/components/accounts/AccountListItem.tsx
decisions:
  - "Provider-preference dialog is not relabeled for openrouter-anthropic (deferred per D-05)"
  - "Radix Select hides options in SSR; AccountAddForm test GREEN target is the SelectItem value attribute appearing in markup after Plan 02 adds the item"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-04T09:56:45Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 1
---

# Phase 11 Plan 01: Wave 0 Tests + MGMT-04 Gate Widen Summary

## One-liner

SSR gate test (GREEN) + MGMT-03 RED gate test + one-line boolean OR widen of provider-preference button for openrouter-anthropic cards (MGMT-04).

## What Was Built

### Task 1: AccountListItem SSR gate test (MGMT-04)

Created `__tests__/AccountListItem.test.tsx` with three assertions using `renderToStaticMarkup`:
1. openrouter-anthropic account with `onProviderPreferenceChange` → button present (was RED, turns GREEN after Task 3)
2. openrouter account → button present (regression guard)
3. anthropic account → button absent

### Task 2: AccountAddForm SSR form-render test (MGMT-03 RED)

Created `__tests__/AccountAddForm.test.tsx` asserting the rendered HTML contains the exact label `OpenRouter Anthropic Messages (API Key)` (D-02 / ROADMAP SC#1). This test is intentionally RED — Radix Select hides options in SSR and the SelectItem does not exist yet. Plan 02 satisfies this by adding the SelectItem and wiring the form block.

### Task 3: Provider-preference gate widened (MGMT-04, D-05)

Changed the boolean gate in `AccountListItem.tsx` from:
```tsx
{account.provider === "openrouter" && onProviderPreferenceChange && (
```
to:
```tsx
{(account.provider === "openrouter" ||
    account.provider === "openrouter-anthropic") &&
    onProviderPreferenceChange && (
```

Button body, `onProviderPreferenceChange` handler, `/openrouter-provider-preference` endpoint, and `openrouterProviderPreference` account field are all reused unchanged. No dialog relabel (deferred).

## Verification State

- `bun test packages/dashboard-web/src/components/accounts/` → 18 pass, 1 fail (AccountAddForm RED gate — expected)
- AccountListItem.test.tsx: 3/3 GREEN
- Gate in AccountListItem.tsx contains `account.provider === "openrouter-anthropic"` with FORK PATCH annotation

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The MGMT-03 RED test is intentional (not a stub) — it is a gate for Plan 02.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. T-11-01 and T-11-02 from the plan threat model were analyzed and accepted.

## Self-Check: PASSED

- `__tests__/AccountListItem.test.tsx` exists: confirmed
- `__tests__/AccountAddForm.test.tsx` exists: confirmed
- `AccountListItem.tsx` gate widened: confirmed (`account.provider === "openrouter-anthropic"` present)
- Commits 17bc50bd, 3f5e53ad, d688d5d5: confirmed in git log
