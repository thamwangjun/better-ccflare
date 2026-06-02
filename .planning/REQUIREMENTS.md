# Requirements: better-ccflare — v1.3 OpenRouter Anthropic Messages Provider

**Defined:** 2026-06-02
**Core Value:** Stay current with upstream while running a stable personal instance enhanced with OpenRouter improvements and a clean patch workflow.

## v1.3 Requirements

Requirements for this milestone. Each maps to a roadmap phase.

### Provider (PROV)

- [ ] **PROV-01**: User can route Claude Code requests to OpenRouter's native Anthropic Messages endpoint (`POST https://openrouter.ai/api/v1/messages`) via a new `openrouter-anthropic` account type with `Authorization: Bearer` auth
- [ ] **PROV-02**: The new provider passes request bodies through verbatim — no Anthropic→OpenAI transformation and no `cache_control` breakpoint injection
- [ ] **PROV-03**: The `openrouter-anthropic` provider coexists with the existing OpenAI-format `openrouter` provider, leaving its behavior unchanged

### Caching (CACHE)

- [ ] **CACHE-01**: The user's native `cache_control` blocks (5m / 1h ttl) pass through to OpenRouter unchanged

### Routing (ROUTE)

- [ ] **ROUTE-01**: The user's per-account `openrouter_provider_preference` injects `body.provider = { order, allow_fallbacks }` on the new provider
- [ ] **ROUTE-02**: All turns of a Claude Code session route to the same OpenRouter backend via `session_id` injection, maximizing prompt-cache hit rate from request 1

### Cost (COST)

- [ ] **COST-01**: Real `usage.cost` from non-streaming responses persists to `requests.cost_usd` (typeof-guarded)
- [ ] **COST-02**: Real `usage.cost` from the final streaming SSE `message_delta` persists to `requests.cost_usd` — no estimate fallback for streaming

### Failover (FAIL)

- [ ] **FAIL-01**: Mid-stream `overloaded_error` frames on the new provider trigger account failover (`ANTHROPIC_SHAPE_PROVIDERS` extended)

### Observability (OBS)

- [ ] **OBS-01**: User can opt into debug logging of which OpenRouter backend served each request (`openrouter_metadata` from `message_stop`)

### Management (MGMT)

- [ ] **MGMT-01**: User can add an `openrouter-anthropic` account via CLI (`--add-account --mode openrouter-anthropic`)
- [ ] **MGMT-02**: User can add an `openrouter-anthropic` account via HTTP API (`POST /api/accounts/openrouter-anthropic`)
- [ ] **MGMT-03**: User can add an `openrouter-anthropic` account via the dashboard Add Account form
- [ ] **MGMT-04**: User can set/clear provider order for `openrouter-anthropic` accounts via the dashboard provider-preference dialog

## Future Requirements

Deferred to a later release. Tracked but not in the current roadmap.

### Routing (ROUTE)

- **ROUTE-F1**: Per-request OpenRouter provider selection via `x-better-ccflare-openrouter-provider` header → `provider.order` injection (deferred from v1.1)
- **ROUTE-F2**: Extended `provider` routing fields in `openrouter_provider_preference` schema (`sort`, `data_collection`, `zdr`, `max_price`) — requires schema migration + UI expansion

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Modifying the existing OpenAI-format `openrouter` provider | New type coexists; isolating OpenRouter native logic is the whole point (cleaner upstream merges) |
| `provider.only` support | Eliminates all fallback; always use `provider.order` |
| Rebuilding/replacing core proxy logic | Extend the provider abstraction, don't rewrite it |
| Schema migration for new provider fields | No new DB columns needed — reuse `openrouter_provider_preference`; cost chain unchanged from v1.2 |
| Curling the Anthropic endpoint in tests | Account ban risk — use `:free` non-Anthropic models force-routed via `x-better-ccflare-account-id` |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROV-01 | TBD | Pending |
| PROV-02 | TBD | Pending |
| PROV-03 | TBD | Pending |
| CACHE-01 | TBD | Pending |
| ROUTE-01 | TBD | Pending |
| ROUTE-02 | TBD | Pending |
| COST-01 | TBD | Pending |
| COST-02 | TBD | Pending |
| FAIL-01 | TBD | Pending |
| OBS-01 | TBD | Pending |
| MGMT-01 | TBD | Pending |
| MGMT-02 | TBD | Pending |
| MGMT-03 | TBD | Pending |
| MGMT-04 | TBD | Pending |

**Coverage:**
- v1.3 requirements: 14 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 14 ⚠️

---
*Requirements defined: 2026-06-02*
*Last updated: 2026-06-02 after initial definition*
