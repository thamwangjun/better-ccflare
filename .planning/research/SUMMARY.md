# Research Summary — better-ccflare Fork

## Recommended Stack / Approach

The codebase's existing patterns are correct and no architectural changes are needed for either feature. Provider-specific logic stays in `OpenRouterProvider.transformRequestBody()`, the subclass override chain handles model mapping via `super.transformRequestBody()`, and tests live in `__tests__/provider.test.ts` against Request/response objects directly.

For prompt caching: move from top-level `cache_control` injection to per-block `cache_control` placed on the last system message content block, gated on `anthropic/*` model prefix. This is the only form that works across all OpenRouter provider routes including Bedrock and Vertex.

For provider selection: accept a passthrough header (`x-better-ccflare-openrouter-provider`) and inject `body.provider = { order: [...], allow_fallbacks: true }` inside `transformRequestBody`. Prefer `order` over `only` to preserve fallback routing.

For fork maintenance: rebase discipline on `thamw-main` (primary), merge fallback for large upstream releases. Enable `git rerere`. Tag merge points. Export patches to `.planning/patches/` after each integration.

---

## Table Stakes

These must work correctly before either feature can be trusted in production:

1. **Cache token extraction on non-streaming OpenRouter responses.** `AnthropicCompatibleProvider.extractUsageInfo()` reads `usage.input_tokens` and `usage.cache_creation_input_tokens` — fields that do not exist in OpenRouter responses. OpenRouter returns `usage.prompt_tokens` and `usage.prompt_tokens_details.cache_write_tokens`. Non-streaming responses silently report zero cache tokens until this is fixed. The streaming path is already correct via the existing fork patch.

2. **`cache_control` injection gated on model prefix.** The current injection fires for all models. Injecting `cache_control` for non-Anthropic models is either silently ignored or causes 400 errors. Gate must check `body.model.startsWith("anthropic/")` before injecting.

3. **`cache_write_tokens` patch must survive upstream merges.** The existing fork patch in `packages/providers/src/providers/openai/provider.ts` (3 lines) is in a high-churn file that upstream actively refactors. Must be tagged `// FORK PATCH:` and covered by a test that fails on regression.

---

## Differentiators / Nice-to-haves

- Per-block explicit cache breakpoints on both system message and a high-token user message (up to the 4-breakpoint limit). The current single top-level injection is coarser.
- `ttl: "1h"` on content blocks for long agentic sessions. Prevents cache misses from sticky routing resets after 5-minute idle gaps at 2x write price.
- Provider selection via account-level config field rather than only a passthrough header — per-account control without client cooperation.
- Merge pre-flight CI check using `git merge-tree` dry-run on the three highest-risk files before each upstream integration.
- Contributing the `cache_write_tokens` patch upstream to eliminate the highest-conflict file from the fork delta permanently.

---

## Watch Out For

**1. Top-level `cache_control` silently fails on Bedrock/Vertex routes.**
Prevention: switch to per-block injection on `anthropic/*` models only; skip for all other model prefixes.

**2. `cache_write_tokens` extraction gap causes 5x cost underreporting.**
Prevention: handle both `usage.cache_creation_input_tokens` (Anthropic native) and `usage.prompt_tokens_details.cache_write_tokens` (OpenRouter) in `extractUsageInfo`; add a test asserting non-zero cache write tokens from a mock OpenRouter non-streaming response.

**3. `provider.only` eliminates all fallback; use `provider.order` instead.**
Prevention: default to `order` with `allow_fallbacks: true`; reserve `only` for explicit compliance/ZDR requirements.

**4. `openai/provider.ts` patch conflicts on every upstream refactor.**
Prevention: keep the patch minimal (currently 3 lines), comment it clearly, run `git log upstream/main -- packages/providers/src/providers/openai/provider.ts` before every merge, regenerate `bun.lock` (never manually merge it) after any merge.

**5. Provider pinning and sticky cache routing are mutually exclusive.**
Prevention: when `provider.order` is injected, document that cache hit rates may drop; for cache-critical workloads, omit provider selection and let OpenRouter manage sticky routing.

---

## Phase Implications

### Phase 1: Correctness fixes (must go first)

Fix the two silent failure modes affecting live behavior and billing today.

1. Override `extractUsageInfo()` in `OpenRouterProvider` to handle `prompt_tokens` + `prompt_tokens_details` for the non-streaming path. Streaming is already correct — do not touch it.
2. Gate `cache_control` injection on `body.model.startsWith("anthropic/")`. Move from top-level to per-block injection on the last system message content item.
3. Add `// FORK PATCH:` comment to the `openai/provider.ts` line. Add a unit test asserting non-zero cache token extraction from a mock OpenRouter non-streaming response.

**Dependencies:** None. Pure bug fixes in contained files.

---

### Phase 2: Provider selection feature

Accept a provider preference and inject `body.provider` in `transformRequestBody`.

1. Start with passthrough header `x-better-ccflare-openrouter-provider` (zero DB schema change).
2. Inject `body.provider = { order: [header_value], allow_fallbacks: true }` when header is present.
3. Document the cache efficiency trade-off (provider pinning disables sticky routing).

**Dependencies:** Phase 1 should land first so `extractUsageInfo` is correct before routing complexity changes which provider serves requests.
**Pitfalls:** Use `order` not `only`. Account for mid-stream 200-with-error SSE — check `finish_reason === "error"`.

---

### Phase 3: Fork maintenance hardening

Automate pre-flight and post-merge checks so upstream syncs stay low-friction.

1. Enable `git rerere`. Create `.planning/scripts/pre-merge-check.sh` (4 git diff/log commands).
2. Add patch export to `.planning/patches/` as a post-merge step.
3. Add merge commit tagging (`merged-upstream-YYYYMMDD`).
4. Open upstream contribution PR for Phase 1's `cache_write_tokens` fix once validated stable.

**Dependencies:** Phases 1 and 2 must be stable.
**Pitfalls:** Never manually edit `bun.lock`; always `rm bun.lock && bun install`. Tag shared-type changes with `// FORK:` comments.

---

## Open Questions

1. **Non-streaming guard in `post-processor.worker.ts`:** Confirm whether a non-streaming OpenRouter request reaches `extractUsageInfo` in `base-anthropic-compatible.ts` or is short-circuited by the worker's `handleEnd` path before writing Phase 1's override.

2. **Account config schema for provider preferences:** Phase 2 starts with a passthrough header for zero schema friction. Persisting provider preference per-account requires `packages/types/src/account.ts` change (a high-conflict file). Defer to header-only until there is a concrete use case.

3. **Upstream contribution timing:** Contribute the `cache_write_tokens` patch upstream immediately after Phase 1 validates it. Check open issues on `tombii/better-ccflare` for prior art first.

4. **Non-Anthropic model usage extraction gap:** OpenRouter-routed non-Anthropic models returning OpenAI-format SSE will report zero usage. Deferred — address only if non-Anthropic models are actively used through this proxy.

---

*Synthesized: 2026-05-04 from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md*
