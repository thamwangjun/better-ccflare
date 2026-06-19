# Quick Task 260620-29c: Fix Usage Data Loss — Research

**Researched:** 2026-06-20
**Domain:** UsageWorkerController state machine + response-handler fallback routing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Store backoff setTimeout ID in `private restartTimer: ReturnType<typeof setTimeout> | null = null`
- `clearTimeout(this.restartTimer)` in `terminate()` before transitioning to `shutting_down`
- When `safeHandleChunk` receives a requestId NOT in `collectorRequestIds` and worker is `stopped`/`shutting_down`, log a `warn` surfacing the data loss
- Pattern: check `getUsageWorker().isStopped()` inside the else branch of `safeHandleChunk`
- Export `resetForTesting()` from `response-handler.ts` to clear `collectorRequestIds` in `beforeEach`

### Claude's Discretion
- Exact field name for timer ID (`restartTimer`, `backoffTimer`, etc.)
- Exact log message wording for mid-transition warn
- Whether `resetForTesting()` also resets other module-level state

### Deferred Ideas (OUT OF SCOPE)
None stated.
</user_constraints>

---

## Summary

The fix has two orthogonal pieces:

**Piece 1 — UsageWorkerController:** Replace the permanent "stopped after MAX_RESTARTS" terminal state with exponential backoff restarts. Add `exhaustionCycles` counter that increments each time `restartCount` hits `MAX_RESTARTS`, resets `restartCount = 0`, and schedules the next `start()` after `Math.min(30_000, 1_000 * 2 ** exhaustionCycles)` ms. Store the `setTimeout` ID so `terminate()` can cancel it. Add `isStopped(): boolean` public method.

**Piece 2 — response-handler.ts:** Add a module-level `collectorRequestIds: Set<string>` that tracks active requests. `safeHandleStart` adds the ID; `fireAndForgetEnd` deletes it. The else branch of `safeHandleChunk` (where the worker dropped the chunk) checks `isStopped()` and warns with the requestId so data loss is diagnosable. Export `resetForTesting()` to wipe the Set between tests.

**Primary recommendation:** Implement both pieces together in one commit — they are coupled only through `isStopped()`, which is a trivial one-liner on the controller.

---

## Exact Code Signatures (VERIFIED from codebase)

### response-handler.ts — current state [VERIFIED: file read]

```typescript
// Current safeHandleStart — posts only when isReady()
function safeHandleStart(msg: StartMessage): void {
  try {
    const w = getUsageWorker();
    if (w.isReady()) {
      w.postMessage(msg);
    }
  } catch (err: unknown) {
    log.warn(`handleStart swallowed for request ${msg.requestId}:`, err);
  }
}

// Current safeHandleChunk — no isStopped() guard
function safeHandleChunk(requestId: string, value: Uint8Array): void {
  try {
    const copy = value.slice();
    const msg: ChunkMessage = { type: "chunk", requestId, data: copy.buffer };
    getUsageWorker().postMessage(msg);
  } catch (err: unknown) {
    log.warn(`handleChunk swallowed for request ${requestId}:`, err);
  }
}

// Current fireAndForgetEnd — posts only when isReady()
function fireAndForgetEnd(msg: EndMessage): void {
  try {
    const w = getUsageWorker();
    if (w.isReady()) {
      w.postMessage(msg);
    }
  } catch (err: unknown) {
    log.error(`handleEnd failed for request ${msg.requestId}`, err);
  }
}
```

**Key gap:** `collectorRequestIds` does NOT exist yet in `response-handler.ts`. It must be added as a new module-level `Set<string>`. [VERIFIED: grep found zero matches]

### usage-worker-controller.ts — relevant internals [VERIFIED: file read]

```typescript
// Current field state (all private):
private state: WorkerState = "stopped";           // "starting"|"ready"|"shutting_down"|"stopped"
private restartCount = 0;
private startupTimer: Timer | null = null;
// Missing: restartTimer, exhaustionCycles, isStopped()

// Current attemptRestart() — enters permanent stopped after MAX_RESTARTS=3
private attemptRestart(): void {
  this.destroyWorker();
  if (this.restartCount >= MAX_RESTARTS) {
    log.error(`Worker failed after ${MAX_RESTARTS} restarts — giving up`);
    this.state = "stopped";  // ← TERMINAL, no recovery
    return;
  }
  this.restartCount++;
  this.state = "stopped";
  this.start();
}

// Current terminate() — does NOT clear backoff timer (doesn't exist yet)
terminate(): Promise<void> {
  if (this.state === "stopped") return Promise.resolve();
  this.state = "shutting_down";
  // ... missing: clearTimeout(this.restartTimer)
}
```

