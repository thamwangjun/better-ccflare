# Project Research Summary

**Project:** better-ccflare personal fork — v1.3 OpenRouter Anthropic Messages Provider
**Domain:** New provider/account type for a Bun-based Claude API load-balancer proxy
**Researched:** 2026-06-02
**Confidence:** HIGH

## Executive Summary

v1.3 adds a single new account/provider type (`openrouter-anthropic`) that routes Claude Code's native Anthropic Messages requests to OpenRouter's native `/api/v1/messages` endpoint. Unlike the existing `openrouter` provider — which translates Anthropic Messages to OpenAI Chat Completions and back — this new type is a true passthrough: request bodies arrive at OpenRouter verbatim, preserving `cache_control` blocks, `thinking` config, `context_management.edits`, and all other native-Anthropic fields without shape transformation. The infrastructure for this is almost entirely already in place from v1.1–v1.2: the DB column for provider preferences, the cost chain (`resolveCostUsd`, COALESCE ON CONFLICT), and the SSE streaming infrastructure all carry forward without modification. The implementation is bounded: one new class in `packages/providers/`, four overrides, and a propagation of the `"openrouter-anthropic"` mode string through eleven files across six packages.

The recommended approach is to extend `AnthropicCompatibleProvider` (not `OpenRouterProvider`) and override only four methods: `getEndpoint()`, `buildUrl()` (copy verbatim from `OpenRouterProvider` to avoid the double-segment path bug), `transformRequestBody()` (inject `body.provider` from `openrouter_provider_preference`; zero `cache_control` injection), and `extractUsageInfo()` / `extractStreamingUsage()` (call `super`, then attach `usage.cost` on non-streaming; return `costUsd: undefined` on streaming — cost is absent from all SSE events on this endpoint). The "blast radius" is predictable and grep-verifiable: every file containing the string `"openrouter"` as a mode or provider literal must gain a sibling `"openrouter-anthropic"` entry.

The primary risk is the streaming cost gap: the OpenRouter native Anthropic Messages endpoint has no `cost` field in any SSE event (confirmed from the OpenRouter OpenAPI spec). Streaming costs will fall back to `estimateCostUSD()`, persisting either a token-estimate figure or null for unknown models — identical to the existing `openrouter` provider's fallback behavior. This is acceptable for v1.3 and must be explicitly documented in code. A secondary risk is the breadth of type-union propagation: missing even one of the eleven registration sites causes a silent mismatch (wrong DB value, 404 from dashboard, missing UI button). The mitigation is a single grep check after wiring: `grep -rn '"openrouter"' packages/ --include="*.ts" | grep -v test | grep -v "openrouter-anthropic"` should produce no hits that need a parallel entry.

---

## Key Findings

### Recommended Stack

No new npm dependencies are required. The implementation is pure TypeScript using existing packages. The provider hierarchy already provides the right base class: `AnthropicCompatibleProvider` (which extends `BaseAnthropicCompatibleProvider`) handles Anthropic SSE parsing, rate-limit header reading, and `cache_creation_input_tokens` / `cache_read_input_tokens` field extraction — all correct for the native OpenRouter endpoint. The existing v1.2 cost chain (`AsyncDbWriter`, `resolveCostUsd()`, COALESCE in `save()`) persists without modification.

**Core technologies:**
- `OpenRouterAnthropicProvider extends AnthropicCompatibleProvider` — correct inheritance; avoids OAI-format field readers and 4-breakpoint injector from `OpenRouterProvider`
- `bun:test` with mock fetch — all unit tests; no live calls in CI
- `buildUrl()` verbatim copy from `OpenRouterProvider` — strips leading `/v1` from pathname to avoid `/api/v1/v1/messages` double-segment

**Critical version requirements:** None new. Existing Bun >= 1.2.8, TypeScript 6.0.2, and the `@dqbd/tiktoken` token counter for `estimateCostUSD()` fallback are already present.

### Expected Features

**Must have (table stakes):**
- Correct endpoint routing to `https://openrouter.ai/api/v1/messages` with `Authorization: Bearer` auth
- Verbatim request passthrough (no `cache_control` injection — Claude Code sends its own blocks)
- Cost tracking from `usage.cost` on non-streaming responses (typeof-guarded, real USD value)
- Provider preference injection via existing `openrouter_provider_preference` column
- Dashboard provider-preference dialog gate widened to include `"openrouter-anthropic"`
- CLI `--add-account --mode openrouter-anthropic` registration
- `ANTHROPIC_SHAPE_PROVIDERS` extended in `sse-rate-limit-sniffer.ts` so `overloaded_error` mid-stream frames trigger account failover

