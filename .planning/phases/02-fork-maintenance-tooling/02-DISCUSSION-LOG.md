# Phase 2: Fork Maintenance Tooling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-05
**Phase:** 02-fork-maintenance-tooling
**Areas discussed:** Pre-merge check detection, Patch export commit identification, Trigger model, Script execution context, Agent merge doc

---

## Pre-merge check: detection

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded list | Script knows exactly the 3 high-risk files. Simple, explicit, zero surprises. | ✓ |
| Scan for // FORK PATCH: comments | Greps codebase dynamically. Adapts as patches grow, but adds overhead. | |
| Both — static list + FORK PATCH scan | Hardcoded list is primary; scan is additive. More complete but more complex. | |

**User's choice:** Hardcoded list
**Notes:** None

---

## Pre-merge check: comparison target

| Option | Description | Selected |
|--------|-------------|----------|
| upstream/main | Shows what's actually coming from upstream. Requires prior `git fetch upstream`. | ✓ |
| main (local tracking branch) | Simpler — no fetch required. But may lag behind upstream/main. | |
| Fetch upstream first, then compare | Script runs the fetch itself — always fresh but network-dependent. | |

**User's choice:** upstream/main
**Notes:** None

---

## Pre-merge check: output format

| Option | Description | Selected |
|--------|-------------|----------|
| Diff + commit log per file | git diff + git log per high-risk file. Human-readable, actionable. | ✓ |
| Diff only | Just the unified diff for each file. Clean but no commit context. | |
| Conflict-prediction summary | Dry-run merge in temp branch. More automated but destructive. | |

**User's choice:** Diff + commit log per file
**Notes:** None

---

## Patch export: commit identification

| Option | Description | Selected |
|--------|-------------|----------|
| Commits in thamw-main not in upstream/main | Complete fork delta via `git log upstream/main..thamw-main`. | ✓ |
| Commits in thamw-main not in main | Narrower — local working branch delta. | |
| Only commits touching specific files | Filtered by high-risk file paths. Smaller but may miss coordinated changes. | |

**User's choice:** Commits in thamw-main not in upstream/main
**Notes:** None

---

## Patch export: format

| Option | Description | Selected |
|--------|-------------|----------|
| Why patches? | User questioned whether patches were needed given `git merge upstream/main`. | (question) |
| git format-patch series | One .patch per commit. Replayable with `git am`. | ✓ |
| Single unified diff | One file, human-readable, manual application. | |
| Skip MAINT-03 — git history is enough | Tag the merge and rely on `git log`. Simpler. | |

**User's choice:** git format-patch series
**Notes:** User initially questioned whether patches were needed. Rationale explained: recovery insurance for bad merges or workflow changes. User accepted and chose format-patch.

---

## Patch export: MANIFEST.md

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — include MANIFEST.md | Index with filename, hash, message, files touched. Easy to scan. | ✓ |
| No — patch files only | format-patch output is already readable. | |

**User's choice:** Yes — include MANIFEST.md
**Notes:** None

---

## Trigger model: script structure

| Option | Description | Selected |
|--------|-------------|----------|
| Two separate scripts | pre-merge-check.sh + post-merge-export.sh. Simple, composable. | ✓ |
| One combined workflow script | Orchestrates full process but awkward pause for manual merge step. | |
| UPSTREAM_MERGE.md as workflow; scripts as building blocks | Doc is the workflow; aligns with agent merge doc idea. | |

**User's choice:** Two separate scripts
**Notes:** None

---

## Trigger model: tagging responsibility

| Option | Description | Selected |
|--------|-------------|----------|
| post-merge-export.sh handles tagging | Script applies tag then exports patches. Atomic. | ✓ |
| Manual — operator runs `git tag` | Relies on operator discipline. | |
| pre-merge-check.sh stages the tag command | Prints exact `git tag` command for copy-paste. | |

**User's choice:** post-merge-export.sh handles tagging
**Notes:** None

---

## Script execution context: CI-safety

| Option | Description | Selected |
|--------|-------------|----------|
| Local-only for now | No CI wiring needed. Human-readable output fine. | ✓ |
| CI-safe from the start | Exit codes + no interactive prompts. | |
| CI-safe exit codes but human-readable output | Best of both. | |

**User's choice:** Local-only for now
**Notes:** None

---

## Script execution context: convenience aliases

| Option | Description | Selected |
|--------|-------------|----------|
| No aliases — run scripts directly | Direct invocation only. UPSTREAM_MERGE.md documents commands. | |
| Add to package.json scripts | Discoverable via `bun run`. Mixes with build scripts. | ✓ |
| Add a Makefile | Idiomatic for shell tooling, no Bun dependency. Adds new file type. | |

**User's choice:** Add to package.json scripts
**Notes:** None

---

## Agent merge doc: content

| Option | Description | Selected |
|--------|-------------|----------|
| Step-by-step merge SOP | Ordered steps an agent can follow autonomously. | ✓ |
| Reference doc only | Prose with context. Good for humans, less actionable for agents. | |
| Runbook format — commands + expected output | Most structured. Commands + success output + failure handling. | |

**User's choice:** Step-by-step merge SOP
**Notes:** User introduced this area (not a pre-identified gray area). Accepted as in-scope for Phase 2 as part of operational tooling.

---

## Agent merge doc: conflict resolution notes

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — per-file resolution notes | Documents what each fork patch does + resolution rule per high-risk file. | ✓ |
| No — let agent read the code | Agent reads FORK PATCH comments and figures out resolution. | |

**User's choice:** Yes — per-file resolution notes
**Notes:** None

---

## Claude's Discretion

None — all decisions were explicitly chosen by the user.

## Deferred Ideas

- CI-safe exit codes — scripts are local-only now; add `exit 1` on conflict detection if CI integration is added later
- Dynamic FORK PATCH detection — `grep -r '// FORK PATCH:'` to build file list dynamically; deferred in favor of hardcoded simplicity
- Makefile — considered as convenience interface; rejected in favor of package.json scripts
