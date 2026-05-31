# Roadmap: better-ccflare (Personal Fork)

**Updated:** 2026-05-31 (v1.2 roadmap defined)

## Milestones

- ✅ **v1.0 Correctness & Maintenance** — Phases 1–2 (shipped 2026-05-05)
- ✅ **v1.1 Extended caching for openrouter models** — Phases 3–6 (shipped 2026-05-21)
- 🚧 **v1.2 OpenRouter Cost Tracking** — Phases 7–8 (planning)

## Phases

<details>
<summary>✅ v1.0 Correctness & Maintenance (Phases 1–2) — SHIPPED 2026-05-05</summary>

- [x] Phase 1: Correctness & Patch Hardening (3/3 plans) — completed 2026-05-04
- [x] Phase 2: Fork Maintenance Tooling (1/1 plan) — completed 2026-05-05

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Extended caching for openrouter models (Phases 3–6) — SHIPPED 2026-05-21</summary>

- [x] Phase 3: Data Model (2/2 plans) — completed 2026-05-05
- [x] Phase 4: Cache Extension & Provider Injection (3/3 plans) — completed 2026-05-20
- [x] Phase 5: API Layer (2/2 plans) — completed 2026-05-20
- [x] Phase 6: Dashboard UI & Maintenance Hardening (4/4 plans) — completed 2026-05-21

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

### 🚧 v1.2 OpenRouter Cost Tracking (Planning)

**Milestone Goal:** Capture actual usage cost from OpenRouter API responses instead of relying on client-side estimates that return $0 for unknown models.

- [x] **Phase 7: OpenRouter Response Cost Extraction** - Extract `usage.cost` from OpenRouter responses (non-streaming provider, streaming SSE final chunks, non-streaming worker body JSON) and return it as `costUsd` (completed 2026-05-31)
- [x] **Phase 8: Real Cost Persistence** - Skip `estimateCostUSD()` when provider-returned `costUsd` is available; `cost_usd` in `requests` table reflects real OpenRouter USD amounts (completed 2026-05-31)

## Phase Details

### Phase 7: OpenRouter Response Cost Extraction
**Goal**: OpenRouter responses (streaming and non-streaming) yield actual USD cost from the provider's `usage.cost` field, making it available downstream
**Depends on**: Phase 6 (v1.1 shipped)
**Requirements**: COST-01, COST-02, COST-03
**Success Criteria** (what must be TRUE):
  1. Non-streaming OpenRouter requests have `usage.cost` extracted from the response JSON and returned as `costUsd` in the `extractUsageInfo()` result
  2. SSE streaming OpenRouter requests have `usage.cost` extracted from the final SSE chunk and surfaced to the post-processor worker
  3. Non-streaming OpenRouter response bodies processed by the post-processor worker have `usage.cost` read from the response JSON
  4. Cost extraction does not break non-OpenRouter providers — Anthropic, Bedrock, Qwen, and other providers continue to function normally
**Plans**: 2 plans

	Plans:
	- [x] 07-01-PLAN.md — Provider COST-01: extract costUsd from OpenRouter non-streaming JSON responses in extractUsageInfo()
	- [x] 07-02-PLAN.md — Worker COST-02/03: extract providerCostUsd from SSE message_delta and non-streaming JSON body, wire handleEnd() gating

### Phase 8: Real Cost Persistence
**Goal**: Actual OpenRouter cost is persisted to the `requests` table instead of unreliable client-side estimates that return $0 for unknown models
**Depends on**: Phase 7
**Requirements**: COST-04
**Success Criteria** (what must be TRUE):
  1. When OpenRouter provider-returned `costUsd` is available, `estimateCostUSD()` is skipped and the API-returned value is used
  2. The `cost_usd` column in the `requests` table contains real USD amounts from OpenRouter's `usage.cost` for both streaming and non-streaming requests
  3. Non-OpenRouter providers continue using `estimateCostUSD()` with no regression in cost tracking
**Plans**: 2 plans

	Plans:
	- [x] 08-01-PLAN.md — D-01/D-02: extractStreamingUsage override on OpenRouterProvider (clone-before-super, typeof guard) so the live streaming path returns real usage.cost
	- [x] 08-02-PLAN.md — D-03/D-04: switch both writers to ?? null (persist real $0), map worker estimate 0→undefined (block estimate-$0), + writer/worker tests


## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Correctness & Patch Hardening | v1.0 | 3/3 | ✅ Complete | 2026-05-04 |
| 2. Fork Maintenance Tooling | v1.0 | 1/1 | ✅ Complete | 2026-05-05 |
| 3. Data Model | v1.1 | 2/2 | ✅ Complete | 2026-05-05 |
| 4. Cache Extension & Provider Injection | v1.1 | 3/3 | ✅ Complete | 2026-05-20 |
| 5. API Layer | v1.1 | 2/2 | ✅ Complete | 2026-05-20 |
| 6. Dashboard UI & Maintenance Hardening | v1.1 | 4/4 | ✅ Complete | 2026-05-21 |
| 7. OpenRouter Response Cost Extraction | v1.2 | 2/2 | Complete    | 2026-05-31 |
| 8. Real Cost Persistence | v1.2 | 2/2 | Complete   | 2026-05-31 |
</content>
