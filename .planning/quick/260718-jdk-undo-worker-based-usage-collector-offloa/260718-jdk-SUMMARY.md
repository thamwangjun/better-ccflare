---
quick_id: 260718-jdk
slug: undo-worker-based-usage-collector-offloa
description: Undo worker-based usage-accounting offload — restore synchronous usage-collector.ts on the proxy hot path
date: 2026-07-18
status: complete
subsystem: proxy
tags: [proxy, usage-accounting, revert, worker, bun-worker]
commits:
  - 49366a4b
  - 75c22a7d
  - cda10f6f
  - d8ef1e6a
requirements: []
key-files:
  deleted:
    - packages/proxy/src/usage-worker-controller.ts
    - packages/proxy/src/post-processor.worker.ts
    - packages/proxy/src/__tests__/usage-worker-controller.test.ts
    - packages/proxy/src/__tests__/usage-worker-controller-restart.test.ts
    - packages/proxy/src/__tests__/worker-transfer-aliasing.test.ts
    - packages/proxy/src/__tests__/rss-soak.manual.test.ts
  modified:
    - packages/proxy/src/worker-messages.ts
    - packages/proxy/src/response-handler.ts
    - packages/proxy/src/proxy.ts
    - packages/proxy/src/index.ts
    - apps/server/src/server.ts
    - apps/cli/package.json
    - packages/proxy/src/__tests__/pool-exhausted.test.ts
    - packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts
    - packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts
duration: 15min
completed: 2026-07-18
---

# Quick Task 260718-jdk: Undo worker-based usage-collector offload

**Removed all Bun-Worker-based usage-accounting plumbing (controller, worker body, transferable-ArrayBuffer message contract, worker build step) and restored `packages/proxy/src/usage-collector.ts` as the sole, synchronous accounting path on the proxy hot path — matching `upstream/main`, while preserving every unrelated fork feature (session-governor, combo routing, model catalog, model-rewrite, PG-mode async initProxy, etc.) byte-for-byte.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-18T14:12:55Z
- **Completed:** 2026-07-18T14:28:06Z
- **Tasks:** 4 (3 code tasks + 1 verification-only task)
- **Files modified:** 15 (6 deleted, 9 hand-edited)

## Accomplishments

- Deleted 6 pure worker-only files (controller, worker body, 4 worker-only test files) with zero unrelated content lost.
- `response-handler.ts` and `proxy.ts` now call `getUsageCollector().handleStart/handleChunk/handleEnd` directly and synchronously at every accounting call site (streaming, non-streaming, and the pool-exhausted 503 branch) — no worker dispatch, no `collectorRequestIds` fallback-routing Set.
- `worker-messages.ts`'s `ChunkMessage.data` reverted from `ArrayBuffer` back to `Uint8Array`; the transfer-contract doc comment removed.
- `index.ts` barrel, `server.ts` lifecycle (startup/shutdown/hot-reload), and `apps/cli/package.json`'s build script all worker-free; CLI version field untouched.
- Every unrelated fork feature verified present and byte-identical in the final diff: session-governor circuit breaker, `resolveEffectiveModel`/combo routing, model-catalog passive capture, model-aware usage throttling, PG-mode async `initProxy`/`DatabaseFactory`, model-rewrite headers, xAI refresh-backed polling, session-affinity strategy, usage-history snapshot pruning, codex count-tokens synthesis, adaptive incremental vacuum.
- Full verification gate green: grep sanity check clean, `bun run lint && bun run typecheck && bun run format` all exit 0, full `bun test` shows 2256/2258 passing (2 pre-existing environmental failures, confirmed unrelated — see Issues Encountered), `usage-collector.ts` has zero diff.

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete worker-only files; hand-edit worker-messages.ts, response-handler.ts, proxy.ts** - `49366a4b` (fix)
2. **Task 2: Hand-edit index.ts barrel, server.ts lifecycle, apps/cli/package.json build script** - `75c22a7d` (fix)
3. **Task 3: Fix the two worker-coupled test files** - `cda10f6f` (fix)
4. **Task 4: Full verification gate** - `d8ef1e6a` (fix — lint auto-fixed import ordering in two test files, no behavior change)

