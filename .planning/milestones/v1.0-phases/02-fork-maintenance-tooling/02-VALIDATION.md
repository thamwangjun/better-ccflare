---
phase: 2
slug: fork-maintenance-tooling
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-05
audited: 2026-05-05
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none — built into Bun runtime |
| **Quick run command** | `bun run lint && bun run typecheck` |
| **Full suite command** | `bun run lint && bun run typecheck && bun run format` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run lint && bun run typecheck`
- **After every plan wave:** Run `bun run lint && bun run typecheck && bun run format`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 01 | 1 | MAINT-01 | T-02-05 | upstream guard aborts on missing ref | static+manual | `bash -n .planning/scripts/pre-merge-check.sh && test -x .planning/scripts/pre-merge-check.sh && grep -q "upstream/main" .planning/scripts/pre-merge-check.sh && echo OK` | ✅ | ✅ green |
| 02-01-T2 | 01 | 1 | MAINT-02, MAINT-03 | T-02-01, T-02-02 | tag collision loop; rm -f scoped to patches dir | static+manual | `bash -n .planning/scripts/post-merge-export.sh && test -x .planning/scripts/post-merge-export.sh && grep -q "merged-upstream-" .planning/scripts/post-merge-export.sh && echo OK` | ✅ | ✅ green |
| 02-01-T3 | 01 | 1 | MAINT-01, MAINT-02, MAINT-03 | — | N/A | automated | `grep -q '"pre-merge-check"' package.json && grep -q '"post-merge-export"' package.json && echo OK` | ✅ | ✅ green |
| 02-01-T4 | 01 | 1 | MAINT-03 | — | N/A | file-exists | `ls .planning/fork_plans/UPSTREAM_MERGE.md && grep -c "## Step" .planning/fork_plans/UPSTREAM_MERGE.md` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This phase creates shell scripts and markdown documentation — no test framework setup needed. Verification is via file-existence checks and manual script invocation.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| pre-merge-check.sh prints colored diff and log for all 3 high-risk files | MAINT-01 | Requires live git state with upstream/main available | Run `git fetch upstream && bash .planning/scripts/pre-merge-check.sh`; verify output shows diffs for all 3 files |
| post-merge-export.sh creates `merged-upstream-YYYYMMDD` tag | MAINT-02 | Requires an actual merge commit in history | After a test merge: `bash .planning/scripts/post-merge-export.sh && git tag --list "merged-upstream-*"` |
| post-merge-export.sh writes .patch files and MANIFEST.md to .planning/patches/ | MAINT-03 | Requires fork-only commits to exist | `bash .planning/scripts/post-merge-export.sh && ls .planning/patches/*.patch && cat .planning/patches/MANIFEST.md` |
| package.json `pre-merge-check` and `post-merge-export` aliases resolve correctly | D-11 | Requires Bun runtime and valid package.json | `bun run pre-merge-check` and `bun run post-merge-export` execute without "missing script" error |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete

---

## Validation Audit 2026-05-05

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 4 (statuses updated from pending → green) |
| Escalated to manual-only | 0 |

**Notes:** All 4 tasks were COVERED by static verification (bash-n syntax check, executable bit, content grep). Deliverables are shell scripts and markdown — static analysis is the appropriate automated verification tier. Runtime behavior (running scripts against live upstream remote) is correctly classified as manual-only due to upstream git dependency. No new test files required.
