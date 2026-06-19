---
phase: quick-260619-l4e
plan: 01
subsystem: upstream-sync
tags: [merge, upstream, v3.5.27, claude-md, migrations]
requires: [thamw-main@4c48a818, tag v3.5.27@4c217257]
provides: [merge/upstream-v3.5.27@b40180bf]
affects: [CLAUDE.md, models, migrations, integrity, usage-accounting]
key-files:
  modified:
    - CLAUDE.md
    - packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts
decisions:
  - "CLAUDE.md resolved in favor of the fork's trimmed version; folded in only two genuinely-new upstream items (greptile-reviewer agent dispatch, gitnexus-analyst token discipline) since those agent files were added by the merge"
metrics:
  duration: ~6m
  completed: 2026-06-19
---

# Phase quick-260619-l4e Plan 01: Merge upstream tag v3.5.27 Summary

Merged upstream tag v3.5.27 (Opus 4.8 + Fable 5 models, large-DB integrity fixes #259, Postgres pool/idle-timeout config #258, Greptile/GitNexus agent tooling) into a fresh `--no-ff` branch off thamw-main, preserving the fork's OpenRouter-Anthropic provider and cost-accounting rework.

## Result

- **Branch:** `merge/upstream-v3.5.27`
- **Merge commit:** `b40180bf` (parents: `4c48a818` thamw-main, `4c217257` v3.5.27)
- **Conflicts:** exactly one — `CLAUDE.md` — resolved in favor of the fork.

## What Was Done

1. Confirmed the in-progress merge had `CLAUDE.md` as the sole conflict (UU); all source auto-merged.
2. Resolved `CLAUDE.md`: kept the fork's full trimmed content (safety rules, migration-parity section, git refspec rules, Qwen/OpenRouter notes, GitNexus block, Developer Profile). Folded in two genuinely-new, non-conflicting upstream items now backed by merge-added agent files: (a) prefer the `greptile-reviewer` agent for Pre-PR review, (b) a GitNexus token-discipline note routing GitNexus MCP calls through the `gitnexus-analyst` subagent. Dropped nothing of the fork's. No conflict markers remain.
3. Guarded auto-generated files — `inline-worker.ts`, `inline-vacuum-worker.ts`, `inline-integrity-check-worker.ts` are byte-identical to thamw-main (merge did not touch them; no restore needed).
4. Verified overlap zones:
   - **Models:** `OPUS_4_8` ("claude-opus-4-8") and `FABLE_5` ("claude-fable-5") registered in `packages/core/src/models.ts`; `openrouter-anthropic` provider directory intact.
   - **Integrity + usage:** upstream integrity-scheduler/integrity-check-runner changes present; fork `providerCostUsd` retained in `usage-collector.ts`/`usage-extraction.ts`.
   - **Migration parity:** new `fable` family seed added to BOTH SQLite (`ensureSchema`) and PG (`ensureSchemaPg` + `runMigrationsPg`). Consistent.
   - **Version files:** changed only via the upstream merge; not hand-edited (no manual version bump).
5. Completed the merge commit, then amended it with one merge-integration test fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test fixture missing upstream-added column**
- **Found during:** Task 4 (validation)
- **Issue:** Fork test `account-openrouter-preference.test.ts` builds an inline `accounts` table fixture that predates upstream's `consecutive_rate_limits` column. Upstream's `AccountRepository.findById`/`findAll` SELECTs now reference `consecutive_rate_limits`, so both fork tests failed with `SQLiteError: no such column: consecutive_rate_limits`.
- **Fix:** Added `consecutive_rate_limits INTEGER NOT NULL DEFAULT 0` to the test fixture's `CREATE TABLE accounts`.
- **Files modified:** `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts`
- **Commit:** folded into merge commit `b40180bf` (amend)

## Validation

| Check | Result |
|-------|--------|
| `bun run lint` | exit 0 (237 warnings, no errors — pre-existing) |
| `bun run typecheck` | exit 0 |
| `bun run format` | exit 0, no files reformatted |
| `bun test packages/providers packages/database packages/proxy` | 962 pass, 0 fail |

The 2 reported test-runner "errors" are `# Unhandled error between tests` during DB teardown (`PRAGMA wal_checkpoint(TRUNCATE)` → `SQLITE_IOERR_VNODE`), a sandbox filesystem teardown artifact unrelated to the merge. All 962 tests pass.

## Deferred Issues

- Pre-existing teardown noise (`SQLITE_IOERR_VNODE` on `wal_checkpoint`) surfaces as 2 unhandled errors between tests; not caused by this merge, not blocking. Logged here for visibility.

## Self-Check: PASSED

- FOUND: CLAUDE.md (resolved, staged, fork sections intact)
- FOUND: packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts (fixture fixed)
- FOUND: merge commit b40180bf (2 parents, --no-ff)
- FOUND: auto-generated inline workers unchanged vs thamw-main
