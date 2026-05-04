# Fork Maintenance Patterns

**Project:** better-ccflare (personal fork of tombii/better-ccflare)
**Researched:** 2026-05-04
**Confidence:** HIGH — multiple authoritative sources cross-verified

---

## Merge vs Rebase vs Cherry-pick

### How each works against an active upstream

**Merge** (`git merge upstream/main`) creates a merge commit that records the integration point. Your custom commits remain at their original positions in history, interleaved with upstream commits chronologically. The commit graph becomes a DAG with explicit merge nodes.

**Rebase** (`git rebase upstream/main`) replays your commits on top of the new upstream tip. History is linear. Commit SHAs are rewritten, which means everyone who has pulled your branch needs to `git pull --force` after every upstream sync.

**Cherry-pick** selectively applies individual upstream commits to your branch. Used as a targeted tool rather than a full sync strategy — pick a specific fix without taking the whole upstream state.

### When each breaks down

| Strategy | Breaks down when... |
|---|---|
| Merge | You merge repeatedly without cleaning up — history becomes unreadable; `git log` shows interleaved upstream and downstream commits, making "what did I actually change?" impossible to answer at a glance |
| Rebase | You have collaborators (or CI) consuming your fork branch — every rebase requires force-push; anyone who pulled your branch is now diverged. Also breaks down when upstream makes wide refactors that touch every file your patches touch |
| Cherry-pick | The patch set is large — cherry-picking 20 upstream commits is error-prone; you can miss commits or pick them out of order and introduce subtle bugs |

### Recommendation: merging rebase ("ours" merge + rebase --onto)

Use the strategy employed by git-for-windows/git and microsoft/git: a **merging rebase**. The technique:

1. Fetch upstream.
2. Create a merge commit using `-s ours` (records the integration point without changing your tree).
3. Rebase your patch commits `--onto` the new upstream tip using the previous merge base as the starting point.

This gives you linear history with patches cleanly on top, eliminates the need for force-push (consumers of your fork branch are not disrupted), and makes "what is my delta from upstream?" a trivial `git log upstream/main..thamw-main --no-merges` query.

Standard merge is the right fallback when: you are not the only developer working on `thamw-main`, or when an upstream release is so large that rebase conflicts would be too numerous — merge one large release, then resume rebase discipline.

**Evidence:** GitHub Engineering blog (2022), amboar.github.io history-preserving fork maintenance article (2021), confirmed by independent Atlassian Git Tutorial documentation.

---

## Patch Management Strategies

### The problem

You have recurring patches (e.g. `cache_control` injection, `cache_write_tokens` extraction) that must survive every upstream merge. The risk is that after an upstream merge you apply a patch that has already been superseded upstream, or you silently lose a patch because a conflict was resolved the wrong way.

### What not to use

**quilt** — effective for Linux kernel-style package patching, but it operates outside of git and does not leverage git's merge machinery. When upstream changes the same lines your patch touches, you resolve the conflict manually in a `.patch` text file rather than in your editor with conflict markers. Not recommended for a TypeScript monorepo where you already have git fluency.

**TopGit** — maintains each patch as a pair of git branches (patch branch + base branch) and uses `git merge` to propagate upstream into each patch. Powerful for large, interdependent patch stacks. Overkill for a 2-3 patch delta in a single subdirectory. TopGit also has a small, fragmented maintainer community as of 2025.

### What to use: disciplined commit organization + git format-patch as export

Since your patch surface is narrow (primarily `packages/providers/src/providers/openrouter/`), the most reliable approach is:

1. **Tag your patches explicitly.** Every commit that is a fork-local customization (not contributed upstream) gets a prefix or trailer: `[fork]` or `downstream:` in the commit message. This makes `git log --grep='downstream:' upstream/main..thamw-main` an instant inventory of what you carry.

2. **Keep patches atomic, one idea per commit.** `c82b945 fix: extract cache_write_tokens` and `8e5774e feat: inject cache_control ephemeral` are already good examples — each is a self-contained idea. Do not combine upstream-contributed fixes with downstream customizations in the same commit.

3. **Export patches as insurance.** After each upstream merge, run:
   ```bash
   git format-patch upstream/main..thamw-main --no-merges -o .planning/patches/
   ```
   This gives you a portable backup of every downstream commit as numbered `.patch` files. If a rebase goes wrong, you can `git am` them onto a clean upstream checkout. Store this directory in the repo.

4. **Do not use `git format-patch` as the primary workflow.** It does not roundtrip cleanly — each `format-patch` + `git am` cycle produces slightly different SHA context, so it is a recovery tool, not the daily driver.