### tryGetUsageCollector() [VERIFIED: file read, lines 940-942]

```typescript
export function tryGetUsageCollector(): UsageCollector | null {
  return _usageCollector;  // returns null if initUsageCollector() never called
}
```

Returns `null` if not initialized. Callers must null-check before use.

### getUsageWorker() export [VERIFIED: proxy.ts read]

```typescript
// proxy.ts
export function getUsageWorker(): UsageWorkerController {
  return usageWorkerController;
}
```

`UsageWorkerController` is module-level singleton in `proxy.ts`. `response-handler.ts` imports it via `import { getUsageWorker } from "./proxy"`. [VERIFIED: line 11 of response-handler.ts]

---

## Architecture Patterns

### Backoff Design (from CONTEXT.md specifics)

```typescript
// New fields to add to UsageWorkerController:
private exhaustionCycles = 0;
private restartTimer: ReturnType<typeof setTimeout> | null = null;

// Modified attemptRestart():
private attemptRestart(): void {
  this.destroyWorker();
  if (this.restartCount >= MAX_RESTARTS) {
    this.restartCount = 0;
    this.exhaustionCycles++;
    const delay = Math.min(30_000, 1_000 * 2 ** this.exhaustionCycles);
    log.warn(`Worker exhausted ${MAX_RESTARTS} restarts — backing off ${delay}ms (cycle ${this.exhaustionCycles})`);
    this.state = "stopped";
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, delay);
    return;
  }
  this.restartCount++;
  this.state = "stopped";
  this.start();
}

// New public method:
isStopped(): boolean {
  return this.state === "stopped";
}

// Modified terminate():
terminate(): Promise<void> {
  if (this.state === "stopped") return Promise.resolve();
  clearTimeout(this.restartTimer ?? undefined);  // cancel pending backoff
  this.restartTimer = null;
  this.state = "shutting_down";
  // ... rest unchanged
}
```

### collectorRequestIds Set Design

```typescript
// New module-level state in response-handler.ts:
const collectorRequestIds = new Set<string>();

// Export for test isolation:
export function resetForTesting(): void {
  collectorRequestIds.clear();
}

// Modified safeHandleStart:
function safeHandleStart(msg: StartMessage): void {
  try {
    const w = getUsageWorker();
    collectorRequestIds.add(msg.requestId);  // track before dispatch
    if (w.isReady()) {
      w.postMessage(msg);
    }
  } catch (err: unknown) {
    log.warn(`handleStart swallowed for request ${msg.requestId}:`, err);
  }
}

// Modified fireAndForgetEnd:
function fireAndForgetEnd(msg: EndMessage): void {
  try {
    collectorRequestIds.delete(msg.requestId);  // remove on end
    const w = getUsageWorker();
    if (w.isReady()) {
      w.postMessage(msg);
    }
  } catch (err: unknown) {
    log.error(`handleEnd failed for request ${msg.requestId}`, err);
  }
}

// Modified safeHandleChunk else branch:
function safeHandleChunk(requestId: string, value: Uint8Array): void {
  try {
    const copy = value.slice();
    const msg: ChunkMessage = { type: "chunk", requestId, data: copy.buffer };
    const w = getUsageWorker();
    if (collectorRequestIds.has(requestId)) {
      w.postMessage(msg);
    } else if (w.isStopped()) {
      log.warn(`safeHandleChunk: data loss for requestId=${requestId} — worker stopped mid-request`);
    }
  } catch (err: unknown) {
    log.warn(`handleChunk swallowed for request ${requestId}:`, err);
  }
}
```

