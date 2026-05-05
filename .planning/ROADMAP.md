# Roadmap: better-ccflare (Personal Fork)

**Created:** 2026-05-04
**Phases:** 2
**Requirements:** 7 mapped

## Phases

- [ ] **Phase 1: Correctness & Patch Hardening** - Fix silent billing failures and ensure fork patches survive upstream merges
- [ ] **Phase 2: Fork Maintenance Tooling** - Operational scripts and conventions that make upstream syncs safe and repeatable

## Phase Details

### Phase 1: Correctness & Patch Hardening

**Goal:** The proxy accurately reports OpenRouter cache token costs and all fork patches are identifiable and test-covered so they survive upstream merges without silent regression.
**Depends on:** Nothing (first phase)
**Requirements:** CACHE-01, CACHE-02, PATCH-01, PATCH-02

**Success Criteria** (what must be TRUE):
1. A non-streaming OpenRouter response shows non-zero cache write token counts in usage stats — the operator's billing display is no longer silently understated by 5x
2. Sending a request to a non-Anthropic model via OpenRouter completes without 400 errors or silently dropped cache headers
3. The `cache_write_tokens` extraction line in `openai/provider.ts` carries a `// FORK PATCH:` comment visible during code review and upstream diff inspection
4. Running `bun test` fails immediately if the non-streaming cache token extraction patch is removed or regressed

**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md — Fix OpenRouterProvider: add extractUsageInfo override (CACHE-01) and 3-breakpoint per-block cache injection (CACHE-02)
- [x] 01-02-PLAN.md — Add FORK PATCH comment to cacheCreationInputTokens in openai/provider.ts (PATCH-01)
- [x] 01-03-PLAN.md — Update OpenRouter tests: per-block assertions + extractUsageInfo regression guard (CACHE-02 / PATCH-02)

**UI hint:** no

---

### Phase 2: Fork Maintenance Tooling

**Goal:** Upstream merges are operationally safe — high-risk file conflicts are caught before they land, each merge point is durably tagged, and fork patches are exportable as recovery insurance.
**Depends on:** Phase 1
**Requirements:** MAINT-01, MAINT-02, MAINT-03

**Success Criteria** (what must be TRUE):
1. Running `.planning/scripts/pre-merge-check.sh` before an upstream merge prints a targeted diff and log of the highest-risk files, letting the operator spot conflicts before they happen
2. After each upstream merge, a git tag in the form `merged-upstream-YYYYMMDD` exists and `git tag --list "merged-upstream-*"` returns it
3. After each upstream merge, `.planning/patches/` contains exported patch files representing the current fork delta, recoverable without knowledge of which commits are fork-only

**Plans:** 1 plan

Plans:
- [x] 02-01-PLAN.md — Create pre-merge-check.sh (MAINT-01), post-merge-export.sh (MAINT-02, MAINT-03), package.json aliases, and UPSTREAM_MERGE.md agent SOP

**UI hint:** no

---

## Requirement Coverage

| Requirement | Phase | Notes |
|-------------|-------|-------|
| CACHE-01 | Phase 1 | Non-streaming OpenRouter usage extraction |
| CACHE-02 | Phase 1 | `cache_control` injection gated on `anthropic/*` prefix |
| PATCH-01 | Phase 1 | `// FORK PATCH:` comment on `cache_write_tokens` line |
| PATCH-02 | Phase 1 | Unit test for non-streaming cache token extraction |
| MAINT-01 | Phase 2 | Pre-merge check shell script |
| MAINT-02 | Phase 2 | Merge commit tagging convention |
| MAINT-03 | Phase 2 | Post-merge patch export to `.planning/patches/` |

**All v1 requirements covered: ✓** (7/7)

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Correctness & Patch Hardening | 0/3 | Not started | - |
| 2. Fork Maintenance Tooling | 0/1 | Not started | - |
