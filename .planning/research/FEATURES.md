# Feature Research

**Domain:** Runtime migration (Bun → Node.js) for a long-running HTTP proxy server with SSE streaming, SQLite/Postgres persistence, worker threads, and a CLI binary
**Researched:** 2026-07-17
**Confidence:** MEDIUM-HIGH (Node core APIs and LTS status verified via current docs/search; codebase-specific findings verified by direct code inspection; some ecosystem "best tool" claims are MEDIUM confidence — vendor blog consensus, not benchmarked ourselves)

> Supersedes the prior FEATURES.md (v1.3 OpenRouter Anthropic Messages Provider research, 2026-06-02) — that content belonged to a completed milestone and is no longer relevant to the current v100.0 Bun-to-Node.js migration milestone.

## Codebase Bun-Surface Inventory (verified by direct inspection, 2026-07-17)

This is not generic ecosystem research — it's grounded in what this specific repo actually uses. Confirmed Bun-specific call sites that must be replaced:

| Bun API | Location | Replacement target |
|---|---|---|
| `Bun.serve()` | `apps/server/src/server.ts` | `node:http` (`http.createServer`) or a thin framework — see Anti-Features |
| `Bun.file()`, `Bun.resolveSync()` | `apps/server/src/server.ts` (dashboard static asset serving) | `node:fs` (`fs.readFile`/streams) + `require.resolve`/`import.meta.resolve` |
| `bun:sqlite` (`Database` type) | `packages/database/src/adapters/bun-sql-adapter.ts` | `node:sqlite` or `better-sqlite3` — see Table Stakes #4 |
| `Bun` `SQL` (Postgres) | same file | `postgres` (porsager) or `pg` — see Table Stakes #4 |
| `Bun.sleepSync` | `packages/database/src/retry.ts` (already has a Node.js child_process fallback path in comments — partial groundwork exists) | Node has no sync-sleep primitive; needs `Atomics.wait` on a `SharedArrayBuffer` or restructure to async |
| `Bun.file(...).text()` | `packages/logger/src/file-writer.ts` | `fs.promises.readFile(path, "utf8")` |
| `new Worker(url, { smol: true })`, `URL.createObjectURL(blob)` for inline worker code | `packages/proxy/src/usage-worker-controller.ts`, `packages/database/src/integrity-check-runner.ts`, `packages/database/src/database-operations.ts` | `node:worker_threads` `Worker` — no `smol` option (Bun-only); inline code needs `eval: true` + string source instead of `Blob`/`ObjectURL` |
| `postMessage(msg, [ArrayBuffer])` transfer-list pattern | `usage-worker-controller.ts`, `post-processor.worker.ts` | `worker_threads` supports the identical transferList contract — **this one ports near 1:1**, see Q4 findings |
| `bun build --compile --target=bun-*` (5 OS/arch targets) | `apps/cli/package.json` build scripts, `.github/workflows/release.yml` | Node SEA (`--build-sea`, Node 24) — no cross-compilation; needs a build matrix, see Table Stakes #6 |
| `bunx tsc`, `bunx biome`, `bun test` | root `package.json` scripts | `npx`/direct binary invocation; `node --test` or Vitest — see Table Stakes #3 |
| `oven-sh/setup-bun@v2`, `bun install --frozen-lockfile` | `.github/workflows/release.yml` | `actions/setup-node@v5` + `npm ci` |
| `workspaces: ["apps/*", "packages/*"]` in root `package.json` | already npm-compatible syntax | No structural change — see Table Stakes #1 |
| `@dqbd/tiktoken/lite/init` type-only import | `packages/proxy/src/usage-extraction.ts` | **No live runtime `Tiktoken` instantiation found anywhere in the codebase** (grepped for `encoding_for_model`, `get_encoding`, `new Tiktoken(`) — the worker file explicitly documents "NO tiktoken: this worker does not import @dqbd/tiktoken." This dependency appears currently dormant/type-only. Treat WASM-loading-under-Node as a verify-not-assume item, not a confirmed blocker (see Q4). |

## Feature Landscape

### Table Stakes (Migration Must-Haves — Parity Checklist)

