# Project Research Summary

**Project:** better-ccflare personal fork — v1.3 OpenRouter Anthropic Messages Provider
**Domain:** New provider/account type for a Bun-based Claude API load-balancer proxy
**Researched:** 2026-06-02
**Confidence:** HIGH

## Executive Summary

v1.3 adds a single new account/provider type (`openrouter-anthropic`) that routes Claude Code's native Anthropic Messages requests to OpenRouter's native `/api/v1/messages` endpoint. Unlike the existing `openrouter` provider — which translates Anthropic Messages to OpenAI Chat Completions and back — this new type is a true passthrough: request bodies arrive at OpenRouter verbatim, preserving `cache_control` blocks, `thinking` config, `context_management.edits`, and all other native-Anthropic fields without shape transformation. The infrastructure for this is almost entirely already in place from v1.1–v1.2: the DB column for provider preferences, the cost chain (`resolveCostUsd`, COALESCE ON CONFLICT), and the SSE streaming infrastructure all carry forward without modification. The implementation is bounded: one new class in `packages/providers/`, four overrides, and a propagation of the `"openrouter-anthropic"` mode string through eleven files across six packages.

The recommended approach is to extend `AnthropicCompatibleProvider` (not `OpenRouterProvider`) and override the cost/routing methods: `getEndpoint()`, `buildUrl()` (copy verbatim from `OpenRouterProvider` to avoid the double-segment path bug), `transformRequestBody()` (inject `body.provider` from `openrouter_provider_preference`; zero `cache_control` injection), and `extractUsageInfo()` / `extractStreamingUsage()` / `parseUsage()` (call `super`, then attach the real `usage.cost`). **Both streaming and non-streaming must surface OpenRouter's real `usage.cost`, mirroring v1.2.** v1.2's existing `openrouter` provider reads `usage.cost` from the final SSE `message_delta` event for streaming (`readFinalSseCost()` in `openrouter/provider.ts`) and from `usage.cost` for non-streaming — there is NO estimate fallback for streaming, and the new provider must preserve that. The cost-extraction overrides (`parseUsage`, `extractStreamingUsage`, `readFinalSseCost`) should be ported from `OpenRouterProvider` to the new class. The "blast radius" is predictable and grep-verifiable: every file containing the string `"openrouter"` as a mode or provider literal must gain a sibling `"openrouter-anthropic"` entry.

**Correction to earlier draft (now EMPIRICALLY CONFIRMED):** an earlier version of this summary claimed the native endpoint's SSE stream carries no `cost` field (inferred from the undocumented `MessagesDeltaEvent.usage` schema in `openapi.yaml`) and therefore streaming cost would fall back to `estimateCostUSD()`. That was a faulty inference.

**Empirical confirmation (2026-06-02, real billed request to `deepseek/deepseek-v4-flash` via `probe-streaming-cost.sh`):** the native `/api/v1/messages` STREAMING endpoint DOES deliver cost in the final `event: message_delta`. Captured `usage` object:
```json
{"input_tokens":7,"output_tokens":32,"output_tokens_details":{"thinking_tokens":32},
 "cache_creation_input_tokens":null,"cache_read_input_tokens":4,"server_tool_use":null,
 "service_tier":null,"speed":"standard","cost":0.0000070581,"is_byok":false,
 "cost_details":{"upstream_inference_cost":0.0000070581,
   "upstream_inference_prompt_cost":7.669e-7,"upstream_inference_completions_cost":0.0000062912}}
```
This is the same `message_delta` event v1.2's `readFinalSseCost()` already parses, and the cache token field names (`cache_creation_input_tokens`/`cache_read_input_tokens`) match what the `AnthropicCompatibleProvider` base class reads. The new provider extracts real cost on both streaming and non-streaming — mirroring v1.2.

**Implementation note — `usage:{include:true}` opt-in:** the probe sent `"usage":{"include":true}` in the request body. v1.2's existing `openrouter` provider does NOT inject this. To guarantee `cost` appears, the new provider should inject `usage:{include:true}` in `transformRequestBody()` (FORK PATCH, since Claude Code won't send it). Open micro-question for Phase 1: re-run the probe WITHOUT that line to determine whether cost is returned by default on the native endpoint (if so, injection is belt-and-suspenders rather than required).

The primary risk is therefore the breadth of type-union propagation: missing even one of the eleven registration sites causes a silent mismatch (wrong DB value, 404 from dashboard, missing UI button). The mitigation is a single grep check after wiring: `grep -rn '"openrouter"' packages/ --include="*.ts" | grep -v test | grep -v "openrouter-anthropic"` should produce no hits that need a parallel entry.

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
- Cost tracking from real `usage.cost` on BOTH streaming (final SSE `message_delta`) and non-streaming responses (typeof-guarded), mirroring v1.2 — no estimate fallback for streaming
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

