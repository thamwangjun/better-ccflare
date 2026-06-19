# Quick Task 260617-3fb: Restore async Worker-offloaded usage collector with transferable ArrayBuffers - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Task Boundary

Move per-request usage/cost accounting (SSE parsing, token counting, cost calc, DB-write
enqueuing) OFF the proxy's synchronous response hot path (`teeStream` `pull()`) and back
onto a background Bun Worker — without reintroducing the off-heap memory leak (#244) that
PR #245 (commit 315440fa) was created to fix. Leak is solved with **transferable
ArrayBuffers** (copy-then-transfer, respecting client aliasing), not structured-clone
copies. The streaming `pull()` pump must never be blocked by, or torn down by, usage
accounting.

Two regressions to fix:
1. Event-loop contention (sync SSE parse competing with socket-flush on the proxy thread).
2. **Data-received-but-not-delivered** — PR #245 removed the `safePostMessage` try/catch
   guard, so a throw in `onChunk`/collector now reaches `teeStream`'s catch →
   `controller.error()`, which discards the already-enqueued (un-flushed) client chunk.
   With 200 + headers already sent, the SSE client (Claude Code) hangs with zero bytes.
</domain>

<decisions>
## Implementation Decisions

### Approach (Worker vs async-main-thread)
- **Worker + transferable ArrayBuffers is a HARD REQUIREMENT.** Restore the Bun Worker
  (`post-processor.worker.ts`) and worker controller (`usage-worker-controller.ts`) with
  chunk buffers sent via `worker.postMessage(msg, [arrayBuffer])`. Do NOT fall back to the
  async-main-thread collector even if Bun reader buffer semantics prove fiddly — solve the
  buffer/aliasing problem instead (copy via `value.slice()` / `byteOffset`+`byteLength`,
  transfer the copy, client keeps the original).

### Tiktoken
- **No local token counting.** Keep relying on provider-authoritative usage counts. Do NOT
  re-add the `@dqbd/tiktoken` WASM dependency or its build step. `usage-extraction.ts` keeps
  only the optional `Tiktoken` type import; the encoder stays optional/unused.

### RSS memory-soak test
- **Manual / opt-in.** Write the soak test but gate it behind an env flag or a `.manual`
  naming convention so the default `bun test` / CI run stays fast. Document how to run it in
  the test file and/or SUMMARY.md. It need not be in the default CI path.

### Worker readiness / backpressure
- **Buffer-until-ready, bounded.** Queue early chunks (arriving before the worker signals
  ready) in a small bounded per-controller buffer on the main thread and flush on ready.
  Past the cap, drop + log once (never block or tear down the client stream). The bounded
  buffer holds the short-lived transferable copies, not references to client-owned buffers.

### Claude's Discretion
- Exact worker-controller lifecycle API surface (start/postMessage/isReady/getHealth/
  terminate) — restore close to the pre-#245 shape from `git show 315440fa^`.
- Bounded-buffer cap value and queue/drain mechanics, provided ordering is preserved
  per-request and `drain()` flushes queued-but-unprocessed chunks before `handleEnd`.
- Worker message-type shapes (Start/Chunk/End/Control/Summary/ConfigUpdate), provided
  `ChunkMessage` carries a transferable and the transfer list is actually used.

</decisions>

<specifics>
## Specific Ideas

- **Aliasing rule:** `onChunk` must operate on a fresh copy (`value.slice()` → own
  ArrayBuffer) and transfer THAT copy's `.buffer`. Never transfer the buffer the client
  still reads at `controller.enqueue(value)`. Watch for Bun reader handing back subarray
  views into a pooled buffer — slice by `byteOffset`/`byteLength`.
- **Safety guard (mandatory, independent of worker vs async):** wrap ALL collector dispatch
  (handleStart/handleChunk/handleEnd, worker not-ready/terminated) in a try/catch equivalent
  to the removed `safePostMessage` — a usage-accounting failure is logged and swallowed,
  never allowed to reach `teeStream`'s catch / `controller.error()`.
- **Preserve post-#245 hardening (do NOT regress):** 61f4007a (reset currentEvent after SSE
  buffer truncation), eb9817a6 / 921062eb / 16748635 / ba89fe28 (handleEnd promise-cleanup &
  drain fixes), cache-body-store staging cap / age-sweep / discardStaged leak defenses, and
  the `cacheCreationInputTokens → cacheBodyStore.onSummary` flow (now via worker
  SummaryMessage).
- **Config propagation:** the current getter-based `store_payloads` read won't cross a
  worker boundary — restore a ConfigUpdate message (or equivalent) sent on start and on the
  `store_payloads` hot-reload path.
- **drain()/shutdown:** preserve `Promise.allSettled` over pendingHandleEnds + asyncWriter
  flush so graceful shutdown can't hang or abandon writes.

</specifics>

<canonical_refs>
## Canonical References

- `git show 315440fa` — PR #245 deletion commit (what was removed).
- `git show 315440fa^:packages/proxy/src/post-processor.worker.ts` — old worker body.
- `git show 315440fa^:packages/proxy/src/usage-worker-controller.ts` — old controller.
- `git show 315440fa^:packages/proxy/src/response-handler.ts` — old `safePostMessage` usage.
- CLAUDE.md — safety rules (never curl Anthropic; test on 8081 with non-Anthropic accounts
  force-routed via `x-better-ccflare-account-id`; never edit `inline-worker.ts`; never bump
  version; `git add <specific-files>`).
- oven-sh/bun#5709 — root cause of the structured-clone backing-store leak (#244).

</canonical_refs>
