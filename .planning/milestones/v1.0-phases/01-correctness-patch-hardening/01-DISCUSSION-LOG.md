# Phase 1: Correctness & Patch Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-04
**Phase:** 1-Correctness & Patch Hardening
**Areas discussed:** CACHE-02 injection design, PATCH-02 test placement, PATCH-01 comment format

---

## CACHE-02 Injection Design

### Q1: What is the intent for cache_control placement?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-block on last system message item | Modify last item of body.system[] content array. Works across Anthropic + Bedrock + Vertex. Requires restructuring if system is a plain string. | |
| Top-level body.cache_control stays | Keep current approach. Simpler but flags as silently failing for Bedrock/Vertex routes. | |
| Both — top-level + per-block | Belt-and-suspenders: both top-level AND per-block on last system content item. | ✓ |

**User's choice:** Both — top-level for compat + per-block where possible

---

### Q2: Should injection be gated on anthropic/* model prefix?

*(Initial question before research)*

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — only inject for anthropic/* models | Only inject when body.model starts with 'anthropic/'. Matches REQUIREMENTS.md spec. | |
| No — inject for all models | Keep current behavior. Simpler. | ✓ |

**User's choice:** No — inject for all models

---

### Q3: Update the existing test?

| Option | Description | Selected |
|--------|-------------|----------|
| Update it — assert both top-level AND per-block | Expand test to verify both behavior paths. | ✓ |
| Leave it unchanged | Keep only top-level assertion. | |

**User's choice:** Update it — assert both top-level AND per-block

---

### Research interlude: OpenRouter caching behavior

Research was conducted via web search. Key finding: **Top-level `cache_control` restricts OpenRouter routing to Anthropic-direct only — excludes Bedrock and Vertex**. Per-block explicit `cache_control` works across all three backends.

Source: https://openrouter.ai/docs/guides/best-practices/prompt-caching — exact quote: *"when it is present, OpenRouter will only route to the Anthropic provider and exclude Bedrock and Vertex endpoints."*

---

### Q4: Given routing side-effect, gate on anthropic/* prefix?

*(Revisited after routing research)*

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — gate on anthropic/* (Recommended) | Clean, matches LiteLLM and every other proxy. | |
| No — inject for all models, accept silent ignores | Likely harmless. No documented errors. | ✓ |

**User's choice:** No — inject for all models. User questioned where the routing side-effect was documented, leading to the research that confirmed it.

---

### Research interlude: Per-role caching strategies across all providers

Extended research on caching support for system / user / assistant / tools roles across Anthropic, OpenAI, Gemini, DeepSeek, and OpenRouter. Key findings:

- Anthropic: per-block cache_control on tools[], system[], user[], assistant[] — up to 4 breakpoints
- OpenRouter: forwards per-block to Anthropic/Bedrock/Vertex; only last breakpoint forwarded to Gemini
- OpenAI, DeepSeek: fully automatic — no cache_control field
- Optimal breakpoints for agentic session: tools (last tool) → system (last block) → last assistant turn

User noted: "do not assume non-anthropic models are fully automatic, because there are providers that do not provide prompt caching for some models."

---

### Q5: Which roles should get cache_control injection?

| Option | Description | Selected |
|--------|-------------|----------|
| System only (per REQUIREMENTS.md) | Matches original spec. Simplest. | |
| System + tools (Recommended) | Last system block + last tool. Highest-ROI breakpoints. | |
| System + tools + last assistant turn | Also caches conversation history. Best for agentic sessions. | ✓ |

**User's choice:** System + tools + last assistant turn

---

### Q6: TTL for different breakpoints?

| Option | Description | Selected |
|--------|-------------|----------|
| 1h TTL for tools + system, 5m for assistant turns | Stable content gets longer TTL. More efficient for long sessions. | |
| Default 5m TTL for everything | Simpler. No ttl key. | ✓ |

**User's choice:** Leave TTL out — use `{ type: "ephemeral" }` only. No `ttl` key.

---

### Q7: Final injection strategy (revised from earlier "both" choice)

After research established that top-level `cache_control` restricts Bedrock/Vertex routing, the final strategy was revised:

| Option | Description | Selected |
|--------|-------------|----------|
| Per-block only on last system content item | Works across all backends. No routing side-effects. | ✓ |
| Both: top-level + per-block | Top-level locks to direct Anthropic. | |
| Top-level only | Keep current behavior. | |

**Final decision:** Per-block only across 3 roles (tools, system, last assistant turn). No top-level injection.

---

## PATCH-02 Test Placement

### Q1: Where should the unit test live?

| Option | Description | Selected |
|--------|-------------|----------|
| New file: openai/__tests__/provider.test.ts (Recommended) | Co-located with source. Matches kilo/qwen pattern. | |
| Add to existing openrouter/__tests__/provider.test.ts | Keeps tests consolidated. | ✓ |

**User's choice:** Add to existing openrouter/__tests__/provider.test.ts

---

### Q2: How much coverage?

| Option | Description | Selected |
|--------|-------------|----------|
| Happy path + regression guard (Recommended) | Non-streaming response with cache_write_tokens returns non-zero. Minimal but fails if patch removed. | ✓ |
| Happy path + edge cases | Also cover missing field, null values, fallback scenarios. | |

**User's choice:** Happy path + regression guard

---

## PATCH-01 Comment Format

### Q1: What should the comment say?

| Option | Description | Selected |
|--------|-------------|----------|
| // FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter) | Descriptive. Explains what and why. | ✓ |
| // FORK PATCH | Minimal tag only. | |

**User's choice:** `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)`

---

## Claude's Discretion

None — user made explicit choices for all areas.

## Deferred Ideas

- **1h TTL for tools and system** — Discussed, deferred to keep Phase 1 minimal. Tools and system are stable; `ttl: "1h"` would improve cache hit rates for long agentic sessions but adds complexity.
- **4th breakpoint on large user documents** — Up to 4 breakpoints supported; a 4th on repeated large user-turn documents would help document-heavy sessions. Not in Phase 1 scope.
- **CACHE-03 / CACHE-04** — v2 requirements (multi-breakpoint placement, 1h TTL for agentic sessions). Deferred to next milestone.
