---
phase: 10-type-wiring-cli-http-api-sse-sniffer
plan: 04
subsystem: providers
tags: [openrouter, observability, sse, logging, fork-patch]
requires:
  - "10-01"
provides:
  - "X-OpenRouter-Experimental-Metadata: enabled header on every openrouter-anthropic request (D-03)"
  - "openrouter_metadata DEBUG logging tap on terminal message_stop SSE event (D-04)"
affects:
  - packages/providers/src/providers/openrouter-anthropic/provider.ts
tech-stack:
  added: []
  patterns:
    - "Dedicated DEBUG-level Logger instance + explicit BETTER_CCFLARE_DEBUG env gate so logBus actually emits the metadata tap (module-level INFO logger never reaches logBus at DEBUG)"
    - "Header injection on a mutable Headers copy applied to BOTH the body-modified and fallback return paths of transformRequestBody (Pitfall 5)"
key-files:
  created: []
  modified:
    - packages/providers/src/providers/openrouter-anthropic/provider.ts
    - packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts
key-decisions:
  - "Used a dedicated DEBUG-level metadataLog plus an explicit isMetadataDebugEnabled() gate rather than the shared module-level log, because the shared logger is constructed at INFO and its debug() never reaches logBus regardless of BETTER_CCFLARE_DEBUG"
  - "Injected the metadata header on the fallback (body-untouched) return path too, so the header is present unconditionally even when body parsing fails"
requirements-completed:
  - OBS-01
duration: 3 min
completed: 2026-06-04
---

# Phase 10 Plan 04: OpenRouter Metadata Header + Debug Logging Summary

Added unconditional `X-OpenRouter-Experimental-Metadata: enabled` header injection in `transformRequestBody()` plus a `BETTER_CCFLARE_DEBUG`-gated `openrouter_metadata` tap on the terminal `message_stop` SSE event, giving operators visibility into which OpenRouter backend served each request without altering the client-visible response stream (OBS-01).

## What Was Built

- **D-03 — Header injection:** `transformRequestBody()` now builds a mutable `Headers` copy, sets `X-OpenRouter-Experimental-Metadata: enabled`, and uses it on both the body-modified `new Request(...)` and the previously body-untouched fallback path. The header is unconditional — no DEBUG guard.
- **D-04 — Metadata tap:** `readFinalSseCost()` scans the buffered SSE tail for `event: message_stop`, parses the following `data:` line, and when `type === "message_stop"` with an `openrouter_metadata` object present, logs it via a dedicated DEBUG-level `metadataLog`. Emission is explicitly gated on `BETTER_CCFLARE_DEBUG` (or legacy `ccflare_DEBUG`).
- Only the structured `openrouter_metadata` object is serialized to the log — no `api_key`, bearer token, or credentials.

## TDD Flow

- **RED** (`796ed20f`): added 3 tests — header presence, metadata logged via `logBus` when `BETTER_CCFLARE_DEBUG` set, no log when unset. Header + DEBUG-set tests failed; DEBUG-unset test passed (nothing logged yet).
- **GREEN** (`c10bbc32`): implemented header injection + message_stop tap. All 37 provider tests pass.

## Metrics

- Tasks: 2 / 2
- Files modified: 2
- Tests: 37 pass / 0 fail (3 new for OBS-01)
- Duration: ~3 min

## Deviations from Plan

**[Rule 1 - Bug] Logger DEBUG gate did not actually route through logBus**
- **Found during:** Task 2
- **Issue:** The plan assumed calling the shared module-level `log.debug()` would be gated by `BETTER_CCFLARE_DEBUG`. In reality the shared `Logger` is constructed at module load with `LogLevel.INFO`; its `debug()` early-returns (`this.level <= LogLevel.DEBUG` is false) and never emits to `logBus`, so the metadata would never be observable and the D-04 test could not be satisfied.
- **Fix:** Added a dedicated `metadataLog = new Logger(..., LogLevel.DEBUG)` and an explicit `isMetadataDebugEnabled()` gate checking `BETTER_CCFLARE_DEBUG`/`ccflare_DEBUG`. This preserves the intended opt-in behaviour (nothing logged unless the env var is set) while making `logBus` actually emit when enabled.
- **Files modified:** packages/providers/src/providers/openrouter-anthropic/provider.ts
- **Verification:** Test B (DEBUG set → metadata logged) and Test C (DEBUG unset → not logged) both pass.
- **Commit:** c10bbc32

**[Rule 2 - Missing critical] Fallback return path lacked the metadata header**
- **Found during:** Task 2
- **Issue:** `transformRequestBody()` has a fallback `return mapped` path (body parse failure / non-object body) that would have shipped a request WITHOUT the D-03 header, violating the "unconditional" requirement.
- **Fix:** Rebuilt the fallback return as `new Request(...)` carrying the same injected `headers`.
- **Files modified:** packages/providers/src/providers/openrouter-anthropic/provider.ts
- **Verification:** Header set before the try/catch; both return paths use the same `headers` object.
- **Commit:** c10bbc32

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical). **Impact:** None to plan scope — both keep the feature within OBS-01 and the threat model; no architectural change.

## Threat Model Compliance

- **T-10-04-A (Info Disclosure, log.debug):** mitigated — only the `openrouter_metadata` object is logged; grep confirms no `api_key`/`apiKey`/`bearer` token reaches any `log.debug()` call. Output gated behind `BETTER_CCFLARE_DEBUG`.
- **T-10-04-B/C/D:** accept dispositions unchanged — static `"enabled"` header value, TLS-protected upstream metadata serialized via `JSON.stringify`, small fixed-shape payload.

## Issues Encountered

- `bun run typecheck` reports 5 pre-existing errors, all `TS2307: Cannot find module './inline-*-worker'` / `./embedded-tiktoken-wasm`. These reference auto-generated build artifacts (gitignored, produced by `bun run build`) and are unrelated to this plan's files. Zero typecheck errors originate from `provider.ts` or the test file. Logged per scope boundary; not fixed (pre-existing, unrelated).

## Verification Results

- `bun test ...provider.test.ts` → 37 pass / 0 fail.
- `grep X-OpenRouter-Experimental-Metadata provider.ts` → present in `transformRequestBody`.
- `grep openrouter_metadata provider.ts` → present in `message_stop` tap.
- `grep "FORK PATCH" provider.ts` → 13 annotations.
- Secret grep inside `log.debug()` calls → none (only `authType: "bearer"` config + a clarifying comment).

## Next Phase Readiness

Plan 10-04 complete. No blockers. Wave 2 sibling plans unaffected — change is isolated to the `openrouter-anthropic` provider.

## Self-Check: PASSED
- packages/providers/src/providers/openrouter-anthropic/provider.ts — FOUND (modified)
- packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts — FOUND (modified)
- Commit 796ed20f (test RED) — FOUND
- Commit c10bbc32 (feat GREEN) — FOUND
