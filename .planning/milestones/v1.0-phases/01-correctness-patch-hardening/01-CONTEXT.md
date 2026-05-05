# Phase 1: Correctness & Patch Hardening - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix two silent correctness bugs in the OpenRouter provider (cache token extraction and cache_control injection), mark the fork's key patch with a `// FORK PATCH:` comment, and add a regression test that fails if the patch is removed. All work is localized to `packages/providers/src/providers/openrouter/` and `packages/providers/src/providers/openai/provider.ts`.

</domain>

<decisions>
## Implementation Decisions

### CACHE-01: Non-streaming cache token extraction
- **D-01 (UPDATED 2026-05-04):** Add `extractUsageInfo` override in `OpenRouterProvider` to read `usage.prompt_tokens_details.cache_write_tokens`. The base class extraction at `openai/provider.ts:264` is unreachable from the OpenRouter inheritance chain (`OpenRouterProvider → AnthropicCompatibleProvider → BaseAnthropicCompatibleProvider`), which reads `cache_creation_input_tokens` — a field OpenRouter never returns. Original D-01 ("no code change needed") was based on an incorrect assumption about the inheritance hierarchy; corrected after research verification and user approval.

### CACHE-02: cache_control injection
- **D-02:** Inject `{ type: "ephemeral" }` per-block at **3 breakpoints** per request:
  1. Last tool object in `tools[]` array (if present)
  2. Last content block in `system[]` array. If `body.system` is a plain string, convert it to `[{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }]`
  3. Last content block of the **last assistant-role message** in `messages[]` (if an assistant turn exists)
- **D-03:** No TTL field — use `{ type: "ephemeral" }` only (no `ttl` key)
- **D-04:** No model prefix gating — inject for all models. Silent ignores by non-Anthropic providers are acceptable.
- **D-05:** Per-block injection only — **do NOT inject top-level `body.cache_control`**. Per-block works across Anthropic direct, Bedrock, and Vertex; top-level restricts routing to Anthropic-only and excludes Bedrock/Vertex.
- **D-06:** Update the existing openrouter test file to assert all 3 injection points (tools, system block, last assistant turn). The old top-level `body.cache_control` assertion is no longer the target behavior.

### PATCH-01: Fork patch comment
- **D-07:** Add `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)` as an inline comment on the `cache_write_tokens` extraction line in `packages/providers/src/providers/openai/provider.ts`

### PATCH-02: Regression test
- **D-08:** Add the test to the existing `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` file (not a new file)
- **D-09:** Scope: happy path + regression guard only — test that a non-streaming response with `usage.prompt_tokens_details.cache_write_tokens` set returns a non-zero `cacheCreationInputTokens`. Edge cases (missing field, null values) are out of scope for this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Provider source files
- `packages/providers/src/providers/openai/provider.ts` — Base class containing the non-streaming `getUsage()` path with `prompt_tokens_details` extraction (CACHE-01 / PATCH-01 / PATCH-02 target)
- `packages/providers/src/providers/openrouter/provider.ts` — OpenRouter-specific `transformRequestBody()` override (CACHE-02 target)
- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — Existing test file to be updated (CACHE-02 test update + PATCH-02 addition)

### Requirements
- `.planning/REQUIREMENTS.md` §v1 — CACHE-01, CACHE-02, PATCH-01, PATCH-02 definitions with acceptance criteria
- `.planning/ROADMAP.md` §Phase 1 — Success criteria (4 items)

### Caching research context (for planner)
- OpenRouter only routes to Anthropic-direct when top-level `cache_control` is present; per-block injection preserves Bedrock/Vertex routing. Source: https://openrouter.ai/docs/guides/best-practices/prompt-caching
- Anthropic supports `cache_control` per-block on: `tools[]` (last tool), `system[]` (last block), `messages[]` user/assistant content blocks. Max 4 breakpoints per request.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `OpenAICompatibleProvider.transformRequestBody()` in `openai/provider.ts` — `OpenRouterProvider` already overrides this; the CACHE-02 injection lives in `OpenRouterProvider.transformRequestBody()` which calls `super.transformRequestBody()` first
- `bun:test` with `describe`/`it`/`expect` — test pattern already established in `openrouter/__tests__/provider.test.ts`

### Established Patterns
- `transformRequestBody(request, account)` — async method, clones request body as JSON, mutates, returns new `Request`. Body manipulation must use `mapped.clone().json()` then reconstruct with `new Request(url, { method, headers, body: JSON.stringify(body) })`
- Test factories: construct `Request` with JSON body inline; call provider method directly; assert on parsed JSON result

### Integration Points
- `OpenRouterProvider extends AnthropicCompatibleProvider` → inherits from `OpenAICompatibleProvider` → `BaseProvider`. Cache injection belongs in `OpenRouterProvider.transformRequestBody()` only.
- Non-streaming `getUsage()` lives in `OpenAICompatibleProvider` (openai/provider.ts), not in the OpenRouter subclass. PATCH-01 comment goes on that base class method.

</code_context>

<specifics>
## Specific Ideas

- The 3-breakpoint injection order (tools → system → last assistant turn) follows the Anthropic cache hierarchy: tools are at the top (most stable), system next, messages last. This ensures cache invalidation cascades correctly — changing tools invalidates everything below it.
- If `body.system` is already an array of content blocks, add `cache_control` to the last element without restructuring. Only convert to array if it's a plain string.
- The last-assistant-turn injection enables conversation history caching for agentic/Claude Code sessions — the primary use case for this proxy.

</specifics>

<deferred>
## Deferred Ideas

- **1h TTL for tools and system** — Discussed but deferred: tools and system prompts are stable and would benefit from `{ type: "ephemeral", ttl: "1h" }` (2x write cost, much higher cache hit rate for long sessions). Left out to keep the implementation minimal for Phase 1; can be revisited in a later phase.
- **4th breakpoint (large user document)** — Up to 4 breakpoints are supported; a 4th on a large repeated user-turn document would improve caching for document-heavy sessions. Deferred — not part of Phase 1 scope.
- **CACHE-03 / CACHE-04** — Extended caching requirements from `REQUIREMENTS.md` v2 (multi-breakpoint placement, 1h TTL for agentic sessions). Deferred to next milestone per roadmap.

</deferred>

---

*Phase: 1-Correctness & Patch Hardening*
*Context gathered: 2026-05-04*