**Should have (competitive, v1.3.x):**
- `session_id` injection — routes all turns of a Claude Code session to the same OpenRouter backend from request 1, maximizing prompt cache hit rate (without it, sticky routing activates only after first observed cache hit)
- `openrouter_metadata` debug logging — opt-in visibility into which backend served each request

**Defer (v2+):**
- Extended `provider` routing fields in `openrouter_provider_preference` schema (`sort`, `data_collection`, `zdr`, `max_price`) — requires schema migration, UI expansion
- Per-request OpenRouter provider selection via `x-better-ccflare-openrouter-provider` header

### Architecture Approach

The integration is additive and bounded. The new class slots into the existing provider registry via one import and one `registerProvider()` call. The proxy stack (account-selector to request-handler to response-processor to post-processor worker) is fully polymorphic and requires zero changes; all per-provider behavior dispatches through the overridden methods. The mode string `"openrouter-anthropic"` must be propagated through type unions and runtime conditions in eleven files; ARCHITECTURE.md enumerates every site with exact line numbers and action required. The `PROVIDER_NAMES` / `PROVIDER_CONFIG` gap in `packages/types/src/provider-config.ts` is the highest-priority registration to get right — omitting it causes `getDefaultEndpoint()` to fall through to `"https://api.anthropic.com"` (account ban risk for diagnostic code paths).

**Major components:**

1. `OpenRouterAnthropicProvider` (`packages/providers/src/providers/openrouter-anthropic/`) — new class; four overrides; TDD with `bun:test`
2. Type union propagation across 11 files — ARCHITECTURE.md Section 3 is the authoritative checklist; `bun run typecheck` after Step 4 surfaces remaining gaps
3. HTTP API route + handler (`POST /api/accounts/openrouter-anthropic`) — new dedicated handler, never modifies the existing `openrouter` handler
4. Dashboard wiring (`AccountAddForm`, `AccountListItem`, `AccountsTab`, `api.ts`) — mode branch, SelectItem, and provider-preference gate extension

### Critical Pitfalls

1. **`buildUrl()` double-segment** — `AnthropicCompatibleProvider.buildUrl()` deduplication does not fire for `/v1/messages` against `baseUrl = .../api/v1`; result is `/api/v1/v1/messages` (all requests 404). Prevention: copy `OpenRouterProvider.buildUrl()` verbatim; unit test `buildUrl("/v1/messages", "")` must return exactly `"https://openrouter.ai/api/v1/messages"`.

2. **Wrong parent class (`OpenRouterProvider`)** — inherits 4-breakpoint `cache_control` injector and OAI-format `extractUsageInfo`; injector pushes requests over the 4-block limit (HTTP 400); usage reads `prompt_tokens_details` (absent on native endpoint, cache tokens always 0). Prevention: extend `AnthropicCompatibleProvider` only; unit test with 4-block body asserts zero blocks added.

3. **`extractUsageInfo` reads OAI-format cache fields** — copying `OpenRouterProvider.extractUsageInfo()` reads `prompt_tokens_details.cache_write_tokens` / `cached_tokens`, which do not exist on the native endpoint. Prevention: call `super.extractUsageInfo()` (base class reads Anthropic-native field names correctly), then attach `usage.cost` with `typeof` guard.

4. **Provider name missing from type/config registration sites** — `"openrouter-anthropic"` omitted from `PROVIDER_NAMES` / `PROVIDER_CONFIG` causes `getDefaultEndpoint()` to fall through to `"https://api.anthropic.com"` (ban risk). Omitted from the dashboard `AccountAddForm` mode branch produces 404 on account creation. Prevention: run the grep check after Phase 2 wiring; `bun run typecheck` after type union updates.

5. **SSE rate-limit sniffer not extended** — `ANTHROPIC_SHAPE_PROVIDERS` does not include `"openrouter-anthropic"`; `overloaded_error` mid-stream frames are ignored; overloaded accounts continue receiving requests without failover. Prevention: one-line addition to `sse-rate-limit-sniffer.ts` with unit test.

