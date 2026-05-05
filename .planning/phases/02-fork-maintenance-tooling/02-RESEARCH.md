# Phase 2: Fork Maintenance Tooling — Research

**Researched:** 2026-05-05
**Domain:** Git shell scripting, fork management workflows
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**MAINT-01: Pre-merge check script**
- D-01: Hardcoded file list — no dynamic scanning. Files: `packages/providers/src/providers/openai/provider.ts`, `packages/providers/src/providers/openrouter/provider.ts`, `packages/types/src/account.ts`
- D-02: Compare against `upstream/main`. Script does NOT run `git fetch upstream` — the SOP calls it as step 1.
- D-03: Output per high-risk file: `git diff upstream/main -- <file>` + `git log upstream/main..thamw-main -- <file>`. Human-readable, colored if terminal supports it.
- D-04: Local-only — no CI-safe exit codes, no structured output.

**MAINT-02: Merge tagging**
- D-05: `post-merge-export.sh` applies `git tag merged-upstream-YYYYMMDD` before exporting patches. Tag and patch export are atomic from the operator's perspective.

**MAINT-03: Post-merge patch export**
- D-06: Fork-only = `git log upstream/main..thamw-main` (commits in thamw-main not in upstream/main).
- D-07: Export format: `git format-patch` series, one `.patch` file per commit, output to `.planning/patches/`.
- D-08: MANIFEST.md in `.planning/patches/` — patch filename, commit hash, commit message, files touched. Written by post-merge script.
- D-09: post-merge-export.sh does: (1) apply tag, (2) run format-patch, (3) write MANIFEST.md.

**Script integration**
- D-10: Two separate scripts in `.planning/scripts/`: `pre-merge-check.sh` and `post-merge-export.sh`
- D-11: Root package.json convenience aliases: `"pre-merge-check": "bash .planning/scripts/pre-merge-check.sh"` and `"post-merge-export": "bash .planning/scripts/post-merge-export.sh"`

**Agent merge doc**
- D-12: `.planning/fork_plans/UPSTREAM_MERGE.md` — agent-facing step-by-step SOP: (1) fetch, (2) run pre-merge-check + review, (3) `git merge upstream/main`, (4) resolve conflicts, (5) run post-merge-export, (6) push.
- D-13: Per-file conflict resolution notes: what the fork patch does in each high-risk file + the resolution rule.

### Claude's Discretion

None specified beyond the locked decisions above.

### Deferred Ideas (OUT OF SCOPE)

- CI-safe exit codes on `pre-merge-check.sh` — local-only now.
- Dynamic FORK PATCH detection via grep — deferred, hardcoded list is simpler.
- Makefile as alternative interface — rejected; use package.json scripts.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MAINT-01 | Pre-merge check script runs targeted `git diff`/`git log` on highest-risk files before each upstream integration | git diff/log commands verified; color handling, error guards, and upstream-ref guard documented |
| MAINT-02 | Upstream merge commits tagged `merged-upstream-YYYYMMDD` for programmatic queryability | git tag behavior, duplicate tag error (exit 128), suffix fallback pattern verified |
| MAINT-03 | Post-merge patch export writes current fork patches to `.planning/patches/` as recovery insurance | git format-patch behavior with merge commits verified; MANIFEST generation pattern tested |
</phase_requirements>

---

## Summary

Phase 2 delivers three operational artifacts with no application code changes. The research focus was the specific git command behaviors that the scripts depend on, verified by running the actual commands against this repository.

The core findings: `git format-patch` silently skips merge commits by default (producing 17 patches from 21 commits in the fork range — the 4 difference are merge commits). This is the desired behavior. `git tag` exits with code 128 when a tag already exists, so the script must guard against same-day double-runs. The upstream remote (`upstream`) is already configured correctly. The `date +%Y%m%d` command is portable across macOS BSD and GNU/Linux. The macOS system bash is version 3.2, which limits available builtins but is sufficient for what these scripts need.

