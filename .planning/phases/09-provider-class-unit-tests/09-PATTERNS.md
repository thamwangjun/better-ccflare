# Phase 9: Provider Class + Unit Tests — Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 3
**Analogs found:** 3 / 3

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/providers/src/providers/openrouter-anthropic/provider.ts` | provider/service | request-response, streaming | `packages/providers/src/providers/openrouter/provider.ts` | exact (same parent class, same endpoint, same cost method set) |
| `packages/providers/src/providers/openrouter-anthropic/index.ts` | barrel export | — | `packages/providers/src/providers/openrouter/index.ts` | exact (one-line re-export) |
| `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` | test | request-response, streaming | `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | exact (same bun:test structure, same mock-Response pattern) |

---

## Pattern Assignments

### `packages/providers/src/providers/openrouter-anthropic/provider.ts`

**Analog:** `packages/providers/src/providers/openrouter/provider.ts`
**Parent class:** `packages/providers/src/providers/anthropic-compatible/provider.ts` (which extends `BaseAnthropicCompatibleProvider`)

---

#### Imports pattern (analog lines 1–8)

```typescript
import { BUFFER_SIZES } from "@better-ccflare/core";
import { Logger } from "@better-ccflare/logger";
import type { Account } from "@better-ccflare/types";
import { AnthropicCompatibleProvider } from "../anthropic-compatible/provider";
```

**Notes:**
- Cross-package imports use `@better-ccflare/*` workspace aliases — never relative `../../` across packages.
- `BUFFER_SIZES` is required by `readFinalSseCost` (sliding tail window cap).
- The `AnthropicCompatibleProvider` import is via relative path because it is in the same `providers/src/providers/` subtree.

---

#### Constructor / class declaration pattern (analog lines 42–51)

```typescript
const OPENROUTER_ANTHROPIC_DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";

const log = new Logger("OpenRouterAnthropicProvider");

export class OpenRouterAnthropicProvider extends AnthropicCompatibleProvider {
    constructor() {
        super({
            name: "openrouter-anthropic",
            baseUrl: OPENROUTER_ANTHROPIC_DEFAULT_ENDPOINT,
            authHeader: "authorization",
            authType: "bearer",
            supportsStreaming: true,
        });
    }
```

**Notes:**
- Module-level constant for endpoint (same pattern as `OPENROUTER_DEFAULT_ENDPOINT` in analog).
- Module-level `log` instance used across all methods.
- `name` string `"openrouter-anthropic"` must match the registry key added in Phase 10.

---

#### buildUrl — verbatim copy (analog lines 57–70)

```typescript
override buildUrl(
    pathname: string,
    search: string,
    account?: Account,
): string {
    const baseUrl = (
        account?.custom_endpoint || OPENROUTER_ANTHROPIC_DEFAULT_ENDPOINT
    ).replace(/\/$/, "");
    // Strip /v1 prefix since baseUrl already contains /api/v1
    const cleanPathname = pathname.startsWith("/v1")
        ? pathname.slice(3)
        : pathname;
    return `${baseUrl}${cleanPathname}${search}`;
}
```

**Critical:** `AnthropicCompatibleProvider.buildUrl()` (lines 40–59) deduplicates by checking `pathname.startsWith(basePath)` where `basePath = "/api/v1"`. The CC path `/v1/messages` does NOT start with `/api/v1`, so deduplication does not fire and you get `https://openrouter.ai/api/v1/v1/messages` (404). This override strips the `/v1` prefix before concatenation. Copy verbatim; swap only the endpoint constant name.

---

#### transformRequestBody — four-injection override pattern

**Provider-preference injection source** (analog lines 193–208):

