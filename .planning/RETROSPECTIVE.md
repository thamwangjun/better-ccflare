# Retrospective — better-ccflare (Personal Fork)

---

## Milestone: v1.0 — Correctness & Maintenance

**Shipped:** 2026-05-05
**Phases:** 2 | **Plans:** 4 | **Commits:** ~35 | **Timeline:** 2 days

### What Was Built

- Fixed OpenRouterProvider `extractUsageInfo` to read `prompt_tokens_details.cache_write_tokens` — operator billing no longer silently understated by 5x
- Replaced broken top-level `cache_control` injection with per-block injection at 3 Anthropic breakpoints (last tool, last system block, last assistant turn)
- Added `// FORK PATCH:` comment annotation to `cacheCreationInputTokens` in `openai/provider.ts`
- 10-test regression suite with `expect(usage?.cacheCreationInputTokens).toBe(50)` guard
- `pre-merge-check.sh` + `post-merge-export.sh` scripts with `bun run` aliases
- Agent-executable 6-step `UPSTREAM_MERGE.md` SOP with per-file conflict resolution notes

### What Worked

- **TDD discipline (plan 01):** Writing failing tests first made the correctness of both CACHE-01 and CACHE-02 immediately verifiable. The RED commit (`c3661ec`) made the requirements concrete before implementation started — no ambiguity about what "done" meant.
- **Minimal patches:** Both Phase 1 fixes were localized to 2 files (`openrouter/provider.ts`, `openai/provider.ts`). No base class modifications, no structural changes. This kept upstream conflict surface small.
- **Auto-fix during execution (plan 02-01):** Three blocking deviations (gitignore exception, Bash 3.2 last-line bug, generated patch gitignore) were caught and fixed during execution rather than deferred. The milestone shipped without known regressions.
- **Quick task for audit findings:** Post-audit SOP fixes (commit `134f689`, `09ead32`) were dispatched as a quick task rather than a full phase — appropriate scope for documentation-only fixes.

### What Was Inefficient

- **Plan 03 was a no-op:** Plan 01's TDD RED phase wrote a comprehensive 10-test suite that already satisfied all of Plan 03's requirements. Plan 03 became a verification-only exercise. Could have merged 01-03 into 01-01 scope upfront.
- **STATE.md stale:** STATE.md showed `percent: 75` and `completed_phases: 1` at milestone close — wasn't updated after Phase 2 completed. Requires a STATE.md sync step after each phase.
- **REQUIREMENTS.md traceability wording vs implementation:** The CACHE-02 requirement text said "gated on anthropic/* model prefix" but the implementation deliberately omitted the gate. The wording was never updated during development. Caught only at audit time.

### Patterns Established

- `// FORK PATCH: <description>` inline comment convention for all fork-specific code — grep-able during upstream diffs
- Fork scripts live in `.planning/scripts/` with `.gitignore` exception (`!.planning/scripts/*.sh`); generated patch exports are gitignored
- Quick tasks via `/gsd-quick` for post-audit, post-review documentation fixes that don't warrant a full plan
- Phase 2 delivered without a VERIFICATION.md — VALIDATION.md + SUMMARY.md with `nyquist_compliant: true` frontmatter is sufficient evidence of completion

### Key Lessons

1. **Plan scope should match actual work:** When TDD in plan N completes plan N+1's requirements, collapse the plans. Plan 03 added process overhead without value.
2. **Update REQUIREMENTS.md wording when implementation deviates from spec:** The CACHE-02 model prefix gate decision was made in the plan (D-04) but never propagated back to REQUIREMENTS.md. Write the update at decision time, not at audit time.
3. **STATE.md needs an explicit sync after each phase:** The percent/completed_phases fields go stale quickly. Add a `gsd-sdk` state sync or manual update step to the phase completion checklist.
4. **Bash 3.2 `--pretty=format:` omits trailing newline on last line:** `while IFS= read -r c || [[ -n "$c" ]]` is the correct guard — `mapfile` would be cleaner but isn't available in Bash 3.2 (macOS default).

### Cost Observations

- Model mix: Sonnet 4.6 (primary — all planning and execution)
- Sessions: ~4 (planning, phase 1 execution, phase 2 execution, audit + quick task)
- Notable: Phase 01 plan 03 was essentially free — verification pass only, no implementation work

---

## Milestone: v1.1 — Extended caching for openrouter models

**Shipped:** 2026-05-21
**Phases:** 4 | **Plans:** 11 | **Commits:** ~268 | **Timeline:** 16 days (2026-05-05 → 2026-05-21)

### What Was Built

