# Pitfalls

**Project:** better-ccflare — OpenRouter integration, provider routing, fork maintenance
**Researched:** 2026-05-04
**Overall confidence:** HIGH (verified against codebase state + official docs)

---

## Prompt Caching Pitfalls

### 1. Top-level `cache_control` only works with Anthropic-direct, not all OpenRouter routes

**What goes wrong:** The current implementation injects `cache_control: { type: "ephemeral" }` at the **top level of the request body** in `OpenRouterProvider.transformRequestBody`. OpenRouter's own documentation explicitly states: "Top-level `cache_control` is only supported when requests are routed to the Anthropic provider directly." When OpenRouter routes to Bedrock or Vertex, the top-level field is silently ignored and no cache is established.

**Evidence:** HIGH confidence — verified against official OpenRouter prompt caching docs and confirmed by community issue [OpenRouterTeam/ai-sdk-provider#35](https://github.com/OpenRouterTeam/ai-sdk-provider/issues/35) where only system prompt caching worked even after workarounds.

**Detection:** Cache read tokens (`cached_tokens` in `prompt_tokens_details`) remain zero despite repeated identical prompts. Billing does not show cache discounts.

**Prevention:** Use per-block `cache_control` placed inside specific message `content` array items, not at the request top level. This works across all provider routes, not just Anthropic-direct. For Claude models specifically, this means injecting `cache_control` into the last system message or a high-token user message block, not the root body object.

---

### 2. The `usage` object structure differs between Anthropic native and OpenRouter

**What goes wrong:** Anthropic native responses use `cache_creation_input_tokens` and `cache_read_input_tokens` at the top level of `usage`. OpenRouter (when routing through OpenAI-compatible paths) wraps these inside `usage.prompt_tokens_details` as `cache_write_tokens` and `cached_tokens` — different field names, nested differently.

**Evidence:** HIGH confidence — verified directly in the codebase. The local fork patch in `packages/providers/src/providers/openai/provider.ts` adds exactly this fallback:
```
promptTokensDetails?.cache_creation_input_tokens ||
promptTokensDetails?.cache_write_tokens ||
0
```
The upstream (`tombii/better-ccflare`) does not have this. The real-world consequence is documented in [anomalyco/opencode#18440](https://github.com/anomalyco/opencode/issues/18440): a user paid $20 while the tracker showed $4 — a 5x underestimation — because cache write tokens were not extracted from the OpenRouter response shape.

**Detection:** Cost tracking diverges from actual OpenRouter billing after the first cache-write request. Cache write events show $0 in stats even when a new cache entry was established.

**Prevention:** Always handle both field shapes. Check `usage.cache_creation_input_tokens` (Anthropic native) AND `usage.prompt_tokens_details?.cache_write_tokens` (OpenRouter/OpenAI-compatible path). This fork already does this; it must not be lost in upstream merges.

---

### 3. Minimum token thresholds silently prevent cache activation

**What goes wrong:** Caching silently does nothing if the cacheable content does not meet the model's minimum token threshold. The thresholds vary:

| Claude model | Min tokens to cache |
|---|---|
| Opus 4.7 / 4.6 / 4.5 | 4,096 |
| Sonnet 4.6 | 2,048 |
| Sonnet 4.5 / Opus 4.1 / Opus 4 / Sonnet 4 / Sonnet 3.7 | 1,024 |
| Haiku 4.5 | 4,096 |
| Haiku 3.5 | 2,048 |

**Evidence:** HIGH confidence — official OpenRouter prompt caching docs, cross-referenced with Anthropic docs.

**Detection:** `cache_write_tokens` is always 0 even on first requests with explicit `cache_control` breakpoints. The system prompt or content block being marked is under the threshold.

**Prevention:** Validate that the content targeted by a cache breakpoint is above the threshold for the target model before expecting caching to activate. Short system prompts on Haiku 4.5 (under 4,096 tokens) will never cache.

---

### 4. The 5-minute TTL resets silently; sticky routing does not survive provider failover

**What goes wrong:** OpenRouter's sticky routing keeps cache warm by routing subsequent requests to the same upstream provider. The default TTL is approximately 5 minutes. If the sticky provider becomes unavailable and OpenRouter fails over to another provider, the new provider has no knowledge of the cache — a full cache miss plus a write charge occurs. This is invisible to the caller: the request succeeds with HTTP 200, but `cache_write_tokens` spikes in the response.

The `prompt_cache_ttl` top-level parameter is silently ignored by OpenRouter. The correct mechanism for a 1-hour TTL is `cache_control: { type: "ephemeral", ttl: "1h" }` placed on the content block — but this costs more per write (roughly 2x write price).

**Evidence:** MEDIUM confidence — OpenRouter prompt caching docs + [opencode#16848](https://github.com/anomalyco/opencode/issues/16848) which documents the silently-ignored `prompt_cache_ttl` parameter and the correct alternative.

**Detection:** Periodic spikes in `cache_write_tokens` on otherwise identical requests after a quiet period. Correlates with 5-minute idle gaps.

**Prevention:** For long-running sessions where cache misses are expensive, use `ttl: "1h"` on the content block. Accept the higher write cost in exchange for resilience against sticky routing resets.

---

### 5. Model/provider combinations that do not support caching at all

**What goes wrong:** Injecting `cache_control` for non-Anthropic models routed through OpenRouter (e.g., `openai/gpt-4o`, `google/gemini-2.5-pro`, `deepseek/deepseek-chat`) is either silently ignored or causes a 400 error depending on the model's provider. Only the models listed in the official support table will respond with cache metrics. For providers with automatic caching (OpenAI, DeepSeek, Gemini 2.5, Groq), sending explicit `cache_control` is unnecessary — they cache automatically.

**Evidence:** HIGH confidence — OpenRouter prompt caching docs.

**Prevention:** Gate `cache_control` injection on model prefix. Only inject for `anthropic/*` model slugs. For others, let the provider handle caching automatically and still parse `prompt_tokens_details` for cache metrics.

---

## Provider Selection Pitfalls

### 1. `provider.only` with a single provider eliminates all fallback

**What goes wrong:** When `provider: { only: ["Anthropic"] }` is set, OpenRouter will not route to any other provider if Anthropic is unavailable, rate-limited, or refuses the request. The request fails entirely rather than degrading gracefully. This is documented explicitly: "Only allowing some providers may significantly reduce fallback options."

**Evidence:** HIGH confidence — official OpenRouter provider routing docs.

**Detection:** Requests fail with 4xx/5xx rather than succeeding with higher latency during Anthropic outages.

**Prevention:** Prefer `provider.order` over `provider.only`. `order` sets preference without eliminating fallback. Only use `only` when routing to a specific provider is a hard requirement (e.g., compliance/data residency).

---

### 2. Mid-stream provider failure returns HTTP 200 with an SSE error event

**What goes wrong:** If a provider fails after streaming has begun, the HTTP status code is already 200 (headers were sent). The error arrives as an SSE event with `finish_reason: "error"` inside the `choices` array, not as an HTTP error code. Callers that only check HTTP status will silently succeed on a broken stream.

**Evidence:** HIGH confidence — official OpenRouter API error handling docs, cross-confirmed by LiteLLM issue [#19077](https://github.com/BerriAI/litellm/issues/19077) (disable_fallbacks ignored for mid-stream fallback).

**Detection:** Client receives a `choices[0].finish_reason === "error"` in a streaming chunk rather than a complete response.

**Prevention:** The proxy's SSE parsing must check `finish_reason` in every streaming chunk, not just the final one. An `error` finish_reason should be surfaced as a connection error to the downstream caller rather than silently completing.

---

### 3. `allow_fallbacks: false` behavior during streaming is inconsistent

**What goes wrong:** When `allow_fallbacks: false` is set alongside streaming, mid-stream errors have been observed to still trigger internal fallback attempts in some gateway implementations, ignoring the disable flag. The request may succeed via a fallback provider even though the caller specified no fallbacks — breaking the guarantee that only the pinned provider was used.

**Evidence:** MEDIUM confidence — documented as a bug in LiteLLM [#19077](https://github.com/BerriAI/litellm/issues/19077) (not OpenRouter itself, but the same gateway pattern). OpenRouter's own behavior here is not explicitly documented.

**Prevention:** Treat `allow_fallbacks: false` as best-effort for streaming, not a hard guarantee. Verify via response metadata (`x-openrouter-provider` header if available) that the intended provider served the request.

---

### 4. Provider routing does not interact with sticky caching routing

**What goes wrong:** When you specify `provider.order`, OpenRouter respects your ordering and does **not** apply its own sticky routing for cache optimization. This means provider pinning and cache efficiency are mutually exclusive with the default sticky routing mechanism. You get routing control or cache optimization, not both.

**Evidence:** MEDIUM confidence — OpenRouter prompt caching docs state: "sticky routing is not used when you specify a manual provider order via provider.order."

**Prevention:** If cache hit rate matters, do not use `provider.order`. Let OpenRouter manage routing. If provider pinning is required, account for higher write token costs in the pricing model.

---

### 5. Model availability changes silently when a provider is pinned

**What goes wrong:** A model may be available through OpenRouter's load-balanced routing but unavailable from a specific pinned provider. The request fails without a clear error explaining that the model exists but not on the requested provider.

**Evidence:** MEDIUM confidence — inferred from OpenRouter FAQ and [openclaw#10869](https://github.com/openclaw/openclaw/issues/10869) which documents provider pinning availability gaps.

**Detection:** 404 or "model not found" errors on a model that works without pinning.

**Prevention:** Test model availability on specific providers explicitly before deploying with provider pins. Document which models were verified on which providers and at what date, since providers add/remove models without notice.

---

## Fork Maintenance Pitfalls

### 1. The `openai/provider.ts` patch touches a shared, high-churn file

**What goes wrong:** This fork has a patch in `packages/providers/src/providers/openai/provider.ts` that adds `cache_write_tokens` extraction from `prompt_tokens_details`. This file is a shared base provider that upstream (`tombii/better-ccflare`) actively refactors. The diff already shows upstream removed `thinkingBlockClosed`, renamed `toolCallBlockIndices` to `toolCallAccumulators`, and changed `endTurnBlockIndex` handling in `packages/openai-formats/src/stream.ts`. These are exactly the kinds of refactors that will conflict with the local patch.

**Evidence:** HIGH confidence — confirmed by running `git diff upstream/main HEAD` against actual repo state. The fork is currently 5 commits ahead of upstream on `thamw-main`, with 63 files diverged.

**Detection:** `git diff --name-only upstream/main HEAD | grep openai` shows the files. Run this before every upstream merge.

**Prevention:**
1. Keep the patch minimal — the existing patch adds only 3 lines to the `cache_creation_input_tokens` extraction block. This is a good footprint.
2. Write the merge check as a CI step: `git merge-tree $(git merge-base HEAD upstream/main) upstream/main HEAD -- packages/providers/src/providers/openai/provider.ts` — a non-empty result indicates a merge conflict before it happens.
3. Keep a comment in the patched block: `// FORK PATCH: OpenRouter uses prompt_tokens_details.cache_write_tokens` so reviewers understand why the line exists and do not remove it as "dead code" during an upstream merge.

---

### 2. `bun.lock` conflicts are guaranteed on every upstream merge

**What goes wrong:** Both forks are actively adding packages. The `bun.lock` file has a single-file format that records every resolved dependency version. Any upstream package addition or version change will conflict with any local `bun.lock` change. Bun's lockfile format is not human-friendly for three-way merges — the auto-merge result is often semantically invalid.

**Evidence:** HIGH confidence — confirmed by `bun.lock` appearing in the 63-file divergence list. This is a known class of problem in Bun monorepos (Bun issue [#20326](https://github.com/oven-sh/bun/issues/20326)).

**Prevention:**
1. Accept the lockfile conflict and regenerate: after resolving all source file conflicts, delete `bun.lock` and run `bun install` to regenerate from the merged `package.json` files.
2. Never manually edit `bun.lock` to resolve conflicts — the result will be silently inconsistent.
3. Run `bun install --frozen-lockfile` in CI to detect lockfile drift before it reaches a merge.

---

### 3. Shared type packages (`packages/types`) drift creates invisible breakage

**What goes wrong:** The fork has local changes to `packages/types/src/account.ts` and `packages/types/src/stats.ts`. When upstream adds fields to the same type files, a successful three-way merge is possible but can produce a type that satisfies both forks' requirements without satisfying either's intent. TypeScript will not catch this if the merged fields are all additive. The runtime behavior may silently differ from both forks' expectations.

**Evidence:** HIGH confidence — confirmed by `packages/types/src/account.ts` and `packages/types/src/stats.ts` in the divergence list. This is a known monorepo shared types hazard.

**Detection:** After every upstream merge, run `bun run typecheck` and look for errors in downstream consumers of the modified type files. Also diff the merged types file manually against both pre-merge versions.

**Prevention:**
1. Namespace fork-specific fields with a comment: `// FORK: added for usage throttling` so they are clearly distinguishable from upstream fields during conflict resolution.
2. Keep type additions minimal and additive (new optional fields), never rename or remove existing upstream fields.

---

### 4. Upstream refactors `transformRequestBody` chain; the OpenRouter override breaks silently

**What goes wrong:** `OpenRouterProvider.transformRequestBody` calls `super.transformRequestBody(request, account)` and then mutates the result. If upstream changes the signature, return type, or semantics of `BaseAnthropicCompatibleProvider.transformRequestBody` (e.g., adds a required parameter, changes what it returns, or removes the method), the override will either fail to compile or silently stop applying its mutation.

**Evidence:** MEDIUM confidence — the pattern is inherently fragile; confirmed by observing that upstream's current `openrouter/provider.ts` has no `transformRequestBody` at all, meaning this is entirely a fork addition with no upstream baseline to rebase against.

**Detection:** Check `git log upstream/main -- packages/providers/src/providers/base-anthropic-compatible.ts` before every merge to see if the parent class changed.

**Prevention:**
1. Add a test that asserts `cache_control` is present in the final request body after `transformRequestBody` runs. This test will fail immediately if the override chain breaks.
2. The existing test in `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` already does this — keep it and run it in CI on every upstream sync.

---

## Early Warning Signs

### Before merging upstream

Run these checks before starting any upstream merge:

```bash
# 1. Files where both forks changed — guaranteed conflict candidates
git diff --name-only upstream/main HEAD

# 2. Whether upstream touched the OpenRouter parent class
git log upstream/main --oneline -- packages/providers/src/providers/base-anthropic-compatible.ts packages/providers/src/providers/openai/provider.ts packages/openai-formats/src/stream.ts

# 3. Whether upstream changed the types this fork modified
git log upstream/main --oneline -- packages/types/src/

# 4. Dry-run merge to surface conflicts without committing
git merge --no-commit --no-ff upstream/main
git merge --abort
```

### After a successful merge

```bash
# Types still compile across all packages
bun run typecheck

# Cache token extraction still works end-to-end
bun test packages/providers/src/providers/openrouter/
bun test packages/providers/src/providers/openai/

# Regenerate lockfile cleanly
rm bun.lock && bun install
```

### Sentinel values to monitor in production

| Signal | What it means |
|---|---|
| `cache_write_tokens > 0` on every request | Cache never hitting — check TTL, provider routing, or min token threshold |
| `cache_write_tokens` always 0, `cached_tokens` also 0 | Field extraction broken — check `prompt_tokens_details` parsing |
| Cost in tracker < 20% of OpenRouter billing | `cache_write_tokens` not being counted in cost model |
| `finish_reason: "error"` in streaming chunks | Provider failed mid-stream; upstream handler may be silently dropping it |
| Requests to non-Anthropic models return 400 | `cache_control` injection not gated on model prefix |

---

## Sources

- [OpenRouter Prompt Caching Docs](https://openrouter.ai/docs/guides/best-practices/prompt-caching) — HIGH confidence, official
- [OpenRouter Provider Routing Docs](https://openrouter.ai/docs/guides/routing/provider-selection) — HIGH confidence, official
- [OpenRouter Error Handling Docs](https://openrouter.ai/docs/api/reference/errors-and-debugging) — HIGH confidence, official
- [OpenRouter Model Fallbacks Docs](https://openrouter.ai/docs/guides/routing/model-fallbacks) — HIGH confidence, official
- [anomalyco/opencode#18440 — Cache write tokens not accounted for](https://github.com/anomalyco/opencode/issues/18440) — HIGH confidence, real-world case with cost data
- [OpenRouterTeam/ai-sdk-provider#35 — Prompt caching not working](https://github.com/OpenRouterTeam/ai-sdk-provider/issues/35) — MEDIUM confidence, community report
- [opencode#16848 — prompt_cache_ttl silently ignored](https://github.com/anomalyco/opencode/issues/16848) — MEDIUM confidence, community report
- [openclaw#10869 — Provider pinning feature gaps](https://github.com/openclaw/openclaw/issues/10869) — MEDIUM confidence, community report
- [LiteLLM#19077 — disable_fallbacks ignored mid-stream](https://github.com/BerriAI/litellm/issues/19077) — MEDIUM confidence (LiteLLM, not OpenRouter, but same SSE pattern)
- [openclaw#23715 — 5x API costs from ineffective caching](https://github.com/openclaw/openclaw/issues/23715) — MEDIUM confidence, real cost data
- Codebase: `git diff upstream/main HEAD` — HIGH confidence, primary source for fork-specific claims