These are non-negotiable. If any is missing, the migration is not "done" — it's a broken deploy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| 1. npm workspaces replace `bun.lock`/Bun workspaces | Everything downstream (install, CI, Docker, CLI publish) depends on install working under `npm ci` | LOW | Root `package.json` already uses the `workspaces` array — same syntax npm/Yarn/Bun share. Real work is regenerating `package-lock.json`, removing `bun.lock`, and auditing every `bunx`/`bun run --cwd`/`bun -e` invocation in package.json scripts (found in `apps/cli/package.json` build script — heavy Bun-specific inline scripting). |
| 2. `Bun.serve()` → Node HTTP server with byte-identical SSE passthrough | Core function of the app: proxy request/response streaming for Claude's SSE responses. Any regression here breaks the product. | HIGH | Node's `http.createServer` + manual `ReadableStream`/Node stream bridging for the fetch-based upstream calls. Known risk: Bun's idle-timeout-closes-SSE-connections behavior differs from Node's — Node's `http.Server` has its own `keepAliveTimeout`/`headersTimeout`/`requestTimeout` defaults that must be explicitly tuned to not kill long-idle SSE streams (see Q4). Also must decide: raw `node:http`, or `undici`'s `fetch`-compatible layer for upstream calls (Node's global `fetch` since Node 18 is undici-based and Bun's is JSC-based — different implementations, see Q4). |
| 3. `bun:test` suite passes under new runner | "Large existing suite" per milestone context — regression safety net must not be lost mid-migration | MEDIUM-HIGH | Two real options: `node:test` (zero dependency, stable since Node 18, Jest-*like* `describe/it` since Node 20) or Vitest (richer mocking/spies, closer to `bun:test`'s Jest-compatible API, needs `vite` as a transitive dependency). `bun:test` mocking APIs (`mock()`, `spyOn()`, `mock.module()`) do not have 1:1 equivalents in `node:test` — expect nontrivial rewrite of any test file using Bun-specific mocking, not just an import swap. |
| 4. SQLite driver ports with WAL mode intact, zero data loss; Postgres driver ports with pooling/timeout parity | `bun-sql-adapter.ts` is the single chokepoint for both SQLite and Postgres — its placeholder-conversion logic (`?`/`?N` → `$N`) and timeout-guard comments (`withPgTimeout`, `statement_timeout` coordination) encode real production incident learnings that must not be silently dropped | HIGH | SQLite: `node:sqlite` is a serious built-in option (zero native compile, but experimental in Node 22, said to fully stabilize in Node 26 — **verify exact stabilization version against Node 24 floor before committing**, since Node 24 predates that). Fallback: `better-sqlite3` (mature, sync API closest to `bun:sqlite`, but requires native compilation via `node-gyp` — reintroduces the exact "native addon breaks on CI/Alpine" risk this migration should avoid, given the project also ships in Docker). Postgres: `postgres` (porsager, all-JS, closest to Bun's `SQL` template-tag ergonomics) or `pg` (most battle-tested, callback/pool-based, different API shape requiring more adapter rewrite). |
| 5. Worker threads preserve transferable-ArrayBuffer zero-copy semantics | `usage-worker-controller.ts` explicitly documents a "TRANSFER CONTRACT" for the hot-path usage-collector worker — if messages fall back to structured-clone copy instead of transfer, correctness may hold but hot-path performance regresses | MEDIUM | `node:worker_threads` supports the identical `postMessage(msg, transferList)` contract — ArrayBuffer transfer semantics (ownership moves, buffer unusable on sender side after transfer) are the same Web-standard behavior in both runtimes. Real porting work is replacing Bun's `smol: true` (no Node equivalent — drop it, verify memory footprint) and replacing `URL.createObjectURL(blob)` inline-worker instantiation (Bun-only DOM API) with `worker_threads`'s `eval: true` + source string, or writing the worker to a temp file. The build-time inlining scheme (`inline-worker.ts`, `inline-vacuum-worker.ts`, `inline-integrity-check-worker.ts` as base64-encoded auto-generated files) needs a new bundler step since it's currently produced by `bun build --target=bun`. |
| 6. CLI binary still installable via `npm install -g` / `npx` AND still produces standalone binaries per-platform | `apps/cli` ships both an npm package (`bin` field, `dist/better-ccflare`) and 5 platform-specific standalone binaries (`build:linux-amd64`, `build:linux-arm64`, `build:macos-x86_64`, `build:macos-arm64`, `build:windows-x64`) via `bun build --compile --target=<platform>` | HIGH | Node's SEA (`node:sea`, stable since Node 22, `--build-sea` one-step flag added Node 25.5, improved in Node 24) replaces `bun build --compile` for a *single host platform build*. **Critical gap: Node SEA has no built-in cross-compilation** — Bun could cross-compile for 5 targets from one CI runner; Node SEA requires either building on 5 separate OS/arch runners in the GitHub Actions matrix, or using a third-party cross-build toolchain. This changes the CI topology, not just the build command. |
| 7. Docker image builds and runs on Node base, non-root, same registry | Current image downloads the pre-built Bun-compiled binary into `debian:bookworm-slim`; production continuity requires the equivalent Node artifact | MEDIUM | Straightforward once Table Stakes #6 is solved: swap the binary download step for the Node SEA binary (or ship `node:24-slim`/`node:24-bookworm-slim` as base with `node dist/main.js` if SEA proves too immature — fallback path worth keeping open). Must keep non-root user (`ccflare`, uid 1000) and `/data` volume convention. |
| 8. CI/release automation (GitHub Actions) fully off Bun | `.github/workflows/release.yml` currently uses `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` + `bun run build:multi`; `docker-publish.yml`, `signpath-test.yml` likely have Bun references too | MEDIUM | Swap to `actions/setup-node@v5` + `npm ci`. Must audit every workflow file (found Bun references in `release.yml` at minimum; `docker-publish.yml` and `signpath-test.yml` need auditing — flagged as file-count match in this research, not fully read). |
| 9. Environment variable / `.env` loading behavior preserved | Config parsing lives in `packages/config/src/index.ts`; app relies on `.env` support (per `.env.example`) | LOW-MEDIUM | Bun auto-loads `.env`/`.env.local`/`.env.{NODE_ENV}` with `$VAR` expansion built in. Node 20.6+ has `--env-file` and Node 20.12+/21.7+ has `process.loadEnvFile()`, but **Node's built-in env-file parser does NOT do `$VARIABLE` expansion** — if any existing `.env.example` or docs rely on variable interpolation, this is a silent behavior gap. Existing `dotenv` dependency (already in `apps/cli/package.json`) can be extended with `dotenv-expand` to restore expansion, or continue relying on `dotenv` package rather than Node's native flag for full parity. |
| 10. Graceful shutdown (SIGTERM → drain in-flight requests → exit) preserved | Docker/Kubernetes-style deployments send SIGTERM before SIGKILL; proxy has in-flight SSE streams and a hot-path worker that must flush | MEDIUM | This is actually an *improvement opportunity disguised as parity*: Bun has historically had documented gaps in `process.on("SIGTERM"/"SIGINT")` reliability and no native `server.close()`-equivalent drain method on `Bun.serve()`. Node's `http.Server.close()` + `process.on("SIGTERM")` is the standard, well-documented pattern. Verify current shutdown code (if any) isn't working around a Bun limitation in a way that assumes Bun's signal quirks — that workaround logic may need to be simplified, not just ported. |
| 11. `packages/database/src/retry.ts`'s `Bun.sleepSync` fallback path becomes primary | Comment in the file already shows awareness: "Synchronous sleep using Bun.sleepSync if available, otherwise Node.js fallback" — meaning a Node fallback already exists in some form | LOW-MEDIUM | Node has no built-in sync sleep. Existing code already references a "Node.js child_process fallback" — audit whether that fallback is production-quality (child_process spawn-based sleeps are slow/heavy) or whether `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)` (the standard Node sync-sleep trick) should replace it. |

### Differentiators (Optional Improvements — Defer or Cherry-Pick, Not Blocking)

These are legitimate wins but are NOT required for migration completeness. Bundle only if they don't add risk to the incremental-deployability constraint.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `node:sqlite` over `better-sqlite3` (native-compile-free) | Removes the "native addon breaks on Alpine/CI" class of bug entirely, matches the migration's underlying motivation (reduce vendor/build risk) | MEDIUM | Worth strongly considering specifically *because* this migration's stated motivation is reducing single-vendor/build-fragility risk — reintroducing `node-gyp` native compilation for `better-sqlite3` somewhat undercuts that goal. Gate on verifying `node:sqlite` stability status against the Node 24 floor (search results conflict: "stable since v22.22.0 with warning" vs "fully stabilized in Node 26" — resolve before committing, this is a real open question, not settled). |
| Vitest over `node:test` for the test runner | Closer DX parity to `bun:test` (watch mode, richer `expect`/mock API), less test-file rewrite | MEDIUM | Trades "zero new dependency" (this migration's stated npm-workspaces philosophy: minimize vendor deps) for lower migration labor. Legitimate tradeoff to present to the user, not a foregone conclusion either way. |
| Node SEA's `--build-sea` one-step flow (Node 25.5+) vs multi-step `--experimental-sea-config` + `postject` injection | Simpler build pipeline if the Node floor allows it | LOW | Only relevant if the version floor moves to 25+; at Node 24 floor, the older multi-step SEA flow is required — check exact SEA feature-availability per Node 24.x point release. |
| Consolidating the 3 separate worker-inlining build steps into one shared bundler utility | Reduces duplicated base64-embedding boilerplate across `inline-worker.ts`/`inline-vacuum-worker.ts`/`inline-integrity-check-worker.ts` | LOW-MEDIUM | Nice cleanup opportunity since all 3 need a new (non-`bun build`) bundling mechanism anyway — but only pursue after each worker independently proves parity, to keep the incremental-deployability property intact. |

### Anti-Features (Tempting But Explicitly Out of Scope for THIS Milestone)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Swapping `Bun.serve()` for a full HTTP framework (Express/Fastify/Hono) instead of raw `node:http` | "While we're touching the server, let's get a nicer routing API" | Changes request/response object shapes, middleware model, and error handling throughout `packages/http-api/src/router.ts` and `packages/proxy/src/`. Turns a runtime swap into an architecture change, breaks the "incremental, deployable at every phase" constraint, and multiplies the SSE-parity risk surface (frameworks often wrap streaming in ways that reintroduce buffering bugs) | Port to `node:http` directly, preserving the existing router/handler structure. Framework adoption (if ever wanted) is a separate future milestone with its own research. |
| Changing the SQLite/Postgres schema or `migrations.ts`/`migrations-pg.ts` structure while swapping drivers | "We're already in the adapter file, might as well clean up the schema" | Directly violates the CLAUDE.md-documented migration-porting discipline (every SQLite migration must be mirrored in `migrations-pg.ts`) and the milestone's explicit framing as a like-for-like runtime swap, not a feature change. Schema changes need their own review/testing cycle independent of driver-swap risk. | Port the driver only; keep every `CREATE TABLE`/`ALTER TABLE` statement byte-identical in intent. Schema evolution is separate work. |
| Adding new architectural dependencies beyond what's strictly needed to replace Bun APIs (ORMs, DI framework swaps, new caching layers) | "Since we're rewriting the DB layer anyway..." | Contradicts the locked decision to pick npm workspaces specifically *to minimize vendor dependencies* — adding an ORM or new framework mid-migration reintroduces exactly the vendor-risk-surface-area concern that motivated leaving Bun | Stick to minimal 1:1 replacements: `node:sqlite`/`better-sqlite3` for `bun:sqlite`, `postgres`/`pg` for Bun's `SQL`, `node:worker_threads` for Bun `Worker`. Evaluate architecture changes as separate future milestones. |
| Rewriting the CLI's multi-platform binary build to support new platforms/architectures not currently shipped | "Node SEA setup is a good time to add Linux ARM v7 support" | Scope creep unrelated to the migration goal; also risks masking whether the 5 existing platform targets (`linux-amd64`, `linux-arm64`, `macos-x86_64`, `macos-arm64`, `windows-x64`) even have working parity yet | Match existing platform coverage exactly first. New platform support is a separate, later feature request. |
| Migrating `bun:test` suite to Vitest/`node:test` AND simultaneously rewriting/expanding test coverage | "We're touching every test file anyway, let's add missing tests" | Conflates "does the port preserve existing behavior" with "is coverage adequate" — makes it impossible to tell if a test failure is a runtime-migration regression or a newly-written test catching a pre-existing bug | Port tests 1:1 first (same assertions, same coverage), get the ported suite green under the new runner, THEN treat "add more test coverage" as separate follow-up work. |
| Removing or restructuring the DI container (`packages/core-di`) while touching `database-operations.ts`, `proxy.ts`, etc. for the runtime swap | "The DI wiring touches these same files, natural time to simplify it" | The DI container is orthogonal to which runtime executes the code — conflating it with the migration adds an unrelated architecture-change risk vector to every phase | Leave DI wiring structure untouched; only swap the Bun-API calls inside the wired classes. |
| Using this migration to also resolve the two open debug sessions (`chunk-dropped-worker-stopped`, `stalled-streaming-requests`) as in-scope fixes rather than incidental side effects | Milestone context explicitly notes the migration "may incidentally help" these — tempting to formally fold them in | These are open investigations with unconfirmed root causes (one has 3 unresolved debug cycles, the other has two competing untested hypotheses). Formally scoping them into this milestone means migration "done" criteria become entangled with unresolved bugs, breaking the parity-checklist model (how do you know if a stalled-request fix in the new runtime is a genuine fix vs. Node incidentally not triggering the same Bun-specific bug?) | Keep the migration scoped to parity. If the worker-thread rewrite happens to eliminate `chunk-dropped-worker-stopped`, note it as a bonus finding at milestone close, verified with its own regression test — do not claim it as an intentional deliverable. |

## Feature Dependencies

```
[1. npm workspaces migration]
    └──requires (blocks everything else)──> [8. CI updated to npm/Node]
    └──requires──> [6. CLI binary rebuild pipeline]

[3. Test runner migration]
    └──enables verification of──> [2. HTTP server swap]
    └──enables verification of──> [4. SQLite/Postgres driver swap]
    └──enables verification of──> [5. Worker thread swap]
    (test runner should land EARLY — every subsequent phase needs a working
     regression harness to prove parity before merging)

[2. Bun.serve() → node:http]
    └──requires understanding of──> [Q4: fetch()/ReadableStream differences]
    └──conflicts with──> [Anti-feature: framework swap] (do NOT combine)

[4. SQLite/Postgres driver swap]
    └──requires──> [decision: node:sqlite vs better-sqlite3]
                       └──impacts──> [7. Docker base image] (native compile = build-stage complexity)

[5. Worker thread swap]
    └──requires──> [new build-time inlining mechanism] (replaces `bun build --target=bun`)
    └──enhances──> [11. Bun.sleepSync replacement] (retry.ts touches similar low-level primitives)

[6. CLI binary / Node SEA]
    └──requires──> [1. npm workspaces migration] (install must work first)
    └──conflicts with──> [Bun's single-CI-runner cross-compilation] (Node SEA needs a
                           multi-runner build matrix — CI topology change, not just a command swap)

[7. Docker image]
    └──requires──> [6. CLI binary / Node SEA] (needs the built artifact first)

[8. CI/release automation]
    └──requires──> [1. npm workspaces] AND [3. test runner] AND [6. CLI binary]
    (CI is the last integration point — it can't be finished until the pieces it
     orchestrates are individually working)

[9. Env var handling] ──low coupling, can land any time, but verify BEFORE [2] since
                          server startup config-parsing depends on it
[10. Graceful shutdown] ──depends on── [2. Bun.serve() → node:http]
                          (Node's shutdown pattern is built on http.Server.close(),
                           which doesn't exist until the server itself is ported)
```

### Dependency Notes

- **Test runner (3) should migrate early, not late:** every other phase (server, DB driver, workers) needs a working regression suite in the *target* test runner to prove parity. Migrating tests last means the team is porting the server/DB/workers with no automated safety net, then discovering test-runner-migration bugs *on top of* runtime-migration bugs, unable to tell which layer broke what.
- **Package manager (1) must be first structurally** — it's already flagged as the philosophy-locked decision, and it's also load-bearing: CI, CLI packaging, and even running the (ported) test suite all assume `npm ci` works. This matches the general pattern other teams report ("does install work" gates everything else).
- **HTTP server (2) and DB driver (4) are largely independent of each other** and could be parallelized across phases if the team has capacity, but both are prerequisites for a genuinely "fully deployable" phase boundary (the app needs both a working server AND a working DB to serve a single request).
- **Worker threads (5) has the least behavioral risk** of the four core-runtime items — Node's transferable-ArrayBuffer contract is the same Web-standard mechanism Bun implements, so the `postMessage`/transfer-list code in `usage-worker-controller.ts` and `post-processor.worker.ts` should port with minimal logic changes. The *build tooling* around it (inline base64 embedding, `smol` option removal) is the actual work, not the message-passing semantics.
- **CLI binary (6) conflicts with Bun's cross-compilation convenience:** this is the single biggest structural CI change in the whole migration. Node SEA fundamentally cannot cross-compile from one runner the way `bun build --compile --target=bun-windows-x64` does from a Linux CI box. Budget a GitHub Actions matrix (5 OS/arch runners) as part of this phase, not an afterthought.
- **Docker (7) is downstream of CLI (6):** don't schedule Docker work until there's a working Node SEA binary (or a decision to ship `node:24-slim` + plain `node dist/main.js` as the Docker fallback if SEA proves too fragile for one of the 5 targets).

## MVP Definition (Phase-Boundary Framing)

Since this isn't a product feature MVP but a migration, reframe as "smallest phase that leaves the app deployable":

### Phase 0 (Foundation — must land first)
- [ ] npm workspaces replace Bun workspaces (Table Stakes #1) — unblocks everything else
- [ ] Test runner migrated (`node:test` or Vitest, Table Stakes #3) — provides the safety net for every subsequent phase
- [ ] Env var / `.env` handling parity verified (Table Stakes #9) — cheap, low-risk, unblocks server work

### Phase N (Core Runtime — the bulk of the risk)
- [ ] `Bun.serve()` → `node:http` with SSE parity (Table Stakes #2)
- [ ] Graceful shutdown ported (Table Stakes #10, depends on #2)
- [ ] SQLite/Postgres driver swap (Table Stakes #4) — can run parallel to server work
- [ ] Worker threads ported, transfer-list semantics preserved (Table Stakes #5)
- [ ] `Bun.sleepSync` replacement in `retry.ts` (Table Stakes #11)

### Phase N+1 (Packaging & Delivery — last, depends on all core runtime work)
- [ ] CLI binary via Node SEA, matching existing 5-platform coverage (Table Stakes #6)
- [ ] Docker image on Node base (Table Stakes #7, depends on #6)
- [ ] CI/release automation fully off Bun (Table Stakes #8, depends on #1, #3, #6)

### Explicitly Deferred (Differentiators — separate follow-up decisions, not blocking)
- [ ] `node:sqlite` vs `better-sqlite3` final call — resolve the Node-24-vs-26 stabilization question first
- [ ] Vitest vs `node:test` final call — present as an explicit tradeoff (DX vs dependency count) to the user
- [ ] Consolidating the 3 worker-inlining build steps into shared tooling

## Feature Prioritization Matrix

| Feature | User Value (business-continuity risk reduced) | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| npm workspaces migration | HIGH | LOW | P1 |
| Test runner migration | HIGH (safety net) | MEDIUM | P1 |
| `Bun.serve()` → `node:http` + SSE parity | HIGH (core function) | HIGH | P1 |
| SQLite/Postgres driver swap | HIGH (data integrity) | HIGH | P1 |
| Worker thread swap | MEDIUM (hot-path perf, not correctness-risk given Web-standard transfer semantics) | MEDIUM | P1 |
| CLI binary / Node SEA | HIGH (distribution channel) | HIGH | P1 |
| Docker image | MEDIUM (one of several deploy paths) | MEDIUM | P1 |
| CI/release automation | HIGH (blocks all future releases) | MEDIUM | P1 |
| Graceful shutdown | MEDIUM (operational correctness) | LOW-MEDIUM | P1 |
| `node:sqlite` vs `better-sqlite3` decision | MEDIUM (build-fragility risk) | — (decision, not build cost) | P2 |
| Vitest vs `node:test` decision | LOW-MEDIUM (DX only) | — (decision) | P2 |
| Worker-inlining tooling consolidation | LOW | LOW | P3 |

**Priority key:**
- P1: Required for migration completeness (table stakes)
- P2: Decision points that gate a P1 item but have no wrong answer, need explicit user sign-off
- P3: Nice to have, defer to post-milestone cleanup

## Behavioral Differences That Could Cause Silent Regressions (Question 4 Deep-Dive)

| Area | Bun Behavior | Node Behavior | Risk for This Proxy |
|------|--------------|----------------|----------------------|
| `fetch()` implementation | JavaScriptCore-based, Bun-native | `undici`-based (Node 18+); different connection pooling, different header-casing edge cases, different error types on network failure | Every upstream call to Claude/OpenRouter/other providers goes through `fetch()`. Any subtle difference in timeout behavior, redirect handling, or streaming-body support could change failover behavior (`handleProxyError()` classification logic). MUST be integration-tested against every provider, not just unit-tested. |
| `ReadableStream`/SSE idle timeout | `Bun.serve()` has a documented default ~10s idle-connection timeout that treats a quiet SSE stream as idle and closes it — a known Bun gotcha requiring explicit configuration | Node's `http.Server` has separate `keepAliveTimeout`, `headersTimeout`, `requestTimeout` settings, none of which default to Bun's specific 10s SSE-killing behavior, but must be explicitly set to avoid Node's own default request timeouts interfering with legitimately long-lived Claude streaming responses | Directly relevant to this app's core function — Claude responses can stream slowly (thinking tokens, tool calls). Must explicitly configure/disable Node's request timeout for the proxy route and re-verify no premature stream closure. |
| SSE chunk flushing/backpressure | Bun flushes on every `await` in a stream controller; some GitHub discussion threads note Bun batches ReadableStream chunks rather than sending byte-for-byte immediately in certain configurations | Node streams have their own backpressure model (`highWaterMark`, `.write()` return value) | Given this app explicitly preserves "SSE passthrough... byte-identical," this needs literal byte-level integration testing (diff captured SSE frames from both runtimes against the same upstream response), not just "the response looks right." |
| Process signal handling (SIGTERM/SIGINT) | Historically documented gaps — `process.on("SIGINT")` callbacks may not reliably fire; `Bun.serve()` had no native drain/close method | Node's `process.on("SIGTERM")` + `http.Server.close()` is the standard, well-documented, reliable pattern | If existing shutdown code has any Bun-signal-quirk workarounds, they may become dead code or actively wrong under Node — audit rather than blind-port. |
| `Bun.sleepSync` | Native synchronous sleep primitive | No Node equivalent; standard workaround is `Atomics.wait()` on a `SharedArrayBuffer`, or a `child_process`-based blocking spawn (slower, heavier) | `retry.ts` already has partial awareness of this gap (comment references a Node fallback) — needs verification the existing fallback is production-quality, not just present. |
| `.env` loading + variable expansion | Auto-loads `.env`/`.env.local`/`.env.{NODE_ENV}`, with `$VAR` expansion built in | Node's native `--env-file`/`process.loadEnvFile()` does NOT expand `$VARIABLE` references; existing `dotenv` npm package (already a dependency) does support expansion via the separate `dotenv-expand` package | LOW risk if the project continues using the `dotenv` package rather than switching to Node's native env-file flag — verify which path the migration takes. |
| WASM module loading (`@dqbd/tiktoken`) | Bun has WASM-in-worker restrictions that appear to be *why* this codebase's worker file explicitly avoids importing tiktoken at all (per its own code comment) | Node's WASM support is generally considered more mature/permissive, including in `worker_threads` | Current codebase shows `@dqbd/tiktoken` as effectively dormant (type-only import, no live `Tiktoken` instantiation found). This is a lower-risk item than the milestone context implies — verify whether any *other* un-grepped code path instantiates tiktoken (e.g., dynamically, or in a file this research didn't fully enumerate) before treating it as settled. |
| Worker transferable types | Bun's `Transferable` union includes `ArrayBuffer`, `MessagePort`, `AbortSignal`, `FileHandle`, `ReadableStream`, `WritableStream`, `TransformStream` — broader than Node | Node's `transferList` supports `ArrayBuffer`, `MessagePort`, `FileHandle` (per Node docs) | The codebase's documented "TRANSFER CONTRACT" only uses `ArrayBuffer` transfers (confirmed by code inspection) — this is within Node's supported subset, so this specific risk does not materialize for this codebase, but don't assume any *future* worker code could freely use Bun's broader transferable set. |
| `node:sqlite` maturity vs Node 24 floor | N/A | Search results conflict on exact stabilization version — one source says "stable since v22.22.0 with an experimental warning," another says "Node v26 stabilized it fully" | UNRESOLVED — this is a genuine open question requiring direct verification against Node 24.x release notes before the roadmap locks in `node:sqlite` as the driver choice. Flagged as a gap below. |

## Sources

- [Node.js 24.11.0 (LTS) release notes](https://nodejs.org/en/blog/release/v24.11.0) — HIGH confidence (official)
- [Node.js Releases overview](https://nodejs.org/en/about/previous-releases) — HIGH confidence (official)
- [nodesource.com — Node.js 24 Becomes LTS](https://nodesource.com/blog/nodejs-24-becomes-lts) — MEDIUM confidence (vendor blog, cross-checked against official release notes)
- [Node.js Single executable applications docs](https://nodejs.org/api/single-executable-applications.html) — HIGH confidence (official)
- [nodejs/single-executable GitHub team repo](https://github.com/nodejs/single-executable) — HIGH confidence (official Node.js working group)
- [Joyee Cheung's blog — Improving SEA building for Node.js (2026-01-26)](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/) — HIGH confidence (Node.js core contributor)
- [better-sqlite3 GitHub Discussion #1245 — node:sqlite comparison](https://github.com/WiseLibs/better-sqlite3/discussions/1245) — MEDIUM confidence (maintainer-adjacent discussion, not official docs)
- [Node.js worker_threads docs (v24/v26)](https://nodejs.org/api/worker_threads.html) — HIGH confidence (official)
- [Bun reference docs — worker_threads/postMessage](https://bun.com/reference/node/worker_threads/MessagePort/postMessage) — HIGH confidence (official Bun docs, Node-compat reference)
- [Bun docs — Server-Sent Events (SSE)](https://bun.com/docs/guides/http/sse) — HIGH confidence (official Bun docs)
- [oven-sh/bun GitHub Discussion #13923 — ReadableStream batching behavior](https://github.com/oven-sh/bun/discussions/13923) — MEDIUM confidence (community discussion, not resolved/official)
- [oven-sh/bun Issue #27479 — Bun.serve idleTimeout/SSE documentation gap](https://github.com/oven-sh/bun/issues/27479) — MEDIUM confidence (open issue, describes a real known gap)
- [oven-sh/bun Issue #1657 — SIGTERM listener support](https://github.com/oven-sh/bun/issues/1657) — MEDIUM confidence (GitHub issue, describes historical known limitation)
- [Bun docs — Environment Variables](https://bun.com/docs/runtime/environment-variables) — HIGH confidence (official Bun docs)
- [env.dev — Node.js Env Variables guide](https://env.dev/guides/nodejs-env-variables) — MEDIUM confidence (third-party guide, consistent with Node official `--env-file` docs)
- [dqbd/tiktoken GitHub repo](https://github.com/dqbd/tiktoken) — HIGH confidence (official package repo)
- [tiktoken npm package page](https://www.npmjs.com/package/tiktoken) — HIGH confidence (official npm listing)
- Direct codebase inspection (this repo, `thamw-main` branch, 2026-07-17) — HIGH confidence, primary source for all "Codebase Bun-Surface Inventory" and dependency-graph claims

## Gaps / Open Questions for Roadmap to Resolve

1. **`node:sqlite` stabilization version is unresolved** — search sources conflict on whether it's fully stable at the Node 24 floor or only stabilizes at Node 26. This must be verified directly against Node 24.x changelogs/release notes before the roadmap commits to a specific SQLite driver. If unresolved by Node 24, `better-sqlite3` becomes the likely fallback despite its native-compile tradeoff.
2. **Node SEA cross-compilation reality at Node 24** — confirmed no built-in cross-compilation exists, but exact CI matrix design (which OS runners, whether GitHub-hosted runners cover all 5 existing target platforms) needs a dedicated spike, not assumed from this research alone.
3. **`.github/workflows/docker-publish.yml` and `signpath-test.yml` Bun-reference audit is incomplete** — this research confirmed Bun references in `release.yml` by direct grep but did not fully read the other 2 flagged workflow files line-by-line. Roadmap phase for CI should start with a full audit pass across all 9 workflow files.
4. **Whether any code path beyond `usage-extraction.ts`'s type-only import instantiates `Tiktoken` at runtime** — grepped for common invocation patterns and found none, but a roadmap phase touching tokenization should re-verify with a broader search (including dynamic imports) before assuming the WASM-loading risk is fully moot.

---
*Feature research for: Bun→Node.js runtime migration*
*Researched: 2026-07-17*
