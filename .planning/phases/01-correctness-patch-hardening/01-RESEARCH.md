# Phase 1: Correctness & Patch Hardening - Research

**Researched:** 2026-05-04
**Domain:** TypeScript provider inheritance, OpenRouter API response format, Bun test patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CACHE-01: Non-streaming cache token extraction**
- D-01: Already implemented — `prompt_tokens_details.cache_write_tokens` extraction is present in `packages/providers/src/providers/openai/provider.ts:264`. No code change needed; PATCH-01 comment and PATCH-02 test cover it.

**CACHE-02: cache_control injection**
- D-02: Inject `{ type: "ephemeral" }` per-block at 3 breakpoints per request:
  1. Last tool object in `tools[]` array (if present)
  2. Last content block in `system[]` array. If `body.system` is a plain string, convert to `[{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }]`
  3. Last content block of the last assistant-role message in `messages[]` (if an assistant turn exists)
- D-03: No TTL field — use `{ type: "ephemeral" }` only (no `ttl` key)
- D-04: No model prefix gating — inject for all models. Silent ignores by non-Anthropic providers are acceptable.
- D-05: Per-block injection only — do NOT inject top-level `body.cache_control`. Per-block works across Anthropic direct, Bedrock, and Vertex; top-level restricts routing to Anthropic-only and excludes Bedrock/Vertex.
- D-06: Update the existing openrouter test file to assert all 3 injection points (tools, system block, last assistant turn). The old top-level `body.cache_control` assertion is no longer the target behavior.

**PATCH-01: Fork patch comment**
- D-07: Add `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)` as an inline comment on the `cache_write_tokens` extraction line in `packages/providers/src/providers/openai/provider.ts`

**PATCH-02: Regression test**
- D-08: Add the test to the existing `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` file (not a new file)
- D-09: Scope: happy path + regression guard only — test that a non-streaming response with `usage.prompt_tokens_details.cache_write_tokens` set returns a non-zero `cacheCreationInputTokens`. Edge cases (missing field, null values) are out of scope.

### Claude's Discretion
None specified.

### Deferred Ideas (OUT OF SCOPE)
- 1h TTL for tools and system breakpoints
- 4th breakpoint (large user document)
- CACHE-03 / CACHE-04 (extended caching requirements from REQUIREMENTS.md v2)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CACHE-01 | Non-streaming OpenRouter responses report accurate cache token counts (`usage.prompt_tokens_details` instead of Anthropic-native fields) | See Critical Finding: D-01 Inheritance Contradiction below |
| CACHE-02 | `cache_control` ephemeral injection applied per-block at 3 breakpoints in `OpenRouterProvider.transformRequestBody()` | D-02 through D-06; existing method identified, replacement logic specified |
| PATCH-01 | `cache_write_tokens` extraction patch tagged with `// FORK PATCH:` comment visible during upstream diff review | Exact location: `openai/provider.ts` line 263 (the `const cacheCreationInputTokens =` line) |
| PATCH-02 | Unit test covering OpenRouter non-streaming cache token extraction path; fails if patch is removed | Test file exists, pattern established; but see Critical Finding re: which provider method to test |
</phase_requirements>

---

## Summary

Phase 1 addresses two correctness bugs and two patch-hardening tasks in the OpenRouter provider chain. All changes are localized to two source files and one test file.

The most significant implementation concern is a **contradiction between D-01 and the actual inheritance chain**. CONTEXT.md states that `cache_write_tokens` extraction is "already implemented" in `openai/provider.ts` and that no code change is needed for CACHE-01. However, `OpenRouterProvider` extends `AnthropicCompatibleProvider` (not `OpenAICompatibleProvider`), so it inherits `BaseAnthropicCompatibleProvider.extractUsageInfo()` — which reads `usage.cache_creation_input_tokens`, a field OpenRouter does NOT return. The `openai/provider.ts` extraction code is unreachable from `OpenRouterProvider`. This must be resolved before planning tasks that assume D-01 is correct.