```typescript
// FORK PATCH: inject provider preference from account settings (PROV-01)
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

**Guard:** Use `!("provider" in body)`, NOT `!body.provider`. An empty object `{}` is falsy but is a valid OpenRouter `provider` field; `in` operator preserves it.

**New Request construction** (analog lines 210–214):

```typescript
return new Request(mapped.url, {
    method: mapped.method,
    headers: mapped.headers,
    body: JSON.stringify(body),
});
```

**Full method skeleton** (new logic; no analog — see RESEARCH.md Pattern 3):

```typescript
// FORK PATCH: 3 new body injections (provider preference, session_id, usage:{include:true})
override async transformRequestBody(
    request: Request,
    account?: Account,
): Promise<Request> {
    // 1. Model mapping from parent (upstream behaviour preserved)
    const mapped = await super.transformRequestBody(request, account);

    try {
        const body = await mapped.clone().json();
        if (body && typeof body === "object") {
            // FORK PATCH: NO cache_control injection — native passthrough;
            //   Claude Code sends its own blocks. (CACHE-01 / D-00c)

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
                    log.warn(
                        "Failed to parse openrouter_provider_preference; skipping provider injection",
                    );
                }
            }

            // FORK PATCH: session_id injection — stable per-account SHA-256 hash (ROUTE-02 / D-01, D-02)
            // Routes all turns of any CC session on this account to the same OpenRouter backend,
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

**`crypto.subtle.digest` pattern source:** `packages/providers/src/oauth/pkce.ts` line 46 — same Web Crypto API, same Bun runtime. No new imports needed; `crypto` is a global.

---

#### extractUsageInfo — super + attach cost (new override; do NOT copy from OpenRouterProvider)

**typeof guard pattern source** (analog lines 272–275):

```typescript
// COST-01: OpenRouter returns actual USD cost in usage.cost (Optional + Nullable).
// typeof guard rejects string/non-numeric values (T-7-01 tampering mitigation).
const costUsd =
    typeof json.usage.cost === "number" ? json.usage.cost : undefined;
```

**Critical difference from analog:** Do NOT copy `OpenRouterProvider.extractUsageInfo()` for the non-streaming path. The analog (lines 256–293) reads `usage.prompt_tokens_details.cache_write_tokens` / `cached_tokens` (OpenAI-format fields absent on the native `/api/v1/messages` endpoint). Instead, call `super.extractUsageInfo(clone)` — `BaseAnthropicCompatibleProvider.extractUsageInfo()` (lines 256–330 of `base-anthropic-compatible.ts`) reads `usage.cache_creation_input_tokens` / `usage.cache_read_input_tokens` (Anthropic-native).

**Full override** (new logic; see RESEARCH.md Pattern 4):

```typescript
// FORK PATCH: call super for Anthropic-native cache fields; attach OpenRouter real cost (D-00d)
override async extractUsageInfo(response: Response): Promise<{
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    inputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    outputTokens?: number;
} | null> {
    try {
        const contentType = response.headers.get("content-type");

        // Streaming: base delegates to extractStreamingUsage (our override below)
        if (this.config.supportsStreaming && contentType?.includes("text/event-stream")) {
            return super.extractUsageInfo(response);
        }

        // Non-streaming: super reads Anthropic-native cache field names correctly.
        const base = await super.extractUsageInfo(response.clone());
        if (!base) return null;

        // Attach real cost — read usage.cost from a fresh clone.
        const json = await response.clone().json();
        // FORK PATCH: typeof guard rejects non-numeric cost (T-7-01); undefined drops the estimate (D-00d)
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

---

#### parseUsage (ported verbatim from analog lines 301–325)

```typescript
// COST-02: public parseUsage routes streaming branch to real-cost extraction
async parseUsage(response: Response): Promise<{...} | null> {
    const contentType = response.headers.get("content-type");

    // Streaming path: delegate to extractStreamingUsage for the real usage.cost.
    if (this.config.supportsStreaming && contentType?.includes("text/event-stream")) {
        return this.extractStreamingUsage(response.clone(), response.headers);
    }

    // Non-streaming path: delegate to extractUsageInfo unchanged.
    return this.extractUsageInfo(response);
}
```

---

#### extractStreamingUsage (ported verbatim from analog lines 331–369)

```typescript
// FORK PATCH: streaming override reads usage.cost from final SSE message_delta (COST-02 / D-00d)
protected override async extractStreamingUsage(
    clone: Response,
    originalHeaders: Headers,
): Promise<{...} | null> {
    // Clone BEFORE delegating: super consumes the body reader (single-use body). (Pitfall 3)
    const costClone = clone.clone();

    const base = await super.extractStreamingUsage(clone, originalHeaders);
    if (!base) return base;

    try {
        const realCost = await this.readFinalSseCost(costClone);
        // typeof guard rejects string/non-numeric values (T-7-01 tampering mitigation).
        if (typeof realCost === "number") {
            return { ...base, costUsd: realCost };
        }
        // No real provider cost: OpenRouter cost is authoritative; do not surface base estimate.
        log.warn(
            `Streaming OpenRouter-Anthropic response yielded no usage.cost; recording no provider cost (model=${base.model ?? "unknown"})`,
        );
        return { ...base, costUsd: undefined };
    } catch {
        return base;
    }
}
```

---

#### readFinalSseCost (ported verbatim from analog lines 373–435)

Copy lines 373–435 of `packages/providers/src/providers/openrouter/provider.ts` verbatim. Change `private` access modifier stays `private`. No renaming needed — method is not inherited, only called from `extractStreamingUsage` on the same class.

Key implementation notes verified at analog lines 382–435:
- Uses `BUFFER_SIZES.ANTHROPIC_STREAM_CAP_BYTES` for sliding tail window.
- `decoder.decode()` call at line 398 flushes multi-byte UTF-8 sequence.
- Finds the LAST `message_delta` event (iterates forward, `lastCost` overwrites on each hit).
- Returns `unknown` — caller (`extractStreamingUsage`) applies `typeof === "number"` guard.

---

### `packages/providers/src/providers/openrouter-anthropic/index.ts`

**Analog:** `packages/providers/src/providers/openrouter/index.ts` (line 1)

```typescript
export { OpenRouterAnthropicProvider } from "./provider";
```

Named export only (no `export default` per CLAUDE.md conventions).

---

### `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts`

**Analog:** `packages/providers/src/providers/openrouter/__tests__/provider.test.ts`

---

#### Imports pattern (analog lines 1–2)

```typescript
import { describe, expect, it } from "bun:test";
import { OpenRouterAnthropicProvider } from "../provider";
```

**Note:** `bun:test`, not `jest`. Import is from `"../provider"` (relative; provider.ts is one directory up from `__tests__/`).

---

#### Inline type declarations pattern (analog lines 4–27)

Declare inline `interface` types for body shape assertions — no separate types file:

```typescript
interface TestMessage {
    role: string;
    content: string | TestContentBlock[];
    cache_control?: TestCacheControl;
}
// ... etc.
```

Use for type-safe `result.messages.find(...)` calls in test assertions.

For the new test file, the relevant inline types are for `provider` field shape and `session_id` field (both plain `string` or `object` — no extra interfaces needed beyond what `JSON.parse` gives).

---

#### makeStreamingResponse helper pattern (analog lines 227–255)

```typescript
// Build a minimal Anthropic-style SSE body whose final message_delta carries usage.cost.
function makeStreamingResponse(cost: unknown): Response {
    const deltaUsage: Record<string, unknown> = {
        input_tokens: 100,
        output_tokens: 10,
        cache_read_input_tokens: 0,
    };
    // Only attach cost when explicitly provided (undefined → omit the key entirely)
    if (cost !== undefined) {
        deltaUsage.cost = cost;
    }
    const sse =
        `event: message_start\n` +
        `data: ${JSON.stringify({
            message: {
                model: "anthropic/claude-sonnet-4-6",
                usage: {
                    input_tokens: 100,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            },
        })}\n\n` +
        `event: message_delta\n` +
        `data: ${JSON.stringify({ usage: deltaUsage })}\n\n`;
    return new Response(sse, {
        headers: { "content-type": "text/event-stream" },
    });
}
```

**For the captured-real streaming fixture (D-04):** Override `deltaUsage` to use the exact probe shape:

```typescript
function makeCapturedRealStreamingResponse(): Response {
    const deltaUsage = {
        input_tokens: 7,
        output_tokens: 32,
        output_tokens_details: { thinking_tokens: 32 },
        cache_creation_input_tokens: null,
        cache_read_input_tokens: 4,
        server_tool_use: null,
        service_tier: null,
        speed: "standard",
        cost: 0.0000070581,
        is_byok: false,
        cost_details: {
            upstream_inference_cost: 0.0000070581,
            upstream_inference_prompt_cost: 7.669e-7,
            upstream_inference_completions_cost: 0.0000062912,
        },
    };
    // ... same SSE wrapper as makeStreamingResponse
}
```

---

#### describe block structure (analog lines 33–854)

```typescript
// Section divider comments use ─────... dashes (copy the style from the analog)
describe("OpenRouterAnthropicProvider.buildUrl", () => { ... });
describe("OpenRouterAnthropicProvider.transformRequestBody (cache passthrough)", () => { ... });
describe("OpenRouterAnthropicProvider.transformRequestBody (provider preference)", () => { ... });
describe("OpenRouterAnthropicProvider.transformRequestBody (session_id)", () => { ... });
describe("OpenRouterAnthropicProvider.transformRequestBody (usage injection)", () => { ... });
describe("OpenRouterAnthropicProvider.extractUsageInfo (non-streaming)", () => { ... });
describe("OpenRouterAnthropicProvider.extractStreamingUsage / parseUsage (streaming)", () => { ... });
```

---

#### Non-streaming mock-Response pattern (analog lines 48–51, 104–106)

```typescript
const response = new Response(JSON.stringify(responseBody), {
    headers: { "content-type": "application/json" },
});
const usage = await provider.extractUsageInfo(response);
```

---

#### transformRequestBody test invocation pattern (analog lines 354–361)

```typescript
const request = new Request("https://openrouter.ai/api/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
});
const transformed = await provider.transformRequestBody(request, account);
const result = await transformed.json();
```

For tests that need an `account`, pass a typed-as-any cast:

```typescript
const account = {
    id: "test-account-id",
    openrouter_provider_preference: JSON.stringify({ order: ["anthropic"], allow_fallbacks: true }),
} as any;
```

---

#### extractStreamingUsage / parseUsage test pattern (analog lines 258–298, 305–338)

```typescript
// Via extractUsageInfo (delegates to extractStreamingUsage for text/event-stream)
const usage = await provider.extractUsageInfo(makeStreamingResponse(0.0034));
expect(usage?.costUsd).toBe(0.0034);