6. **Porting the wrong streaming-cost behavior** — the new provider must REUSE v1.2's real-cost extraction, not invent an estimate fallback. Port `parseUsage()`, `extractStreamingUsage()`, and `readFinalSseCost()` from `OpenRouterProvider` so streaming surfaces the real `usage.cost` from the final SSE `message_delta`. Do NOT return `costUsd: undefined` to trigger `estimateCostUSD()` for streaming — that would regress v1.2's real-cost behavior. (Note: do not blindly extend `OpenRouterProvider` to get this — it also carries the cache_control injector and OAI-format token reads; copy only the cost methods onto the `AnthropicCompatibleProvider` subclass.)

---

## Streaming Cost: Resolved (mirror v1.2)

An earlier draft framed streaming cost as an open "estimate vs. null" decision built on the assumption that the native endpoint emits no `cost` in its SSE stream. **That premise was wrong and the question is closed.** v1.2's `openrouter` provider already extracts the real `usage.cost` from the final streaming `message_delta` event (`readFinalSseCost()`), and the new provider must do the same. OpenRouter's `usage.cost` is a platform usage-accounting extension delivered on the final streaming event regardless of endpoint shape; the `openapi.yaml` Anthropic-Messages schema simply doesn't document it.

**Implementation:** Port `parseUsage()` / `extractStreamingUsage()` / `readFinalSseCost()` from `OpenRouterProvider` to the new `AnthropicCompatibleProvider` subclass (clone-before-super for the streaming reader, `typeof === "number"` guard on cost, `// FORK PATCH:` annotation). Real cost on both streaming and non-streaming; the v1.2 worker chain (`resolveCostUsd`, COALESCE) persists it unchanged.

**Only remaining empirical task:** confirm the native `/api/v1/messages` final SSE event actually carries `usage.cost` (integration test, Phase 4) — strong default that it does, since it's the same platform feature v1.2 relies on.

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
**Addresses:** Endpoint routing, Bearer auth, real cost tracking on BOTH streaming (ported `readFinalSseCost`) and non-streaming, cache field reading.
**Avoids:** Pitfalls 2 (wrong parent), 3 (OAI-format fields), 6 (wrong streaming-cost behavior), 7 (buildUrl double-segment).
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
**Rationale:** End-to-end validation via a real (`:free` model, non-Anthropic, force-routed) request through the full proxy stack. Must confirm: real cost persists for BOTH streaming and non-streaming, cache token fields are populated, provider preference injection fires, account failover on overload.
**Delivers:** Confidence the full stack works together; empirical confirmation that the native `/api/v1/messages` final SSE event carries `usage.cost` (streaming) and the non-streaming body carries `usage.cost`.
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
| Stack | HIGH | Primary source: OpenRouter OpenAPI spec fetched 2026-06-02. `AnthropicUsage`, `MessagesResult`, `MessagesDeltaEvent`, `MessagesStartEvent` schemas verified. NOTE: the documented SSE schema omits `cost`, but this is NOT evidence the field is absent at runtime — OpenRouter's `usage.cost` is an undocumented platform extension that v1.2 already reads from the final streaming event; confirm empirically in Phase 4. |
| Features | HIGH | OpenRouter docs (endpoint schema, caching guide, provider routing, router metadata) fetched directly. MVP feature set is minimal and all dependencies already shipped in v1.1–v1.2. |
| Architecture | HIGH | Direct codebase inspection with grep-backed enumeration of all `"openrouter"` literal sites. Every registration location confirmed with line numbers. |
| Pitfalls | HIGH | All 11 pitfalls are grounded in specific codebase inspection (line numbers, method names) and OpenRouter spec schema details. No inference-only entries in the critical category. |

**Overall confidence:** HIGH

### Gaps to Address

- **Streaming cost: resolved, not open.** Mirror v1.2 — port `readFinalSseCost()`/`extractStreamingUsage()`/`parseUsage()` so streaming surfaces the real `usage.cost`. No estimate-vs-null decision needed. (Earlier draft's "no cost in SSE" claim was a faulty inference from the undocumented openapi.yaml schema.)
- **Test model availability on `/api/v1/messages`:** `z-ai/glm-4.5-air:free` confirmed for OAI-format endpoint; native endpoint availability unverified. Resolve at Phase 1 start via a one-time live check using an `openrouter-anthropic` account with `x-better-ccflare-account-id`.
- **`usage.cost` field empirical verification (streaming + non-streaming):** confirm the native endpoint's final SSE `message_delta` carries `usage.cost` (streaming) and the non-streaming body carries it too. Strong default: yes, since it's the same OpenRouter usage-accounting feature v1.2 already relies on. Confirm in the Phase 4 integration test.
- **`session_id` injection:** Deferred to v1.3.x. If included, requires deriving a stable session token from connection/account context — not researched in depth.

---

## Sources

### Primary (HIGH confidence)
- `https://openrouter.ai/openapi.yaml` (fetched 2026-06-02) — `AnthropicUsage`, `MessagesResult`, `MessagesDeltaEvent`, `MessagesStartEvent`, `MessagesStopEvent`, `ProviderPreferences` schemas. The SSE schemas omit `cost`, but this is an undocumented platform extension (see usage-accounting docs) — schema absence ≠ runtime absence; verify empirically.
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
