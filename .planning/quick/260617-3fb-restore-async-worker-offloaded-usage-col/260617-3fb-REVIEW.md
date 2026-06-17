---
phase: quick-260617-3fb
reviewed: 2026-06-17T00:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - packages/proxy/src/worker-messages.ts
  - packages/proxy/src/usage-worker-controller.ts
  - packages/proxy/src/post-processor.worker.ts
  - packages/proxy/src/response-handler.ts
  - packages/proxy/src/proxy.ts
  - packages/proxy/src/index.ts
  - packages/types/src/context.ts
  - apps/server/src/server.ts
  - apps/cli/package.json
findings:
  critical: 2
  warning: 4
  info: 1
  total: 7
status: issues_found
---

# Quick Task 260617-3fb: Code Review Report

**Reviewed:** 2026-06-17
**Depth:** deep
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The task set out to restore a Bun Worker-offloaded usage collector with transferable ArrayBuffers and a safe dispatch guard, replacing the synchronous main-thread collector introduced by PR #245. The worker infrastructure itself (`UsageWorkerController`, `post-processor.worker.ts`, `worker-messages.ts`, and the build step) is implemented correctly and looks solid. However, the wiring between that infrastructure and the live proxy hot path was never completed: `response-handler.ts` and the pool-exhausted path in `proxy.ts` still dispatch via `getUsageCollector()` (the synchronous main-thread singleton), and `server.ts` never calls `startUsageWorker()` or `sendWorkerConfigUpdate()`. As a result the worker is instantiated at module load but never started, all accounting traffic flows through the old synchronous collector, and the primary objectives of the task — off-main-thread accounting, transferable-buffer aliasing fix, and dispatch guard — are not operative in production.

---

## Critical Issues

### CR-01: Worker never started — accounting still runs synchronously on main thread

**File:** `apps/server/src/server.ts:44-59, 846`
**Issue:** `server.ts` imports only `drainUsageCollector`, `getUsageCollectorHealth`, and `initProxy` from `@better-ccflare/proxy`. It never imports or calls `startUsageWorker()`, `sendWorkerConfigUpdate()`, or `terminateUsageWorker()`. The `UsageWorkerController` instance is constructed at module load (as a side-effect of `import './proxy'`) but its `start()` method is never invoked, so the worker remains in `"stopped"` state for the lifetime of the process. On shutdown, `drainUsageCollector()` (the old sync collector drain) is called instead of `terminateUsageWorker()`.

