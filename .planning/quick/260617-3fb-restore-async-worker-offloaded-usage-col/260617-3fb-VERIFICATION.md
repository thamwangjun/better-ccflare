---
phase: quick-260617-3fb
verified: 2026-06-17T14:00:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/8
  gaps_closed:
    - "Per-request usage accounting now dispatches to the background Bun Worker via getUsageWorker().postMessage(), OFF the main-thread pull() loop — response-handler.ts no longer calls getUsageCollector()"
    - "server.ts now calls startUsageWorker() after initProxy(), sendWorkerConfigUpdate(config.getStorePayloads()) on startup AND in the store_payloads hot-reload handler, and terminateUsageWorker() on shutdown"
    - "store_payloads crosses the worker boundary via ConfigUpdate — config.on('change') handler calls sendWorkerConfigUpdate when key === 'store_payloads'"
    - "Graceful shutdown calls terminateUsageWorker() (not only drainUsageCollector) — worker drain is now invoked"
  gaps_remaining: []
  regressions: []
---

# Quick Task 260617-3fb: Re-Verification Report

**Phase Goal:** Move per-request usage/cost accounting OFF the proxy's synchronous pull() hot path back onto a background Bun Worker, fixing the #244 off-heap leak with transferable ArrayBuffers, and restore the safe-dispatch guard so a usage-accounting throw can never tear down an in-flight client stream (#245 regression).

**Verified:** 2026-06-17T14:00:00Z
**Status:** PASSED
**Re-verification:** Yes — after gap closure (commit 5cd0e604)

---

## Re-Verification Scope

The prior report (score 5/8, `gaps_found`) identified three FAILED/PARTIAL truths:
- Truth 1 (FAILED): Worker never started; hot path still synchronous
- Truth 5 (FAILED): store_payloads not propagated to worker
- Truth 6 (PARTIAL): Shutdown did not call terminateUsageWorker()

Truths 2, 3, 4, 7, 8 were VERIFIED or UNCERTAIN (wiring correct but untested at runtime).
Remediation commit 5cd0e604 is claimed to close all three FAILED gaps.

---

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Per-request usage accounting runs on a background Bun Worker, OFF pull() hot path | VERIFIED | `response-handler.ts` imports `getUsageWorker` from `./proxy` (line 11). `safeHandleChunk`, `safeHandleStart`, `fireAndForgetEnd` all call `getUsageWorker().postMessage()`. Zero occurrences of `getUsageCollector` remain. `server.ts` line 849 calls `startUsageWorker()`. |
| 2 | ChunkMessage carries a transferable ArrayBuffer; postMessage passes a non-empty transfer list | VERIFIED | `safeHandleChunk` (response-handler.ts:55-65): `copy = value.slice(); msg = { type:"chunk", requestId, data: copy.buffer }; getUsageWorker().postMessage(msg)`. Controller (usage-worker-controller.ts:180-181): `const chunkBuf = (msg as ChunkMessage).data; this.worker?.postMessage(msg, [chunkBuf])`. Transfer list confirmed. |
| 3 | Guard swallows usage-accounting throws; controller.error never called; client bytes always delivered | VERIFIED | All three dispatch functions (`safeHandleStart`, `safeHandleChunk`, `fireAndForgetEnd`) wrap worker dispatch in try/catch. Guard prevents propagation to `teeStream`'s `controller.error()`. Worker terminal states drop silently (controller lines 173-178) rather than throwing. |
| 4 | #244 off-heap leak does not recur — chunk buffers transferred (moved), not cloned | VERIFIED | `value.slice()` creates a fresh Uint8Array/ArrayBuffer (client buffer untouched). `copy.buffer` is passed in the transfer list `[chunkBuf]` in the controller. The buffer is zero-copy moved to the worker thread. Transfer path is now exercised at runtime (worker is started). |
| 5 | store_payloads propagates via ConfigUpdateMessage on start and on hot-reload | VERIFIED | server.ts line 850: `sendWorkerConfigUpdate(config.getStorePayloads())` called immediately after `startUsageWorker()`. server.ts lines 1040-1042: `config.on("change")` handler sends `sendWorkerConfigUpdate(config.getStorePayloads())` when `key === "store_payloads"`. |
| 6 | Graceful shutdown drains in-flight chunks + handleEnd + AsyncDbWriter before resolving | VERIFIED | server.ts line 1640: `await terminateUsageWorker()` called in `handleGracefulShutdown`. `terminateUsageWorker()` in proxy.ts line 174 delegates to `usageWorkerController.terminate()` which sends shutdown message + waits for shutdown-complete + drains AsyncDbWriter. |
| 7 | All post-#245 hardening preserved (currentEvent reset, then/catch cleanup, allSettled drain, cacheBodyStore, cacheCreationInputTokens, providerCostUsd) | VERIFIED | Unchanged from prior verification — `post-processor.worker.ts` retains all hardening items. No regression observed. |
| 8 | Build step regenerates inline-worker.ts from post-processor.worker.ts; no tiktoken; RSS soak gated | VERIFIED | Unchanged from prior verification — build script intact, no `@dqbd/tiktoken` import, RSS soak gated behind `RUN_RSS_SOAK`. |

