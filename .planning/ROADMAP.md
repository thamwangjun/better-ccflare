# Roadmap: better-ccflare (Personal Fork)

**Updated:** 2026-05-20 (v1.1 Phase 5 planned)

## Milestones

- ✅ **v1.0 Correctness & Maintenance** — Phases 1–2 (shipped 2026-05-05)
- 🚧 **v1.1 Extended caching for openrouter models** — Phases 3–6 (in progress)

## Phases

<details>
<summary>✅ v1.0 Correctness & Maintenance (Phases 1–2) — SHIPPED 2026-05-05</summary>

- [x] Phase 1: Correctness & Patch Hardening (3/3 plans) — completed 2026-05-04
- [x] Phase 2: Fork Maintenance Tooling (1/1 plan) — completed 2026-05-05

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

### 🚧 v1.1 Extended caching for openrouter models (In Progress)

**Milestone Goal:** Extend OpenRouter cache injection to the full 4-breakpoint limit, add long-TTL support for agentic sessions, and enable per-account OpenRouter provider preferences backed by a Dashboard UI.

- [ ] **Phase 3: Data Model** - Extend account schema with OpenRouter provider preference field
- [ ] **Phase 4: Cache Extension & Provider Injection** - Add 4th cache breakpoint, TTL split, and provider.order injection
- [ ] **Phase 5: API Layer** - PATCH endpoint to set or clear per-account provider preference
- [ ] **Phase 6: Dashboard UI & Maintenance Hardening** - Provider order dialog and fork patch surface update

## Phase Details

### Phase 3: Data Model
**Goal**: Account records carry an OpenRouter provider preference field that all subsequent layers can read and write
**Depends on**: Phase 2 (v1.0 complete)
**Requirements**: PROV-02
**Success Criteria** (what must be TRUE):
  1. Running the DB migration adds an `openrouter_provider_preference TEXT DEFAULT NULL` column without data loss on existing accounts
  2. Account SELECT queries return the preference field alongside existing account fields
  3. Account UPDATE queries persist a preference value and NULL (clear) correctly
  4. All schema, type, repository, and facade changes carry `// FORK PATCH:` annotations
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Write failing test scaffolds for repository SELECT/UPDATE and type mapper behavior (TDD RED gate)
- [x] 03-02-PLAN.md — Implement migration + full type chain + repository + facade (TDD GREEN gate)

### Phase 4: Cache Extension & Provider Injection
**Goal**: OpenRouter requests use extended cache breakpoints with correct TTL per block type, and the proxy injects the account's stored provider preference when no provider override is already present in the request
**Depends on**: Phase 3
**Requirements**: CACHE-03, CACHE-04, CACHE-05, PROV-01
**Success Criteria** (what must be TRUE):
  1. A request with 4 eligible content blocks receives exactly 4 `cache_control` blocks — the proxy never injects a 5th
  2. System blocks carry `ttl: "1h"`; tools, user message, and last assistant turn blocks carry `{ type: "ephemeral" }` (5-min) — TTL management is the exclusive responsibility of `injectSystemCacheTtl()` and applies only to system blocks
  3. When an account has `openrouter_provider_preference` set, the proxy injects `provider.order` with `allow_fallbacks: true`; when the incoming request already contains a `provider` field, it is left untouched
  4. Regression tests cover: 4th breakpoint injection, count guard (no inject when already at 4), TTL split, and correct behavior across model types without a model-prefix gate
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Fix PG migration gap + update type chain to structured object shape (execute)
- [x] 04-02-PLAN.md — Write 9 failing tests for count guard, 4th breakpoint, provider injection (TDD RED gate)
- [x] 04-03-PLAN.md — Implement transformRequestBody() extension to pass all tests (TDD GREEN gate)

### Phase 5: API Layer
**Goal**: Operators can set or clear an account's OpenRouter provider preference via the REST API using PUT and DELETE endpoints
**Depends on**: Phase 3
**Requirements**: PROV-03
**Success Criteria** (what must be TRUE):
  1. `PUT /api/accounts/:id/openrouter-provider-preference` with `{ order: string[], allow_fallbacks?: boolean }` persists the preference and returns 204
  2. `DELETE /api/accounts/:id/openrouter-provider-preference` clears the preference (column returns to NULL) and returns 204
  3. Both endpoints return 404 for non-existent accounts; PUT returns 400 for invalid input
  4. All 11 TDD tests pass; FORK PATCH annotations present on all fork-specific code blocks
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md — Write 11 failing tests for PUT set-preference and DELETE clear-preference (TDD RED gate)
- [ ] 05-02-PLAN.md — Add DELETE handler + FORK PATCH annotation on PUT + register DELETE route (TDD GREEN gate)

### Phase 6: Dashboard UI & Maintenance Hardening
**Goal**: Dashboard operators can configure per-account provider preferences through a UI dialog, and all v1.1 fork patches are covered by maintenance tooling
**Depends on**: Phase 5
**Requirements**: PROV-04, MAINT-04, MAINT-05
**Success Criteria** (what must be TRUE):
  1. The provider order dialog appears only on accounts with `provider === "openrouter"` — non-OpenRouter accounts show no dialog
  2. An operator enters a comma-separated provider list, saves it, and subsequent requests from that account inject `provider.order` with those values
  3. Clearing the provider order field removes the preference and the proxy stops injecting `provider.order` for that account
  4. `pre-merge-check.sh` `HIGH_RISK_FILES` includes `migrations.ts` and `http-api/src/handlers/accounts.ts`
  5. Every v1.1 code block carrying fork-specific logic has a `// FORK PATCH:` comment (confirmed before merge)
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 3 → 4 → 5 → 6

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Correctness & Patch Hardening | v1.0 | 3/3 | ✅ Complete | 2026-05-04 |
| 2. Fork Maintenance Tooling | v1.0 | 1/1 | ✅ Complete | 2026-05-05 |
| 3. Data Model | v1.1 | 0/2 | Not started | - |
| 4. Cache Extension & Provider Injection | v1.1 | 0/3 | Not started | - |
| 5. API Layer | v1.1 | 0/2 | Not started | - |
| 6. Dashboard UI & Maintenance Hardening | v1.1 | 0/TBD | Not started | - |