The net effect: every byte of usage accounting runs synchronously on the main thread through the old `UsageCollector` singleton, and the Bun Worker is a dead artifact consuming no events. All three invariants the task was built to restore — off-hot-path accounting, transferable-buffer aliasing fix (#244), and dispatch guard (#245) — are inoperative.

**Fix:**
```typescript
// apps/server/src/server.ts — in the import block (alongside drainUsageCollector):
import {
  drainUsageCollector,       // keep for old collector drain if still needed
  getUsageCollectorHealth,
  getUsageWorkerHealth,      // add
  handleProxy,
  initProxy,
  sendWorkerConfigUpdate,    // add
  startUsageWorker,          // add
  terminateUsageWorker,      // add
  ...
} from "@better-ccflare/proxy";

// After initProxy() call (~line 846):
initProxy(() => config.getStorePayloads());
startUsageWorker();
sendWorkerConfigUpdate(config.getStorePayloads());

// In the config "change" handler (~line 1036) — replace the comment with a live call:
config.on("change", ({ key }: { key: string }) => {
  if (key === "store_payloads") {
    sendWorkerConfigUpdate(config.getStorePayloads());
  }
  // ... existing lb_strategy handler
});

// In handleGracefulShutdown (~line 1634) — replace drainUsageCollector with:
await terminateUsageWorker();
// (drainUsageCollector can be removed entirely once the old collector is retired)
```

---

### CR-02: response-handler.ts dispatches to the synchronous main-thread collector, not the worker

**File:** `packages/proxy/src/response-handler.ts:12, 28, 48, 55`
**Issue:** `response-handler.ts` imports `getUsageCollector` from `./usage-collector` and calls `getUsageCollector().handleStart(msg)`, `getUsageCollector().handleChunk(requestId, copy)`, and `getUsageCollector().handleEnd(msg)` for every request. This is the synchronous path the task was designed to replace. The copy produced by `value.slice()` at line 47 is passed to `handleChunk` on the main-thread `UsageCollector`, not transferred to the worker, so:

1. The `#244` off-heap RSS leak is not fixed (the copy is structured-clone-copied across a zero boundary rather than zero-copy moved).
2. The copy's `ArrayBuffer` is never passed in a transfer list, so the buffer stays on the main-thread heap.
3. The `UsageWorkerController.postMessage` transfer path is never exercised by real traffic.

The pool-exhausted path in `proxy.ts` (lines 392-445) also goes through `getUsageCollector()` directly, which is consistent with the response-handler path but both are wrong.

**Fix:**

In `response-handler.ts`, replace the import and dispatch calls:
```typescript
// Remove:
import { getUsageCollector } from "./usage-collector";

// Add (response-handler.ts receives ctx: ProxyContext; proxy.ts must pass getUsageWorker() in ctx, or import the accessor):
import { getUsageWorker } from "./proxy";

// safeHandleStart:
function safeHandleStart(msg: StartMessage): void {
  try {
    const w = getUsageWorker();
    if (w.isReady()) w.postMessage(msg);
    // If not ready the StartMessage is silently dropped until worker is up.
    // Alternative: also queue StartMessages or skip if worker stopped.
  } catch (err: unknown) {
    log.warn(`handleStart swallowed for request ${msg.requestId}:`, err);
  }
}

// safeHandleChunk — already produces a copy; just redirect the transfer to the controller:
function safeHandleChunk(requestId: string, value: Uint8Array): void {
  try {
    const copy = value.slice();
    const msg: ChunkMessage = { type: "chunk", requestId, data: copy.buffer };
    getUsageWorker().postMessage(msg); // controller passes [msg.data] internally
  } catch (err: unknown) {
    log.warn(`handleChunk swallowed for request ${requestId}:`, err);
  }
}

// fireAndForgetEnd — redirect:
function fireAndForgetEnd(msg: EndMessage): void {
  try {
    const w = getUsageWorker();
    if (w.isReady()) w.postMessage(msg);
  } catch (err: unknown) {
    log.error(`handleEnd failed for request ${msg.requestId}`, err);
  }
}
```

The pool-exhausted path in `proxy.ts` (lines 392-445) needs the same treatment: replace `getUsageCollector().handleStart(...)` and `getUsageCollector().handleEnd(...)` with guarded `usageWorkerController.postMessage(...)` calls consistent with the worker protocol.

---

## Warnings

### WR-01: onerror does not call attemptRestart during "starting" state — startup crashes go unhandled

**File:** `packages/proxy/src/usage-worker-controller.ts:114-126`
**Issue:** The `onerror` handler only calls `attemptRestart()` when `this.state === "ready"`. If the worker crashes or throws an unhandled error during startup (e.g., `initPayloadEncryption()` rejects, or the worker JS itself has a parse error), `onerror` fires while `this.state === "starting"`, the guard at line 123 is false, and nothing happens: `restartCount` stays at 0, `state` stays `"starting"` forever, and the startup timer will eventually fire and call `attemptRestart()`. However, between the crash and the timeout (up to 60 seconds by default), the controller reports `state: "starting"` and silently drops all incoming chunks into the bounded buffer, which fills and starts dropping. The worker is effectively dead but the controller doesn't know it yet.

**Fix:**
```typescript
this.worker.onerror = (error: ErrorEvent) => {
  const msg = error.message ?? "unknown worker error";
  log.error("Worker error", { message: msg, filename: error.filename, lineno: error.lineno });
  this.lastError = msg;

  // Restart on error in ANY non-terminal state (starting or ready):
  if (this.state === "starting" || this.state === "ready") {
    this.attemptRestart();
  }
};
```

---

### WR-02: readyBuffer drops chunks from "shutting_down" / "stopped" states without logging

**File:** `packages/proxy/src/usage-worker-controller.ts:168-172`
**Issue:** When `postMessage` is called with a chunk and `this.state` is `"shutting_down"` or `"stopped"` (e.g., after `MAX_RESTARTS` exhausted), the code falls through to the second branch at line 168 and throws `"Cannot post message: worker state is ..."`. This throw propagates to the caller. If the caller is the (currently-not-wired) `safeHandleChunk` guard in `response-handler.ts`, it would be caught and swallowed. However, the throw is undocumented, and callers relying on the method silently dropping (rather than throwing) in terminal states would be surprised. More importantly, if the worker reaches `"stopped"` due to `MAX_RESTARTS`, every subsequent chunk dispatch throws and the guard log output is at `warn` level — there is no clear signal that chunk delivery is permanently lost.

**Fix:**
```typescript
if (msg.type === "chunk") {
  if (this.state === "starting") {
    // ... existing buffer logic
    return;
  }
  if (this.state === "shutting_down" || this.state === "stopped") {
    // Worker is not functional; drop silently (guard in caller logs already)
    return;
  }
  // state === "ready"
  const chunkBuf = (msg as ChunkMessage).data;
  this.worker?.postMessage(msg, [chunkBuf]);
  return;
}
```

---

### WR-03: URL object URL never revoked after worker creation — memory leak on MAX_RESTARTS

**File:** `packages/proxy/src/usage-worker-controller.ts:346-347`
**Issue:** When `EMBEDDED_WORKER_CODE` is set, `createWorker()` calls `URL.createObjectURL(blob)` and passes the resulting URL to `new Worker(workerUrl, ...)` but never stores `workerUrl` for later revocation. Every restart that goes through `createWorker()` creates a new Blob + object URL that is never revoked. With `MAX_RESTARTS=3` this creates at most 4 leaked object URLs, which is small but a correctness issue given the explicit `.unref()` hygiene already in the method.

**Fix:**
```typescript
private createWorker(): Worker {
  let w: Worker;
  let workerUrl: string | null = null;

  if (EMBEDDED_WORKER_CODE) {
    const workerCode = Buffer.from(EMBEDDED_WORKER_CODE, "base64").toString("utf8");
    const blob = new Blob([workerCode], { type: "text/javascript" });
    workerUrl = URL.createObjectURL(blob);
    w = new Worker(workerUrl, { smol: true });
    // Schedule revocation on next microtask so the Worker has time to load:
    Promise.resolve().then(() => URL.revokeObjectURL(workerUrl!));
  } else {
    // ...
  }
  // ...
}
```

---

### WR-04: `getUsageWorkerHealth` in server.ts is wired to the wrong health source

**File:** `apps/server/src/server.ts:687`
**Issue:** The `APIContext.getUsageWorkerHealth` callback is set to `() => getUsageCollectorHealth()` (the synchronous collector's health), not `() => getUsageWorkerHealth()` (the controller's health). Even after wiring `startUsageWorker()`, the API health endpoint would report the sync collector state (`{ state: "ready" }` always), masking the real worker state (`starting`, `stopped`, etc.). This is currently harmless since the worker is never started, but it is wrong for the intended design.

**Fix:**
```typescript
// apps/server/src/server.ts:687
// Change:
getUsageWorkerHealth: () => getUsageCollectorHealth(),
// To (after adding getUsageWorkerHealth to the import):
getUsageWorkerHealth: () => getUsageWorkerHealth(),
```

---

## Info

### IN-01: `initProxy` and `drainUsageCollector` exports are now dead code now that the worker is the intended path

**File:** `packages/proxy/src/index.ts:43-44, 59`
**Issue:** `initProxy` and `drainUsageCollector` (and `getUsageCollectorHealth`, `UsageCollectorHealth`) are still exported from the proxy barrel. They will become dead exports once the wiring (CR-01, CR-02) is completed and `server.ts` is updated to the worker lifecycle. These exports are not harmful now but leaving them in place makes it unclear to future maintainers that the sync collector path has been retired.

**Fix:** After CR-01 and CR-02 are resolved, remove `initProxy`, `drainUsageCollector`, `getUsageCollectorHealth`, and `UsageCollectorHealth` from `packages/proxy/src/index.ts` and stop calling `initProxy()` in `server.ts`. This is a cleanup step — do not do it before the wiring is complete.

---

_Reviewed: 2026-06-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