**Note:** The CONTEXT.md says "requestId NOT in `collectorRequestIds` but worker is in stopped/shutting_down" → warn. The check is `!collectorRequestIds.has(requestId) && w.isStopped()`. However, re-reading the CONTEXT: the existing `postMessage()` in the controller already handles `stopped`/`shutting_down` by dropping with a log warn (line 173–178 of `usage-worker-controller.ts`). The `collectorRequestIds` guard in `safeHandleChunk` is a DIFFERENT purpose: route to in-process collector for requests that started before the worker failed. A cleaner read of the spec: `collectorRequestIds` tracks which requestIds got a `start` message dispatched to the worker. If a chunk arrives for a tracked ID but the worker is now stopped, fall back to `tryGetUsageCollector()` for that chunk. If the ID is NOT tracked (request started during stopped state), log the data loss. [ASSUMED: interpretation of the routing intent — the CONTEXT.md says "route new requests to the in-process UsageCollector fallback" but doesn't spell out the chunk-level routing logic beyond the warn]

---

## Test Infrastructure [VERIFIED: test file read]

### Existing Test File: response-handler-worker-protocol.test.ts

- Imports: `{ describe, expect, it, mock, spyOn }` from `"bun:test"`
- Mock pattern: `spyOn(proxyModule, "getUsageWorker").mockReturnValue(mockController as unknown as ReturnType<typeof proxyModule.getUsageWorker>)`
- Restore pattern: `spy.mockRestore()` in `finally` block
- Mock controller shape: `{ isReady: mock(() => true), postMessage: mock(...) }`
- NO `beforeEach` currently — tests are self-contained with `try/finally restore()`
- NO module-level `mock.module()` — uses `spyOn` on the named export

### New Test Cases Required

**For `resetForTesting()` / Set isolation:**
```typescript
import { resetForTesting, forwardToClient } from "../response-handler";

beforeEach(() => { resetForTesting(); });  // clear collectorRequestIds
```

**For `isStopped()` on controller:**
- Mock the controller with `isStopped: mock(() => true)` alongside `isReady: mock(() => false)`
- Verify `warn` is called when chunk arrives for unknown requestId with stopped worker

**For backoff timer in `usage-worker-controller.test.ts`:**
- `bun:test` does NOT have `useFakeTimers()` or `advanceTimersByTime()`. [VERIFIED: zero matches in grep across all test files]
- **Workaround:** Use `startupTimeoutMs: 0` pattern (the controller constructor accepts `startupTimeoutMs` and `ackTimeoutMs` overrides). For backoff, the delay is computed in `attemptRestart()` — to test it, either (a) expose the delay computation as a pure function and test that separately, or (b) use a very short delay (1ms) by injecting a small `exhaustionCycles` state somehow.
- **Practical approach:** Test backoff by sub-classing or by checking that `restartTimer` is set (if exposed via `getHealth()`), or by checking `isStopped()` returns `true` immediately after MAX_RESTARTS exhaustion and `false` after the timer fires using a real (short) `setTimeout`.

---

## Common Pitfalls

### Pitfall 1: inline-worker.ts must not be touched
**What goes wrong:** Editing `packages/proxy/src/inline-worker.ts` corrupts the auto-generated embedded worker.
**Prevention:** Only edit `packages/proxy/src/post-processor.worker.ts`. The build step regenerates `inline-worker.ts`. The new `isStopped()` and backoff live in `usage-worker-controller.ts`, not the worker.

### Pitfall 2: `postMessage()` throws for non-chunk in non-ready state
**What goes wrong:** `usage-worker-controller.ts` line 186-189 throws `Error` for non-chunk messages when state is not `"ready"`. `safeHandleStart` guards with `if (w.isReady())` so it won't throw — but if the guard is removed or the message type changes, the throw propagates.
**Prevention:** Keep the `isReady()` guard in `safeHandleStart` and `fireAndForgetEnd`. The throw contract is intentional.

### Pitfall 3: `collectorRequestIds` Set state persists across bun:test tests
**What goes wrong:** Module-level `Set` is initialized once per module load. bun:test does NOT re-import modules between tests by default. State set in one test leaks into the next.
**Prevention:** Export `resetForTesting()` and call it in `beforeEach`. This is a locked decision from CONTEXT.md.

### Pitfall 4: `clearTimeout` in `terminate()` receives wrong type
**What goes wrong:** `setTimeout` returns `ReturnType<typeof setTimeout>` (which is `Timer` in Bun, not `number`). `clearTimeout` accepts `Timer | null | undefined`. Passing `null` directly to `clearTimeout` is safe; passing `undefined` is also safe. But TypeScript will complain if the type annotation doesn't match.
**Prevention:** Type the field as `ReturnType<typeof setTimeout> | null = null` and call `clearTimeout(this.restartTimer ?? undefined)` or `if (this.restartTimer !== null) clearTimeout(this.restartTimer)`.

### Pitfall 5: `tryGetUsageCollector()` returns null in tests
**What goes wrong:** `tryGetUsageCollector()` returns `null` when `initUsageCollector()` was never called. Tests that exercise the fallback path without initializing the collector will hit `null?.handleStart(...)` and silently do nothing.
**Prevention:** Either mock `tryGetUsageCollector` via `spyOn` from `usage-collector` module, or call `initUsageCollector()` with a mock DB in test setup.

### Pitfall 6: `exhaustionCycles` resets vs. `restartCount` resets
**What goes wrong:** Resetting `restartCount = 0` on exhaustion but NOT resetting `exhaustionCycles` is correct — `exhaustionCycles` should monotonically increase so backoff delay grows across repeated failures. But if `exhaustionCycles` is also reset, backoff always stays at 1s.
**Prevention:** Only reset `restartCount` on exhaustion; `exhaustionCycles` increments forever (capped by the `Math.min(30_000, ...)` formula).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `collectorRequestIds` is used to gate chunk routing (not just warn), with `tryGetUsageCollector()` as fallback for in-flight requests | Architecture Patterns note | If wrong, the fallback routing to in-process collector is missing; only the warn gets added |
| A2 | `bun:test` has no built-in fake timer API (useFakeTimers/advanceTimersByTime) | Test Infrastructure | If wrong, backoff tests can use fake timers instead of real short timeouts |

---

## Environment Availability

Step 2.6: SKIPPED — this is a code-only change with no external dependencies.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (native) |
| Config file | none — Bun discovers `*.test.ts` automatically |
| Quick run command | `bun test packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts` |
| Full suite command | `bun test packages/proxy/src/__tests__/` |

### Test Map
| Behavior | Test Type | File |
|----------|-----------|------|
| `isStopped()` returns true when state=stopped | unit | `usage-worker-controller.test.ts` |
| `terminate()` clears `restartTimer` (no stale callback) | unit | `usage-worker-controller.test.ts` |
| Backoff delay formula: exhaustion cycle 0→1s, 1→2s, capped at 30s | unit | `usage-worker-controller.test.ts` |
| `safeHandleChunk` warns on stopped worker + unknown requestId | unit | `response-handler-worker-protocol.test.ts` |
| `resetForTesting()` clears `collectorRequestIds` between tests | unit | `response-handler-worker-protocol.test.ts` |
| `safeHandleStart` adds requestId to `collectorRequestIds` | unit | `response-handler-worker-protocol.test.ts` |
| `fireAndForgetEnd` removes requestId from `collectorRequestIds` | unit | `response-handler-worker-protocol.test.ts` |

### Wave 0 Gaps
None — both test files already exist and import the correct modules. New tests are additive.

---

## Sources

### Primary (HIGH confidence)
- `packages/proxy/src/usage-worker-controller.ts` — full file read; all field names, method signatures, state machine verified
- `packages/proxy/src/response-handler.ts` — full file read; `safeHandleStart`, `safeHandleChunk`, `fireAndForgetEnd` signatures verified; `collectorRequestIds` confirmed absent
- `packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts` — full file read; mock patterns, import structure, spy patterns verified
- `packages/proxy/src/usage-collector.ts` lines 940–943 — `tryGetUsageCollector()` signature verified
- `packages/proxy/src/proxy.ts` lines 126–157 — `getUsageWorker()` export and `UsageWorkerController` singleton verified

### Secondary (MEDIUM confidence)
- `packages/proxy/src/__tests__/usage-worker-controller.test.ts` lines 1–80 — mock worker pattern (spyOn Worker.prototype) confirmed
- grep over all test files — confirmed zero `useFakeTimers`/`advanceTimersByTime` usage

---

## Metadata

**Confidence breakdown:**
- Code signatures: HIGH — all read directly from source
- Test patterns: HIGH — verified from existing test files
- Backoff timer testing approach: MEDIUM — no bun:test fake timer confirmed absent, but workaround is standard

**Research date:** 2026-06-20
**Valid until:** Stable (no external dependencies; internal codebase)
