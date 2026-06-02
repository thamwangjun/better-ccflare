# Roadmap: better-ccflare (Personal Fork)

**Updated:** 2026-06-02 (v1.3 roadmap created)

## Milestones

- ✅ **v1.0 Correctness & Maintenance** — Phases 1–2 (shipped 2026-05-05)
- ✅ **v1.1 Extended caching for openrouter models** — Phases 3–6 (shipped 2026-05-21)
- ✅ **v1.2 OpenRouter Cost Tracking** — Phases 7–8 (shipped 2026-06-02)
- 🔄 **v1.3 OpenRouter Anthropic Messages Provider** — Phases 9–12 (in progress)

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

<details>
<summary>✅ v1.2 OpenRouter Cost Tracking (Phases 7–8) — SHIPPED 2026-06-02</summary>

- [x] Phase 7: OpenRouter Response Cost Extraction (2/2 plans) — completed 2026-05-31
- [x] Phase 8: Real Cost Persistence (2/2 plans) — completed 2026-05-31

Full details: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

### v1.3 OpenRouter Anthropic Messages Provider

- [ ] **Phase 9: Provider Class + Unit Tests** — New `OpenRouterAnthropicProvider` with all four method overrides, TDD-verified
- [ ] **Phase 10: Type Wiring + CLI + HTTP API + SSE Sniffer** — Mode string propagated through all 11 registration sites; CLI and HTTP API functional; failover and debug logging wired
- [ ] **Phase 11: Dashboard Wiring** — Add Account form, provider-preference dialog, and API client updated for the new provider type
- [ ] **Phase 12: Integration Test + Verification** — End-to-end confirmation via a real `:free` model request through the full proxy stack

## Phase Details

### Phase 9: Provider Class + Unit Tests
**Goal**: The `OpenRouterAnthropicProvider` class exists, compiles, and is proven correct for all four high-risk override scenarios before any downstream wiring begins
**Depends on**: Nothing (foundational)
**Requirements**: PROV-01, PROV-02, PROV-03, CACHE-01, ROUTE-01, ROUTE-02, COST-01, COST-02
**Success Criteria** (what must be TRUE):
  1. A request routed to an `openrouter-anthropic` account reaches `https://openrouter.ai/api/v1/messages` with `Authorization: Bearer <key>` and no URL double-segment (`/api/v1/v1/messages` does not appear)
  2. A request body containing native `cache_control` blocks passes through unchanged — no additional blocks are injected and the count stays at or below 4
  3. A request routed to an account with `openrouter_provider_preference` set has `body.provider = { order, allow_fallbacks }` injected; a request without the preference has no `provider` field added
  4. All turns of a multi-turn Claude Code session include a stable `session_id` field in the request body, routing all turns to the same OpenRouter backend
  5. Non-streaming and streaming responses each report a real `usage.cost` value (typeof-guarded `number`) via `extractUsageInfo()` / `extractStreamingUsage()` — no estimate fallback fires for streaming
**Plans**: 1 plan

Plans:
- [ ] 09-01-PLAN.md — OpenRouterAnthropicProvider class (four overrides + session_id/usage injection) and its TDD proof suite covering all five success criteria

### Phase 10: Type Wiring + CLI + HTTP API + SSE Sniffer
**Goal**: The `openrouter-anthropic` mode string is registered across the full type chain, CLI and HTTP API support account creation for the new type, `overloaded_error` frames trigger failover, and debug metadata logging is available
**Depends on**: Phase 9
**Requirements**: MGMT-01, MGMT-02, OBS-01, FAIL-01
**Success Criteria** (what must be TRUE):
  1. `bun run typecheck` passes with zero errors after all type unions and runtime conditions are extended
  2. `bun run cli --add-account <name> --mode openrouter-anthropic` creates a correctly typed account row in the database (provider `"openrouter-anthropic"`)
  3. `POST /api/accounts/openrouter-anthropic` returns HTTP 200 and the created account row reflects `provider = "openrouter-anthropic"`
  4. A mid-stream `overloaded_error` frame on an `openrouter-anthropic` account triggers account failover (the sniffer includes the new provider in its shape set)
  5. With `BETTER_CCFLARE_DEBUG` set, the proxy logs `openrouter_metadata` (backend name, latency) extracted from the `message_stop` SSE event on each `openrouter-anthropic` request
**Plans**: TBD

### Phase 11: Dashboard Wiring
**Goal**: Users can create and manage `openrouter-anthropic` accounts entirely through the dashboard UI, with the provider-preference dialog available for the new account type
**Depends on**: Phase 10
**Requirements**: MGMT-03, MGMT-04
**Success Criteria** (what must be TRUE):
  1. The Add Account form surfaces `"OpenRouter Anthropic Messages (API Key)"` as a selectable mode option and successfully submits account creation to `POST /api/accounts/openrouter-anthropic`
  2. An `openrouter-anthropic` account card in the accounts list displays the provider-preference settings button (the dialog gate is widened from `openrouter`-only)
**Plans**: TBD
**UI hint**: yes

### Phase 12: Integration Test + Verification
**Goal**: The full proxy stack is empirically confirmed to work end-to-end for `openrouter-anthropic` accounts with a real (non-Anthropic, `:free` model) request
**Depends on**: Phase 11
**Requirements**: (validation phase — all 14 v1.3 requirements verified against the running stack)
**Success Criteria** (what must be TRUE):
  1. A non-streaming request force-routed to an `openrouter-anthropic` account returns a 200 response and `requests.cost_usd` in the DB is populated with a real numeric value (not an estimate, not null for a paid model)
  2. A streaming request force-routed to an `openrouter-anthropic` account returns a complete SSE stream and `requests.cost_usd` is populated with a real `usage.cost` value from the final `message_delta` event
  3. Provider-preference injection fires on both request types: the OpenRouter backend selection matches the account's `openrouter_provider_preference` setting
  4. No requests are routed to `https://api.anthropic.com` (confirmed via logs) — the new provider always resolves to `https://openrouter.ai/api/v1/messages`
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Correctness & Patch Hardening | v1.0 | 3/3 | ✅ Complete | 2026-05-04 |
| 2. Fork Maintenance Tooling | v1.0 | 1/1 | ✅ Complete | 2026-05-05 |
| 3. Data Model | v1.1 | 2/2 | ✅ Complete | 2026-05-05 |
| 4. Cache Extension & Provider Injection | v1.1 | 3/3 | ✅ Complete | 2026-05-20 |
| 5. API Layer | v1.1 | 2/2 | ✅ Complete | 2026-05-20 |
| 6. Dashboard UI & Maintenance Hardening | v1.1 | 4/4 | ✅ Complete | 2026-05-21 |
| 7. OpenRouter Response Cost Extraction | v1.2 | 2/2 | ✅ Complete | 2026-05-31 |
| 8. Real Cost Persistence | v1.2 | 2/2 | ✅ Complete | 2026-05-31 |
| 9. Provider Class + Unit Tests | v1.3 | 0/? | Not started | - |
| 10. Type Wiring + CLI + HTTP API + SSE Sniffer | v1.3 | 0/? | Not started | - |
| 11. Dashboard Wiring | v1.3 | 0/? | Not started | - |
| 12. Integration Test + Verification | v1.3 | 0/? | Not started | - |
