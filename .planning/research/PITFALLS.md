# Pitfalls Research

**Domain:** Bun-to-Node.js runtime migration for a long-running HTTP proxy (SSE streaming, SQLite WAL + Postgres, worker threads with transferable ArrayBuffers, standalone CLI binary, Docker/CI)
**Researched:** 2026-07-17
**Confidence:** MEDIUM-HIGH (codebase facts are HIGH confidence — verified by direct inspection; Node/Bun API-difference claims are MEDIUM-HIGH — cross-checked against official Node docs and open `nodejs/*` GitHub issues, current as of the Node 24/25 dev cycle)

**How this file was built:** every pitfall below is anchored to a concrete file/line in `better-ccflare` (read directly, not inferred), then cross-checked against current Node.js documentation/issues. Line numbers may drift as the migration proceeds — treat them as pointers, not guarantees.

---

## Critical Pitfalls

### Pitfall 1: The entire HTTP layer is built on the Fetch API (`Request`/`Response`), not Node's `http` module

**What goes wrong:**
Teams start migrating `Bun.serve()` by mechanically rewriting `apps/server/src/server.ts` to `http.createServer((req, res) => ...)`, then discover that the Fetch-API contract is load-bearing everywhere, not just in `server.ts`. `packages/http-api/src/router.ts` types every handler as `(req: Request, url: URL) => Response | Promise<Response>` (verified: `router.ts:141,488-489`). `packages/proxy/src/proxy.ts` (`handleProxy`) returns `Promise<Response>` and constructs `new Response(...)` directly (`proxy.ts:216-305`). Static asset serving uses `new Response(Bun.file(fullPath), {...})` (`server.ts:210`). A callback-style rewrite forces touching every handler, every provider's response construction, and the SSE streaming path — a huge, error-prone diff that violates the "stay deployable every phase" constraint.

**Why it happens:** Bun's `Bun.serve({ fetch(req: Request) { ... } })` natively speaks the Web Fetch API (`Request`/`Response`/`ReadableStream`). Node's built-in `http`/`https` modules predate the Fetch API and use `(IncomingMessage, ServerResponse)` — a completely different, non-standard object shape (no `.body` as a `ReadableStream`, no `new Response()`).

