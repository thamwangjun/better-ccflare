---
phase: 11-dashboard-wiring
plan: "02"
subsystem: dashboard
tags: [mgmt-03, openrouter-anthropic, add-account-form, tdd-green, fork-patch]
dependency_graph:
  requires: [11-01]
  provides: [MGMT-03]
  affects:
    - packages/dashboard-web/src/api.ts
    - packages/dashboard-web/src/components/AccountsTab.tsx
    - packages/dashboard-web/src/components/accounts/AccountAddForm.tsx
tech_stack:
  added: []
  patterns:
    - FORK PATCH annotation convention for upstream-merge safety
    - One-prop-per-provider pattern (D-04): dedicated handler + prop + API method per provider
    - Verbatim-mirror pattern (D-01): form block copied from openrouter with only D-03 hint changed
key_files:
  created: []
  modified:
    - packages/dashboard-web/src/api.ts
    - packages/dashboard-web/src/components/AccountsTab.tsx
    - packages/dashboard-web/src/components/accounts/AccountAddForm.tsx
decisions:
  - "D-04 one-prop-per-provider: dedicated onAddOpenRouterAnthropicAccount prop + handler + api method, no shared branch"
  - "D-01 verbatim mirror: openrouter-anthropic form block identical to openrouter except D-03 endpoint hint"
  - "D-03 endpoint hint: Endpoint: https://openrouter.ai/api/v1 (native Anthropic Messages)"
  - "Provider-preference handlers (lines 510-534 AccountsTab) left unchanged per D-05 (reused from openrouter)"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-04T10:10:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 3
---

# Phase 11 Plan 02: MGMT-03 openrouter-anthropic Add Account Form Summary

## One-liner

Full end-to-end add-account wiring for openrouter-anthropic: SelectItem + form block + dedicated prop/handler/API method + submit-dispatch branch across three files; turns Plan 01's RED gate GREEN.

## What Was Built

### Task 1: addOpenRouterAnthropicAccount API client method (api.ts)

Two changes in `api.ts`:
1. Extended `initAddAccount` mode union (line ~259) to include `"openrouter-anthropic"`.
2. Added sibling `addOpenRouterAnthropicAccount` method immediately after `addOpenRouterAccount` posting to `/api/accounts/openrouter-anthropic`. Method signature and body structure mirror `addOpenRouterAccount` verbatim; only the URL differs. FORK PATCH annotation present.

### Task 2: handleAddOpenRouterAnthropicAccount handler + prop pass-through (AccountsTab.tsx)

Three changes in `AccountsTab.tsx`:
1. Extended `handleAddAccount` mode union (line ~120) with `"openrouter-anthropic"`.
2. Added sibling `handleAddOpenRouterAnthropicAccount` handler calling `api.addOpenRouterAnthropicAccount`. Try/catch pattern identical to `handleAddOpenRouterAccount` (loadAccounts, setAdding(false), setActionError(null) on success; setActionError + throw on error).
3. Added `onAddOpenRouterAnthropicAccount={handleAddOpenRouterAnthropicAccount}` prop to the `<AccountAddForm>` render.

### Task 3: AccountAddForm.tsx — 8 sites wired (MGMT-03 GREEN)

Eight edits in `AccountAddForm.tsx` closing all union sites and the submit-dispatch landmine:

- **Site 1** (props mode union ~28): `| "openrouter-anthropic"`
- **Site 2** (prop declaration + destructure ~99-144): `onAddOpenRouterAnthropicAccount` prop with identical signature to `onAddOpenRouterAccount`; added to function destructure
- **Site 3** (newAccount state union ~157): `| "openrouter-anthropic"`
- **Site 4** (accountParams cast union ~431): `| "openrouter-anthropic"`
- **Site 5** (submit dispatch — the landmine): sibling `if (newAccount.mode === "openrouter-anthropic")` branch calling `onAddOpenRouterAnthropicAccount` with full `setNewAccount` reset + `onSuccess()` + `return`
- **Site 6** (onValueChange cast): `| "openrouter-anthropic"`
- **Site 7** (SelectItem): `<SelectItem value="openrouter-anthropic">OpenRouter Anthropic Messages (API Key)</SelectItem>` (exact label per D-02/SC#1)
- **Site 8** (form block): sibling `{newAccount.mode === "openrouter-anthropic" && (...)}` block mirroring the openrouter block verbatim; endpoint hint changed to `Endpoint: https://openrouter.ai/api/v1 (native Anthropic Messages)` per D-03; API key Input type="password" preserved (T-11-05 mitigated)

## Verification State

- `bunx tsc --noEmit` exits 0 (only pre-existing auto-generated file errors unrelated to this work)
- `bun test packages/dashboard-web/src/components/accounts/` — 14 pass, 0 fail
- AccountAddForm.test.tsx RED gate (Plan 01) is now GREEN
- AccountListItem.test.tsx 3/3 still pass (regression guard)

## Deviations from Plan

None — plan executed exactly as written. All 8 sites addressed; submit-dispatch landmine closed; FORK PATCH annotations on every addition.

## Known Stubs

None. All data paths are wired end-to-end.

## Threat Flags

None. No new network endpoints beyond the already-existing POST /api/accounts/openrouter-anthropic (Phase 10). T-11-05 (API key Input type) mitigated by verbatim mirror of password-type Input from the openrouter block. T-11-04 (submit branch endpoint correctness) mitigated by dedicated one-handler-per-provider branch (D-04).

## Self-Check: PASSED

- `packages/dashboard-web/src/api.ts` modified: confirmed (addOpenRouterAnthropicAccount exists)
- `packages/dashboard-web/src/components/AccountsTab.tsx` modified: confirmed (handleAddOpenRouterAnthropicAccount exists)
- `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` modified: confirmed (SelectItem with exact label exists)
- Commit 344d39fc (Task 1 — api.ts): confirmed
- Commit 93fbc546 (Task 2 — AccountsTab.tsx): confirmed
- Commit f834a073 (Task 3 — AccountAddForm.tsx): confirmed
- Test result: 14 pass, 0 fail
