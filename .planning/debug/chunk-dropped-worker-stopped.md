---
status: open
slug: chunk-dropped-worker-stopped
trigger: "In logs: [WARN] Chunk dropped: worker is in 'stopped' state, cannot dispatch"
created: 2026-06-20
updated: 2026-06-20
cycles: 3
---

# Debug Session: chunk-dropped-worker-stopped

## Symptoms

- **trigger**: `[WARN] Chunk dropped: worker is in "stopped" state, cannot dispatch` appears in logs
- **expected**: Chunks should be processed without being dropped — worker should remain active and process all incoming chunks during a streaming response
- **actual**: Warning is emitted and chunks are silently dropped
- **trigger_condition**: Random / not sure — no clear pattern identified yet
- **timeline**: Started recently after a code change
- **reproduction**: Unknown — happens unpredictably
- **environment**: Occurs in **Docker builds via Dockerfile.local** (user confirmed). Also likely in dev mode (`bun start`).

## Current Focus

- hypothesis: "Root cause of why the worker enters stopped state is still unknown — confirmed it is NOT stale inline-worker.ts in Docker because Dockerfile.local always runs `bun run build` which regenerates it"
- test: "n/a — investigation phase"
- expecting: "Worker should be in ready state after server boots"
- next_action: "collect diagnostic data: `curl /health | jq .usageWorkerHealth` immediately after container start, and startup logs from first 5 minutes"
- reasoning_checkpoint: "Cycle 3 root cause (stale inline-worker.ts) was correctly identified for dev mode but incorrectly marked as the Docker cause — user confirmed Docker builds still exhibit the issue"

## Evidence

- timestamp: 2026-06-20T00:00:00Z
  file: packages/proxy/src/usage-worker-controller.ts
  finding: >
    `postMessage()` for chunk messages in `shutting_down` or `stopped` state called
    `log.warn(...)` unconditionally — every chunk of every streaming response that
    arrived in a terminal state produced a separate WARN log entry. Introduced in
    commit 5cd0e604 (WR-02 drop-and-log path) with no rate-limiting guard.

- timestamp: 2026-06-20T00:00:00Z
  file: packages/proxy/src/response-handler.ts (line 61 comment)
  finding: >
    Comment says "drops silently" for shutting_down/stopped state but the
    implementation was NOT silent — it logged a WARN on every dropped chunk.
    The `readyBufferCapWarned` pattern already existed for the startup-buffer
    overflow case but was not replicated for the terminal-state drop path.

- timestamp: 2026-06-20T00:00:00Z
  file: apps/cli/package.json — build:linux-amd64 script
  finding: >
    `build:linux-amd64` = `bun run build && bun build src/main.ts --compile ...`.
    The `bun run build` step explicitly: (1) builds post-processor.worker.ts →
    dist/post-processor.worker.js, (2) base64-encodes it into inline-worker.ts,
    (3) then compiles the binary. So Dockerfile.local ALWAYS embeds the current
    worker code — the stale inline-worker.ts theory does NOT apply to Docker builds.
    User confirmed: "I build using Dockerfile.local and this still happens."

- timestamp: 2026-06-20T00:00:00Z
  file: packages/proxy/src/post-processor.worker.ts (lines 80-87)
  finding: >
    New worker initialization: `await initPayloadEncryption()` (never throws —
    returns false if key not set), then `const dbOps = new DatabaseOperations()`
    (synchronous SQLite open + ensureSchema + runMigrations), then
    `dbOps.initializeAsync().catch(...)` (async, non-blocking), then message
    handler setup, then `self.postMessage({ type: "ready" })` at line 787.
    If `new DatabaseOperations()` throws at module level, Bun may not surface
    this to `onerror` on the parent — startup timer fires after 60s × 3 = 180s
    then stopped. This would produce restart logs, but only during the first
    3 minutes of boot.

- timestamp: 2026-06-20T00:00:00Z
  file: packages/database/src/database-operations.ts (lines 301-323)
  finding: >
    DatabaseOperations constructor opens SQLite SYNCHRONOUSLY: mkdirSync for
    dir, `new Database(resolvedPath, { create: true })`, PRAGMA auto_vacuum
    query, configureSqlite(), ensureSchema(), runMigrations(). Any failure here
    (permissions, corrupted DB, migration error) throws synchronously at module
    level in the worker. The worker path: `DatabaseOperations()` with no args
    → calls resolveDbPath() → reads BETTER_CCFLARE_DB_PATH env var (inherited
    from parent process in Bun Workers). In Docker: /data/better-ccflare.db.

