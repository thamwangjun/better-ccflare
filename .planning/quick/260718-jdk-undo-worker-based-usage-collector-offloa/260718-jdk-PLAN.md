---
phase: quick-260718-jdk
plan: "260718-jdk"
type: implementation
wave: 1
depends_on: []
files_modified:
  - packages/proxy/src/usage-worker-controller.ts
  - packages/proxy/src/post-processor.worker.ts
  - packages/proxy/src/__tests__/usage-worker-controller.test.ts
  - packages/proxy/src/__tests__/usage-worker-controller-restart.test.ts
  - packages/proxy/src/__tests__/worker-transfer-aliasing.test.ts
  - packages/proxy/src/__tests__/rss-soak.manual.test.ts
  - packages/proxy/src/worker-messages.ts
  - packages/proxy/src/response-handler.ts
  - packages/proxy/src/proxy.ts
  - packages/proxy/src/index.ts
  - apps/server/src/server.ts
  - apps/cli/package.json
  - packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts
  - packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts
autonomous: true
requirements: []
tags:
  - proxy
  - worker
  - usage-accounting
  - revert
must_haves:
  truths:
    - "Zero worker-related symbols remain in packages/proxy/src, apps/server/src, or apps/cli/package.json (grep for getUsageWorker|UsageWorkerController|startUsageWorker|terminateUsageWorker|sendWorkerConfigUpdate|UsageWorkerHealth|usage-worker-controller|post-processor.worker|safeHandleStart|safeHandleChunk|collectorRequestIds returns zero hits, or only stale prose comments in files outside this revert's edit list)."
    - "Every proxy hot-path usage-accounting call site (response-handler.ts start/chunk/end, proxy.ts pool-exhausted branch) calls getUsageCollector()/getUsageCollector().handleStart|handleChunk|handleEnd directly and synchronously — no worker dispatch, no collectorRequestIds fallback-routing Set."
    - "bun run lint && bun run typecheck && bun run format all exit 0."
    - "Full bun test suite passes with zero regressions vs pre-revert HEAD (minus the deleted worker-only test files, which no longer run)."
    - "Unrelated fork features are present and untouched in the final diff: session-governor circuit breaker, resolveEffectiveModel/combo routing, model-catalog passive capture (ingestModelsListing), model-aware usage throttling, PG-mode async initProxy (DatabaseFactory.getInstance() arg, async signature), model-rewrite headers (isModelRewrite/withModelRewriteHeader/originalModel/appliedModel), xAI refresh-backed usage polling, session-affinity strategy, usage-history snapshot pruning, codex count-tokens synthesis."
    - "apps/cli/package.json build script no longer bundles post-processor.worker.ts into inline-worker.ts; only vacuum/incremental-vacuum/integrity-check worker steps remain in the build script."
    - "apps/cli/package.json version field is byte-identical to its pre-revert value (never touched)."
  artifacts:
    - path: "packages/proxy/src/response-handler.ts"
      provides: "Synchronous getUsageCollector() calls for start/chunk/end; no getUsageWorker import; model-catalog and model-rewrite features preserved."
      contains: "getUsageCollector().handleStart(startMessage)"
    - path: "packages/proxy/src/proxy.ts"
      provides: "No UsageWorkerController singleton; pool-exhausted branch calls getUsageCollector() directly; initProxy stays async with DatabaseFactory.getInstance()."
      contains: "getUsageCollector().handleStart({"
    - path: "packages/proxy/src/worker-messages.ts"
      provides: "ChunkMessage.data reverted to Uint8Array (no transferable-ArrayBuffer contract)."
      contains: "data: Uint8Array;"
    - path: "packages/proxy/src/index.ts"
      provides: "Barrel exports with no worker-related symbols (getUsageWorker, startUsageWorker, terminateUsageWorker, sendWorkerConfigUpdate, UsageWorkerHealth removed)."
    - path: "apps/server/src/server.ts"
      provides: "Startup calls only initProxy(); shutdown calls only drainUsageCollector(); no startUsageWorker/terminateUsageWorker/sendWorkerConfigUpdate calls."
      contains: "getUsageCollectorHealth"
    - path: "apps/cli/package.json"
      provides: "build script without the post-processor.worker.ts bundle/base64/cleanup steps added by a4509ae8."
    - path: "packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts"
      provides: "getUsageCollector-based mocking (no worker-controller mocking); preserves the 'passive model-catalog capture' describe block verbatim, with a getUsageCollector spy added so its shouldProcessRequest===true tests don't throw."
    - path: "packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts"
      provides: "getUsageCollector spies restored (no getUsageWorker/createMockWorkerController); getAgentFrontmatterModelFallback: () => false re-applied to both ctx.config mocks in Site 3."
  key_links:
    - from: "response-handler.ts forwardToClient onChunk"
      to: "usage-collector.ts getUsageCollector().handleChunk"
      via: "direct synchronous call, no worker/collector routing branch"
      pattern: "getUsageCollector\\(\\)\\.handleChunk"
    - from: "proxy.ts handleProxy pool-exhausted branch"
      to: "usage-collector.ts getUsageCollector().handleStart/handleEnd"
      via: "direct synchronous calls replacing worker postMessage dispatch"
      pattern: "getUsageCollector\\(\\)\\s*\\n?\\s*\\.handleEnd"
    - from: "apps/server/src/server.ts startup"
      to: "proxy.ts initProxy()"
      via: "await initProxy(() => config.getStorePayloads()) with no follow-on startUsageWorker/sendWorkerConfigUpdate calls"
      pattern: "await initProxy\\("
    - from: "apps/server/src/server.ts shutdown"
      to: "proxy.ts drainUsageCollector()"
      via: "await drainUsageCollector() with no terminateUsageWorker() call"
      pattern: "await drainUsageCollector\\(\\)"
