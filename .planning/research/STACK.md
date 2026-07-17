# Stack Research: Bun → Node.js Migration

**Domain:** Runtime migration for a Bun-based Claude API load-balancer proxy (better-ccflare fork) — replacing 6 Bun-specific pieces with Node.js equivalents while staying incrementally deployable.
**Researched:** 2026-07-17
**Confidence:** HIGH overall (all versions verified via npm registry `curl` + web search; `node:sqlite` WAL behavior verified by direct execution against locally-installed Node v24.18.0; two items — SEA cross-compile mechanics, worker_threads transferable-buffer edge cases — are MEDIUM, verified via docs/web search only, not hands-on tested in this environment)

**Node version floor confirmed:** Node 24 is the current Active LTS line as of mid-2026 (LTS since 2025-10-28, EOL 2028-04-30; Node 26 is Current/non-LTS until it becomes LTS Oct 2026). The "Node 24 floor" locked decision is correct and current — do not revisit. This environment has Node v24.18.0 installed, used for hands-on verification below.

## Overview: Bun Piece → Node.js Replacement

| # | Bun piece | Replacement | Confidence | New dependency? |
|---|-----------|--------------|------------|------------------|
| 1 | `Bun.serve()` (Fetch-API `fetch(req: Request): Response`) | `node:http` + **`srvx`** adapter (keep Fetch API handler signature) | HIGH | Yes — 1 small dep |
| 2 | `bun:test` | **`vitest`** | HIGH | Yes — devDependency |
| 3a | `bun:sqlite` (WAL, shared-in-process) | **`better-sqlite3`** | HIGH | Yes — native binding |
| 3b | `Bun.SQL` (Postgres path) | **`pg`** (node-postgres) | HIGH | Yes — pure JS |
| 4 | Bun `Worker` (web-standard API) + Bun's build-time inlining | **`node:worker_threads`** + drop inlining entirely | HIGH | No — built-in |
| 5 | `bun build --compile` | **`bin` field + shebang script** (primary) + optional **Node SEA** (secondary, for no-runtime binaries) | MEDIUM-HIGH | No — built-in |
| 6 | `bun.lock` / Bun workspaces | **npm workspaces** (already locked-in) | HIGH | No |

---

## 1. HTTP Server: `Bun.serve()` → `node:http` + srvx

### What the current code actually does (verified by reading `apps/server/src/server.ts` and `packages/http-api/src/router.ts`)

The server is **already framework-free** — `Bun.serve({ fetch(req: Request) { ... return new Response(...) } })`. Every handler in the ~950-line `router.ts` and the ~40 handler files under `packages/http-api/src/handlers/` is written against the **Fetch API** (`Request` in, `Response` out), including streaming `Response` bodies for SSE passthrough (`handleProxy`, `handleResponsesRequest`). This is the single most important fact for this decision: **the handler contract must be preserved**, or every handler in the router needs a rewrite.

### Recommendation: `node:http` (`createServer`) wrapped by **`srvx`**, not a full framework

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| `node:http` | built-in (Node 24) | Underlying TCP/HTTP transport | Already the substrate every Node HTTP option uses; zero dependency |
| `srvx` | `0.11.22` (npm, verified) | Converts `node:http`'s `IncomingMessage`/`ServerResponse` into Fetch API `Request`/`Response` so the existing `fetch(req: Request): Response` handler signature — and the entire router/handler layer — needs **no rewrite** | Purpose-built for exactly this problem (h3/UnJS team, the same authors behind Nitro/h3 v2); runtime-agnostic (also runs on Bun/Deno) so it doesn't reintroduce a single-vendor runtime dependency; supports streaming `ReadableStream` response bodies (needed for SSE/proxy passthrough) and inline TLS `cert`/`key` (mirrors the existing `tls: { key, cert }` block in `server.ts`) |

