# Roadmap: better-ccflare (Personal Fork)

## Milestones

- ✅ **v1.0 Correctness & Maintenance** — Phases 1-2 (shipped 2026-05-05)
- ✅ **v1.1 Extended caching for openrouter models** — Phases 3-6 (shipped 2026-05-21)
- ✅ **v1.2 OpenRouter Cost Tracking** — Phases 7-8 (shipped 2026-06-02)
- ✅ **v1.3 OpenRouter Anthropic Messages Provider** — Phases 9-11 (shipped 2026-07-17)
- 🚧 **v100.0 Bun-to-Node.js Migration** — Phases 12-19 (in progress)

## Phases

<details>
<summary>✅ v1.0 Correctness & Maintenance (Phases 1-2) — SHIPPED 2026-05-05</summary>

See [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) for full phase details.

</details>

<details>
<summary>✅ v1.1 Extended caching for openrouter models (Phases 3-6) — SHIPPED 2026-05-21</summary>

See [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md) for full phase details.

</details>

<details>
<summary>✅ v1.2 OpenRouter Cost Tracking (Phases 7-8) — SHIPPED 2026-06-02</summary>

See [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) for full phase details.

</details>

<details>
<summary>✅ v1.3 OpenRouter Anthropic Messages Provider (Phases 9-11) — SHIPPED 2026-07-17</summary>

See [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md) for full phase details.

</details>

### 🚧 v100.0 Bun-to-Node.js Migration (In Progress)

**Milestone Goal:** Fully migrate better-ccflare off Bun — package manager, test runner, leaf runtime APIs, HTTP server, database drivers, dashboard build, worker threads, and CLI/Docker/CI — with every phase leaving the app fully functional and deployable. By the end of this milestone, Bun is dropped completely from the repo.

**⚠️ Verification Expectation (applies to every phase, 12-19):** Every phase's final success criterion — "the app still starts/serves requests with no functional regression" — is a genuine risk, not a formality. Bun and Node.js have real, research-documented behavioral differences at nearly every seam this milestone touches (HTTP keep-alive/timeout semantics, Worker event APIs, SQLite driver stability tiers, WASM loading, env-var expansion, and more — see `.planning/research/PITFALLS.md`). **Planner and executor agents should not treat first-pass failure of this criterion as a sign the phase was mis-scoped or needs re-planning from scratch.** Instead:
- Budget a gap-closure plan/wave within the phase by default — do not assume the primary migration plan(s) alone will satisfy the regression check.
- When the regression check fails, diagnose against the phase's `PITFALLS.md`-sourced risks first before treating it as a novel bug.
- Verifier agents (`gsd-verifier`) should expect and allow a phase to need one additional gap-closure plan before signing off — this is the anticipated pattern for this milestone, not a scope failure.
- This expectation does not lower the bar for what "done" means — the app must genuinely start and serve requests with no regression before a phase is marked complete. It only sets the expectation that reaching that bar may take more than one plan per phase.

- [ ] **Phase 12: Foundation — Package Manager & TypeScript Config** - npm workspaces replace bun.lock; tsconfig off bun-types; dotenv env parity
- [ ] **Phase 13: Test Runner Migration** - 167+ test files run under vitest instead of bun:test, with verified mock/spy interception
- [ ] **Phase 14: Runtime API Cleanup** - leaf Bun.* call sites (Bun.file, Bun.serve in oauth-redirect.ts, Bun.env, zstd/gzip, resolveSync) replaced with node:* equivalents
- [ ] **Phase 15: HTTP Server Migration** - Bun.serve() replaced with node:http + srvx, byte-identical SSE passthrough, tuned graceful shutdown
- [ ] **Phase 16: Database Driver Migration** - bun:sqlite/Bun.SQL replaced with better-sqlite3/pg across the adapter, database-operations.ts, migrations.ts, and all 4 workers; retry.ts sleep fixed to Atomics.wait
- [ ] **Phase 17: Dashboard Build Pipeline** - Bun.build() replaced with esbuild + Tailwind CLI, embedded base64 dashboard asset preserved
- [ ] **Phase 18: Worker Threads Migration** - 4 worker files moved to node:worker_threads with parentPort messaging; billing-critical transferable-ArrayBuffer semantics verified
- [ ] **Phase 19: CLI, Docker & CI Migration** - npm install -g CLI, Node-based Docker image, GitHub Actions off oven-sh/setup-bun

