# Phase 9: Provider Class + Unit Tests — Research

**Researched:** 2026-06-02
**Domain:** New TypeScript provider class + bun:test unit test suite in an existing Bun/TypeScript proxy codebase
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-00a:** Extend `AnthropicCompatibleProvider`, NOT `OpenRouterProvider`.
- **D-00b:** Copy `OpenRouterProvider.buildUrl()` verbatim — strip leading `/v1` so `buildUrl("/v1/messages", "")` returns exactly `https://openrouter.ai/api/v1/messages`. Endpoint base `https://openrouter.ai/api/v1`, `Authorization: Bearer`.
- **D-00c:** Verbatim passthrough — ZERO `cache_control` injection. A 4-block request body passes through with block count unchanged.
- **D-00d:** Real cost on BOTH streaming and non-streaming — port `parseUsage()` / `extractStreamingUsage()` / `readFinalSseCost()` cost methods from `OpenRouterProvider` onto the new subclass; `extractUsageInfo()` calls `super` (base reads Anthropic-native cache token fields) then attaches `usage.cost`. `typeof === "number"` guard on cost. NO estimate fallback for streaming.
- **D-00e:** Provider-preference injection mirrors v1.1 exactly: inject `body.provider = { order, allow_fallbacks ?? true }` from `account.openrouter_provider_preference` ONLY when the client body has no `provider` field. Parse-failure → skip silently (log warn). All as `// FORK PATCH:`.
- **D-01:** `session_id` is a stable hash of `account.id` (per-account strategy). Stable across all turns.
- **D-02:** `session_id` injection is always-on. Inject in `transformRequestBody()` when client has NOT supplied `session_id`. `// FORK PATCH:`.
- **D-03:** Always inject `usage: { include: true }` in `transformRequestBody()` when client body has no `usage` field. `// FORK PATCH:`.
- **D-04:** Use both fixture styles — captured-real (`cost: 0.0000070581`) for streaming happy path; synthetic mocks for edge cases.
- **D-05:** Unit tests must cover: (1) `buildUrl` no double-segment + Bearer auth; (2) 4-block body → zero blocks added; (3) provider-preference present → injected, absent → no `provider` field; (4) `session_id` stable + present when client omits, not overridden when client supplies; (5) non-streaming AND streaming each surface a real numeric `usage.cost`.

### Claude's Discretion

- Exact hash function for `session_id` (e.g., a short stable digest of `account.id`) — only stability + determinism matters.
- File layout under `packages/providers/src/providers/openrouter-anthropic/` (provider.ts, index.ts, `__tests__/`) — mirror existing `openrouter/` and `anthropic-compatible/` conventions.
- Which cost methods are shared vs. copied — port the minimum needed; do NOT extend `OpenRouterProvider`.

### Deferred Ideas (OUT OF SCOPE)

