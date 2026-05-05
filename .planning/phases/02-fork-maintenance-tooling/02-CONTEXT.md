# Phase 2: Fork Maintenance Tooling - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver three operational artifacts that make upstream syncs safe and repeatable: a pre-merge check shell script, a post-merge tagging + patch export shell script, and an agent-facing merge SOP document. No application code changes — this is purely operational tooling in `.planning/scripts/`, `.planning/patches/`, and `.planning/fork_plans/`.

</domain>

<decisions>
## Implementation Decisions

### MAINT-01: Pre-merge check script

- **D-01:** Use a **hardcoded file list** for high-risk files. No dynamic `// FORK PATCH:` scanning. The list (from STATE.md) is:
  - `packages/providers/src/providers/openai/provider.ts`
  - `packages/providers/src/providers/openrouter/provider.ts`
  - `packages/types/src/account.ts`
- **D-02:** Compare against **`upstream/main`** (not local `main`). Requires `git fetch upstream` to have been run before the script — the script does NOT run the fetch itself. The SOP document (UPSTREAM_MERGE.md) will call out `git fetch upstream` as step 1.
- **D-03:** Output format: for each high-risk file, print both:
  1. `git diff upstream/main -- <file>` (what's different)
  2. `git log upstream/main..thamw-main -- <file>` (which fork commits touched it)
  Human-readable, colored if terminal supports it. No exit-code semantics needed.
- **D-04:** Script is **local-only** — no CI-safe exit codes, no structured output, no non-interactive constraint.

### MAINT-02: Merge tagging

- **D-05:** Tagging (`git tag merged-upstream-YYYYMMDD`) is handled by `post-merge-export.sh`, not manually. The post-merge script applies the tag before exporting patches. Tag and patch export are atomic from the operator's perspective.

### MAINT-03: Post-merge patch export

- **D-06:** "Fork-only" commits = commits in `thamw-main` not in `upstream/main` (`git log upstream/main..thamw-main`).
- **D-07:** Export format: **`git format-patch` series** — one `.patch` file per commit, output to `.planning/patches/`. Directly replayable with `git am`.
- **D-08:** Include a **MANIFEST.md** in `.planning/patches/` alongside the patch files — simple index listing: patch filename, commit hash, commit message, files touched. Written by the post-merge script.
- **D-09:** `post-merge-export.sh` does: (1) apply `git tag merged-upstream-YYYYMMDD`, (2) run `git format-patch`, (3) write MANIFEST.md. All in one invocation.

### Script integration

- **D-10:** Two **separate scripts** in `.planning/scripts/`:
  - `pre-merge-check.sh` — run before the merge
  - `post-merge-export.sh` — run after the merge is complete
- **D-11:** Add both scripts as **package.json convenience aliases**:
  - `"pre-merge-check": "bash .planning/scripts/pre-merge-check.sh"`
  - `"post-merge-export": "bash .planning/scripts/post-merge-export.sh"`
  These go in the root `package.json` `scripts` section so they're discoverable via `bun run`.

### Agent merge doc (MAINT-bonus)

- **D-12:** Create `.planning/fork_plans/UPSTREAM_MERGE.md` as an **agent-facing step-by-step merge SOP**. Structure:
  1. Fetch upstream
  2. Run pre-merge-check.sh and review output
  3. Do the merge (`git merge upstream/main`)
  4. Resolve conflicts (with per-file resolution notes — see below)
  5. Run post-merge-export.sh (tags + exports patches)
  6. Push
- **D-13:** Include **per-file conflict resolution notes** for each high-risk file, documenting:
  - What the fork patch does in that file
  - The resolution rule (e.g., "always preserve the `cache_write_tokens` extraction from `prompt_tokens_details`")
  This gives an agent enough context to resolve conflicts without human input.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §v1 — MAINT-01, MAINT-02, MAINT-03 definitions with acceptance criteria
- `.planning/ROADMAP.md` §Phase 2 — Success criteria (3 items)

### Phase 1 context (fork patches already in place)
- `.planning/phases/01-correctness-patch-hardening/01-CONTEXT.md` — Documents the three fork patches that `pre-merge-check.sh` and `UPSTREAM_MERGE.md` must be aware of (cache_write_tokens extraction, cache_control injection, Biome formatter on tests)

### High-risk source files (patch targets)
- `packages/providers/src/providers/openai/provider.ts` — Contains `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)` — highest conflict risk
- `packages/providers/src/providers/openrouter/provider.ts` — OpenRouter-specific overrides (cache_control injection)
- `packages/types/src/account.ts` — Shared type file; structural changes here cause cascade conflicts

### Output locations (to be created)
- `.planning/scripts/pre-merge-check.sh` — MAINT-01 deliverable
- `.planning/scripts/post-merge-export.sh` — MAINT-02 + MAINT-03 deliverable
- `.planning/patches/` — patch export target directory (already created)
- `.planning/fork_plans/UPSTREAM_MERGE.md` — agent SOP (MAINT-bonus)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json` (root) `scripts` section — already contains `"start"`, `"build"`, `"test"`, `"lint"`, etc. New `pre-merge-check` and `post-merge-export` entries follow the same pattern.
- `.planning/STATE.md` §"High-risk files" — documents the canonical high-risk file list; the pre-merge script hardcodes exactly these paths.

### Established Patterns
- Fork patches are marked with `// FORK PATCH: <description>` inline comments (established by PATCH-01 in Phase 1). The UPSTREAM_MERGE.md resolution notes reference these comments so an agent knows where the fork-specific logic is.
- Git remote setup: `origin` = thamw's fork, `upstream` = tombii/better-ccflare. Scripts assume this remote topology.
- Branch: `thamw-main` is the working branch. Scripts assume they're run from this branch.

### Integration Points
- Root `package.json` `scripts` — add two new entries for the shell scripts
- `.planning/patches/` — created as empty directory; post-merge script writes here
- `.planning/fork_plans/` — created as empty directory; UPSTREAM_MERGE.md lives here

</code_context>

<specifics>
## Specific Ideas

- The merge SOP should be structured so an agent can follow it step-by-step without human input, including for conflict resolution. Per-file resolution notes should be specific enough that an agent reading the note + the FORK PATCH comment in the file has everything it needs.
- MANIFEST.md in `.planning/patches/` should be regenerated on each post-merge run (not appended). Each run reflects the current fork delta, not a historical log.
- The tag format `merged-upstream-YYYYMMDD` is fixed per MAINT-02. If a merge happens twice in one day (unlikely), append a suffix (e.g., `-2`). Document this edge case in the SOP.

</specifics>

<deferred>
## Deferred Ideas

- **CI-safe exit codes** — Scripts are local-only now. If CI integration is added in the future, add `exit 1` on conflict detection to `pre-merge-check.sh`. Deferred — no CI wiring needed now.
- **Dynamic FORK PATCH detection** — Using `grep -r '// FORK PATCH:'` to build the file list dynamically. Deferred — hardcoded is simpler and the list is small and stable.
- **Makefile** — Alternative convenience interface considered; rejected in favor of package.json scripts to stay within the existing Bun toolchain.

</deferred>

---

*Phase: 2-Fork Maintenance Tooling*
*Context gathered: 2026-05-05*
