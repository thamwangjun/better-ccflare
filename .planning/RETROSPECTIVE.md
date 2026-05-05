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

## Cross-Milestone Trends

| Milestone | Phases | Plans | Days | Requirements |
|-----------|--------|-------|------|--------------|
| v1.0 | 2 | 4 | 2 | 7/7 |

*More milestones needed for trend analysis.*
