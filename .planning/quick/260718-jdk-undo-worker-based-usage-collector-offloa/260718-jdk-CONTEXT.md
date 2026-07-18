# Quick Task 260718-jdk: Undo worker-based usage-collector offload - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning

<domain>
## Task Boundary

Fully undo the worker-based usage-accounting offload that was restored by quick task
`260617-3fb` and deepened by later commits, reverting per-request usage/cost accounting
(SSE parsing, token/cost calc, DB-write enqueuing) back to running **synchronously on the
proxy hot path** via the existing `packages/proxy/src/usage-collector.ts` — matching how
upstream `main` (== `upstream/main`, HEAD `d6e44df9`) does it today. All other fork
features that are unrelated to the worker-vs-sync question (session-governor circuit
breaker, combo/model routing, agent-id header, model catalog/throttling, etc.) MUST be
preserved untouched.

This is the inverse of `260617-3fb`; read
`.planning/quick/260617-3fb-restore-async-worker-offloaded-usage-col/` for full history of
what was added and why (that context no longer applies — we are removing it).
</domain>

<decisions>
## Implementation Decisions (locked via AskUserQuestion, do not revisit)

### Revert scope: ALL worker-related work, not just 260617-3fb
The worker was extended by commits after the original restoration. All of the following
must be undone (worker code fully removed, not just the original 3-commit quick task):

- `e981fb78`, `bbe9835e`, `a4509ae8` — quick-260617-3fb: original worker restoration
  (controller, worker body, message protocol, guard, build step).
- `5cd0e604` — "wire usage Worker into hot path + server lifecycle (start/config/drain) —
  close #244 properly" (touches `apps/server/src/server.ts`, `proxy.ts`,
  `response-handler.ts`, `usage-worker-controller.ts`).
- `4e1e79f2` — quick-260620-29c-01: exponential backoff restart on `UsageWorkerController`
  (adds `usage-worker-controller-restart.test.ts`).
- `f2621e25` — quick-260620-29c-01: route usage data to in-process `UsageCollector` when
  worker is stopped (fallback routing in `response-handler.ts`).