#### Phase 12: Foundation — Package Manager & TypeScript Config
**Goal**: The repo installs, resolves, and typechecks entirely through npm workspaces with zero Bun-specific package-manager or TypeScript config remaining, and the app is functionally unaffected
**Depends on**: Phase 11 (v1.3, prior milestone)
**Requirements**: FOUND-01, FOUND-02, FOUND-03
**Success Criteria** (what must be TRUE):
  1. `npm install` at the repo root completes with zero errors and resolves all ~15 workspace packages — no `bun.lock` and no `workspace:*` protocol references remain in any `package.json`
  2. Typecheck passes with zero errors across every package after `bun-types` is removed from root and per-package `tsconfig.json`
  3. The DOM/Node `lib` timer-handle type collision is resolved (split `tsconfig.node.json`/`tsconfig.dom.json` as needed) — server and dashboard packages both typecheck cleanly
  4. `.env` loading (including `$VAR` expansion) behaves identically via `dotenv` — a test env var that references another var resolves correctly
  5. The app still starts and serves proxy requests with no functional regression from the package-manager/tsconfig swap
**Plans**: TBD

#### Phase 13: Test Runner Migration
**Goal**: Every test in the suite runs and passes under vitest, with mock/spy interception verified as actually working — not just compiling — giving every subsequent phase a real regression safety net
**Depends on**: Phase 12
**Requirements**: TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. The full test suite (167+ `*.test.ts` files) runs via a single `vitest` invocation with zero `bun:test` imports remaining anywhere in the repo
  2. `vitest run` exits 0, with the same set of tests passing as previously passed under `bun test`
  3. `mock()`/`mock.module()` call sites are translated to `vi.fn()`/`vi.mock()` with an assertion in each converted test confirming the real implementation was NOT called (verified interception, not just green compilation)
  4. The app still starts and serves proxy requests with no functional regression
**Plans**: TBD

#### Phase 14: Runtime API Cleanup
**Goal**: Every leaf Bun-only call site is replaced with its node:* equivalent, shrinking the Bun-API surface at low risk before the two hard integration phases (HTTP, DB)
**Depends on**: Phase 13
**Requirements**: API-01
**Success Criteria** (what must be TRUE):
  1. A repo-wide search confirms zero remaining leaf `Bun.*` references (`Bun.file`, `Bun.env`, `resolveSync`, zstd/gzip helpers) outside the not-yet-migrated HTTP server, database, and worker files
  2. The OAuth local callback flow (`oauth-redirect.ts`, previously using `Bun.serve`) still opens and completes using a `node:http` equivalent
  3. The OpenAI-responses-adapter's zstd/gzip compression round-trips correctly (compress then decompress reproduces identical bytes) under `node:zlib`
  4. The full test suite from Phase 13 still passes with zero regressions
**Plans**: TBD

#### Phase 15: HTTP Server Migration
**Goal**: The server runs entirely on node:http via a thin Fetch-API adapter, with SSE streaming and graceful shutdown behaving identically to the Bun implementation
**Depends on**: Phase 14
**Requirements**: HTTP-01, HTTP-02, HTTP-03
**Success Criteria** (what must be TRUE):
  1. `apps/server/src/server.ts` starts and serves requests via `node:http` + `srvx`, with `router.ts` and every handler file's source unchanged
  2. A non-streaming proxy request round-trips successfully end-to-end through the Node-backed server
  3. An SSE streaming response passes through byte-identically under Node, verified by an integration test comparing streamed bytes against the pre-migration baseline
  4. Sending SIGTERM during an active SSE stream drains the in-flight stream to completion before the process exits (graceful-shutdown integration test)
  5. `keepAliveTimeout`/`headersTimeout`/`requestTimeout` are explicitly tuned to keep long-lived SSE connections alive, replacing Bun's single `idleTimeout` knob
**Plans**: TBD

#### Phase 16: Database Driver Migration
**Goal**: SQLite and Postgres access run entirely on Node-native drivers across every call site — not just the adapter class — with WAL mode intact and the dormant event-loop-blocking sleep fallback eliminated
**Depends on**: Phase 15
**Requirements**: DB-01, DB-02, DB-03
**Success Criteria** (what must be TRUE):
  1. `better-sqlite3` replaces `bun:sqlite` across `bun-sql-adapter.ts`, `database-operations.ts` (all ~20 direct call sites), `migrations.ts`, and all 4 worker files — zero remaining `bun:sqlite` imports anywhere in the repo
  2. WAL mode is confirmed active after the driver swap (`PRAGMA journal_mode` returns `wal`)
  3. `pg` replaces `Bun.SQL` for Postgres, preserving the existing `?`→`$N` parameterized query pattern — a Postgres-backed instance connects and executes a query successfully
  4. `retry.ts`'s `Bun.sleepSync`/`spawnSync("sleep", ...)` fallback is replaced with a non-blocking `Atomics.wait()`-based sleep; a regression test asserts no child process is spawned during SQLite retry backoff
  5. The app still starts, serves proxy requests, and persists data correctly with no functional regression
