---
phase: 02-fork-maintenance-tooling
plan: 01
subsystem: infra
tags: [git, bash, fork-maintenance, shell-scripts, patch-workflow]

# Dependency graph
requires:
  - phase: 01-correctness-patch-hardening
    provides: Fork patches on thamw-main that the scripts and SOP document
provides:
  - pre-merge check shell script for 3 high-risk files vs upstream/main
  - post-merge tagging and patch export shell script with MANIFEST generation
  - package.json convenience aliases for both scripts
  - agent-facing upstream merge SOP with per-file conflict resolution notes
affects: [future upstream merges, any agent performing upstream sync work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shell scripts in .planning/scripts/ with set -euo pipefail and upstream/main guard"
    - "Bash 3.2-compatible array population via while IFS= read -r loop (avoids mapfile)"
    - "FORK PATCH inline comment convention for marking fork-specific code sections"

key-files:
  created:
    - .planning/scripts/pre-merge-check.sh
    - .planning/scripts/post-merge-export.sh
    - .planning/fork_plans/UPSTREAM_MERGE.md
  modified:
    - package.json
    - .gitignore

key-decisions:
  - "Hardcoded high-risk file list in pre-merge-check.sh (not dynamic scanning) — simpler and stable"
  - "patch files in .planning/patches/ are gitignored — generated artifacts, not committed history"
  - "Added .gitignore exception for .planning/scripts/*.sh to allow committing operational scripts"
  - "Used while IFS= read -r c || [[ -n \"$c\" ]] to capture git log last line without trailing newline"

patterns-established:
  - "Fork scripts live in .planning/scripts/ with .gitignore exception; patch exports are gitignored"
  - "SOP documents reference bun run aliases, not raw script paths"

requirements-completed: [MAINT-01, MAINT-02, MAINT-03]

# Metrics
duration: 25min
completed: 2026-05-05
---

# Phase 2 Plan 01: Fork Maintenance Tooling Summary

**Two executable shell scripts (pre-merge check and post-merge tag+patch export) with package.json aliases and a 6-step agent-facing SOP covering per-file conflict resolution for all 3 high-risk fork files**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-05T07:00:00Z
- **Completed:** 2026-05-05T07:25:00Z
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- `pre-merge-check.sh`: hardcodes 3 high-risk files, guards for `upstream/main`, prints diff + fork commit log per file using color-auto (no TTY detection needed)
- `post-merge-export.sh`: applies `merged-upstream-YYYYMMDD` tag with same-day suffix fallback, clears+regenerates `.planning/patches/` with `git format-patch --no-merges`, writes MANIFEST.md with 20-row table aligning patches to commits
- `UPSTREAM_MERGE.md`: 6-step SOP (fetch → inspect → merge → resolve → export → push) with per-file resolution notes for all 3 high-risk files including exact FORK PATCH comments, resolution rules, and 2 edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1: Create pre-merge-check.sh** - `f8200ed` (add)
2. **Task 2: Create post-merge-export.sh and package.json aliases** - `6d970c5` (add)
3. **Task 3: Create UPSTREAM_MERGE.md agent SOP** - `489a61f` (add)

**Additional fix commits (part of plan execution):**
- `bb8907e` — fix(02-01): capture last commit in MANIFEST generation without trailing newline
- `0d725c4` — chore(02-01): gitignore generated patch exports in .planning/patches/

## Files Created/Modified

- `.planning/scripts/pre-merge-check.sh` — pre-merge diff+log inspection of 3 high-risk fork files vs upstream/main
- `.planning/scripts/post-merge-export.sh` — post-merge tagging, patch export, and MANIFEST generation
- `.planning/fork_plans/UPSTREAM_MERGE.md` — agent-facing 6-step merge SOP with per-file conflict resolution notes
- `package.json` — added `pre-merge-check` and `post-merge-export` script aliases
- `.gitignore` — added exception for `.planning/scripts/*.sh`; added exclusion for generated patch exports

## Decisions Made

- **Gitignore exception for .planning/scripts/*.sh**: The project's `.gitignore` has `**/*.sh` blocking all shell scripts except `.github/scripts/`. Added `!.planning/scripts/*.sh` exception to allow operational scripts to be committed. This is a Rule 3 auto-fix (blocking issue).
- **Gitignore patch exports**: `.planning/patches/*.patch` and `MANIFEST.md` are generated artifacts that change on every run. Gitignoring them keeps the repo clean; git tags provide durable commit references.
- **Bash 3.2 last-line fix**: `--pretty=format:` in git log omits the trailing newline on the final line, causing `while IFS= read -r` to miss the last commit. Fixed with `|| [[ -n "$c" ]]` guard in the read loop.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added .gitignore exception for .planning/scripts/*.sh**
- **Found during:** Task 1 (pre-merge-check.sh creation)
- **Issue:** Project `.gitignore` has `**/*.sh` blocking all shell scripts except `.github/scripts/`. Without an exception, the scripts could not be committed.
- **Fix:** Added `!.planning/scripts/*.sh` exception to `.gitignore`. Committed alongside Task 1 files.
- **Files modified:** `.gitignore`
- **Verification:** `git status` showed `.planning/scripts/pre-merge-check.sh` as untracked (visible) after the exception was added.
- **Committed in:** `f8200ed` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed last-commit omission in MANIFEST generation**
- **Found during:** Post-task verification (smoke test of post-merge-export.sh)
- **Issue:** `git log --pretty=format:"%h|%s"` does not emit a trailing newline on the last line. `while IFS= read -r` only captures lines that end with a newline, so the last commit (20th) was missing from the MANIFEST — producing 19 rows for 20 patches.
- **Fix:** Changed `while IFS= read -r c; do` to `while IFS= read -r c || [[ -n "$c" ]]; do` — the `||` clause captures the final line regardless of trailing newline.
- **Files modified:** `.planning/scripts/post-merge-export.sh`
- **Verification:** Re-ran `bash .planning/scripts/post-merge-export.sh` — MANIFEST now has 20 rows for 20 patches; script exits 0.
- **Committed in:** `bb8907e`

**3. [Rule 2 - Missing Critical] Gitignore generated patch exports**
- **Found during:** After Task 2 (smoke test)
- **Issue:** Running post-merge-export.sh created 20 `.patch` files and `MANIFEST.md` in `.planning/patches/` — untracked files that would accumulate in the repo if not ignored. These are regenerated on every merge run; committing them creates noise.
- **Fix:** Added `.planning/patches/*.patch` and `.planning/patches/MANIFEST.md` to `.gitignore`.
- **Files modified:** `.gitignore`
- **Verification:** `git status --short` shows only `.gitignore` as modified after the patch files are generated.
- **Committed in:** `0d725c4`

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing critical)
**Impact on plan:** All auto-fixes necessary for correctness and operability. No scope creep.

## Issues Encountered

- **Pre-existing lint/typecheck failures**: `bun run lint` fails on `packages/core/src/pricing.ts` (noNonNullAssertion, noExplicitAny); `bun run typecheck` fails on missing auto-generated files (`inline-worker.ts`, `embedded-tiktoken-wasm.ts`) that require `bun run build` first. These are pre-existing issues unrelated to this plan's changes (only `package.json` and `.gitignore` were modified; no TypeScript files were touched).

## User Setup Required

None — no external service configuration required. The scripts work with the existing `upstream` remote which is already configured in the repo.

## Next Phase Readiness

- Fork maintenance tooling is complete and operational. `bun run pre-merge-check` and `bun run post-merge-export` are ready for use on the next upstream merge.
- `.planning/fork_plans/UPSTREAM_MERGE.md` provides a complete agent-executable SOP.
- Phase 2 is now complete (this was the only plan in phase 2).

## Self-Check

### Files exist:
- `.planning/scripts/pre-merge-check.sh` — exists, executable, syntax OK
- `.planning/scripts/post-merge-export.sh` — exists, executable, syntax OK
- `.planning/fork_plans/UPSTREAM_MERGE.md` — exists, 6 ## Step sections
- `package.json` — has pre-merge-check and post-merge-export entries

### Commits exist:
- `f8200ed` — add(02-01): pre-merge check script
- `6d970c5` — add(02-01): post-merge export script and package.json aliases
- `489a61f` — add(02-01): upstream merge SOP
- `bb8907e` — fix(02-01): last-commit MANIFEST fix
- `0d725c4` — chore(02-01): gitignore patch exports

## Self-Check: PASSED

---
*Phase: 02-fork-maintenance-tooling*
*Completed: 2026-05-05*