// Via parseUsage (explicit streaming routing test)
const usage2 = await provider.parseUsage(makeStreamingResponse(0.0034));
expect(usage2?.costUsd).toBe(0.0034);
```

`expect(x).toBe(0)` correctly distinguishes `0` from `undefined` in bun:test — safe for free-model (`cost: 0`) assertions.

---

## Shared Patterns

### FORK PATCH annotation (applies to all new injections)

**Source:** CLAUDE.md Conventions, confirmed in `openrouter/provider.ts` lines 10, 72, 193, 223
**Apply to:** Every fork-specific addition in `provider.ts`

```typescript
// FORK PATCH: <rationale> (<requirement-ID> / <decision-ID>)
```

Every injection block (`provider`, `session_id`, `usage`) and the ported cost methods must carry this annotation. The `openrouter-anthropic/` directory is fork-only so there is no upstream conflict risk, but the annotations document intent and surface to `pre-merge-check.sh`.

---

### Named exports only

**Source:** CLAUDE.md Conventions
**Apply to:** `provider.ts` and `index.ts`

```typescript
// provider.ts
export class OpenRouterAnthropicProvider ...

// index.ts
export { OpenRouterAnthropicProvider } from "./provider";
```

No `export default`.

---

### Logger usage

**Source:** `packages/providers/src/providers/openrouter/provider.ts` line 8
**Apply to:** `provider.ts`

```typescript
const log = new Logger("OpenRouterAnthropicProvider");
```

Module-level constant. Use `log.warn(...)` / `log.debug(...)` — not `console.*`.

---

### Request cloning before body consumption

**Source:** `packages/providers/src/providers/openrouter/provider.ts` lines 346–348
**Apply to:** `extractStreamingUsage` in `provider.ts`

Clone `clone` BEFORE calling `super.extractStreamingUsage(clone, ...)` — `super` consumes the body reader (single-use). Order must be:

```typescript
const costClone = clone.clone();           // 1. save a copy
const base = await super.extractStreamingUsage(clone, originalHeaders);  // 2. super consumes clone
const realCost = await this.readFinalSseCost(costClone);                 // 3. costClone still readable
```

---

## No Analog Found

All three files have close analogs. No entries in this section.

---

## Metadata

**Analog search scope:** `packages/providers/src/providers/openrouter/`, `packages/providers/src/providers/anthropic-compatible/`, `packages/providers/src/providers/base-anthropic-compatible.ts`
**Files scanned:** 4 (openrouter/provider.ts, openrouter/__tests__/provider.test.ts, openrouter/index.ts, anthropic-compatible/provider.ts, base-anthropic-compatible.ts)
**Pattern extraction date:** 2026-06-02
