---
gsd_state_version: 1.0
milestone: v100.0
milestone_name: Bun-to-Node.js Migration
status: planning
stopped_at: Phase 12 context gathered
last_updated: "2026-07-17T12:25:33.391Z"
last_activity: "2026-07-17 — ROADMAP.md created: 8 phases (12-19), 19/19 requirements mapped"
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-17 after v1.3 milestone completion)

**Core value:** Stay current with upstream while running a stable personal instance enhanced with OpenRouter improvements and a clean patch workflow.
**Current focus:** v100.0 Bun-to-Node.js Migration — roadmap created, Phase 12 ready to plan

## Current Position

Phase: 12 of 19 (Foundation — Package Manager & TypeScript Config)
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-07-17 — ROADMAP.md created: 8 phases (12-19), 19/19 requirements mapped

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 27 (v1.0 + v1.1)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | — | — |
| 02 | 1 | — | — |
| 03 | 2 | — | — |
| 04 | 3 | — | — |
| 05 | 2 | — | — |
| 06 | 4 | — | — |
| 07 | 2 | - | - |
| 08 | 2 | - | - |
| 09 | 1 | - | - |
| 10 | 4 | - | - |
| 11 | 2 | - | - |
| 12 | ? | - | - |
| 13 | ? | - | - |
| 14 | ? | - | - |
| 15 | ? | - | - |
| 16 | ? | - | - |
| 17 | ? | - | - |
| 18 | ? | - | - |
| 19 | ? | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v100.0 Roadmap]: 8 phases derived 1:1 from the 8 requirement categories (FOUND/TEST/API/HTTP/DB/DASH/WORKER/DEPLOY), sequenced Foundation → Test Runner → Runtime API Cleanup → HTTP → Database → Dashboard Build → Worker Threads → CLI/Docker/CI, per research's dependency ordering (test runner early for a regression net; DB before Workers since worker files import `bun:sqlite` directly; CLI/Docker/CI strictly last).
- [v100.0 Roadmap]: DB-03 (`retry.ts` `Bun.sleepSync` → `Atomics.wait` fix) is scoped as an explicit, tested success criterion in Phase 16, not left as an afterthought — it's a previously-unknown event-loop-blocking production risk, not just a nice-to-have.
- [v100.0 Roadmap]: WORKER-02 (transferable-ArrayBuffer semantics on the billing-critical usage-collector worker) requires an explicit round-trip integration test written before the Phase 18 rewrite, not just verified after.
- [v100.0 Roadmap]: Node SEA standalone binaries are out of scope for this milestone (deferred to v2 as DIST-01) — Phase 19 delivers npm `bin`+shebang only.
- [v100.0 Roadmap]: Migration strategy is incremental — every phase's success criteria include "app still starts/serves requests with no regression," not just "new thing added," per user's locked constraint that no phase may land in a broken, half-migrated state.
- [v100.0 Roadmap, 2026-07-17]: User directed that all 8 phases anticipate failure of the "app still starts/serves requests with no regression" criterion on first pass, given documented Bun/Node behavioral differences (PITFALLS.md). ROADMAP.md now carries an explicit "Verification Expectation" note instructing planner/executor/verifier agents to budget a gap-closure plan/wave per phase by default, rather than treating first-pass failure as mis-scoping. Mirrored into PROJECT.md's v100.0 Constraints for persistence.

### Pending Todos

None yet.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 260531-l6i | Trim CLAUDE.md, keep important parts, remove redundant parts | 2026-05-31 | 58324d3f | | [260531-l6i-trim-claude-md-keep-important-parts-remo](./quick/260531-l6i-trim-claude-md-keep-important-parts-remo/) |
| 260601-lvx | Replace inline-copy test functions with imports of real production functions | 2026-06-01 | f5ab21cb | | [260601-lvx-replace-inline-copy-test-functions-with-](./quick/260601-lvx-replace-inline-copy-test-functions-with-/) |
| 260601-m3c | Implement parseUsage on OpenRouterProvider for streaming cost extraction | 2026-06-01 | 49002d48 | | [260601-m3c-implement-parseusage-on-openrouterprovid](./quick/260601-m3c-implement-parseusage-on-openrouterprovid/) |
| 260602-8l6 | Refactor COST-02/COST-03 tests to exercise production worker functions instead of inline copies | 2026-06-02 | 47703b18 | | [260602-8l6-refactor-cost-02-cost-03-tests-to-exerci](./quick/260602-8l6-refactor-cost-02-cost-03-tests-to-exerci/) |
| 260602-eax | Fix saveRequest cost_usd unconditional overwrite — use COALESCE in save() ON CONFLICT clause | 2026-06-02 | d3a7ac77 | | [260602-eax-fix-saverequest-cost-usd-unconditional-o](./quick/260602-eax-fix-saverequest-cost-usd-unconditional-o/) |
| 260613-mrg | Resolve upstream/main merge — keep fork CLAUDE.md; port providerCostUsd into usage-collector after upstream deleted the worker | 2026-06-13 | be598d89 | | [260613-mrg-merge-upstream-main-resolve-confli](./quick/260613-mrg-merge-upstream-main-resolve-confli/) |
| 260617-3fb | Restore async Worker-offloaded usage collector with transferable ArrayBuffers + safe dispatch guard (#244); wire Worker into hot path + server lifecycle | 2026-06-17 | 5cd0e604 | | [260617-3fb-restore-async-worker-offloaded-usage-col](./quick/260617-3fb-restore-async-worker-offloaded-usage-col/) |
| 260619-l4e | Merge upstream tag v3.5.27 into thamw-main (Opus 4.8 + Fable 5, integrity fixes, PG fixes); resolve CLAUDE.md keeping fork | 2026-06-19 | b40180bf | | [260619-l4e-merge-upstream-tag-v3-5-27-into-thamw-ma](./quick/260619-l4e-merge-upstream-tag-v3-5-27-into-thamw-ma/) |
| 260620-29c | Fix: usage data loss when post-processor worker enters stopped state | 2026-06-20 | f2621e25 | Verified | [260620-29c-fix-usage-data-loss-when-post-processor-](./quick/260620-29c-fix-usage-data-loss-when-post-processor-/) |

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-07-17:

| Category | Item | Status |
|----------|------|--------|
| debug | chunk-dropped-worker-stopped | open |
| debug | stalled-streaming-requests | investigating |
| quick_task | 260601-m3c-implement-parseusage-on-openrouterprovid | unknown |
| quick_task | 260602-8l6-refactor-cost-02-cost-03-tests-to-exerci | unknown |
| quick_task | 260602-eax-fix-saverequest-cost-usd-unconditional-o | unknown |
| quick_task | 260617-3fb-restore-async-worker-offloaded-usage-col | unknown |
| quick_task | 260619-l4e-merge-upstream-tag-v3-5-27-into-thamw-ma | unknown |
| quick_task | 260712-mqk-fix-post-processor-worker-ts-missing-ori | unknown |

Note: `260717-cwg-revert-all-fork-changes-from-quick-tasks` was found as a completely empty orphaned directory (no TASK.md/SUMMARY.md) and was deleted rather than deferred.

## Session Continuity

Last session: 2026-07-17T12:25:33.369Z
Stopped at: Phase 12 context gathered
Resume file: .planning/phases/12-foundation-package-manager-typescript-config/12-CONTEXT.md

## Operator Next Steps

- Review and approve the v100.0 roadmap, then run `/gsd-plan-phase 12` to begin Foundation phase planning