- `f2c3a1f8` — "forward originalModel/appliedModel through post-processor.worker.ts".
- `225cba6b` — "remove unused getUsageCollector import after upstream merge" (trivial,
  touches `proxy.ts`; verify it's not needed after the revert).

End state: **zero worker code** — no `usage-worker-controller.ts`,
`post-processor.worker.ts`, `worker-messages.ts` ChunkMessage-as-ArrayBuffer contract, no
worker-specific tests, no worker build step. Usage accounting is 100% synchronous via
`usage-collector.ts`, exactly as it is on `main`/`upstream/main` today.

### Mechanism: keep fork features, remove worker plumbing only (do NOT `git checkout main`)
Do **NOT** literally `git checkout main -- <file>` for the shared files — `main` lacks
unrelated fork features present in `thamw-main`'s current versions of these files:
session-governor circuit breaker (`recordSessionRequest`/`buildSessionRejectResponse`),
`resolveEffectiveModel`/combo routing, agent-id header handling, model catalog ingestion,
model-aware usage throttling, `originalModel`/`appliedModel` tracking, `apiKeyId`/
`apiKeyName`, `comboName`, `providerCostUsd`, cache-body-store integration, etc. — all of
these must be preserved exactly as they are in the current `thamw-main` HEAD.

Instead: **manually edit** `proxy.ts`, `response-handler.ts`, `index.ts`,
`apps/server/src/server.ts`, `apps/cli/package.json` to strip out only the
worker-dispatch/guard code paths, and **route every usage-accounting call site back
through the existing synchronous `usage-collector.ts` API** (`getUsageCollector()`,
`tryGetUsageCollector()`, `initUsageCollector()`, `drainUsageCollector()`,
`getUsageCollectorHealth()` — all still present and exported in the current
`usage-collector.ts`; nothing needs to be recreated there).

A plain `git revert` of the three original commits was tried as a dry run and produces 5
conflicts (modify/delete on `post-processor.worker.ts` / `usage-worker-controller.ts`,
content conflicts in `proxy.ts`, `response-handler.ts`, `worker-messages.ts`, two test
files) because of the later commits layered on top — do not rely on `git revert` alone;
treat this as a forward-fix that manually removes the worker call sites.

</decisions>

<specifics>
## Specific Ideas / Findings

### Files to delete entirely (worker-only, no upstream/main equivalent, not used by any preserved fork feature)
- `packages/proxy/src/usage-worker-controller.ts`
- `packages/proxy/src/post-processor.worker.ts`
- `packages/proxy/src/__tests__/usage-worker-controller.test.ts`
- `packages/proxy/src/__tests__/usage-worker-controller-restart.test.ts`
- `packages/proxy/src/__tests__/worker-transfer-aliasing.test.ts`
- `packages/proxy/src/__tests__/rss-soak.manual.test.ts`
- `packages/proxy/src/inline-worker.ts` (build-generated/gitignored — confirm gitignored,
  no action needed if so; if tracked, remove)

### Files to hand-edit (remove worker call sites, keep everything else)
- `packages/proxy/src/response-handler.ts` — remove `safeHandleStart`/`safeHandleChunk`,
  `collectorRequestIds` fallback-routing Set, `resetForTesting`, and all
  `getUsageWorker()`/worker-postMessage call sites added across the commits above. Restore
  direct synchronous calls: `getUsageCollector().handleStart(startMessage)` in the start
  path, `getUsageCollector().handleChunk(requestId, value)` in `onChunk`, and
  `fireAndForgetEnd` calling `getUsageCollector().handleEnd(msg).catch(...)` directly (no
  worker/collector routing branch). Remove the `getUsageWorker` import from `./proxy` and
  the `ChunkMessage`/worker-message imports that are no longer used; keep
  `tryGetUsageCollector`/`getUsageCollector` imports from `./usage-collector`. Preserve
  every unrelated piece of logic in this file (rate-limit sniffer, model-catalog ingestion,
  SSE handling, etc.) verbatim — diff narrowly against `git show e981fb78~1:packages/proxy/src/response-handler.ts`
  to see the pre-worker-restoration baseline of *this file specifically* (NOT `main`, since
  `main` lacks unrelated fork features this file also carries) and use it as the reference
  shape to return to, then re-apply any *non-worker* changes made to this file since
  `e981fb78~1` if any exist.
- `packages/proxy/src/proxy.ts` — remove the `UsageWorkerController` singleton,
  `startUsageWorker`/`sendWorkerConfigUpdate`/`terminateUsageWorker`/`getUsageWorker`/
  `getUsageWorkerHealth` exports, and the pool-exhausted path's worker-postMessage calls.
  Restore direct `getUsageCollector().handleStart(...)` /
  `getUsageCollector().handleEnd(...).catch(...)` calls in the pool-exhausted branch (as
  they were pre-`e981fb78`). Keep `initProxy`/`drainUsageCollector`/
  `getUsageCollectorHealth` (already present, synchronous, still correct) and every
  unrelated fork addition (session-governor, `resolveEffectiveModel`, etc.) untouched. Use
  `git show e981fb78~1:packages/proxy/src/proxy.ts` as the pre-worker baseline for *this
  file*, and re-diff forward to `HEAD` to find any *non-worker* changes made to `proxy.ts`
  after `e981fb78~1` that must be preserved (e.g. session-governor was added in this range —
  confirm via `git log e981fb78~1..HEAD -- packages/proxy/src/proxy.ts`).
- `packages/proxy/src/index.ts` — remove the worker-related barrel exports added
  (`getUsageWorker`, `getUsageWorkerHealth`, `sendWorkerConfigUpdate`, `startUsageWorker`,
  `terminateUsageWorker`, `UsageWorkerHealth` type, `ChunkMessage` re-export if it only
  exists for the worker contract). Keep `drainUsageCollector`, `getUsageCollectorHealth`,
  `initProxy`, `handleProxy`, `ProxyContext`, `forwardToClient`, `UsageCollectorHealth`
  type, and all non-worker exports.
- `packages/proxy/src/worker-messages.ts` — revert `ChunkMessage.data` from `ArrayBuffer`
  back to `Uint8Array` (undo the transferable-buffer contract change); remove the
  transfer-contract doc comment. Keep `Start/End/Control/ConfigUpdate/Ready/Ack/
  ShutdownComplete/Summary` message shapes as-is if `usage-collector.ts` still uses them
  (it does — these are the collector's own message types, not worker-only).
- `apps/server/src/server.ts` — remove `startUsageWorker()`, `sendWorkerConfigUpdate(...)`
  calls (both the startup call and the `store_payloads` hot-reload call),
  `terminateUsageWorker()` on shutdown, and the `getUsageWorkerHealth` import/usage; restore
  `getUsageCollectorHealth` for the `getUsageWorkerHealth` health-check callback (the
  callback name in the health object may stay `getUsageWorkerHealth` if that's the public
  API contract — confirm against dashboard/API consumers before renaming the callback key
  itself, only change what it calls internally). Restore the comment
  "store_payloads changes are picked up automatically via the getStorePayloads getter" (no
  hot-reload push needed since the collector reads config via a getter, not a message).
- `apps/cli/package.json` — remove the `post-processor.worker.ts` → `inline-worker.ts`
  bundle step from the `build` script (existence-guard `bun -e`, `bun build ...
  post-processor.worker.ts`, base64-encode step, and the `dist/post-processor.worker.js`
  entry in the final `rm -f` cleanup) added in `a4509ae8`. Restore the pre-`a4509ae8` build
  script exactly (only vacuum/incremental-vacuum/integrity-check worker steps remain).

### Verification approach
Since `usage-collector.ts` was never deleted (only bypassed) and still exports the full
synchronous API, this is a **subtractive** change — no new sync logic needs to be written,
only worker-dispatch code needs to be removed and call sites re-pointed at the
already-existing collector functions. Confirm via `git diff` that `usage-collector.ts`
itself needs NO changes.

Run `gitnexus_impact` (via the `gitnexus-analyst` subagent per CLAUDE.md) on
`UsageWorkerController`, `getUsageCollector`, `forwardToClient`, and `handleProxy` before
editing, and `gitnexus_detect_changes()` before committing.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/260617-3fb-restore-async-worker-offloaded-usage-col/` — the original
  quick task this undoes (CONTEXT/PLAN/SUMMARY/REVIEW/VERIFICATION).
- `git show e981fb78~1:<file>` — pre-worker-restoration baseline for each shared file
  (use this, not `main`, as the "what did this file look like before the worker" reference
  — `main` is missing unrelated fork features these files also carry).
- `git log e981fb78~1..HEAD -- <file>` — for each shared file, the commits that touched it
  since the pre-worker baseline; use to separate worker-related changes (revert) from
  unrelated fork changes (preserve).
- `git log --oneline main -3` == `git log --oneline upstream/main -3` (same SHA
  `d6e44df9`) — confirms `main` has no fork-specific commits at all; useful only as a
  sanity check for "does upstream have any worker code" (it doesn't — upstream's own
  worker was removed by PR #245 / commit `315440fa` before the fork's history began
  diverging further), NOT as a source to check out files from.
- CLAUDE.md — safety rules: NEVER curl Anthropic; run `gitnexus_impact` before editing a
  symbol and `gitnexus_detect_changes` before committing (route through
  `gitnexus-analyst` subagent); NEVER bump version; `git add <specific-files>` only.

</canonical_refs>
