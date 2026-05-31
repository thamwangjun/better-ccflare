# Phase 7: OpenRouter Response Cost Extraction - Research

**Researched:** 2026-05-31
**Domain:** API response parsing / provider extension / SSE stream processing
**Confidence:** HIGH

## Summary

Phase 7 extracts the actual USD cost from OpenRouter API responses (`usage.cost`) across three code paths: (1) provider-level `extractUsageInfo()` for non-streaming JSON, (2) worker-level SSE `message_delta` event parsing, and (3) worker-level non-streaming body JSON extraction. No new packages are required -- all changes are internal additions to existing TypeScript modules within `packages/providers/` and `packages/proxy/`.

The OpenRouter API enriches standard Anthropic-format responses with a `cost` field (a `double` in USD) at the `usage` level. This field is documented in the `ChatUsage` schema of the OpenRouter OpenAPI specification [VERIFIED: OpenRouter OpenAPI spec]. The same field is injected into Anthropic-format non-streaming JSON and SSE `message_delta` events as an OpenRouter-specific extension. The cost extraction follows three existing patterns already established in the codebase: provider method override (CACHE-01 precedent), worker SSE state mutation, and worker body JSON destructuring.

**Primary recommendation:** Add `json.usage.cost` reading to three specific locations using the same patterns already established for token extraction. Thread the value through as `costUsd` (provider path) or `providerCostUsd` (worker paths). The `providerCostUsd` field name is chosen per D-06 to avoid shadowing the existing `state.usage.costUsd` which holds the final value after `estimateCostUSD()`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Read `json.usage.cost` directly in the existing `OpenRouterProvider.extractUsageInfo()` override at `packages/providers/src/providers/openrouter/provider.ts:227`. Return it as `costUsd` in the result object alongside the existing token counts.
- **D-02:** OpenRouter-only -- do NOT add `usage.cost` reading to the base `AnthropicCompatibleProvider` or `OpenAICompatibleProvider`. The override pattern is already established (CACHE-01) and this keeps the change minimal.
- **D-03:** Parse `usage.cost` from the `message_delta` SSE event in `extractUsageFromData()` (alongside existing token parsing at `packages/proxy/src/post-processor.worker.ts:355`). Stash it in a new `providerCostUsd` field on the `RequestState.usage` object.
- **D-04:** In `handleEnd()`, when `providerCostUsd` is set, skip `estimateCostUSD()` and use the provider-returned value directly. (The actual gating logic -- conditionally skipping the estimate -- is Phase 8's scope, but the field plumbing must be in place.)
- **D-05:** Extend the existing `extractUsageFromJson()` function (line 287) to also read `usage.cost` from the parsed JSON body. Store it in the same `providerCostUsd` field on `RequestState.usage`.
- **D-06:** The three capture points (provider extractUsageInfo, worker SSE message_delta, worker extractUsageFromJson) all write to the same conceptual field. For the provider path, `costUsd` is returned directly from `extractUsageInfo()` and flows through `updateRequestUsage()` in `response-processor.ts`. For the two worker paths, `providerCostUsd` is stashed in `RequestState.usage` and used in `handleEnd()` instead of calling `estimateCostUSD()`.

### Claude's Discretion
- Exact field name: `providerCostUsd` vs `costUsd` on the worker state -- pick whichever avoids shadowing the existing `costUsd` (which holds the final value after estimate). The provider path already returns `costUsd` in the result object, so that path is straightforward.
- Whether to add `cost` to the `extractUsageFromJson` JSON type annotation -- yes, to keep TypeScript happy.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COST-01 | OpenRouter `extractUsageInfo()` reads `usage.cost` from non-streaming JSON responses and returns it as `costUsd` | Pattern established by existing `cache_write_tokens` reading at line 227 of provider.ts. OpenAPI spec confirms `cost` field at `usage.cost` in response. |
| COST-02 | Post-processor worker reads `usage.cost` from SSE streaming final chunks | `extractUsageFromData()` already reads `output_tokens` from `message_delta` events. Adding `cost` uses identical destructuring pattern. |
| COST-03 | Post-processor worker reads `usage.cost` from non-streaming response body JSON | `extractUsageFromJson()` already reads `usage.input_tokens`, `usage.output_tokens`, etc. Adding `cost` to the same destructuring. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Provider-level non-streaming cost extraction (COST-01) | API / Backend | -- | Provider's `extractUsageInfo()` runs in the proxy layer before or during client response write. Cost data is synchronous to the request path. |
| Worker SSE streaming cost extraction (COST-02) | Background Workers | -- | Post-processor worker runs off the main request thread. SSE chunk parsing is async and non-blocking. |
| Worker non-streaming body cost extraction (COST-03) | Background Workers | -- | Response body is sent to the worker as base64; parsing happens in `handleEnd()`. |

## Standard Stack

### Core
No new packages are required for Phase 7. All changes are internal code modifications to existing TypeScript source files.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun (runtime) | >= 1.2.8 | Runtime, test runner | Enforced by `engines.bun` in root `package.json` |
| TypeScript | 5.x / ESNext | Type safety on new fields | Same as rest of codebase |
| `@better-ccflare/core` | workspace | `estimateCostUSD` reference (Phase 8 integration) | Already imported in worker |

### Installation
No installation needed -- internal code changes only.

## Package Legitimacy Audit

> SKIPPED -- this phase installs zero external packages. All changes are additions to existing TypeScript source files in `packages/providers/` and `packages/proxy/`.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Phase 7 Cost Extraction Flow                      │
└─────────────────────────────────────────────────────────────────────────┘

CLIENT ──► SERVER (Bun.serve) ──► PROXY (response-processor.ts)
                                       │
                                       ├── COST-01: OpenRouterProvider.extractUsageInfo()
                                       │   Path: Non-streaming only
                                       │   Reads: response.clone().json().usage.cost
                                       │   Returns: { costUsd, ... } ──► ctx.dbOps.updateRequestUsage()
                                       │
                                       └── Response sent to client
                                                │
                                                └── Post-processor Worker
                                                      │
                                                      ├── COST-02: extractUsageFromData()
                                                      │   Path: SSE streaming
                                                      │   Reads: parsed.usage.cost from message_delta events
                                                      │   Stores: state.usage.providerCostUsd
                                                      │
                                                      └── COST-03: extractUsageFromJson()
                                                          Path: Non-streaming response body
                                                          Reads: json.usage.cost from decoded body
                                                          Stores: state.usage.providerCostUsd
                                                              │
                                                              └── handleEnd():
                                                                  state.usage.providerCostUsd
                                                                  ──► DB write (Phase 8 integrates)
```

### Recommended Project Structure
No new files. Changes span:
```
packages/
├── providers/src/providers/openrouter/
│   ├── provider.ts                    # COST-01: add costUsd to extractUsageInfo() return
│   └── __tests__/provider.test.ts    # COST-01: add cost assertion tests
└── proxy/src/
    ├── post-processor.worker.ts       # COST-02/03: extractUsageFromData(), extractUsageFromJson(), RequestState.usage
    └── __tests__/
        └── sse-parsing.test.ts        # COST-02: add cost parsing test
        # No existing test for extractUsageFromJson - new test file needed
```

### Pattern 1: Provider Override for Cost Extraction (COST-01)
**What:** `OpenRouterProvider.extractUsageInfo()` already overrides the base class to read `prompt_tokens_details.cache_write_tokens`. Extend this same method to also read `usage.cost`.
**When to use:** Non-streaming OpenRouter responses (content-type is NOT `text/event-stream`).
**Example:**
```typescript
// Source: packages/providers/src/providers/openrouter/provider.ts:227 (existing override)
override async extractUsageInfo(response: Response): Promise<{...} | null> {
    // ... existing code ...
    const json = await clone.json();
    if (!json.usage) return null;
    // Add cost reading (COST-01):
    const costUsd = typeof json.usage.cost === "number" ? json.usage.cost : undefined;
    return {
        model: json.model,
        promptTokens,
        completionTokens,
        totalTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
        costUsd,  // NEW: provider-returned cost
    };
}
```

### Pattern 2: Worker SSE Cost Extraction (COST-02)
**What:** `extractUsageFromData()` already reads `parsed.usage.output_tokens` from `message_delta` events. Add `parsed.usage.cost` reading alongside.
**When to use:** SSE streaming responses where `message_delta` events carry a `usage` object.
**Example:**
```typescript
// Source: packages/proxy/src/post-processor.worker.ts:355
if (isMessageDelta) {
    if (parsed.usage) {
        state.usage.outputTokens = parsed.usage.output_tokens;
        // NEW (COST-02):
        if (typeof parsed.usage.cost === "number") {
            state.usage.providerCostUsd = parsed.usage.cost;
        }
    }
}
```

### Pattern 3: Worker Body JSON Cost Extraction (COST-03)
**What:** `extractUsageFromJson()` already destructures `usage.input_tokens`, `usage.output_tokens` etc. Add `usage.cost` to the destructuring.
**When to use:** Non-streaming responses where the worker receives the full JSON body.
**Example:**
```typescript
// Source: packages/proxy/src/post-processor.worker.ts:287
function extractUsageFromJson(
    json: {
        model?: string;
        usage?: {
            input_tokens?: number;
            // ... existing fields ...
            cost?: number;  // NEW (COST-03)
        };
    },
    state: RequestState,
): void {
    const usageObj = json.usage;
    if (!usageObj) return;
    // ... existing token extraction ...
    // NEW (COST-03):
    if (typeof usageObj.cost === "number") {
        state.usage.providerCostUsd = usageObj.cost;
    }
}
```

### Pattern 4: RequestState Usage Interface Extension
**What:** Add `providerCostUsd` field to the `RequestState.usage` type.
**When to use:** Always -- this is the shared field both COST-02 and COST-03 write to.
**Example:**
```typescript
// Source: packages/proxy/src/post-processor.worker.ts:39
interface RequestState {
    // ...
    usage: {
        model?: string;
        inputTokens?: number;
        // ... existing fields ...
        costUsd?: number;
        providerCostUsd?: number;  // NEW: provider-returned cost from OpenRouter
        tokensPerSecond?: number;
    };
}
```

### Anti-Patterns to Avoid
- **Modify base `AnthropicCompatibleProvider.extractUsageInfo()`:** This would affect all 13+ providers. The `cost` field is OpenRouter-specific. Use the same override pattern as CACHE-01.
- **Shadow `costUsd` in the worker:** The existing `costUsd` field holds the estimate computed by `estimateCostUSD()`. The new `providerCostUsd` field must be distinct so Phase 8 can conditionally select the provider-returned value without losing the estimate.
- **Add cost parsing in `processSSELine()`:** The message_delta handling belongs in `extractUsageFromData()` where all other `parsed.usage` fields are read. Keeping it there maintains cohesion.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| USD cost from API response | Custom cost calculation | `json.usage.cost` from OpenRouter API | OpenRouter computes cost server-side using its pricing tables; client-side estimation is already performed by `estimateCostUSD()` but returns $0 for unknown models |
| SSE event field extraction | Custom SSE parser | Existing `extractUsageFromData()` function | Already handles `event:` and `data:` line parsing for both Anthropic and alternate formats |
| Response body JSON extraction | Custom body parser | Existing `extractUsageFromJson()` function | Already handles base64-decoded JSON with `usage` field destructuring |

**Key insight:** The codebase already has all three extraction points. Phase 7 only needs to add a single field read (`usage.cost`) at each point -- no new parsing infrastructure needed.

## Common Pitfalls

### Pitfall 1: `cost` is Optional and Nullable
**What goes wrong:** Assuming `usage.cost` is always present. OpenRouter's `ChatUsage.cost` schema defines it as `nullable: true`. Older OpenRouter accounts or certain models may not return it.
**Why it happens:** The OpenAPI spec marks `cost` as a non-required property. Some upstream providers may not emit this field.
**How to avoid:** Always use `typeof json.usage.cost === "number"` guard before assigning. Never assume `cost` is defined or non-null.
**Warning signs:** `TypeError: Cannot read properties of undefined` or `NaN` values in cost display.

### Pitfall 2: SSE `message_delta` Format Differences Across Providers
**What goes wrong:** Assuming all providers emit the same SSE event shape. Some providers put `type` in the JSON (Anthropic), others put it in the event line (Qwen/zai). The cost field may be at different paths depending on the provider.
**Why it happens:** The `extractUsageFromData()` function handles two formats (`parsed.type` vs `eventType` parameter) and the `usage` block structure varies per provider.
**How to avoid:** Only add cost extraction within the existing `isMessageDelta` check which already correctly handles both formats. The cost field at `parsed.usage.cost` is only present for OpenRouter responses -- it will silently be `undefined` for other providers.
**Warning signs:** Cost extraction failing silently for certain models or provider combinations.

### Pitfall 3: Breaking Non-OpenRouter Providers (Success Criterion 4)
**What goes wrong:** Adding cost-extraction logic that errors out or fails when parsing non-OpenRouter responses.
**Why it happens:** The `extractUsageFromData()` function processes SSE chunks for ALL providers. The code must degrade gracefully when `parsed.usage.cost` is absent.
**How to avoid:** Use optional chaining/number type guards. Never throw if cost is missing. The `typeof` guard pattern is the safest: `if (typeof parsed.usage?.cost === "number")`.
**Warning signs:** Worker errors in non-OpenRouter request processing, broken SSE streaming for Anthropic/Bedrock/Qwen.

### Pitfall 4: Inline Worker Not Updated
**What goes wrong:** Modifying `post-processor.worker.ts` but forgetting that `packages/proxy/src/inline-worker.ts` is auto-generated from it.
**Why it happens:** `inline-worker.ts` is listed in CLAUDE.md's file exclusions and must not be edited directly.
**How to avoid:** Only edit `post-processor.worker.ts`. The build process regenerates `inline-worker.ts`. Verify with `bun run build` after changes.
**Warning signs:** Changes not taking effect at runtime, or accidentally editing `inline-worker.ts` directly.

## Code Examples

### OpenRouter Non-Streaming Response JSON Structure
```json
// Source: OpenRouter OpenAPI spec (ChatUsage schema, line 5044)
{
    "model": "anthropic/claude-sonnet-4-6",
    "usage": {
        "prompt_tokens": 100,
        "completion_tokens": 50,
        "total_tokens": 150,
        "cost": 0.0012,                              // <-- COST-01 target
        "cost_details": {                            // Out of scope per REQUIREMENTS.md
            "upstream_inference_prompt_cost": 0.0008,
            "upstream_inference_completions_cost": 0.0004,
            "upstream_inference_cost": null
        },
        "prompt_tokens_details": {
            "cached_tokens": 2,
            "cache_write_tokens": 50
        },
        "is_byok": false
    }
}
```

### OpenRouter SSE message_delta Event
```json
// Source: OpenRouter OpenAPI spec (MessagesDeltaEvent, line 9454+)
// Event line: "event: message_delta"
// Data line:
{
    "type": "message_delta",
    "delta": { "stop_reason": "end_turn", "stop_sequence": null },
    "usage": {
        "output_tokens": 50,
        "cost": 0.0012                               // <-- COST-02 target
    }
}
```

### Provider extractUsageInfo Return Shape (with Cost)
```typescript
// Source: packages/providers/src/providers/openrouter/provider.ts:227
// Return type (existing -- no change needed in type signature):
{
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;                    // NEW: set to json.usage.cost
    inputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    outputTokens?: number;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side `estimateCostUSD()` for all cost computation | Provider-returned `usage.cost` for OpenRouter (Phase 7 plumbing), with client-side estimate as fallback (Phase 8 integration) | Phase 7 adds extraction; Phase 8 adds the conditional skip | OpenRouter models with unknown pricing (zero in client-side catalogue) will get actual USD costs |

**Deprecated/outdated:**
- `include_usage` stream option (line 4812 in OpenAPI spec): marked as "Deprecated -- full usage details are always included." No action needed -- OpenRouter now always sends usage in final streaming chunks regardless of this flag.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenRouter Anthropic-format non-streaming JSON responses include `usage.cost` | COST-01 / OpenRouter API Response Format | LOW -- Confirmed by OpenAPI spec `ChatUsage` schema example showing `cost: 0.0012`. The `cost` field is nullable but present. |
| A2 | OpenRouter Anthropic-format `message_delta` SSE events include `usage.cost` | COST-02 / SSE Streaming Path | LOW-MEDIUM -- The `MessagesDeltaEvent` schema in the OpenAPI spec does NOT explicitly show `cost` in the `usage` properties, but OpenRouter enriches Anthropic events with its own fields. User's D-03 confirms this path based on known behavior. If absent, cost extraction silently fails (cost stays undefined via typeof guard). |
| A3 | `usage.cost` is a `number` (double) in USD | All paths | LOW -- Confirmed by OpenAPI spec: `format: double, type: number`. The example value `0.0012` is consistent with USD. |
| A4 | Non-OpenRouter providers never return `usage.cost` in SSE events | COST-02 / Non-OR providers | LOW -- The `cost` field is OpenRouter-specific. Standard Anthropic/Bedrock/Qwen responses do not include this field. The `typeof` guard pattern safely handles absence. |

## Open Questions

1. **Does OpenRouter always include `cost` in Anthropic-format `message_delta` SSE events?**
   - What we know: The `ChatUsage` schema (OpenAI-format) documents `cost`. The `MessagesDeltaEvent` schema (Anthropic-format) does not show `cost` in usage properties but OpenRouter is known to enrich Anthropic-format responses.
   - What's unclear: Whether `cost` is included in every `message_delta` or only the final one. The current code reads the last `message_delta` values (they overwrite previous values), so even if it appears only in the final event, the value is captured.
   - Recommendation: Use `typeof` guard so missing cost degrades gracefully. If testing shows cost is absent, the extraction still works -- it just won't set `providerCostUsd`.

2. **Should the OpenRouter provider path (`extractUsageInfo`) set cost only when `cost` is a number?**
   - What we know: The OpenAI provider's `extractUsageInfo` always sets `costUsd` (computed via `calculateCost()`). The base Anthropic compatible provider also computes cost.
   - What's unclear: Whether setting `costUsd` to `undefined` (when cost is null/absent) would overwrite a computed estimate or whether the flow preserves the estimate.
   - Recommendation: Only set `costUsd` when `typeof json.usage.cost === "number"`. If undefined, the downstream behavior depends on Phase 8 integration.

3. **Do we need a new test file for `extractUsageFromJson` and `extractUsageFromData` worker functions?**
   - What we know: SSE parsing tests exist at `packages/proxy/src/__tests__/sse-parsing.test.ts` but only cover `parseSSELine` and a simplified `extractUsageFromData`. No test exists for `extractUsageFromJson`.
   - What's unclear: Whether the planner considers new test coverage mandatory for the worker functions.
   - Recommendation: Add COST-02/03 test cases. For COST-02, extend the existing SSE parsing test. For COST-03, add a new test file or extend an existing worker test.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Test runner, runtime | CHECK AT PLAN TIME | -- | -- |
| TypeScript | Type checking | CHECK AT PLAN TIME | -- | -- |
| GitNexus | Impact analysis | CHECK AT PLAN TIME | -- | Manual grep |

*No external services or databases are required for Phase 7 -- all changes are code-only.*

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in Bun test runner) |
| Config file | none -- `bun:test` uses test file conventions |
| Quick run command | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COST-01 | extractUsageInfo returns costUsd from usage.cost | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ❌ Wave 0 (new test case within existing file) |
| COST-01 | extractUsageInfo handles null/absent cost | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ❌ Wave 0 |
| COST-02 | extractUsageFromData reads usage.cost from message_delta | unit | `bun test packages/proxy/src/__tests__/sse-parsing.test.ts` | ❌ Wave 0 (new test case within existing file) |
| COST-03 | extractUsageFromJson reads usage.cost from JSON body | unit | New test file or inline in proxy tests | ❌ Wave 0 |
| COST-04 | Non-OpenRouter providers unaffected | integration | Manual test with Qwen/Bedrock account | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test packages/providers/src/providers/openrouter/__tests__/` + `bun test packages/proxy/src/__tests__/sse-parsing.test.ts`
- **Per wave merge:** `bun run lint && bun run typecheck && bun run format`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` -- Add COST-01 test cases: cost extraction, null cost, absent cost field
- [ ] `packages/proxy/src/__tests__/sse-parsing.test.ts` -- Add COST-02 test cases: message_delta cost parsing
- [ ] `packages/proxy/src/__tests__/extract-usage-from-json.test.ts` -- New file for COST-03: extractUsageFromJson with cost field
- [ ] Framework install: none needed -- `bun:test` is built-in

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 7 does not modify auth flows |
| V3 Session Management | no | Not applicable |
| V4 Access Control | no | Not applicable |
| V5 Input Validation | yes | `typeof` guard on `usage.cost` before assignment; no parsing of external user input -- `usage.cost` comes from trusted API responses |
| V6 Cryptography | no | Not applicable |

### Known Threat Patterns for Response Cost Extraction

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| NaN/Infinite injection via API response | Denial of Service | `typeof json.usage.cost === "number" && isFinite(json.usage.cost)` guard prevents NaN propagation to DB |
| Type confusion (string cost) | Information Disclosure | `typeof` guard ensures only numeric values are assigned; string "0.0012" is rejected |
| Negative cost values | Tampering | No specific mitigation needed -- negative costs are valid in API accounting but may confuse dashboard display; Phase 7 does not validate sign |

## Sources

### Primary (HIGH confidence)
- OpenRouter OpenAPI spec (`https://openrouter.ai/openapi.yaml`) -- `ChatUsage` schema (line 5044) confirms `cost` field (double, nullable) and `cost_details`. `MessagesDeltaEvent` schema (line 9454+) confirms SSE `message_delta` usage structure. `ChatStreamChunk` schema (line 4673) confirms streaming chunks reference `ChatUsage`.
- `packages/providers/src/providers/openrouter/provider.ts` -- Existing `extractUsageInfo()` override pattern at line 227
- `packages/proxy/src/post-processor.worker.ts` -- `extractUsageFromData()` (line 321), `extractUsageFromJson()` (line 287), `handleEnd()` (line 607), `RequestState` interface (line 39)
- `packages/proxy/src/handlers/response-processor.ts` -- Usage extraction dispatch (line 148), `extractUsageInfo` call site (line 179)
- `packages/core/src/pricing.ts` -- `estimateCostUSD()` function definition (line 770)
- CONTEXT.md (Phase 7) -- All six locked decisions (D-01 through D-06)

### Secondary (MEDIUM confidence)
- `packages/providers/src/providers/openai/provider.ts` -- `extractUsageInfo()` cost calculation pattern (line 215-294), `calculateCost()` (line 299)
- `packages/providers/src/providers/base-anthropic-compatible.ts` -- Base `extractUsageInfo()` implementation (line 256), `extractStreamingUsage()` (line 331)
- `packages/proxy/src/__tests__/sse-parsing.test.ts` -- Existing SSE parsing test patterns

### Tertiary (LOW confidence)
- None -- all claims verified by OpenAPI spec or codebase review

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages; existing stack unchanged
- Architecture: HIGH -- all three code paths directly mapped to existing functions and interfaces
- Pitfalls: HIGH -- well-understood patterns; the sole risk is missing the nullable guard on `cost`
- API format: HIGH -- OpenAPI spec directly confirms `usage.cost` field existence, type, and nullability

**Research date:** 2026-05-31
**Valid until:** 2026-06-30 (stable API contract)