6. **Streaming cost decision (open, requires requirements decision)** — see DECISION POINT section below.

---

## DECISION POINT: Streaming Cost Strategy

This is the primary unresolved design question. Requirements must decide before implementation begins.

**Context:** The OpenRouter native Anthropic Messages endpoint has no `cost` field in any SSE event (confirmed HIGH confidence from OpenRouter OpenAPI spec, `MessagesDeltaEvent.usage` schema). Cost is only available in non-streaming JSON responses. All real Claude Code usage is streaming.

**Option A — Accept estimateCostUSD() fallback (recommended)**
- `extractStreamingUsage()` returns `costUsd: undefined` explicitly.
- `resolveCostUsd()` in the post-processor worker receives `providerCostUsd = undefined`, falls through to `estimateCostUSD()`.
- For unknown models, `estimateCostUSD()` returns 0, `resolveCostUsd` maps to `undefined`, DB writer writes `null`.
- For known models, a token-estimate dollar figure is persisted.
- Behavior is identical to the existing `openrouter` provider.
- Must be documented with a `// FORK PATCH:` comment.

**Option B — Persist honest null (suppress estimate)**
- Override `extractStreamingUsage()` to also suppress the `estimateCostUSD()` path by returning a sentinel that the worker interprets as "do not estimate."
- Requires modifying the post-processor worker's `resolveCostUsd()` logic — a larger change than Option A.
- Avoids misleading estimated costs on real-money accounts.
- Higher implementation complexity; breaks the worker's clean abstraction.

**Recommended resolution:** Accept Option A (the existing fallback chain behavior). Document clearly with a `// FORK PATCH:` comment. Revisit when OpenRouter adds `cost` to native Messages SSE events. Empirically verify with an integration test that non-streaming requests DO produce real cost values.

---

## Authoritative Blast Radius — Sites Requiring "openrouter-anthropic"

Consolidated from ARCHITECTURE.md and PITFALLS.md. Every `"openrouter"` literal in the type/mode/provider role below needs a sibling `"openrouter-anthropic"` entry.

### Type Unions (add `| "openrouter-anthropic"`)

| File | What Changes |
|------|-------------|
| `packages/types/src/provider-config.ts` | `PROVIDER_NAMES` entry + `PROVIDER_CONFIG` keyed record |
| `packages/types/src/account.ts` | `AccountListItem.mode` union (line 281) + `AddAccountOptions.mode` union (line 305) |
| `packages/cli-commands/src/commands/account.ts` | Two mode union literals (lines 47, 79) |
| `packages/dashboard-web/src/api.ts` | `initAddAccount` mode parameter union (line 259) |
| `packages/dashboard-web/src/components/AccountsTab.tsx` | `handleAddAccount` mode parameter union (line 120) |
| `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` | Four local mode union type literals (lines 28, 157, 431, 1020) |

### Runtime Special-Case Conditions (add sibling branch)

| File | What Changes |
|------|-------------|
| `packages/cli-commands/src/commands/account.ts` | New `else if (mode === "openrouter-anthropic")` branch (~line 1360) |
| `packages/cli-commands/src/commands/account.ts` | `listAccounts()` mode inference — extend condition at line 1659 |
| `packages/cli-commands/src/commands/help.ts` | Mode list + description (lines 9, 20) |
| `packages/http-api/src/handlers/accounts.ts` | New dedicated `createOpenRouterAnthropicAccountAddHandler` function |
| `packages/http-api/src/router.ts` | New route `POST:/api/accounts/openrouter-anthropic` |
| `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` | New SelectItem + new form branch for `mode === "openrouter-anthropic"` |
| `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` | Widen provider-preference dialog gate at line 350 |
| `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` | Extend `ANTHROPIC_SHAPE_PROVIDERS` set |

### Sites That Do NOT Need Changes

`response-processor.ts`, `usage-extraction.ts`, `post-processor.worker.ts`, DB migrations (SQLite + PG), `account.repository.ts`, `AccountOpenrouterProviderPreferenceDialog.tsx` (the dialog itself), `auto-refresh-scheduler.ts`, `toAccount()` / `toAccountResponse()` in `account.ts`. All cost-chain and SSE-parsing infrastructure is provider-agnostic.

---

## Implications for Roadmap