**Plans**: TBD

#### Phase 17: Dashboard Build Pipeline
**Goal**: The dashboard builds and embeds identically through esbuild + Tailwind CLI, with the server able to import and serve the resulting asset
**Depends on**: Phase 16
**Requirements**: DASH-01
**Success Criteria** (what must be TRUE):
  1. The dashboard build pipeline runs via esbuild + Tailwind CLI (replacing `Bun.build()`) and produces the same embedded base64 dashboard asset previously produced by Bun
  2. `dashboard-web/package.json` exposes the required `exports` map entry for `./dist/embedded`, importable without `ERR_PACKAGE_PATH_NOT_EXPORTED`
  3. The server successfully imports and serves the embedded dashboard asset at runtime
  4. The dashboard loads in a browser and renders identically to the pre-migration build (functional smoke check)
**Plans**: TBD
**UI hint**: yes

#### Phase 18: Worker Threads Migration
**Goal**: All 4 worker files run on node:worker_threads with parentPort messaging and an esbuild-bundle spawn recipe, with the billing-critical usage-collector's transferable-ArrayBuffer semantics explicitly verified
**Depends on**: Phase 16, Phase 17
**Requirements**: WORKER-01, WORKER-02, WORKER-03
**Success Criteria** (what must be TRUE):
  1. All worker files (usage-collector/post-processor, vacuum, integrity-check) run on `node:worker_threads` using `parentPort`-based messaging instead of Bun's browser-style `self.onmessage`
  2. Worker spawning uses an esbuild CJS-bundle + `eval:true` recipe; the 3 auto-generated inline files (`inline-worker.ts`, `inline-vacuum-worker.ts`, `inline-integrity-check-worker.ts`) are retired
  3. A round-trip integration test, written before the rewrite, confirms the billing-critical usage-collector worker's transferable-ArrayBuffer zero-copy semantics are preserved across the `ready → ack → summary → shutdown-complete` message sequence
  4. `post-processor.worker.ts`'s top-level `await` is wrapped in an async IIFE and the worker starts/stops cleanly under `node:worker_threads`
  5. A full proxy request flow still completes end-to-end with usage/cost data correctly persisted — no regression in the billing-critical path
**Plans**: TBD

#### Phase 19: CLI, Docker & CI Migration
**Goal**: The CLI, Docker image, and CI/release automation all run on plain Node with zero remaining Bun references anywhere in the repo, completing the milestone
**Depends on**: Phase 18
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03
**Success Criteria** (what must be TRUE):
  1. The CLI installs via `npm install -g` and runs via a `#!/usr/bin/env node` shebang script — no standalone binary required
  2. The Docker image builds on a Node base image (replacing `debian:bookworm-slim` + Bun), runs as non-root, and serves requests successfully
  3. GitHub Actions workflows use `actions/setup-node` + `npm ci` instead of `oven-sh/setup-bun` across every workflow file (CI, release, Docker publish)
  4. The pre-push `CLAUDE_CLI_VERSION` version-bump hook runs correctly under Node, confirmed not to shell out to `bun`
  5. A repo-wide search confirms zero remaining references to `bun`/`Bun` in source, workflows, Dockerfile, and package.json scripts
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 1-2 | v1.0 | 4/4 | Complete | 2026-05-05 |
| 3-6 | v1.1 | 11/11 | Complete | 2026-05-21 |
| 7-8 | v1.2 | 4/4 | Complete | 2026-06-02 |
| 9-11 | v1.3 | 7/7 | Complete | 2026-07-17 |
| 12. Foundation — Package Manager & TypeScript Config | v100.0 | 0/? | Not started | - |
| 13. Test Runner Migration | v100.0 | 0/? | Not started | - |
| 14. Runtime API Cleanup | v100.0 | 0/? | Not started | - |
| 15. HTTP Server Migration | v100.0 | 0/? | Not started | - |
| 16. Database Driver Migration | v100.0 | 0/? | Not started | - |
| 17. Dashboard Build Pipeline | v100.0 | 0/? | Not started | - |
| 18. Worker Threads Migration | v100.0 | 0/? | Not started | - |
| 19. CLI, Docker & CI Migration | v100.0 | 0/? | Not started | - |