**Why not Hono/Fastify/Express:** This proxy needs low-overhead, close-to-the-wire request/response streaming, not routing sugar, middleware chains, or validation — the project already hand-rolls its own router (`APIRouter` class + handler factories) and explicitly favors minimal dependencies (`function-first`, "avoid unneeded frameworks" per project conventions). Adding Hono or Fastify would mean **either** keep them purely as a thin Node adapter (in which case `srvx` does the same job with less surface area and no routing-API lock-in) **or** rewrite the router to the framework's routing DSL — pure cost, no benefit, for a proxy that is 100% custom-routed already.

- Bundle size: Hono ~7.2KB gzip vs Express ~236KB vs Fastify ~130KB — irrelevant here since none of the routing/middleware surface is used; `srvx`'s job is narrower and correspondingly smaller.
- Downloads (verified via npm downloads API): Hono `4.12.30` / `@hono/node-server 2.0.10`, Fastify `5.10.0`, Express `5.2.1` — all mature and current, but not the right shape for this codebase's needs.
- `srvx` shows ~33.7M/week on the npm download API — high because it's pulled in transitively by Nitro/h3-based tooling (Vite/Nuxt ecosystem), a strong signal of production hardening despite the `0.x` version number.

**Gotchas moving Bun → node:http/srvx:**
- **Idle timeout for SSE/streaming.** Bun's `idleTimeout` server option (`NETWORK.IDLE_TIMEOUT_MAX` in `server.ts`) has no 1:1 equivalent — Node's `http.Server` uses `keepAliveTimeout`/`headersTimeout`, and a long-lived SSE stream can still be killed by socket-level timeouts unless explicitly disabled per-request (`res.socket?.setTimeout(0)` or `server.setTimeout(0)`, analogous to Bun's own documented `server.timeout(req, 0)` escape hatch for SSE). This must be explicitly re-implemented, not assumed to carry over — flag as a phase-specific risk given the project's two open debug sessions about stalled/dropped streaming requests.
- `Bun.file(...)`, `Bun.resolveSync(...)` used for dashboard asset serving in `server.ts` have no Node equivalent — replace with `node:fs` (`readFileSync`/`createReadStream`) and `require.resolve`/`import.meta.resolve`.
- WebSocket upgrade handling (Codex's `/v1/responses` upgrade rejection path) — `node:http`'s `upgrade` event must be wired manually or left to `srvx`/`node:http`'s default (which, like today, simply doesn't handle the upgrade — verify the reject-cleanly behavior is preserved).

---

## 2. Test Runner: `bun:test` → vitest

### What the current code actually does (verified: 167 `*.test.ts` files, spot-checked several)

Tests use `import { describe, expect, it } from "bun:test"` plus `mock()` and `mock.module()` for fetch/module mocking (jest-style fluent `expect().toBe()` assertions, `describe`/`it` blocks).

### Recommendation

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| `vitest` | `4.1.10` (npm, verified) | Test runner + assertions + mocking | `bun:test`'s API is a deliberate jest/vitest-compatible subset (`describe/it/expect`, `mock()` ≈ `vi.fn()`, `mock.module()` ≈ `vi.mock()`) — migrating 167 files is a mechanical import-and-rename pass, not a rewrite. `node:test` would be a much larger diff (see below). |

**Migration cost: vitest vs `node:test` — concrete, not hypothetical**

| | `vitest` | `node:test` |
|---|---|---|
| Assertions | `expect(x).toBe(y)` — **identical to `bun:test`**, zero rewrite | `node:assert/strict` only — `assert.strictEqual(x, y)`; every `expect()` call across 167 files needs rewriting, or you bolt on the standalone `expect` npm package anyway (defeats the "built-in, no deps" argument) |
| Mocking | `vi.fn()` / `vi.mock()` — near-identical shape to `mock()` / `mock.module()` | `t.mock.fn()` / `t.mock.method()`, context-bound to the test's `TestContext` — structurally different call pattern, no direct module-mock equivalent without extra tooling |
| `describe`/`it` | Yes, matches current structure | Yes (Node 18+), structurally compatible |
| TypeScript + TS `enum` | Vitest bundles esbuild for TS transform — handles `enum` natively, no extra flags | Node's native `.ts` execution (see below) is **type-stripping only** by default; the two `enum` declarations in this codebase (`packages/types/src/conversation.ts::ContentBlockType`, `packages/types/src/strategy.ts::StrategyName`) throw at load unless run with `--experimental-transform-types` (still experimental in Node 24) |
| Watch mode / DX | Yes | No (spartan by design) |

**Verdict:** `node:test` is the right call for a zero-dependency leaf library; it is the wrong call for this codebase's 167-file jest-shaped suite where the assertion and mocking APIs are the dominant migration cost. Recommend vitest. If dependency-count purity is a hard requirement later, the fallback path is: convert the 2 `enum`s to `as const` unions (small, isolated change, and independently a good idea — TypeScript is trending away from runtime enums, and Node 26 tightens restrictions on them further) + rewrite assertions/mocks to `node:assert`/`t.mock` — treat this as a possible **follow-up milestone**, not this one.

**Gotcha:** Bun's TS-native test execution (no build step) needs a Node equivalent for local `vitest` runs — vitest handles this itself (esbuild-based transform), so no separate build step is needed to run tests, unlike production builds.

---

## 3. Database Drivers

### 3a. SQLite: `bun:sqlite` → better-sqlite3 (not `node:sqlite`, yet)

**Verified hands-on** in this environment (Node v24.18.0):
```
node:sqlite loaded OK, no flag required (--experimental-sqlite is NOT needed)
PRAGMA journal_mode = WAL on a file-backed DatabaseSync → returns "wal", write succeeds
```
So `node:sqlite` **does** support WAL mode and works unflagged on the Node 24 floor. But stability status is the deciding factor:

| Module | Node 24 stability | Notes |
|--------|--------------------|-------|
| `node:sqlite` | **Stability 1.1 "Active development"** | Not subject to semver — breaking changes can land in any Node 24.x patch/minor. Reaches 1.2 "Release Candidate" only in Node 25.7 (a *later*, non-LTS-at-time-of-writing line) |
| `better-sqlite3` | N/A (external, semver'd) | `12.11.1` (npm, verified), 7.67M weekly downloads (verified via npm downloads API), mature native binding, the de facto standard sync SQLite driver for Node since ~2018 |

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| `better-sqlite3` | `12.11.1` | SQLite driver (sync, WAL-mode, shared-in-process) | This DB is production-critical (WAL, shared across the process, already the subject of two open debug sessions about `SQLITE_BUSY` lock contention). Betting that on a module Node itself still classifies as "active development / no semver guarantee" on the exact Node version this project is floor-pinned to is the wrong risk trade for a business-continuity-driven migration. `better-sqlite3` is synchronous by design (same execution model as `bun:sqlite` today — no async/await surprises), widely deployed at this project's scale, and its native-binding maintenance burden (prebuilt binaries per platform/arch) is a well-worn, well-tooled problem, not a novel one. |

**Migration path forward:** Re-evaluate `node:sqlite` once it reaches Stability 2 ("Stable") on whatever Node LTS line is current at that time — track `nodejs/node#57445` (stabilization tracking issue). Don't block this milestone on that.

**Gotcha:** Both drivers are synchronous/blocking (this is *not* a regression — `bun:sqlite` is sync too). Each `worker_threads` Worker must open its **own** `better-sqlite3` connection — handles aren't transferable across threads, same constraint that already exists today with `bun:sqlite` in the 3 Bun workers.

### 3b. Postgres: `Bun.SQL` → pg (node-postgres), not postgres.js

**Verified by reading** `packages/database/src/adapters/bun-sql-adapter.ts`: the existing `BunSqlAdapter` already normalizes both backends behind one interface (`query`/`get`/`run`/`runWithChanges`, all Promise-returning) and includes a hand-rolled `convertPlaceholders()` function that rewrites SQLite's `?`/`?N` placeholders into Postgres `$N` — i.e. **all SQL in this codebase is written as plain parameterized strings + a params array**, not tagged template literals.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| `pg` | `8.22.0` (npm, verified) | Postgres driver for the production PG path (`migrations-pg.ts`) | `pg`'s primary API — `client.query(text: string, values: any[])` — is a **direct structural match** for what `BunSqlAdapter` already produces (a placeholder-converted SQL string + params array). `postgres.js`'s primary API is tagged-template-literal based; using it here would mean routing every call through `sql.unsafe(text, params)`, which the library itself flags as the injection-risk escape hatch, not the intended call pattern — a worse fit for a codebase that generates SQL strings dynamically. `pg` also has the larger install base (36.1M weekly downloads vs. postgres.js's 11.5M, both verified via npm downloads API) and is the dependency underneath Prisma/Knex, i.e. the long-term-maintenance-safe default. |

**Gotcha:** `pg` returns `BIGINT`/`NUMERIC` columns as JS strings by default (to avoid silent precision loss) — `Bun.SQL` may coerce differently. Audit any column read through the adapter that expects a JS `number` for an `int8`/`bigint` column and either cast at the SQL level or configure `pg.types.setTypeParser(20, parseInt)` explicitly, matching whatever behavior `Bun.SQL` currently produces (verify empirically per-column during the port — flag as phase-specific research, not resolved here).

---

## 4. Worker Threads: Bun `Worker` → node:worker_threads (and drop the inlining step entirely)

### What the current code actually does (verified by reading `usage-worker-controller.ts`, `database-operations.ts`, `integrity-check-runner.ts`, and `apps/cli/package.json`'s `build` script)

This is the biggest architectural finding of this research. The 3 "inline" worker files are **not** solving a worker-threads problem — they're solving a **single-file-binary packaging** problem:

1. `apps/cli/package.json`'s `build` script runs `bun build <worker>.ts --outfile ... --target=bun --minify` for each of the 3 workers, base64-encodes the output, and writes it as a string constant (`EMBEDDED_WORKER_CODE`, `EMBEDDED_VACUUM_WORKER_CODE`, `EMBEDDED_INTEGRITY_CHECK_WORKER_CODE`) into the `inline-*.ts` files.
2. At runtime, the 3 spawn sites (`usage-worker-controller.ts:388`, `database-operations.ts:1427`/`1546`, `integrity-check-runner.ts:53`) do: `Buffer.from(EMBEDDED_CODE, "base64") → Blob → URL.createObjectURL(blob) → new Worker(url, { smol: true })`, with a fallback to `new Worker(new URL("./worker-file.ts", import.meta.url).href)` for dev (unbundled source).
3. This whole dance exists **only** because `dist/better-ccflare` is compiled into a **single-file executable** (`bun build --compile`) that has no sibling files on disk at runtime — the worker source has to be baked into the binary's own data.
4. Workers are spawned via the **web-standard `Worker` global** (`self.postMessage`, `new Worker(url, opts)`), not `node:worker_threads` — Bun implements the browser API natively; `{ smol: true }` is a Bun-only reduced-memory flag with no Node equivalent.

### Recommendation

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| `node:worker_threads` | built-in (Node 24) | Worker threads for usage-collector, vacuum, and integrity-check workers | **If the Node build ships as a normal multi-file `node_modules`-backed package (recommended — see §5), the entire inlining/base64/Blob mechanism becomes unnecessary and should be deleted, not ported.** Node has no single-file-binary constraint in this deployment shape; workers can be referenced by plain file path exactly like the existing dev-mode fallback already does (`new Worker(new URL("./vacuum-worker.js", import.meta.url))`), which is Node's own idiomatic, documented pattern for locating a sibling worker file relative to the calling module. |

**Concrete rewrite per spawn site:**
- Main thread: `new Worker(url, { smol: true })` → `new Worker(new URL("./worker-file.js", import.meta.url))` (drop `smol`; drop Blob/base64 entirely; reference the built `.js` file directly since Node ships all dist files, not a single blob)
- Worker thread: `self.postMessage(...)` / `self.onmessage` → `import { parentPort } from "node:worker_threads"`; `parentPort.postMessage(...)` / `parentPort.on("message", ...)`
- Transferable `ArrayBuffer`s (used by the usage-collector worker): API-compatible — Node's `postMessage(value, transferList)` and Bun's both implement the same transfer-list semantics (an `ArrayBuffer` in `transferList` is moved, not copied, and becomes unusable on the sending side afterward). No behavioral rewrite needed beyond the import path, verified against both the Node `worker_threads` docs and Bun's own documented Node-compat layer for `worker_threads`.
- `EMBEDDED_WORKER_CODE`/`EMBEDDED_VACUUM_WORKER_CODE`/`EMBEDDED_INTEGRITY_CHECK_WORKER_CODE` constants, the base64-encode step in `apps/cli/package.json`'s `build` script, and the `inline-*.ts` files themselves (already flagged in `CLAUDE.md` as auto-generated/do-not-edit) are **deleted entirely** by this migration, not ported — this simplifies the build script by removing roughly half its content.

**Only exception:** if a later phase chooses to ALSO compile `apps/server` into a Node SEA single-file executable (not recommended for the server — see §5), worker files would need to be re-embedded via SEA's `assets` field and instantiated with `eval: true` mode instead of a file path, reintroducing a version of today's complexity. Avoid this by keeping the server as a normal multi-file Node deployment (which is already how most production Node services and this project's own Docker image work).

---

## 5. Standalone CLI Binary: `bun build --compile` → npm `bin` + shebang (primary), Node SEA (secondary)

### What the current code actually does (verified by reading `apps/cli/package.json`)

`"bin": { "better-ccflare": "dist/better-ccflare" }` — the npm-published artifact is **directly** a `bun build src/main.ts --compile --target=bun --minify` single-file executable (not a JS file with a shebang). Separate `build:linux-amd64`/`arm64`/`macos-x86_64`/`macos-arm64`/`windows-x64` scripts cross-compile additional binaries (Bun supports cross-target compilation from a single host — `--target=bun-windows-x64` etc.), presumably for GitHub Releases. The `package.json` already declares `"engines": { "node": ">=18.0.0" }` even though the current binary needs no Node runtime at all (it embeds Bun).

### Recommendation: two-tier approach

| Tier | Technology | Version | Purpose | Why Recommended |
|------|------------|---------|---------|------------------|
| Primary (`npm install -g better-ccflare`) | Plain Node script, `bin` field + `#!/usr/bin/env node` shebang | N/A (built-in `npm`/`node` mechanism) | Default install path | Zero build tooling, zero third-party packager risk — the exact opposite of "single-vendor runtime risk" this whole migration exists to eliminate. `engines.node >= 24` becomes an **actually-enforced** requirement instead of the currently-aspirational `>=18.0.0` claim on a binary that needs no Node at all. This is standard practice for the vast majority of published npm CLIs. |
| Secondary (optional, GitHub Releases parity with today's `build:linux-amd64` etc.) | **Node Single Executable Applications (SEA)** — official Node core feature | Stable since Node 22, "significantly improved" in Node 24 (this project's floor); the newer one-step `--build-sea` flag needs Node 25.5+ (Current, not yet this project's LTS floor) — use the older 3-step flow (`--experimental-sea-config` → blob generation → `postject` injection) on Node 24 | No-Node-runtime-required binaries for direct download | Officially maintained by the Node core team — directly serves this migration's vendor-risk-reduction goal, unlike third-party packagers |

**What NOT to use for packaging, and why:**

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `pkg` (vercel/pkg) | Deprecated by Vercel; now community-maintained; "almost unmaintained" per current community sources because maintaining patched Node binaries per platform is the hard, ongoing part nobody wants to own | Node SEA (official) |
| `nexe` | "Active again after a 2024 refresh" but a third-party project with a history of maintenance gaps — reintroduces exactly the single-maintainer vendor risk this migration is meant to eliminate | Node SEA (official) |

**Concrete gotchas moving off Bun's `--compile`:**
- **No cross-compilation.** Bun's `--target=bun-windows-x64`/`bun-darwin-arm64`/etc. lets you build all platform binaries from one host. Node SEA has **no equivalent** — each SEA binary must be built natively on its target OS/arch (the documented workaround is Docker containers per target, or, more simply, a GitHub Actions matrix build with native `windows-latest`/`macos-latest`/`ubuntu-latest` runners — standard and well-supported, just a CI topology change from "one job, five `--target` flags" to "five jobs, one per OS").
- **Worker threads inside a SEA binary** need assets embedded via the SEA config's `assets` field and instantiated with `eval: true`, not a file path — only relevant if the server itself is ever SEA-packaged; avoided entirely by keeping `apps/server` as a normal multi-file Node deployment (recommended; see §4).
- `postject`'s injection step and `useCodeCache`/`useSnapshot` must be **disabled** when generating a SEA for a different platform than the build host (can't cross-compile code caches/snapshots — they're platform-specific and crash on mismatch).
- The `prepublishOnly`/`postpublish` scripts in `apps/cli/package.json` (currently: build the compiled binary, strip workspace deps from `package.json`, `chmod +x`) need rewriting for the new artifact shape — `chmod +x` still applies to a shebang script, but the build step changes from `bun build --compile` to `tsc`/`esbuild` bundling to plain `.js`.

---

## 6. Package Manager / Workspaces: `bun.lock` → npm workspaces

This is a **locked decision** (npm workspaces, chosen specifically to minimize additional vendor dependency) — not re-litigated here, only the mechanics of the migration itself.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| npm workspaces | npm ≥ 10 (ships with Node 24) | Monorepo package linking across `apps/server`, `apps/cli`, ~15 `packages/` | Already the locked decision; zero additional dependency since it ships with Node's bundled npm |

**Concrete migration steps and gotchas (verified against current npm/Bun workspace docs):**
- **`workspace:*` protocol:** Bun supports the same `workspace:*`/`workspace:^`/`workspace:~` syntax as npm/pnpm/yarn — the `package.json` `dependencies` entries referencing sibling `@better-ccflare/*` packages as `"workspace:*"` need **no rewrite**; npm's workspace resolution understands this protocol natively as of npm 7+, so this should be closer to a lockfile regeneration than a manual edit pass. Verify during migration that npm doesn't silently substitute a registry version instead of the local symlink for any package (rare but has historically bitten mixed-manager repos).
- **Lockfile replacement:** `bun.lock` has no direct converter to `package-lock.json` — the migration path is delete `bun.lock`, run `npm install` fresh at the repo root, and commit the generated `package-lock.json`. Pin exact versions in each `package.json` beforehand if reproducibility during the transition matters, since npm's resolver can pick different transitive versions than Bun's resolver did.
- **Phantom dependencies:** npm workspaces (like Yarn 1) hoist dependencies to the root `node_modules` by default, which can let a package import something it never declared if a sibling workspace happens to hoist it — this already-known monorepo footgun should be caught by `bun run lint`/`typecheck` (soon `npm run lint`/`typecheck`) in CI after the switch, but call it out explicitly in the phase that does this migration since it's a **silent** failure mode (works locally, breaks when a package is later extracted/published standalone).
- **CI/scripts referencing `bun run <script>`:** every `package.json` `scripts` entry invoked via `bun run` in CI, `pre-merge-check.sh`/`post-merge-export.sh`, and this project's own `CLAUDE.md` command reference table needs updating to `npm run` — track as an explicit phase deliverable, not a byproduct.

---

## Installation

```bash
# Core replacements
npm install srvx better-sqlite3 pg

# Dev dependencies
npm install -D vitest @types/pg @types/node@^26

# Remove (after migration complete)
npm uninstall bun-types   # if present as a dep anywhere
rm bun.lock
```

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `node:sqlite` (as of Node 24) | Stability 1.1 "Active development" — no semver guarantee, can break in a patch release, on the exact Node line this project floors on | `better-sqlite3` (mature, semver'd, 12.11.1) |
| `postgres.js` for this codebase specifically | Tagged-template-literal-first API doesn't match the existing `?`→`$N` placeholder-string + params-array pattern already baked into `BunSqlAdapter`; would force routing through `.unsafe()` | `pg` (`query(text, values)` matches directly) |
| Hono / Fastify / Express as the HTTP layer | This proxy has zero routing/middleware needs beyond what its own hand-rolled `APIRouter` already does; adding a framework means either an unused surface area or a router rewrite for no functional gain | `node:http` + `srvx` (adapter only, keeps existing `fetch(req): Response` handlers untouched) |
| `pkg` (vercel/pkg) for CLI packaging | Deprecated by Vercel, community-maintained, historically the hardest part (patched Node binaries per platform) is under-resourced | Node SEA (official, matches this migration's vendor-risk-reduction goal) |
| `nexe` for CLI packaging | Third-party, history of maintenance gaps, reintroduces single-maintainer vendor risk | Node SEA (official) |
| `node:test` as the sole test runner for this codebase | Requires rewriting all 167 files' `expect()` assertions to `node:assert` and all `mock()`/`mock.module()` calls to `t.mock.fn()`/`t.mock.method()` — a large, mechanical-but-risky diff for no DX gain (no watch mode, no snapshot testing) | `vitest` (near drop-in for `bun:test`'s jest-shaped API) |

## Stack Patterns by Variant

**If the goal is minimum added dependencies at any cost (stricter than the current "npm workspaces only" scope):**
- Skip `srvx`; hand-roll a ~50-line `IncomingMessage`/`ServerResponse` ↔ `Request`/`Response` adapter instead.
- Because the conversion logic itself is small and well-understood, but given this proxy's correctness depends heavily on exact streaming/SSE semantics, a hand-rolled adapter carries real regression risk against a purpose-built, widely-used one (`srvx`) for a single extra `npm install`. Recommend against this variant unless dependency count becomes a hard gate.

**If the CLI's no-Node-runtime binary distribution (GitHub Releases) is dropped as a requirement:**
- Skip Node SEA entirely; publish only the `bin` + shebang script.
- Because SEA's per-platform native-build requirement (no cross-compilation) meaningfully complicates CI versus Bun's current single-command multi-target build — only worth the complexity if that distribution channel is actively used today.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `better-sqlite3@12.11.1` | Node 24.x | Prebuilt binaries ship for current LTS lines; verify prebuild coverage for Node 24 + target Docker base image arch (`debian:bookworm-slim`, amd64/arm64) during the phase that does this swap — fall back to source compile (`node-gyp`) only if no prebuild exists |
| `pg@8.22.0` | Node 24.x, PostgreSQL (any version already targeted by `migrations-pg.ts`) | No native bindings — pure JS, no platform-prebuild risk at all |
| `srvx@0.11.22` | Node 24.x, `node:http` | Also runs unmodified on Bun/Deno if a future rollback or dual-runtime CI need ever arises |
| `vitest@4.1.10` | Node 24.x, TypeScript (bundles its own esbuild-based TS transform — handles the 2 existing TS `enum`s natively, unlike Node's native `.ts` execution) | No conflict with `tsc --noEmit` remaining the type-check step; vitest doesn't replace `tsc`, only `bun test` |
| Node native `.ts` execution (`node <file>.ts`, no flags, Node 24 default) | Erasable-syntax TypeScript only | **Cannot** run `packages/types/src/conversation.ts` (`enum ContentBlockType`) or `packages/types/src/strategy.ts` (`enum StrategyName`) directly without `--experimental-transform-types` (still experimental in Node 24). If any migration phase wants to run `.ts` source directly in production (skipping a bundler), convert these 2 enums to `as const` unions first — small, isolated, and independently good practice given TypeScript's broader move away from runtime enums (Node 26 tightens this further). |

## Sources

- [Node.js — Node.js Releases](https://nodejs.org/en/about/previous-releases) — LTS schedule
- [Node.js 24 Becomes LTS: What You Need to Know](https://nodesource.com/blog/nodejs-24-becomes-lts) — confirms Node 24 Active LTS status mid-2026
- npm registry `curl` (`registry.npmjs.org/<pkg>/latest`) — HIGH confidence, verified directly in this session: `srvx@0.11.22`, `better-sqlite3@12.11.1`, `pg@8.22.0`, `postgres@3.4.9`, `vitest@4.1.10`, `hono@4.12.30`, `@hono/node-server@2.0.10`, `fastify@5.10.0`, `express@5.2.1`
- npm downloads API (`api.npmjs.org/downloads/point/last-week/<pkg>`) — HIGH confidence, verified directly: srvx 33.76M/wk, better-sqlite3 7.67M/wk, pg 36.14M/wk, postgres 11.47M/wk
- Local execution against Node v24.18.0 in this environment — HIGH confidence, hands-on verified: `node:sqlite` loads unflagged, `PRAGMA journal_mode = WAL` succeeds on a file-backed `DatabaseSync`
- [SQLite | Node.js 24.15.0 Documentation](https://beta.docs.nodejs.org/sqlite.html) / [stabilization of node:sqlite module · Issue #57445](https://github.com/nodejs/node/issues/57445) — Stability 1.1 in Node 24, 1.2 (RC) only in Node 25.7
- [srvx - Universal Server](https://srvx.h3.dev/) / [Node.js Support - srvx](https://srvx.h3.dev/guide/node) — Fetch API ↔ node:http conversion, TLS options, streaming
- [Node.js SEA in 2026: Single Executable Apps Production Guide](https://www.hirenodejs.com/blog/nodejs-single-executable-applications-2026) — SEA stability/maturity in Node 24
- [Creating multi-platform/arch Single Executable Applications (SEA) · nodejs Discussion #4569](https://github.com/orgs/nodejs/discussions/4569) / [REQUEST: Support for cross-platform SEA generation · Issue #94](https://github.com/nodejs/single-executable/issues/94) — confirms no SEA cross-compilation
- [Pkg Alternatives and Reviews](https://www.libhunt.com/r/pkg) — pkg deprecation/maintenance status
- [pg vs postgres.js vs @neondatabase/serverless 2026 — PkgPulse](https://www.pkgpulse.com/guides/pg-vs-postgres-js-vs-neon-serverless-postgresql-drivers-2026) — API shape and download comparison
- [node:test vs Vitest vs Jest 2026 — PkgPulse](https://www.pkgpulse.com/guides/node-test-vs-vitest-vs-jest-native-test-runner-2026) — assertion/mocking API gap analysis, cross-checked against direct reading of this repo's 167 test files
- [Running TypeScript Natively | Node.js Learn](https://nodejs.org/learn/typescript/run-natively) / [Modules: TypeScript | Node.js v24.14.1 Documentation](https://nodejs.org/docs/latest-v24.x/api/typescript.html) — native `.ts` execution, enum limitation, `--experimental-transform-types`
- Direct repo reads (this session): `apps/server/src/server.ts`, `packages/http-api/src/router.ts`, `packages/database/src/adapters/bun-sql-adapter.ts`, `apps/cli/package.json`, `packages/proxy/src/usage-worker-controller.ts`, `packages/database/src/database-operations.ts`, `packages/database/src/integrity-check-runner.ts` — grounds every codebase-specific claim above in the actual current implementation, not assumption

---
*Stack research for: Bun-to-Node.js runtime migration (better-ccflare v100.0 milestone)*
*Researched: 2026-07-17*
