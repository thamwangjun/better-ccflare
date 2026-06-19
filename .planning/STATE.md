---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: OpenRouter Anthropic Messages Provider
status: completed
stopped_at: "260619-l4e merged upstream v3.5.27; 260617-3fb async worker live on hot path + server lifecycle"
last_updated: "2026-06-19T00:00:00.000Z"
last_activity: 2026-06-19
progress:
  total_phases: 1
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-02 after v1.2 milestone completion)

**Core value:** Stay current with upstream while running a stable personal instance enhanced with OpenRouter improvements and a clean patch workflow.
**Current focus:** Milestone complete

## Current Position

Phase: 11
Plan: Not started
Status: Milestone complete
Last activity: 2026-06-20 - Completed quick task 260620-29c: Fix: usage data loss when post-processor worker enters stopped state

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

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 7–8 split]: COST-01/02/03 are grouped in Phase 7 (provider + worker cost extraction from all response paths); COST-04 is Phase 8 (skip estimate, persist). Splitting at this boundary gives a verification checkpoint — cost extraction can be tested before wiring through to persistence.
- Provider-level cost extraction (COST-01) in `extractUsageInfo()` flows into the proxy context; worker-level extraction (COST-02, COST-03) handles the two response paths (SSE streaming final chunk vs. non-streaming body JSON)
- COST-04 is the integration point in `pricing.ts` — skip `estimateCostUSD()` when `costUsd` is already available from the provider/worker chain
- [v1.3 ARCHITECTURE.md vs SUMMARY.md conflict]: ARCHITECTURE.md (earlier draft) claimed SSE sniffer needs no change and streaming cost has no `cost` field. SUMMARY.md (later, with empirical probe confirmation) corrects both: streaming cost IS present in native endpoint's final `message_delta` (empirically confirmed 2026-06-02); `ANTHROPIC_SHAPE_PROVIDERS` DOES need extending; port `readFinalSseCost()` from `OpenRouterProvider`. SUMMARY.md positions are authoritative.
- [v1.3 Phase 9 scope]: ROUTE-02 (`session_id` injection) and COST-01/02 (real cost extraction) map to Phase 9 because they are implemented directly in the provider class overrides (`transformRequestBody`, `extractUsageInfo`, `extractStreamingUsage`). FAIL-01 moved to Phase 10 — it lives in `sse-rate-limit-sniffer.ts`, a separate file from the provider class, and belongs with the wiring phase.

### Pending Todos

- Verify `z-ai/glm-4.5-air:free` model availability on `/api/v1/messages` native endpoint (confirm before writing Phase 9 unit tests)
- Confirm whether `usage:{include:true}` must be injected in `transformRequestBody()` or if cost is returned by default on the native endpoint (one-time live check)

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

## Session Continuity

Last session: 2026-06-19
Stopped at: Quick task 260619-l4e COMPLETE — merged upstream tag v3.5.27 into thamw-main (resolved CLAUDE.md keeping fork). Earlier 260617-3fb (async Worker-offloaded usage collector, GOAL MET 8/8) also merged in via this pull. No active work in progress.
Resume file: none

## Operator Next Steps

- Run `/gsd-plan-phase 9` to plan Phase 9: Provider Class + Unit Tests
- Before writing Phase 9 unit tests: verify `z-ai/glm-4.5-air:free` availability on `/api/v1/messages` and confirm `usage:{include:true}` injection requirement
