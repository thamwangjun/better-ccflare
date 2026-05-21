---
phase: 06-dashboard-ui-maintenance-hardening
plan: 01
subsystem: dashboard-web
tags: [tdd, red-gate, openrouter, provider-preference, PROV-04]
dependency_graph:
  requires: []
  provides: [TDD RED gate for AccountOpenrouterProviderPreferenceDialog parse/branch/sync logic]
  affects: [06-02-PLAN.md — Plan 02 must implement the three exported functions to turn tests green]
tech_stack:
  added: []
  patterns: [bun:test pure function tests, no DOM, no JSX]
key_files:
  created:
    - packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.ts
  modified: []
decisions:
  - "Used .ts (not .tsx) extension to avoid JSX transform overhead for pure function tests"
  - "Import from '../AccountOpenrouterProviderPreferenceDialog' intentionally fails at module resolution — this is the RED gate mechanism"
  - "syncProviderPreferenceState tests use 'as unknown as Account' cast to avoid providing all 30+ required Account fields"
metrics:
  duration: "~3 minutes"
  completed: "2026-05-21"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 06 Plan 01: TDD RED Gate — Provider Preference Dialog Logic Summary

## Objective

Establish the TDD RED gate for `AccountOpenrouterProviderPreferenceDialog` by writing 12 failing tests that define the contract Plan 02 must satisfy when implementing parse, branch, and sync functions for the OpenRouter provider preference dialog.

## What Was Built

A single test file at `packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.ts` containing 12 test cases across three describe blocks:

- **`parseProviderOrder`** (5 cases): comma-split with whitespace trimming, empty string → [], whitespace-only → [], single item → single-element array
- **`resolveProviderPreferenceSaveAction`** (3 cases): empty array → "clear", non-empty → "set"
- **`syncProviderPreferenceState`** (4 cases): null account → defaults, null preference → defaults, preference with allowFallbacks=true, preference with allowFallbacks=false

## RED Gate Verification

```
bun test packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.ts
# error: Cannot find module '../AccountOpenrouterProviderPreferenceDialog'
# 0 pass, 1 fail, Exit: 1
```

Test exits non-zero as required. Import fails at module resolution because `AccountOpenrouterProviderPreferenceDialog.tsx` does not exist yet — Plan 02 creates it.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 3aa6eda7 | test(06-01): add failing tests for provider preference dialog parse/branch logic |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This is a test-only plan — no production code stubs exist.

## Threat Flags

None. Test file introduces no new network endpoints, auth paths, or trust boundaries.

## Self-Check: PASSED

- [x] File exists: `packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.ts`
- [x] Commit 3aa6eda7 exists in git log
- [x] bun test exits non-zero (RED gate confirmed)
- [x] 12 test cases (exceeds minimum of 11)
- [x] 3 describe blocks: parseProviderOrder, resolveProviderPreferenceSaveAction, syncProviderPreferenceState
- [x] No React import, no JSX, no DOM
- [x] File header contains `// FORK PATCH: TDD RED gate for provider preferences dialog (PROV-04)`