## Eliminated Hypotheses

- "Worker crashes are causing the stopped state": partially true (one scenario) but
  the warning spam occurs even during normal graceful shutdown with in-flight streams.
- "Race at startup before startUsageWorker() is called": possible but rare window.
- "Stale inline-worker.ts (dev mode bun start)": CONFIRMED TRUE for dev mode only.
  The old Jun-4 embedded worker uses tiktoken WASM init; if WebAssembly.instantiate
  fails, catch block logs but never sends { type: "ready" }. 60s × 3 → stopped.
- "Stale inline-worker.ts causes Docker issue": RULED OUT. Dockerfile.local always
  regenerates inline-worker.ts via `bun run build` before compiling the binary.

## Open Questions for Next Session

**Critical — needed to confirm root cause in Docker:**

1. **Health endpoint immediately after boot**: Run `curl http://localhost:8080/health | jq '.usageWorkerHealth'`
   within 10 seconds of the container starting. Is `state` already `"stopped"` before
   any requests arrive? If yes → worker failed at init. If `"ready"` initially but
   `"stopped"` later → worker crashes during operation.

2. **Startup logs**: Run `docker logs <container> 2>&1 | head -200` immediately after
   container starts. Are there ANY lines containing `UsageWorkerController`, `Worker error`,
   `Restarting worker`, or `Worker failed`? These would appear in the first 3 minutes if
   MAX_RESTARTS exhaustion is the path (3 × 60s startup timeout).

3. **Debug mode**: Does `BETTER_CCFLARE_DEBUG=true` produce additional logs that
   show worker lifecycle events?

4. **Is it every restart or first boot only?** Does the warning appear on every container
   start, or only sometimes? This matters for whether it's deterministic (init failure)
   vs timing-sensitive (race).

**Hypotheses still open (ranked by likelihood):**

A. **DatabaseOperations() throws during worker init** — SQLite open fails (permissions,
   path, migration error on a corrupted DB), Bun does not surface module-level throws
   to onerror on the parent, startup timer fires 3× → stopped. Would produce restart logs
   but only during first 3 min of boot; easy to miss.

B. **Restart logs were missed** — all 7 lines (`[ERROR] Worker error` × 3 + `[WARN]
   Restarting worker` × 3 + `[ERROR] Worker failed after 3 restarts`) fire within the
   first 3 min. If user checked logs after boot completed, these could scroll off or
   be missed. NEED: check startup logs from t=0 to t=180s.

C. **Worker crashes fast enough that restart logs appear in 30s burst** — if worker
   crashes immediately (not via 60s timeout), 3 restarts can happen in under a second.
   The 7 log lines fire instantly at startup and could be overlooked.

D. **startUsageWorker() not called** — unlikely for fresh Docker boot but possible if
   the server is started via some wrapper that bypasses the normal startup sequence.

## Code Changes Applied in Cycles 1+2 (REVERTED — see note below)

**Cycle 1 — stoppedDropWarned flag (REVERTED):**
Added `stoppedDropWarned: boolean` to UsageWorkerController to rate-limit the WARN
to once per terminal-state episode. REVERTED because: the unconditional WARN is
a diagnostic signal we need while the root cause is unconfirmed. Rate-limiting it
hides the frequency and makes it harder to see when the worker entered stopped state.

**Cycle 2 — fallback to tryGetUsageCollector (REVERTED):**
`safeHandleStart`, `safeHandleChunk`, `fireAndForgetEnd` in response-handler.ts
now check `w.isReady()` first and fall back to `tryGetUsageCollector()` when not
ready. REVERTED because: (a) the WARN in postMessage() is now never triggered (chunks
bypass postMessage() entirely when not ready), removing our diagnostic visibility;
(b) for "starting" state, chunks go to UsageCollector instead of the worker's
readyBuffer, which changes semantics — when the worker becomes ready, the ready buffer
is empty but UsageCollector already processed those chunks; subsequent chunks (after
ready) go to the worker which never got a StartMessage, creating inconsistent state.
The cycle-2 fix should be redesigned more carefully once root cause is confirmed.

**Test changes (REVERTED with code):** Both new test suites removed with the revert.

## Resolution (Cycle 1 — log rate-limiting)

