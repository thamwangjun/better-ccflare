---
phase: 01-correctness-patch-hardening
plan: 01
subsystem: providers/openrouter
tags: [cache, openrouter, bug-fix, extractUsageInfo, transformRequestBody]
requirements: [CACHE-01, CACHE-02]
dependency_graph:
  requires: []
  provides: [OpenRouterProvider.extractUsageInfo, OpenRouterProvider.transformRequestBody 3-breakpoint]
  affects: [billing display, cache routing]
tech_stack:
  added: []
  patterns: [TDD red-green, per-block cache_control injection]
key_files:
  created: []
  modified:
    - packages/providers/src/providers/openrouter/provider.ts
    - packages/providers/src/providers/openrouter/__tests__/provider.test.ts
decisions:
  - "Override extractUsageInfo in OpenRouterProvider rather than modify base class — OpenRouter's prompt_tokens_details format is non-standard; base class reads Anthropic-native cache_creation_input_tokens"
  - "Delegate streaming path to super.extractUsageInfo() — streaming usage extraction is unchanged; only non-streaming JSON format differs"
  - "Convert string system to [{type,text,cache_control}] array — Anthropic breakpoint 2 requires block-level injection; strings have no block structure"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-04T10:00:00Z"
  tasks_completed: 1
  files_modified: 2
---

# Phase 01 Plan 01: OpenRouter extractUsageInfo and 3-Breakpoint Cache Injection Summary

## One-liner

Fixed two correctness bugs in OpenRouterProvider: added extractUsageInfo override reading OpenRouter's `prompt_tokens_details.cache_write_tokens` (CACHE-01), and replaced broken top-level `body.cache_control` injection with per-block injection at 3 Anthropic breakpoints — last tool, last system block, last assistant turn (CACHE-02).

## What Was Built

### CACHE-01: extractUsageInfo Override

`OpenRouterProvider` previously inherited `BaseAnthropicCompatibleProvider.extractUsageInfo()`, which reads `usage.cache_creation_input_tokens` — a field that Anthropic returns but OpenRouter does not. OpenRouter instead returns `usage.prompt_tokens_details.cache_write_tokens` and `usage.prompt_tokens_details.cached_tokens`.

The new override:
- Delegates streaming responses to the parent (unchanged path)
- For non-streaming: reads `prompt_tokens_details.cache_write_tokens` → `cacheCreationInputTokens`
- For non-streaming: reads `prompt_tokens_details.cached_tokens` → `cacheReadInputTokens`
- Returns `null` when `usage` field is absent (safe fallback)
- Wrapped in try/catch — malformed upstream responses return null rather than propagating parse errors

### CACHE-02: 3-Breakpoint Per-Block Cache Injection

Replaced the broken `body.cache_control = { type: "ephemeral" }` top-level injection (which is not a valid Anthropic/OpenRouter field) with per-block `cache_control: { type: "ephemeral" }` at:

1. **Last tool** in `body.tools[]` — most stable breakpoint; invalidates all content below in the cache hierarchy
2. **Last system content block** — if `body.system` is a string, converts to `[{type:"text", text:..., cache_control:{type:"ephemeral"}}]`; if already an array, injects on the last block
3. **Last assistant turn** in `body.messages[]` — if content is a string, converts to array with `cache_control`; if already an array, injects on the last block

No top-level `body.cache_control` key remains.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Replace OpenRouterProvider with correct extractUsageInfo and 3-breakpoint cache injection | db5e5d7 | packages/providers/src/providers/openrouter/provider.ts |

TDD RED commit: c3661ec (test file written first, confirmed failing)
TDD GREEN commit: db5e5d7 (implementation added, all 10 tests pass)

## Verification Results

```
# extractUsageInfo override present
grep -n "extractUsageInfo" packages/providers/src/providers/openrouter/provider.ts
  → 4 matches (comment, override declaration, streaming delegate, recursive call)

# cache_control count (per-block, 3+ occurrences)
grep -c "cache_control" packages/providers/src/providers/openrouter/provider.ts
  → 7 matches

# No top-level injection
grep "body.cache_control" packages/providers/src/providers/openrouter/provider.ts
  → PASS: no top-level injection

# prompt_tokens_details present
grep "prompt_tokens_details" packages/providers/src/providers/openrouter/provider.ts
  → 3 matches (comment, var declaration, field read)

# Tests
bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts
  → 10 pass, 0 fail
```

## Deviations from Plan

None — plan executed exactly as written. The plan correctly anticipated the `this.config.supportsStreaming` access (protected field accessible in subclass). No type errors introduced.

Pre-existing typecheck errors (3 errors for auto-generated files: inline-worker, inline-vacuum-worker, embedded-tiktoken-wasm) and lint errors (27) were present before this change and are unrelated — logged here for awareness, not deferred issues caused by this plan.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. T-01-02 (Information Disclosure) mitigated per plan: `extractUsageInfo` wrapped in try/catch returning null on malformed response.

## Self-Check: PASSED

- `packages/providers/src/providers/openrouter/provider.ts` — FOUND
- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — FOUND
- Commit c3661ec — FOUND (TDD RED: test file)
- Commit db5e5d7 — FOUND (TDD GREEN: implementation)
- 10/10 tests pass
- No new typecheck or lint errors
