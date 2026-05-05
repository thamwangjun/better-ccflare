# Phase 1: Correctness & Patch Hardening - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 3 (2 modified source files, 1 modified test file)
**Analogs found:** 3 / 3

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `packages/providers/src/providers/openrouter/provider.ts` | provider (request transform + usage extraction) | request-response | `packages/providers/src/providers/openai/provider.ts` (`injectAlibabaCaching`) | role-match — same per-block cache injection structural pattern |
| `packages/providers/src/providers/openai/provider.ts` | provider (usage extraction) | request-response | self — PATCH-01 is an inline comment addition on lines 262-265 | exact — no behavioral change |
| `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | test | request-response | self — existing `describe` blocks in same file | exact — extends existing test file |

---

## Pattern Assignments

### `packages/providers/src/providers/openrouter/provider.ts` (provider, request-response)

**Changes required:**
1. CACHE-02: Replace top-level `body.cache_control` injection with per-block injection at 3 Anthropic breakpoints (tools, system, last assistant turn).
2. CACHE-01 / PATCH-02 prerequisite: Add `extractUsageInfo()` override that reads `usage.prompt_tokens_details.cache_write_tokens` (see Critical Finding in RESEARCH.md — the inherited `BaseAnthropicCompatibleProvider.extractUsageInfo()` reads the wrong field for OpenRouter responses).

**Analog for CACHE-02:** `packages/providers/src/providers/openai/provider.ts`, `injectAlibabaCaching()` (lines 396–440)

**Imports pattern** (lines 1–3 of openrouter/provider.ts):
```typescript
import { Logger } from "@better-ccflare/logger";
import type { Account } from "@better-ccflare/types";
import { AnthropicCompatibleProvider } from "../anthropic-compatible/provider";
```

**Core transformRequestBody pattern** (openrouter/provider.ts lines 35–58 — full current method to replace):
```typescript
override async transformRequestBody(
    request: Request,
    account?: Account,
): Promise<Request> {
    // First apply model mapping from parent
    const mapped = await super.transformRequestBody(request, account);

    try {
        const body = await mapped.clone().json();   // ← ALWAYS .clone() before .json()
        if (body && typeof body === "object") {
            body.cache_control = { type: "ephemeral" };  // ← REPLACE THIS BLOCK
            log.debug("Injected cache_control into OpenRouter request");
            return new Request(mapped.url, {
                method: mapped.method,
                headers: mapped.headers,
                body: JSON.stringify(body),
            });
        }
    } catch (error) {
        log.debug("Failed to inject cache_control:", error);
    }

    return mapped;
}
```

**Per-block injection pattern to copy** (openai/provider.ts lines 412–435, `injectAlibabaCaching`):
```typescript
// For array content: inject on last valid content part
if (Array.isArray(msg.content)) {
    const lastPart = msg.content[msg.content.length - 1];
    if (lastPart && typeof lastPart === "object" && lastPart.type === "text") {
        (lastPart as any).cache_control = { type: "ephemeral" };
    }
} else if (typeof msg.content === "string" && msg.content.length > 0) {
    // Convert string content to array with cache_control
    msg.content = [
        {
            type: "text",
            text: msg.content,
            cache_control: { type: "ephemeral" },
        },
    ];
}
```

**3-breakpoint injection target (to replace the single `body.cache_control` line):**
```typescript
// Breakpoint 1: last tool in tools[]
if (Array.isArray(body.tools) && body.tools.length > 0) {
    const lastTool = body.tools[body.tools.length - 1];
    if (lastTool && typeof lastTool === "object") {
        (lastTool as any).cache_control = { type: "ephemeral" };
    }
}

// Breakpoint 2: last content block in system (or convert string to array)
if (typeof body.system === "string" && body.system.length > 0) {
    body.system = [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }];
} else if (Array.isArray(body.system) && body.system.length > 0) {
    const lastBlock = body.system[body.system.length - 1];
    if (lastBlock && typeof lastBlock === "object") {
        (lastBlock as any).cache_control = { type: "ephemeral" };
    }
}