**Score: 8/8 truths verified**

---

## Key Link Verification (Re-checked)

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `response-handler.ts` onChunk | worker controller | `getUsageWorker().postMessage(msg)` in `safeHandleChunk` | WIRED | Confirmed at lines 49-66 of response-handler.ts |
| `server.ts` startup | `UsageWorkerController.start()` | `startUsageWorker()` line 849 | WIRED | Confirmed at server.ts:849 |
| `server.ts` startup | worker storePayloads | `sendWorkerConfigUpdate(config.getStorePayloads())` line 850 | WIRED | Confirmed at server.ts:850 |
| `server.ts` config change | worker storePayloads | `sendWorkerConfigUpdate` in `config.on("change")` handler | WIRED | Confirmed at server.ts:1040-1042 |
| `server.ts` shutdown | `UsageWorkerController.terminate()` | `terminateUsageWorker()` line 1640 | WIRED | Confirmed at server.ts:1640 |
| Health endpoint | `getUsageWorkerHealth()` | `getUsageWorkerHealth: () => getUsageWorkerHealth()` | WIRED | Confirmed at server.ts:689 — reports real worker state, not sync collector |
| `proxy.ts` pool-exhausted path | worker controller | `getUsageWorker().postMessage()` with guard | WIRED | Confirmed at proxy.ts:391-443 — both start and end messages use worker |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Task-specific tests | `bun test usage-worker-controller.test.ts response-handler-worker-protocol.test.ts worker-transfer-aliasing.test.ts` | 26 pass, 0 fail, 94 expect() calls, 284ms | PASS |
| `getUsageCollector` absent in response-handler | `grep getUsageCollector packages/proxy/src/response-handler.ts` | (no output) | PASS |
| `startUsageWorker` called in server.ts | `grep startUsageWorker apps/server/src/server.ts` | line 57 (import), line 849 (call) | PASS |
| `terminateUsageWorker` called in server.ts | `grep terminateUsageWorker apps/server/src/server.ts` | line 59 (import), line 1640 (call) | PASS |
| `sendWorkerConfigUpdate` called in server.ts | `grep sendWorkerConfigUpdate apps/server/src/server.ts` | line 54 (import), line 850 (startup), line 1041 (hot-reload) | PASS |
| Health endpoint uses worker health | server.ts line 689 | `getUsageWorkerHealth: () => getUsageWorkerHealth()` | PASS |
| Transfer list in controller | usage-worker-controller.ts:181 | `this.worker?.postMessage(msg, [chunkBuf])` | PASS |
| Pool-exhausted path uses worker | proxy.ts:391-443 | `getUsageWorker().postMessage(...)` with try/catch guard | PASS |

---

## Anti-Patterns (Re-checked)

Previously flagged misleading comments in `response-handler.ts` (line 117-119: "forwarding data to worker for async processing" with synchronous collector) and `server.ts` (comment about getStorePayloads getter being sufficient for worker). Both are resolved:
- `response-handler.ts` comment at line 133-135 now accurately says "forwarding data to usage worker for async off-thread processing"
- `server.ts` no longer has the stale "picked up automatically via getStorePayloads getter" comment for the worker

No new anti-patterns found.

---

## Summary

All three previously FAILED/PARTIAL truths are now VERIFIED:

**CR-02 closed:** `response-handler.ts` no longer calls `getUsageCollector()`. It imports `getUsageWorker` from `./proxy` and dispatches `StartMessage`, `ChunkMessage` (with `value.slice()` copy + `[copy.buffer]` transfer list via the controller), and `EndMessage` to the worker controller through guarded helpers. The pool-exhausted path in `proxy.ts` likewise uses `getUsageWorker()`.

**CR-01 closed:** `server.ts` imports `startUsageWorker`, `sendWorkerConfigUpdate`, `terminateUsageWorker`, and `getUsageWorkerHealth` from `@better-ccflare/proxy`. On startup: `startUsageWorker()` then `sendWorkerConfigUpdate(config.getStorePayloads())`. On `store_payloads` config change: `sendWorkerConfigUpdate(config.getStorePayloads())`. On shutdown: `await terminateUsageWorker()`. Health endpoint: `getUsageWorkerHealth: () => getUsageWorkerHealth()`.

All implementation quality constraints verified: aliasing rule (slice copy, never transfer client buffer), swallow-guard on all dispatch helpers, bounded buffer-until-ready in controller, ConfigUpdate propagation on start and hot-reload, no `@dqbd/tiktoken` import in worker, RSS soak test gated.

**Net assessment:** The primary architectural goal — per-request usage accounting running OFF the main-thread proxy hot path on a background Bun Worker with transferable ArrayBuffers — is now achieved and wired end-to-end.

---

_Initial Verification: 2026-06-17T12:00:00Z (status: gaps_found, score: 5/8)_
_Re-Verification: 2026-06-17T14:00:00Z (status: passed, score: 8/8)_
_Verifier: Claude (gsd-verifier)_