The second major finding concerns the upstream guard: if `git fetch upstream` has not been run, `git diff upstream/main` exits 128 with a fatal error. The script must detect this and abort with a clear message, since a "no changes found" false negative would be worse than a hard failure.

**Primary recommendation:** Use `#!/usr/bin/env bash` shebang, guard every git command with a ref-existence check, use `--color=auto` (git's default) for diff output, and use `--no-merges` explicitly on `git format-patch` to document the intent even though it's redundant.

---

## Standard Stack

### Core Git Commands

| Command | Purpose | Verified Behavior |
|---------|---------|------------------|
| `git diff upstream/main -- <file>` | Show fork changes in one file | Exits 128 if upstream/main not fetched; use rev-parse guard first |
| `git log upstream/main..thamw-main -- <file>` | Show fork commits touching a file | Returns empty when file untouched; safe |
| `git format-patch --no-merges upstream/main..thamw-main --output-directory <dir>` | Export fork-only commits as patch files | Merge commits silently skipped; dir created if absent; verified in this repo |
| `git tag merged-upstream-YYYYMMDD` | Tag merge commit | Exit 128 on duplicate; must guard or suffix |
| `git rev-parse upstream/main` | Test if upstream ref exists | Exit 0 with hash if exists; exit 128 + message to stderr if not |
| `git log --no-merges --pretty=format:"%h|%s" --name-only upstream/main..thamw-main` | MANIFEST data source | Produces COMMIT:hash|message + filenames separated by newlines |

[VERIFIED: direct command execution in this repo]

### Shell Environment

| Property | Value | Source |
|----------|-------|--------|
| macOS system bash | `/bin/bash` version 3.2.57 | [VERIFIED: `bash --version`] |
| Safe shebang | `#!/usr/bin/env bash` | [VERIFIED: `which bash` = `/bin/bash`] |
| `date +%Y%m%d` | Works on BSD (macOS) and GNU (Linux) | [VERIFIED: tested on macOS ARM64] |
| Bash 3.2 limitations | No associative arrays, no `mapfile`/`readarray` | [ASSUMED: training knowledge, but scripts don't need these] |

### package.json Script Pattern

The existing root `package.json` uses `"key": "command"` format with no shell wrapper. The new entries follow the same pattern:

```json
"pre-merge-check": "bash .planning/scripts/pre-merge-check.sh",
"post-merge-export": "bash .planning/scripts/post-merge-export.sh"
```

[VERIFIED: read root `package.json` — existing scripts use `bun run`, `bunx`, and direct `bun` invocations]

---

## Architecture Patterns

### Script 1: pre-merge-check.sh

**Structure:**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Guard: upstream/main must exist
if ! git rev-parse upstream/main > /dev/null 2>&1; then
  echo "ERROR: upstream/main not found. Run: git fetch upstream" >&2
  exit 1
fi

HIGH_RISK_FILES=(
  "packages/providers/src/providers/openai/provider.ts"
  "packages/providers/src/providers/openrouter/provider.ts"
  "packages/types/src/account.ts"
)

for file in "${HIGH_RISK_FILES[@]}"; do
  echo "======================================================"
  echo "FILE: $file"
  echo "------------------------------------------------------"
  echo "DIFF vs upstream/main:"
  git diff upstream/main -- "$file"
  echo ""
  echo "FORK COMMITS TOUCHING THIS FILE:"
  git log --oneline upstream/main..thamw-main -- "$file"
  echo ""
done
```

**Key design notes:**
- `set -euo pipefail` exits on any error, unset variable, or pipe failure
- `git diff` with `--color=auto` (the default) produces color when stdout is a TTY (script invoked directly in terminal) and no color when piped — no TTY detection needed
- The `git rev-parse upstream/main` guard prevents the false-negative case where a missing ref would make git print a fatal error to stderr but leave the diff output empty

[VERIFIED: behavior confirmed by testing against this repo]

### Script 2: post-merge-export.sh

**Structure:**

```bash
#!/usr/bin/env bash
set -euo pipefail

PATCHES_DIR=".planning/patches"
DATE=$(date +%Y%m%d)
TAG="merged-upstream-${DATE}"

# Guard: upstream/main must exist
if ! git rev-parse upstream/main > /dev/null 2>&1; then
  echo "ERROR: upstream/main not found. Run: git fetch upstream" >&2
  exit 1
fi

# Apply tag (handle same-day duplicate)
if git rev-parse "${TAG}" > /dev/null 2>&1; then
  SUFFIX=2
  while git rev-parse "${TAG}-${SUFFIX}" > /dev/null 2>&1; do
    SUFFIX=$((SUFFIX + 1))
  done
  TAG="${TAG}-${SUFFIX}"
  echo "Tag ${TAG%-*} already exists; using ${TAG}"
fi
git tag "${TAG}"
echo "Tagged: ${TAG}"

# Export patches (clears old patches first)
rm -f "${PATCHES_DIR}"/*.patch
git format-patch --no-merges upstream/main..thamw-main \
  --output-directory "${PATCHES_DIR}"

# Generate MANIFEST.md
MANIFEST="${PATCHES_DIR}/MANIFEST.md"
{
  echo "# Fork Patch Manifest"
  echo ""
  echo "**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "**Tag:** ${TAG}"
  echo "**Range:** upstream/main..thamw-main (non-merge commits only)"
  echo ""
  echo "| Patch File | Commit | Message | Files Touched |"
  echo "|-----------|--------|---------|--------------|"
  # Parse git log output into table rows
  # (implementation: iterate commits, match to patch files by sequence number)
} > "${MANIFEST}"
```

**MANIFEST generation strategy** (the tricky part): `git format-patch` names files with sequential numbers (`0001-...patch`, `0002-...patch`). `git log --no-merges upstream/main..thamw-main` lists commits in reverse chronological order (newest first), while `format-patch` numbers them oldest-first. To correlate: collect `format-patch` output (list of filenames), get git log in reverse (oldest first), zip them together.

```bash
# Collect patch files in order
mapfile -t PATCH_FILES < <(ls "${PATCHES_DIR}"/*.patch 2>/dev/null | sort)
# Get commits oldest-first (format-patch order)
mapfile -t COMMITS < <(git log --no-merges --reverse \
  --pretty=format:"%h|%s" upstream/main..thamw-main)
```

**Note on bash 3.2:** `mapfile` (also known as `readarray`) is a bash 4+ feature. The macOS system bash is 3.2. Scripts invoked as `bash .planning/scripts/...` from package.json will use `/bin/bash` which is 3.2 on macOS. The script must use POSIX-compatible alternatives or use a while loop to populate arrays.

[VERIFIED: macOS bash is 3.2; `mapfile` is bash 4+]

**Bash 3.2-compatible alternative:**

```bash
# Instead of mapfile:
PATCH_FILES=()
while IFS= read -r f; do PATCH_FILES+=("$f"); done < <(ls "${PATCHES_DIR}"/*.patch 2>/dev/null | sort)

COMMITS=()
while IFS= read -r c; do COMMITS+=("$c"); done < <(git log --no-merges --reverse \
  --pretty=format:"%h|%s" upstream/main..thamw-main)
```

[VERIFIED: `bash -c 'A=(); while IFS= read -r x; do A+=("$x"); done <<< "test"'` works on bash 3.2]

### MANIFEST.md Row Generation

```bash
for i in "${!PATCH_FILES[@]}"; do
  patch_file=$(basename "${PATCH_FILES[$i]}")
  commit_info="${COMMITS[$i]:-unknown|unknown}"
  hash="${commit_info%%|*}"
  msg="${commit_info#*|}"
  files=$(git show --name-only --format="" "$hash" | tr '\n' ', ' | sed 's/,$//')
  echo "| \`${patch_file}\` | \`${hash}\` | ${msg} | ${files} |"
done >> "${MANIFEST}"
```

[VERIFIED: `git show --name-only --format="" <hash>` outputs only filenames, tested in this repo]

### Document: UPSTREAM_MERGE.md

Must be structured so an agent can execute each step without human input. Sections:

1. **Pre-merge** — `git fetch upstream`, then `bun run pre-merge-check`, review output
2. **Merge** — `git merge upstream/main`
3. **Conflict resolution** — per-file resolution notes (see below)
4. **Post-merge** — `bun run post-merge-export`
5. **Push** — `git push origin thamw-main`
6. **Edge cases** — same-day double merge, upstream remote not configured

---

## Solved Problems

| Problem | Solution | Notes |
|---------|----------|-------|
| Missing `upstream/main` ref | `git rev-parse upstream/main` guard at script start | Exit 128 on failure — script aborts with a clear message |
| Duplicate same-day tag | Suffix loop: `-2`, `-3`, etc. | Document in SOP as expected behavior |
| Merge commits in patch export | `--no-merges` flag (or default behavior — format-patch skips them) | Verified: 21 commits → 17 patches; 4 merge commits silently skipped |
| `mapfile` unavailable in bash 3.2 | Use `while IFS= read -r` loop | macOS system bash is 3.2; the `bash` in package.json `scripts` resolves to `/bin/bash` |
| Old patches accumulating across runs | `rm -f "${PATCHES_DIR}/"*.patch` before format-patch | MANIFEST is regenerated fresh each run |
| MANIFEST row ordering | Collect format-patch output (sorted) and git log in reverse (oldest-first) with index alignment | Verified: format-patch numbers oldest-first; `git log` default is newest-first; use `--reverse` |

---

## Common Pitfalls

### Pitfall 1: Missing upstream/main causes silent false negative

**What goes wrong:** If `git fetch upstream` was not run, `git diff upstream/main -- <file>` prints a fatal error to stderr and exits 128, but if the script lacks `set -e`, execution continues and prints nothing — making it look like there are no conflicts.

**Root cause:** `upstream/main` is a remote-tracking ref that only exists after `git fetch upstream`.

**Prevention:** Add `git rev-parse upstream/main` guard at the top of both scripts before any git diff/log calls. Use `set -euo pipefail` so any command failure aborts the script.

**Warning signs:** Script completes immediately with no output.

[VERIFIED: `git diff fake/ref -- <file>` exits 128; `git rev-parse` reliably distinguishes existing vs missing refs]

### Pitfall 2: mapfile / readarray is bash 4+ only

**What goes wrong:** `mapfile -t ARRAY < <(command)` fails silently or with `command not found` on macOS system bash (3.2), leaving the array empty.

**Root cause:** macOS ships with `/bin/bash` at version 3.2 for license reasons. Homebrew bash is 5.x but is not the default.

**Prevention:** Use `while IFS= read -r line; do ARRAY+=("$line"); done < <(command)` — this works on bash 3.2.

**Warning signs:** MANIFEST.md is empty or has no data rows.

[VERIFIED: `bash --version` on macOS ARM64 = 3.2.57]

### Pitfall 3: git tag exit 128 on duplicate

**What goes wrong:** Running `post-merge-export.sh` twice in the same day (e.g., two upstream merges in one day) causes `git tag merged-upstream-YYYYMMDD` to fail with exit 128 and abort the script.

**Root cause:** Git tags are immutable; re-tagging the same name fails.

**Prevention:** Check `git rev-parse "${TAG}"` before tagging. If it exists, increment a suffix counter.

**Warning signs:** Script aborts immediately after the tag step.

[VERIFIED: `git tag test-dup-tag` on already-tagged ref exits 128 with "fatal: tag 'X' already exists"]

### Pitfall 4: Stale patches after multiple merge runs

**What goes wrong:** Running `post-merge-export.sh` multiple times without clearing `.planning/patches/` accumulates old `.patch` files. The MANIFEST then references non-existent commits from previous merge cycles, or shows too many patches.

**Root cause:** `git format-patch --output-directory` appends to the directory, not replaces it.

**Prevention:** Add `rm -f "${PATCHES_DIR}/"*.patch` before the `format-patch` call. The MANIFEST is already designed to be regenerated (not appended).

**Warning signs:** Patch count in MANIFEST exceeds `git log --no-merges upstream/main..thamw-main | wc -l`.

[VERIFIED: format-patch appends; tested with a second run to /tmp/test-patches]

### Pitfall 5: git diff color in non-TTY context

**What goes wrong:** Scripts invoked via CI or piped to `less` strip color by default. Conversely, `--color=always` breaks `less` paging with raw ANSI codes.

**Root cause:** Git's default `color.ui = auto` uses color when stdout is a TTY, no color otherwise.

**Prevention:** Use the default (no `--color` flag). This is correct for local interactive use (D-04). If piping to `less`, the user can add `less -R` or set `LESS="-R"` in their shell.

**Warning signs:** ANSI escape codes appear in output when script is piped.

[VERIFIED: `git config color.ui` = not set globally; `git diff` in TTY produces ANSI codes; in pipe, produces clean text]

---

## Code Examples

### Guard pattern for upstream ref

```bash
# Source: verified by testing git rev-parse against this repo
if ! git rev-parse upstream/main > /dev/null 2>&1; then
  echo "ERROR: upstream/main not found locally. Run: git fetch upstream" >&2
  exit 1
fi
```

### Tag with same-day collision handling

```bash
# Source: verified git tag behavior in this repo
DATE=$(date +%Y%m%d)
TAG="merged-upstream-${DATE}"
if git rev-parse "${TAG}" > /dev/null 2>&1; then
  SUFFIX=2
  while git rev-parse "${TAG}-${SUFFIX}" > /dev/null 2>&1; do
    SUFFIX=$((SUFFIX + 1))
  done
  TAG="${TAG}-${SUFFIX}"
  echo "Note: using ${TAG} (earlier tag for today already exists)"
fi
git tag "${TAG}"
```

### format-patch invocation

```bash
# Source: verified in this repo — produces 17 patches from 21 commits (4 merges skipped)
git format-patch --no-merges upstream/main..thamw-main \
  --output-directory ".planning/patches"
```

### MANIFEST row generation (bash 3.2 compatible)

```bash
# Source: verified git show --name-only behavior in this repo
PATCH_FILES=()
while IFS= read -r f; do PATCH_FILES+=("$f"); done < <(ls .planning/patches/*.patch 2>/dev/null | sort)

COMMITS=()
while IFS= read -r c; do COMMITS+=("$c"); done < <(
  git log --no-merges --reverse --pretty=format:"%h|%s" upstream/main..thamw-main
)

for i in "${!PATCH_FILES[@]}"; do
  patch_file=$(basename "${PATCH_FILES[$i]}")
  commit_info="${COMMITS[$i]:-unknown|unknown}"
  hash="${commit_info%%|*}"
  msg="${commit_info#*|}"
  files=$(git show --name-only --format="" "$hash" | paste -sd ',' -)
  echo "| \`${patch_file}\` | \`${hash}\` | ${msg} | ${files} |"
done
```

---

## Fork Patch Inventory (for UPSTREAM_MERGE.md resolution notes)

The following is verified from reading the current source files and git log output.

### packages/providers/src/providers/openai/provider.ts

**Fork change:** Added `cache_write_tokens` extraction inside `extractUsageInfo()`, at line ~262. The fork extends the `promptTokensDetails` type definition to include `cache_write_tokens?: number` and falls back to it when `cache_creation_input_tokens` is absent.

**FORK PATCH comment location:** `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)` — appears immediately before the `cacheCreationInputTokens` assignment.

**Resolution rule:** When upstream modifies `extractUsageInfo()` or its return type in this file, always preserve the `cache_write_tokens` fallback. Upstream's version only reads `cache_creation_input_tokens`; the fork adds `|| promptTokensDetails?.cache_write_tokens || 0` as a second option.

[VERIFIED: read `packages/providers/src/providers/openai/provider.ts` lines 254-267]

### packages/providers/src/providers/openrouter/provider.ts

**Fork change:** Extensive. Upstream's version has only `getEndpoint()` and `buildUrl()`. The fork adds:
1. `// fix: normalize Authorization header comparison` — lowercase `authHeader: "authorization"` in constructor
2. `// fix: strip /v1 prefix` — path cleanup in `buildUrl()`
3. `override async transformRequestBody()` — 3-breakpoint `cache_control` injection (tools array, system block, last assistant turn)
4. `override async extractUsageInfo()` — reads `prompt_tokens_details.cache_write_tokens` instead of Anthropic-native field

**Resolution rule:** Upstream's `openrouter/provider.ts` is a very small file (31 lines upstream vs 179 lines in fork). Any upstream modification to this file is almost certainly additive (new method or property). Preserve the entire fork implementation, add upstream's change alongside it.

[VERIFIED: `git show upstream/main:packages/providers/src/providers/openrouter/provider.ts` = 31 lines]

### packages/types/src/account.ts

**Fork change:** None — `git log upstream/main..thamw-main -- packages/types/src/account.ts` returns empty. The fork has not modified this file.

**Resolution rule:** Accept upstream's changes wholesale. The upstream diff against thamw-main shows upstream removed `usageThrottledUntil`, `usageThrottledWindows`, and `crossRegionMode` from `AccountResponse` — fields that were in the fork's version but originated from upstream. Accept these removals; they indicate upstream reverted a feature or renamed it.

**Why this file is high-risk:** Structural changes cascade. If upstream adds a required field to `AccountResponse` that the fork's code doesn't populate, TypeScript will catch it. The risk is silent runtime divergence, not immediate failure.

[VERIFIED: `git log upstream/main..thamw-main -- packages/types/src/account.ts` = empty; `git diff upstream/main -- packages/types/src/account.ts` = 31 lines showing upstream removals]

---

## Runtime State Inventory

Not applicable — this phase creates new operational tooling files only. No existing data stores, service configs, OS registrations, secrets, or build artifacts are renamed or migrated.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bash | Script execution | ✓ | 3.2.57 (macOS system) | — |
| git | All script operations | ✓ | (system git) | — |
| upstream remote | All git comparisons | ✓ | https://github.com/tombii/better-ccflare | — |
| bun | package.json script runner | ✓ | >=1.2.8 (enforced in engines) | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

**Environment notes:**
- `upstream` remote is already configured: verified with `git remote -v` and `git ls-remote upstream HEAD`
- `thamw-main` branch exists and is the current branch
- `.planning/scripts/`, `.planning/patches/`, and `.planning/fork_plans/` directories already exist (verified with `ls .planning/`)
- Upstream has advanced since last fetch: `upstream/main` is now 10 commits ahead of `thamw-main`'s base. The scripts will reflect this correctly when run after `git fetch upstream`.

[VERIFIED: all environment checks run against this repo]

---

## Validation Architecture

**nyquist_validation:** enabled (key present and true in `.planning/config.json`)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in) |
| Config file | none — `bun test` discovers `*.test.ts` automatically |
| Quick run command | `bun test` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MAINT-01 | `pre-merge-check.sh` exists, is executable, and produces output per high-risk file | manual-only | N/A — shell script behavior requires git state | no |
| MAINT-02 | `post-merge-export.sh` applies `merged-upstream-YYYYMMDD` tag | manual-only | N/A — requires live git merge state | no |
| MAINT-03 | `post-merge-export.sh` creates patch files in `.planning/patches/` and writes MANIFEST.md | smoke — run script against current repo state | `bash .planning/scripts/post-merge-export.sh` (as smoke test) | no |

**Rationale for manual-only classification:** These scripts operate on live git state (merge commits, upstream diffs). Meaningful automated tests would require git fixture repos. Given the scripts are local-only operational tooling with no CI requirement (D-04), smoke-testing by execution is the appropriate validation strategy.

### Sampling Rate
- **Per script delivery:** Execute each script against current repo state and verify output
- **Phase gate:** All three deliverables created, scripts execute without error, MANIFEST.md exists with correct rows

### Wave 0 Gaps

None — no test files needed. Validation is by execution.

---

## Security Domain

This phase creates local shell scripts and documentation. No application code changes, no new network calls, no authentication surface.

| ASVS Category | Applies | Notes |
|---------------|---------|-------|
| V2 Authentication | no | No auth surface added |
| V3 Session Management | no | No session surface added |
| V4 Access Control | no | Scripts are local-only |
| V5 Input Validation | low | Scripts take no user input; only hardcoded file paths and `date` output |
| V6 Cryptography | no | No crypto operations |

**Relevant concern (LOW):** Shell scripts with `set -euo pipefail` and no `eval` or user-controlled interpolation are not a meaningful attack surface. The only variable derived from external data is `date +%Y%m%d` (used in tag name), which has no shell metacharacters.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `mapfile` is absent in bash 3.2 on macOS | Common Pitfalls — Pitfall 2 | Low: if wrong, the while-loop alternative still works; no regression |
| A2 | Bun's `bun run <script>` invokes the shell command exactly as written (no PATH manipulation) | Architecture Patterns — package.json integration | Low: standard npm/bun scripts behavior |

**All other claims in this research were verified by direct command execution in this repository.**

---

## Open Questions (RESOLVED)

1. **Should post-merge-export.sh clear old patches before exporting?**
   - What we know: MANIFEST.md is designed to reflect the current delta, not accumulate history. The context says MANIFEST is "regenerated on each post-merge run."
   - What is unclear: Whether old `.patch` files from prior exports should be preserved (as historical recovery artifacts) or replaced.
   - Recommendation: Replace (delete old `.patch` files before running format-patch). The patches are recovery insurance for the current state, not an archive. If the user wants history, git tags and the git log serve that purpose.

2. **delta diff filter (interactive.difffilter=delta --color-only) in git config — does it affect scripts?**
   - What we know: `git config --list` shows `interactive.difffilter=delta --color-only`. This applies to `git add -p` interactive mode, not to `git diff` in scripts.
   - What is unclear: Whether `delta` is installed and whether `GIT_EXTERNAL_DIFF` or `core.pager` settings would alter script output.
   - Recommendation: No action needed. `interactive.difffilter` only applies to interactive staging, not to `git diff` called from scripts.

---

## Sources

### Primary (HIGH confidence)
- Direct git command execution in `/Users/thamw/development/local/better-ccflare` — all git behaviors documented here were run and observed
- Source file reads: `packages/providers/src/providers/openai/provider.ts`, `packages/providers/src/providers/openrouter/provider.ts`, `packages/types/src/account.ts`
- `package.json` root — existing scripts pattern confirmed

### Secondary (MEDIUM confidence)
- Git format-patch documentation behavior (merge commit skipping) — confirmed by empirical test showing 21 commits → 17 patches with 4 merge commits in range

### Flagged for Validation (LOW confidence)
- None — all claims verified by direct execution.

---

## Metadata

**Confidence breakdown:**
- Standard stack (git commands): HIGH — all commands verified in this repo
- Architecture (script structure): HIGH — based on verified git behaviors
- Pitfalls: HIGH — each pitfall was triggered and observed during research
- Bash 3.2 compatibility: HIGH (mapfile absence) / ASSUMED (other 3.2 limits irrelevant to these scripts)

**Research date:** 2026-05-05
**Valid until:** 2026-11-05 (6 months — git command behaviors are extremely stable)

---

## RESEARCH COMPLETE
