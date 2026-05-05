# Upstream Merge SOP

## Overview

This document is the step-by-step operational procedure for merging upstream `tombii/better-ccflare` releases into this personal fork (`thamw-main`). Use it whenever upstream has new commits to integrate. The branch topology is: `origin` = thamw's fork on GitHub, `upstream` = `tombii/better-ccflare` (the source project), `thamw-main` = the personal working branch that carries fork patches on top of upstream. Follow each step in order. An agent can execute this SOP without human input, including conflict resolution, using the per-file resolution notes in Step 4.

---

## Step 1: Fetch upstream

Bring the remote-tracking ref `upstream/main` up to date:

```bash
git fetch upstream
```

This step is required before running any scripts. Both `pre-merge-check.sh` and `post-merge-export.sh` guard for `upstream/main` and will abort with an error if it is missing.

---

## Step 2: Pre-merge inspection

Run the pre-merge check to see what upstream changed in the high-risk files:

```bash
bun run pre-merge-check
```

For each of the 3 high-risk files, the script prints:
1. **DIFF vs upstream/main** — shows what the fork currently has that upstream does not, and what upstream has that the fork does not.
2. **FORK COMMITS TOUCHING THIS FILE** — lists which fork-specific commits modified this file.

What to look for:
- A **non-empty diff** for `openrouter/provider.ts` or `openai/provider.ts` indicates potential merge conflicts. Review the diff against the resolution rules in Step 4 before merging.
- An **empty diff** for `account.ts` is normal — the fork has not modified this file. Any upstream changes will apply cleanly.
- An **empty FORK COMMITS log** for `account.ts` confirms there are no fork-specific commits to preserve in that file.

---

## Step 3: Merge

Run the merge:

```bash
git merge upstream/main
```

- If **no conflicts**: git completes the merge automatically. Proceed to Step 5.
- If **conflicts are reported**: do NOT abort. Proceed to Step 4 to resolve each conflict file.

---

## Step 4: Conflict resolution

Resolve each conflicted file using the per-file resolution notes below. After resolving all files:

```bash
git add packages/providers/src/providers/openai/provider.ts
git add packages/providers/src/providers/openrouter/provider.ts
git add packages/types/src/account.ts
git merge --continue
```

### packages/providers/src/providers/openai/provider.ts

**What the fork patch does:** `extractUsageInfo()` was extended to read `cache_write_tokens` from `prompt_tokens_details` as a fallback when `cache_creation_input_tokens` is absent. The fork adds `|| promptTokensDetails?.cache_write_tokens || 0` to the `cacheCreationInputTokens` assignment line.

**FORK PATCH comment to look for:**
```
// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)
```

**Resolution rule:** When upstream modifies `extractUsageInfo()` or its return type, always preserve the `|| promptTokensDetails?.cache_write_tokens || 0` fallback. Take upstream's version of the function and re-insert the `cache_write_tokens` fallback on the `cacheCreationInputTokens` assignment. The final declaration should look like:

```typescript
// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)
const cacheCreationInputTokens =
    promptTokensDetails?.cache_creation_input_tokens ||
    promptTokensDetails?.cache_write_tokens ||
    0;
```

Preserve the `// FORK PATCH` comment immediately before this declaration.

### packages/providers/src/providers/openrouter/provider.ts

**What the fork patch does:** Upstream's file is 31 lines with only `getEndpoint()` and `buildUrl()`. The fork adds four substantial changes:
1. `authHeader: "authorization"` (lowercase) in constructor — normalizes Authorization header comparison.
2. `/v1` prefix strip in `buildUrl()` — removes the `/v1` prefix that OpenRouter does not expect from the base URL path.
3. `override async transformRequestBody()` — injects `cache_control: { type: "ephemeral" }` at 3 breakpoints: the tools array entry (last tool), the system block, and the last assistant turn.
4. `override async extractUsageInfo()` — reads `prompt_tokens_details.cache_write_tokens` for cache token accounting.

**FORK PATCH comment to look for:**
```
// FORK PATCH: 3-breakpoint cache_control injection (tools, system, last assistant turn)
// FORK PATCH: extractUsageInfo reads OpenRouter prompt_tokens_details format (CACHE-01)
```

**Resolution rule:** Upstream's changes to this file are almost certainly additive (a new method or property on the OpenRouter provider class). Preserve the entire fork implementation. Add upstream's new method or property alongside the fork's additions. Do NOT overwrite the fork's version with upstream's 31-line version.

### packages/types/src/account.ts

**What the fork patch does:** Nothing — the fork has not modified this file. `git log upstream/main..thamw-main -- packages/types/src/account.ts` returns empty.

**Resolution rule:** Accept upstream's changes wholesale:

```bash
git checkout upstream/main -- packages/types/src/account.ts
```

Then run:

```bash
bun run typecheck
```

To catch any TypeScript errors caused by structural changes to `AccountResponse` (e.g., added or removed required fields). Fix any type errors before completing the merge.

---

## Step 5: Post-merge export

After the merge is complete (no conflicts, or all conflicts resolved and `git merge --continue` done):

```bash
bun run post-merge-export
```

This script does three things atomically:
1. Tags HEAD as `merged-upstream-YYYYMMDD` (today's date).
2. Clears `.planning/patches/` of old `.patch` files and exports the current fork delta as a new patch series.
3. Writes `.planning/patches/MANIFEST.md` — a table of patch files, commit hashes, messages, and files touched.

The tag and patch export serve as recovery insurance: if a future merge goes wrong, the tag marks the last known-good state and the patches let you replay the fork's changes from scratch.

---

## Step 6: Push

Push the merged branch to origin:

```bash
git push origin thamw-main
```

---

## Edge Cases

### Same-day double merge

If two upstream merges happen on the same calendar day, `post-merge-export.sh` automatically detects the existing `merged-upstream-YYYYMMDD` tag and uses a suffix: `merged-upstream-YYYYMMDD-2`, `-3`, etc. No action needed — the script handles this.

### Upstream remote not configured

If `git fetch upstream` fails with "fatal: 'upstream' does not appear to be a git repository":

```bash
git remote add upstream https://github.com/tombii/better-ccflare
```

Then re-run from Step 1.