**Evidence:** natkr.com (2025) on Lappverk/git format-patch; git-scm.com git-format-patch documentation; die-antwort.eu long-lived fork article (2016, still authoritative for git mechanics).

---

## Conflict Minimization

### The structural advantage you already have

Your primary patches are isolated to `packages/providers/src/providers/openrouter/provider.ts` — a file that is a **subclass** (`OpenRouterProvider extends AnthropicCompatibleProvider`). This is already the right structure: your customizations override methods in a subclass rather than editing the parent class or shared infrastructure. Upstream can change `AnthropicCompatibleProvider` without touching your file.

### Tactics that reduce conflict surface

**1. Never patch core files.** If a needed behavior is in a shared/core module, upstream the change or introduce an extension point (a method override, a hook, a configuration option) rather than editing the shared file directly. One line changed in `packages/proxy/src/handler.ts` will conflict on nearly every upstream release; one override in `OpenRouterProvider` almost never will.

**2. Minimize line-level overlap.** Patches that insert lines between existing lines are more fragile than patches that add methods to the bottom of a class or add new files. Adding `transformRequestBody` as an override on `OpenRouterProvider` is nearly zero-conflict — upstream does not touch a method that doesn't exist in the base class.

**3. Use extension registries, not in-place edits.** If upstream provides a plugin/registry pattern (e.g., a provider registry where you register `OpenRouterProvider`), use that rather than editing the registry initialization file. New registrations added at the bottom of a list survive upstream changes to the middle of that list.

**4. One feature per file when possible.** The current split of `index.ts` (exports) + `provider.ts` (implementation) in the openrouter directory is good practice. Keep downstream-only additions in their own files (e.g., a `transform-cache.ts`) rather than embedding them in files upstream also touches.

**5. Enable `rerere`.** Git's "reuse recorded resolution" feature remembers how you resolved a specific conflict hunk and automatically replays that resolution the next time the same conflict appears. For recurring patches that touch the same lines every merge cycle:
   ```bash
   git config --global rerere.enabled true
   ```
   This is a one-time setup that silently eliminates repetitive conflict resolution. Confidence: HIGH (git-scm.com official documentation).

**Evidence:** coderefinery.github.io avoiding conflicts guide; Atlassian merge conflicts documentation; git-scm.com rerere documentation; direct inspection of the codebase structure.

---

## Tracking Upstream Changes

### The problem

After a major upstream merge, you need to know: (a) what upstream changed, (b) whether any upstream change supersedes one of your patches, and (c) whether any upstream change conflicts with code your patches depend on.

### Commands

**What is different between last merge and now:**
```bash
git log LAST_MERGE_TAG..upstream/main --oneline --no-merges
```

**What files did upstream change (scoped to your patch surface):**
```bash
git diff LAST_MERGE_TAG upstream/main -- packages/providers/src/providers/openrouter/
```

**Symmetric difference — what upstream has that your branch doesn't, and vice versa:**
```bash
git log --cherry upstream/main...thamw-main --no-merges --left-right
```
The `...` (triple-dot) notation shows symmetric difference. `>` markers are your downstream commits; `<` markers are upstream commits not in your branch. This is the definitive view of divergence.

**Did upstream reimplement something you already patched:**
```bash
git log upstream/main --oneline -- packages/providers/src/providers/openrouter/
```
If you see new commits here, inspect them before merging — they may supersede your patches and allow you to drop a downstream commit.

### Changelog habits

**Tag your merge points.** Every time you merge upstream, create a lightweight tag:
```bash
git tag merged-upstream-$(date +%Y%m%d) upstream/main
```
This gives you permanent reference points for log range commands. You currently use commit message references like "Merge v3.4.27 into thamw-main" — that is good, but a tag is more reliable for programmatic use.

**Check the upstream CHANGELOG or release notes before merging.** Look specifically for changes to the provider system, `AnthropicCompatibleProvider`, or the OpenRouter entry. This takes 2 minutes and lets you anticipate conflicts before running `git merge`.

**Evidence:** die-antwort.eu (2016); GitHub Engineering blog (2022) `git range-diff` usage; git-scm.com triple-dot notation documentation; direct inspection of this repository's commit history.

---

## Recommended Workflow

This workflow is calibrated for better-ccflare specifically: a Bun/TypeScript monorepo, patches primarily in `packages/providers/src/providers/openrouter/`, upstream active with frequent releases, fork consumed by one person (no collaborators on `thamw-main`).

