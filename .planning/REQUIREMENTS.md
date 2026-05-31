# Requirements: better-ccflare (Personal Fork)

**Defined:** 2026-05-31
**Core Value:** Stay current with upstream while running a stable personal instance enhanced with features I need — primarily around OpenRouter caching, provider selection, and a clean patch workflow.

## v1.2 Requirements

Requirements for OpenRouter cost tracking. Each maps to roadmap phases.

### Cost Tracking

- [ ] **COST-01**: OpenRouter `extractUsageInfo()` reads `usage.cost` from non-streaming JSON responses and returns it as `costUsd`
- [ ] **COST-02**: Post-processor worker reads `usage.cost` from SSE streaming final chunks
- [ ] **COST-03**: Post-processor worker reads `usage.cost` from non-streaming response body JSON
- [ ] **COST-04**: Skip `estimateCostUSD()` when provider-returned `costUsd` is already available, ensuring `cost_usd` ends up in `requests` table for OpenRouter accounts

## Future Requirements

- Per-request OpenRouter provider selection (`x-better-ccflare-openrouter-provider` header → `provider.order` injection) — deferred from v1.1

## Out of Scope

| Feature | Reason |
|---------|--------|
| Maintaining the upstream project | tombii's responsibility; contribute back selectively |
| Auto-publishing to npm/GitHub Container Registry | upstream's release system handles this |
| Rebuilding or replacing core proxy logic | extend existing provider abstraction, don't rewrite it |
| `provider.only` support | eliminates all fallback; always use `provider.order` |
| Storing `cost_details` breakdown (upstream_inference_input_cost, output_cost) | DB schema has single `cost_usd` column; total is sufficient |
| Dashboard cost display changes | existing dashboard already reads `cost_usd` from `requests` table |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| COST-01 | — | Pending |
| COST-02 | — | Pending |
| COST-03 | — | Pending |
| COST-04 | — | Pending |

**Coverage:**
- v1.2 requirements: 4 total
- Mapped to phases: 0
- Unmapped: 4 ⚠️

---
*Requirements defined: 2026-05-31*
*Last updated: 2026-05-31 after initial definition*