- Extended cache injection to 4 breakpoints with `countExistingCacheControlBlocks()` count guard — non-destructive retrofit on existing 3 breakpoints
- Provider preference injection: `body.provider = { order, allow_fallbacks }` from stored account preference when client hasn't supplied `provider` field
- `openrouter_provider_preference TEXT DEFAULT NULL` column with SQLite + PG migrations, full type chain, repository, and facade
- PUT/DELETE REST endpoints for per-account provider preference management — 11 TDD tests GREEN
- Dashboard Provider Preferences dialog gated on `account.provider === "openrouter"` — human UAT SC-1/SC-2/SC-3 signed off
- pre-merge-check.sh HIGH_RISK_FILES extended to 5 entries; 27 FORK PATCH annotations confirmed

### What Worked

- **Wave-based parallelism (Phase 6):** Plans 06-01 and 06-03 ran in parallel (RED gate + audit), then 06-02 ran in Wave 2. This shaved meaningful time off the phase without adding coordination overhead.
- **Structured JSON storage over bare array:** Choosing `{ order, allow_fallbacks }` JSON shape up front (Plan 04-01) avoided a schema change when `allow_fallbacks` was needed — decision paid off in Plan 04-03 and 06-02.
- **Human UAT as a final gate (Plan 04):** The sc-2/sc-3 nc-based proxy capture tests gave real confidence in the E2E injection path before milestone close — static test suites can't replace this.
- **Type shape change caught early (Plan 04-01):** Upgrading `AccountResponse.openrouterProviderPreference` from `string[] | null` to `{ order, allowFallbacks } | null` in Plan 04-01 (before any tests) prevented the type mismatch from surfacing as a RED test failure in Plan 04-02.

### What Was Inefficient

- **PG migration gap required a separate plan:** Phase 3 shipped without porting the SQLite migration to PostgreSQL (CLAUDE.md requirement). Plan 04-01 was needed to close this before tests could be written. A tighter pre-execution checklist would catch this before Phase 3 execution starts.
- **STATE.md stale at start:** `percent: 125` and `completed_phases: 5` carried over from v1.1 execution — STATE.md wasn't reset after v1.0 milestone close. This is a pattern from v1.0 as well.
- **inline-worker worktree issue repeated:** Both Phase 5 plans hit the same missing auto-generated file issue in the worktree. Once identified in Plan 05-01, the fix is known for future worktree-based execution.

### Patterns Established

- `countExistingCacheControlBlocks()` as a pre-mutation count helper — the right pattern for any injection logic that must respect an upper bound
- `"provider" in body` field-presence check (not `!body.provider`) when guarding injection against an existing field — explicit check beats truthiness
- `?? true` nullish coalescing for boolean flags that must preserve explicit `false` — used in `allow_fallbacks`
- Human UAT via `nc` echo server for verifying proxy request body injection — reusable pattern for future proxy-level changes
- Wave parallelism in Phase 6 (RED gate + unrelated audit in Wave 1, implementation in Wave 2) — works cleanly when Wave 1 tasks are fully independent

### Key Lessons

1. **Port migrations to PG at the same time as SQLite.** The CLAUDE.md requirement exists for a reason — doing it in a separate plan adds unnecessary planning overhead. Add a PG port task to Phase 3 scope upfront.
2. **Reset STATE.md at milestone close, not at next milestone start.** The stale percent/phase counts carry into the new milestone and create confusion. The `/gsd-complete-milestone` workflow should reset STATE.md as part of close, not rely on the next execution run to fix it.
3. **Document known worktree gotchas in CLAUDE.md or phase templates.** The inline-worker copy issue will happen again on any worktree-based plan. A one-line note in the worktree setup section would prevent the detour.
4. **TDD pays compound interest across phases.** The RED gates in each phase (03-01, 04-02, 05-01, 06-01) meant that each implementation plan had an unambiguous definition of done. Zero ambiguity about what "complete" meant at the GREEN gate.

### Cost Observations

- Model mix: Sonnet 4.6 (primary — all planning and execution)
- Sessions: ~10 (2 per phase × 4 phases + planning + audit + quick task)
- Notable: Phase 06 Plan 03 (annotation audit) was essentially a read-only pass — minimal cost for full MAINT-05 compliance

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Days | Requirements |
|-----------|--------|-------|------|--------------|
| v1.0 | 2 | 4 | 2 | 7/7 |
| v1.1 | 4 | 11 | 16 | 9/9 |

**Trends:**
- Plans per phase growing (v1.0: 2.0 avg → v1.1: 2.75 avg) — TDD RED+GREEN split accounts for most of this; expected for feature work vs correctness fixes
- Days per plan stable (~0.5 days v1.0, ~1.5 days v1.1) — v1.1 plans were larger scope with more cross-cutting type changes
- Requirements satisfaction: 100% both milestones — audit gate is working