### One-time setup

```bash
# Enable rerere — resolves recurring conflicts automatically
git config --global rerere.enabled true

# Confirm remotes are correct
git remote -v
# Should show: origin (your fork), upstream (tombii/better-ccflare)
```

### Per-upstream-release workflow

**Step 1: Inventory your downstream patches before merging.**
```bash
git log upstream/main..thamw-main --oneline --no-merges --grep='downstream:\|feat:\|fix:' 
# Review: are any of these patches already addressed upstream?
```

**Step 2: Check what upstream changed in your patch surface.**
```bash
git fetch upstream
git diff HEAD upstream/main -- packages/providers/src/providers/openrouter/
# If this diff is empty, your rebase will be trivial.
```

**Step 3: Rebase your patches onto upstream.**
```bash
git rebase upstream/main
# If conflicts arise: resolve, git add, git rebase --continue
# rerere will replay any previously-seen resolutions automatically
```

**Step 4: If Step 3 produces too many conflicts (large upstream release), fall back to merge.**
```bash
git merge upstream/main
# Resolve conflicts, commit
# Include the upstream version in the merge commit message: "Merge v3.X.Y into thamw-main"
```

**Step 5: Tag the integration point.**
```bash
git tag merged-upstream-$(date +%Y%m%d)
```

**Step 6: Export patches as backup (run after any upstream integration).**
```bash
mkdir -p .planning/patches
git format-patch upstream/main..thamw-main --no-merges -o .planning/patches/
```

**Step 7: Push.**
```bash
# If you rebased (step 3): force-push is required since you are the sole consumer
git push origin thamw-main --force-with-lease

# If you merged (step 4): normal push
git push origin thamw-main
```

Use `--force-with-lease` rather than `--force`: it refuses the push if someone else has pushed to the branch since your last fetch, preventing accidental overwrite.

### Keeping patches survivable

When writing a new downstream patch:
- Put it in `OpenRouterProvider` as an `override` method wherever possible.
- If it must touch a shared file, add a comment: `// downstream: [brief reason]` to make it visible during conflict review.
- Commit it with a `downstream:` trailer so it shows up in the inventory command.
- Never mix upstream-contribution work with downstream-only work in the same commit.

### When to contribute upstream instead

If a patch has been in your fork for more than two upstream releases and has not caused conflicts, it is probably safe and correct. Consider opening a PR upstream. The GitHub blog "friendly fork management" article identifies this as the single most effective long-term maintenance strategy: every patch accepted upstream is a patch you no longer have to carry.

---

## Sources

- [Git Tricks for Maintaining a Long-Lived Fork - DIE ANTWORT](https://die-antwort.eu/techblog/2016-08-git-tricks-for-maintaining-a-long-lived-fork/) — MEDIUM confidence (older but git mechanics are stable)
- [History-Preserving Fork Maintenance with Git - amboar.github.io](https://amboar.github.io/notes/2021/09/16/history-preserving-fork-maintenance-with-git.html) — HIGH confidence (specific technical implementation, verified against git documentation)
- [Strategies for Friendly Fork Management - GitHub Blog](https://github.blog/2022-05-02-friend-zone-strategies-friendly-fork-management/) — HIGH confidence (official GitHub source, describes real production workflows)
- [How to Fork: Best Practices - Joaquim Rocha](https://joaquimrocha.com/how-to-fork) — MEDIUM confidence (practitioner perspective, aligns with other sources)
- [Modifying Other People's Software - natkr.com (2025)](https://natkr.com/2025-08-14-modifying-other-peoples-software/) — MEDIUM confidence (recent, git format-patch workflow details)
- [Avoiding Conflicts - CodeRefinery](https://coderefinery.github.io/git-branch-design/04-avoiding-conflicts/) — HIGH confidence (educational resource, verified against common practice)
- [Git Rerere Documentation - git-scm.com](https://git-scm.com/book/en/v2/Git-Tools-Rerere) — HIGH confidence (official git documentation)
- [Merging vs. Rebasing - Atlassian Git Tutorial](https://www.atlassian.com/git/tutorials/merging-vs-rebasing) — HIGH confidence (authoritative reference)
- [Best Practices for Keeping a Forked Repository Up to Date - GitHub Community](https://github.com/orgs/community/discussions/153608) — MEDIUM confidence (community discussion, consistent with other sources)
- [TopGit Overview - mackyle.github.io](https://mackyle.github.io/topgit/overview.html) — HIGH confidence (official documentation; evaluated and rejected as overkill for this use case)