// Breakpoint 3: last content block of last assistant turn in messages[]
if (Array.isArray(body.messages)) {
    const lastAssistant = [...body.messages].reverse().find((m: any) => m.role === "assistant");
    if (lastAssistant) {
        if (Array.isArray(lastAssistant.content) && lastAssistant.content.length > 0) {
            const lastBlock = lastAssistant.content[lastAssistant.content.length - 1];
            if (lastBlock && typeof lastBlock === "object") {
                (lastBlock as any).cache_control = { type: "ephemeral" };
            }
        } else if (typeof lastAssistant.content === "string" && lastAssistant.content.length > 0) {
            lastAssistant.content = [{ type: "text", text: lastAssistant.content, cache_control: { type: "ephemeral" } }];
        }
    }
}
```

**extractUsageInfo override to add (CACHE-01 / PATCH-02 prerequisite):**

Analog: `packages/providers/src/providers/openai/provider.ts` lines 246–266 (the `extractUsageInfo` non-streaming path).

The current `BaseAnthropicCompatibleProvider.extractUsageInfo()` (base-anthropic-compatible.ts lines 280–285) reads:
```typescript
const cacheCreationInputTokens = json.usage.cache_creation_input_tokens || 0;
const cacheReadInputTokens = json.usage.cache_read_input_tokens || 0;
```

OpenRouter non-streaming responses do NOT return those fields. They return:
```json
{ "usage": { "prompt_tokens_details": { "cache_write_tokens": 50, "cached_tokens": 100 } } }
```

`OpenRouterProvider` must override `extractUsageInfo()` to map those fields. The override should:
1. Call the base class (to handle streaming case via the inherited streaming path).
2. For non-streaming, read `usage.prompt_tokens_details.cache_write_tokens` as `cacheCreationInputTokens`.

The override signature must match `base-anthropic-compatible.ts` line 253:
```typescript
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
} | null>
```

---

### `packages/providers/src/providers/openai/provider.ts` (provider, usage extraction)

**Change required:** PATCH-01 — add a single inline comment on line 262 (the `const cacheCreationInputTokens =` declaration).

**Exact target lines** (openai/provider.ts lines 253–266):
```typescript
// Extract cache statistics from prompt_tokens_details (Qwen/DashScope, OpenRouter)
const promptTokensDetails = json.usage.prompt_tokens_details as
    | {
            cache_creation_input_tokens?: number;
            cache_write_tokens?: number;
            cached_tokens?: number;
      }
    | undefined;

const cacheCreationInputTokens =       // ← ADD: // FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)
    promptTokensDetails?.cache_creation_input_tokens ||
    promptTokensDetails?.cache_write_tokens ||
    0;
const cacheReadInputTokens = promptTokensDetails?.cached_tokens || 0;
```

**After change (lines 262–265):**
```typescript
// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)
const cacheCreationInputTokens =
    promptTokensDetails?.cache_creation_input_tokens ||
    promptTokensDetails?.cache_write_tokens ||
    0;
```

No other changes to this file.

---

### `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` (test, request-response)

**Changes required:**
1. CACHE-02 test update (D-06): Replace the old `cache_control` top-level assertion in both existing tests with assertions for the 3 per-block injection points.
2. PATCH-02: Add a new `describe` block for `extractUsageInfo` that asserts `cacheCreationInputTokens` is non-zero when `prompt_tokens_details.cache_write_tokens` is set.

**Test file structure pattern** (current file, lines 1–46):
```typescript
import { describe, expect, it } from "bun:test";
import { OpenRouterProvider } from "../provider";