_No separate plan-metadata commit was made for this quick task — see "Docs commit" note below._

## Files Created/Modified

- `packages/proxy/src/usage-worker-controller.ts` (deleted) — worker lifecycle controller
- `packages/proxy/src/post-processor.worker.ts` (deleted) — worker body
- `packages/proxy/src/__tests__/usage-worker-controller.test.ts` (deleted)
- `packages/proxy/src/__tests__/usage-worker-controller-restart.test.ts` (deleted)
- `packages/proxy/src/__tests__/worker-transfer-aliasing.test.ts` (deleted)
- `packages/proxy/src/__tests__/rss-soak.manual.test.ts` (deleted)
- `packages/proxy/src/worker-messages.ts` - `ChunkMessage.data` reverted to `Uint8Array`
- `packages/proxy/src/response-handler.ts` - direct synchronous `getUsageCollector()` calls; model-catalog/model-rewrite/codex-count-tokens features preserved
- `packages/proxy/src/proxy.ts` - `UsageWorkerController` singleton and WORKER MANAGEMENT block removed; pool-exhausted branch calls `getUsageCollector()` directly; async `initProxy`/`DatabaseFactory` PG-mode signature preserved
- `packages/proxy/src/index.ts` - worker barrel exports removed
- `apps/server/src/server.ts` - worker start/config-push/terminate calls removed; `getUsageCollectorHealth()` wired into the (unrenamed) `getUsageWorkerHealth` config key
- `apps/cli/package.json` - `post-processor.worker.ts` bundle step removed from `build` script; version field untouched (3.5.39)
- `packages/proxy/src/__tests__/pool-exhausted.test.ts` - added `getUsageCollector` spy (Rule 1 fix, see Deviations)
- `packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts` - rewritten on the pre-worker baseline + preserved "passive model-catalog capture" suite with a `getUsageCollector` spy
- `packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts` - reverted to pre-worker baseline + re-applied `getAgentFrontmatterModelFallback` fixture field

## Decisions Made

- Followed CONTEXT.md's locked decision: hand-edit all 6 shared files against the `e981fb78~1` baseline rather than `git checkout main`, since `main` lacks unrelated fork features. No deviation from this.
- No GitNexus MCP tools or Task-dispatch subagent tool were available in this execution session (only Read/Write/Edit/Bash were exposed to the executor). Per CLAUDE.md, `gitnexus_impact`/`gitnexus_detect_changes` must be routed through the `gitnexus-analyst` subagent — since neither the subagent dispatch mechanism nor direct GitNexus MCP tools were reachable, these steps were **not run** this session. RESEARCH.md's manual git-history blast-radius analysis (commit-range diffs per file, `git log e981fb78~1..HEAD`) served as the equivalent due-diligence in its place. This is a tooling-availability gap, not a decision to bypass the safety practice — flagged here for follow-up (e.g., re-running `gitnexus_detect_changes` via the dashboard/CLI once available, or a future session with the subagent tool present).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `pool-exhausted.test.ts` broke from Task 1's revert but was outside RESEARCH.md's symbol-grep sweep**
- **Found during:** Task 1 (proxy.ts pool-exhausted branch edit)
- **Issue:** RESEARCH.md's §8c grep sweep for worker symbols didn't catch `pool-exhausted.test.ts` because it never referenced `getUsageWorker`/worker symbols directly — it exercises `handleProxy()`'s pool-exhausted 503 path with a bare `ProxyContext` mock and relied on the (now-removed) worker controller's silent not-ready no-op to avoid throwing. After Task 1's revert to direct, unmocked `getUsageCollector()` calls, 9 of 10 tests in this file threw `"UsageCollector not initialized"`.
- **Fix:** Added a `beforeEach`/`afterEach` `spyOn(usageCollectorModule, "getUsageCollector").mockReturnValue({ handleStart, handleChunk, handleEnd })` — the same pattern the plan already specified for the two designated test files (Task 3).
- **Files modified:** `packages/proxy/src/__tests__/pool-exhausted.test.ts`
- **Verification:** All 10 tests pass; `bun run typecheck` clean.
- **Committed in:** `49366a4b` (Task 1 commit)

