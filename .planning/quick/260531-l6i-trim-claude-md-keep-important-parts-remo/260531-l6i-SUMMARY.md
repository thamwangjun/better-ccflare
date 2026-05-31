---
quick_id: 260531-l6i
title: Trim CLAUDE.md, keep important parts, remove redundant parts
status: complete
---

# Quick Task 260531-l6i: Trim CLAUDE.md — Summary

## Outcome
CLAUDE.md trimmed from **480 → 178 lines** (~63% smaller). All load-bearing
safety rules preserved; redundancy removed; auto-generated blocks collapsed to
essentials with marker comments intact.

## What changed
- **Hand-written section:**
  - Consolidated three "NEVER bump version" mentions (Publishing/Version Updates) into one CRITICAL rule.
  - Merged file-exclusion + README rules into a single CRITICAL Safety block.
  - Combined Git Refspecs + Branch Management + Git Commits + Commit Message Categories into one "Git" section (removed the duplicated commit-prefix list that also lived in the conventions block).
  - Kept verbatim-in-intent: never-curl-Anthropic, PG migration porting checklist, DB paths, all commands, Qwen provider notes, PR-review-against-main, external-PR merge flow.
- **Auto-generated blocks (collapsed, markers preserved exactly):**
  - GitNexus: kept Always/Never rules + staleness note; dropped large resource/CLI tables.
  - STACK / CONVENTIONS / ARCHITECTURE: condensed verbose lists to essential bullets.
  - PROJECT / skills / workflow / profile: kept brief.

## Verification
- All 8 GSD/GitNexus marker pairs present and correctly ordered (`command grep` check).
- `inline-worker.ts`, `inline-vacuum-worker.ts`, `inline-integrity-check-worker.ts` untouched.
- Markdown-only change — no lint/typecheck needed.

## Notes
- Collapsed auto-generated content may regrow when GSD/gitnexus tools regenerate those sections (accepted by user).
- Pre-existing uncommitted files (`.planning/STATE.md` prior edits, `.continue-here.md`) were left out of this task's commit.