describe("OpenRouterProvider.transformRequestBody", () => {
    it("...", async () => {
        const provider = new OpenRouterProvider();
        const body = { ... };
        const request = new Request("https://openrouter.ai/api/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });

        const transformed = await provider.transformRequestBody(request);
        const result = await transformed.json();

        expect(result.xxx).toEqual(yyy);
    });
});
```

**Updated CACHE-02 test assertions (replace `result.cache_control` checks):**

For the tools breakpoint:
```typescript
// body includes tools: [{ name: "get_weather", description: "..." }]
expect(result.tools[result.tools.length - 1].cache_control).toEqual({ type: "ephemeral" });
```

For the system breakpoint (string input):
```typescript
// body includes system: "You are a helpful assistant"
expect(result.system).toEqual([
    { type: "text", text: "You are a helpful assistant", cache_control: { type: "ephemeral" } },
]);
```

For the last assistant turn breakpoint:
```typescript
// body.messages includes { role: "assistant", content: "Sure, I can help." }
const lastAssistant = [...result.messages].reverse().find((m: any) => m.role === "assistant");
expect(Array.isArray(lastAssistant.content)).toBe(true);
expect(lastAssistant.content[lastAssistant.content.length - 1].cache_control).toEqual({ type: "ephemeral" });
```

**PATCH-02 regression test (new describe block to append):**
```typescript
describe("OpenRouterProvider.extractUsageInfo", () => {
    it("extracts cache_write_tokens from non-streaming OpenRouter response (regression guard)", async () => {
        const provider = new OpenRouterProvider();
        const responseBody = {
            model: "anthropic/claude-sonnet-4-6",
            usage: {
                prompt_tokens: 100,
                completion_tokens: 10,
                total_tokens: 110,
                prompt_tokens_details: {
                    cached_tokens: 0,
                    cache_write_tokens: 50,
                },
            },
        };
        const response = new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "content-type": "application/json" },
        });

        const usage = await provider.extractUsageInfo(response);

        expect(usage).not.toBeNull();
        expect(usage!.cacheCreationInputTokens).toBe(50);
    });
});
```

**Note:** This test will fail until the `extractUsageInfo` override is added to `OpenRouterProvider`. Per RESEARCH.md pitfall 1, the TDD approach is correct here — write the test first, confirm it fails, then add the override, then confirm it passes.

---

## Shared Patterns

### Request body mutation pattern
**Source:** `packages/providers/src/providers/openrouter/provider.ts` lines 43–51
**Apply to:** `transformRequestBody` in `OpenRouterProvider`
```typescript
const body = await mapped.clone().json();   // MUST be .clone() — body stream is one-time
if (body && typeof body === "object") {
    // ... mutate body ...
    return new Request(mapped.url, {
        method: mapped.method,
        headers: mapped.headers,
        body: JSON.stringify(body),
    });
}
// fallback:
return mapped;
```

### Per-block cache_control injection pattern
**Source:** `packages/providers/src/providers/openai/provider.ts` lines 414–434 (`injectAlibabaCaching`)
**Apply to:** All 3 breakpoints in the new `transformRequestBody` implementation
```typescript
// Array content: mutate last block in-place
const lastPart = arr[arr.length - 1];
if (lastPart && typeof lastPart === "object") {
    (lastPart as any).cache_control = { type: "ephemeral" };
}
// String content: convert to single-element array with cache_control
content = [{ type: "text", text: content, cache_control: { type: "ephemeral" } }];
```

### Bun test structure
**Source:** `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` lines 1–46
**Apply to:** All new test cases in the same file
```typescript
import { describe, expect, it } from "bun:test";
import { OpenRouterProvider } from "../provider";

describe("OpenRouterProvider.<method>", () => {
    it("<behavior description>", async () => {
        const provider = new OpenRouterProvider();
        // construct inline Request or Response — no shared fixtures
        // call provider method directly
        // assert on parsed result
    });
});
```

---

## No Analog Found

None. All 3 files have direct analogs within the codebase.

---

## Metadata

**Analog search scope:** `packages/providers/src/providers/`
**Files scanned:** 4 (openrouter/provider.ts, openrouter/__tests__/provider.test.ts, openai/provider.ts, base-anthropic-compatible.ts)
**Pattern extraction date:** 2026-05-04

**Key risk to flag at plan-review:**
The RESEARCH.md Critical Finding confirms that D-01 ("no code change needed for CACHE-01") is based on an incorrect assumption about the inheritance chain. `OpenRouterProvider` inherits `extractUsageInfo` from `BaseAnthropicCompatibleProvider`, which reads `cache_creation_input_tokens` — a field OpenRouter does not return. An `extractUsageInfo` override must be added to `OpenRouterProvider`. This is a code addition beyond the locked D-01 decision. The planner must surface this to the user at plan-review time.
