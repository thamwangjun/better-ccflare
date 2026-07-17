# Requirements: better-ccflare (Personal Fork)

**Defined:** 2026-07-17
**Core Value:** Stay current with upstream while running a stable personal instance enhanced with features I need — primarily around OpenRouter caching, provider selection, and a clean patch workflow.

## v1 Requirements

Requirements for milestone v100.0 (Bun-to-Node.js Migration). Each maps to roadmap phases.

### Foundation (FOUND)

- [ ] **FOUND-01**: Repo installs and resolves all ~15 workspace packages via `npm install` using npm workspaces — no `bun.lock`, no `workspace:*` protocol references
- [ ] **FOUND-02**: Root and per-package `tsconfig.json` no longer reference `bun-types`; the DOM/Node `lib` timer-handle collision is resolved (split `tsconfig.node.json`/`tsconfig.dom.json` as needed)
- [ ] **FOUND-03**: `.env` loading behavior (including `$VAR` expansion) is preserved via `dotenv`, not a mix of Bun's built-in env loading and `dotenv`

### Test Runner (TEST)

- [ ] **TEST-01**: The full test suite (167+ `*.test.ts` files) runs and passes under `vitest` instead of `bun:test`
- [ ] **TEST-02**: Mock/spy patterns (`mock()`, `mock.module()`) are correctly translated to `vi.fn()`/`vi.mock()` with verified interception, not just successful compilation

### Runtime API Cleanup (API)

- [ ] **API-01**: All leaf `Bun.*` call sites (`Bun.file`, `Bun.serve` in `oauth-redirect.ts`, `Bun.env`, zstd/gzip calls, `resolveSync`, etc.) are replaced with `node:*` equivalents

### HTTP Server (HTTP)

- [ ] **HTTP-01**: `apps/server/src/server.ts` runs on `node:http` (via a `srvx` adapter) with the existing Fetch-based `router.ts` and all handler files unchanged
- [ ] **HTTP-02**: SSE streaming responses pass through byte-identically under Node (verified via integration test)
- [ ] **HTTP-03**: Graceful shutdown (SIGTERM) correctly drains in-flight requests including active SSE streams, with explicit `keepAliveTimeout`/`headersTimeout`/`requestTimeout` tuning replacing Bun's single `idleTimeout` knob

### Database Drivers (DB)

- [ ] **DB-01**: SQLite driver replaced with `better-sqlite3` across `bun-sql-adapter.ts`, `database-operations.ts` (~20 direct call sites), `migrations.ts`, and all 4 worker files — WAL mode preserved
- [ ] **DB-02**: Postgres driver replaced with `pg`, preserving the existing `?`→`$N` parameterized query pattern
- [ ] **DB-03**: `retry.ts`'s `Bun.sleepSync` fallback (`spawnSync("sleep", ...)`) is replaced with a non-blocking `Atomics.wait()`-based sleep so SQLite retry backoff never blocks the event loop

### Dashboard Build (DASH)

- [ ] **DASH-01**: Dashboard build pipeline (`Bun.build()` → esbuild + Tailwind CLI) produces the same embedded base64 dashboard asset consumed by the server, including the required `exports` map addition for `./dist/embedded`

### Worker Threads (WORKER)

- [ ] **WORKER-01**: All worker files (usage-collector/post-processor, vacuum, integrity-check) run on `node:worker_threads` with `parentPort`-based messaging instead of Bun's browser-style `onmessage`
- [ ] **WORKER-02**: Transferable ArrayBuffer zero-copy semantics are preserved on the billing-critical usage-collector worker, verified via a round-trip integration test written before the rewrite
- [ ] **WORKER-03**: Worker spawning uses an esbuild CJS-bundle + `eval:true` recipe, retiring the 3 auto-generated inline files (`inline-worker.ts`, `inline-vacuum-worker.ts`, `inline-integrity-check-worker.ts`)

### CLI, Docker & CI (DEPLOY)

- [ ] **DEPLOY-01**: CLI is installable and runnable via `npm install -g` + a shebang script (`#!/usr/bin/env node`) — no standalone binary required
- [ ] **DEPLOY-02**: Docker image builds on a Node base image (replacing Bun + `debian:bookworm-slim` w/ Bun) and continues to run as non-root
- [ ] **DEPLOY-03**: CI/release automation is fully off Bun — GitHub Actions workflows (`oven-sh/setup-bun` → `actions/setup-node` + `npm ci`) and the pre-push `CLAUDE_CLI_VERSION` version-bump hook

## v2 Requirements

Deferred to future release. Tracked but not in the current roadmap.

### Distribution (DIST)

- **DIST-01**: Standalone per-platform CLI binaries via Node Single Executable Applications (SEA), including a GitHub Actions CI build matrix — deferred in favor of npm `bin`+shebang for v100.0 (explicit decision: highest-cost, most uncertain item — no cross-compilation, native-addon+SEA+Docker/arm64 risk)
- **DIST-02**: Re-evaluate `node:sqlite` as the SQLite driver once it reaches Stability 2 on a later Node LTS line (currently Stability 1.1 "Active development" on the Node 24 floor)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| HTTP framework swap (Express/Fastify/full framework) | `srvx` is a thin Fetch-API adapter only — not a framework migration; router/handlers stay untouched |
| Database schema changes | Driver swap only (`bun:sqlite`/`Bun.SQL` → `better-sqlite3`/`pg`) — no schema changes |
| New architectural dependencies (ORMs, DI container refactor) | Out of scope for a runtime migration; adds unrelated risk |
| Expanding CLI platform coverage | Out of scope — parity with current platforms only |
| Expanding test coverage during the runner port | Mechanical `bun:test`→`vitest` migration only, not a coverage initiative |
| Formally resolving the two open debug sessions (`chunk-dropped-worker-stopped`, `stalled-streaming-requests`) as milestone deliverables | Not the primary driver (vendor-risk reduction is) — incidental resolution (e.g. via DB-03's `Atomics.wait` fix) is tracked as a bonus, not a required outcome |
| Node SEA standalone binaries | Deferred to v2 (DIST-01) — explicit user decision to reduce this milestone's CI-risk scope |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 12 | Pending |
| FOUND-02 | Phase 12 | Pending |
| FOUND-03 | Phase 12 | Pending |
| TEST-01 | Phase 13 | Pending |
| TEST-02 | Phase 13 | Pending |
| API-01 | Phase 14 | Pending |
| HTTP-01 | Phase 15 | Pending |
| HTTP-02 | Phase 15 | Pending |
| HTTP-03 | Phase 15 | Pending |
| DB-01 | Phase 16 | Pending |
| DB-02 | Phase 16 | Pending |
| DB-03 | Phase 16 | Pending |
| DASH-01 | Phase 17 | Pending |
| WORKER-01 | Phase 18 | Pending |
| WORKER-02 | Phase 18 | Pending |
| WORKER-03 | Phase 18 | Pending |
| DEPLOY-01 | Phase 19 | Pending |
| DEPLOY-02 | Phase 19 | Pending |
| DEPLOY-03 | Phase 19 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19/19 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-17*
*Last updated: 2026-07-17 after v100.0 roadmap creation (Phases 12-19)*