---

<objective>
Fully undo the worker-based usage-accounting offload (originally restored by quick task `260617-3fb` and deepened by five later commits — see CONTEXT.md's locked revert scope), restoring `packages/proxy/src/usage-collector.ts` as the sole, synchronous accounting path on the proxy hot path — matching how `upstream/main` does it today. Every unrelated fork feature layered onto the same files in the interim (session-governor, combo/model routing, model catalog, model-aware throttling, PG-mode async `initProxy`, model-rewrite headers, xAI polling, session-affinity, usage-history snapshots) MUST be preserved byte-for-byte.

This is a **subtractive, mechanical revert** — RESEARCH.md already performed the full git-verified file-by-file analysis (exact hunks, exact baselines, exact unrelated changes to preserve). Do not re-derive anything RESEARCH.md already answered; follow its snippets and target shapes directly.

Purpose: Reinstate the synchronous accounting model per user decision (see CONTEXT.md `<decisions>`), removing all worker plumbing (controller, worker body, transferable-buffer message contract, worker-specific tests, worker build step) while keeping every unrelated fork feature intact.

Output:
- 4 worker-only files deleted (+ their 2 associated pure-worker test files, +2 more worker-only test files — 6 deletions total)
- 6 shared files hand-edited to remove worker call sites and restore direct `usage-collector.ts` calls
- 2 test files fixed to stop mocking the worker and mock the collector instead, with their unrelated test suites (model-catalog capture, probe-filter regression) preserved
- Full verification: lint, typecheck, format, full test suite, and the RESEARCH.md §10 grep sanity check all clean
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260718-jdk-undo-worker-based-usage-collector-offloa/260718-jdk-CONTEXT.md
@.planning/quick/260718-jdk-undo-worker-based-usage-collector-offloa/260718-jdk-RESEARCH.md
@CLAUDE.md

RESEARCH.md is the **authoritative, git-verified source** for this plan — every hunk quoted in it comes from real `git diff`/`git show` output re-run against the live repo at research time (HEAD `1aed4052`, unchanged at plan time). Read RESEARCH.md sections 0-10 in full before starting Task 1; do not skim. Section numbers referenced below (§0-§10) are RESEARCH.md sections.

**Non-negotiable constraints (from CONTEXT.md, locked, do not revisit):**
- Do NOT `git checkout main -- <file>` for any of the 6 shared files — `main` lacks unrelated fork features these files carry. Hand-edit only.
- Baseline reference for each shared file is `git show e981fb78~1:<file>` (state immediately before quick task `260617-3fb`), NOT `main`.
- End state: zero worker code anywhere — no `usage-worker-controller.ts`, no `post-processor.worker.ts`, no `ChunkMessage`-as-ArrayBuffer contract, no worker-specific tests, no worker build step.

**Cross-cutting gotchas (RESEARCH.md §0 — read before editing anything):**
1. `usage-collector.ts` itself needs **NO changes** — `git diff e981fb78~1 HEAD -- packages/proxy/src/usage-collector.ts` is non-empty (it picked up unrelated model-rewrite persistence + PG-mode support since baseline) but contains zero worker-plumbing diff. Do not touch this file.
2. `initProxy()` in `proxy.ts` MUST stay `async` and keep passing `DatabaseFactory.getInstance()` as the third arg to `initUsageCollector()` — this is an unrelated PG-mode event-loop-starvation fix (`e071ae31`), NOT part of the worker restoration. Do not revert this to the old synchronous signature.
3. `getUsageWorkerHealth` is a pre-existing public field/param name in `packages/types/src/context.ts` and `packages/http-api/src/handlers/health.ts`, unrelated to whether the backend is sync or worker-based. Do NOT rename it anywhere in `packages/types` or `packages/http-api` — only change what `server.ts`'s `getUsageWorkerHealth: () => …` callback calls internally (back to `getUsageCollectorHealth()`).
4. Reverting `response-handler.ts`'s direct `getUsageCollector()` calls (no try/catch guard, matching the pre-worker baseline) will THROW inside any test that invokes `forwardToClient()` with `shouldProcessRequest === true` unless that test mocks `usage-collector`'s `getUsageCollector`. The "passive model-catalog capture" suite in `response-handler-worker-protocol.test.ts` currently does NOT mock the collector — Task 3 must add that mock.
5. `packages/proxy/src/usage-extraction.ts` requires NO changes (`git diff e981fb78~1 HEAD` is empty for it; grep hits for "worker" there are stale comments only).

Run `gitnexus_impact` (via the `gitnexus-analyst` subagent per CLAUDE.md) on `UsageWorkerController`, `getUsageCollector`, `forwardToClient`, and `handleProxy` before editing any of them, and `gitnexus_detect_changes()` before every commit — never call GitNexus MCP tools directly in this session.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Delete worker-only files; hand-edit worker-messages.ts, response-handler.ts, proxy.ts</name>
  <files>
    packages/proxy/src/usage-worker-controller.ts (delete),
    packages/proxy/src/post-processor.worker.ts (delete),
    packages/proxy/src/__tests__/usage-worker-controller.test.ts (delete),
    packages/proxy/src/__tests__/usage-worker-controller-restart.test.ts (delete),
    packages/proxy/src/__tests__/worker-transfer-aliasing.test.ts (delete),
    packages/proxy/src/__tests__/rss-soak.manual.test.ts (delete),
    packages/proxy/src/worker-messages.ts,
    packages/proxy/src/response-handler.ts,
    packages/proxy/src/proxy.ts
  </files>
  <action>
Run `gitnexus_impact({ target: "UsageWorkerController", direction: "upstream" })` and `gitnexus_impact({ target: "getUsageCollector", direction: "upstream" })` via the `gitnexus-analyst` subagent first; report blast radius before editing.

1. **Delete** the 6 pure worker-only files listed above (confirmed by RESEARCH.md §8c grep sweep to have no unrelated content — safe to remove wholesale). `packages/proxy/src/inline-worker.ts` needs NO git action (RESEARCH.md §7 — gitignored, untracked at HEAD; leave the stray build artifact on disk as-is).

2. **`packages/proxy/src/worker-messages.ts`** (RESEARCH.md §3): revert `ChunkMessage.data` from `ArrayBuffer` back to `Uint8Array`; delete the "TRANSFER CONTRACT" doc comment above it. Keep `StartMessage.originalModel`/`appliedModel` fields and the `isModelRewrite()` function exactly as-is (unrelated, used by `usage-collector.ts` and `response-handler.ts`). Keep all other message shapes (`Start/End/Control/ConfigUpdate/Ready/Ack/ShutdownComplete/Summary`) unchanged.

3. **`packages/proxy/src/response-handler.ts`** (RESEARCH.md §1): use `git show e981fb78~1:packages/proxy/src/response-handler.ts` as the structural skeleton, then re-apply the unrelated changes made since that baseline (§1(b)):
   - Model-catalog passive capture (`ingestModelsListing` import, `query` field/destructure, the `ingestModelsListing(...)` call hoisted above the `shouldProcessRequest` filter).
   - Model-rewrite observability (`isModelRewrite` import from `./worker-messages`, `MODEL_REWRITE_HEADER` const, `withModelRewriteHeader()` helper, `originalModel`/`appliedModel` fields on `ResponseHandlerOptions`, the `isModelRewrite(...)` early-return block, and `withModelRewriteHeader(...)` applied on all three response-construction sites).
   - Codex count-tokens synthesis (`isSyntheticCountTokens` widened to include `ctx.provider.name === "codex"`).
   Remove: `getUsageWorker` import from `./proxy`, `ChunkMessage` import, the `collectorRequestIds` Set, `resetForTesting()`, `safeHandleStart`/`safeHandleChunk` function bodies. Change `tryGetUsageCollector` import to `getUsageCollector` (direct import, matching baseline). Restore `fireAndForgetEnd` to the baseline direct-call form (`getUsageCollector().handleEnd(msg).catch(...)`, no worker/collector routing branch). Restore the `startMessage` dispatch call site to `getUsageCollector().handleStart(startMessage)` and the `onChunk` call site to `getUsageCollector().handleChunk(requestId, value)`. Do NOT `git checkout` the baseline directly — hand-edit onto the current file.

4. **`packages/proxy/src/proxy.ts`** (RESEARCH.md §2): use `git show e981fb78~1:packages/proxy/src/proxy.ts` as baseline, then re-apply the unrelated changes since that baseline (§2(b)):
   - `DatabaseFactory` import + `initProxy()` staying `async` with `DatabaseFactory.getInstance()` as the third arg to `initUsageCollector()` (do NOT revert to the old sync 2-arg signature — see cross-cutting gotcha #2 above).
   - Session-governor circuit breaker (`buildSessionRejectResponse`/`recordSessionRequest` import, `requestMeta.clientSessionId` assignment, the `/v1/messages` reject-verdict block).
   - `resolveEffectiveModel` combo/agent-rewrite routing (`resolveEffectiveModel` import, `interceptAndModifyRequest(...)` gaining `req.headers`/`frontmatterModelFallback` args, `requestMeta.originalModel`/`appliedModel` assignment, `effectiveModel` computation feeding `selectAccountsForRequest`).
   - Model-aware usage throttling (`comboRouted`/`effectiveModel` locals in `applyUsageThrottling`, extra `{ requestModel, scopedMode: "match" }` arg to `getUsageThrottleUntil(...)`).
   Remove: `UsageWorkerController` import, the entire "WORKER MANAGEMENT" block (module-level singleton + `getUsageWorker`/`startUsageWorker`/`sendWorkerConfigUpdate`/`terminateUsageWorker`/`getUsageWorkerHealth` exports), `ConfigUpdateMessage`/`SummaryMessage` import from `./worker-messages`. Re-add `getUsageCollector` to the `"./usage-collector"` import (it was removed as dead code by `225cba6b` after the worker restoration — needed again now). Do NOT re-home the deleted worker block's `cacheBodyStore.onSummary(...)` call anywhere — `usage-collector.ts`'s own `handleEnd()` already calls it internally (confirmed true even at the `e981fb78~1` baseline).
   Replace the pool-exhausted branch's worker-postMessage calls with direct `getUsageCollector().handleStart({...}).../handleEnd({...}).catch(...)` calls exactly as shown in RESEARCH.md §2(a)'s restoration snippet — this snippet already includes the unrelated `originalModel`/`appliedModel` fields that must NOT be dropped (they postdate the raw `e981fb78~1` baseline).
  </action>
  <verify>
```bash
git status --short packages/proxy/src/usage-worker-controller.ts packages/proxy/src/post-processor.worker.ts packages/proxy/src/__tests__/usage-worker-controller.test.ts packages/proxy/src/__tests__/usage-worker-controller-restart.test.ts packages/proxy/src/__tests__/worker-transfer-aliasing.test.ts packages/proxy/src/__tests__/rss-soak.manual.test.ts
# expect: all show as deleted (D)
grep -n "getUsageWorker\|UsageWorkerController\|ChunkMessage\|collectorRequestIds\|safeHandleStart\|safeHandleChunk" packages/proxy/src/response-handler.ts packages/proxy/src/proxy.ts packages/proxy/src/worker-messages.ts
# expect: zero hits
grep -n "data: Uint8Array" packages/proxy/src/worker-messages.ts
# expect: one hit on ChunkMessage.data
```
  </verify>
  <done>
    All 6 pure worker-only files deleted. `worker-messages.ts` has `ChunkMessage.data: Uint8Array` with no transfer-contract comment. `response-handler.ts` and `proxy.ts` contain zero worker symbols, call `getUsageCollector()` directly and synchronously at every accounting call site, and retain every unrelated fork feature listed in RESEARCH.md §1(b)/§2(b) verbatim.
  </done>
</task>

<task type="auto">
  <name>Task 2: Hand-edit index.ts barrel, server.ts lifecycle, apps/cli/package.json build script</name>
  <files>
    packages/proxy/src/index.ts,
    apps/server/src/server.ts,
    apps/cli/package.json
  </files>
  <action>
Run `gitnexus_impact({ target: "handleProxy", direction: "upstream" })` via the `gitnexus-analyst` subagent before editing `server.ts` (it is the highest-fan-in consumer of `proxy.ts`'s exports changed in Task 1).

1. **`packages/proxy/src/index.ts`**: remove worker-related barrel exports (`getUsageWorker`, `getUsageWorkerHealth`, `sendWorkerConfigUpdate`, `startUsageWorker`, `terminateUsageWorker`, `UsageWorkerHealth` type, any `ChunkMessage` re-export that existed only for the worker contract). Keep `drainUsageCollector`, `getUsageCollectorHealth`, `initProxy`, `handleProxy`, `ProxyContext`, `forwardToClient`, `UsageCollectorHealth` type, and all other non-worker exports untouched.

2. **`apps/server/src/server.ts`** (RESEARCH.md §5): use `git show e981fb78~1:apps/server/src/server.ts` as baseline, then re-apply all unrelated changes since that baseline (§5(b) — this file has the most unrelated churn of the six, hand-edit rather than attempt a mechanical patch):
   - Session-affinity strategy (`SessionAffinityStrategy` import + `buildStrategy()` case).
   - Model catalog (`getModelCatalog`/`initModelCatalogRefresh`/`refreshModelCatalog` imports, `stopModelCatalogRefreshJob` var + its start/stop calls, `modelCatalogProxyContext` ref + assignment, `modelCatalog: { get, refresh }` block in `new APIRouter({...})`).
   - xAI refresh-backed usage polling (`supportsRefreshBackedUsagePolling` helper, `anthropicAccounts` → `refreshBackedUsageAccounts` rename + log strings, the `recordUsageSnapshot` callback arg to `startUsagePollingWithRefresh(...)`).
   - Usage history / snapshot retention (`pruneUsageSnapshots(...)` calls in `runStartupMaintenance()` and the periodic-cleanup job).
   - Adaptive incremental vacuum (`dbOps.incrementalVacuumAdaptive()` replacing `dbOps.incrementalVacuum(8000)`, richer logging).
   Then apply the 5 worker-removal edits from RESEARCH.md §5(a):
   - Import block: replace `getUsageWorkerHealth` import with `getUsageCollectorHealth`; delete `sendWorkerConfigUpdate`, `startUsageWorker`, `terminateUsageWorker` from the import list. Keep `getModelCatalog`/`initModelCatalogRefresh`/`refreshModelCatalog`.
   - Call site 1 (APIRouter config): `getUsageWorkerHealth: () => getUsageWorkerHealth()` → `getUsageWorkerHealth: () => getUsageCollectorHealth()`. The field name on the left of the colon is the `APIContext`/`APIRouterConfig` key — do NOT rename it (cross-cutting gotcha #3); only the function invoked on the right changes.
   - Call site 2 (server startup): delete `startUsageWorker();` and `sendWorkerConfigUpdate(config.getStorePayloads());` lines that follow `await initProxy(() => config.getStorePayloads());` — keep the `await initProxy(...)` line and its `await` exactly as-is.
   - Call site 3 (hot-reload config watcher): replace the `if (key === "store_payloads") { sendWorkerConfigUpdate(...); }` block with the restored comment: `// store_payloads changes are picked up automatically via the getStorePayloads getter` (no code).
   - Call site 4 (graceful shutdown): delete `await terminateUsageWorker();` and its preceding comment about the in-process fallback collector; keep `usageCache.clear();` and `await drainUsageCollector();`.

3. **`apps/cli/package.json`** (RESEARCH.md §6): in the `scripts.build` string, remove the three additions made by `a4509ae8`: the `post-processor.worker.ts` existence-guard `bun -e`, the `bun build ../../packages/proxy/src/post-processor.worker.ts ...` + base64-encode step, and the trailing ` dist/post-processor.worker.js` entry in the final `rm -f` cleanup list. Splice in the pre-`a4509ae8` build string exactly (baseline: `git show e981fb78~1:apps/cli/package.json`). Do NOT touch the `"version"` field in either direction — leave it at its current value (CLAUDE.md: never bump version; this file's version is auto-managed by the release pre-push hook).
  </action>
  <verify>
```bash
grep -n "getUsageWorker\|startUsageWorker\|terminateUsageWorker\|sendWorkerConfigUpdate\|UsageWorkerHealth" packages/proxy/src/index.ts apps/server/src/server.ts
# expect: zero hits (except the untouched getUsageWorkerHealth: field-name key at APIRouter config, which stays as a key name — verify only its right-hand-side call target changed)
grep -n "post-processor.worker" apps/cli/package.json
# expect: zero hits
git diff apps/cli/package.json | grep -n '"version"'
# expect: no output (version field untouched/not in diff)
```
  </verify>
  <done>
    `index.ts` exports no worker symbols. `server.ts` startup calls only `await initProxy(...)`; shutdown calls only `await drainUsageCollector()`; hot-reload path has the restored comment with no `sendWorkerConfigUpdate` call; `getUsageWorkerHealth` config key still exists but internally calls `getUsageCollectorHealth()`. All unrelated server.ts features (session-affinity, model catalog, xAI polling rename, usage-history pruning, adaptive vacuum) preserved verbatim. `apps/cli/package.json` build script has no post-processor-worker bundling step; version field untouched.
  </done>
</task>

<task type="auto">
  <name>Task 3: Fix the two worker-coupled test files (§8a, §8b)</name>
  <files>
    packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts,
    packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts
  </files>
  <action>
This task depends on Task 1's `response-handler.ts`/`proxy.ts` behavior (direct, unguarded `getUsageCollector()` calls) — do not start until Task 1 is complete.

1. **`packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts`** (RESEARCH.md §8a): use `git show e981fb78~1:packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts` as the base (this restores `getUsageCollector`-based mocking, `Uint8Array` chunk type, and drops all worker-controller/fallback-routing suites). Then append the "passive model-catalog capture" describe block from the current HEAD version of this file **verbatim** (~265 lines, 7 test cases, spies on `modelCatalogModule.ingestModelsListing` only).
   **Gotcha (cross-cutting gotcha #4):** the appended model-catalog block's tests call `forwardToClient(...)` with `shouldProcessRequest === true` paths (e.g. `GET /v1/models` with a 200 response). After Task 1's revert, `forwardToClient` calls `getUsageCollector().handleStart(...)` directly with no try/catch — this WILL throw `"UsageCollector not initialized"` unless mocked. Add a `spyOn(usageCollectorModule, "getUsageCollector").mockReturnValue({ handleStart: mock(), handleChunk: mock(), handleEnd: mock(() => Promise.resolve()) } as unknown as UsageCollector)` active for the whole model-catalog describe block (restore this spy from whatever form it took in the pre-worker baseline's own suites, and extend its scope to also cover the appended model-catalog suite).
   Filename: keep `response-handler-worker-protocol.test.ts` as the filename (do not rename) — minimizes risk in this mechanical revert; the RESEARCH.md-suggested rename is optional and out of scope here.

2. **`packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts`** (RESEARCH.md §8b): revert to `git show e981fb78~1:packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts` verbatim (drops `proxyModule`/`getUsageWorker` import and `createMockWorkerController()` helper, restores `usageCollectorModule`/`getUsageCollector` spies, restores the doc-comment and both `describe(...)` title strings to their `usageCollector`-worded originals). Then re-add `getAgentFrontmatterModelFallback: () => false,` to both `ctx.config` mock objects in the Site 3 (`describe("proxy.ts — pool-exhausted path ...")`) block — this field does NOT exist in the raw `e981fb78~1` baseline but is required because `handleProxy()` calls `interceptAndModifyRequest(..., { frontmatterModelFallback: ctx.config.getAgentFrontmatterModelFallback() })` (unrelated agent-rewrite feature, preserved in Task 1's `proxy.ts` edit). Without this field, `handleProxy()` throws calling `ctx.config.getAgentFrontmatterModelFallback()` as `undefined()`.
  </action>
  <verify>
```bash
bun test packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts 2>&1 | tail -40
```
  </verify>
  <done>
    Both test files pass. `response-handler-worker-protocol.test.ts` has no worker-controller mocking, mocks `getUsageCollector` instead, and the "passive model-catalog capture" suite still passes with the collector mocked. `auto-refresh-probe-filter.test.ts` spies on `getUsageCollector` (not `getUsageWorker`), all 3 "sites" pass including Site 3 with `getAgentFrontmatterModelFallback` re-applied.
  </done>
</task>

<task type="auto">
  <name>Task 4: Full verification — lint, typecheck, format, full test suite, grep sanity check</name>
  <files>
    (none — verification only, no file modifications)
  </files>
  <action>
Run the full verification gate from RESEARCH.md §10, in order, stopping to fix any failure before proceeding to the next command:

1. Zero-worker-symbols grep sanity check (RESEARCH.md §10 — expect zero hits, or only stale prose comments in files outside this revert's scope per RESEARCH.md §8c: `packages/database/src/repositories/__tests__/request-cost-zero.test.ts`, `packages/database/src/__tests__/async-writer-interleaving.test.ts`, `packages/providers/src/providers/openrouter/__tests__/provider.test.ts`, `packages/proxy/src/__tests__/memory-leak.test.ts`, `packages/proxy/src/usage-extraction.ts`, and the unrelated `getUsageWorkerHealth` field name in `packages/types/src/context.ts`):
```bash
grep -rn "getUsageWorker\|UsageWorkerController\|startUsageWorker\|terminateUsageWorker\|sendWorkerConfigUpdate\|UsageWorkerHealth\|usage-worker-controller\|post-processor.worker\|safeHandleStart\|safeHandleChunk\|collectorRequestIds" packages/proxy/src apps/server/src apps/cli/package.json
```
2. Full lint/typecheck/format:
```bash
bun run lint && bun run typecheck && bun run format
```
3. Full test suite:
```bash
bun test 2>&1 | tail -40
```
4. Confirm `usage-collector.ts` required zero changes (cross-cutting gotcha #1 — sanity check, should already be true from Task 1):
```bash
git diff --stat HEAD -- packages/proxy/src/usage-collector.ts
```
   Expect empty output (this file is untouched by this revert).
5. Run `gitnexus_detect_changes()` via the `gitnexus-analyst` subagent before committing — confirm only the expected symbols/files show as changed (the 14 files in `files_modified` above), and no HIGH/CRITICAL risk is reported on any preserved unrelated feature (session-governor, resolveEffectiveModel, model catalog, throttling, PG-mode initProxy, model-rewrite, xAI polling, session-affinity, usage-history snapshots).
6. Confirm no unintended files changed:
```bash
git status --short
```
   Only the 14 files in this plan's `files_modified` (6 deleted, 8 modified) should appear.
  </action>
  <verify>
```bash
bun run lint && bun run typecheck && bun run format && bun test 2>&1 | tail -40
```
All commands exit 0; test suite shows zero failures.
  </verify>
  <done>
    Grep sanity check returns zero worker-symbol hits inside this revert's scope. `bun run lint && bun run typecheck && bun run format` all exit 0. Full `bun test` passes with zero regressions. `usage-collector.ts` shows no diff. `gitnexus_detect_changes()` (via subagent) confirms only expected files changed with no HIGH/CRITICAL risk on preserved features. `git status --short` shows exactly the 14 files from this plan's scope.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Proxy hot path → usage-collector.ts | Client-facing SSE stream data flows synchronously into accounting; a collector throw must not tear down an in-flight client response |
| Test mocks → production call sites | Test files must mock `getUsageCollector` correctly or tests will throw/false-pass, masking a real regression |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-jdk-01 | Denial of Service | Synchronous `getUsageCollector().handleChunk` on the hot path | accept | This is the intentional target state (matches `upstream/main`); user explicitly locked this decision in CONTEXT.md, trading async offload for simplicity. Pre-existing `usage-collector.ts` hardening (currentEvent reset, then/catch cleanup, AsyncDbWriter flush) already mitigates known failure modes and is untouched by this revert. |
| T-jdk-02 | Tampering | Hand-edit of 6 shared files risks silently dropping an unrelated fork feature | mitigate | Each hand-edit task cites the exact RESEARCH.md section enumerating unrelated changes to preserve verbatim; Task 4's `gitnexus_detect_changes()` + full `bun test` + grep sanity check catch any accidental removal before commit. |
| T-jdk-03 | Repudiation | Silent scope creep (e.g., accidentally touching `main`-only content via `git checkout`) | mitigate | Explicit instruction in every hand-edit task: do NOT `git checkout main`; use `git show e981fb78~1:<file>` as reference only, hand-edit onto current file. |
| T-jdk-04 | Information Disclosure | None — no new data paths, no new external surface introduced by this revert | accept | Purely subtractive change; no new attack surface. |

</threat_model>

<verification>
After all 4 tasks:
```bash
grep -rn "getUsageWorker\|UsageWorkerController\|startUsageWorker\|terminateUsageWorker\|sendWorkerConfigUpdate\|UsageWorkerHealth\|usage-worker-controller\|post-processor.worker\|safeHandleStart\|safeHandleChunk\|collectorRequestIds" packages/proxy/src apps/server/src apps/cli/package.json
bun run lint && bun run typecheck && bun run format
bun test 2>&1 | tail -40
git diff --stat HEAD -- packages/proxy/src/usage-collector.ts   # expect empty
git status --short   # expect exactly the 14 files in files_modified (6 deleted, 8 modified)
```
Route `gitnexus_impact` (before editing `UsageWorkerController`/`getUsageCollector`/`forwardToClient`/`handleProxy`) and `gitnexus_detect_changes` (before committing) through the `gitnexus-analyst` subagent per CLAUDE.md.
</verification>

<success_criteria>
- [ ] Zero worker-related symbols remain in `packages/proxy/src`, `apps/server/src`, `apps/cli/package.json` (grep clean per RESEARCH.md §10, modulo the documented stale-comment/out-of-scope exceptions in §8c/§0-item-3).
- [ ] `response-handler.ts` and `proxy.ts` call `getUsageCollector()` directly and synchronously at every accounting call site (start/chunk/end, including the pool-exhausted branch).
- [ ] `worker-messages.ts` `ChunkMessage.data` is `Uint8Array`, not `ArrayBuffer`.
- [ ] `index.ts` barrel exports no worker symbols.
- [ ] `server.ts` startup/shutdown/hot-reload call only `initProxy`/`drainUsageCollector`/the restored comment — no `startUsageWorker`/`terminateUsageWorker`/`sendWorkerConfigUpdate`.
- [ ] `apps/cli/package.json` build script bundles no `post-processor.worker.ts`; version field untouched.
- [ ] `response-handler-worker-protocol.test.ts` and `auto-refresh-probe-filter.test.ts` mock `getUsageCollector` (not the worker) and pass.
- [ ] All 6 pure worker-only files deleted.
- [ ] `usage-collector.ts` has zero diff (confirms subtractive-only change).
- [ ] `bun run lint && bun run typecheck && bun run format` clean; full `bun test` green.
- [ ] Every unrelated fork feature (session-governor, resolveEffectiveModel/combo routing, model-catalog capture, model-aware throttling, PG-mode async initProxy, model-rewrite headers, xAI refresh-backed polling, session-affinity, usage-history snapshot pruning, codex count-tokens synthesis, adaptive incremental vacuum) is present and byte-identical to pre-revert HEAD in the final diff.
- [ ] `gitnexus_detect_changes()` (via subagent) reports no HIGH/CRITICAL risk before commit; only the 14 planned files changed.
- [ ] Version not bumped; commits use `git add <specific-files>` (never `git add .` or `git add -A`).
</success_criteria>

<output>
Atomic commits per task, `fix:` prefix (this is a bug-fix/revert of an unwanted architectural change per user decision):
- Task 1: `fix(proxy): remove worker-based usage accounting from response-handler.ts and proxy.ts — restore synchronous usage-collector.ts calls`
- Task 2: `fix(proxy): remove worker lifecycle wiring from index.ts, server.ts, and cli build script`
- Task 3: `fix(proxy): update test mocks from worker-controller to usage-collector`
- Task 4: verification only — no separate commit unless fixes were needed during the gate; if fixes were needed, commit with `fix: address verification gate findings in usage-collector revert`

Do NOT touch ROADMAP.md (quick task). Do NOT bump version. Do NOT curl Anthropic. `git add <specific-files>` only, never `git add .`/`git add -A`.

After completion, create `.planning/quick/260718-jdk-undo-worker-based-usage-collector-offloa/260718-jdk-SUMMARY.md` using the summary template from `$HOME/.claude/gsd-core/templates/summary.md`.
</output>