- `session_id` probe-without-include — Phase 12.
- Test model availability on `/api/v1/messages` (`z-ai/glm-4.5-air:free`) — irrelevant to Phase 9 (mocked fetch); resolve at Phase 12.
- `openrouter_metadata` debug logging (OBS-01) — Phase 10.
- `ANTHROPIC_SHAPE_PROVIDERS` / failover (FAIL-01) — Phase 10.
- Per-request provider selection via `x-better-ccflare-openrouter-provider` header — Future (ROUTE-F1).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROV-01 | Route CC requests to `https://openrouter.ai/api/v1/messages` with `Authorization: Bearer` auth | `buildUrl()` verbatim copy (D-00b); constructor config verified |
| PROV-02 | Verbatim passthrough — no Anthropic→OpenAI transformation, no `cache_control` injection | Extend `AnthropicCompatibleProvider` (D-00a); `transformRequestBody` with zero injection (D-00c) |
| PROV-03 | New provider coexists with existing `openrouter` — behavior unchanged | New directory, no edits to `openrouter/provider.ts`; Phase 9 scope-isolated |
| CACHE-01 | Native `cache_control` blocks pass through unchanged | 4-block passthrough test (D-05 SC#2); zero-injection override |
| ROUTE-01 | `openrouter_provider_preference` injects `body.provider = { order, allow_fallbacks }` | Provider-pref injection block copied from `openrouter/provider.ts:194–208` (D-00e) |
| ROUTE-02 | Stable `session_id` injection routes all turns to same backend | Stable hash of `account.id` injected in `transformRequestBody` (D-01, D-02) |
| COST-01 | Real `usage.cost` from non-streaming responses persists to `requests.cost_usd` | `extractUsageInfo` calls super + attaches `usage.cost` with `typeof` guard (D-00d) |
| COST-02 | Real `usage.cost` from final streaming SSE `message_delta` persists to `requests.cost_usd` | `extractStreamingUsage` + `readFinalSseCost` ported from `OpenRouterProvider` (D-00d) |
| FAIL-01 | DISCREPANCY — see section below | Deferred to Phase 10 per CONTEXT.md; ROADMAP.md lists it for Phase 9 |
</phase_requirements>

---

## FAIL-01 Discrepancy — Planner Decision Required

**The discrepancy:** `REQUIREMENTS.md` Traceability table maps FAIL-01 to Phase 10. `CONTEXT.md` explicitly defers FAIL-01 to Phase 10 (line 105: "FAIL-01 moved to Phase 10 — it lives in `sse-rate-limit-sniffer.ts`, a separate file from the provider class"). However, the ROADMAP.md Phase 9 `Requirements` field includes `FAIL-01` in its list.

**Analysis:** FAIL-01 (`ANTHROPIC_SHAPE_PROVIDERS` extension in `sse-rate-limit-sniffer.ts`) is a one-line edit to a file that is not the provider class and has no unit-test dependency on the Phase 9 class. It cannot be tested in isolation before the type wiring exists (Phase 10 adds the mode string to the registry). Including it in Phase 9 is logically correct if the sniffer test runs with a raw string literal — but it couples two orthogonal concerns and contradicts the phase boundary definition.

**Recommendation:** Defer to Phase 10. The CONTEXT.md decision is the most recent artifact (gathered 2026-06-02 after explicit discussion) and takes precedence over the ROADMAP.md field which was populated before the discuss-phase. Planner should update the ROADMAP.md Phase 9 requirements list to remove FAIL-01.

---

## Summary

Phase 9 is a pure provider-class implementation phase. No new npm packages are needed. No DB migrations. No existing files are modified. The work is entirely additive: one new directory `packages/providers/src/providers/openrouter-anthropic/` containing `provider.ts`, `index.ts`, and `__tests__/provider.test.ts`.

The implementation is heavily constrained by locked decisions — every method override has a canonical source to copy from. `buildUrl` is copied verbatim from `openrouter/provider.ts:57–69`. The three cost methods (`parseUsage`, `extractStreamingUsage`, `readFinalSseCost`) are copied verbatim from `openrouter/provider.ts:301–435` with minimal renaming. The provider-preference injection block is copied verbatim from `openrouter/provider.ts:193–208`. The only genuinely new logic is: (1) the `session_id` stable hash derivation, (2) `usage:{include:true}` injection, and (3) `extractUsageInfo` calling `super` (Anthropic-native cache fields) then attaching `usage.cost` — contrasted with `OpenRouterProvider.extractUsageInfo` which reads OAI-format `prompt_tokens_details`.

The test file mirrors `openrouter/__tests__/provider.test.ts` in structure (describe blocks, inline `makeStreamingResponse` helper, `bun:test` imports). Five test domains map directly to the five success criteria.

**Primary recommendation:** Implement and test in TDD order — write tests for each SC first, run to confirm RED, implement the override to make GREEN. Complete all five SCs before writing barrel/index exports. Run `bun run lint && bun run typecheck && bun run format` at phase end.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| URL construction / endpoint routing | Provider class | — | `buildUrl()` override lives on the provider; no proxy-layer involvement |
| Auth header injection | Provider class (`prepareHeaders` via base) | — | `authHeader: "authorization"`, `authType: "bearer"` set in constructor; base handles the rest |
| `cache_control` passthrough | Provider class (`transformRequestBody` no-op) | — | New class does NOT call any injection helper; zero-injection is the override |
| Provider-preference injection | Provider class (`transformRequestBody`) | — | Same layer as v1.1 `openrouter`; body mutation in `transformRequestBody` |
| `session_id` injection | Provider class (`transformRequestBody`) | — | FORK PATCH in `transformRequestBody`; stable hash derived from `account.id` |
| `usage:{include:true}` injection | Provider class (`transformRequestBody`) | — | FORK PATCH; body mutation in same override |
| Non-streaming cost extraction | Provider class (`extractUsageInfo`) | Base class (token counts) | Override calls `super` for Anthropic-native token fields, then reads `usage.cost` |
| Streaming cost extraction | Provider class (`extractStreamingUsage`, `readFinalSseCost`, `parseUsage`) | Base class (token counts) | Ported from `OpenRouterProvider`; reads `usage.cost` from final SSE `message_delta` |

---

## Standard Stack

### Core

No new npm packages. Phase 9 uses only dependencies already present in the workspace.

| Dependency | Source | Purpose |
|------------|--------|---------|
| `bun:test` | Bun built-in | Unit test runner — `describe`, `it`, `expect` |
| `@better-ccflare/logger` | Internal package | `Logger` class for `log.warn` in cost methods |
| `@better-ccflare/types` | Internal package | `Account` type (used in method signatures) |
| `@better-ccflare/core` | Internal package | `BUFFER_SIZES.ANTHROPIC_STREAM_CAP_BYTES` (used in `readFinalSseCost`) |
| `crypto.subtle.digest` | Web Crypto API (Bun built-in) | SHA-256 hash for stable `session_id` derivation |

### Package Legitimacy Audit

> No external packages are installed in Phase 9. All dependencies are either Bun built-ins or existing workspace packages. Slopcheck protocol: N/A.

---

## Architecture Patterns

### Recommended Project Structure

```
packages/providers/src/providers/openrouter-anthropic/
├── provider.ts          # OpenRouterAnthropicProvider class
├── index.ts             # Re-export barrel (export { OpenRouterAnthropicProvider })
└── __tests__/
    └── provider.test.ts # bun:test unit tests
```

Mirrors the layout of `openrouter/` which has the same three-file structure. [VERIFIED: direct codebase inspection — `packages/providers/src/providers/openrouter/` has `provider.ts`, `index.ts`, `__tests__/provider.test.ts`]

### Pattern 1: Constructor Config

**What:** Pass the provider config object to `super()` to set name, baseUrl, authHeader, authType, supportsStreaming.

**Source:** `packages/providers/src/providers/openrouter/provider.ts:43–51` [VERIFIED: direct read]

```typescript
// Source: openrouter/provider.ts:43–51
export class OpenRouterAnthropicProvider extends AnthropicCompatibleProvider {
    constructor() {
        super({
            name: "openrouter-anthropic",
            baseUrl: "https://openrouter.ai/api/v1",
            authHeader: "authorization",
            authType: "bearer",
            supportsStreaming: true,
        });
    }
```

### Pattern 2: buildUrl — Verbatim Copy (D-00b)

**What:** Copy `OpenRouterProvider.buildUrl()` verbatim. The base `AnthropicCompatibleProvider.buildUrl()` deduplication checks if `pathname.startsWith(basePath)` where `basePath = "/api/v1"`. The incoming pathname `/v1/messages` does NOT start with `/api/v1`, so deduplication does not fire and the result is `https://openrouter.ai/api/v1/v1/messages` (404). The override strips the leading `/v1` from pathname before concatenating.

**Source:** `packages/providers/src/providers/openrouter/provider.ts:57–69` [VERIFIED: direct read]

```typescript
// Source: openrouter/provider.ts:57–69 — copy verbatim
override buildUrl(
    pathname: string,
    search: string,
    account?: Account,
): string {
    const baseUrl = (
        account?.custom_endpoint || "https://openrouter.ai/api/v1"
    ).replace(/\/$/, "");
    // Strip /v1 prefix since baseUrl already contains /api/v1
    const cleanPathname = pathname.startsWith("/v1")
        ? pathname.slice(3)
        : pathname;
    return `${baseUrl}${cleanPathname}${search}`;
}
```

**Critical unit test:** `provider.buildUrl("/v1/messages", "")` must return exactly `"https://openrouter.ai/api/v1/messages"` (no double-segment).

### Pattern 3: transformRequestBody — Four Layered Injections

**What:** Single override that (1) calls `super` for model mapping, (2) injects `body.provider` from `openrouter_provider_preference` (D-00e), (3) injects `body.session_id` (D-02), (4) injects `body.usage = { include: true }` (D-03). All three injections are "inject only when client omits" and annotated `// FORK PATCH:`. Zero `cache_control` injection — the `// FORK PATCH:` annotation should explicitly note this.

**Source for provider-preference injection block:** `openrouter/provider.ts:193–208` [VERIFIED: direct read]

```typescript
// Source: openrouter/provider.ts:193–208 (provider-preference block to copy verbatim)
// FORK PATCH: inject provider preference from account settings (ROUTE-01)
if (account?.openrouter_provider_preference && !("provider" in body)) {
    try {
        const pref = JSON.parse(account.openrouter_provider_preference);
        if (Array.isArray(pref.order) && pref.order.length > 0) {
            body.provider = {
                order: pref.order,
                allow_fallbacks: pref.allow_fallbacks ?? true,
            };
        }
    } catch {
        log.warn(
            "Failed to parse openrouter_provider_preference; skipping provider injection",
        );
    }
}
```

**Key guard — use `!("provider" in body)` not `!body.provider`:** An empty object `{}` is falsy, but is a valid OpenRouter `provider` field. The `"provider" in body` guard preserves `body.provider = {}`. [VERIFIED: direct read of `openrouter/provider.ts:194`]

**session_id derivation (D-01, Claude's discretion):** Use `crypto.subtle.digest("SHA-256", ...)` on the UTF-8 bytes of `account.id`, take the first 16 hex bytes (32 chars). This is a stable, deterministic, URL-safe string. The existing codebase uses `crypto.subtle.digest("SHA-256", ...)` in `packages/providers/src/oauth/pkce.ts:46` — same Web Crypto API pattern, no new imports needed. [VERIFIED: direct read of `pkce.ts:46`]

```typescript
// FORK PATCH: session_id injection — stable per-account hash (ROUTE-02 / D-01)
// session_id is a stable SHA-256 digest of account.id, hex-encoded (first 16 bytes = 32 chars).
// This routes all turns of any CC session on this account to the same OpenRouter backend,
// maximising prompt-cache hit rate from request 1.
if (account?.id && !("session_id" in body)) {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(account.id),
    );
    const hex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    body.session_id = hex.slice(0, 32);
}

// FORK PATCH: usage:{include:true} guarantees cost appears in OpenRouter response (D-03)
if (!("usage" in body)) {
    body.usage = { include: true };
}
```

**Full transformRequestBody skeleton:**

```typescript
override async transformRequestBody(
    request: Request,
    account?: Account,
): Promise<Request> {
    // 1. Model mapping (upstream)
    const mapped = await super.transformRequestBody(request, account);

    try {
        const body = await mapped.clone().json();
        if (body && typeof body === "object") {
            // FORK PATCH: NO cache_control injection — native passthrough; Claude Code sends its own blocks.

            // FORK PATCH: provider-preference injection (ROUTE-01 / D-00e)
            if (account?.openrouter_provider_preference && !("provider" in body)) {
                try {
                    const pref = JSON.parse(account.openrouter_provider_preference);
                    if (Array.isArray(pref.order) && pref.order.length > 0) {
                        body.provider = {
                            order: pref.order,
                            allow_fallbacks: pref.allow_fallbacks ?? true,
                        };
                    }
                } catch {
                    log.warn("Failed to parse openrouter_provider_preference; skipping provider injection");
                }
            }

            // FORK PATCH: session_id injection (ROUTE-02 / D-01, D-02)
            if (account?.id && !("session_id" in body)) {
                const encoder = new TextEncoder();
                const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(account.id));
                const hex = Array.from(new Uint8Array(hashBuffer))
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("");
                body.session_id = hex.slice(0, 32);
            }

            // FORK PATCH: usage:{include:true} guarantees cost in OpenRouter response (D-03)
            if (!("usage" in body)) {
                body.usage = { include: true };
            }

            return new Request(mapped.url, {
                method: mapped.method,
                headers: mapped.headers,
                body: JSON.stringify(body),
            });
        }
    } catch (error) {
        log.debug("Failed to inject request fields:", error);
    }

    return mapped;
}
```

### Pattern 4: extractUsageInfo — super + attach cost

**What:** Do NOT copy `OpenRouterProvider.extractUsageInfo()`. That override reads OAI-format `usage.prompt_tokens_details.cache_write_tokens` / `cached_tokens` which do not exist on the native endpoint. Call `super.extractUsageInfo(response)` — the base `BaseAnthropicCompatibleProvider.extractUsageInfo()` correctly reads Anthropic-native `usage.cache_creation_input_tokens` and `usage.cache_read_input_tokens` from the non-streaming JSON. Then clone the response, parse JSON, and attach `usage.cost` with the `typeof` guard.

**Source for `typeof` guard pattern:** `openrouter/provider.ts:272–275` [VERIFIED: direct read]

```typescript
// Source: openrouter/provider.ts:272–275 — typeof guard pattern
const costUsd =
    typeof json.usage.cost === "number" ? json.usage.cost : undefined;
```

**Full extractUsageInfo:**

```typescript
override async extractUsageInfo(response: Response): Promise<{...} | null> {
    try {
        const clone = response.clone();
        const contentType = response.headers.get("content-type");

        // Streaming: delegate to parent (which calls extractStreamingUsage → our override)
        if (this.config.supportsStreaming && contentType?.includes("text/event-stream")) {
            return super.extractUsageInfo(response);
        }

        // Non-streaming: super reads Anthropic-native cache field names correctly.
        const base = await super.extractUsageInfo(clone);
        if (!base) return null;

        // Attach real cost — parse a fresh clone to read usage.cost.
        const costClone = response.clone();
        const json = await costClone.json();
        // FORK PATCH: attach OpenRouter real cost (D-00d); typeof guard rejects non-numeric (T-7-01)
        const costUsd =
            json?.usage && typeof json.usage.cost === "number"
                ? json.usage.cost
                : undefined;

        return { ...base, costUsd };
    } catch {
        return null;
    }
}
```

**Note:** The base class returns a non-null result with a `costUsd` derived from `estimateCostUSD()`. The spread `{ ...base, costUsd }` replaces the estimate with the real cost when present, and keeps the estimate when `costUsd` is `undefined`. This is the correct behavior — for this provider, real cost from the API is always preferable.

### Pattern 5: Cost Methods — Port Verbatim from OpenRouterProvider

**What:** Three methods are ported: `parseUsage` (public), `extractStreamingUsage` (protected override), `readFinalSseCost` (private). They are NOT inherited — they must be copied because extending `OpenRouterProvider` would drag in the 4-breakpoint `cache_control` injector and OAI-format `extractUsageInfo` override.

**Source lines in `openrouter/provider.ts`:** [VERIFIED: direct read]

| Method | Lines | Notes |
|--------|-------|-------|
| `parseUsage` (public) | 301–325 | Routing method: delegates streaming to `extractStreamingUsage`, non-streaming to `extractUsageInfo` |
| `extractStreamingUsage` (protected override) | 331–369 | Clones before calling `super`, reads `readFinalSseCost`, applies `typeof` guard |
| `readFinalSseCost` (private) | 373–435 | Reads entire SSE body with sliding tail window; finds final `message_delta` event; returns raw `usage.cost` value |

**Key implementation note for `extractStreamingUsage`:**
- Line 346: `const costClone = clone.clone()` — the clone is cloned BEFORE calling super because `super.extractStreamingUsage` consumes the body reader (single-use).
- Line 348: `const base = await super.extractStreamingUsage(clone, originalHeaders)` — super reads Anthropic-native token fields correctly.
- Lines 352–368: `readFinalSseCost(costClone)` reads `usage.cost` from the final `message_delta`; `typeof === "number"` guard; if absent, logs warn and returns `costUsd: undefined` (no estimate fallback for streaming). [VERIFIED: direct read of `openrouter/provider.ts:331–369`]

### Pattern 6: bun:test File Layout

**What:** Mirror `openrouter/__tests__/provider.test.ts` exactly — describe blocks per method group, inline `makeStreamingResponse` helper, import from `"../provider"` relative path.

**Source:** `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` [VERIFIED: direct read]

Key conventions observed:
- `import { describe, expect, it } from "bun:test"` — not `jest`
- Inline interface types for body shape assertions (no separate types file)
- `makeStreamingResponse(cost: unknown): Response` helper — builds SSE string with `event: message_start` + `event: message_delta` blocks
- `bun:test`'s `expect(x).toBe(0)` correctly distinguishes `0` from `undefined` — safe for cost=0 (free model) assertions
- `provider.extractUsageInfo(response)` is used to test streaming (it delegates to `extractStreamingUsage` internally for `text/event-stream` content-type)
- `provider.parseUsage(response)` is tested separately for the streaming branch routing

### Anti-Patterns to Avoid

- **Copying `OpenRouterProvider.extractUsageInfo()` for non-streaming:** It reads `prompt_tokens_details.cache_write_tokens` (OAI-format fields) — absent on the native endpoint. Cache tokens will always be 0. Use `super.extractUsageInfo()` instead.
- **Calling `super.extractUsageInfo()` for the streaming non-override path without re-reading `usage.cost`:** The base returns a cost from `estimateCostUSD()`, not from the real API cost. The override must replace it.
- **Extending `OpenRouterProvider` to inherit cost methods:** Drags in 4-breakpoint `cache_control` injector and OAI-format `extractUsageInfo`. Never do this.
- **Using `!body.provider` (falsy guard) instead of `!("provider" in body)`:** An empty object `{}` is falsy but is a valid OpenRouter `provider` field. Use the `in` operator.
- **Forgetting to clone before consuming:** `readFinalSseCost` consumes the body reader. In `extractStreamingUsage`, clone `clone` BEFORE passing to `super`.
- **Omitting `// FORK PATCH:` on new injections:** Required for upstream merge safety per CLAUDE.md.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| `buildUrl` double-segment fix | Custom path concatenation logic | Verbatim copy of `OpenRouterProvider.buildUrl()` (7 lines) | It already solves exactly this problem; re-inventing introduces new bugs |
| Streaming cost extraction | New SSE parser | Port `readFinalSseCost` from `OpenRouterProvider` (62 lines) | Already handles sliding tail window, multi-byte UTF-8 flush, `done` edge case |
| SHA-256 hash for `session_id` | Custom hash or UUID | `crypto.subtle.digest("SHA-256", ...)` | Web Crypto API is available in Bun; same pattern already used in `pkce.ts` |
| Anthropic-native cache field reading | New JSON field reader | `super.extractUsageInfo()` in `BaseAnthropicCompatibleProvider` | Already reads `cache_creation_input_tokens` / `cache_read_input_tokens` correctly |

---

## Code Examples

### Captured-Real Streaming Fixture (D-04)

The exact `usage` object from the empirical probe run on 2026-06-02 (`probe-streaming-cost.sh`, billed request to `deepseek/deepseek-v4-flash`). [VERIFIED: SUMMARY.md — empirical confirmation 2026-06-02]

```json
{
  "input_tokens": 7,
  "output_tokens": 32,
  "output_tokens_details": { "thinking_tokens": 32 },
  "cache_creation_input_tokens": null,
  "cache_read_input_tokens": 4,
  "server_tool_use": null,
  "service_tier": null,
  "speed": "standard",
  "cost": 0.0000070581,
  "is_byok": false,
  "cost_details": {
    "upstream_inference_cost": 0.0000070581,
    "upstream_inference_prompt_cost": 7.669e-7,
    "upstream_inference_completions_cost": 0.0000062912
  }
}
```

The `makeStreamingResponse` helper in the test file should include this shape for the streaming happy path test (SC#5). Key observations:
- `cache_read_input_tokens: 4` — non-zero; validates the cache field is read from the streaming `message_delta`
- `cache_creation_input_tokens: null` — the base class uses `|| 0` so `null` becomes 0; safe
- `cost: 0.0000070581` — the value asserted in the captured-real test case

### Synthetic Fixtures for Edge Cases (D-04)

```typescript
// Non-streaming with Anthropic-native cache fields + real cost (validates CACHE-01 + COST-01)
const nonStreamingFixture = {
    model: "anthropic/claude-sonnet-4-6",
    usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 80,
        cost: 0.002,
    },
};

// Streaming with null cost (typeof guard must reject null → costUsd: undefined)
// Streaming with string cost (typeof guard must reject string → costUsd: undefined)
// Non-streaming with absent cost (base estimate used — costUsd is from estimateCostUSD)
```

### bun:test File Structure to Mirror

```typescript
// Source: openrouter/__tests__/provider.test.ts
import { describe, expect, it } from "bun:test";
import { OpenRouterAnthropicProvider } from "../provider";

// Inline helper: builds SSE stream with configurable usage
function makeStreamingResponse(cost: unknown): Response { ... }

describe("OpenRouterAnthropicProvider.buildUrl", () => { ... });
describe("OpenRouterAnthropicProvider.transformRequestBody (cache passthrough)", () => { ... });
describe("OpenRouterAnthropicProvider.transformRequestBody (provider preference)", () => { ... });
describe("OpenRouterAnthropicProvider.transformRequestBody (session_id)", () => { ... });
describe("OpenRouterAnthropicProvider.transformRequestBody (usage injection)", () => { ... });
describe("OpenRouterAnthropicProvider.extractUsageInfo (non-streaming)", () => { ... });
describe("OpenRouterAnthropicProvider.extractStreamingUsage / parseUsage (streaming)", () => { ... });
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun built-in, no config file needed) |
| Config file | None — `bun:test` discovers `*.test.ts` files automatically |
| Quick run command | `bun test packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` |
| Full suite command | `bun test packages/providers/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-01 | `buildUrl("/v1/messages", "")` returns `"https://openrouter.ai/api/v1/messages"` | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| PROV-01 | `buildUrl` with custom endpoint uses that endpoint, still strips `/v1` | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| PROV-02 | 4-block request body exits `transformRequestBody` with exactly 4 blocks (SC#2) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| PROV-02 | 0-block request body exits with 0 blocks | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| ROUTE-01 | Account with `openrouter_provider_preference` → `body.provider` injected (SC#3) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| ROUTE-01 | Account without preference → no `provider` field added | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| ROUTE-01 | Client body with `provider` field → preserved, not overridden | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| ROUTE-01 | Corrupt JSON in `openrouter_provider_preference` → no throw, no injection | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| ROUTE-02 | `session_id` present in body after transform when client omits it (SC#4) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| ROUTE-02 | Same `account.id` produces identical `session_id` on two calls (stability) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| ROUTE-02 | Different `account.id` values produce different `session_id` values | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| ROUTE-02 | Client-supplied `session_id` is not overridden | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-01 | Non-streaming: `extractUsageInfo` returns `costUsd: 0.002` (numeric) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-01 | Non-streaming: `costUsd` is `undefined` when `usage.cost` is null | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-01 | Non-streaming: `costUsd` is `undefined` when `usage.cost` is a string | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-01 | Non-streaming: `cacheCreationInputTokens` and `cacheReadInputTokens` populated from Anthropic-native fields | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-02 | Streaming: captured-real fixture (`cost: 0.0000070581`) → `costUsd` matches (SC#5) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-02 | Streaming: `cost: 0` (free model) → `costUsd: 0` (not `undefined`) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-02 | Streaming: absent `cost` → `costUsd: undefined` (no estimate) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-02 | Streaming: `cost: null` → `costUsd: undefined` | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| COST-02 | Streaming: `cost: "0.001"` (string) → `costUsd: undefined` (typeof guard) | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| D-03 | `usage:{include:true}` injected when client body has no `usage` field | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |
| D-03 | `usage` field NOT overridden when client body already has `usage` | unit | `bun test .../provider.test.ts` | ❌ Wave 0 |

### Five Success Criteria → Test Coverage

| SC# | Success Criterion | Key Test Case(s) |
|-----|------------------|-----------------|
| SC#1 | `buildUrl` no double-segment + Bearer auth | `buildUrl("/v1/messages", "")` → exact URL; constructor config assertions |
| SC#2 | 4-block body → zero blocks added | Feed 4-block body; assert count before == count after |
| SC#3 | Provider pref present → injected; absent → no `provider` field | Two test cases per D-05 description |
| SC#4 | Stable `session_id` when client omits; not overridden when client supplies | Three cases: stability, different accounts produce different IDs, client-supplied preserved |
| SC#5 | Non-streaming AND streaming surface real numeric `usage.cost` | Captured-real streaming fixture + non-streaming fixture; cost=0 (free) + cost=null + cost=string |

### Sampling Rate

- **Per task commit:** `bun test packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts`
- **Per wave merge:** `bun test packages/providers/`
- **Phase gate:** Full suite + `bun run lint && bun run typecheck && bun run format` before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` — covers all requirements above
- [ ] `packages/providers/src/providers/openrouter-anthropic/provider.ts` — the provider class itself
- [ ] `packages/providers/src/providers/openrouter-anthropic/index.ts` — barrel export

*(No existing test infrastructure gaps — `bun:test` has no config file; test discovery is file-name based.)*

---

## Common Pitfalls

### Pitfall 1: buildUrl Double-Segment

**What goes wrong:** `AnthropicCompatibleProvider.buildUrl()` deduplication at `provider.ts:50–56` checks if `pathname.startsWith(basePath)` where `basePath = parsed.pathname = "/api/v1"`. The incoming pathname `/v1/messages` does NOT start with `/api/v1` — it starts with `/v1`. Deduplication does not fire. Final URL: `https://openrouter.ai/api/v1/v1/messages`. All requests 404.

**How to avoid:** Copy `buildUrl` verbatim from `openrouter/provider.ts:57–69`. Unit test asserts exact URL. [VERIFIED: direct read of both `buildUrl` implementations]

### Pitfall 2: Copying OpenRouterProvider.extractUsageInfo for Non-Streaming

**What goes wrong:** `OpenRouterProvider.extractUsageInfo()` reads `usage.prompt_tokens_details.cache_write_tokens` / `cached_tokens` (OAI-format). Native `/api/v1/messages` returns `usage.cache_creation_input_tokens` / `usage.cache_read_input_tokens` at the top level (Anthropic-native). Copying the OAI override → cache tokens always 0.

**How to avoid:** Call `super.extractUsageInfo(clone)` — the base `BaseAnthropicCompatibleProvider` reads the right field names. Then re-read `usage.cost` from a separate clone and attach. [VERIFIED: direct read of `base-anthropic-compatible.ts:284–287` confirms correct field names]

### Pitfall 3: Forgetting to Clone Before super in extractStreamingUsage

**What goes wrong:** Body reader is single-use. If you call `super.extractStreamingUsage(clone, ...)` first without saving a copy, `readFinalSseCost` receives a consumed body and returns `undefined` for every streaming response.

**How to avoid:** Clone first: `const costClone = clone.clone()` BEFORE `await super.extractStreamingUsage(clone, originalHeaders)`. [VERIFIED: direct read of `openrouter/provider.ts:346–348`]

### Pitfall 4: Falsy Guard on provider Field

**What goes wrong:** Using `!body.provider` skips injection when `body.provider = {}` (valid OpenRouter spec; empty object routes to any provider). Using `!("provider" in body)` correctly preserves the empty-object case.

**How to avoid:** Use `!("provider" in body)` — verbatim from the source. [VERIFIED: direct read of `openrouter/provider.ts:194`]

### Pitfall 5: FAIL-01 Scope Confusion

**What goes wrong:** Planner sees FAIL-01 in ROADMAP.md Phase 9 requirements and adds `sse-rate-limit-sniffer.ts` changes to Phase 9 plan. This file is not the provider class and cannot be meaningfully tested before type wiring (Phase 10).

**How to avoid:** See FAIL-01 Discrepancy section above. Defer to Phase 10. Update ROADMAP.md requirements list.

### Pitfall 6: session_id Returning Different Values for Same Account

**What goes wrong:** Using `crypto.randomUUID()` or `Date.now()` instead of a deterministic hash produces a different `session_id` per call. OpenRouter's sticky routing breaks — each request routes to a different backend.

**How to avoid:** Hash `account.id` deterministically with `crypto.subtle.digest("SHA-256", encoder.encode(account.id))`. Test asserts that two calls with the same `account.id` produce identical values.

### Pitfall 7: Not Annotating Fork Patches

**What goes wrong:** The three new injections (`provider`, `session_id`, `usage`) in `transformRequestBody` lack `// FORK PATCH:` comments. `pre-merge-check.sh` cannot surface them in future upstream merges. A merge that touches `transformRequestBody` upstream silently drops the injections.

**How to avoid:** Every new injection in the new file annotated `// FORK PATCH: <rationale> (<requirement ID>)`. The `openrouter-anthropic/` directory is fork-only — no upstream conflict risk — but the annotations still document intent. [VERIFIED: CLAUDE.md requirement; PITFALLS.md Pitfall 9]

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| `extractStreamingUsage` returns `costUsd: undefined` for streaming (earlier research draft) | Port `readFinalSseCost` from `OpenRouterProvider` — streaming surfaces real `usage.cost` | Empirically confirmed 2026-06-02: native endpoint DOES emit `cost` in final `message_delta` when `usage:{include:true}` is sent |
| Extend `OpenRouterProvider` to reuse cost methods | Copy cost methods to new class extending `AnthropicCompatibleProvider` | Avoids inheriting the 4-breakpoint cache injector |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `crypto.subtle.digest` is available synchronously in Bun >= 1.2.8 and can be used inside `transformRequestBody` (which is `async`) | Pattern 3 | If not available, `session_id` derivation fails silently; use the catch block to handle |
| A2 | The base class `estimateCostUSD()` result in `extractUsageInfo` is what `{ ...base, costUsd }` overwrites (i.e., `base.costUsd` is not `undefined` for known models) | Pattern 4 | If base already returns `costUsd: undefined` for this model, the spread is a no-op; real cost still attached when present |

---

## Open Questions

1. **FAIL-01 phase assignment**
   - What we know: CONTEXT.md says Phase 10; ROADMAP.md says Phase 9.
   - Recommendation: Planner updates ROADMAP.md requirements list to remove FAIL-01 from Phase 9; confirmed deferred to Phase 10.

2. **`super.extractUsageInfo` returns non-null with an estimate for known models**
   - What we know: `BaseAnthropicCompatibleProvider.extractUsageInfo` calls `estimateCostUSD(model, ...)` and returns `costUsd` from the estimate if `model` is known.
   - What this means: For `openrouter-anthropic`, the `{ ...base, costUsd }` spread in the override replaces the estimate with the real cost when `usage.cost` is a number. When `usage.cost` is absent/null, `costUsd` is `undefined`, which means the base estimate is DROPPED (not preserved). This is correct per D-00d ("no estimate fallback for streaming") but the non-streaming path also drops the estimate if `usage.cost` is absent. This is the intended behavior — OpenRouter real cost is authoritative for this provider.
   - What's unclear: Whether this is intentional for non-streaming (base estimate is dropped if OpenRouter returns `cost: null`).
   - Recommendation: Document explicitly in a `// FORK PATCH:` comment. For non-streaming, `cost: null` from OpenRouter means "cost not yet known" — returning `undefined` is correct; the DB COALESCE handles it.

---

## Environment Availability

Phase 9 is code-only (new provider class + tests). No external services or CLI tools beyond Bun and the existing workspace.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Test runner | ✓ | >= 1.2.8 (repo requirement) | — |
| `bun:test` | Unit tests | ✓ | Built-in | — |
| `crypto.subtle` | SHA-256 for session_id | ✓ | Web Crypto API, Bun built-in | — |

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 9 class uses base class token auth unchanged |
| V3 Session Management | No | `session_id` is for OpenRouter sticky routing, not auth; no session secrets |
| V4 Access Control | No | Provider class is not an auth boundary |
| V5 Input Validation | Yes | `typeof json.usage.cost === "number"` guard (T-7-01 tampering mitigation); `"provider" in body` guard prevents accidental override |
| V6 Cryptography | Yes (minor) | SHA-256 used for `session_id` derivation; not a secret — deterministic hash of account.id. No secret material stored in `session_id`. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Type confusion on `usage.cost` (string injected by upstream) | Tampering | `typeof === "number"` guard — verified pattern from v1.2 |
| Client-supplied `provider` or `session_id` overridden by proxy | Tampering | `"provider" in body` / `"session_id" in body` guards — "inject only when absent" |

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 9 |
|-----------|------------------|
| NEVER curl the Anthropic endpoint | All Phase 9 tests use mocked `fetch` / `new Response(...)` — no live network calls |
| NEVER edit auto-generated files (`inline-worker.ts` etc.) | Phase 9 creates new files only; no existing files modified |
| `// FORK PATCH:` annotations on fork-specific additions | Required on all three body mutations in `transformRequestBody` and the cost methods |
| `bun run lint && bun run typecheck && bun run format` after code changes | Phase gate check before marking Phase 9 done |
| TDD: write tests first, then implement | Phase 9 work order: write test suite first (RED), then implement (GREEN) |
| File naming: `kebab-case.ts`, tests `*.test.ts` | `provider.test.ts` in `__tests__/` — confirmed correct naming |
| Imports: cross-package via `@better-ccflare/*` | `import { Logger } from "@better-ccflare/logger"` etc. — no relative `../../` across packages |
| Named exports only (no `export default`) | `export class OpenRouterAnthropicProvider` in `provider.ts`; `export { OpenRouterAnthropicProvider }` in `index.ts` |
| DB migrations: both SQLite and PostgreSQL | N/A — Phase 9 adds no DB columns |
| Comments: JSDoc on public/non-obvious exports | Add JSDoc to `parseUsage` and `buildUrl` as they are public and non-obvious |

---

## Sources

### Primary (HIGH confidence)

- `packages/providers/src/providers/openrouter/provider.ts` — direct read; source of `buildUrl` (lines 57–69), provider-preference injection (lines 193–208), `extractUsageInfo` `typeof` guard (lines 272–275), `parseUsage` (lines 301–325), `extractStreamingUsage` (lines 331–369), `readFinalSseCost` (lines 373–435)
- `packages/providers/src/providers/anthropic-compatible/provider.ts` — direct read; parent class `buildUrl` dedup logic (lines 44–58)
- `packages/providers/src/providers/base-anthropic-compatible.ts` — direct read; `extractUsageInfo` Anthropic-native field reads (lines 284–287), `extractStreamingUsage` base implementation (lines 331–578)
- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — direct read; complete bun:test harness patterns to mirror
- `packages/providers/src/oauth/pkce.ts` — direct read; `crypto.subtle.digest("SHA-256", ...)` pattern (line 46)
- `.planning/phases/09-provider-class-unit-tests/09-CONTEXT.md` — locked decisions D-00a through D-05
- `.planning/research/SUMMARY.md` — empirical probe confirmation (2026-06-02); captured-real `usage` object
- `.planning/research/PITFALLS.md` — 11 grounded pitfalls with line numbers
- `.planning/research/ARCHITECTURE.md` — directory structure, method override table, type chain
- `.planning/REQUIREMENTS.md` — FAIL-01 Traceability table (Phase 10 assignment)
- `.planning/ROADMAP.md` — Phase 9 success criteria definitions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all dependencies verified in codebase
- Architecture: HIGH — all method implementations grounded in specific source line reads
- Pitfalls: HIGH — all pitfalls verified with direct code reads and confirmed failure modes
- Test map: HIGH — directly derived from locked decisions D-04/D-05 and success criteria

**Research date:** 2026-06-02
**Valid until:** 2026-07-02 (stable codebase; no fast-moving external dependencies)