**2. [Rule N/A - lint] Import-order auto-fix during Task 4's verification gate**
- **Found during:** Task 4 (`bun run lint`)
- **Issue:** Biome's import-sort rule reordered a type-only import (`import type { UsageCollector }`) before the corresponding namespace import (`import * as usageCollectorModule`) in two test files.
- **Fix:** Accepted the lint auto-fix (cosmetic only, no behavior change).
- **Files modified:** `packages/proxy/src/__tests__/pool-exhausted.test.ts`, `packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts`
- **Verification:** `bun run typecheck` and full `bun test` still green after the fix.
- **Committed in:** `d8ef1e6a` (Task 4 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule-1 bug fix, 1 cosmetic lint auto-fix)
**Impact on plan:** The Rule-1 fix was necessary to avoid a false regression signal in the full test suite; it follows the exact spy pattern the plan already prescribed for the two designated test files, applied to a third file the plan's own grep-based discovery missed. No scope creep — same revert, no new behavior.

## Issues Encountered

- **GitNexus/subagent-dispatch tooling unavailable this session** — see "Decisions Made" above. `gitnexus_impact` (pre-edit blast radius) and `gitnexus_detect_changes` (pre-commit change-scope check) mandated by CLAUDE.md and the plan could not be run. RESEARCH.md's manual commit-range diff analysis was used as the substitute due-diligence for every hand-edited file.
- **Two full-suite test failures confirmed pre-existing/environmental, unrelated to this revert:**
  - `packages/proxy/src/__tests__/model-catalog.test.ts` — "recovers on a later tick..." is a timing-sensitive test that fails only under full-suite CPU contention; passes cleanly in isolation (42/42). No reference to `getUsageCollector`/worker symbols anywhere in the file.
  - `apps/cli/__tests__/cli.test.ts` — "should sanitize error messages" spawns the real CLI with `--serve --ssl-key <nonexistent-path>` (no `--ssl-cert`, so TLS validation never triggers) and expects a fast non-zero exit. Confirmed via manual reproduction that the test only passes when port 8080 is already occupied (the CLI hits `EADDRINUSE` and exits quickly); in this sandboxed execution environment nothing else listens on 8080, so the server starts and blocks, and the test's internal 6s kill-timeout races bun:test's own 5s default timeout. This is a pre-existing test-design dependency on external port state, not a code regression — confirmed by temporarily occupying port 8080 and re-running (test passes: 1/1).
  - Both are out of scope per the plan's SCOPE BOUNDARY rule (pre-existing issues unrelated to this task's edits) and were left untouched.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Usage accounting is now 100% synchronous via `usage-collector.ts`, matching `upstream/main` — future upstream merges touching usage accounting should apply more cleanly against this file going forward.
- No blockers. Recommend a follow-up session with GitNexus MCP / subagent-dispatch tooling available to run the `gitnexus_detect_changes()` change-scope confirmation retroactively against this diff, per CLAUDE.md's mandatory pre-commit practice.

---
*Quick task: 260718-jdk*
*Completed: 2026-07-18*

## Self-Check: PASSED

- All 10 modified/created files confirmed present on disk.
- All 6 planned deletions confirmed absent from disk.
- All 4 task commits (`49366a4b`, `75c22a7d`, `cda10f6f`, `d8ef1e6a`) confirmed present in `git log`.
