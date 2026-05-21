# Requirements — v1.1 Extended caching for openrouter models

*Generated: 2026-05-05 | Milestone: v1.1*

---

## Milestone v1.1 Requirements

### CACHE — Cache Breakpoints & TTL

- [ ] **CACHE-03**: Proxy injects a `cache_control` block on the last high-token user message (4th breakpoint), with a pre-injection count guard to never exceed 4 total blocks across the request
- [ ] **CACHE-04**: Proxy applies `ttl: "1h"` to tools and system `cache_control` blocks, and `{ type: "ephemeral" }` (5-min) to user message and last assistant turn blocks — coordinated with the existing `injectSystemCacheTtl` path in `proxy.ts`
- [ ] **CACHE-05**: Regression test suite extended with cases covering: 4th breakpoint injection, count guard (no inject when already at 4), TTL split (1hr on stable, 5min on transient), and correct behavior across all model types (no model-prefix gate)

### PROV — Per-Account Provider Preference

- [ ] **PROV-01**: Proxy injects `body.provider = { order: [...], allow_fallbacks: true }` from account's stored preference when no `provider` field is already present in the incoming request (client-supplied wins)
- [ ] **PROV-02**: Account schema extended with `openrouter_provider_preference TEXT DEFAULT NULL` column; account type, repository SELECT/UPDATE queries, and `database-operations.ts` facade updated; all changes annotated with `// FORK PATCH:`
- [ ] **PROV-03**: REST API supports PATCH to set or clear `openrouter_provider_preference` per account (mirrors existing `model_mappings` handler pattern)
- [x] **PROV-04**: Dashboard UI includes a dialog on OpenRouter accounts to set or clear provider order (comma-separated input serialized to JSON array), gated on `account.provider === "openrouter"`

### MAINT — Fork Patch Surface

- [x] **MAINT-04**: `pre-merge-check.sh` `HIGH_RISK_FILES` list updated to include all files receiving fork patches in v1.1 (`migrations.ts`, `config/src/index.ts`, `http-api/src/handlers/accounts.ts`)
- [x] **MAINT-05**: Every fork-specific code block added in v1.1 carries a `// FORK PATCH:` comment before merging (enforced by pre-commit review)

---

## Future Requirements

*(Not in v1.1 — tracked here for future milestone planning)*

- Per-request OpenRouter provider selection (`x-better-ccflare-openrouter-provider` header → `provider.order` injection) — deferred from v1.1 scope
- Per-account cache TTL control (independent per-breakpoint TTL via JSON map rather than uniform setting) — surfaced during research, deferred
- Bedrock/Vertex TTL passthrough verification — requires empirical test; deferred pending OpenRouter provider clarity

---

## Out of Scope

- `provider.only` support — eliminates all fallback; always use `provider.order` with `allow_fallbacks: true`
- Model-prefix gate on cache injection — v1.0 and v1.1 both inject without an `anthropic/*` gate (user-confirmed)
- Per-request cache TTL control — account-level granularity is sufficient for v1.1
- Version bumps — handled by automated release system

---

## Traceability

*(Filled by roadmapper — maps REQ-IDs to phases)*

| REQ-ID | Phase | Status |
|--------|-------|--------|
| CACHE-03 | Phase 4 | Pending |
| CACHE-04 | Phase 4 | Pending |
| CACHE-05 | Phase 4 | Pending |
| PROV-01 | Phase 4 | Pending |
| PROV-02 | Phase 3 | Pending |
| PROV-03 | Phase 5 | Pending |
| PROV-04 | Phase 6 | Complete |
| MAINT-04 | Phase 6 | Complete |
| MAINT-05 | Phase 6 | Complete |
