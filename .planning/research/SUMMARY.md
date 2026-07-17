# Project Research Summary

**Project:** better-ccflare — Bun-to-Node.js Migration (Milestone v100.0)
**Domain:** Runtime migration for a long-running, production Bun HTTP proxy (SSE streaming, SQLite WAL + Postgres, worker threads, standalone CLI binary)
**Researched:** 2026-07-17
**Confidence:** HIGH overall

## Executive Summary

This is a like-for-like runtime port, not a rewrite: the whole request/response handler layer is already written against the Fetch API, so the correct strategy is a thin Fetch-to-Node adapter (`node:http` + `srvx`) at the single `server.ts` entry point, not a callback-style rewrite of every handler. The same "preserve the existing seam, replace only the runtime primitive underneath it" logic applies to the database adapter, the worker-spawn mechanism, and the CLI packaging story. Four Bun pieces need genuinely non-mechanical rewrites (not renames): the HTTP entry adapter, the Worker API (browser-style `onmessage`/Blob-URL → Node's EventEmitter-style `worker_threads` with no Blob support), the CLI's single-file-binary packaging (Node SEA has no cross-compilation, forcing a CI matrix), and — critically — a currently-dormant footgun in `packages/database/src/retry.ts` where `Bun.sleepSync`'s fallback path (`spawnSync("sleep", ...)`) will silently activate the moment Bun is gone and synchronously block the entire event loop (all in-flight SSE streams) during every SQLite-retry backoff. This directly compounds one of the project's two open, unresolved debug investigations (`stalled-streaming-requests`, whose leading hypothesis is `SQLITE_BUSY` contention) — fixing it (via `Atomics.wait` on a `SharedArrayBuffer`) must be scoped explicitly into the database-driver phase, not left as an afterthought.

The recommended stack: `srvx` over `node:http` (preserves the Fetch handler contract with zero router rewrite), `better-sqlite3` over `node:sqlite` (the latter is Stability 1.1 "Active development" on the locked Node 24 floor — not production-safe for a billing-critical DB, despite being zero-dependency), `pg` over `postgres.js` (its `query(text, values)` shape is a direct structural match for the existing hand-rolled `?`→`$N` placeholder-conversion in `bun-sql-adapter.ts`), `vitest` over `node:test` (near drop-in for `bun:test`'s jest-shaped API across 167 test files), `node:worker_threads` with the inlining/base64/Blob mechanism replaced by an esbuild-CJS-bundle + `eval:true` recipe, and a two-tier CLI distribution (npm `bin`+shebang as primary, Node SEA as secondary/optional for no-runtime binaries).

Key risk to manage across the whole migration: `better-sqlite3` (a native addon) reverses Bun's zero-native-build-step story, with real downstream consequences for CI (single-job cross-compile → real per-platform matrix), Docker (needs prebuilt `.node` binaries or build tooling), and any future Node-SEA CLI packaging (native addons + Linux-arm64-in-Docker-via-QEMU is a known-broken combination). Decide this once, early, and budget the CI/Docker/SEA implications explicitly. A second cross-cutting risk: `database-operations.ts` is NOT a thin consumer of `bun-sql-adapter.ts` — it has ~20 direct `bun:sqlite` PRAGMA/maintenance call sites (plus `migrations.ts` and all 4 worker files importing `Database` directly) that bypass the adapter entirely and must be explicitly included in the database-driver phase's scope.

## Key Findings

### Recommended Stack

Six Bun-specific pieces need Node.js replacements: `Bun.serve()` → `node:http` + `srvx` (adapter only, preserves existing Fetch-based router); `bun:test` → `vitest`; `bun:sqlite` → `better-sqlite3`; `Bun.SQL` (Postgres) → `pg`; Bun `Worker` (+ build-time inlining) → `node:worker_threads` (inlining mechanism rewritten, not ported, as an esbuild-CJS-bundle + `eval:true` recipe); `bun build --compile` → npm `bin`+shebang (primary) with Node SEA (secondary). npm workspaces (already the locked decision) needs no re-litigation, only mechanics (delete `bun.lock`, rewrite `workspace:*`→`*`, regenerate `package-lock.json`).

**Core technologies:**
- `srvx@0.11.22`: Fetch-API-to-`node:http` adapter — keeps `fetch(req: Request): Response` handler signature across all ~40 handler files untouched; purpose-built by the h3/UnJS team (Nitro/h3 authors), 33.7M weekly downloads.
- `better-sqlite3@12.11.1`: SQLite driver — synchronous (matches `bun:sqlite`'s execution model), mature and semver'd, unlike `node:sqlite`'s Stability 1.1 status on the Node 24 floor.
- `pg@8.22.0`: Postgres driver — `query(text, values)` API is a direct structural match for the SQL-string + params-array pattern `bun-sql-adapter.ts` already produces; 36.1M weekly downloads.
- `vitest@4.1.10`: Test runner — near drop-in for `bun:test`'s jest-shaped `describe/it/expect`/`mock()`/`mock.module()` API across 167 test files; `node:test` would force a much larger mechanical-but-risky rewrite.
- `node:worker_threads` (built-in): Worker threads, EventEmitter-style, no Blob-URL support — the inline-worker mechanism is rewritten as esbuild CJS bundling + `eval:true` string-source spawning, not ported literally.
- Node SEA (built-in, official): CLI standalone-binary packaging — no cross-compilation (unlike Bun's single-runner multi-target build), requires a GitHub Actions matrix across native OS/arch runners.

### Expected Features (reframed as migration parity checklist)

**Must have (table stakes, P1):** npm workspaces replace `bun.lock`; `Bun.serve()` → `node:http` with byte-identical SSE passthrough; `bun:test` suite passes under the new runner; SQLite/Postgres drivers port with WAL/pooling parity; worker threads preserve transferable-ArrayBuffer zero-copy semantics; CLI binary installable via `npm install -g` AND still produces standalone per-platform binaries; Docker image builds/runs on Node base; CI/release automation fully off Bun; `.env` loading parity (`$VAR` expansion via `dotenv`, not Node's native env-file flag); graceful shutdown preserved and improved; `retry.ts`'s `Bun.sleepSync` fallback fixed to be production-quality.

**Should have (decision points, P2 — need explicit sign-off):** `node:sqlite` vs `better-sqlite3` (resolved in favor of `better-sqlite3`); Vitest vs `node:test` (resolved in favor of vitest).

**Defer (P3):** consolidating the 3–4 worker-inlining build steps into shared tooling; re-evaluating `node:sqlite` once it reaches Stability 2 on a later Node LTS line.

**Explicitly out of scope (anti-features):** swapping to a full HTTP framework, changing DB schema while swapping drivers, adding new architectural dependencies (ORMs, DI swaps), expanding CLI platform coverage, expanding test coverage during the runner port, restructuring the DI container, or formally folding in the two open debug investigations as in-scope deliverables (track incidental resolution as a bonus finding with its own regression test).

### Architecture Approach

Organize the migration around "preserve the existing seam, replace only what's underneath it" — the Fetch-API router contract, the DB adapter's method interface, and the worker dev-mode file-path pattern all survive unchanged; only the runtime primitives they wrap change. One cross-cutting fact governs everything: every workspace package's `package.json` points `main`/`exports` directly at `.ts` source with zero build step. Node 24's native type-stripping can preserve this DX for the backend after fixing 3 files with non-erasable constructor parameter properties; workers and the CLI binary get a real esbuild bundle step for packaging reasons, ordinary packages stay build-step-free.

**Major components:**
1. **Fetch-to-Node HTTP adapter** (`srvx` wrapping `node:http`) — converts Node's `(req, res)` into `Request`/`Response`, `router.ts` and all handlers unchanged.
2. **Database adapter + facade** (`bun-sql-adapter.ts` swapped to `better-sqlite3`/`pg`; **`database-operations.ts` and `migrations.ts` also directly touched** — they bypass the adapter with ~20 direct `bun:sqlite` PRAGMA/maintenance calls).
3. **Worker-thread spawn + inlining pipeline** — 4 worker files rewritten for `parentPort` instead of `self`, spawned via esbuild-CJS-bundle + `eval:true`, `post-processor.worker.ts`'s top-level `await` wrapped in async IIFE.
4. **CLI packaging pipeline** — npm `bin`+shebang primary; Node SEA secondary, requiring a CI matrix restructuring.
5. **Dashboard build pipeline** — `Bun.build()` → esbuild (HTML-entrypoint has no esbuild equivalent, hand-template output HTML); `embed.ts` already Bun-free; `dashboard-web/package.json` needs an explicit `exports` map addition for `./dist/embedded` (required, or `ERR_PACKAGE_PATH_NOT_EXPORTED`).

### Critical Pitfalls

1. **The Fetch-API contract is load-bearing everywhere, not just `server.ts`** — confine the HTTP diff to a single adapter file (`srvx`); `router.ts` signatures must remain unchanged as the verification criterion.
2. **`Bun.sleepSync`'s dormant `spawnSync` fallback becomes the primary, event-loop-blocking path the instant Bun is removed** — a previously-unknown landmine that directly compounds the open `stalled-streaming-requests` debug investigation. Fix with `Atomics.wait()` on a `SharedArrayBuffer`, scoped explicitly into the database-driver phase, with a regression test asserting no child process is spawned.
3. **Node's Worker API is a rewrite, not a rename** — Bun's browser-style `onmessage`/Blob-URL pattern has no Node equivalent (EventEmitter-style `.on("message")`, no Blob support). A mechanical import-swap silently produces a controller whose handlers never fire (billing-critical usage-collector worker) — requires an explicit `ready→ack→summary→shutdown-complete` round-trip integration test written before the rewrite.
4. **`database-operations.ts` is not a thin adapter consumer — it has ~20 direct `bun:sqlite` call sites**, plus `migrations.ts` and all 4 worker files import `Database` directly. Scope the database-driver phase across all of: `bun-sql-adapter.ts`, `database-operations.ts`, `migrations.ts`, and the 4 worker files.
5. **`node:sqlite`'s experimental status collides with the native-addon alternative's CI/Docker/SEA costs** — `node:sqlite` is Stability 1.1 on Node 24 (not production-safe); `better-sqlite3` is a native addon that breaks the current zero-native-build-step CI/Docker/binary pipeline. Decide once, early, and budget the CI/Docker/SEA fallout explicitly.
6. **Node's HTTP server has no single `idleTimeout` knob** — `server.ts` maxes Bun's `idleTimeout` at 255s to keep SSE alive; Node splits this into `keepAliveTimeout`/`headersTimeout`/`requestTimeout`, and `http.Server#close()` doesn't forcibly close idle keep-alive connections (can hang graceful shutdown). Exit criterion: SIGTERM-during-active-SSE-stream integration test.

## Implications for Roadmap

Suggested phase structure (reconciled from FEATURES.md's dependency graph, ARCHITECTURE.md's Q6 phase ordering, and PITFALLS.md's phase-mapping):

### Phase 1: Foundation — Package manager + TypeScript config + build-step decision
**Rationale:** Nothing downstream can be typechecked/linted/resolved without npm workspaces and `bun-types` removed; cheapest possible unblock (3-file fix) for native-TS execution everywhere downstream.
**Delivers:** Working `npm install` (with `workspace:*`→`*` rewritten — npm does NOT support the `workspace:` protocol), `package-lock.json`, root `tsconfig.json` off `bun-types`, split `tsconfig.node.json`/`tsconfig.dom.json` to eliminate DOM/Node lib timer-handle collision.
**Addresses:** Table Stakes #1 (npm workspaces), #9 (env var parity).
**Avoids:** Pitfall 2 (non-erasable TS enum), Pitfall 3 (`workspace:*` not an npm protocol).

### Phase 2: Test runner migration (start early, trail to completion)
**Rationale:** Every subsequent phase needs a working regression suite in the target runner to prove parity.
**Delivers:** `vitest` running the test suite; mechanical `bun:test`→`vitest` import codemod.
**Uses:** `vitest@4.1.10`.
**Avoids:** the "looks done but isn't" gap around `mock.module()`/module-namespace `spyOn()` (7+ files) — verify actual interception, not just "compiles."

### Phase 3: Runtime API de-Bunification (leaf modules)
**Rationale:** Self-contained swaps with no cross-package coordination — do these early to shrink the Bun-API surface before the harder integration points.
**Delivers:** Every leaf `Bun.*` call site (`server.ts`'s `resolveSync`/`file`, `oauth-redirect.ts`'s `Bun.serve`, `file-writer.ts`'s `Bun.file().text()`, the OpenAI-responses-adapter's zstd/gzip calls) replaced with `node:*` equivalents.

### Phase 4: HTTP server migration — `Bun.serve()` → `node:http` + `srvx`
**Rationale:** Core function of the app; must be scoped as a single adapter file per Pitfall 1.
**Delivers:** `server.ts` speaking `node:http` via a Fetch-API adapter; explicit SSE timeout tuning; graceful shutdown using `server.closeAllConnections()`.
**Addresses:** Table Stakes #2, #10.
**Avoids:** Pitfall 1, Pitfall 10.

### Phase 5: Database driver swap (can run in parallel with Phase 6)
**Rationale:** High correctness/data-integrity risk; must be scoped wider than "swap the adapter class."
**Delivers:** `better-sqlite3` + `pg` replacing `bun:sqlite`/`Bun.SQL` across `bun-sql-adapter.ts`, `database-operations.ts` (~20 direct call sites), `migrations.ts`, and all 4 worker files; WAL-mode fallback logic verified byte-for-byte; `retry.ts`'s sync-sleep fixed to `Atomics.wait`.
**Uses:** `better-sqlite3@12.11.1`, `pg@8.22.0`.
**Avoids:** Pitfall 6 (critical — spawnSync blocking landmine), Pitfall 7 (dual SQLite+Postgres scope), Pitfall 8 (node:sqlite experimental status / native-addon CI fallout).

### Phase 6: Dashboard build pipeline
**Rationale:** Independent of DB work, can run in parallel with Phase 5.
**Delivers:** `Bun.build()` → esbuild + `@tailwindcss/cli`; `dashboard-web/package.json` `exports` map addition (required).

### Phase 7: Worker threads — hardest phase
**Rationale:** Must come after Phase 5 (all worker files import `bun:sqlite` directly); needs the build-tool decision from Phase 6.
**Delivers:** `self`→`parentPort` rewrite in 4 worker files; spawn sites rewritten from `.onmessage=`/Blob-URL to `.on("message")`/`{eval:true}` CJS-bundle spawning; `post-processor.worker.ts`'s top-level `await` wrapped in async IIFE; `{smol:true}` dropped.
**Avoids:** Pitfall 4 (event-API mismatch — write the round-trip test FIRST), Pitfall 5 (Blob-URL unsupported).

### Phase 8: CLI packaging, Docker, CI/release automation — last, strictly
**Rationale:** Docker and CI can't be meaningfully exercised until runtime/DB/workers/dashboard all work under plain `node`; this is also the biggest CI-topology change (Node SEA has no cross-compilation) — budget it now even though work happens last.
**Delivers:** npm `bin`+shebang CLI (primary); optional Node SEA per-platform builds via a GitHub Actions matrix (secondary); workflows off `oven-sh/setup-bun` onto `actions/setup-node`+`npm ci`; Docker image on Node base; SignPath re-validated against a real SEA `.exe` if pursued.
**Addresses:** Table Stakes #6, #7, #8.
**Avoids:** Pitfall 9 (SEA cross-platform + native-addon interplay).

### Phase Ordering Rationale

- Package manager (1) must be first, unconditionally — every downstream phase depends on it.
- Test runner (2) should start immediately after Phase 1, not wait — every phase needs a regression net in the target runner.
- Leaf-module de-Bunification (3) before the two hard integration points shrinks the Bun-API surface at low risk.
- HTTP server (4) and Database (5)/Dashboard (6) are largely independent and can parallelize, but both gate a fully deployable checkpoint.
- Worker threads (7) must come after Database (5) — all worker files import `bun:sqlite` directly; porting worker-spawn first would leave the app undeployable mid-phase.
- CLI/Docker/CI (8) last, strictly — depends on every other phase's artifacts working under plain Node, and is where the SQLite-driver (5) and build-step (1) decisions resurface as CI/Docker/SEA constraints.

### Research Flags

Needs deeper research during planning:
- **Phase 4 (HTTP server):** SSE/idle-timeout semantics under Node 24's exact `keepAliveTimeout`/`headersTimeout`/`requestTimeout` behavior need empirical verification under real streaming load.
- **Phase 5 (Database driver):** `pg`'s BIGINT/NUMERIC-as-string coercion vs `Bun.SQL`'s current behavior needs per-column empirical audit; lock the `node:sqlite` vs `better-sqlite3` decision with an explicit stability-tier justification.
- **Phase 7 (Worker threads):** prototype the CJS-bundle + `eval:true` recipe early to confirm it works before committing — the one piece requiring a genuine new architectural pattern, not just an API swap.
- **Phase 8 (CLI/CI):** Node SEA cross-platform build matrix design needs a dedicated spike; test SignPath's acceptance of a SEA-produced `.exe` before committing to SEA over dropping standalone binaries.

Standard patterns (skip research-phase):
- **Phase 1 (Package manager):** npm workspace mechanics well-documented; `workspace:*`→`*` is a known scripted find-replace.
- **Phase 2 (Test runner):** `vitest`'s jest-compatible API is well-documented, migration path is mechanical.
- **Phase 3 (Leaf modules):** each `Bun.*`→`node:*` swap is a documented 1:1 API mapping.
- **Phase 6 (Dashboard build):** esbuild + Tailwind CLI replacement for `Bun.build()` is a standard pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified via npm registry/downloads API in-session; `node:sqlite` WAL behavior hands-on verified against local Node v24.18.0; SEA cross-compile mechanics MEDIUM (docs/search only) |
| Features | MEDIUM-HIGH | Codebase-specific findings verified by direct code inspection (HIGH); some ecosystem "best tool" claims are vendor-blog consensus (MEDIUM) |
| Architecture | HIGH (codebase facts) / MEDIUM-HIGH (Node 24 API behavior) | Every codebase claim grounded in direct file reads with cited line numbers |
| Pitfalls | MEDIUM-HIGH | Codebase facts HIGH confidence; Node/Bun API-difference claims MEDIUM-HIGH (cross-checked against official docs and open GitHub issues) |

**Overall confidence:** HIGH

### Gaps to Address

- **`node:sqlite` stabilization status** — STACK.md, ARCHITECTURE.md, and PITFALLS.md independently converge on Stability 1.1 "Active development" on Node 24 (RC only at 25.7, tracked via `nodejs/node#57445`), unanimously recommending `better-sqlite3`. Treat as settled; no further research needed unless the Node floor moves to 25+.
- **`pg`'s BIGINT/NUMERIC string-coercion vs `Bun.SQL`'s current coercion** — needs a Phase 5 spike against real production columns, not resolved by desk research.
- **`.github/workflows/docker-publish.yml` and `signpath-test.yml` Bun-reference audits are incomplete** — Phase 8 should start with a full line-by-line audit across all workflow files.
- **The pre-push hook auto-updating `CLAUDE_CLI_VERSION`** was not inspectable in this research pass — re-verify it doesn't shell out to `bun` directly before declaring Phase 8 complete.
- **Whether any code path beyond the type-only `@dqbd/tiktoken` import instantiates `Tiktoken` at runtime** — grepped and found none, but re-verify with a broader (including dynamic-import) search before treating the WASM-loading risk as fully moot.
- **Node SEA's exact CI-matrix design** (which runners cover which of the 5 target platforms, arm64 coverage) needs a dedicated Phase 8 spike.

## Sources

### Primary (HIGH confidence)
- Direct codebase reads: `apps/server/src/server.ts`, `packages/http-api/src/router.ts`, `packages/proxy/src/proxy.ts`, `packages/proxy/src/usage-worker-controller.ts`, `packages/database/src/adapters/bun-sql-adapter.ts`, `packages/database/src/database-operations.ts`, `packages/database/src/retry.ts`, `packages/database/src/migrations.ts`, `packages/database/src/integrity-check-runner.ts`, `packages/core/src/constants.ts`, `apps/cli/package.json`, `.github/workflows/release.yml`, `tsconfig.json`, all workspace `package.json` files
- npm registry + npm downloads API — direct verification of `srvx@0.11.22`, `better-sqlite3@12.11.1`, `pg@8.22.0`, `vitest@4.1.10`
- Local execution against Node v24.18.0 — `node:sqlite` load + WAL-mode verification
- Node.js Single Executable Applications docs, Node.js worker_threads docs, nodejs/node issue #57445 (node:sqlite stabilization), nodejs/node issue #30682 (Worker eval as ES Module), npm/cli issue #8845 (workspace: protocol EUNSUPPORTEDPROTOCOL)

### Secondary (MEDIUM confidence)
- srvx docs, vendor blog posts on Node SEA maturity, PkgPulse driver/runner comparisons
- GitHub discussion threads on Bun ReadableStream batching behavior and SIGTERM handling gaps

---
*Research completed: 2026-07-17*
*Ready for roadmap: yes*
