---
phase: 04-cache-extension-provider-injection
plan: "03"
subsystem: providers
tags: [tdd, green-gate, openrouter, cache-control, count-guard, provider-injection, prov-01, cache-03, cache-04, cache-05]
dependency_graph:
  requires: [04-01, 04-02]
  provides: [GREEN gate — all 20 provider tests pass, count guard, 4th breakpoint, non-destructive retrofit, provider injection]
  affects: [packages/providers]
tech_stack:
  added: []
  patterns: [tdd-green-gate, count-guard-pattern, non-destructive-injection, field-presence-check]
key_files:
  created: []
  modified:
    - packages/providers/src/providers/openrouter/provider.ts
decisions:
  - "countExistingCacheControlBlocks() extracted as module-level helper rather than inline to improve readability of transformRequestBody()"
  - "Used field-presence check ('provider' in body) not truthiness (!body.provider) to correctly handle body.provider = {} case"
  - "Used nullish coalescing (?? true) not logical OR (|| true) to preserve explicit false in allow_fallbacks"
  - "inject-system-cache-ttl.test.ts failure is pre-existing (missing inline-worker.ts auto-generated file in worktree) — not caused by this plan's changes"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-20T08:30:00Z"
  tasks_completed: 1
  files_modified: 1
---

# Phase 4 Plan 03: GREEN Gate — 4-Breakpoint Cache Injection with Count Guard and Provider Preference Summary

## One-Liner

Implemented count-guarded 4-breakpoint cache_control injection with non-destructive retrofit and provider preference injection in OpenRouterProvider, turning all 7 RED tests GREEN (20 pass, 0 fail).

## Objective Achieved

- TDD GREEN gate: all 20 provider tests pass, 0 fail
- Count guard pre-counts existing cache_control blocks across all injection sites before any mutation
- Breakpoints 1-3 retrofitted with non-destructive guard (skip if cache_control already present)
- Breakpoint 4 (last user message) implemented for both array and string content paths
- Provider preference injection reads account.openrouter_provider_preference with correct field-presence check and nullish coalescing
- All FORK PATCH annotations present on every new code block

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (GREEN) | Implement 4-breakpoint cache injection with count guard and provider injection | `ef56c4f9` | `provider.ts` |

## Test Results (GREEN Gate State)

| Test | Result | Requirement |
|------|--------|-------------|
| injects cache_control on last content block of last user message (array content) | GREEN | CACHE-03 |
| converts string user content to array with cache_control on last user message | GREEN | CACHE-03 |
| count guard: stops at 4 cache_control injections total (no 5th injection) | GREEN | CACHE-03 |
| count guard: partial — injects only remaining slots when some already exist | GREEN | CACHE-03 |
| non-destructive guard: existing cache_control object is not overwritten | GREEN | D-01 |
| injects body.provider when account has openrouter_provider_preference | GREEN | PROV-01 |
| allow_fallbacks defaults to true when absent from stored JSON | GREEN | D-10 |
| tool block cache_control has { type: "ephemeral" } with no ttl field after transform | GREEN | CACHE-04 |
| does NOT inject body.provider when request already has a provider field | GREEN (preserved) | PROV-01 |
| corrupt openrouter_provider_preference JSON is ignored | GREEN (preserved) | D-12 |
| All 10 original tests (CACHE-01, CACHE-02) | GREEN (no regression) | — |

## Implementation Details

### countExistingCacheControlBlocks(body) helper

Module-level function that counts cache_control presence across:
- `body.tools[]` — each tool object
- `body.system` (array) — each system block
- `body.messages[].content[]` — each content block in every message

### Count guard flow

```
remaining = Math.max(0, 4 - countExistingCacheControlBlocks(body))
```

Each injection site guards with `if (remaining > 0)` and decrements `remaining--` after injecting.

### Non-destructive retrofit pattern (all 3 existing breakpoints)

```typescript
if (!(lastTool as any).cache_control) {
  (lastTool as any).cache_control = { type: "ephemeral" };
  remaining--;
}
```

### Provider injection guard

```typescript
if (account?.openrouter_provider_preference && !("provider" in body)) {
  // field-presence check, not truthiness — preserves body.provider = {}
```

### allow_fallbacks nullish coalescing

```typescript
allow_fallbacks: pref.allow_fallbacks ?? true
// NOT || true — would coerce explicit false to true
```

## Decisions Made

- `countExistingCacheControlBlocks()` extracted as module-level helper for readability and testability
- Field-presence check `"provider" in body` guards against overriding `body.provider = {}` (empty object would be falsy with `!body.provider`)
- Nullish coalescing `?? true` correctly preserves stored `false` for allow_fallbacks
- No TTL value injected in transformRequestBody — `injectSystemCacheTtl()` in proxy.ts handles TTL upgrade

## Deviations from Plan

None — plan executed exactly as written. The count guard helper was extracted to a module-level function (plan suggested this as a readability option), which was the right call.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. All security mitigations from the threat model (T-04-03-01 through T-04-03-05) are implemented.

## Self-Check: PASSED

Files exist:
- `packages/providers/src/providers/openrouter/provider.ts` — updated with all Phase 4 changes

Commits exist:
- `ef56c4f9` — feat(04-03): extend OpenRouter cache injection to 4 breakpoints with count guard and provider preference injection

Verification:
- 20 pass, 0 fail (bun test provider.test.ts)
- `"provider" in body` pattern present (field-presence check)
- `allow_fallbacks ?? true` pattern present (nullish coalescing)
- No `ttl:` in transformRequestBody
- 6 FORK PATCH annotations (exceeds required 4)
- lint/typecheck/format pass (no new errors beyond pre-existing dashboard warnings and inline-worker type errors)