CACHE-02 is a clear replacement: remove the broken top-level `body.cache_control` injection and replace it with per-block injection at 3 specific Anthropic API breakpoints. The implementation pattern mirrors the existing `injectAlibabaCaching()` method in `OpenAICompatibleProvider`.

**Primary recommendation:** Before executing D-01 as-is, verify whether OpenRouter non-streaming responses return Anthropic-native usage fields (`cache_creation_input_tokens`) or OpenAI-format fields (`prompt_tokens_details.cache_write_tokens`). External documentation confirms OpenRouter returns the latter. If D-01 is confirmed incorrect, CACHE-01 requires overriding `extractUsageInfo()` in `OpenRouterProvider` to read `prompt_tokens_details.cache_write_tokens`.

---

## Critical Finding: D-01 Inheritance Contradiction

### What D-01 Claims
D-01 states: "Already implemented — `prompt_tokens_details.cache_write_tokens` extraction is present in `packages/providers/src/providers/openai/provider.ts:264`. No code change needed."

### What the Code Shows

**Inheritance chain:**
```
BaseProvider
├── OpenAICompatibleProvider         ← has extractUsageInfo with prompt_tokens_details
└── BaseAnthropicCompatibleProvider  ← has extractUsageInfo with cache_creation_input_tokens
    └── AnthropicCompatibleProvider
        └── OpenRouterProvider       ← inherits Anthropic-style extractor, NOT OpenAI-style
```

`OpenRouterProvider.extractUsageInfo` resolves to `BaseAnthropicCompatibleProvider.extractUsageInfo()` at `packages/providers/src/providers/base-anthropic-compatible.ts:253`. This method reads:

```typescript
const cacheCreationInputTokens = json.usage.cache_creation_input_tokens || 0;
const cacheReadInputTokens = json.usage.cache_read_input_tokens || 0;
```

[VERIFIED: grep on base-anthropic-compatible.ts lines 282-285]

**OpenRouter's actual non-streaming response format:**
```json
{
  "usage": {
    "prompt_tokens": 10339,
    "completion_tokens": 60,
    "total_tokens": 10399,
    "prompt_tokens_details": {
      "cached_tokens": 10318,
      "cache_write_tokens": 0
    }
  }
}
```

