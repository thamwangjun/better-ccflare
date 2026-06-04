# Phase 10: Type Wiring + CLI + HTTP API + SSE Sniffer - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 10 propagates the `openrouter-anthropic` mode string across the full type chain (all sites enumerated in ARCHITECTURE §3), wires account creation via CLI and HTTP API, makes mid-stream `overloaded_error` frames trigger account failover for the new provider, and adds opt-in debug logging of `openrouter_metadata` (which OpenRouter backend served each request).

Covers Phase 10 requirements: **MGMT-01** (CLI add-account), **MGMT-02** (HTTP API add-account), **OBS-01** (`openrouter_metadata` debug logging), **FAIL-01** (`overloaded_error` failover).

**In scope:** the 11 type-wiring sites (ARCHITECTURE §3 A+B), `PROVIDER_NAMES`/`PROVIDER_CONFIG` entry (§3D), CLI mode branches, dedicated HTTP handler + route, `ANTHROPIC_SHAPE_PROVIDERS` extension, and `openrouter_metadata` extraction + logging.

**Out of scope (Phase 11+):** dashboard Add Account form + provider-preference dialog gate (MGMT-03/04 = Phase 11); live end-to-end integration test (Phase 12). Provider class itself = Phase 9 (done).

</domain>

<decisions>
## Implementation Decisions

