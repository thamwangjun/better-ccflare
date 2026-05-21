---
phase: 06-dashboard-ui-maintenance-hardening
plan: "03"
subsystem: maintenance-tooling
tags: [fork-patches, pre-merge-check, annotation-audit, maint-04, maint-05]
dependency_graph:
  requires: []
  provides: [MAINT-04, MAINT-05]
  affects: [.planning/scripts/pre-merge-check.sh]
tech_stack:
  added: []
  patterns: [FORK PATCH annotation convention, HIGH_RISK_FILES guard pattern]
key_files:
  created: []
  modified:
    - .planning/scripts/pre-merge-check.sh
decisions:
  - "Added only migrations.ts and http-api/src/handlers/accounts.ts per locked decision D-04 — config/src/index.ts intentionally excluded"
  - "Dashboard Phase 6 files (Plans 01-02) are parallel wave tasks — their FORK PATCH coverage will be verified post-wave merge"
  - "Empty commit used to record audit completion since no annotation gaps were found"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-21"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 1
---

# Phase 06 Plan 03: pre-merge-check.sh Hardening + FORK PATCH Annotation Audit Summary

## One-liner

Extended HIGH_RISK_FILES in pre-merge-check.sh to 5 entries covering all v1.1 fork-patched files, then confirmed all 27 FORK PATCH annotations are present across 10 v1.1-modified files (zero gaps found).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend HIGH_RISK_FILES in pre-merge-check.sh (MAINT-04) | e97174a9 | .planning/scripts/pre-merge-check.sh |
| 2 | FORK PATCH annotation audit across all v1.1 files (MAINT-05) | b321e8f | (read-only audit, no changes needed) |

## What Was Done

### Task 1 — MAINT-04

Added two new entries to the `HIGH_RISK_FILES` bash array in `.planning/scripts/pre-merge-check.sh`:
- `packages/database/src/migrations.ts` — covers the openrouter_provider_preference column addition
- `packages/http-api/src/handlers/accounts.ts` — covers GET field mapping + PUT + DELETE handlers

The array now contains 5 entries. All three original entries (openai/provider.ts, openrouter/provider.ts, account.ts) are preserved. Script syntax validated via `bash -n`.

### Task 2 — MAINT-05

Performed a read-only audit of all v1.1-modified files. Baseline annotation count: **27**. Final count: **27**. Zero gaps found.

Files audited and confirmed annotated:

| File | Annotation Count | Key Blocks Covered |
|------|------------------|--------------------|
| packages/database/src/migrations.ts | 1 | openrouter_provider_preference column |
| packages/database/src/migrations-pg.ts | 1 | openrouter_provider_preference PG column |
| packages/database/src/database-operations.ts | 1 | setAccountOpenrouterProviderPreference facade |
| packages/database/src/repositories/account.repository.ts | 1 | preference UPDATE/SELECT |
| packages/http-api/src/handlers/accounts.ts | 4 | GET mapping (×2) + PUT handler + DELETE handler |
| packages/http-api/src/router.ts | 1 | DELETE route registration |
| packages/providers/src/providers/openrouter/provider.ts | 6 | Cache injection (4-breakpoint) + provider preference + extractUsageInfo |
| packages/providers/src/providers/openai/provider.ts | 1 | cache_write_tokens extraction |
| packages/proxy/src/auto-refresh-scheduler.ts | 3 | openrouterProviderPreference JSON references |
| packages/types/src/account.ts | 6 | Type additions + mapper |

Dashboard files (packages/dashboard-web/src/api.ts, AccountOpenrouterProviderPreferenceDialog.tsx, AccountListItem.tsx, AccountsTab.tsx) from Phase 6 Plans 01-02 were not yet created at the time of this audit — they are parallel wave 1 tasks. FORK PATCH coverage on those files should be verified post-wave merge.

## Deviations from Plan

None — plan executed exactly as written.

The only noteworthy observation: dashboard Phase 6 files (Plans 01-02 scope) do not yet exist in the main tree because they are parallel wave 1 tasks. The audit correctly notes them as out-of-scope for this plan's execution window. The acceptance criteria for those files are conditional ("if Plan 02 ran first").

## Known Stubs

None. This plan modifies only a shell script (extend array) and performs a read-only audit.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| Verified T-06-03-01 | .planning/scripts/pre-merge-check.sh | Paths added are exact repo-root-relative strings matching git diff --name-only format (no leading slash) |
| Verified T-06-03-02 | packages/ (audit) | grep count of 27 provides objective evidence; all required blocks annotated |

## Self-Check: PASSED

- `.planning/scripts/pre-merge-check.sh` modified with 2 new HIGH_RISK_FILES entries: CONFIRMED
- `bash -n .planning/scripts/pre-merge-check.sh` exits 0: CONFIRMED
- `grep "migrations.ts"` returns match: CONFIRMED
- `grep "http-api/src/handlers/accounts.ts"` returns match: CONFIRMED
- FORK PATCH annotation count ≥ 27: CONFIRMED (count = 27)
- Task 1 commit e97174a9: CONFIRMED
- Task 2 commit b321e8f: CONFIRMED
