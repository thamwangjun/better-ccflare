# Phase 7: OpenRouter Response Cost Extraction - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase extracts actual USD cost from OpenRouter API responses (`usage.cost` field) and surfaces it as `costUsd` through three code paths: (1) provider-level `extractUsageInfo()` for non-streaming JSON, (2) worker-level SSE streaming final chunk parsing, and (3) worker-level non-streaming body JSON extraction. The extracted cost is threaded through the existing usage pipeline so Phase 8 can skip `estimateCostUSD()` when real cost is available.

**Phase 7 does NOT:** skip `estimateCostUSD()` (that's Phase 8), modify the DB schema, or change the dashboard display.
</domain>

<decisions>
## Implementation Decisions

### Provider-level non-streaming cost extraction (COST-01)
- **D-01:** Read `json.usage.cost` directly in the existing `OpenRouterProvider.extractUsageInfo()` override at `packages/providers/src/providers/openrouter/provider.ts:227`. Return it as `costUsd` in the result object alongside the existing token counts.
- **D-02:** OpenRouter-only — do NOT add `usage.cost` reading to the base `AnthropicCompatibleProvider` or `OpenAICompatibleProvider`. The override pattern is already established (CACHE-01) and this keeps the change minimal.

### Worker SSE streaming cost extraction (COST-02)
- **D-03:** Parse `usage.cost` from the `message_delta` SSE event in `extractUsageFromData()` (alongside existing token parsing at `packages/proxy/src/post-processor.worker.ts:355`). Stash it in a new `providerCostUsd` field on the `RequestState.usage` object.
- **D-04:** In `handleEnd()`, when `providerCostUsd` is set, skip `estimateCostUSD()` and use the provider-returned value directly. (The actual gating logic — conditionally skipping the estimate — is Phase 8's scope, but the field plumbing must be in place.)

### Worker non-streaming body cost extraction (COST-03)
- **D-05:** Extend the existing `extractUsageFromJson()` function (line 287) to also read `usage.cost` from the parsed JSON body. Store it in the same `providerCostUsd` field on `RequestState.usage`.

### Cost data threading
- **D-06:** The three capture points (provider extractUsageInfo, worker SSE message_delta, worker extractUsageFromJson) all write to the same conceptual field. For the provider path, `costUsd` is returned directly from `extractUsageInfo()` and flows through `updateRequestUsage()` in `response-processor.ts`. For the two worker paths, `providerCostUsd` is stashed in `RequestState.usage` and used in `handleEnd()` instead of calling `estimateCostUSD()`.

### Claude's Discretion
- Exact field name: `providerCostUsd` vs `costUsd` on the worker state — pick whichever avoids shadowing the existing `costUsd` (which holds the final value after estimate). The provider path already returns `costUsd` in the result object, so that path is straightforward.
- Whether to add `cost` to the `extractUsageFromJson` JSON type annotation — yes, to keep TypeScript happy.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — COST-01, COST-02, COST-03 requirements; out-of-scope: `cost_details` breakdown, dashboard changes
- `.planning/ROADMAP.md` — Phase 7 success criteria (4 items), Phase 7/8 split boundary

### Key Source Files
- `packages/providers/src/providers/openrouter/provider.ts` — Existing `extractUsageInfo()` override (line 227); target for COST-01
- `packages/providers/src/providers/openai/provider.ts` — `extractUsageInfo()` in base OpenAI-compatible provider (line 215); reference for `calculateCost()` pattern
- `packages/proxy/src/post-processor.worker.ts` — `extractUsageFromJson()` (line 287), `extractUsageFromData()` (line 321), `handleEnd()` (line 607); targets for COST-02 and COST-03
- `packages/proxy/src/handlers/response-processor.ts` — Usage extraction dispatch (line 148); provider `extractUsageInfo` call site (line 179)

### Existing Tests
- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — `extractUsageInfo` test suite (line 33); add COST-01 test cases
- `packages/providers/src/providers/openai/__tests__/process-response.test.ts` — `extractUsageInfo` test suite (line 476); reference for cost assertion patterns
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`extractUsageInfo()` override pattern** in `OpenRouterProvider` (line 227): already overrides the base class to read `prompt_tokens_details.cache_write_tokens` — extend this same method to also read `usage.cost`
- **`RequestState.usage` interface** in worker (line 39-49): already has `costUsd?: number` field — add `providerCostUsd?: number` alongside it
- **`extractUsageFromJson()` function** (line 287): already reads `usage.input_tokens`, `usage.output_tokens`, etc. from JSON — add `usage.cost` to the same destructuring

### Established Patterns
- **Provider override, not base class modification**: All fork patches follow this — `OpenRouterProvider` overrides methods from `AnthropicCompatibleProvider` rather than changing the base. COST-01 follows this pattern.
- **Worker state mutation**: The SSE parser (`extractUsageFromData`) mutates `state.usage` fields directly. COST-02/03 follow the same pattern — add `providerCostUsd` mutation alongside existing token field mutations.
- **`handleEnd()` cost calculation**: Currently always calls `estimateCostUSD()` at line 665. The new field allows a conditional skip (Phase 8), but the plumbing is Phase 7.

### Integration Points
- **Provider → response-processor**: `extractUsageInfo()` result flows through `response-processor.ts:179-205` → `ctx.dbOps.updateRequestUsage(requestId, usageInfo)` → stored in `requests` table. Adding `costUsd` to the return object flows through automatically.
- **Worker → DB**: `handleEnd()` calls `ctx.dbOps.createRequest()` at line ~770 with `costUsd: state.usage.costUsd`. The `providerCostUsd` field feeds into `state.usage.costUsd` before the DB write.
- **Non-OpenRouter providers**: Must continue to work with zero changes. The `usage.cost` field is only present in OpenRouter responses; other providers won't have it, so `providerCostUsd` stays undefined and `estimateCostUSD()` runs as before.
</code_context>

<specifics>
## Specific Ideas

No specific design references or examples mentioned — implementation follows the existing patterns in the codebase.
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.
</deferred>

---

*Phase: 7-OpenRouter Response Cost Extraction*
*Context gathered: 2026-05-31*