### Failover — SSE sniffer (FAIL-01 / SC#4)
- **D-01:** Add `"openrouter-anthropic"` to `ANTHROPIC_SHAPE_PROVIDERS` in `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` (line 43). One-line change.
- **Rationale:** The sniffer GATES `overloaded_error` matching behind this set (lines 79–81: `isAnthropicShape ? "rate_limit_error|overloaded_error" : "rate_limit_error"`). The `openrouter-anthropic` provider hits OpenRouter's **native Anthropic Messages endpoint** (`/api/v1/messages`), whose SSE stream is byte-for-byte Anthropic shape (STACK.md:81) and emits genuine `overloaded_error` envelopes. Without adding it, only `rate_limit_error` matches → SC#4 fails.
- **⚠️ OVERRIDES ARCHITECTURE §3C**, which incorrectly lists the sniffer as "no change needed" — that reasoning conflated `openrouter-anthropic` (Anthropic-shape) with the OAI-shape `openrouter` provider, missing that the native endpoint emits Anthropic `overloaded_error`. ROADMAP SC#4 ("the sniffer includes the new provider in its shape set") is the correct authority. **This contradiction has been flagged in ARCHITECTURE §3C — do not revert D-01 to match the stale §3C note.**
- **D-02:** Verify via a **synthetic `overloaded_error` SSE fixture** fed to the sniffer with `provider: "openrouter-anthropic"`, asserting failover fires (mirrors Phase 9's mocked-fetch test style). Empirical confirmation of a real overload frame is deferred to Phase 12 — overloads are non-deterministic and we won't curl OpenRouter to force one. The wiring is justified by the endpoint's documented Anthropic-shape SSE, not a captured frame.

### Debug metadata logging (OBS-01 / SC#5)
- **D-03:** **Always inject** the `X-OpenRouter-Experimental-Metadata: enabled` request header on every `openrouter-anthropic` request (no conditional). This is the trigger that makes OpenRouter include `openrouter_metadata` in the terminal `message_stop` SSE event (STACK.md:84). User accepted the trade-off (every production request carries an experimental header) in favor of simpler, branch-free header logic.
- **D-04:** Extract `openrouter_metadata` (backend name, latency) from the `message_stop` event and **log it only when `BETTER_CCFLARE_DEBUG` is set** (via the `Logger` at debug level — already silenced unless DEBUG). `message_stop` carries no usage/cost, so this is a separate tap from the cost path. The metadata is logged-only — no client-visible response change.

### HTTP API account creation (MGMT-02)
- **D-05:** **Dedicated handler + route.** Add `createOpenRouterAnthropicAccountAddHandler()` in `packages/http-api/src/handlers/accounts.ts` (inserts `provider: "openrouter-anthropic"`, mirrors `createOpenRouterAccountAddHandler`) and register `POST:/api/accounts/openrouter-anthropic` in `packages/http-api/src/router.ts`. Preserves the established one-handler-per-route pattern; no branching inside a shared handler.

### Type wiring (MGMT-01 + locked)
- **D-06:** Implement all type-union and runtime-condition sites exactly as enumerated in **ARCHITECTURE §3 (A + B)** — 8 type-union sites, 8 runtime sibling-branch sites — plus the `PROVIDER_NAMES`/`PROVIDER_CONFIG` entry from §3D (`requiresSessionTracking: false`, `supportsUsageTracking: false`, `supportsOAuth: false`, `defaultEndpoint: "https://openrouter.ai/api/v1"`). Dashboard-side sites (AccountAddForm, AccountListItem, api.ts, AccountsTab) are Phase 11 scope — Phase 10 does the non-dashboard sites + the shared types. Success gate: `bun run typecheck` passes with zero errors.

### Claude's Discretion
- Exact extraction mechanism for `openrouter_metadata` from the SSE stream (provider streaming-parse hook vs. response-processor tap) — planner/executor choice; only the "extract from `message_stop`, log under DEBUG" property matters.
- Precise field set logged from `openrouter_metadata` (log what the metadata object actually contains — backend/provider name + latency at minimum).
- Whether the `X-OpenRouter-Experimental-Metadata` header is set in the provider's `buildRequest`/header construction vs. `transformRequestBody` — wherever the provider already assembles request headers.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 research (authoritative — read first)
- `.planning/research/ARCHITECTURE.md` §3 — exhaustive grep-backed enumeration of every `"openrouter"` site needing a sibling branch (the type-wiring spec for this phase). **CAVEAT: §3C's claim that the SSE sniffer needs no change is INCORRECT — see D-01. §3C has been annotated with a correction.**
- `.planning/research/STACK.md` §(lines 81–116, 223–248) — native endpoint SSE event shapes; `message_stop` carries optional `openrouter_metadata` only when `X-OpenRouter-Experimental-Metadata: enabled` is sent; `MessagesStopEvent` has no usage/cost.
- `.planning/research/SUMMARY.md` — authoritative implementation summary; router-metadata + failover context.
- `.planning/research/FEATURES.md` (rows: `openrouter_metadata` routing visibility, streaming support) — OBS-01 feature notes.

### Code to modify / mirror
- `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` — `ANTHROPIC_SHAPE_PROVIDERS` (line 43), gating logic (lines 79–88). Target of D-01.
- `packages/http-api/src/handlers/accounts.ts` (~line 3495) + `packages/http-api/src/router.ts` (lines 248–249) — mirror the `openrouter` handler + route for D-05.
- `packages/cli-commands/src/commands/account.ts` (lines 47, 79 unions; 1334 mode branch; 1659 list inference) — CLI wiring.
- `packages/types/src/account.ts` (lines 281, 305) + `packages/types/src/provider-config.ts` (line 15 `PROVIDER_NAMES`, ~110 `PROVIDER_CONFIG`) — shared type unions + provider metadata (§3D).
- `packages/providers/src/providers/openrouter-anthropic/provider.ts` — Phase 9 provider class; add the `X-OpenRouter-Experimental-Metadata` header (D-03) and metadata extraction (D-04) here.

### Requirements / roadmap
- `.planning/REQUIREMENTS.md` — MGMT-01, MGMT-02, OBS-01, FAIL-01 definitions.
- `.planning/ROADMAP.md` "Phase 10" — the five success criteria this phase must make TRUE. **SC#4 is the authority for D-01 over ARCHITECTURE §3C.**

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createOpenRouterAccountAddHandler` (`packages/http-api/src/handlers/accounts.ts`) — copy as the template for the new dedicated handler (D-05).
- The `POST:/api/accounts/openrouter` route (`router.ts:248-249`) — mirror for the new route.
- Sniffer `typePattern` builder (`sse-rate-limit-sniffer.ts:79-88`) — already supports the desired behavior; only the membership set needs widening (D-01).
- CLI `else if (mode === "openrouter")` branch (`account.ts:1334`) and list-inference condition (`account.ts:1659`) — sibling branch / OR-extension targets.

### Established Patterns
- One-handler-per-route in `http-api` (D-05 follows it).
- Sibling `=== "openrouter-anthropic"` runtime conditions added next to existing `=== "openrouter"` checks (ARCHITECTURE §3B).
- `// FORK PATCH:` annotation on every fork-specific addition (upstream merge safety).
- `Logger` (not `console.*`); debug-level output silenced unless `BETTER_CCFLARE_DEBUG` set — D-04 relies on this.

### Integration Points
- Provider already registered in Phase 9; Phase 10 connects it to CLI/HTTP/type-union/sniffer layers.
- Sites in ARCHITECTURE §3C (response-processor, usage-extraction, post-processor, migrations, account.repository, auto-refresh-scheduler, `toAccount`/`toAccountResponse`) genuinely need **no change** — only the sniffer entry in §3C is wrong (D-01).

</code_context>

<specifics>
## Specific Ideas

- The failover fix is one line of code but carries a doc-conflict landmine: ARCHITECTURE §3C will actively tell a future implementer/reviewer to *remove* it. The override and its rationale must survive into PLAN.md so the change isn't "corrected" away.
- OBS-01 is logging-only and opt-in — it must not alter the response stream or client-visible behavior; metadata surfaces in logs under `BETTER_CCFLARE_DEBUG` only.

</specifics>

<deferred>
## Deferred Ideas

- **Dashboard wiring** (AccountAddForm SelectItem, AccountListItem provider-preference gate, api.ts/AccountsTab unions) — Phase 11 (MGMT-03/04).
- **Live end-to-end overload/failover verification** with a real OpenRouter request — Phase 12 integration; D-02 covers it synthetically for now.
- **Making the experimental-metadata header conditional** on `BETTER_CCFLARE_DEBUG` — explicitly rejected (D-03, always-on chosen). Recorded in case the experimental header is later deprecated and needs revisiting.

None of the above is scope creep into Phase 10 — discussion stayed within the type-wiring + CLI + HTTP + sniffer boundary.

</deferred>

---

*Phase: 10-type-wiring-cli-http-api-sse-sniffer*
*Context gathered: 2026-06-04*
