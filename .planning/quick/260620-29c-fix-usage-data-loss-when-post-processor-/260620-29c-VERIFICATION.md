---
phase: quick-260620-29c
verified: 2026-06-20T00:00:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase quick-260620-29c: Fix Usage Data Loss When Post-Processor Worker Stops — Verification Report

**Phase Goal:** Fix permanent usage data loss when the post-processor worker exhausts MAX_RESTARTS and reaches the permanently-stopped state.
**Verified:** 2026-06-20
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When the worker exhausts MAX_RESTARTS=3, state becomes 'stopped' then auto-restarts via exponential backoff — never permanently lost | VERIFIED | `attemptRestart()` lines 338-364 in `usage-worker-controller.ts`: when `restartCount >= MAX_RESTARTS`, resets `restartCount = 0`, increments `exhaustionCycles`, schedules `this.restartTimer = setTimeout(() => { if (this.state === "stopped") this.start(); }, delay)`. Old "giving up" path replaced. Log says "backing off Xms (exhaustion cycle N)". Test 1 and Test 4 in `usage-worker-controller-restart.test.ts` pass. |
| 2 | New requests that arrive while the worker is stopped are routed to the in-process UsageCollector instead of being silently dropped | VERIFIED | `safeHandleStart()` lines 44-60 in `response-handler.ts`: `else if (w.isStopped())` branch adds `msg.requestId` to `collectorRequestIds` and calls `tryGetUsageCollector()?.handleStart(msg)`. Test 5 in Suite 4 of `response-handler-worker-protocol.test.ts` passes: postMessage call count for "start" = 0, `mockCollector.handleStart` call count = 1. |
| 3 | Requests that start on the worker path and encounter a mid-stream worker stop emit a visible warn log — data loss is diagnosable | VERIFIED | `safeHandleChunk()` lines 72-108: after checking `collectorRequestIds.has(requestId)` (false = worker-path request), calls `w.isStopped()` and logs `log.warn("safeHandleChunk: data loss for requestId=... — worker stopped mid-request")` before calling `w.postMessage(msg)`. |
| 4 | collectorRequestIds Set is cleaned up after each request's End message — no state leak | VERIFIED | `fireAndForgetEnd()` lines 110-134: `collectorRequestIds.delete(msg.requestId)` called before `tryGetUsageCollector()?.handleEnd(msg)`. Test 8 passes: 2 sequential stopped-path requests produce `handleEnd` call count = 2 and `handleStart` call count = 2, confirming Set entries removed correctly. |
| 5 | terminate() cancels any pending backoff timer — no stale restart callbacks after shutdown | VERIFIED | `terminate()` lines 228-259: unconditional `if (this.restartTimer !== null) { clearTimeout(this.restartTimer); this.restartTimer = null; }` executes BEFORE `if (this.state === "stopped") return Promise.resolve()`, so both the stopped+timer-pending case and the normal case clear the timer. Test 4 confirms `getWorkerCreateCount()` does not increase after `terminate()` during backoff. |
| 6 | All 5 new test cases pass alongside existing test suite (0 regressions) | VERIFIED | `bun test packages/proxy/src/__tests__/usage-worker-controller-restart.test.ts packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts packages/proxy/src/__tests__/usage-worker-controller.test.ts` — 31 pass, 0 fail, 64 expect() calls in 788ms. |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/proxy/src/usage-worker-controller.ts` | Exponential backoff restart + `isStopped()` public method, contains `exhaustionCycles` | VERIFIED | `computeBackoffDelay` exported at line 23; `exhaustionCycles` private field at line 100, used in `attemptRestart()` at lines 343-346; `isStopped()` public method at lines 281-283; `restartTimer` field at line 101. |
| `packages/proxy/src/response-handler.ts` | `collectorRequestIds` routing + `resetForTesting()` export, contains `collectorRequestIds` | VERIFIED | `collectorRequestIds` Set declared at line 23; `resetForTesting()` exported at lines 29-31; `tryGetUsageCollector` imported at line 13; routing in `safeHandleStart`, `safeHandleChunk`, `fireAndForgetEnd`. |
| `packages/proxy/src/__tests__/usage-worker-controller-restart.test.ts` | Backoff restart tests (new file) | VERIFIED | File exists; exports `describe` suites covering `computeBackoffDelay` (5 boundary tests), backoff scheduling (Test 1), restartCount reset (Test 2), terminate-during-backoff (Test 4). All 9 tests in this file pass. |
| `packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts` | Extended tests for stopped-path routing and Set cleanup, contains `isStopped` | VERIFIED | File contains `isStopped` in mock shapes (lines 68, 300, 362, 484, 550, 606, 681); Suite 4 adds Tests 5-8 for fallback routing and Set cleanup; `resetForTesting` imported and called in `beforeEach`. All 22 tests in this file pass. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `response-handler.ts safeHandleStart` | `collectorRequestIds Set` | `collectorRequestIds.add(msg.requestId)` when `w.isStopped()` | WIRED | Line 52: `collectorRequestIds.add(msg.requestId)` inside `else if (w.isStopped())` branch. |
| `response-handler.ts fireAndForgetEnd` | `collectorRequestIds Set` | `collectorRequestIds.delete(msg.requestId)` | WIRED | Line 115: `collectorRequestIds.delete(msg.requestId)` inside `if (collectorRequestIds.has(msg.requestId))` guard. |
| `usage-worker-controller.ts attemptRestart` | `restartTimer setTimeout` | `Math.min(30_000, 1_000 * 2 ** this.exhaustionCycles)` | WIRED | Lines 343-352: `exhaustionCycles` incremented, `computeBackoffDelay(this.exhaustionCycles - 1)` computed, assigned to `this.restartTimer = setTimeout(...)`. |
| `usage-worker-controller.ts terminate` | `clearTimeout(this.restartTimer)` | Null-safe clear before state transition | WIRED | Lines 229-231: `if (this.restartTimer !== null) { clearTimeout(this.restartTimer); this.restartTimer = null; }` — executes unconditionally before any state guard. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `response-handler.ts` | `collectorRequestIds` Set | `safeHandleStart` populates on stopped path; `fireAndForgetEnd` removes on completion | Yes — keyed by `msg.requestId` from live request; cleared on End | FLOWING |
| `usage-worker-controller.ts` | `exhaustionCycles` | Incremented in `attemptRestart()` at `restartCount >= MAX_RESTARTS` | Yes — tracks real exhaustion history | FLOWING |
| `usage-worker-controller.ts` | `restartTimer` | Set by `setTimeout` in `attemptRestart()` exhaustion path; cleared in `terminate()` | Yes — real timer reference | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `computeBackoffDelay` formula boundary values | Verified via test suite (Test 3a-3e) | cycle 0→1000, 1→2000, 4→16000, 5→30000, 10→30000 all correct | PASS |
| backoff log replaces "giving up" | `grep -n "giving up" usage-worker-controller.ts` | No match | PASS |
| backoff log present | `grep -n "backing off" usage-worker-controller.ts` | Line 346: `"Worker exhausted ... — backing off ${delay}ms (exhaustion cycle ${this.exhaustionCycles})"` | PASS |
| Full test suite (31 tests) | `bun test ...restart.test.ts ...response-handler-worker-protocol.test.ts ...usage-worker-controller.test.ts` | 31 pass, 0 fail | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FIX-WORKER-EXHAUSTION | 260620-29c-PLAN.md | Worker must not permanently stop after MAX_RESTARTS — backoff restart instead | SATISFIED | `attemptRestart()` schedules exponential backoff via `restartTimer`; `exhaustionCycles` counter ensures delays escalate correctly; `isStopped()` exposed for fallback routing. |
| FIX-USAGE-DATA-LOSS | 260620-29c-PLAN.md | Usage data for requests arriving during stopped window must not be dropped | SATISFIED | `collectorRequestIds` Set + `tryGetUsageCollector()` fallback in `safeHandleStart`, `safeHandleChunk`, `fireAndForgetEnd` ensures full Start→Chunk→End lifecycle on collector path when worker is stopped. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No stubs, placeholders, or TODO/FIXME comments found in modified files. |

The previous permanent-stop pattern (`log.error(...); this.state = "stopped"; return;`) has been fully replaced. No dead code paths remain.

---

### Human Verification Required

None. All observable truths are verifiable programmatically through code inspection and the passing test suite.

---

### Gaps Summary

No gaps. All 6 must-have truths verified. All 4 required artifacts exist, are substantive, and are wired. All 4 key links confirmed by grep. Test suite passes 31/31 with zero regressions. Both requirement IDs satisfied.

---

_Verified: 2026-06-20_
_Verifier: Claude (gsd-verifier)_