### Phase 1: Provider Class + Unit Tests
**Rationale:** Everything else depends on the provider class existing and behaving correctly. The four high-risk method overrides (buildUrl, transformRequestBody, extractUsageInfo, extractStreamingUsage) must be unit-tested before any integration wiring begins. A wrong parent class choice or incorrect buildUrl would cause all-requests-fail or silent data corruption that is harder to diagnose once the full stack is wired.
**Delivers:** `OpenRouterAnthropicProvider` class with passing unit tests covering all pitfall scenarios; provider barrel and index exports.
**Addresses:** Endpoint routing, Bearer auth, cost tracking (non-streaming), cache field reading, streaming cost null behavior.
**Avoids:** Pitfalls 1 (readFinalSseCost), 2 (wrong parent), 3 (OAI-format fields), 7 (buildUrl double-segment).
**Research flag:** None — patterns are well-documented. Test model on `/api/v1/messages` must be verified before tests are written.

### Phase 2: Type Wiring + CLI + HTTP API + SSE Sniffer
**Rationale:** Type unions must be complete before dashboard or integration tests can compile. CLI and HTTP API wiring enables manual verification (add account, list accounts, curl via proxy) before the dashboard is built. SSE sniffer and FORK PATCH annotations belong here as coexistence wiring tasks.
**Delivers:** `bun run typecheck` passes; `--add-account --mode openrouter-anthropic` works; `POST /api/accounts/openrouter-anthropic` returns 200 with correct DB row; `overloaded_error` frames trigger failover; fork annotations and `HIGH_RISK_FILES` updated.
**Addresses:** Full provider mode string registration, CLI mode dispatch and help text, HTTP API dedicated handler and route, SSE sniffer extension, fork hygiene.
**Avoids:** Pitfalls 4 (incomplete registration), 6 (SSE sniffer), 8 (handler reuse), 9 (fork annotations).
**Research flag:** None for wiring — standard propagation. Verify grep check at end: `grep -rn '"openrouter"' packages/ --include="*.ts" | grep -v test | grep -v "openrouter-anthropic"` should produce no unextended hits.

### Phase 3: Dashboard Wiring
**Rationale:** Dashboard changes are UI-only and have no upstream callers — they can be done after the API is stable. AccountAddForm, AccountListItem, AccountsTab, and api.ts are all contained within `packages/dashboard-web/`.
**Delivers:** "Add Account" form surfaces `openrouter-anthropic` as a mode option; account cards show provider-preference settings button; API client method calls the new route.
**Addresses:** AccountAddForm mode branch + SelectItem, AccountListItem dialog gate, AccountsTab union, api.ts method + union.
**Avoids:** Pitfall 5 (dialog gate not extended).
**Research flag:** None — mechanical propagation.

### Phase 4: Integration Test + Verification
**Rationale:** End-to-end validation via a real (`:free` model, non-Anthropic, force-routed) request through the full proxy stack. Must confirm: cost persists correctly for non-streaming, cost is null/estimated for streaming, cache token fields are populated, provider preference injection fires, account failover on overload.
**Delivers:** Confidence the full stack works together; streaming cost decision empirically confirmed; `usage.cost` field presence on non-streaming responses verified.
**Uses:** `x-better-ccflare-account-id` header + non-Anthropic `:free` model (availability on `/api/v1/messages` confirmed at Phase 1 start).
**Avoids:** Pitfalls 10 (Anthropic ban risk), 11 (test model unavailable on native endpoint).
**Research flag:** Verify at Phase 1 start which `:free` model is available on `/api/v1/messages`. `z-ai/glm-4.5-air:free` is the established safe model for the OAI-format provider but native endpoint availability must be confirmed. Document chosen model in Phase 4 plan.

### Phase Ordering Rationale

- Phase 1 before Phase 2: TypeScript compilation of the wiring phase depends on the provider class existing and exporting correctly.
- Phase 2 before Phase 3: Dashboard API client calls the HTTP route; route must exist before dashboard is wired.
- Phase 3 before Phase 4: Integration test validates the full end-to-end stack including dashboard-initiated account creation.
- Parallelizable within phases: `PROVIDER_NAMES`/`PROVIDER_CONFIG` (Phase 2, Step 3 in ARCHITECTURE.md) can be done simultaneously with Phase 1 provider class work. CLI wiring and HTTP API wiring can proceed in parallel once type unions are complete.

