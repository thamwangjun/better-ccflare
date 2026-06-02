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

## Milestone: v1.2 — OpenRouter Cost Tracking

**Shipped:** 2026-06-02
**Phases:** 2 | **Plans:** 4 | **Quick tasks:** 5 | **Timeline:** 2 days (2026-05-31 → 2026-06-02)

### What Was Built

- `OpenRouterProvider.extractUsageInfo()` extracts real `usage.cost` → `costUsd` from non-streaming JSON, `typeof === "number"` guarded
- Post-processor worker threads `providerCostUsd` from SSE `message_delta` and non-streaming body JSON, gating `handleEnd()` over `estimateCostUSD()`
- `extractStreamingUsage` override (clone-before-super) + `parseUsage` wiring so the live streaming path returns real `usage.cost`
- Both DB writers switched to `?? null` (preserve genuine `$0`); worker maps estimate-`0 → undefined`; `COALESCE` in `save()` `ON CONFLICT` protects the live-then-worker dual write
- Shared `usage-extraction.ts` module so tests exercise real production functions instead of inline copies

### What Worked

- **Phase split at the verification boundary:** Separating extraction (Phase 7, COST-01/02/03) from persistence (Phase 8, COST-04) gave a clean checkpoint — cost extraction was provably correct before any DB write was wired.
- **typeof guards on provider-controlled fields:** Treating `usage.cost` as untrusted input (reject null/absent/string) was applied uniformly across all four extraction sites, making the test matrix mechanical (number / 0 / null / absent / string) and consistent.
- **The audit gate caught real integration gaps:** Three re-audit cycles surfaced two genuine defects that phase verification missed — the live-streaming `parseUsage` gap and the `saveRequest` `ON CONFLICT` null-overwrite. The milestone did not close until both were fixed.
- **Quick tasks for hardening:** The five quick tasks (parseUsage wiring, COALESCE fix, two test-refactors, one inline-copy removal) were the right scope — surgical fixes to a shipped phase without re-opening the full plan machinery.

### What Was Inefficient

- **Streaming half of COST-04 was missed in initial planning:** Phase 8's plan covered the worker/persistence path but not the *live* streaming response-processor path, which needed a separate `extractStreamingUsage`/`parseUsage` override. It was caught at audit and closed via quick task `260601-m3c` — should have been in the Phase 8 plan from the start. Streaming and non-streaming are always separate code paths; both belong in scope together.
- **Dual-write null-overwrite found late:** The `save()` `ON CONFLICT` unconditionally overwrote `cost_usd`, so a worker upsert with a failed parse could null out the real cost the live path had already written. This is an inherent risk of the live-then-worker dual-write pattern and should have been a design consideration in Phase 8, not an audit finding (quick task `260602-eax`).
- **Inline-copy test drift:** Tests initially copied worker logic inline rather than importing it, so they could pass while production drifted. Required two refactor quick tasks (`260601-lvx`, `260602-8l6`) to extract `usage-extraction.ts` and point tests at real functions.

### Patterns Established

- **clone-before-super for single-use response bodies:** `clone.clone()` before delegating to `super.extractStreamingUsage()` — the base consumes the one-shot body reader, so capture your own copy first.
- **`?? null` vs `|| null` to distinguish a real `0` from absent:** cost columns use `?? null` (a genuine `$0` is meaningful); token columns keep `|| null` (0 and absent are equivalent).
- **estimate-`0 → undefined` upstream:** map `estimateCostUSD()`'s literal `0`-for-unknown-models to `undefined` in the worker so `?? null` collapses it to `null` rather than masquerading as a real `$0`.
- **`COALESCE(EXCLUDED.col, table.col)` in `ON CONFLICT`:** the default null-overwrite guard for any column written by two paths (live + deferred worker).
- **Shared pure-function module imported by both worker and tests:** the durable fix for inline-copy drift — there is exactly one code path, and the tests run it.

### Key Lessons

1. **Scope streaming and non-streaming together.** Every cost/usage feature has (at least) a live streaming path, a worker streaming path, and a non-streaming path. Enumerate all of them in the plan; the live streaming path is the easiest to forget because it bypasses the worker.
2. **Dual-write patterns need explicit null-overwrite protection at the DB layer.** When a live path and a deferred worker both upsert the same row, design the `ON CONFLICT` clause defensively (`COALESCE`) up front — don't wait for the race to surface as lost data.
3. **Tests must import production code, not copy it.** An inline copy passes forever while production rots. If a test re-implements logic, extract that logic to a shared module first.
4. **A strong audit gate substitutes for thinner phase verification — but at a cost.** Three re-audit cycles found two real defects, which is the gate working. But each was a fix-then-re-audit round trip; catching them in phase verification (with the all-paths-enumerated lesson above) would have been cheaper.

### Cost Observations

- Model mix: Opus (planner/executor/verifier/auditor per model_overrides) + Sonnet for lighter steps
- Sessions: ~6 (2 phase executions + 3 audit cycles + quick-task batch)
- Notable: 5 quick tasks vs 4 plans — an unusually high hardening-to-plan ratio, reflecting defects surfaced by the audit gate rather than planned work

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Days | Requirements |
|-----------|--------|-------|------|--------------|
| v1.0 | 2 | 4 | 2 | 7/7 |
| v1.1 | 4 | 11 | 16 | 9/9 |
| v1.2 | 2 | 4 | 2 | 4/4 |

**Trends:**
- Plans per phase: v1.0 2.0 → v1.1 2.75 → v1.2 2.0 — v1.2 was a tightly-scoped 2-phase feature; the *real* work overflow landed in 5 quick tasks rather than additional plans
- Days per plan: ~0.5 (v1.0) → ~1.5 (v1.1) → ~0.5 (v1.2) — v1.2 plans were small and surgical, like v1.0 correctness fixes
- Requirements satisfaction: 100% across all three milestones — audit gate continues to hold
- **Emerging signal:** v1.2's 5 quick tasks (vs 1 in v1.0, ~1 in v1.1) all closed audit-found gaps. The audit is catching what phase verification misses — particularly multi-code-path features (streaming vs non-streaming) and cross-write data integrity
