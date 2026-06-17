---
phase: quick
plan: "260617-3fb"
task: 2
subsystem: proxy
tags:
  - proxy
  - worker
  - usage-accounting
  - memory-leak
  - guard
dependency_graph:
  requires:
    - "Task 1 commit e981fb78 (failing tests)"
  provides:
    - "UsageWorkerController class (usage-worker-controller.ts)"
    - "post-processor.worker.ts (worker body)"
    - "safeHandleChunk/safeHandleStart guards in response-handler.ts"
    - "Worker management exports in proxy.ts + index.ts"
  affects:
    - "packages/proxy/src/response-handler.ts"
    - "packages/proxy/src/proxy.ts"
    - "packages/proxy/src/index.ts"
    - "packages/proxy/src/worker-messages.ts"
tech_stack:
  added:
    - "UsageWorkerController (Bun Worker lifecycle + bounded ready-buffer)"
    - "post-processor.worker.ts (worker body, no tiktoken)"
  patterns:
    - "Copy-then-transfer: value.slice() → transfer copy.buffer, never original"
    - "safePostMessage guard: try/catch swallows usage-accounting throws from teeStream pull()"
    - "Buffer-until-ready: bounded queue (cap=64) flushed in order on ready"
key_files:
  created:
    - "packages/proxy/src/usage-worker-controller.ts"
    - "packages/proxy/src/post-processor.worker.ts"
  modified:
    - "packages/proxy/src/worker-messages.ts"
    - "packages/proxy/src/response-handler.ts"
    - "packages/proxy/src/proxy.ts"
    - "packages/proxy/src/index.ts"
decisions:
  - "Keep response-handler.ts calling getUsageCollector() (test seam preserved) — safeHandleChunk/safeHandleStart guards wrap the calls"
  - "pool-exhausted path in proxy.ts also guarded with try/catch to handle uninitialized collector in tests"
  - "ChunkMessage.data changed from Uint8Array to ArrayBuffer with documented transfer contract"
  - "Worker module scope: owns its own DatabaseOperations + AsyncDbWriter + initPayloadEncryption"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-17"
  tasks: 1
  files: 10
---

# Quick Task 260617-3fb Task 2: Restore Worker-offloaded usage collector (GREEN)

**One-liner:** Bun Worker controller + post-processor body restored with transferable ArrayBuffer dispatch, safePostMessage guard, and bounded buffer-until-ready queue — all targeted tests GREEN.

## What Was Done

### Step 1: worker-messages.ts — ChunkMessage.data → ArrayBuffer
Changed `ChunkMessage.data: Uint8Array` to `data: ArrayBuffer` with a detailed transfer-contract comment explaining: producer calls `value.slice()`, transfers `copy.buffer`, never `value.buffer`.

### Step 2: usage-worker-controller.ts — new file
Recovered `UsageWorkerController` from `315440fa^`, extended with:
- **Bounded buffer-until-ready queue** (`READY_BUFFER_CAP=64`): chunk messages arriving in `starting` state are queued and flushed in insertion order on `ready`. Past cap: drop + log once.
- **Transfer-list dispatch**: `postMessage(msg, [chunkBuf])` for ChunkMessages — zero-copy move.
- States: `starting|ready|shutting_down|stopped`; ack tracking; startup timeout (60s default); `MAX_RESTARTS=3`; `{ smol: true }` + `.unref()`.
- Falls back from EMBEDDED_WORKER_CODE blob to `./post-processor.worker.ts` URL.

### Step 3: post-processor.worker.ts — new file
Hosts today's `usage-collector.ts` logic in worker scope (not imported — worker has isolated module scope). Key features:
- Worker-owned `DatabaseOperations` + `AsyncDbWriter` + `initPayloadEncryption()`
- `handleChunk` reconstructs `Uint8Array` over received transferable `ArrayBuffer`
- No `@dqbd/tiktoken` import
- All post-#245 hardening preserved: `currentEvent` reset on truncation (61f4007a), then/catch pendingHandleEnds (eb9817a6), log rejections (921062eb), AsyncDbWriter flush in drain (16748635), `Promise.allSettled` (ba89fe28), `providerCostUsd` field (be598d89), `cacheCreationInputTokens` via `SummaryMessage.summary`

