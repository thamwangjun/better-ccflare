# Phase 10: Type Wiring + CLI + HTTP API + SSE Sniffer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 10-type-wiring-cli-http-api-sse-sniffer
**Areas discussed:** Failover trigger (SC#4), Debug metadata logging (OBS-01), HTTP API handler shape

---

## Failover trigger (FAIL-01 / SC#4)

A documentation conflict was surfaced: ROADMAP SC#4 says add `openrouter-anthropic` to `ANTHROPIC_SHAPE_PROVIDERS`; ARCHITECTURE §3C says "no change needed." Code inspection (`sse-rate-limit-sniffer.ts:79-81`) confirmed `overloaded_error` matching is gated behind that set — the default pattern matches `rate_limit_error` only.

| Option | Description | Selected |
|--------|-------------|----------|
| Add to `ANTHROPIC_SHAPE_PROVIDERS` | Native endpoint emits Anthropic-shape `overloaded_error`; required for SC#4. Overrides ARCHITECTURE §3C. | ✓ |
| Trust §3C (no change) | Rely on default `rate_limit_error` matching — would leave `overloaded_error` unmatched, failing SC#4. | |

**User's choice:** Add to `ANTHROPIC_SHAPE_PROVIDERS` (my recommendation).
**Notes:** User asked for the conflict to be flagged in ARCHITECTURE and CONTEXT so the override isn't reverted. ARCHITECTURE §3C (line 159) and its build-order table (line 299) were both annotated with corrections. Verification is synthetic (mocked `overloaded_error` fixture) for Phase 10; live confirmation deferred to Phase 12.

---

## Debug metadata logging (OBS-01 / SC#5)

Finding: `openrouter_metadata` only appears in `message_stop` when the request carries `X-OpenRouter-Experimental-Metadata: enabled` (STACK.md:84).

| Option | Description | Selected |
|--------|-------------|----------|
| Always inject the header | Send the experimental header on every request; log metadata only under DEBUG. Simpler, no conditional. | ✓ |
| Only when DEBUG set | Inject header only under `BETTER_CCFLARE_DEBUG`; normal traffic never carries the experimental header. | |

**User's choice:** Always inject.
**Notes:** Accepts coupling every production request to an experimental OpenRouter header in exchange for branch-free header logic. Logging itself remains gated behind `BETTER_CCFLARE_DEBUG`.

---

## HTTP API handler shape (MGMT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated handler + route | New `createOpenRouterAnthropicAccountAddHandler` + `POST /api/accounts/openrouter-anthropic`, mirrors openrouter. | ✓ |
| Generalize existing handler | Parameterize the openrouter handler — less duplication, more branching in a shared handler. | |

**User's choice:** Dedicated handler + route (my recommendation).
**Notes:** Preserves the established one-handler-per-route pattern.

---

## Claude's Discretion

- Exact SSE extraction mechanism for `openrouter_metadata` (provider streaming-parse hook vs. response-processor tap).
- Precise field set logged from the metadata object (backend/provider name + latency minimum).
- Where the experimental-metadata header is assembled within the provider.
- The 11 type-wiring sites themselves — fully enumerated in ARCHITECTURE §3 (A/B/D), implemented as specified.

## Deferred Ideas

- Dashboard wiring (AddForm SelectItem, AccountListItem preference gate, api.ts/AccountsTab unions) — Phase 11 (MGMT-03/04).
- Live end-to-end overload/failover verification — Phase 12.
- Making the experimental-metadata header conditional on DEBUG — explicitly rejected; recorded in case the experimental header is later deprecated.