[CITED: https://openrouter.ai/docs/guides/best-practices/prompt-caching]

OpenRouter uses `usage.prompt_tokens_details.cache_write_tokens`, not `usage.cache_creation_input_tokens`. The `BaseAnthropicCompatibleProvider.extractUsageInfo()` will always return `cacheCreationInputTokens: 0` for OpenRouter responses.

### Resolution Required

The planner must resolve this before finalizing CACHE-01 and PATCH-02 tasks. Two options:

**Option A (minimal — if D-01 stands):** Accept that CACHE-01 is already "fixed enough" — perhaps OpenRouter also returns `cache_creation_input_tokens` in some contexts — and proceed with only adding the PATCH-01 comment and PATCH-02 test against `openai/provider.ts`. The PATCH-02 test would then test the `OpenAICompatibleProvider.extractUsageInfo()` method directly rather than `OpenRouterProvider`.

**Option B (correct — if D-01 is found wrong):** Override `extractUsageInfo()` in `OpenRouterProvider` to read `prompt_tokens_details.cache_write_tokens`. This is a code addition, contradicting D-01's "no code change needed." The PATCH-02 test would call this new override.

**Recommended resolution:** Since this is the user's own fork and the stated success criterion is "a non-streaming OpenRouter response shows non-zero cache write token counts in usage stats," Option B is likely correct. However, since D-01 is a locked decision, the planner should surface this contradiction to the user at plan-review time, not silently implement Option B.

**[ASSUMED]** — That D-01 is based on an incorrect belief that `OpenRouterProvider` inherits from `OpenAICompatibleProvider`. The inheritance chain analysis is verified by code read; the assumption is about the intent behind D-01.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:test` | built-in (Bun 1.3.11) | Test runner | Project standard — already used in all 20+ test files across providers package |
| TypeScript | 6.0.2 | Type safety | Project language |

[VERIFIED: `bun test` command, existing test files in providers package]

### No Additional Dependencies Required
All 4 requirements are satisfied with:
- Existing `bun:test` for PATCH-02
- TypeScript source edits for CACHE-02 and PATCH-01
- No npm installs needed

---

## Architecture Patterns

### Provider Inheritance Hierarchy (Verified)

```
BaseProvider (packages/providers/src/base.ts)
├── OpenAICompatibleProvider (packages/providers/src/providers/openai/provider.ts)
│   └── extractUsageInfo: reads prompt_tokens_details (OpenAI format)
└── BaseAnthropicCompatibleProvider (packages/providers/src/providers/base-anthropic-compatible.ts)
    └── extractUsageInfo: reads cache_creation_input_tokens (Anthropic format)
    └── AnthropicCompatibleProvider (packages/providers/src/providers/anthropic-compatible/provider.ts)
        └── OpenRouterProvider (packages/providers/src/providers/openrouter/provider.ts)
            └── transformRequestBody: currently injects top-level body.cache_control (WRONG)
            └── extractUsageInfo: INHERITED from BaseAnthropicCompatibleProvider (misses OpenRouter cache tokens)
```

[VERIFIED: all class declarations and `extends` keywords read from source files]

### Pattern 1: transformRequestBody Override

`OpenRouterProvider.transformRequestBody()` is the target method for CACHE-02. The existing pattern:

```typescript
override async transformRequestBody(request: Request, account?: Account): Promise<Request> {
    // 1. Call super to apply model mapping (from AnthropicCompatibleProvider)
    const mapped = await super.transformRequestBody(request, account);
    
    try {
        // 2. Clone and parse body (clone is required — body is consumed)
        const body = await mapped.clone().json();
        if (body && typeof body === "object") {
            // 3. Mutate body
            body.cache_control = { type: "ephemeral" }; // CURRENT (WRONG — top-level)
            // TARGET: per-block injection at tools[], system[], messages[]
            
            // 4. Reconstruct Request with mutated body
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

[VERIFIED: `packages/providers/src/providers/openrouter/provider.ts` lines 35-58]

### Pattern 2: Per-Block cache_control Injection (Target for CACHE-02)

Based on decisions D-02 through D-05, the replacement logic must handle the Anthropic API body structure. The Anthropic messages API body (before format conversion by the parent) uses:
- `body.tools[]` — array of tool definitions
- `body.system` — string OR array of content blocks
- `body.messages[]` — array of `{ role, content }` where content is string or array of content blocks

Note: `transformRequestBody` in `OpenRouterProvider` runs AFTER `super.transformRequestBody()` which applies model mapping but does NOT convert Anthropic→OpenAI format (that conversion only happens in `OpenAICompatibleProvider`, which is a different branch). `AnthropicCompatibleProvider.transformRequestBody()` only does model mapping via `transformRequestBodyModel()`. The body passed to the OpenRouter override retains Anthropic structure.

[VERIFIED: `base-anthropic-compatible.ts` lines 163-185 — `transformRequestBody` only calls `transformRequestBodyModel`, no format conversion]

**Implementation target:**

```typescript
// Tools: inject on last tool
if (Array.isArray(body.tools) && body.tools.length > 0) {
    const lastTool = body.tools[body.tools.length - 1];
    if (lastTool && typeof lastTool === "object") {
        lastTool.cache_control = { type: "ephemeral" };
    }
}

// System: inject on last content block (or convert string to array)
if (typeof body.system === "string" && body.system.length > 0) {
    body.system = [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }];
} else if (Array.isArray(body.system) && body.system.length > 0) {
    const lastBlock = body.system[body.system.length - 1];
    if (lastBlock && typeof lastBlock === "object") {
        lastBlock.cache_control = { type: "ephemeral" };
    }
}

// Messages: inject on last content block of last assistant turn
const lastAssistant = [...body.messages].reverse().find((m: any) => m.role === "assistant");
if (lastAssistant) {
    if (Array.isArray(lastAssistant.content) && lastAssistant.content.length > 0) {
        const lastBlock = lastAssistant.content[lastAssistant.content.length - 1];
        if (lastBlock && typeof lastBlock === "object") {
            lastBlock.cache_control = { type: "ephemeral" };
        }
    } else if (typeof lastAssistant.content === "string" && lastAssistant.content.length > 0) {
        lastAssistant.content = [{ type: "text", text: lastAssistant.content, cache_control: { type: "ephemeral" } }];
    }
}
```

[ASSUMED] — Exact string→array conversion for assistant messages follows the same pattern as system. No official Anthropic spec tested in this session.

### Pattern 3: Bun Test Pattern for Extractors

Tests in `openrouter/__tests__/provider.test.ts` use direct method calls on instantiated providers. For PATCH-02, the pattern would be:

```typescript
// Source: packages/providers/src/providers/openrouter/__tests__/provider.test.ts (existing tests)
it("extracts cache_write_tokens from non-streaming OpenRouter response", async () => {
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
    expect(usage!.cacheCreationInputTokens).toBeGreaterThan(0);
    // Regression guard: if the patch is removed, this will be 0
    expect(usage!.cacheCreationInputTokens).toBe(50);
});
```

**Important:** This test will FAIL with the current `BaseAnthropicCompatibleProvider.extractUsageInfo()` because it reads `cache_creation_input_tokens` (absent in the response body above). The test only passes if either:
- D-01 is followed as-is AND `extractUsageInfo` is somehow the OpenAI-compatible version, OR
- `OpenRouterProvider.extractUsageInfo()` is overridden (Option B above)

[VERIFIED: test pattern from existing `openrouter/__tests__/provider.test.ts`; failure mode from `base-anthropic-compatible.ts:282-284`]

### Anti-Patterns

- **Injecting top-level `body.cache_control`:** This is what the current `OpenRouterProvider.transformRequestBody()` does. OpenRouter passes top-level `cache_control` to Anthropic-direct only, not to Bedrock or Vertex routes. This causes silent routing restriction. Replace with per-block injection. [CITED: https://openrouter.ai/docs/guides/best-practices/prompt-caching]
- **Cloning the mapped request without `.clone()`:** The mapped Request body is a consumed ReadableStream after the first `.json()` call. Always call `mapped.clone().json()`, not `mapped.json()`. The existing code already does this correctly.
- **Using `body.cache_control` for Bedrock/Vertex routing:** Top-level cache_control is an OpenRouter-specific routing hint that locks the request to Anthropic-direct. Never use it for cache warmth on a multi-route proxy.

---

## Solved Problems

| Problem | Use Instead | Why |
|---------|-------------|-----|
| Per-block cache injection pattern | Copy from `injectAlibabaCaching()` in `openai/provider.ts:396-440` | Same structural logic: find last block in array, add `cache_control`, convert string to array if needed |
| Test factory pattern | Construct `Request`/`Response` inline in `it()` body | No shared fixtures needed; all existing tests do this |

---

## Common Pitfalls

### Pitfall 1: D-01 Over-Trust
**What goes wrong:** Treating D-01 ("no code change needed for CACHE-01") as correct without verifying the inheritance chain, then writing a PATCH-02 test that calls `provider.extractUsageInfo()` and always gets `cacheCreationInputTokens: 0`, causing the test to fail with any positive assertion.
**Root cause:** D-01 was written under the assumption that `OpenRouterProvider` uses `OpenAICompatibleProvider.extractUsageInfo()`. It does not.
**Prevention:** Verify the test actually passes before committing. Run `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` after adding PATCH-02.
**Warning signs:** If writing the test requires mocking `extractUsageInfo` or if the test fails with `cacheCreationInputTokens: 0`, the inheritance issue is confirmed.

### Pitfall 2: Mutation After Clone
**What goes wrong:** Calling `body = await mapped.json()` (without `.clone()`) consumes the stream, then trying to create `new Request(mapped.url, { body: JSON.stringify(body) })` works but `mapped.headers` is still usable.
**Root cause:** Bun's `Request` body is a one-time ReadableStream.
**Prevention:** Always `mapped.clone().json()`. The existing code does this correctly — do not "simplify" it.

### Pitfall 3: system as Array vs. String
**What goes wrong:** Assuming `body.system` is always a string. Claude Code sends system prompts as arrays of content blocks (`[{ type: "text", text: "..." }]`).
**Root cause:** Anthropic API accepts both string and array for `system`.
**Prevention:** Branch on `typeof body.system === "string"` vs. `Array.isArray(body.system)`. The existing `injectAlibabaCaching()` handles this correctly and is the reference implementation.

### Pitfall 4: FORK PATCH Comment Placement
**What goes wrong:** Placing the `// FORK PATCH:` comment on the wrong line. D-07 targets the `cache_write_tokens` extraction line specifically.
**Root cause:** There are two adjacent lines (263-265 in `openai/provider.ts`): the `const cacheCreationInputTokens =` multi-line expression. The comment should be on or immediately above the `const cacheCreationInputTokens =` line at 262, not on the `promptTokensDetails` declaration.
**Prevention:** The comment goes on line 262: `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)` directly above `const cacheCreationInputTokens =`.

---

## Code Examples

### Existing cache_write_tokens extraction (PATCH-01 target)

```typescript
// Source: packages/providers/src/providers/openai/provider.ts lines 253-266
// Extract cache statistics from prompt_tokens_details (Qwen/DashScope, OpenRouter)
const promptTokensDetails = json.usage.prompt_tokens_details as
    | {
            cache_creation_input_tokens?: number;
            cache_write_tokens?: number;       // ← This is the OpenRouter field
            cached_tokens?: number;
      }
    | undefined;

const cacheCreationInputTokens =       // ← FORK PATCH comment goes here (D-07)
    promptTokensDetails?.cache_creation_input_tokens ||
    promptTokensDetails?.cache_write_tokens ||       // ← The fork patch line
    0;
const cacheReadInputTokens = promptTokensDetails?.cached_tokens || 0;
```

[VERIFIED: Read of `openai/provider.ts` lines 253-266]

### Existing top-level injection (CACHE-02 replacement target)

```typescript
// Source: packages/providers/src/providers/openrouter/provider.ts lines 44-46
// CURRENT BEHAVIOR (wrong — restricts OpenRouter routing to Anthropic-direct):
body.cache_control = { type: "ephemeral" };

// TARGET BEHAVIOR (D-02): per-block injection at tools[], system[], last assistant message
```

[VERIFIED: Read of `openrouter/provider.ts` lines 44-46]

### Reference: injectAlibabaCaching (pattern to mirror for CACHE-02)

The `injectAlibabaCaching()` method at `openai/provider.ts:396-440` demonstrates the string→array conversion pattern and last-block injection that CACHE-02 should replicate. Key excerpt:

```typescript
// For array content: inject on last valid part
if (Array.isArray(msg.content)) {
    const lastPart = msg.content[msg.content.length - 1];
    if (lastPart && typeof lastPart === "object" && lastPart.type === "text") {
        (lastPart as any).cache_control = { type: "ephemeral" };
    }
} else if (typeof msg.content === "string" && msg.content.length > 0) {
    // Convert string to array
    msg.content = [{ type: "text", text: msg.content, cache_control: { type: "ephemeral" } }];
}
```

[VERIFIED: Read of `openai/provider.ts` lines 414-431]

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Top-level `body.cache_control` | Per-block `cache_control` on individual content items | Preserves Bedrock/Vertex routing; prevents Anthropic-only lock-in |
| Anthropic-native field names for all providers | `prompt_tokens_details.cache_write_tokens` for OpenRouter/OpenAI-format responses | Accurate billing for OpenRouter cache usage |

---

## Runtime State Inventory

Step 2.5: SKIPPED — This is a code correctness and test phase, not a rename/refactor/migration phase. No runtime state to audit.

---

## Environment Availability

Step 2.6: SKIPPED — No external dependencies. All changes are TypeScript source edits and `bun:test` tests. `bun:test` is built-in to the Bun runtime already present.

**Environment check for completeness:**
- Bun: available [VERIFIED: `bun test v1.3.11 (af24e281)` from test run output]
- All existing tests pass before changes [VERIFIED: openrouter tests 2 pass, openai tests 30 pass]

---

## Validation Architecture

`nyquist_validation` is `false` in `.planning/config.json`. Section skipped.

---

## Security Domain

The `cache_control` injection only affects request bodies sent upstream to OpenRouter. No authentication or credential handling is modified. No new user inputs accepted. ASVS categories V2, V3, V4, V6 are not applicable. V5 (input validation) is partially relevant but the body was already accepted and parsed; cache_control injection operates on trusted internal data.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | D-01 was written under the incorrect assumption that `OpenRouterProvider` uses `OpenAICompatibleProvider.extractUsageInfo()`. The actual inheritance resolves to `BaseAnthropicCompatibleProvider.extractUsageInfo()`. | Critical Finding | PATCH-02 test will always fail; CACHE-01 remains broken in production |
| A2 | String→array conversion for assistant message content follows the same pattern as system content | Architecture Patterns | Minor — may need adjustment if assistant turns always have array content in practice |
| A3 | `body.tools[]` elements are plain objects that accept arbitrary keys (including `cache_control`) without validation errors at OpenRouter | Architecture Patterns | Low risk — Anthropic API accepts `cache_control` on tool objects per official docs |

---

## Open Questions (RESOLVED)

1. **Is D-01 correct? Does `OpenRouterProvider.extractUsageInfo()` ever reach `openai/provider.ts:264`?**
   - What we know: Inheritance chain resolves to `BaseAnthropicCompatibleProvider.extractUsageInfo()`, not `OpenAICompatibleProvider.extractUsageInfo()`. OpenRouter non-streaming responses use `usage.prompt_tokens_details.cache_write_tokens`.
   - What is unclear: Whether the user verified D-01 by looking at a different code path, or whether there is a middleware/conversion step that transforms OpenRouter responses to Anthropic format before `extractUsageInfo` is called.
   - Recommendation: The planner should include a task to verify this by writing the PATCH-02 test first (TDD). If the test fails with `cacheCreationInputTokens: 0`, D-01 is wrong and a `extractUsageInfo` override must be added to `OpenRouterProvider`. If it passes, D-01 is correct.

2. **Does the Anthropic body arrive at `OpenRouterProvider.transformRequestBody()` before or after format conversion?**
   - What we know: `AnthropicCompatibleProvider.transformRequestBody()` only does model mapping via `transformRequestBodyModel()`. It does NOT convert Anthropic format to OpenAI format.
   - What is unclear: Nothing — this is confirmed. The body retains Anthropic structure when CACHE-02 injection runs.
   - Recommendation: Planner can proceed with Anthropic-format body manipulation in `OpenRouterProvider.transformRequestBody()`.

---

## Sources

### Primary (HIGH confidence)
- Codebase read: `packages/providers/src/providers/openrouter/provider.ts` — Current injection behavior, inheritance
- Codebase read: `packages/providers/src/providers/openai/provider.ts` — `cache_write_tokens` extraction at lines 253-266
- Codebase read: `packages/providers/src/providers/base-anthropic-compatible.ts` — `extractUsageInfo` method at lines 253-321
- Codebase read: `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — Existing test patterns
- Bun test run output: 2 existing OpenRouter tests pass; 30 OpenAI provider tests pass

### Secondary (MEDIUM confidence)
- [CITED: https://openrouter.ai/docs/guides/best-practices/prompt-caching] — OpenRouter non-streaming response format confirmed: `usage.prompt_tokens_details.cache_write_tokens` and `cached_tokens`; top-level `cache_control` restricts routing to Anthropic-direct

### Flagged for Validation (LOW confidence)
- None — all claims are either verified from codebase or cited from official docs.

---

## Metadata

**Confidence breakdown:**
- Inheritance chain analysis: HIGH — verified by source read
- OpenRouter response format: HIGH — cited from official docs
- D-01 contradiction: HIGH — provable from code, flagged as assumption about intent
- CACHE-02 injection logic: MEDIUM — pattern mirrors existing code; exact edge cases for assistant string content assumed
- PATCH-01 placement: HIGH — exact lines identified

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (stable provider code; only risk is upstream merge changing openai/provider.ts)
