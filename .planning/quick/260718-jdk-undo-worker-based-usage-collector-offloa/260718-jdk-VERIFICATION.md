---
phase: quick-260718-jdk
verified: 2026-07-18T14:33:36Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Quick Task 260718-jdk: Undo worker-based usage-collector offload — Verification Report

**Phase Goal:** Fully undo the worker-based usage-accounting offload, restoring `packages/proxy/src/usage-collector.ts` as the sole, synchronous accounting path on the proxy hot path, while preserving every unrelated fork feature byte-for-byte.
**Verified:** 2026-07-18T14:33:36Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (must_haves.truths, PLAN.md frontmatter)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Zero worker-related symbols remain in `packages/proxy/src`, `apps/server/src`, `apps/cli/package.json` (grep clean or only stale-prose/out-of-scope exceptions) | ✓ VERIFIED | `grep -rn "getUsageWorker\|UsageWorkerController\|startUsageWorker\|terminateUsageWorker\|sendWorkerConfigUpdate\|UsageWorkerHealth\|usage-worker-controller\|post-processor.worker\|safeHandleStart\|safeHandleChunk\|collectorRequestIds" packages/proxy/src apps/server/src apps/cli/package.json` returned exactly 4 hits, all documented exceptions: `memory-leak.test.ts:85` (stale comment), `usage-extraction.ts:4,25` (stale comments), `server.ts:736` (`getUsageWorkerHealth: () => getUsageCollectorHealth()` — unrenamed pre-existing field key calling the collector internally, per RESEARCH.md §0-item-3/CONTEXT.md). No other file in the tree matched. |
| 2 | Every proxy hot-path usage-accounting call site calls `getUsageCollector()`/`.handleStart\|handleChunk\|handleEnd` directly and synchronously — no worker dispatch, no `collectorRequestIds` | ✓ VERIFIED | `response-handler.ts`: `import { getUsageCollector } from "./usage-collector"` (line 13); `fireAndForgetEnd` = `getUsageCollector().handleEnd(msg).catch(...)` (lines 22-28, no branching); direct calls at line 208 (`handleStart`) and 238 (`handleChunk`). `proxy.ts` pool-exhausted branch: `getUsageCollector().handleStart({...})` (line 384) and `getUsageCollector().handleEnd({...}).catch(...)` (line 414), including preserved `originalModel`/`appliedModel` fields. No `collectorRequestIds`, `safeHandleStart`, `safeHandleChunk`, or `getUsageWorker` remain in either file. |
| 3 | `bun run lint && bun run typecheck && bun run format` all exit 0 | ✓ VERIFIED | Independently re-ran all three: lint exit 0 (247 pre-existing `noNonNullAssertion` style warnings, zero in any of the 9 files touched by this task — confirmed via targeted grep on lint output filtered to those paths, zero matches); `bunx tsc --noEmit` exit 0, zero diagnostics; `bunx biome format --write .` exit 0, "Formatted 622 files... No fixes applied" (no formatting drift). |
| 4 | Full `bun test` suite passes with zero regressions vs pre-revert HEAD (minus deleted worker-only test files) | ✓ VERIFIED | Independently ran full suite: `2256 pass, 2 fail, Ran 2258 tests across 166 files`. Matches SUMMARY.md's claimed 2256/2258 exactly. Confirmed both failures are unrelated to this revert: `apps/cli/__tests__/cli.test.ts > should sanitize error messages` (port-8080-dependent test design, no worker/collector reference) and `packages/proxy/src/__tests__/model-catalog.test.ts > recovers on a later tick...` (zero worker/collector references in file; re-ran in isolation — `42 pass, 0 fail` — confirming a full-suite-only timing/CPU-contention flake, not a code regression). |
| 5 | Unrelated fork features present and untouched in final diff (9 items) | ✓ VERIFIED | Spot-checked all 9: session-governor (`buildSessionRejectResponse`/`recordSessionRequest`/`clientSessionId` in proxy.ts:31-32,256,270,272); `resolveEffectiveModel`/combo routing (proxy.ts:26,280,284,308,317-318); model-catalog passive capture (`ingestModelsListing` in response-handler.ts:11,348); model-aware usage throttling (`comboRouted`/`getUsageThrottleUntil`/`scopedMode: "match"` in proxy.ts:17,308,312,317-318); PG-mode async `initProxy` (`async function initProxy` + `DatabaseFactory.getInstance()` at proxy.ts:111,119); model-rewrite headers (`isModelRewrite`/`withModelRewriteHeader`/`MODEL_REWRITE_HEADER`/`originalModel`/`appliedModel` throughout response-handler.ts); xAI refresh-backed polling (`supportsRefreshBackedUsagePolling`/`refreshBackedUsageAccounts`/`recordUsageSnapshot` in server.ts:120,422,948,1405-1412); session-affinity (`SessionAffinityStrategy` in server.ts:27,85); usage-history snapshot pruning (`pruneUsageSnapshots` in server.ts:251,832); codex count-tokens synthesis (`isSyntheticCountTokens` widened for `ctx.provider.name === "codex"` in response-handler.ts:156-160); adaptive incremental vacuum (`incrementalVacuumAdaptive()` in server.ts:819). All present and matching the plan's described shape. |
| 6 | `apps/cli/package.json` build script no longer bundles `post-processor.worker.ts`; only vacuum/incremental-vacuum/integrity-check steps remain | ✓ VERIFIED | Parsed `scripts.build` via `node -e "JSON.parse(...)"`: contains only `inline-vacuum-worker`, `inline-incremental-vacuum-worker`, `inline-integrity-check-worker` guard/bundle/base64 steps plus the final CLI compile step. Zero occurrence of `post-processor.worker` (grep confirmed above). |
| 7 | `apps/cli/package.json` version field byte-identical to pre-revert value (never touched) | ✓ VERIFIED | `git diff 758dae9e apps/cli/package.json \| grep '"version"'` → no output (untouched in the diff). Current value `"3.5.39"` matches root `package.json`'s `"3.5.39"`. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/proxy/src/response-handler.ts` | Synchronous `getUsageCollector()` calls; no `getUsageWorker` import; model-catalog/model-rewrite preserved | ✓ VERIFIED | Confirmed via direct read (lines 1-40, 200-240) and grep. Contains `getUsageCollector().handleStart(startMessage)` at line 208, matching plan's `contains` field. |
| `packages/proxy/src/proxy.ts` | No `UsageWorkerController` singleton; pool-exhausted branch calls `getUsageCollector()` directly; `initProxy` async with `DatabaseFactory.getInstance()` | ✓ VERIFIED | Confirmed lines 111-119 (async initProxy + DatabaseFactory), 384-426 (pool-exhausted direct calls). Zero `UsageWorkerController` hits. |
| `packages/proxy/src/worker-messages.ts` | `ChunkMessage.data: Uint8Array`, no transferable-ArrayBuffer contract | ✓ VERIFIED | Line 79: `data: Uint8Array;`. No "TRANSFER CONTRACT" comment found. |
| `packages/proxy/src/index.ts` | No worker-related barrel exports | ✓ VERIFIED | Barrel exports `drainUsageCollector`, `getUsageCollectorHealth`, `handleProxy`, `initProxy` (lines 52-55); zero worker-symbol exports found. |
| `apps/server/src/server.ts` | Startup calls only `initProxy()`; shutdown calls only `drainUsageCollector()`; `getUsageCollectorHealth` wired | ✓ VERIFIED | Line 915 `await initProxy(...)`, line 1723 `await drainUsageCollector()`, line 736 `getUsageWorkerHealth: () => getUsageCollectorHealth()`. No `startUsageWorker`/`terminateUsageWorker`/`sendWorkerConfigUpdate` calls found anywhere. |
| `apps/cli/package.json` | Build script without post-processor.worker bundle steps | ✓ VERIFIED | Confirmed via parsed JSON — see Truth 6 above. |
| `packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts` | `getUsageCollector`-based mocking; passive model-catalog capture suite preserved with spy | ✓ VERIFIED | Two `describe` blocks present: `"forwardToClient usage-collector protocol"` and `"forwardToClient passive model-catalog capture"`; both spy on `getUsageCollector` (lines 48-51, 304-318). Test run: all pass. |
| `packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts` | `getUsageCollector` spies restored; `getAgentFrontmatterModelFallback: () => false` re-applied to Site 3 | ✓ VERIFIED | `getUsageCollector` spies at lines 129, 247; `getAgentFrontmatterModelFallback: () => false` at lines 271 and 325 (both `ctx.config` mocks in Site 3). Test run: all pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `response-handler.ts` forwardToClient onChunk | `usage-collector.ts` getUsageCollector().handleChunk | direct synchronous call | ✓ WIRED | Line 238: `getUsageCollector().handleChunk(requestId, value);` — no routing branch. |
| `proxy.ts` handleProxy pool-exhausted branch | `usage-collector.ts` getUsageCollector().handleStart/handleEnd | direct synchronous calls replacing worker postMessage | ✓ WIRED | Lines 384 (`handleStart`) and 414 (`handleEnd`), pattern confirmed via grep `getUsageCollector\(\)\s*\n?\s*\.handleEnd` — matched (proxy.ts:414-415). |
| `apps/server/src/server.ts` startup | `proxy.ts` initProxy() | `await initProxy(...)` with no follow-on worker calls | ✓ WIRED | Line 915, no `startUsageWorker`/`sendWorkerConfigUpdate` calls anywhere after it. |
| `apps/server/src/server.ts` shutdown | `proxy.ts` drainUsageCollector() | `await drainUsageCollector()` with no `terminateUsageWorker()` | ✓ WIRED | Line 1723, no `terminateUsageWorker` call anywhere in file. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 6 worker-only files deleted from disk | `for f in <6 files>; test -f` | all report "deleted OK" (files absent) | ✓ PASS |
| Grep sanity check (RESEARCH.md §10) | `grep -rn "getUsageWorker\|..." packages/proxy/src apps/server/src apps/cli/package.json` | 4 hits, all documented stale-comment/field-key exceptions | ✓ PASS |
| `usage-collector.ts` has zero diff since plan start | `git diff --stat 758dae9e HEAD -- packages/proxy/src/usage-collector.ts` | empty output | ✓ PASS |
| `bun run lint` | `bun run lint` | exit 0, 247 pre-existing warnings, 0 in touched files | ✓ PASS |
| `bun run typecheck` (`bunx tsc --noEmit`) | exit 0, zero diagnostics | ✓ PASS |
| `bun run format` | exit 0, "622 files... No fixes applied" | ✓ PASS |
| Designated + deviation test files (3 files) | `bun test response-handler-worker-protocol.test.ts auto-refresh-probe-filter.test.ts pool-exhausted.test.ts` | `30 pass, 0 fail` | ✓ PASS |
| Full test suite | `bun test` (full run, once) | `2256 pass, 2 fail` — matches SUMMARY.md claim exactly; both failures independently confirmed unrelated to this revert (no worker/collector references; `model-catalog.test.ts` passes 42/42 in isolation) | ✓ PASS (with 2 known-unrelated pre-existing flakes, documented) |
| `git status --short` (repo cleanliness) | `git status --short` | only 3 untracked `.planning/` docs (CONTEXT/RESEARCH/SUMMARY, expected artifacts of this quick task) | ✓ PASS |
| `git diff --stat 758dae9e HEAD` (file scope) | 15 files changed (6 deleted, 9 modified) | ✓ PASS — matches plan's 14-file scope plus the documented `pool-exhausted.test.ts` Rule-1 deviation fix (SUMMARY.md discloses this addition; it is in scope of the same revert, not scope creep) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | none | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/stub patterns found in any of the 9 touched files. `server.ts:876` matched the "not available" substring but is a legitimate runtime error message (`"Anthropic provider not available"`), not a debt marker. |

