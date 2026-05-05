---
phase: 02-fork-maintenance-tooling
reviewed: 2026-05-05T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - .planning/scripts/pre-merge-check.sh
  - .planning/scripts/post-merge-export.sh
  - package.json
  - .gitignore
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-05T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed two fork maintenance shell scripts (`pre-merge-check.sh`, `post-merge-export.sh`), `package.json`, and `.gitignore`. The scripts are generally well-structured — `set -euo pipefail` is present, arrays are quoted, and bash 3.2 compatibility concerns are addressed with `while`-loop patterns. No security vulnerabilities or critical bugs found.

Four warnings are raised: `rm -f` deletes patches without existence check, `ls` glob in process substitution will exit non-zero under `set -e` when no patches exist, a missing `mkdir -p` for `PATCHES_DIR` before first use, and index-misalignment between `PATCH_FILES` and `COMMITS` arrays that silently produces wrong manifest rows. Three info items cover a hardcoded branch name, a missing `--no-gpg-sign` consideration note, and a `.gitignore` pattern ordering subtlety.

## Warnings

### WR-01: `ls *.patch` under `set -e` silently fails when patches directory is empty

**File:** `.planning/scripts/post-merge-export.sh:41`
**Issue:** The process substitution `ls "${PATCHES_DIR}"/*.patch 2>/dev/null | sort` suppresses stderr but does NOT suppress the non-zero exit code from `ls` when no `.patch` files exist (glob expansion is attempted by the shell in some environments, and `ls` itself may exit non-zero). Under `set -e`, a non-zero exit from a command substitution or process substitution in certain bash versions can abort the script before the manifest logic runs. The `2>/dev/null` only hides the error message — it does not prevent `set -e` from firing when `ls` exits 1.

**Fix:** Use `find` or a glob with an existence guard:
```bash
PATCH_FILES=()
while IFS= read -r f; do PATCH_FILES+=("$f"); done < <(
  find "${PATCHES_DIR}" -maxdepth 1 -name "*.patch" | sort
)
```
`find` exits 0 even when no files match, making it safe under `set -e`.

---

### WR-02: `PATCH_FILES` and `COMMITS` arrays may be misaligned, producing wrong manifest rows

**File:** `.planning/scripts/post-merge-export.sh:58-65`
**Issue:** The manifest loop pairs `PATCH_FILES[$i]` with `COMMITS[$i]` by numeric index, assuming `format-patch` produces exactly one patch per commit and in the same order as `git log --reverse`. This is true in the normal case but breaks silently if:
- A commit is empty (no diff); `format-patch` skips it, `git log` does not.
- A merge commit slips through (both commands use `--no-merges` — that part is fine).
- Any future option changes the ordering.

When the arrays are misaligned, the manifest row shows the wrong commit hash against a patch file — corrupt data with no error.

**Fix:** Extract the commit hash from the patch file header itself, which is always present:
```bash
for patch_file in "${PATCH_FILES[@]}"; do
  hash=$(grep -m1 "^From " "${patch_file}" | awk '{print $2}' | cut -c1-7)
  msg=$(git log -1 --pretty=format:"%s" "${hash}" 2>/dev/null || echo "unknown")
  files=$(git show --name-only --format="" "${hash}" | paste -sd ',' - | sed 's/,/, /g')
  echo "| \`$(basename "${patch_file}")\` | \`${hash}\` | ${msg} | ${files} |"
done
```
This makes each row self-contained and immune to ordering mismatches.

---

### WR-03: `PATCHES_DIR` is not created before use — script aborts on first run

**File:** `.planning/scripts/post-merge-export.sh:29`
**Issue:** `rm -f "${PATCHES_DIR}"/*.patch` and `git format-patch --output-directory "${PATCHES_DIR}"` both require `PATCHES_DIR` to exist. If `.planning/patches/` has never been created (e.g., fresh clone, or directory accidentally deleted), `git format-patch` exits non-zero and the script aborts under `set -e`. There is no `mkdir -p` guard.

**Fix:** Add directory creation before the `rm -f` line:
```bash
mkdir -p "${PATCHES_DIR}"
rm -f "${PATCHES_DIR}"/*.patch
```

---

### WR-04: `rm -f` glob expansion on empty directory is a no-op but masks absence of expected files

**File:** `.planning/scripts/post-merge-export.sh:29`
**Issue:** `rm -f "${PATCHES_DIR}"/*.patch` with no matching files expands to the literal string `.planning/patches/*.patch` on bash with `set -u` when nullglob is not set. Under `set -e` + `set -u`, bash will NOT fail here (rm -f tolerates non-existent files), but the literal glob string is passed to `rm` which silently does nothing. This is benign in isolation but indicates the script does not explicitly enable `nullglob`, which means glob behavior is environment-dependent.

**Fix:** Either enable `nullglob` locally or use a conditional:
```bash
# Option A: nullglob
shopt -s nullglob
rm -f "${PATCHES_DIR}"/*.patch
shopt -u nullglob

# Option B: conditional
if ls "${PATCHES_DIR}"/*.patch > /dev/null 2>&1; then
  rm -f "${PATCHES_DIR}"/*.patch
fi
```
Option A is simpler and idiomatic.

---

## Info

### IN-01: Hardcoded branch name `thamw-main` reduces portability

**File:** `.planning/scripts/pre-merge-check.sh:25`
**File:** `.planning/scripts/post-merge-export.sh:30,44`
**Issue:** Both scripts hardcode `thamw-main` as the fork branch name. If the branch is renamed or someone else uses these scripts, every `git log` and `git format-patch` invocation will fail silently or produce empty output against the wrong range.

**Fix:** Derive the branch name from git at runtime:
```bash
FORK_BRANCH=$(git rev-parse --abbrev-ref HEAD)
```
Then replace `thamw-main` with `${FORK_BRANCH}`. If the scripts must always target a specific branch regardless of current HEAD, define it as a named constant at the top of the file with a comment explaining the intent:
```bash
FORK_BRANCH="thamw-main"  # Personal fork branch — change if renamed
```

---

### IN-02: `git show --name-only --format=""` produces a leading blank line in some git versions

**File:** `.planning/scripts/post-merge-export.sh:63`
**Issue:** `git show --name-only --format=""` with an empty `--format` string emits a blank line at the start of output in some git versions (the separator line between the commit header and file list). This means `paste -sd ',' -` may capture an empty first field, producing `, file1, file2` in the manifest instead of `file1, file2`.

**Fix:** Filter the blank line:
```bash
files=$(git show --name-only --format="" "${hash}" | grep -v '^$' | paste -sd ',' - | sed 's/,/, /g')
```

---

### IN-03: `.gitignore` excludes `CLAUDE.md` and `AGENTS.md` — these are project-critical files

**File:** `.gitignore:19-20`
**Issue:** `CLAUDE.md` and `AGENTS.md` are listed in `.gitignore`. These files contain project instructions and conventions that are checked into the codebase (CLAUDE.md is explicitly noted as "project instructions, checked into the codebase" in the system context). Ignoring them means `git status` will not show local edits to these files, and any accidental regeneration would not be catchable before commit.

If these are intentionally ignored (e.g., they are auto-generated by a workflow and should not be committed upstream), this is fine — but the intent should be documented with a comment. If they are checked in, they should be removed from `.gitignore`.

**Fix:** Add a comment clarifying intent:
```gitignore
# AI assistant instruction files — auto-generated by /gsd-profile-user; not committed upstream
CLAUDE.md
AGENTS.md
```
Or remove them from `.gitignore` if they should be tracked.

---

_Reviewed: 2026-05-05T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