**How to avoid:** Don't rewrite handlers. Put a thin **Fetch-API-to-Node adapter** at the single entry point (`server.ts`) that converts Node's `(req, res)` into a `Request` and pipes a returned `Response`'s `ReadableStream` body back through `res.write()`/`res.end()`. Options, cheapest first:
- Node 18+ has global `Request`/`Response`/`ReadableStream` (via undici) — you only need the *adapter glue*, not a Request/Response polyfill.
- A small library (`@hono/node-server`'s adapter, `srvx`, or a hand-rolled ~150-line adapter) that implements `fetch(req: Request): Promise<Response>` on top of `http.createServer`.
- Whichever is chosen, it must correctly stream `ReadableStream` response bodies chunk-by-chunk (see Pitfall 9) rather than buffering with `response.text()` first — buffering would break SSE.

This confines the entire Bun→Node HTTP diff to one file and keeps 100% of `router.ts` and all provider/handler code unchanged.

**Warning signs:** Any PR that touches more than `server.ts` to accomplish the HTTP migration; handlers gaining `res.writeHead`/`res.end` calls; `Request`/`Response` types disappearing from `router.ts` signatures.

**Phase to address:** Foundational — this is the design decision that determines the shape of the entire HTTP-server migration phase. Must be decided before any handler-level work starts.

---

### Pitfall 2: Backend packages ship zero build step — Bun executes raw `.ts` at runtime; Node cannot, and 3 files use real (non-erasable) TypeScript `enum`

**What goes wrong:** Every internal package's `package.json` points `main`/`exports` directly at TypeScript source (verified: `packages/proxy/package.json` → `"main": "./src/index.ts"`, same pattern in `apps/server/package.json` → `"main": "./src/server.ts"`, and across all ~15 `packages/*`). Bun's runtime has a built-in transpiler and executes `.ts` (including full TS features) with no separate compile step. Node does not — plain `node src/server.ts` fails immediately (`ERR_UNKNOWN_FILE_EXTENSION` unless the newer type-stripping path is used, and even then it breaks on real TS constructs). Three files use genuine `enum` declarations: `packages/logger/src/index.ts` (`LogLevel` — imported by nearly every package via the `Logger` class), `packages/types/src/conversation.ts` (`ContentBlockType`), and `packages/types/src/strategy.ts` (`StrategyName`). Node's native type-stripping (stable in recent Node 22/23/24 releases) explicitly does **not** support `enum`, `namespace`, or constructor parameter-properties — it only strips erasable type annotations. Running these files with `node --experimental-strip-types` (or the now-default behavior) throws a syntax/transform error on the `enum` keyword.

**Why it happens:** Assuming "Node 24 has native TypeScript support" is a sufficient replacement for Bun's transpiler. It isn't — Node's type-stripping is deliberately narrow (types only, zero-cost erasure) and was never meant to be a drop-in TSC/Bun replacement.

**How to avoid:** Pick one, applied consistently to every backend package:
1. **Compile step** (recommended): add a build using `tsc`, `esbuild`, `swc`, or `tsup` that emits plain `.js` for every `packages/*/src` and `apps/*/src`, and point `main`/`exports` at the compiled output. This is the only option compatible with Node's SEA/binary packaging (Pitfall 9) and with `better-sqlite3`'s CJS/ESM expectations.
2. Rewrite the 3 `enum`s to `as const` object + union-type pattern (erasable, works with native stripping) **only if** the team commits to zero-build-step Node execution — riskier, since any future contributor could reintroduce a non-erasable construct (decorators, namespaces, parameter properties) and silently break `node` execution with a runtime error, not a type error.

Do this audit once, early, and gate it with a lint rule or CI check (e.g., a Biome/ESLint rule forbidding `enum`/`namespace`/parameter-properties) so it can't regress.

**Warning signs:** `node <file>.ts` throwing `SyntaxError: Unexpected token` on `enum`; CI green under `bun run` but failing the moment a workflow step swaps to `node`; new code introducing `enum`/`namespace` after the decision is made.

**Phase to address:** Foundational — this blocks literally every other phase (server, CLI, workers, tests all execute `.ts` today). Decide the build strategy in Phase 1 alongside the package-manager swap.

---

### Pitfall 3: `workspace:*` is not an npm protocol — every internal `package.json` dependency breaks on `npm install`

**What goes wrong:** All ~15 internal packages declare cross-package dependencies as `"@better-ccflare/core": "workspace:*"` (verified in `packages/proxy/package.json`, `packages/database/package.json`, `apps/server/package.json`, etc.). This is pnpm/Yarn-Berry/Bun syntax. Plain npm (even npm 11.x, per `npm/cli#8845`, open as of this research) does **not** resolve `workspace:*` — `npm install` fails with `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`. Teams that assume "npm workspaces support the same `workspace:` protocol as everyone else" hit a hard install failure on the very first command of the migration.

**Why it happens:** The `workspace:` protocol is a pnpm/Yarn-Berry convention that Bun also adopted for compatibility; npm's actual local-workspace-resolution mechanism is different — it just uses a plain semver range (or `"*"`) and npm auto-symlinks the local workspace package by name+version match, no special protocol keyword.

**How to avoid:** Bulk-rewrite every `"workspace:*"` value to `"*"` across every `packages/*/package.json` and `apps/*/package.json` in the same commit that swaps `bun.lock` → npm workspaces. Verify with `npm install` (not `npm ci`, until a lockfile exists) immediately after, and confirm `node_modules/@better-ccflare/*` are symlinks into `packages/*`, not copies.

**Warning signs:** `npm install` failing at the very first workspace package it tries to resolve; anyone still committing `workspace:*` after the swap (add a grep-based pre-commit/CI check).

**Phase to address:** Foundational — Phase 1 (package manager/workspace swap), blocks everything downstream.

---

### Pitfall 4: Bun's Worker API is browser-style (`onmessage`/`onerror`, `MessageEvent`/`ErrorEvent`, `{ smol: true }`); `node:worker_threads` is EventEmitter-style — this is a rewrite, not a rename

**What goes wrong:** `packages/proxy/src/usage-worker-controller.ts` (the controller for the hot-path usage/billing worker) uses `this.worker.onmessage = (ev: MessageEvent) => { this.handleMessage(ev.data as OutgoingWorkerMessage); }` and `this.worker.onerror = (error: ErrorEvent) => {...}` (verified: `usage-worker-controller.ts:127-145`), plus a Bun-only constructor option `new Worker(workerUrl, { smol: true })` (`:394,402`) that reduces worker heap footprint — this option does not exist in `node:worker_threads` and must simply be dropped. `node:worker_threads` workers are `EventEmitter`s: `worker.on("message", (data) => ...)`, `worker.on("error", (err) => ...)` — no `MessageEvent`/`ErrorEvent` wrapper, `data` is the raw payload, `err` is a raw `Error`, not an object with `.filename`/`.lineno`. A mechanical "just swap the import" migration silently produces a controller whose message/error handlers never fire (because `.onmessage =`/`.onerror =` assignment on a Node `Worker` is simply ignored — Node's `Worker` doesn't define those setters), which means the usage-collector's ready/ack/summary/shutdown-complete protocol goes dark with no exception thrown.

**Why it happens:** Bun deliberately implements the browser Worker/`postMessage` API for cross-runtime compatibility; Node's `worker_threads` predates that convention and uses Node's own EventEmitter pattern.

**How to avoid:** Rewrite (not patch) `usage-worker-controller.ts`'s event wiring to `worker.on("message", ...)` / `worker.on("error", ...)` / `worker.on("exit", ...)`, remove `{ smol: true }`, and add explicit unit/integration tests asserting the `ready` → `ack` → `summary` → `shutdown-complete` message sequence actually fires end-to-end (not just that `postMessage` was called) — this is the exact pipeline behind the two open debug sessions (`chunk-dropped-worker-stopped`, `stalled-streaming-requests`), so a silent handler-wiring regression here would masquerade as "the same old flaky worker bug" instead of a new migration bug.

**Warning signs:** Usage/cost data silently stops being recorded after the worker migration with no error in logs (because the error handler itself is the thing that's disconnected); `worker.postMessage()` appears to succeed but `getHealth()` never reports `"ready"`.

**Phase to address:** Worker-threads migration phase — but write the "ready/ack/summary/shutdown-complete round-trip" test *before* touching the code (TDD), since this exact pipeline is billing-critical and already has open, unexplained bugs.

---

### Pitfall 5: `node:worker_threads` does not support Blob-URL workers — the embedded-base64-worker-code pattern must be rewritten to `{ eval: true }`

**What goes wrong:** Three call sites construct workers from a base64-embedded, self-contained script string rather than a file path: `usage-worker-controller.ts:388-403` (`Buffer.from(EMBEDDED_WORKER_CODE, "base64")` → `new Blob([...])` → `URL.createObjectURL(blob)` → `new Worker(workerUrl, { smol: true })`), and the same pattern in `packages/database/src/database-operations.ts:1433-1435,1546-1548` (vacuum/incremental-vacuum workers) and `packages/database/src/integrity-check-runner.ts:53-55`. Bun implements the browser `URL.createObjectURL`/`Blob` Worker-source convention. **`node:worker_threads` does not accept Blob or `blob:` URLs at all** — this is a hard, documented gap (confirmed via Node docs + community reports of failed `data:`-URL workarounds). A literal port of this code silently fails to construct a worker on Node.

**Why it happens:** The embedded-base64-worker pattern exists specifically so the standalone CLI binary (Pitfall 9) can ship worker code without separate files on disk. It relies on a Bun-only Web API.

**How to avoid:** Replace `Blob` + `createObjectURL` with Node's native inline-source option: `new Worker(decodedSourceString, { eval: true })` — `node:worker_threads` supports passing JS source directly as a string when `eval: true` is set, no Blob/data-URL indirection needed. This is a smaller, more direct fix than porting the Blob mechanism. Keep the base64-embedding build step (needed for the standalone-binary use case either way), just change the *decode-and-launch* side.

**Warning signs:** `new Worker(...)` throwing `ERR_INVALID_ARG_TYPE` or silently hanging in "starting" state until the 60s startup timeout in `usage-worker-controller.ts:42,60-74` fires; vacuum/integrity-check workers never completing.

**Phase to address:** Worker-threads migration phase, same phase as Pitfall 4 (do both event-wiring and worker-construction rewrites together — they touch the same files).

---

### Pitfall 6: A dormant Bun-removal footgun already ships in the retry path — `spawnSync("sleep", ...)` will start blocking the whole event loop the moment Bun is gone

**What goes wrong:** `packages/database/src/retry.ts:70-103` implements `sleepSync(ms)` with `if (typeof Bun !== "undefined" && Bun.sleepSync) { Bun.sleepSync(ms); } else { spawnSync("sleep", [...]) }`. Today this fallback branch **never runs** because `Bun` is always defined. Once Bun is removed, `typeof Bun !== "undefined"` becomes `false` on every call, and the fallback — forking an OS process via `spawnSync` and synchronously blocking the calling thread until it exits — becomes the *only* path. `spawnSync` blocks Node's single-threaded event loop for the entire sleep duration, which means **every other in-flight request on the proxy (including active SSE streams) stalls** for the duration of each synchronous DB retry backoff. This function is called from `executeWithRetrySync` (`retry.ts:108+`), i.e. specifically the *synchronous* SQLite retry path used for `SQLITE_BUSY` contention — which is one of the two live, open debug hypotheses (`stalled-streaming-requests` names "SQLite `SQLITE_BUSY` lock contention" as a suspected root cause). Migrating off Bun without fixing this *actively makes that exact bug worse and harder to diagnose*, because the blocking behavior only appears once Bun is gone, decoupling cause from the migration commit that introduced it.

**Why it happens:** The fallback was written defensively ("what if Bun isn't available") without anticipating it would become the *primary* path in a full runtime migration, and `spawnSync` was chosen as "a" synchronous-sleep mechanism without weighing its event-loop-blocking cost against alternatives.

**How to avoid:** Replace the fallback with `Atomics.wait()` on a `SharedArrayBuffer`-backed `Int32Array` (`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)`) — this blocks only the calling thread (fine, since this runs inside the synchronous DB-operation call stack by design) without forking a process, and has microsecond-level overhead instead of process-spawn overhead (tens of milliseconds). Add a regression test asserting `sleepSync()` does not spawn a child process and completes in close to the requested duration. Flag this file for review the moment Bun-conditional code is touched — do not defer it to "later cleanup."

**Warning signs:** Latency spikes / stalled requests correlating with DB retry-backoff windows after the Bun runtime is removed but before this fix lands; `ps`/`strace` showing `sleep`/`timeout` child processes spawned by the Node process under load.

**Phase to address:** Address explicitly in the **SQLite driver migration phase** (same phase that touches `packages/database/`), not deferred to polish — this is a correctness/availability regression, not a nice-to-have.

---

### Pitfall 7: The SQL adapter isn't "swap one driver" — it's two drivers hiding behind one abstraction (`Bun.SQL` serves both SQLite-via-URL and Postgres)

**What goes wrong:** `packages/database/src/adapters/bun-sql-adapter.ts` wraps **both** `bun:sqlite`'s synchronous `Database` **and** `Bun.SQL` for PostgreSQL through a single unified adapter (verified: `bun-sql-adapter.ts:1,65-116` — "Unified SQL adapter that abstracts over bun:sqlite (sync) and Bun.SQL/PostgreSQL (async)... For PostgreSQL: wraps Bun.SQL for async operations"). Teams that scope "the SQLite driver swap" as a single task under-scope it — there are two independent driver replacements needed (SQLite: `better-sqlite3` or `node:sqlite`; Postgres: `pg` or `postgres.js`), each with different sync/async semantics that the adapter's `transaction()` method already special-cases ("bun:sqlite transactions are sync; wrap fn result" / "Bun.SQL... async begin()", `:299-307`). Getting this wrong either breaks the sync SQLite path (most of the app's hot-path DB calls are synchronous, which is *why* the codebase needs a real synchronous driver, not just wraps everything in `await`) or breaks the async Postgres pooling/connection-lifecycle behavior (`ERR_POSTGRES_IDLE_TIMEOUT` handling exists today at `database-operations.ts:326-330` and must be re-implemented against the new Postgres client's idle-timeout error shape).

**Why it happens:** "SQLite driver" undersells the actual surface — this file is the single seam for *all* SQL access, both engines, both sync and async execution models, plus WAL pragma management (`database-operations.ts:102-116` — `PRAGMA journal_mode = WAL` with a DELETE-mode fallback on failure) and checkpoint tuning (`:166`).

**How to avoid:** Scope this as two parallel driver-replacement workstreams behind the same adapter interface: (1) SQLite → `better-sqlite3` (synchronous, matches the existing sync-call-site expectations — see Pitfall 8 for why not `node:sqlite`), preserving the existing WAL-with-DELETE-fallback pragma logic verbatim; (2) Postgres → `pg` (with a connection pool) or `postgres.js`, re-implementing the idle-timeout and error-code handling against the new client's actual error shapes (don't assume `ERR_POSTGRES_IDLE_TIMEOUT` is a `pg`/`postgres.js` error code — verify against the chosen library's docs). Keep `DatabaseOperations`'s public method signatures unchanged so the ~15 consuming packages don't need touching (per `CLAUDE.md`'s migration-porting rule, this must also be mirrored in `migrations.ts`/`migrations-pg.ts`).

**Warning signs:** A PR titled "swap bun:sqlite for better-sqlite3" that doesn't also touch the Postgres path — it's incomplete by definition; WAL mode silently falling back to DELETE mode after the swap because the new driver's pragma-query result shape differs from `bun:sqlite`'s (`db.query("PRAGMA journal_mode = WAL").get()` result shape is driver-specific).

**Phase to address:** SQLite/database-driver migration phase — scope explicitly as "SQLite driver + Postgres driver," not "SQLite driver."

---

### Pitfall 8: `node:sqlite` is still experimental on the Node 24 floor — don't ship it in production; `better-sqlite3` requires native compilation, which breaks the current zero-native-build-step CI/Docker/binary pipeline

**What goes wrong:** `node:sqlite` looks attractive (zero dependencies, built into Node, syntactically close to `bun:sqlite`). But on Node 24, `node:sqlite` carries Stability 1.1 ("Active development") — still experimental, not recommended for production reliance (it reached Release Candidate only in Node 25.7, after the locked Node 24 floor). Using it anyway means shipping an experimental core module in a production billing/proxy system with no upgrade path guarantee before Node 24's EOL. The alternative, `better-sqlite3`, is a native addon requiring `node-gyp`/prebuilt binaries — a **fundamentally different distribution model** than today's Bun setup, which ships zero native compilation (Bun's `bun:sqlite` is built into the Bun binary itself). This has three concrete downstream impacts specific to this project: (a) GitHub Actions CI (`release.yml`, `signpath-test.yml`) currently runs a single `ubuntu-latest` job that cross-compiles all 5 platform binaries via `bun build --compile --target=bun-<platform>` in one job — a native addon cannot be cross-compiled this way and needs either prebuilt binaries per platform/arch (via `prebuild-install`/`node-gyp-build`) or a build matrix across real target runners; (b) the Docker image (`Dockerfile`, `debian:bookworm-slim`) currently just downloads a prebuilt static binary with `curl` and has zero build tooling installed — adding `better-sqlite3` means either bundling a prebuilt `.node` binary for `linux/amd64` + `linux/arm64` (matches the existing `docker-publish.yml` multi-arch matrix) or installing `build-essential`/`python3` in the image, bloating it; (c) if the standalone CLI binary path moves to Node SEA (Pitfall 9), native addons in SEA have a **known broken combination**: SEA binaries produced on Linux arm64 inside a Docker container do not have the correct ELF hash table to `dlopen()` native addons — this directly collides with `docker-publish.yml`'s `platforms: linux/amd64,linux/arm64` Docker Buildx matrix, which builds arm64 inside containers via QEMU.

**Why it happens:** "It's built into Node, so it must be the simple choice" undersells (a) its experimental-stability status on the locked Node version, and (b) the fact that Bun's zero-native-build-step story was a genuine, load-bearing simplification of the current release pipeline that a native-addon SQLite driver directly reverses.

**How to avoid:** Use `better-sqlite3` for the production path (synchronous API, mature, widely used with prebuilt binaries covering all 5 target platforms via `prebuild-install`), and treat "native addon in the release pipeline" as its own explicit sub-task: verify prebuilt binaries exist for every target (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`) before committing to it, add an explicit `npm rebuild`/prebuild-fetch CI step, and build the Linux arm64 Docker/SEA combination on a **native arm64 runner** (not QEMU-emulated) if SEA + native addon is pursued, or avoid SEA for arm64 Docker entirely (see Pitfall 9). Do not use `node:sqlite` for anything on the production write path while it remains below Stability 2 (Stable) on the project's Node floor; it's acceptable for throwaway dev tooling/scripts only, if at all.

**Warning signs:** `node:sqlite` import triggering an `ExperimentalWarning` at runtime in production logs; `better-sqlite3` install failing on CI with `node-gyp` errors (missing Python/build tools) or with "no prebuilt binary" errors on an architecture the release matrix targets; Docker arm64 image crashing on `dlopen` if SEA + native addon + QEMU-built-arm64 is attempted.

**Phase to address:** SQLite driver migration phase (driver choice), with explicit cross-checks against the CI/release phase — don't finalize the driver choice without confirming the release pipeline can actually produce working binaries for it on every target platform.

---

### Pitfall 9: Standalone CLI binary distribution has no like-for-like Node equivalent — SEA requires per-platform builds (breaks the existing single-job 5-binary matrix), and abandoning it breaks existing users' install/invocation patterns

**What goes wrong:** Today, `apps/cli/package.json`'s `build:linux-amd64`/`build:linux-arm64`/`build:macos-x86_64`/`build:macos-arm64`/`build:windows-x64` scripts all cross-compile from a **single** `bun build --compile --target=bun-<platform>` invocation on one `ubuntu-latest` runner (verified: `release.yml` — one job, `bun run build:multi`, uploads all 5 binaries). Node's Single Executable Applications (SEA) feature has no equivalent cross-compilation story: code cache/snapshot data embedded in a SEA binary is only valid on the platform it was generated on, and cross-platform SEA generation requires disabling `useCodeCache`/`useSnapshot` (losing the startup-perf benefit) — the practical, supported path is building on (or in a container matching) each target OS/arch, i.e. converting the existing single-job build into a GitHub Actions **matrix** across `ubuntu-latest`/`macos-latest`/`windows-latest` runners (plus arm64 variants), a real CI restructuring, not a drop-in script change. SEA also complicates or blocks: (a) native addons (Pitfall 8) — bundling `.node` files as SEA assets requires writing them to a temp file and `process.dlopen()`-ing manually, and the Linux-arm64-in-Docker ELF hash-table bug applies directly to this project's `docker-publish.yml` arm64 build; (b) the existing `signpath-test.yml` workflow, which submits the *Bun-compiled* Windows `.exe` for test-signing — a SEA-produced Windows executable is a modified copy of `node.exe` with an injected resource; verify SignPath's `artifact-configuration-slug: 'release'` policy still accepts it (icon/version-info metadata differs from Bun's compiled output) before assuming the signing pipeline needs no changes. Separately, if the team instead **abandons** standalone-binary distribution (switching to "install Node, then `npm install -g better-ccflare`, then run `better-ccflare`"), that's also a breaking change for existing users who `wget`/`curl` a self-contained binary today and expect zero Node dependency (per the README's install instructions, which explicitly market unsigned, no-runtime-dependency binaries with an `xattr` Gatekeeper workaround) — this needs an explicit compatibility/communication decision, not a silent drop.

**Why it happens:** SEA is Node's newest, least mature packaging feature (still iterating rapidly — e.g., `--build-sea` one-step builds landed only in Node 25.5, after this project's Node 24 floor) and was designed primarily for single-platform CI-native builds, not the cross-compile-from-one-runner workflow Bun enabled.

**How to avoid:** Decide explicitly, early, whether to (a) adopt Node SEA with a full matrix-build CI restructuring (budget real time for this — it's not a 1:1 script swap), accepting the native-addon/arm64-Docker caveats and testing the SignPath step against a real SEA-produced `.exe` before merging; or (b) drop standalone binaries and publish `better-ccflare` as an npm-installed Node CLI only, with a clearly communicated breaking-change migration note for existing binary users (update README install instructions, keep the old binary release available one more cycle, consider a `npx better-ccflare` fallback). Whichever is chosen, do it as its own dedicated late-stage phase — it depends on the build-step decision (Pitfall 2) and the native-addon decision (Pitfall 8) both being settled first.

**Warning signs:** A single-runner CI job attempting `--target linux-arm64` equivalent under Node SEA with no target-OS validation; SEA binary crashing on startup on a platform different from where it was built (code-cache mismatch); SignPath rejecting a SEA-produced executable's artifact format.

**Phase to address:** Late — this is a polish/distribution phase, but it has hard dependencies on the build-step (Pitfall 2) and native-addon (Pitfall 8) decisions, so don't schedule it until those land. It should not be a "final phase surprise" — flag the CI-matrix-restructuring cost early in planning even though the work happens late.

---

### Pitfall 10: Node's HTTP server has no single `.stop()`/`idleTimeout` knob — graceful shutdown and long-lived SSE connections need several coordinated settings that don't map 1:1 from Bun

**What goes wrong:** Today, `server.ts` sets `idleTimeout: NETWORK.IDLE_TIMEOUT_MAX` where that constant is hard-coded to `255` with the comment "Max allowed by Bun" (verified: `packages/core/src/constants.ts:141`) — `Bun.serve()`'s `idleTimeout` field is capped at 255 seconds (a `uint8`), and this project already pushes it to the max specifically to keep long SSE streams alive. Node has **no equivalent single field** — instead it exposes `server.keepAliveTimeout` (idle-socket-reuse timeout, small default), `server.headersTimeout`, `server.requestTimeout`, and plain socket `.setTimeout()`, each governing a different phase of the request lifecycle, none capped at 255s but none defaulting anywhere near it either (Node's default `keepAliveTimeout` is very short — around 1s in recent docs, previously ~5s in older versions — either way, far shorter than the streaming windows this app relies on). A naive migration that doesn't explicitly configure all the relevant Node timeout knobs will see idle-keep-alive connections or long SSE streams cut off much earlier than today's Bun behavior. Separately, graceful shutdown: `handleGracefulShutdown()` (`server.ts:1635-1741`) calls `serverInstance.stop()` and relies on a 30s watchdog to force-exit if drain takes too long (`SHUTDOWN_WATCHDOG_MS`, `:1627`). Node's `http.Server#close()` **does not forcibly close idle keep-alive connections** — it stops accepting new connections but waits indefinitely for existing sockets to close on their own, which can hang shutdown well past the 30s watchdog unless `server.closeAllConnections()` (or per-socket tracking + explicit `.destroy()`) is called for connections that aren't actively mid-response. (Node 19+ improved this somewhat, but explicit verification against the target Node 24 behavior under a real SSE-streaming workload is still warranted — don't assume default behavior alone is sufficient.)

**Why it happens:** Bun deliberately collapsed several historically separate Node HTTP-server tuning knobs into one `idleTimeout` field; Node's finer-grained model is more powerful but requires deliberate configuration to reproduce Bun's effective behavior, especially for a proxy whose entire value proposition includes long-lived SSE passthrough.

**How to avoid:** When building the Fetch-to-Node HTTP adapter (Pitfall 1), explicitly set `server.keepAliveTimeout`, `server.headersTimeout` (must be `> keepAliveTimeout`), and consider `server.requestTimeout = 0` (disable) for streaming routes so long SSE responses aren't killed mid-stream — verify Node's `requestTimeout` semantics against the exact Node 24 docs before relying on defaults. For shutdown, call `server.closeAllConnections()` (or track sockets and `.destroy()` idle ones) inside `handleGracefulShutdown()` so the existing 30s watchdog is a true fallback, not the primary drain mechanism. Write an integration test that opens a long-lived SSE connection, sends SIGTERM, and asserts the in-flight stream is allowed to finish (or is cleanly terminated) within the watchdog window.

**Warning signs:** SSE connections dropping after a much shorter idle period than before; `handleGracefulShutdown()` routinely hitting the 30s watchdog force-exit (`process.exit(0)` at `:1653`) instead of completing cleanly, once keep-alive clients are in the mix.

**Phase to address:** HTTP server migration phase — test explicitly against SSE streaming and SIGTERM-during-active-stream scenarios as an exit criterion for that phase, not deferred to a later "polish" pass.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Ship `node:sqlite` "temporarily" to unblock the SQLite migration phase, planning to swap to `better-sqlite3` "later" | Avoids the native-compilation/CI-matrix work up front | Ships an experimental core module on the production billing/proxy write path; "later" tends to never happen once it works | Never for the production path; acceptable only in a throwaway dev script that never touches the real DB |
| Rewrite Bun's `enum`s to `const` objects instead of adding a real compile step, to avoid touching the build pipeline | Fast, no new tooling | Any future contributor reintroducing `enum`/`namespace`/decorators silently breaks `node <file>.ts` execution with no type-level guard, only a runtime crash | Only combined with an enforced lint rule forbidding non-erasable TS constructs, and only if the team is committed to permanently running raw `.ts` (no build step) |
| Leave `Bun.sleepSync`'s `spawnSync` fallback in place "since tests still pass" | No code change needed right now | Silently activates the moment Bun is gone; directly compounds the open `stalled-streaming-requests` bug (see Pitfall 6) | Never — this one is not a legitimate shortcut, it's a live landmine |
| Keep the single-job, `ubuntu-latest`-only CI build for standalone binaries and hope Node SEA "just cross-compiles like Bun did" | Avoids a CI matrix rewrite | Produces binaries that crash on startup on other platforms due to code-cache/snapshot platform-mismatch | Never for release binaries; only acceptable for local dev/test SEA experiments on the developer's own platform |
| Use `Atomics.wait` busy-block sleeps liberally elsewhere in the codebase once introduced for the retry-backoff fix | Simple, avoids reintroducing `spawnSync` | Blocks the calling thread — fine for the narrow synchronous-DB-retry use case, actively harmful if copy-pasted into any request-handling code path | Only inside code that is *already* synchronous and off the main request-handling hot path (e.g. the sync DB retry helper itself) |

## Integration Gotchas

Common mistakes when connecting to external services/tooling during this migration.

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| GitHub Actions (`release.yml`, `docker-publish.yml`, `signpath-test.yml`) | Assuming `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` steps can be swapped 1:1 for `actions/setup-node@v4` + `npm ci` without touching the surrounding build-matrix structure | Every workflow using `bun run build:multi`/`bun run build:dashboard` needs its downstream steps re-audited: single-job cross-compile becomes a real matrix (Pitfall 9); `npm ci` requires a committed `package-lock.json`, which doesn't exist yet under Bun |
| SignPath (`signpath-test.yml`) | Assuming the Windows signing policy configured for a Bun-compiled `.exe` accepts a Node-SEA-produced `.exe` with no changes | Run a test-signing submission against a real SEA-built `.exe` before removing the Bun-built path from CI; check icon/version-resource metadata parity |
| Docker (`Dockerfile`, `docker-publish.yml`) | Keeping the "download prebuilt binary via curl, zero build tooling in the image" pattern while switching to a native-addon SQLite driver | Either bundle prebuilt `.node` binaries matching the image's `TARGETARCH`, or add build tooling (`build-essential`, `python3`) to the image — decide and document which, since the current image has neither |
| `pre-push` hook auto-updating `CLAUDE_CLI_VERSION` in `packages/core/src/version.ts` | Assuming the hook script doesn't shell out to `bun` directly for version parsing or file writes | Audit the actual hook script content for any `bun`-specific invocation before the migration is "complete" (not directly inspectable via a tracked path in this research pass — re-verify locally); a hook that silently no-ops under `node` would let a release ship with a stale `CLAUDE_CLI_VERSION` |
| npm registry publish (`apps/cli/package.json` `prepublishOnly`/`postpublish`) | Assuming `bun run --cwd ../.. build:dashboard && bun run build` inside `prepublishOnly` keeps working unmodified once root scripts move off `bun run` | Update every cross-package script invocation (`bun run --cwd`, `bun -e "..."` inline JS snippets used to conditionally stub inline-worker files) to their npm-script equivalents; the `bun -e` one-liners in `apps/cli/package.json`'s `build` script are Bun-runtime JS execution, not shell — they need a `node -e` (verify syntax compatibility) or a small script file replacement |
| `@dqbd/tiktoken` WASM resolution in workspace `node_modules` | Assuming npm's node_modules layout resolves the WASM file the same way Bun's did | `release.yml` *already* has defensive troubleshooting steps checking multiple `node_modules` locations for `tiktoken_bg.wasm` because Bun's workspace linking already made this fragile — npm's (typically flatter, but not always, depending on hoisting/peer conflicts) `node_modules` layout needs the same verification redone from scratch, don't assume it "just resolves" |
| `@dqbd/tiktoken` WASM instantiation (`packages/proxy/src/usage-extraction.ts` imports `Tiktoken` from `@dqbd/tiktoken/lite/init`) | Assuming Bun's and Node's WebAssembly instantiation of the same base64/buffer-sourced `.wasm` behave identically | Both runtimes implement standard `WebAssembly.instantiate`, so the wasm bytes themselves aren't the risk — the risk is path/URL resolution feeding the loader (`import.meta.url`-relative asset resolution differs between Bun's bundler and a Node+npm layout); test the tiktoken encoder initialization explicitly under Node after the package-manager swap, don't assume "it's just WASM, it'll work" |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| `spawnSync`-based blocking sleep on the SQLite retry path (Pitfall 6) | Periodic multi-request latency spikes that correlate with DB contention, worse under concurrent load | Replace with `Atomics.wait` on a `SharedArrayBuffer` before Bun is fully removed | Immediately once `typeof Bun !== "undefined"` becomes false — not a gradual scale issue, a step-function regression |
| Node SEA cross-platform builds with code cache/snapshot disabled (to work around the platform-mismatch bug) | Noticeably slower CLI startup time compared to Bun's compiled binaries or to a same-platform SEA build | Build SEA binaries natively on each target platform/arch (matrix CI) rather than disabling code cache to fake cross-compilation | Any release built cross-platform without a proper per-target build step |
| Native-addon (`better-sqlite3`) prebuild fetch failing silently and falling back to a from-source `node-gyp` compile at `npm install` time on end-user machines (if published to npm and installed via `npm install -g`) | First-run install taking minutes instead of seconds on platforms without a matching prebuilt binary; install failures on machines lacking build tools | Verify `prebuild-install` coverage for every officially supported platform/arch before shipping; document a `node-gyp` prerequisite fallback for unsupported ones | Whenever a new OS/arch combination is supported without also adding a corresponding prebuilt binary |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Bundling a native addon (`better-sqlite3`) into a Node SEA binary via manual `process.dlopen()` from a temp file | Arbitrary native code execution surface if the temp-file write/dlopen path is ever influenced by untrusted input or a compromised build artifact; also a supply-chain risk if prebuilt binaries aren't checksum-verified | Pin `better-sqlite3` to an exact version, verify prebuilt binary checksums/provenance during CI, and avoid loading addons from user-writable paths |
| Publishing a plain `npm install -g better-ccflare` CLI (if standalone binaries are dropped) without re-auditing what gets pulled into `node_modules` at install time | A Bun-compiled binary has a fixed, audited dependency graph baked in at build time; an npm-installed CLI re-resolves the full dependency tree (including transitive deps) on every user's machine at install time, widening the supply-chain attack surface | If dropping standalone binaries, pin exact dependency versions (or use `npm ci`-equivalent guarantees) and keep the existing OAuth/credential-handling code paths under the same security review bar as before |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Silently dropping standalone-binary releases in favor of "just `npm install -g`" | Existing users following the README's `wget .../better-ccflare-linux-amd64 && chmod +x ... && ./...` instructions hit 404s on new releases with no warning | If distribution model changes, ship at least one overlapping release with both paths, update the README's install section explicitly, and consider a deprecation notice printed by the last Bun-binary release pointing users to the new install method |
| Node SEA binary produced without matching the exact Node version/ABI of the target environment | Confusing native-module ABI-mismatch crashes for users on slightly different Node patch versions if a native addon is involved | Keep the native addon's prebuilt binaries and the SEA's embedded Node version in lockstep; test the final SEA artifact on a clean VM per target platform before release, not just "it built successfully" |

## "Looks Done But Isn't" Checklist

- [ ] **HTTP server migration:** Often missing explicit `keepAliveTimeout`/`headersTimeout`/`requestTimeout` tuning — verify a long-lived SSE stream survives past Node's short default keep-alive window, not just that a basic `curl` request succeeds.
- [ ] **Graceful shutdown:** Often missing `server.closeAllConnections()` (or equivalent idle-socket cleanup) — verify SIGTERM during an active SSE stream completes within the shutdown watchdog window under real load, not just on an idle server.
- [ ] **Worker-thread migration:** Often missing verification that the `ready → ack → summary → shutdown-complete` message protocol actually round-trips end-to-end — a worker that "starts without throwing" is not the same as a worker whose message handlers are correctly wired (Pitfall 4's silent-failure mode).
- [ ] **SQLite driver swap:** Often missing a check that WAL mode is *actually* enabled after the swap (`PRAGMA journal_mode` result), not just that queries succeed — the existing code already has a silent DELETE-mode fallback path (`database-operations.ts:110-116`) that will mask a broken WAL config as "working."
- [ ] **Standalone binary / SEA:** Often missing a clean-VM smoke test per target platform — "the build step exits 0" is not the same as "the binary runs on a machine that never had Node/Bun installed."
- [ ] **Test runner migration:** Often missing verification that `mock.module()`/module-namespace `spyOn()` usages (7+ files, confirmed via grep across `packages/http-api`, `packages/oauth-flow`, `packages/providers/src/providers/bedrock`, `packages/proxy`) were re-implemented with equivalent isolation, not just "the test file compiles" — a mock that silently no-ops (e.g. because the new runner doesn't intercept the same import graph) can make a test pass for the wrong reason.
- [ ] **Package manager swap:** Often missing verification that `npm install` in CI (fresh, no cache) actually resolves every `workspace:*` → `"*"`-rewritten package before assuming the swap is complete — a locally-cached `node_modules` can mask a broken lockfile.
- [ ] **Release automation:** Often missing an audit of the pre-push hook's actual script content for `bun`-specific shell-outs — this file wasn't inspectable via a tracked path in this research pass; explicitly re-verify it during the CI/release phase.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Discover mid-phase that `enum` usage blocks Node's native type-stripping (Pitfall 2) | LOW | Add a compile step (`esbuild`/`tsc`) scoped to just the affected packages first, expand incrementally — doesn't require re-doing already-migrated packages |
| `npm install` fails on `workspace:*` after the package-manager swap commit (Pitfall 3) | LOW | Scripted bulk find-and-replace across all `package.json` files (`"workspace:*"` → `"*"`), single commit, re-run install |
| Usage/billing worker silently stops recording after the worker-threads migration (Pitfall 4) | HIGH | Cross-check `requests.cost_usd`/usage columns for a gap window against known traffic; revert to the last-known-good worker controller commit; re-apply the event-wiring fix with the round-trip integration test added *first* this time |
| SSE streams dropping early after the HTTP server migration (Pitfall 10) | MEDIUM | Add explicit `keepAliveTimeout`/`headersTimeout` overrides and redeploy; this is a config-only fix once diagnosed, no data loss, but requires a redeploy cycle to confirm |
| Native-addon SQLite driver fails to load on a supported platform post-release (Pitfall 8) | MEDIUM-HIGH | Ship a patch release pinning a working prebuilt-binary version, or fall back that platform to `node:sqlite` temporarily (accepting its experimental-status risk) while a proper prebuilt is sourced — communicate the temporary downgrade explicitly in release notes |
| Node SEA binary crashes on startup on a platform it wasn't built on (Pitfall 9) | MEDIUM | Rebuild via a proper per-platform CI matrix job instead of cross-compiling from one runner; no code changes needed, purely a CI-pipeline fix |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| No Fetch-API-to-Node HTTP adapter decided up front (Pitfall 1) | Foundational — HTTP server migration phase design step | `router.ts` handler signatures remain `(req: Request, url: URL) => Response` unchanged after migration; only `server.ts` (+ new adapter file) differs |
| No build step / non-erasable TS (`enum`) (Pitfall 2) | Foundational — Phase 1, alongside package manager swap | `node <compiled-or-stripped-entrypoint>` runs without `SyntaxError`/`ERR_UNKNOWN_FILE_EXTENSION` for every package, in CI, not just locally |
| `workspace:*` incompatible with npm (Pitfall 3) | Foundational — Phase 1, package manager swap | Fresh-clone `npm install` (no cache) succeeds and resolves all `@better-ccflare/*` as workspace symlinks |
| Worker event-API mismatch (Pitfall 4) | Worker-threads migration phase | Integration test asserts full `ready→ack→summary→shutdown-complete` round trip for the usage-collector worker |
| Blob-URL worker construction unsupported (Pitfall 5) | Worker-threads migration phase (same phase as #4) | All three embedded-worker call sites (usage worker, vacuum worker, integrity-check worker) construct successfully via `{ eval: true }` |
| `spawnSync` blocking-sleep landmine (Pitfall 6) | SQLite/database driver migration phase | Regression test proves `sleepSync()` never spawns a child process; load test shows no latency-spike correlation with DB retry backoff |
| Dual SQLite+Postgres driver split (Pitfall 7) | SQLite/database driver migration phase | Both sync SQLite and async Postgres paths independently pass their existing test suites; WAL-with-fallback and idle-timeout-handling logic both re-verified against the new drivers |
| `node:sqlite` experimental / native-addon CI fallout (Pitfall 8) | SQLite driver migration phase, cross-checked against CI/release phase | Production driver choice documented with an explicit stability-tier justification; CI produces working `better-sqlite3` (or chosen driver) binaries for all 5 target platforms before merge |
| Standalone binary / SEA cross-platform + native-addon interplay (Pitfall 9) | Late — CLI packaging/distribution phase, but flagged early in planning | Every target-platform binary smoke-tested on a clean VM; SignPath test-signing re-validated against the new binary format |
| HTTP timeout-knob / graceful-shutdown gaps (Pitfall 10) | HTTP server migration phase | SIGTERM-during-active-SSE-stream integration test passes without hitting the 30s force-exit watchdog under normal conditions |
| bun:test whole-module mocking has no stable `node:test` equivalent | Test-runner migration phase | Every file using `mock.module()`/module-namespace `spyOn()` (7+ files) re-verified to actually intercept the mocked import, not just "compiles and runs" |

## Sources

- Direct codebase inspection (HIGH confidence, this research session): `apps/server/src/server.ts`, `packages/http-api/src/router.ts`, `packages/proxy/src/proxy.ts`, `packages/proxy/src/usage-worker-controller.ts`, `packages/proxy/src/post-processor.worker.ts`, `packages/proxy/src/usage-extraction.ts`, `packages/database/src/adapters/bun-sql-adapter.ts`, `packages/database/src/database-operations.ts`, `packages/database/src/retry.ts`, `packages/database/src/integrity-check-runner.ts`, `packages/core/src/constants.ts`, `packages/logger/src/index.ts`, `packages/types/src/conversation.ts`, `packages/types/src/strategy.ts`, `tsconfig.json`, `package.json` (root + all workspace packages), `apps/cli/package.json`, `.github/workflows/release.yml`, `.github/workflows/docker-publish.yml`, `.github/workflows/signpath-test.yml`, `Dockerfile`
- [Node.js SQLite docs (v24.15.0)](https://beta.docs.nodejs.org/sqlite.html) — Stability 1.1 in Node 24, RC only from Node 25.7
- [nodejs/node issue #57445 — stabilization of node:sqlite module](https://github.com/nodejs/node/issues/57445)
- [Node.js Test runner docs (v26.5.0)](https://nodejs.org/api/test.html) — `--experimental-test-module-mocks` status
- [nodejs/node issue #55891 — --experimental-test-module-mocks not working as expected](https://github.com/nodejs/node/issues/55891)
- [nodejs/node issue #59163 — experimental-test-module-mocks with ES imports does not reset mocked modules](https://github.com/nodejs/node/issues/59163)
- [Node.js Single Executable Applications docs (v26.5.0 / v24.15.0)](https://nodejs.org/api/single-executable-applications.html) — native addon and cross-platform code-cache limitations
- [nodejs/help issue #5129 — Best practice for Node SEA with ESM-only CLI, Workers, and native addons](https://github.com/nodejs/help/issues/5129)
- [nodejs/single-executable issue #94 — REQUEST: Support for cross-platform SEA generation](https://github.com/nodejs/single-executable/issues/94)
- [Node.js worker_threads docs (v24.15.0 / v26.5.0)](https://nodejs.org/api/worker_threads.html) — Blob/eval/data-URL Worker source support
- [Node.js HTTP docs (v26.5.0)](https://nodejs.org/api/http.html) — `keepAliveTimeout`, `closeAllConnections()`
- [nodejs/node issue #60617 — Support draining of keep-alive connections on http.Server.close()](https://github.com/nodejs/node/issues/60617)
- [nodejs/node-v0.x-archive issue #9066 / nodejs/node issue #2642 — http server close() doesn't end keep-alive connections](https://github.com/nodejs/node-v0.x-archive/issues/9066)
- [npm/cli issue #8845 — workspace: protocol documented but throws EUNSUPPORTEDPROTOCOL](https://github.com/npm/cli/issues/8845)

---
*Pitfalls research for: Bun-to-Node.js runtime migration, better-ccflare*
*Researched: 2026-07-17*