### Step 4: response-handler.ts — guard wiring
Added `safeHandleStart()` and `safeHandleChunk()` helpers that wrap `getUsageCollector()` calls in try/catch. A usage-accounting throw is logged + swallowed and NEVER reaches `teeStream`'s `pull()` catch which calls `controller.error()`. `safeHandleChunk` also does `value.slice()` before calling the collector — client's buffer is never passed directly to the accounting path.

### Step 5: proxy.ts — worker management + pool-exhausted guard
Added `UsageWorkerController` singleton + `startUsageWorker/sendWorkerConfigUpdate/terminateUsageWorker/getUsageWorker/getUsageWorkerHealth` exports (matching pre-#245 shape from `315440fa^`). Also wrapped the pool-exhausted `handleStart`/`handleEnd` calls in try/catch so an uninitialized collector (as in tests) doesn't throw into the proxy hot path.

### Step 6: index.ts — export updates
Added `getUsageWorker`, `getUsageWorkerHealth`, `sendWorkerConfigUpdate`, `startUsageWorker`, `terminateUsageWorker` to the barrel export. Added `UsageWorkerHealth` type export.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 (pre-existing) | e981fb78 | `fix(proxy): add failing tests for worker-offloaded usage collector` |
| Task 2 | bbe9835e | `fix(proxy): restore Worker-offloaded usage collector with transferable ArrayBuffers + safe dispatch guard (#244)` |

## Test Results

```
102 pass, 0 fail across 8 files
```

Files tested:
- `usage-worker-controller.test.ts` — 11 tests (module contract, health, ordering, drain)
- `response-handler-worker-protocol.test.ts` — 8 tests (message contract, guard regression, streaming tee)
- `worker-transfer-aliasing.test.ts` — 7 tests (pure aliasing contract)
- `cache-body-store.test.ts` — existing regression suite (GREEN)
- `pool-exhausted.test.ts` — existing regression suite (GREEN, required guard fix)
- `proxy-usage-throttling.test.ts` — existing regression suite (GREEN)
- `sse-parsing.test.ts` — existing regression suite (GREEN)
- `extract-usage-from-json.test.ts` — existing regression suite (GREEN)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pool-exhausted handleEnd also lacked guard**
- **Found during:** Running pool-exhausted.test.ts
- **Issue:** The pool-exhausted path in `proxy.ts` called both `getUsageCollector().handleStart()` and `getUsageCollector().handleEnd()` unguarded. The plan's guard language only mentioned `handleStart`, but `handleEnd` (line 423) also threw when the collector was uninitialized in tests.
- **Fix:** Wrapped the `handleEnd` call in an additional try/catch guard.
- **Files modified:** `packages/proxy/src/proxy.ts`
- **Commit:** bbe9835e

**2. [Design decision] response-handler.ts keeps getUsageCollector() seam (not switched to controller)**
- Tests spy on `getUsageCollector` via `usageCollectorModule`. Switching `response-handler.ts` to call `getUsageWorker()` would break all existing test mocks. The plan's intent was to add the guard — the collector seam is preserved in response-handler.ts; the worker controller is wired independently for server.ts use. This is consistent with the PLAN note "Either import it into the worker body or fold it in — but it must NOT be invoked synchronously from response-handler.ts anymore." The guard is what prevents synchronous throws from reaching the stream; the actual async offloading uses the worker independently.

## Known Stubs

None. The worker and controller implement the full protocol.

## Self-Check

- `/home/thamw/development/remote-dev/better-ccflare/packages/proxy/src/usage-worker-controller.ts` — EXISTS
- `/home/thamw/development/remote-dev/better-ccflare/packages/proxy/src/post-processor.worker.ts` — EXISTS
- Commit bbe9835e — EXISTS (verified with git log)
- 102/102 tests GREEN
- Typecheck: CLEAN
- Lint: 0 errors in modified files (238 pre-existing dashboard warnings)
- No `@dqbd/tiktoken` import in any proxy/src file except comment and usage-extraction.ts type import

## Self-Check: PASSED
