---
phase: quick-260601-m3c
plan: 01
subsystem: providers
tags: [openrouter, cost-tracking, streaming, COST-04]
requires:
  - OpenRouterProvider.extractStreamingUsage (existing, real usage.cost from final SSE message_delta)
  - OpenRouterProvider.extractUsageInfo (existing, non-streaming JSON usage)
provides:
  - OpenRouterProvider.parseUsage (public, content-type-routed streaming vs non-streaming)
affects:
  - packages/proxy/src/handlers/response-processor.ts (streaming branch guarded by ctx.provider.parseUsage)
tech-stack:
  added: []
  patterns: [content-type-routed parseUsage wrapper mirroring bedrock/provider.ts]
key-files:
  created: []
  modified:
    - packages/providers/src/providers/openrouter/provider.ts
    - packages/providers/src/providers/openrouter/__tests__/provider.test.ts
decisions:
  - D-02 honored - parseUsage scoped to OpenRouterProvider only; base-anthropic-compatible.ts untouched
  - Streaming path passes response.clone() to extractStreamingUsage since it consumes the body reader
metrics:
  duration: ~15m
  completed: 2026-06-01
---

# Phase quick-260601-m3c Plan 01: parseUsage on OpenRouterProvider Summary

Public `parseUsage(response)` on `OpenRouterProvider` routes `text/event-stream` to `extractStreamingUsage` (real OpenRouter `usage.cost`) and JSON to `extractUsageInfo`, closing the COST-04 regression where the response-processor streaming branch (`isStream && ctx.provider.parseUsage`) would otherwise fall through to non-streaming extraction.

## What Was Built

- Added a public `parseUsage(response: Response)` method on `OpenRouterProvider` with the full usage return shape (`model`, `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`, `inputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `outputTokens`) and `Promise<... | null>`.
- Streaming path: when content-type includes `text/event-stream` and `this.config.supportsStreaming`, delegates to `this.extractStreamingUsage(response.clone(), response.headers)` — surfacing the real `costUsd` from the final SSE `message_delta`.
- Non-streaming path: delegates to `this.extractUsageInfo(response)` with no behavior change.
- Added a `describe("OpenRouterProvider.parseUsage streaming cost extraction (COST-04)")` block with five cases (numeric `0.0034`, zero, absent→undefined, null→undefined, string→undefined), reusing the existing `makeStreamingResponse(cost)` helper.

## TDD Gate Compliance

- RED: `test(quick-260601-m3c): add failing parseUsage streaming-cost tests` — commit `627ec5dd` (7 failing assertions, parseUsage undefined).
- GREEN: `feat(quick-260601-m3c): add parseUsage to OpenRouterProvider for streaming cost` — commit `49002d48` (36 pass / 0 fail).
- REFACTOR: not needed.

Note: the GREEN commit also removed a duplicate `parseUsage` describe block that was accidentally written twice during a cwd-drift incident (see Deviations); net test file is single-block and clean.

## Deviations from Plan

### cwd-drift during edits (process note, not a code deviation)

- **Found during:** Task 1 test authoring.
- **Issue:** `bun test`/`grep` invocations that prepended `cd /home/.../better-ccflare` jumped to the MAIN repo (the worktree root is a nested `.claude/worktrees/...` path), so verification appeared to show edits "lost". The Edit tool correctly wrote to the worktree absolute path; the Bash greps were reading the main repo copy. One edit was applied twice as a result, creating a duplicate `describe` block.
- **Fix:** Stopped prepending `cd` (worktree is already the cwd); removed the duplicate describe block before the GREEN commit. No functional impact.

## Verification Results

- `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts`: 36 pass / 0 fail.
- `bunx biome check` on the two changed files: only pre-existing `any` warnings in the cache_control injection code; zero new warnings from `parseUsage`.
- `bun run format`: no changes (code already tab/double-quote conformant).
- `git diff --name-only`: only the two target files; `base-anthropic-compatible.ts` untouched (D-02).

## Deferred Issues (out of scope)

- `bun run typecheck` reports 5 pre-existing errors for missing generated files (`inline-worker.ts`, `inline-vacuum-worker.ts`, `inline-integrity-check-worker.ts`, `embedded-tiktoken-wasm`, `inline-incremental-vacuum-worker`). These are build-generated artifacts absent in this fresh worktree (per CLAUDE.md, auto-generated). `bun run build` could not regenerate them due to a missing `embedded-tiktoken-wasm` resolution in the build tooling. None reference the openrouter provider or its imports — unrelated to this change.

## Self-Check: PASSED

- FOUND: packages/providers/src/providers/openrouter/provider.ts (parseUsage present)
- FOUND: packages/providers/src/providers/openrouter/__tests__/provider.test.ts (parseUsage describe block present)
- FOUND commit: 627ec5dd (RED)
- FOUND commit: 49002d48 (GREEN)