- root_cause: >
    `UsageWorkerController.postMessage()` emitted an unconditional `log.warn()` on
    every chunk drop in `stopped`/`shutting_down` state. Two scenarios trigger this:
    (1) the worker fails after MAX_RESTARTS and enters permanent stopped state —
    every subsequent request floods logs; (2) graceful shutdown races with in-flight
    streaming responses. No rate-limiting guard existed for this path, unlike the
    analogous `readyBufferCapWarned` flag used for the startup-buffer overflow case.

- fix: >
    REVERTED — see "Code Changes Applied" section above for why.

- verification: >
    Was verified (12 pass, 0 fail), then reverted per user instruction.

## Resolution (Cycle 2 — data-loss fallback)

- root_cause: >
    `safeHandleStart` and `fireAndForgetEnd` in `response-handler.ts` both checked
    `w.isReady()` before posting. When the worker is in "stopped" state (after
    MAX_RESTARTS=3 exhaustion), neither StartMessage nor EndMessage was ever sent.
    The consequence: no RequestState was created in the worker, chunks arriving via
    `safeHandleChunk` were silently dropped (worker logs "No state found"), and no
    DB write (saveRequest / saveRequestPayloadRaw) ever occurred. All analytics and
    usage stats were silently lost for every request while the worker was stopped.

- fix: >
    REVERTED — see "Code Changes Applied" section above for why. Needs redesign:
    the fallback should ONLY apply to the truly "stopped" state, not "starting"
    (which has its own ready-buffer mechanism). A cleaner fix would add a separate
    `isStopped(): boolean` method (state === "stopped") and only fall back to
    UsageCollector when `isStopped()` is true, leaving the "starting" path
    unchanged (chunks still go to postMessage → readyBuffer as before).

- verification: >
    Was verified (10 pass, 0 fail for response-handler tests, 12 pass for
    usage-worker-controller tests), then reverted per user instruction.

## Resolution (Cycle 3 — Root cause: stale inline-worker.ts in dev mode)

- root_cause: >
    In dev mode (`bun start`), `inline-worker.ts` on disk (Jun 4) predates the new
    `post-processor.worker.ts` (Jun 17–19, commits bbe9835e + 5cd0e604). The file is
    untracked by git (removed in commit 1ebdded1). The stale Jun-4 embedded worker uses
    tiktoken WASM initialization: if WebAssembly.instantiate fails in Bun's smol Worker
    mode, catch block logs but never sends { type: "ready" }. The controller waits 60s
    × 3 restarts = 180s then enters permanent stopped state.
    **NOTE: This does NOT explain the Docker case** — Docker builds run `bun run build`
    which always regenerates inline-worker.ts from the current post-processor.worker.ts.
    User confirmed the issue still occurs in Dockerfile.local builds.

- fix: >
    For dev mode: run `bun run build` before `bun start` to regenerate inline-worker.ts.
    For Docker: root cause still unknown — needs diagnostic data (see Open Questions).

- verification: >
    Partial — dev mode fix is logical (rebuild regenerates the file) but NOT tested
    because the user is running Docker builds where this root cause does not apply.

## Architecture Notes

- `UsageWorkerController` initial state: `stopped`
- `startUsageWorker()` → `usageWorkerController.start()` → state = `starting`, Bun Worker spawned
- Worker sends `{ type: "ready" }` → state = `ready`; chunks are dispatched to it
- On `onerror`: `attemptRestart()` up to `MAX_RESTARTS=3`; after 3 failures → state = `stopped` permanently
- On `terminate()` (shutdown): state = `shutting_down` → `stopped`
- Chunk messages in `stopped`/`shutting_down` state are logged + dropped (WR-02 guard)
- `stoppedDropWarned` flag (REVERTED): would have rate-limited to one warn per episode
- Cycle-2 fallback (REVERTED): would have routed to UsageCollector when not ready

## Next Steps

1. Start a fresh container with `docker run` (or `docker compose up`) and immediately run:
   ```bash
   # Within 10s of startup:
   curl http://localhost:8080/health | jq '.usageWorkerHealth'
   # Full startup logs:
   docker logs <container_id> 2>&1
   ```
2. Look for ANY of these lines: `Worker error`, `Restarting worker`, `Worker failed after`,
   `Chunk dropped`, `Failed to initialize database`.
3. Report findings back to continue the debug session:
   `/gsd-debug continue chunk-dropped-worker-stopped`
