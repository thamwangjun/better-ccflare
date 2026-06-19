# Quick Task 260617-3fb: Restore async Worker-offloaded usage collector - Research

**Researched:** 2026-06-17
**Domain:** Bun Worker IPC, transferable ArrayBuffers, SSE usage accounting, proxy hot-path safety
**Confidence:** HIGH (all claims grounded in this repo's git history + current source; Bun transfer semantics CITED)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Worker + transferable ArrayBuffers is a HARD REQUIREMENT.** Restore `post-processor.worker.ts` + `usage-worker-controller.ts`; chunk buffers sent via `worker.postMessage(msg, [arrayBuffer])`. NO async-main-thread fallback. Solve the buffer/aliasing problem (copy via `value.slice()`/`byteOffset`+`byteLength`, transfer the copy, client keeps the original).
- **No tiktoken.** Do NOT re-add `@dqbd/tiktoken` WASM dependency or its build step. `usage-extraction.ts` keeps only the optional `Tiktoken` type import; encoder stays optional/unused.
- **RSS soak test = manual/opt-in.** Write it but gate behind env flag or `.manual` naming so default `bun test`/CI stays fast. Document how to run.
- **Worker readiness/backpressure = buffer-until-ready, bounded.** Queue early chunks in a small bounded per-controller buffer on the main thread; flush on ready. Past cap: drop + log once (never block/tear down client stream). Bounded buffer holds short-lived transferable copies, never client-owned buffers.

### Claude's Discretion
- Exact controller lifecycle API surface (start/postMessage/isReady/getHealth/terminate) — restore close to pre-#245 shape.
- Bounded-buffer cap value and queue/drain mechanics, provided per-request ordering is preserved and `drain()` flushes queued-but-unprocessed chunks before `handleEnd`.
- Worker message-type shapes, provided `ChunkMessage` carries a transferable and the transfer list is actually used.

### Deferred Ideas (OUT OF SCOPE)
- None recorded.
</user_constraints>

## Summary

PR #245 (commit `315440fa`) deleted the Bun Worker pipeline (`post-processor.worker.ts`, `usage-worker-controller.ts`) and replaced it with a synchronous main-thread `UsageCollector` (`packages/proxy/src/usage-collector.ts`, 942 lines) to fix the #244 off-heap leak. That leak came from `worker.postMessage(chunkMsg)` **without a transfer list** — Bun structured-clones the `Uint8Array` and never reclaims the backing store (`oven-sh/bun#5709`). The fix here is to put the worker back but send each chunk's buffer in the transfer list (`postMessage(msg, [buf])`), so memory is moved, not cloned-and-leaked.

Two regressions to fix: (1) event-loop contention from synchronous SSE parsing on the proxy thread; (2) **data-received-but-not-delivered** — #245 removed the `safePostMessage` try/catch guard, so a throw in `handleStart`/`handleChunk`/`handleEnd` now propagates into `teeStream`'s `pull()` catch (`stream-tee.ts:57-60`) which calls `controller.error(error)`, discarding the already-`enqueue`d client chunk. With 200 + headers already sent, Claude Code hangs with zero bytes.

The good news: the OLD worker design is fully recoverable from `git show 315440fa^:...`, and most worker internals (SSE parsing, cost calc, cacheBodyStore wiring, project extraction, billing detection) already live in today's `usage-collector.ts` — the worker body can largely re-import or re-host that logic. The bulk of the work is (a) the controller + message protocol + transfer-list dispatch, (b) the safety guard, (c) the bounded buffer-until-ready queue, and (d) restoring the build step that bundles `post-processor.worker.ts` → `inline-worker.ts` **without** the tiktoken WASM step.

**Primary recommendation:** Resurrect `usage-worker-controller.ts` and `post-processor.worker.ts` from `315440fa^`, port the post-#245 hardening (already in `usage-collector.ts`) into the worker body, change `ChunkMessage.data` dispatch to copy-then-transfer, wrap ALL collector/worker dispatch in a `safePostMessage`-equivalent guard inside `response-handler.ts`, add a bounded ready-buffer in the controller, restore the cli `build` worker-bundle step minus tiktoken, and add TDD tests for protocol/guard/aliasing/ordering/drain plus a `.manual` RSS soak.

## Old vs Current Architecture Map

### OLD (pre-#245, `315440fa^`)
- **`usage-worker-controller.ts`** — `UsageWorkerController` class: `start()`, `postMessage(msg)`, `isReady()`, `getHealth()`, `terminate(): Promise<void>`. States: `starting|ready|shutting_down|stopped`. Ack tracking for `start` messages, startup timeout (`CF_WORKER_STARTUP_TIMEOUT_MS`, default 60s), `MAX_RESTARTS=3`, `SHUTDOWN_GRACE_MS=2000`. Creates worker from base64 `EMBEDDED_WORKER_CODE` (Blob+objectURL) or falls back to `./post-processor.worker.ts` URL; `{ smol: true }`; calls `.unref()`.
- **`post-processor.worker.ts`** (1091 lines) — owns its own `DatabaseOperations`+`AsyncDbWriter`+`initPayloadEncryption()` (Bun workers have isolated module scope). Receives `start`/`chunk`/`end`/`config-update`/`shutdown`; replies `ready`/`ack`/`shutdown-complete`/`summary`. **Leak source:** `ChunkMessage.data: Uint8Array` sent via plain structured clone.
- **`worker-messages.ts`** — STILL EXISTS today, largely intact. Defines `StartMessage`, `ChunkMessage` (`data: Uint8Array`), `EndMessage`, `ControlMessage` (`shutdown`), `ConfigUpdateMessage` (`storePayloads`), and outgoing `ReadyMessage`/`AckMessage`/`ShutdownCompleteMessage`/`SummaryMessage`. **Reusable as-is** except `ChunkMessage` should carry a transferable buffer.
- **`response-handler.ts`** — `safePostMessage(worker, msg)` wrapped every `start`/`chunk`/`end` dispatch in try/catch (`315440fa^:.../response-handler.ts:34-42`). `onChunk` posted `{ type:"chunk", requestId, data: value }`.
- **`proxy.ts`** — module-level `usageWorkerController = new UsageWorkerController(onSummary, onReady)`. `onSummary` did `cacheBodyStore.onSummary(...)` + `requestEvents.emit("event",{type:"summary"})`. `onReady` flushed a deferred `ConfigUpdateMessage` (`pendingStorePayloads`). Exports: `getUsageWorker`, `startUsageWorker`, `sendWorkerConfigUpdate`, `terminateUsageWorker`, `getUsageWorkerHealth`. Pool-exhausted error path posted `start`+`end` directly via `ctx.usageWorker.postMessage(...)` (`proxy.ts:357,386`).
- **`server.ts`** — imported all 5 exports; `startUsageWorker()` eagerly before first request (`server.ts:847`), `sendWorkerConfigUpdate(config.getStorePayloads())` on start (`:851`) and on hot-reload (`:1041`), `await terminateUsageWorker()` on shutdown (`:1640`). `ctx.usageWorker = getUsageWorker()` placed in ProxyContext (`:850,860`).
- **`index.ts`** — exported `getUsageWorker/getUsageWorkerHealth/sendWorkerConfigUpdate/startUsageWorker/terminateUsageWorker`, `UsageWorkerHealth` type.
- **build:** `apps/cli/package.json` `build` bundled `post-processor.worker.ts` → `dist/post-processor.worker.js` → base64 → `inline-worker.ts`, AND encoded tiktoken WASM → `embedded-tiktoken-wasm.ts`.

### CURRENT (post-#245, HEAD)
- **`usage-collector.ts`** — `UsageCollector` class, singleton via `initUsageCollector(getStorePayloads, onSummary)` / `getUsageCollector()` (throws if uninit) / `tryGetUsageCollector()` (null-safe). Methods: `handleStart(msg)` (sync), `handleChunk(requestId, data)` (sync), `handleEnd(msg): Promise<void>`, `drain()`, `getHealth()`, `dispose()`. `pendingHandleEnds: Set<Promise>`. Holds the same `RequestState` shape the old worker had + `providerCostUsd` (added in fork merge `be598d89`).
- **`response-handler.ts`** — calls `getUsageCollector().handleStart(...)` (`:169`), `.handleChunk(requestId, value)` (`:199`), `fireAndForgetEnd(endMsg)` (`:231,243,265,283,293`). `fireAndForgetEnd` (`:17-23`) catches the *promise* rejection but **handleStart/handleChunk are unguarded synchronous calls** → throws reach `teeStream` pull catch.
- **`proxy.ts`** — `initProxy(getStorePayloads)` (`:105`) calls `initUsageCollector`; `drainUsageCollector()` (`:111`); `getUsageCollectorHealth()` (`:115`). Error path calls `getUsageCollector().handleStart(...)`/`.handleEnd(...)` (`:327,355`) **unguarded**. `cacheBodyStore.discardStaged(requestMeta.id)` on terminal error paths (`:490,512,519`).
- **`worker-messages.ts`** — present, unchanged. `ChunkMessage.data: Uint8Array`.
- **`inline-worker.ts`** — STALE: still contains the OLD worker's base64 (not regenerated since the build step was removed). Auto-generated — must NOT hand-edit; restoring the build step will regenerate it.
- **`server.ts`** — imports `drainUsageCollector/getUsageCollectorHealth/initProxy`; `initProxy(() => config.getStorePayloads())` (`:846`); `getUsageWorkerHealth: () => getUsageCollectorHealth()` (`:687`); `await drainUsageCollector()` on shutdown (`:1634`). **No `ctx.usageWorker`** anymore (removed from ProxyContext in `packages/types/src/context.ts`).
- **`index.ts`** — exports `drainUsageCollector/getUsageCollectorHealth/initProxy`, `UsageCollectorHealth` type.

### What must change to go worker-backed again
1. Recreate `usage-worker-controller.ts` (from `315440fa^`) + add a bounded ready-buffer (new requirement).
2. Recreate `post-processor.worker.ts` — but port the CURRENT `usage-collector.ts` logic (it has all post-#245 hardening), NOT the 1091-line stale worker. Strip tiktoken init. Worker owns its DB/AsyncDbWriter/encryption.
3. `worker-messages.ts`: change `ChunkMessage` to carry a transferable (e.g. `data: ArrayBuffer` + `byteLength`, or keep `Uint8Array` but ensure its `.buffer` is standalone and listed in transfer). Document the transfer contract.
4. `response-handler.ts`: replace direct collector calls with `safePostMessage`-guarded controller dispatch; copy each chunk before transfer.
5. `proxy.ts`: replace `initUsageCollector`/`getUsageCollector` wiring with `UsageWorkerController` instance + `startUsageWorker/sendWorkerConfigUpdate/terminateUsageWorker/getUsageWorkerHealth`; restore deferred-config + `onSummary` → `cacheBodyStore.onSummary` + `requestEvents`. Keep `cacheBodyStore.discardStaged` error-path calls.
6. `index.ts` + `server.ts`: restore the 5 worker exports/wiring (start eager, config on start+hot-reload, terminate+drain on shutdown). Decide whether to keep `drainUsageCollector` name or revert to `terminateUsageWorker` — server.ts shutdown must `await` worker drain (`Promise.allSettled` over pending + asyncWriter flush happens inside the worker now).
7. `packages/types/src/context.ts`: restore `usageWorker` on `ProxyContext` if proxy.ts error path posts directly (or route error-path through the same guarded helper).
8. `apps/cli/package.json` build: restore the `post-processor.worker.ts` bundle+base64 step; OMIT the tiktoken WASM encode step.

### Post-#245 hardening to PRESERVE (do NOT regress)
| Commit | What | Where it lives now |
|--------|------|--------------------|
| `61f4007a` | reset `currentEvent` after SSE buffer truncation | `usage-collector.ts:220` (`processStreamChunk`) — must be in worker body |
| `eb9817a6` | `then/catch` (not `finally`) for `pendingHandleEnds` cleanup | `usage-collector.ts:433-439` |
| `921062eb` | log handleEnd rejections instead of swallowing | `response-handler.ts:17-23` `fireAndForgetEnd`; proxy.ts error path |
| `16748635` | flush `AsyncDbWriter` in `drain()`; removed stale worker health fields | `usage-collector.ts:445-448` |
| `ba89fe28` | `Promise.allSettled` in `drain()` (no abandoned writes on shutdown) | `usage-collector.ts:446` |
| (#245 body) | `cacheBodyStore` staging cap (`MAX_STAGING_ENTRIES=200`), `STAGING_MAX_AGE_MS` sweep, `discardStaged()` | `cache-body-store.ts:36-39,162-210,188` |
| (fork `be598d89`) | `providerCostUsd` field (OpenRouter cost distinct from estimate) | `usage-collector.ts:36` RequestState |
| — | `cacheCreationInputTokens → cacheBodyStore.onSummary(requestId, tokens)` | `usage-collector.ts:806` → must flow via worker `SummaryMessage` back to main |

## The Transferable Technique under Bun

**Direction matters.** We send chunks **main → worker**. Bun's main→worker transfer is spec-compliant: `worker.postMessage(msg, [arrayBuffer])` moves the backing store (zero-copy, source detached). [CITED: bun.com/reference/bun/Worker/postMessage] The known Bun bug `oven-sh/bun#18705` is **worker → main** transfer (buffer not detached) — we do NOT transfer chunks back; the only worker→main message carrying data is `SummaryMessage` (a plain JSON `RequestResponse` object, structured-cloned, no large buffers). So #18705 does not affect this design.

**The aliasing constraint (critical).** In `stream-tee.ts:39` the SAME `value: Uint8Array` is `controller.enqueue(value)`'d to the client, then passed to `onChunk(value)` (`:56`). If we transfer `value.buffer`, the client's buffer is **detached** → corrupted/empty client stream. Therefore `onChunk` MUST copy first and transfer the COPY's buffer:

```ts
// Source: derived from stream-tee.ts:39-56 + MDN Transferable_objects
const onChunk = (value: Uint8Array): void => {
  // value is enqueued to the client; never transfer ITS buffer.
  // Bun's reader may hand back a subarray VIEW into a pooled buffer,
  // so slice by byteOffset/byteLength to get a standalone ArrayBuffer.
  const copy = value.slice();           // own ArrayBuffer, exact bytes
  // copy.buffer.byteLength === copy.byteLength (slice never has byteOffset)
  controller.postChunkToWorker(requestId, copy.buffer); // transfer copy.buffer
};
```

- `value.slice()` (no args) returns a NEW `Uint8Array` over a NEW `ArrayBuffer` sized to `byteLength` — `byteOffset===0`, no extra bytes. **This is the correct copy** and is preferred over `new Uint8Array(value).buffer` (equivalent, also copies) and over `value.buffer.slice(byteOffset, byteOffset+byteLength)` (also valid but more error-prone). [CITED: MDN ArrayBuffer / Transferable_objects]
- **Why subarray views matter:** Bun's `ReadableStream` reader can return a `Uint8Array` that is a *partial view* (`byteOffset>0`, `byteLength < buffer.byteLength`) into an internally pooled buffer. Transferring `value.buffer` would (a) detach the client's enqueued data and (b) move MORE bytes than the chunk. `value.slice()` sidesteps both. [CITED: advancedweb.hu node binary worker transfer]
- **Transfer list syntax:** `worker.postMessage(chunkMsg, [chunkMsg.data])` where `chunkMsg.data` is the standalone `ArrayBuffer` (or `chunkMsg.data.buffer` if it's a Uint8Array — list the ArrayBuffer, not the view). [CITED: bun.com/reference/bun/Worker/postMessage]
- **Verify no accumulation:** after transfer the source `copy.buffer.byteLength === 0` (detached). The `.manual` RSS soak test asserts bounded `process.memoryUsage().rss` growth over N concurrent large-body requests (see `memory-leak.test.ts` for the existing pattern at `packages/proxy/src/__tests__/memory-leak.test.ts:13-29`).
- Bun version here is **1.3.14** (CLAUDE.md floor is `>=1.2.8`); transfer-list support is stable.

## Build / Inline-Worker Generation

`inline-worker.ts` is auto-generated and MUST NOT be hand-edited (CLAUDE.md). It is produced by the `build` script in **`apps/cli/package.json`**. Pre-#245 that script ran:

```
bun build ../../packages/proxy/src/post-processor.worker.ts \
  --outfile dist/post-processor.worker.js --target=bun --minify
bun -e "...readFileSync('dist/post-processor.worker.js')...base64...
        writeFileSync('../../packages/proxy/src/inline-worker.ts',
        'export const EMBEDDED_WORKER_CODE = \"'+encoded+'\";')"
```
(plus a tiktoken WASM encode step writing `embedded-tiktoken-wasm.ts`, and an existence-guard that seeds an empty `inline-worker.ts`). The CURRENT script (verified) has BOTH the worker-bundle step and the tiktoken step removed — only vacuum/incremental-vacuum/integrity-check workers remain.

**Plan must:**
- Re-add the `post-processor.worker.ts` bundle + base64 step (mirror the vacuum-worker pattern already present in the current script) and the empty-file existence guard for `inline-worker.ts`.
- **OMIT** the tiktoken WASM encode step (`embedded-tiktoken-wasm.ts`) and do NOT re-add `@dqbd/tiktoken` usage. NOTE: `@dqbd/tiktoken` is STILL listed in `packages/proxy/package.json` dependencies — leave or remove per discretion, but the worker must not import it.
- **Implementer edits** `packages/proxy/src/post-processor.worker.ts`; the build command regenerates `inline-worker.ts`. To regenerate locally: `bun run --cwd apps/cli build` (or just the worker-bundle sub-step). The pre-push hook / release system handles inline regeneration on push, but the implementer should regenerate locally to typecheck the controller's `EMBEDDED_WORKER_CODE` import.

## Safety Guard (mandatory)

Restore the `safePostMessage` equivalent. Two layers:
1. **Dispatch guard** in `response-handler.ts`: wrap EVERY collector/controller call (`handleStart`/`handleChunk`/`handleEnd`/`postMessage`, worker-not-ready, worker-terminated) in try/catch that logs+swallows. A usage-accounting failure must NEVER reach `teeStream`'s `pull()` catch (`stream-tee.ts:57-60`), which calls `controller.error(error)` and discards the already-`enqueue`d (un-flushed) client chunk.
2. Keep `fireAndForgetEnd`'s `.catch()` (commit `921062eb`) for the async `handleEnd`/`postMessage` rejection path.

Concretely, `onChunk` does `controller.enqueue(value)` FIRST (already does, line 39 before line 56), then guarded dispatch — but the guard must wrap the dispatch itself, not rely on call order, because `pull()`'s try wraps both enqueue and onChunk. The cleanest fix: make `safePostMessage(controller, msg, transfer?)` swallow, and call only that from `onChunk`/`onClose`/`onError`/`handleStart`.

## Bounded Buffer-Until-Ready

The worker is started eagerly but `ready` is async (it opens its own SQLite handle). Chunks arriving before `ready` must be queued in a small bounded per-controller (or per-request) buffer holding the **transferable copies** (not client buffers), flushed in order on `ready`. Past the cap: drop + log once, never block/tear down the client stream. Preserve per-request ordering. `drain()`/shutdown must flush queued-but-unprocessed chunks before sending `end`. The old controller had `pendingStorePayloads` deferral for config (`proxy.ts:100-122` in `315440fa^`) — extend the same deferral pattern to chunks.

## Config Propagation

`getStorePayloads` is a getter closure (`config.getStorePayloads()`) — it CANNOT cross the worker boundary. Restore the `ConfigUpdateMessage` (`{ type:"config-update", storePayloads }`) sent on `ready` and on the hot-reload path (`server.ts:1041` pre-#245). Worker holds a mutable `let storePayloads` updated on receipt (old worker body had this). `sendWorkerConfigUpdate(storePayloads)` defers via `pendingStorePayloads` if not ready.

## Test Surface

Existing tests in `packages/proxy/src/__tests__/`:
- `response-handler-worker-protocol.test.ts` — CURRENTLY mocks `getUsageCollector` via `spyOn(usageCollectorModule, "getUsageCollector")` and asserts start/chunk/end calls + ordering. **Reusable seam**: the plan can keep a testable controller seam (spy on `getUsageWorker`/dispatch) so worker logic is tested WITHOUT spawning a real Worker. This is the deterministic-Worker-test answer: import `usage-extraction` pure functions + a mock controller; only the RSS soak spawns a real worker.
- `sse-parsing.test.ts`, `extract-usage-from-json.test.ts` — exercise `usage-extraction.ts` pure functions (worker body re-uses these; tests stay valid).
- `cache-body-store.test.ts` (133 lines added in #245) — staging cap / age-sweep / discardStaged. Keep; the worker `SummaryMessage`→`cacheBodyStore.onSummary` flow must keep these green.
- `proxy-usage-throttling.test.ts`, `pool-exhausted.test.ts` — error-path; verify guarded dispatch + `discardStaged` still fire.
- `memory-leak.test.ts` — pattern for the new `.manual` RSS soak (measure `process.memoryUsage().rss` growth, assert bounded).

**New TDD tests the plan requires:** (1) worker message-contract (Start/Chunk/End/ConfigUpdate/Summary shapes; ChunkMessage carries transferable), (2) safety-guard regression (a throwing dispatch does NOT call `controller.error` / client still receives all bytes), (3) aliasing (after dispatch, client's enqueued `value` is intact / not detached; transferred copy is detached), (4) ordering (per-request chunk order preserved through buffer-until-ready), (5) drain/shutdown (queued chunks flushed before end; `allSettled` no abandoned writes), (6) `.manual` RSS soak.

## Pitfalls / Gotchas

1. **Deterministic Worker testing:** Don't spawn a real `Worker` in unit tests (flaky, slow, isolated DB). Test the worker's *pure logic* by importing `usage-extraction` + a mock `UsageWorkerController` seam (the existing protocol test already mocks the collector this way). Reserve real-Worker spawning for the `.manual` soak only.
2. **Guard must wrap dispatch, not depend on enqueue-first ordering:** `pull()`'s `try` (stream-tee.ts:29) wraps BOTH `enqueue` and `onChunk`; a throw anywhere in the try hits `controller.error`. The guard must be inside `onChunk`/the dispatch helper.
3. **Drain ordering:** `drain()` must flush queued-but-unprocessed bounded-buffer chunks (and pending `end`s) before resolving — otherwise shutdown abandons in-flight usage. Keep `Promise.allSettled` + asyncWriter flush (now inside the worker).
4. **Config getter won't cross the boundary** — must be a ConfigUpdate message (see above). Easy to forget → store_payloads silently wrong in worker.
5. **Stale `inline-worker.ts`:** it currently holds the OLD worker base64. Until the build step is restored AND run, the controller's `EMBEDDED_WORKER_CODE` import will load stale/wrong code. Regenerate before testing.
6. **`ProxyContext.usageWorker`** was removed (`packages/types/src/context.ts`); the proxy.ts pool-exhausted error path now calls the collector directly. Decide: restore `ctx.usageWorker` OR route the error path through the same guarded helper that response-handler uses.
7. **Worker isolated scope:** `initPayloadEncryption()` + `new DatabaseOperations()` + `new AsyncDbWriter()` MUST be inside the worker module (old worker did this). Main-thread init does not propagate.
8. **`.unref()` + `{ smol: true }`** on the Worker so it doesn't keep the process alive and stays low-memory (old controller did both).

## Don't Hand-Roll

| Problem | Use instead |
|---------|-------------|
| Worker lifecycle/restart/health/ack/startup-timeout | Resurrect `UsageWorkerController` from `315440fa^` verbatim, then extend with the bounded buffer |
| SSE parse / cost calc / project extract / billing detect | Already in `usage-collector.ts` (post-#245 hardened) — host it in the worker, don't rewrite |
| Buffer copy for transfer | `value.slice()` (standard, exact-bytes, standalone ArrayBuffer) — do not manually `byteOffset` math unless a view is confirmed |
| cacheBodyStore staging/cap/sweep | `cache-body-store.ts` unchanged — just keep `SummaryMessage` → `onSummary` flowing |

## Assumptions Log

| # | Claim | Risk if wrong |
|---|-------|---------------|
| A1 | Bun 1.3.14 main→worker ArrayBuffer transfer is fully zero-copy and detaches the source | LOW — spec-compliant per docs; `.manual` soak verifies. If wrong, leak returns (caught by soak before merge). |
| A2 | `value.slice()` yields a standalone ArrayBuffer with byteOffset 0 (safe to transfer) | LOW — MDN-documented; aliasing test verifies. |
| A3 | `SummaryMessage` (worker→main) carries no large transferable, so bug #18705 is irrelevant | LOW — it's a plain `RequestResponse` JSON object. |

## Sources

### Primary (HIGH)
- Repo git history: `315440fa` (deletion commit) + `315440fa^` (old worker/controller/response-handler/proxy/server/index/worker-messages), hardening commits `61f4007a eb9817a6 921062eb 16748635 ba89fe28`, fork merge `be598d89`.
- Current source: `usage-collector.ts`, `response-handler.ts`, `stream-tee.ts`, `cache-body-store.ts`, `proxy.ts`, `index.ts`, `apps/cli/package.json`, `apps/server/src/server.ts`.

### Secondary (CITED)
- [Bun Worker.postMessage reference](https://bun.com/reference/bun/Worker/postMessage)
- [MDN — Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [MDN — ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer)
- [oven-sh/bun#18705 — worker→main transfer not detaching](https://github.com/oven-sh/bun/issues/18705)
- [Transferring binary data across worker threads](https://advancedweb.hu/how-to-transfer-binary-data-efficiently-across-worker-threads-in-nodejs/)

## Metadata
- Confidence: Old-architecture recovery HIGH (exact git refs); transfer semantics HIGH (CITED + Bun 1.3.14); build step HIGH (verified current vs old script).
- Research date: 2026-06-17
- Valid until: 2026-07-17 (stable; re-verify only if Bun major changes transfer semantics)