### Research Flags

Phases needing deeper research during planning:
- **Phase 4:** Test model availability on `/api/v1/messages` — `z-ai/glm-4.5-air:free` is known-good for the OAI-format endpoint but must be verified for the native Anthropic Messages endpoint. Use `provider.order = ["ZhipuAI"]` to constrain routing away from Anthropic infrastructure.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Provider class patterns are fully documented in STACK.md + ARCHITECTURE.md. All four override implementations have pseudocode; `buildUrl` override has the exact code to copy.
- **Phase 2:** Propagation pattern is mechanical; ARCHITECTURE.md Section 3 is a complete enumeration with line numbers.
- **Phase 3:** Dashboard wiring mirrors Phase 2; no new patterns.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Primary source: OpenRouter OpenAPI spec fetched 2026-06-02. `AnthropicUsage`, `MessagesResult`, `MessagesDeltaEvent`, `MessagesStartEvent` schemas verified. No-cost-in-SSE confirmed from spec schema. |
| Features | HIGH | OpenRouter docs (endpoint schema, caching guide, provider routing, router metadata) fetched directly. MVP feature set is minimal and all dependencies already shipped in v1.1–v1.2. |
| Architecture | HIGH | Direct codebase inspection with grep-backed enumeration of all `"openrouter"` literal sites. Every registration location confirmed with line numbers. |
| Pitfalls | HIGH | All 11 pitfalls are grounded in specific codebase inspection (line numbers, method names) and OpenRouter spec schema details. No inference-only entries in the critical category. |

**Overall confidence:** HIGH

### Gaps to Address

- **Streaming cost decision:** Whether to suppress `estimateCostUSD()` fallback for streaming on `openrouter-anthropic` accounts, or accept it. Recommendation: accept the existing fallback chain (Option A). Must be explicitly decided in requirements and documented in code.
- **Test model availability on `/api/v1/messages`:** `z-ai/glm-4.5-air:free` confirmed for OAI-format endpoint; native endpoint availability unverified. Resolve at Phase 1 start via a one-time live check using an `openrouter-anthropic` account with `x-better-ccflare-account-id`.
- **`usage.cost` field empirical verification:** STACK.md spec-based confidence is HIGH, but the spec shows `cost: number | null` — `null` is valid. Empirical verification with a real non-streaming response confirms that `cost` is consistently non-null in practice. Use the Phase 4 integration test for this.
- **`session_id` injection:** Deferred to v1.3.x. If included, requires deriving a stable session token from connection/account context — not researched in depth.

---

## Sources

### Primary (HIGH confidence)
- `https://openrouter.ai/openapi.yaml` (fetched 2026-06-02) — `AnthropicUsage`, `MessagesResult`, `MessagesDeltaEvent`, `MessagesStartEvent`, `MessagesStopEvent`, `ProviderPreferences` schemas; no `cost` field in SSE confirmed
- Direct codebase reading (2026-06-02) — `base-anthropic-compatible.ts`, `openrouter/provider.ts`, `anthropic-compatible/provider.ts`, `provider-config.ts`, `account.ts`, `accounts.ts`, `router.ts`, `AccountAddForm.tsx`, `AccountListItem.tsx`, `sse-rate-limit-sniffer.ts`, `usage-extraction.ts`, `post-processor.worker.ts`
- Grep-backed enumeration of all `"openrouter"` literal sites across `packages/**`

### Secondary (MEDIUM confidence)
- `https://openrouter.ai/docs/guides/best-practices/prompt-caching` — cache TTL values, sticky routing behavior, per-block vs top-level caching modes
- `https://openrouter.ai/docs/guides/routing/provider-selection` — `ProviderPreferences` field table
- `https://openrouter.ai/docs/guides/features/response-caching` — cache hit behavior (zeroed tokens)
- `https://openrouter.ai/docs/guides/features/router-metadata` — `openrouter_metadata` streaming delivery in `message_stop`
- `https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration` — native Anthropic Messages passthrough pattern

### Tertiary (LOW confidence)
- `https://www.proredcat.xyz/blog/openrouter-cache-write-calculation` — early 2026 cache write token reporting change confirmation (external blog, corroborated by WebSearch findings)

---
*Research completed: 2026-06-02*
*Ready for roadmap: yes*
