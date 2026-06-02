# Phase 9: Provider Class + Unit Tests - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 delivers a new `OpenRouterAnthropicProvider` class with four method overrides, proven correct via TDD (`bun:test`, mocked fetch) before any downstream wiring begins. Scope is the provider class + its unit tests only — type-union propagation, CLI/HTTP/dashboard wiring, the SSE sniffer, and live integration testing belong to Phases 10–12.

Covers Phase 9 requirements: PROV-01, PROV-02, PROV-03, CACHE-01, ROUTE-01, ROUTE-02, COST-01, COST-02.

</domain>

<decisions>
## Implementation Decisions

### Locked by research (carried forward — do not re-litigate)
These are settled in `.planning/research/SUMMARY.md` (HIGH confidence) and PROJECT.md; listed here so the planner treats them as fixed:
- **D-00a:** Extend `AnthropicCompatibleProvider`, NOT `OpenRouterProvider` (avoids the OAI-format `extractUsageInfo` field reads and the 4-breakpoint `cache_control` injector).
- **D-00b:** Copy `OpenRouterProvider.buildUrl()` verbatim — strip leading `/v1` so `buildUrl("/v1/messages", "")` returns exactly `https://openrouter.ai/api/v1/messages` (no `/api/v1/v1/messages` double-segment). Endpoint base `https://openrouter.ai/api/v1`, `Authorization: Bearer`.
- **D-00c:** Verbatim passthrough — ZERO `cache_control` injection. A 4-block request body passes through with block count unchanged (≤ 4).
- **D-00d:** Real cost on BOTH streaming and non-streaming — port `parseUsage()` / `extractStreamingUsage()` / `readFinalSseCost()` cost methods from `OpenRouterProvider` onto the new subclass; `extractUsageInfo()` calls `super` (base reads Anthropic-native cache token fields) then attaches `usage.cost`. `typeof === "number"` guard on cost. NO estimate fallback for streaming.
- **D-00e:** Provider-preference injection mirrors v1.1 exactly: inject `body.provider = { order, allow_fallbacks ?? true }` from `account.openrouter_provider_preference` ONLY when the client body has no `provider` field. Parse-failure → skip silently (log warn). All as `// FORK PATCH:`.

### session_id injection (ROUTE-02 / SC#4)
- **D-01:** Derive `session_id` as a **stable hash of `account.id`** (per-account strategy). Stable across all turns of every session on that account → satisfies SC#4 trivially and maximizes prompt-cache stickiness for a single-user personal fork. Deterministic and easy to unit-test.
- **D-02:** Injection is **always-on** — inject `body.session_id` in `transformRequestBody()` whenever the client has NOT already supplied a `session_id` (mirror the "don't override client-supplied" guard used for `provider`). No env flag. `// FORK PATCH:`.
- *Rejected:* per-conversation hash of `messages[0]` (extra logic, no single-user benefit — system prompt is identical across CC sessions so only first user message would distinguish them); reusing `metadata.user_id` (couples to an undocumented Claude Code field, effectively per-account anyway).

### usage:{include:true} injection (cost guarantee)
- **D-03:** **Always inject** `usage: { include: true }` in `transformRequestBody()` as a `// FORK PATCH:`, when the client body has no `usage` field. Claude Code does not send it; injecting guarantees `usage.cost` appears on the native endpoint and removes a Phase 12 cost-extraction failure mode. The "does cost return by default?" probe question does not change this safe action, so no probe-first gate.

### Unit test fixtures (TDD)
- **D-04:** Use **both** fixture styles:
  - **Captured-real** message_delta from `.planning/research/probe-streaming-cost.sh` output (the real `usage` object with `cost: 0.0000070581`) for the streaming happy path — proves we parse OpenRouter's actual emitted shape.
  - **Synthetic** hand-written mocks for edge cases: missing `cost`, non-numeric/string `cost` (typeof-guard rejection), cache-hit zeroed tokens, and the 4-`cache_control`-block passthrough assertion (count unchanged).

### Test coverage targets (the five SC scenarios)
- **D-05:** Unit tests must cover, at minimum: (1) `buildUrl` no double-segment + Bearer auth; (2) 4-block body → zero blocks added; (3) provider-preference present → `body.provider` injected, absent → no `provider` field; (4) `session_id` stable + present when client omits it, not overridden when client supplies it; (5) non-streaming AND streaming each surface a real numeric `usage.cost` (no estimate fallback for streaming).