### Requirements Coverage

PLAN.md frontmatter declares `requirements: []`. No REQUIREMENTS.md IDs mapped to this quick task. N/A.

### Human Verification Required

None. All must-haves, artifacts, key links, and success criteria are verifiable via static analysis, grep, and automated test execution — no UI, real-time, or external-service behavior is involved in this subtractive backend revert.

### Gaps Summary

No gaps found. Independent verification (re-running every command from the plan's `<verify>` blocks and Task 4's full gate, rather than trusting SUMMARY.md's reported output) reproduced the exact same results SUMMARY.md claimed:
- Grep sanity check: clean (only documented exceptions).
- Lint/typecheck/format: all exit 0.
- Full test suite: 2256/2258 passing, with the 2 failures independently re-confirmed as pre-existing/environmental (not caused by this revert — no worker/collector symbol references in either failing test, and `model-catalog.test.ts` passes cleanly in isolation).
- All 6 worker-only files confirmed absent from disk.
- All 9 unrelated fork features spot-checked present in their expected locations with matching code shapes.
- `apps/cli/package.json` version field confirmed byte-identical via `git diff` against the plan's starting commit; build script confirmed free of `post-processor.worker` bundling.
- `usage-collector.ts` confirmed zero diff since the plan's starting commit.

One process deviation is noted but does not affect the goal: GitNexus MCP tools / subagent dispatch were unavailable in the executor's session (per SUMMARY.md "Decisions Made" and "Issues Encountered"), so `gitnexus_impact`/`gitnexus_detect_changes` mandated by CLAUDE.md were not run. This is a tooling-availability gap in process compliance, not a code-correctness gap — the manual RESEARCH.md git-history analysis substituted for it, and this verification pass independently confirmed the same outcomes via direct grep/read/test execution. Flagged here for awareness; does not block the phase goal (fully undoing the worker-based offload while preserving fork features), which IS achieved.

---

_Verified: 2026-07-18T14:33:36Z_
_Verifier: Claude (gsd-verifier)_
