---
phase: quick
plan: 260521-nd3
slug: address-tech-debt-v11
description: address all 5 items in tech debt
status: complete
date: 2026-05-21
commits:
  - 19406b16
  - e81e0b94
  - 6b96c598
tasks_completed: 3
tasks_total: 3
files_modified:
  - packages/http-api/src/router.ts
  - packages/dashboard-web/src/components/accounts/AccountList.tsx
  - .planning/REQUIREMENTS.md
---

# Quick Task 260521-nd3: Address All 5 v1.1 Tech Debt Items

**Completed:** 2026-05-21  
**Status:** complete

## Tasks

### Task 1 — TD-1: router.ts PUT annotation (commit 19406b16)

Added `// FORK PATCH: set OpenRouter provider preference` at `packages/http-api/src/router.ts:620`, before the PUT if-block for `/openrouter-provider-preference`. The DELETE block at line 633 already had the annotation; now both blocks are annotated — MAINT-05 compliant.

### Task 2 — TD-2: AccountList.tsx prop annotation (commit e81e0b94)

Added `// FORK PATCH: thread provider preference change handler (PROV-04)` at `packages/dashboard-web/src/components/accounts/AccountList.tsx:19`, before the `onProviderPreferenceChange?` prop declaration. One annotation covers all three fork-modified lines (19, 40, 86).

### Task 3 — TD-3, TD-4, TD-5: REQUIREMENTS.md fixes (commit 6b96c598)

- **TD-3**: Added env-var gate note to CACHE-04 — `(note: the ttl: "1h" split on system/tools blocks is gated on SYSTEM_PROMPT_CACHE_TTL_1H=true; defaults to false — standard deploys only inject { type: "ephemeral" })`
- **TD-4**: Marked 6 stale checkboxes `[x]`: CACHE-03, CACHE-04, CACHE-05, PROV-01, PROV-02, PROV-03
- **TD-5**: Updated MAINT-04 description — removed `config/src/index.ts` from HIGH_RISK_FILES list (was never a fork-patched file; excluded by locked decision D-04)
- Also updated traceability table: all 9 REQ-IDs now show `Complete`

## Lint / Typecheck

All changes are comment/documentation only. `bun run typecheck` exits 0. No logic touched.