### Claude's Discretion
- Exact hash function for `session_id` (e.g. a short stable digest of `account.id`) — planner/executor choice; only the stability + determinism property matters.
- File layout under `packages/providers/src/providers/openrouter-anthropic/` (provider.ts, index.ts, `__tests__/`) — mirror the existing `openrouter/` and `anthropic-compatible/` directory conventions.
- Which cost methods are shared vs copied — port the minimum needed; do NOT extend `OpenRouterProvider` to get them (it drags in the injector + OAI reads).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 research (authoritative — read first)
- `.planning/research/SUMMARY.md` — authoritative implementation summary; streaming-cost resolution, blast radius, pitfalls. Supersedes the earlier ARCHITECTURE.md draft where they conflict (per STATE.md decision).
- `.planning/research/PITFALLS.md` — 11 grounded pitfalls (buildUrl double-segment, wrong parent class, OAI-format fields, wrong streaming-cost behavior) with line numbers.
- `.planning/research/ARCHITECTURE.md` §3 — per-site blast-radius enumeration (Phase 10 wiring; not Phase 9, but informs export shape).
- `.planning/research/probe-streaming-cost.sh` — captured the real native-endpoint `message_delta` `usage` object (source of the captured-real test fixture in D-04).

### Code to mirror / port from
- `packages/providers/src/providers/openrouter/provider.ts` — source of `buildUrl()` (copy verbatim, D-00b), provider-preference injection pattern (D-00e), and the cost methods to port (`parseUsage`/`extractStreamingUsage`/`readFinalSseCost`, D-00d).
- `packages/providers/src/providers/anthropic-compatible/provider.ts` + `packages/providers/src/providers/base-anthropic-compatible.ts` — the chosen parent class; `transformRequestBody(request, account)` signature and base `extractUsageInfo` (Anthropic-native cache fields).
- `packages/providers/src/providers/openrouter/__tests__/` — existing test patterns (mock fetch) to mirror for the new test file.

### Requirements / roadmap
- `.planning/REQUIREMENTS.md` — PROV-01/02/03, CACHE-01, ROUTE-01/02, COST-01/02 definitions.
- `.planning/ROADMAP.md` "Phase 9" — the five success criteria this phase must make TRUE.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `OpenRouterProvider.buildUrl()` (`openrouter/provider.ts:57-70`): copy verbatim for the URL override.
- Provider-preference injection block (`openrouter/provider.ts:193-208`): mirror for D-00e (and the same "inject only when absent" guard pattern reused for `session_id` D-02 and `usage` D-03).
- `OpenRouterProvider.extractUsageInfo()` cost handling (`openrouter/provider.ts:272-275`): the `typeof json.usage.cost === "number"` guard pattern to reuse.
- Cost methods `parseUsage`/`extractStreamingUsage`/`readFinalSseCost` on `OpenRouterProvider` (port, do not inherit).
- v1.2 cost chain (`usage-extraction.ts`, `resolveCostUsd`, `post-processor.worker.ts`, COALESCE in `save()`) — provider-agnostic; consumes the new provider's output unchanged (no Phase 9 changes there).

### Established Patterns
- `transformRequestBody(request: Request, account?: Account): Promise<Request>` — `super` first, mutate cloned JSON body, return a new `Request`. All injections (provider, session_id, usage) layer into this single override.
- `// FORK PATCH:` annotations on every fork-specific addition (upstream merge safety).
- Tests use `bun:test` with mocked `fetch`/`Response`; no live network calls in CI.

### Integration Points
- New class registered via the provider registry (`registerProvider()`) + barrel export — but the registration/type-union wiring is Phase 10 scope. Phase 9 only needs the class to exist, compile, export, and pass its own unit tests.

</code_context>

<specifics>
## Specific Ideas

- Captured-real streaming fixture must use the exact `usage` object from the probe (`cost: 0.0000070581`, with `output_tokens_details`, `cache_read_input_tokens: 4`, `cost_details`) so the test proves parsing of the real shape.
- `session_id` per-account stickiness is intentionally coarse — for a single-user personal fork, one warm backend across all conversations is the desired outcome, not a limitation.

</specifics>

<deferred>
## Deferred Ideas

- **`session_id` probe-without-include** — confirming whether `usage.cost` returns by default on the native endpoint without `usage:{include:true}` is a Phase 12 (integration) empirical check, not a Phase 9 gate. We inject unconditionally regardless.
- **Test model availability on `/api/v1/messages`** (`z-ai/glm-4.5-air:free`) — irrelevant to Phase 9 (mocked fetch); resolve at Phase 12 integration start.
- **`openrouter_metadata` debug logging (OBS-01)** — Phase 10.
- **`ANTHROPIC_SHAPE_PROVIDERS` / failover (FAIL-01)** — Phase 10 (lives in `sse-rate-limit-sniffer.ts`, a separate file from the provider class).
- **Per-request provider selection via `x-better-ccflare-openrouter-provider` header** — Future (ROUTE-F1).

None of the above are scope creep into Phase 9 — discussion stayed within the provider-class boundary.

</deferred>

---

*Phase: 9-provider-class-unit-tests*
*Context gathered: 2026-06-02*
