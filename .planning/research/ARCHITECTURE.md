# Architecture Research: Bun → Node.js Migration Integration

**Domain:** Runtime migration of an existing Bun monorepo (load balancer proxy) to Node.js
**Researched:** 2026-07-17
**Confidence:** HIGH (codebase facts, verified by direct file reads) / MEDIUM-HIGH (Node.js 24 API behavior, verified by web search against 2026 docs)

This is not greenfield architecture research — it documents how Node.js replacements plug into the **existing** better-ccflare architecture, with exact file paths, and derives a dependency-respecting phase order. Every claim about the current codebase was verified by reading the actual files (paths cited throughout); every claim about Node.js behavior was verified against current docs/search rather than assumed from training data.

## Cross-Cutting Concern (reads before any of the 6 questions): Bun's implicit module resolution is load-bearing everywhere

Before the 6 specific questions, one systemic fact governs almost all of them and must be understood first, because it changes the shape of every phase:

**Every workspace package's `package.json` points `main`/`exports` directly at TypeScript source, not compiled output.** e.g. `packages/core/package.json`:
```json
"main": "./src/index.ts",
"exports": { ".": "./src/index.ts" }
```
This pattern repeats across all ~19 packages. Bun's resolver + runtime transpiler makes `import { X } from "@better-ccflare/core"` resolve straight to `.ts` source and JIT-transpile it, with zero build step, in dev, in tests, and even inside spawned Bun Workers (`new Worker(new URl("./vacuum-worker.ts", ...))` loads TS directly — see Q3). There is no `dist/` for any internal package; `bun run apps/server/src/server.ts` runs uncompiled TS directly through 15 workspace package boundaries.

Node.js 24 ships type-stripping unflagged and on by default for `.ts` files (Node 23.6 unflagged `--experimental-strip-types`; Node 24 made it default behavior) — via `amaro` (SWC-based), applied to any `.ts`/`.mts`/`.cts` file loaded through Node's module system, including files reached via `package.json` `exports` pointing at `.ts`. In principle this means the existing `"main": "./src/index.ts"` pattern **can keep working under Node without a compile step** — but only if every `.ts` file in the dependency graph uses **erasable-only syntax**. Node's stripper explicitly rejects (does not run, throws at load time):
- `enum` (including `const enum`)
- **constructor parameter properties** (`constructor(private readonly x: T)`)
- `namespace`/`module` blocks containing runtime code
- legacy `import foo = require(...)` / export-assignment syntax
- experimental/legacy decorators
- JSX (irrelevant to backend packages, relevant to `dashboard-web/**/*.tsx` which is bundled, never run directly by Node)

Codebase audit result: **only 3 files use constructor parameter properties** (`packages/database/src/repositories/base.repository.ts`, `packages/database/src/repositories/stats.repository.ts`, `packages/ui-common/src/presenters.ts`) — small, mechanical fix (expand to explicit field + assignment in constructor body). No `enum`/`namespace`/legacy-import usages were found in a targeted scan of `src/` (non-test) files. This means the "run `.ts` directly, no build step" path is realistically achievable for the backend (server/CLI/packages) once those 3 files are fixed — this should land in the **first** phase (package manager migration) since it's a near-zero-cost unblock for everything downstream.

**Implication for phase ordering:** decide early (Phase 1–2) whether the long-term dev/runtime model is "Node native type-stripping, zero build step" (closest to current Bun DX) or "always compile via tsc/esbuild before running" (safer, catches type errors, but is a bigger DX change and a new build step to wire into every `dev`/`test`/`start` script). Given the milestone's "incremental, deployable at every phase" constraint, native type-stripping is the lower-risk choice for packages, reserving an explicit esbuild bundle step only for the two places that need a single self-contained artifact: worker code (Q3) and the standalone binary (Q6).

## Q1 — TypeScript configuration: single root tsconfig, one edit point

**Verified:** there is exactly **one** authoritative `tsconfig.json` at the repo root (`/home/coder/development/tsconfig.json`). All 19 package/app `tsconfig.json` files (`apps/server/tsconfig.json`, `apps/cli` has none — uses root directly via package.json scripts, `packages/*/tsconfig.json`) are two-line files of the form:
```json
{ "extends": "../../tsconfig.json", "include": ["src/**/*"] }
```
No package overrides `compilerOptions`. This means **Q1 is a single-file change**, not a per-package migration:

- `/home/coder/development/tsconfig.json` line 17: `"types": ["bun-types"]` → remove (or swap to `["node"]` once `@types/node` is installed). `@types/node` is currently only present as a devDependency of `apps/cli/package.json` (`"@types/node": "^20.0.0"` — also needs bumping to match the Node 24 floor, e.g. `@types/node@^24`).
- `"moduleResolution": "bundler"` — safe to keep if the eventual worker/binary build step uses esbuild (which respects "bundler"-style resolution, same as Bun); would need to become `"nodenext"`/`"node16"` only if the team drops all bundling and ships raw multi-file `dist/` output resolved by Node's own resolver. Recommend keeping `"bundler"` — no functional need to change it, and changing it is a larger, riskier edit than necessary for this milestone.
- `"lib": ["ESNext", "DOM", "DOM.Iterable"]` — the `DOM` lib is required for `packages/dashboard-web` (browser code, `document`, `window`, etc.) but is shared with every backend package via this single root config. This is a latent hazard once `@types/node` is added: `DOM` and `@types/node` both declare globals like `setTimeout`/`fetch`/`URL`/`Blob` with **different return/argument types** (DOM's `setTimeout` returns `number`; Node's returns `NodeJS.Timeout`). `skipLibCheck: true` is already set, which suppresses most of the resulting noise, but call sites that store the return value of `setTimeout`/`setInterval` typed as `number` (a DOM-lib assumption) will silently be wrong under Node's actual runtime value. **This is a concrete pitfall, not hypothetical** — grep shows `ReturnType<typeof setTimeout>` used defensively in several files already (e.g. `packages/database/src/adapters/bun-sql-adapter.ts`), which is the correct pattern; any code using bare `number` for a timer handle needs an audit.
- **Recommendation:** rather than fight one shared root config across a DOM-needing package (dashboard) and 18 Node-needing packages, split into `tsconfig.base.json` (shared strict/module settings) + `tsconfig.node.json` (`types: ["node"]`, no DOM) + point `packages/dashboard-web/tsconfig.json` at a `tsconfig.dom.json` variant (`types: ["node"]` is unnecessary there anyway since it's browser-only code bundled by esbuild, never executed by Node). This is a small structural change (add 2 files, edit 1 root file, edit dashboard-web's 2-line extends) that removes the DOM/Node lib collision risk entirely rather than relying on `skipLibCheck` to paper over it.
- `packages/dashboard-web/package.json` and 3 other packages (`ui-constants`, `errors`) carry their own **local** `"@types/bun": "latest"` devDependency (found via `node_modules/@types/bun` presence) — these are redundant per-package copies that must also be removed/replaced, not just the root one.
- Root `package.json` devDependencies: `"@types/bun": "latest"`, `"bun-types": "latest"` — remove; add `"@types/node": "^24.x"`.
- `apps/cli/package.json` `"engines": { "node": ">=18.0.0" }` — bump to `">=24.0.0"` to match the locked Node 24 floor (currently understates the real requirement even pre-migration, since it targets npm-published CLI consumers, not the Bun-only dev workflow).

## Q2 — Dashboard embedding: `Bun.build()` browser bundle replaced by esbuild; the base64-embed step itself is already Bun-free and needs no change

Two genuinely separate steps currently exist in `packages/dashboard-web/`, and they are **not equally coupled to Bun**:

1. **`packages/dashboard-web/build.ts`** — Bun-coupled. Calls `Bun.build({ entrypoints: ["src/index.html"], plugins: [bunPluginTailwind], minify: true, target: "browser", sourcemap: "linked", splitting: true, define: {...} })`, writes a `manifest.json`. Two Bun-specific things to replace:
   - `Bun.build()` itself → esbuild (`esbuild.build({ entryPoints, bundle: true, minify: true, platform: "browser", format: "esm", splitting: true, sourcemap: true, outdir, define })`).
   - **HTML-as-entrypoint is a Bun-only feature** (`entrypoints: ["src/index.html"]` auto-discovers linked `<script>`/`<link>` tags and rewrites them). esbuild has no equivalent — it only takes JS/TS/CSS entry points. Replacement needs one of: (a) point esbuild at `src/frontend.tsx` directly and hand-write/template `dist/index.html` with the known output filenames (mirrors what the existing `manifest.json` generation already does — the manifest step can be extended to also emit the HTML), or (b) adopt a small purpose-built bundler that does support HTML entrypoints (Vite is the standard here) if the team wants less hand-rolled glue. Given the "avoid redesign" constraint, (a) is the lower-risk choice — it's roughly a 20–30 line addition to the existing build script, not a new toolchain.
   - `bun-plugin-tailwind` (a Bun.build plugin) → replace with the standalone `@tailwindcss/cli` (or PostCSS + `tailwindcss` package) run as a separate `tailwindcss -i src/styles.css -o dist/styles.css --minify` step before/alongside the esbuild JS bundle. Tailwind 4's CLI is bundler-agnostic, so this is a drop-in swap, not a redesign.

2. **`packages/dashboard-web/embed.ts`** — **already Bun-free.** Verified: it imports only `node:fs/promises` (`readdir`, `readFile`) and `node:path`. It reads every file in `dist/` (the output of step 1), base64-encodes it, and writes `dist/embedded.ts` exporting `embeddedDashboard: Record<string, EmbeddedAsset>` and `dashboardManifest`. **This script runs unchanged under Node.** No integration work needed here beyond re-pointing it at whatever `dist/` esbuild produces (same directory convention).

**Where the server consumes it:** `apps/server/src/server.ts` line 103 does `await import("@better-ccflare/dashboard-web/dist/embedded")` — a **runtime dynamic import of a generated `.ts` file**, resolved through the package's module graph, not a Bun-bundler-time inline. Because `embed.ts` produces a plain `.ts` file with only object-literal exports (fully erasable syntax), this dynamic import continues to work under Node's native type-stripping with no change to `server.ts` itself, **provided** `packages/dashboard-web/package.json` exposes a resolvable `exports` entry for `./dist/embedded` (currently resolution for this subpath relies on the root tsconfig's `"paths"` mapping for type-checking plus Bun's permissive extensionless/`.ts`-suffix runtime resolution — Node's ESM resolver is strict about extensions and about packages declaring subpath exports, so `dashboard-web/package.json` needs an explicit addition: `"exports": { ".": "./src/index.ts", "./dist/embedded": "./dist/embedded.ts", "./dist/manifest.json": "./dist/manifest.json" }`). This `exports` map addition is a small, precise, low-risk change — but it is a **required** change, not optional, because Node will otherwise throw `ERR_PACKAGE_PATH_NOT_EXPORTED` on that dynamic import.

Also uses `Bun.file(fullPath)` at `apps/server/src/server.ts:210` for serving individual dashboard assets from disk in dev-mode fallback (when `embeddedDashboard` isn't populated) — replace with `node:fs`: `new Response(await readFile(fullPath))` or a `Readable`-backed stream via `node:fs.createReadStream` piped into the response (see Q4 for the general `Bun.file` → `node:fs` pattern, used identically in `packages/logger/src/file-writer.ts:136`).

## Q3 — Inline worker generation: the trickiest piece, worked through in full

### What Bun's bundler is actually doing (verified from `apps/cli/package.json`'s `build` script — this is NOT a separate build.ts, it's inlined directly in the npm script)

For each of the 4 workers (`vacuum-worker.ts`, `incremental-vacuum-worker.ts`, `integrity-check-worker.ts` in `packages/database/src/`, `post-processor.worker.ts` in `packages/proxy/src/`), the build does, per worker:
1. `bun build <worker-source>.ts --outfile dist/<worker>.js --target=bun --minify` — resolves all imports (including `@better-ccflare/*` workspace packages and `bun:sqlite`) into one self-contained bundled JS file.
2. Reads that output file, base64-encodes it, writes it into `packages/{database,proxy}/src/inline-<worker>.ts` as `export const EMBEDDED_<NAME>_WORKER_CODE = "<base64>";`.
3. A pre-step writes an **empty placeholder** version of each `inline-*.ts` file if it doesn't already exist (`if (!fs.existsSync(...)) fs.writeFileSync(..., 'export const EMBEDDED_..._CODE = "";')`) — this exists purely so `tsc`/imports don't fail before the real build has run once. This placeholder-generation trick becomes largely unnecessary once assets are handled via a proper build pipeline with declared build-order dependencies (see below), but the underlying reason it exists — "the file that gets imported must exist before typecheck runs" — is a real constraint any Node replacement must still satisfy in CI ordering.

### How the embedded code is consumed at runtime (verified — this exact pattern repeats 4 times: `packages/proxy/src/usage-worker-controller.ts:385-403`, `packages/database/src/integrity-check-runner.ts:46-58`, `packages/database/src/database-operations.ts` twice around lines 1427-1436 and ~1540-1550)

```ts
if (EMBEDDED_WORKER_CODE) {
  const workerCode = Buffer.from(EMBEDDED_WORKER_CODE, "base64").toString("utf8");
  const blob = new Blob([workerCode], { type: "text/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  w = new Worker(workerUrl, { smol: true });          // production / compiled-binary path
  Promise.resolve().then(() => URL.revokeObjectURL(workerUrl));
} else {
  w = new Worker(new URL("./post-processor.worker.ts", import.meta.url).href);  // dev / source-checkout path
}
```
Plus: `worker.onmessage =` / `worker.onerror =` (Web-Worker event-handler style, not EventEmitter), `{ smol: true }` (Bun-only low-memory flag), `w.unref()` (Bun extension so the worker doesn't keep the process alive), and inside the workers themselves: `self.onmessage = ...` / `self.postMessage(...)` (Web-Worker global `self`, verified in `packages/database/src/vacuum-worker.ts:25` and `packages/proxy/src/post-processor.worker.ts:773,799` etc.).

### Why this doesn't translate 1:1 to Node, and what does

Node's `node:worker_threads` is **API-incompatible at every one of these points**, not just "different import path":

| Bun/Web pattern | Node `node:worker_threads` reality |
|---|---|
| Global `Worker` | Must `import { Worker } from "node:worker_threads"` — no global. |
| `new Worker(blobURL)` from a `Blob`+`createObjectURL` | **Blob URLs are not a valid Worker source in `node:worker_threads`.** No equivalent construct. |
| `{ smol: true }` | Bun-only heap-reduction flag; no Node equivalent (closest is `resourceLimits: { maxOldGenerationSizeMb }`, not equivalent semantics — drop or approximate, not a straight swap). |
| `worker.onmessage =`, `worker.onerror =` | Node's `Worker` is an `EventEmitter`: `worker.on("message", ...)`, `worker.on("error", ...)`. Both `UsageWorkerController` and `integrity-check-runner.ts` need this rewritten (mechanical, not risky). |
| `self.onmessage` / `self.postMessage` inside worker | Node worker context: `import { parentPort } from "node:worker_threads"`; `parentPort.on("message", ...)`, `parentPort.postMessage(...)`. Every worker source file's top needs this swap. |
| `worker.terminate()` (Bun: fire-and-forget-ish) | Node's `terminate()` returns `Promise<number>` (exit code) — existing callers that don't await it still work (unhandled promise, not an error), but should be awaited for cleanliness. |
| Dev-mode `new Worker(new URL("./x.ts", import.meta.url))` | **This part actually still works under Node 24**, per the cross-cutting section above — Node's type-stripping applies to any `.ts` entry file it loads, including a worker thread's entry point, as long as that file (and everything it imports) is erasable-syntax-only. Confirms the dev-mode fallback branch needs only the `self`→`parentPort` and `Worker` import fixes, not a bundler. |
| Production embedded-string spawn (`EMBEDDED_WORKER_CODE`) | **No direct equivalent** — this is the genuinely hard part, addressed below. |

### The core problem: Node's `Worker` constructor cannot take an ESM source string

`node:worker_threads` supports `new Worker(code, { eval: true })` to spawn from a source **string** (closest analog to the Blob-URL trick) — but this only reliably supports **CommonJS** source; there is no supported way to pass ESM source as an eval string (confirmed open Node.js issue tracking this gap — see Sources). Every worker source file in this codebase is ESM (`"type": "module"` at every `package.json`), and `packages/proxy/src/post-processor.worker.ts:81` has **top-level `await initPayloadEncryption();`** at module scope — which additionally cannot exist in a CommonJS bundle at all (CJS has no top-level await).

**Recommended resolution (two-part, and this is the one piece of this doc that requires a small source-code change beyond build tooling):**
1. Bundle each worker with esbuild targeting **`format: "cjs", platform: "node", bundle: true`** — this resolves all `@better-ccflare/*` and `node:*` imports into one file, exactly like `bun build --target=bun` does today, but as CJS.
2. In `post-processor.worker.ts`, wrap the module-scope logic (currently starting with the top-level `await initPayloadEncryption();` at line 81) in an async IIFE: `(async () => { await initPayloadEncryption(); ... })();`. This is the **only** worker-source-level (not just build-tooling) change required — the other 3 workers have no top-level await and need no such wrap.
3. At spawn time: `Buffer.from(EMBEDDED_WORKER_CODE, "base64").toString("utf8")` → `new Worker(code, { eval: true })`. The CJS bundle can still `require("node:worker_threads")` internally for `parentPort` — that's available inside an `eval: true` worker context.
4. Dev/source-mode fallback keeps working as `new Worker(new URL("./vacuum-worker.ts", import.meta.url), { workerData })` (Node 24 type-stripping loads it directly), once `self.*` → `parentPort.*` is fixed inside the worker files (that fix is shared by both the dev-mode and bundled-mode paths, since it's inside the worker source itself, not the bundle).

**Alternative considered and rejected as primary:** decode the base64 to a temp file (`os.tmpdir()`) and spawn `new Worker(tempFilePath)` pointing at real ESM on disk — this sidesteps the CJS/eval limitation entirely and needs no IIFE wrap, but adds filesystem lifecycle management (temp file creation, naming collisions across concurrent instances/restarts, cleanup, and potential failure in read-only container filesystems) that the current architecture has zero exposure to today. Keep as a documented fallback if the CJS+eval path hits an unforeseen blocker during implementation, but don't start there.

### Does the "auto-generation" step itself change?

Mechanically, mostly no: it's still "bundle worker source → base64-encode → write to a `inline-*.ts` constant module" — just swap `bun build --target=bun` for `esbuild --bundle --platform=node --format=cjs` in the same npm script (or extract into a small `scripts/build-workers.mjs` Node script using esbuild's JS API, which is cleaner than shelling out and matches how `dashboard-web/build.ts` is already structured as a standalone script rather than inline npm-script text). The `packages/proxy/src/inline-worker.ts`, `packages/database/src/inline-vacuum-worker.ts`, `packages/database/src/inline-integrity-check-worker.ts`, `packages/database/src/inline-incremental-vacuum-worker.ts` generated-file contract (never edit directly, `git checkout --` to reset) is unchanged and should stay documented in `CLAUDE.md` as-is.

**Worth flagging for the roadmap as an alternative worth evaluating once the standalone-binary phase (Q6, last) is reached:** Node's Single Executable Applications feature (stable direction as of Node 24/25, `--build-sea`, native `assets` key-path dictionary in `sea-config.json`, retrieved at runtime via `require("node:sea").getAsset()`) could eventually replace the entire "hand-roll a base64 TS constant" mechanism for the compiled-binary case specifically — but do **not** make this the primary plan for Q3, because (a) it only applies to the final SEA-packaged binary, not the npm-published CLI or dev mode, which both still need *some* worker-loading strategy, and (b) worker_threads spawning reliably from inside a SEA blob is not clearly documented and is a known rough edge — the CJS+`eval:true` approach above works identically regardless of packaging mode (SEA, npm-published, or dev checkout) since it never depends on a real filesystem path existing inside the binary, which makes it the safer unifying choice. Flag SEA-native-assets as a **phase-6-or-later** research spike, not a Q3 blocker.

## Q4 — `packages/core-di` and Bun-specific API audit

**`packages/core-di/src/container.ts` and `src/index.ts` contain zero `Bun.*` calls** (verified by direct grep — the DI container itself is a plain Map-based service locator wiring `Config`/`Logger`/`DatabaseOps` singletons; it doesn't touch the runtime at all). **No changes needed to `core-di` itself.** The Bun coupling lives in the concrete implementations it wires together, not in the container. Full audit of actual `Bun.*` call sites in non-test, non-generated source (verified by grep across `packages/` and `apps/`):

| File | Bun API used | Node replacement |
|---|---|---|
| `apps/server/src/server.ts:133,140` | `Bun.resolveSync(...)` | `require.resolve()` (CJS) or `import.meta.resolve()` (ESM, Node ≥20.6, sync-returning as of later Node versions) |
| `apps/server/src/server.ts:210` | `Bun.file(fullPath)` in `new Response(Bun.file(...))` | `node:fs.createReadStream(fullPath)` wrapped for `Response` body, or `Readable.toWeb()` (`node:stream`) into `new Response(webStream)` |
| `packages/cli-commands/src/utils/oauth-redirect.ts:300` | `Bun.serve({...})` (temporary local server for OAuth redirect capture) | `node:http.createServer(...)` |
| `packages/database/src/adapters/bun-sql-adapter.ts` | `bun:sqlite` `Database` type, `Bun.SQL` type (`import type { SQL } from "bun"`) | See Q5 — this is the core of the DB adapter swap |
| `packages/database/src/retry.ts:79-80` | `Bun.sleepSync(ms)` (already has a documented Node.js fallback path in a comment — the file explicitly checks `typeof Bun !== "undefined"`) | Already partially defensive; complete by making the "Node.js child_process fallback" (referenced at line 99) the sole path, or use `Atomics.wait` on a `SharedArrayBuffer` for a true sync sleep in Node (the standard technique) |
| `packages/logger/src/file-writer.ts:136` | `Bun.file(this.logFile).text()` | `node:fs/promises` `readFile(this.logFile, "utf8")` |
| `packages/openai-responses-adapter/src/handler.ts:28-32` | `Bun.zstdDecompressSync`, `Bun.gunzipSync`, `Bun.inflateSync` | `node:zlib` — `zlib.gunzipSync`, `zlib.inflateSync` map directly; **zstd has only had sync bindings added to `node:zlib` recently (`zlib.zstdDecompressSync`) — verify availability at the Node 24 floor specifically before relying on it**; if unavailable, fall back to a small `zstd` npm package (e.g. via native bindings) as an explicit new dependency. |
| `packages/proxy/src/handlers/proxy-operations.ts` | Comment only (`"avoiding module-mock symlink issues with Bun"`) — no actual API call | No code change; comment can be updated/removed once true |
| `apps/cli/build-multi-arch.ts` | `bun build --compile --target=bun-<platform>` invocations (multi-arch cross-compile) | Node SEA / Q6 |

`packages/config/src/index.ts` (env parsing, called out in the milestone context as the config layer) — **confirmed no `Bun.env` usage**; already uses `process.env` throughout, which is portable as-is.

## Q5 — Database adapter: interface is *mostly* clean, but `database-operations.ts` itself has direct `bun:sqlite` calls that bypass the adapter — this is not a pure 1-file swap

The milestone context assumes `bun-sql-adapter.ts` is the sole seam. Verified reality is more nuanced:

- **`packages/database/src/adapters/bun-sql-adapter.ts`** (`BunSqlAdapter` class) exposes a clean async interface — `query<R>()`, `get<R>()`, `run()`, `runWithChanges()`, `transaction()`, `unsafe()`, `close()` — that branches internally on `this.isSQLite` between `bun:sqlite`'s synchronous `Database` and `Bun.SQL` (Postgres). **This part genuinely is a clean seam**: `packages/database/src/repositories/*.repository.ts` and `packages/database/src/migrations-pg.ts` only call these adapter methods (verified: `migrations-pg.ts` imports `type { BunSqlAdapter }` purely for its method signatures, never touches `bun:sqlite` or `Bun.SQL` directly). Swapping the SQLite half of this class for a Node driver (see below) does not require touching `repositories/` or `migrations-pg.ts`.
- **`packages/database/src/database-operations.ts`** (the facade) **does not exclusively go through the adapter** — it directly `import { Database } from "bun:sqlite"`, constructs `new Database(resolvedPath, { create: true })` itself (line ~343), and makes **20+ direct synchronous calls** to `this.sqliteDb.query("PRAGMA ...").get()` / `.exec(...)` for PRAGMA introspection, vacuum bookkeeping, freelist/auto_vacuum checks, and `PRAGMA wal_checkpoint`/`optimize` maintenance (verified by grep — call sites throughout `database-operations.ts`, e.g. lines 349, 425, 450-456, 651, 1275-1277, 1342, 1365-1368, 1523, 1597). It also does `const { SQL } = require("bun");` inline (line 286) to construct the Postgres client. **`migrations.ts`** (SQLite-only migrations, distinct from `migrations-pg.ts`) also directly `import type { Database } from "bun:sqlite"`.
- **Implication:** the swap is "one adapter class implementing the same interface" **for the repository/migrations-pg layer only**. `database-operations.ts` and `migrations.ts` need their own direct `bun:sqlite` call sites ported — not because the adapter abstraction is broken, but because those two files were written to reach past the abstraction for low-level PRAGMA/maintenance operations that only make sense against the raw SQLite handle. This is real, bounded work (2 files, ~25 call sites total, all mechanical renames — see below), not a redesign.

**Node SQLite driver choice — flag as a decision, don't resolve it here (belongs in STACK.md):**
- `node:sqlite` (`DatabaseSync`): built into Node ≥22.5, unflagged (no `--experimental-sqlite` needed) as of Node 24, but **stability 1.2 "Release Candidate," not yet fully stable** as of mid-2026. API shape is close to `bun:sqlite`: `db.exec(sql)` maps 1:1; `db.query(sql).get(...)/.all(...)` (bun:sqlite) becomes `db.prepare(sql).get(...)/.all(...)` (node:sqlite) — a mechanical rename at every call site, not a logic change. `db.run(sql, params)` (bun:sqlite) becomes `db.prepare(sql).run(...params)` (node:sqlite) returning `{ changes, lastInsertRowid }` — same shape as bun:sqlite's `.run()` result.
- `better-sqlite3` (npm, native addon, long-established, fully stable, same `.prepare(sql).get()/.all()/.run()` shape as `node:sqlite`): safer stability profile, but reintroduces a native-compiled-addon dependency, which complicates the standalone-binary/SEA packaging story (Q6) since native addons must be rebuilt per target platform/arch — exactly the kind of cross-platform packaging friction the milestone is trying to simplify by moving off Bun.
- Either choice requires the same mechanical `.query()`→`.prepare()` rename across `bun-sql-adapter.ts`, `database-operations.ts`, `migrations.ts`, and the 4 worker files (`vacuum-worker.ts`, `incremental-vacuum-worker.ts`, `integrity-check-worker.ts` all `import { Database } from "bun:sqlite"` directly too, verified). This decision should be made once, early, and applied everywhere in the same phase — don't let it drift into two drivers in different files.
- Postgres side (`Bun.SQL`) needs a Node client (e.g. `postgres` (a.k.a. `porsager/postgres`, closest API shape to `Bun.SQL`'s tagged-template/`.unsafe()` style) or `pg`) — this is a separate, smaller swap confined to `bun-sql-adapter.ts`'s non-SQLite branch and the `require("bun")` call in `database-operations.ts:286`.

## Q6 — Phase ordering

### Dependency graph (what blocks what)

```
Phase 1: Package manager + TS config foundation
   npm workspaces (bun.lock → package-lock.json), root tsconfig.json
   (Q1), 3-file parameter-property fix, @types/node install
        │
        ▼
Phase 2: Runtime API de-Bunification (leaf modules, no cross-package
   coordination needed — can run in parallel with Phase 3 planning)
   Bun.* → node:* in: server.ts, oauth-redirect.ts, file-writer.ts,
   handler.ts (zstd/gzip), retry.ts (Q4)
        │
        ├──────────────────────────────┐
        ▼                               ▼
Phase 3: Database driver swap    Phase 4: Dashboard build pipeline
   (Q5) — bun:sqlite → node:sqlite   (Q2) — Bun.build → esbuild +
   or better-sqlite3; Bun.SQL →      tailwindcss CLI; embed.ts
   postgres/pg; touches adapter +    unchanged; add dashboard-web
   database-operations.ts +          package.json "exports" map
   migrations.ts + all 4 worker      entries
   files' `Database` import
        │                               │
        └───────────────┬───────────────┘
                         ▼
Phase 5: Worker threads (Q3) — hardest, depends on Phase 3 (workers
   import bun:sqlite directly) AND needs a build tool decision already
   made in Phase 4 (reuse the same esbuild toolchain). self→parentPort,
   Worker import, eval:true CJS bundling, IIFE wrap in
   post-processor.worker.ts, inline-*.ts generation script rewrite
        │
        ▼
Phase 6: Test runner migration (bun:test → node:test or vitest) —
   159 test files import "bun:test" directly; every phase above
   needs its own tests still runnable, so this likely needs to
   start early (a compat shim or codemod run right after Phase 1)
   rather than strictly last, but full cutover can trail behind
        │
        ▼
Phase 7: Standalone binary + Docker/CI (Q6 "last") — Node SEA
   (--build-sea) replacing `bun build --compile --target=bun-<platform>`
   in apps/cli/build-multi-arch.ts; GitHub Actions release.yml
   (currently `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile`)
   → setup-node + npm ci; Dockerfile already just downloads a
   pre-built binary from GitHub Releases, so it changes only if the
   binary-naming/build mechanism changes, not its own logic
```

**Why this order:**
- **Phase 1 first, unconditionally:** nothing else can be typechecked, linted, or even have its imports resolved without npm workspaces installed and `tsconfig.json` no longer requiring `bun-types`. Also the cheapest possible win (3 files) that unlocks native-TS-execution for everything downstream.
- **Phase 2 before 3/4:** these are self-contained leaf-module swaps (no other package depends on their internals changing) — do them early to shrink the Bun-API surface before tackling the two structurally harder integration points.
- **3 and 4 can run in parallel** (different packages, `packages/database/` vs `packages/dashboard-web/` + `apps/server/src/server.ts`'s embedded-import line) — they don't share files.
- **Phase 5 (workers) must come after Phase 3**, because every worker source file does `import { Database } from "bun:sqlite"` directly (verified in all 4 worker files) — porting the worker-spawn mechanism (Q3) while the workers still import a driver that no longer exists would leave the app undeployable mid-phase, violating the "deployable at every phase" constraint.
- **Test runner (Phase 6) is drawn as sequential above but should actually start in parallel with Phase 1**, not wait — 159 files import `bun:test` directly, and every subsequent phase needs a working test suite to verify it didn't break anything (this milestone's own stated incremental-deployability constraint depends on tests running under whatever runtime is live at each step). Practically: introduce `node:test` or `vitest` as the runner immediately after Phase 1, keep `bun:test`-compatible assertion style if possible (both `node:test` and `vitest` support Jest-like `describe/it/expect` shapes close enough to `bun:test`'s), and treat the 159-file import-statement swap as a mechanical codemod, not exploratory work — but full confidence in the new runner (matchers, mocking library parity with `bun:test`'s `mock()`, snapshot testing if used) needs its own dedicated research pass; this document intentionally does not resolve the test-runner choice since it's outside the 6 questions asked, but the roadmap must not treat it as an afterthought given the file count.
- **Phase 7 last, strictly:** Docker downloads a pre-built binary and CI's release workflow drives the whole multi-arch build — neither can be exercised meaningfully until the runtime, DB driver, worker threads, and dashboard build all already work under plain `node`. Node's SEA feature (`--build-sea`, stable direction as of Node 24/25) is the direct replacement for `bun build --compile --target=bun-<platform>`, but cross-platform SEA builds have a documented constraint (`useCodeCache`/`useSnapshot` must be `false` when cross-compiling to a different platform than the build host, or the executable can crash on startup) that the current 5-platform GitHub Actions matrix (`build:linux-amd64`, `build:linux-arm64`, `build:macos-x86_64`, `build:macos-arm64`, `build:windows-x64` in `apps/cli/package.json`) will need to account for by building on native runners per target rather than cross-compiling from one Bun host, which is a CI topology change worth flagging now even though it lands last.

### New components vs modified existing files

| New | Purpose |
|---|---|
| `tsconfig.base.json`, `tsconfig.node.json` (optional but recommended, Q1) | Split shared config from DOM-needing dashboard config to eliminate lib-collision risk |
| `scripts/build-workers.mjs` (or equivalent, Q3) | esbuild-based replacement for the inline `bun build --target=bun` invocations currently embedded in `apps/cli/package.json`'s `build` script text |
| Node SQLite/Postgres driver npm dependencies (Q5) | `node:sqlite` (built-in, no install) or `better-sqlite3`; `postgres` or `pg` |
| `package-lock.json` (Q6/Phase 1) | Replaces `bun.lock` |
| Node SEA config JSON(s) per platform (Q6/Phase 7) | Replaces Bun's `--target=bun-<platform>` flags |

| Modified (existing, verified paths) | What changes |
|---|---|
| `tsconfig.json` (root) | Remove `types: ["bun-types"]`; add `@types/node` |
| `package.json` (root), `apps/cli/package.json`, `packages/dashboard-web/package.json`, `packages/ui-constants/package.json`, `packages/errors/package.json` | Remove `bun-types`/`@types/bun` deps; add `@types/node` |
| `packages/database/src/repositories/base.repository.ts`, `stats.repository.ts`, `packages/ui-common/src/presenters.ts` | Expand constructor parameter properties to explicit fields (erasable-syntax fix) |
| `packages/dashboard-web/build.ts` | `Bun.build()` → esbuild; HTML entrypoint handled manually; Tailwind via CLI not plugin |
| `packages/dashboard-web/package.json` | Add `exports` map entries for `./dist/embedded`, `./dist/manifest.json` |
| `apps/server/src/server.ts` | `Bun.resolveSync` → `require.resolve`/`import.meta.resolve`; `Bun.file` → `node:fs` stream |
| `packages/cli-commands/src/utils/oauth-redirect.ts` | `Bun.serve` → `node:http.createServer` |
| `packages/logger/src/file-writer.ts` | `Bun.file(...).text()` → `readFile(..., "utf8")` |
| `packages/openai-responses-adapter/src/handler.ts` | `Bun.zstdDecompressSync`/`gunzipSync`/`inflateSync` → `node:zlib` (verify zstd sync API present at Node 24) |
| `packages/database/src/retry.ts` | Complete the already-scaffolded Node.js fallback path for `Bun.sleepSync` |
| `packages/database/src/adapters/bun-sql-adapter.ts` | Swap `bun:sqlite`/`Bun.SQL` types and calls for Node driver equivalents; `.query()`→`.prepare()` rename |
| `packages/database/src/database-operations.ts` | ~20 direct `bun:sqlite` PRAGMA/maintenance call sites ported; `require("bun")` Postgres client construction replaced |
| `packages/database/src/migrations.ts` | `import type { Database } from "bun:sqlite"` swapped |
| `packages/database/src/vacuum-worker.ts`, `incremental-vacuum-worker.ts`, `integrity-check-worker.ts`, `packages/proxy/src/post-processor.worker.ts` | `bun:sqlite` import swap + `self.*` → `parentPort.*`; `post-processor.worker.ts` additionally needs its top-level `await initPayloadEncryption()` wrapped in an async IIFE |
| `packages/proxy/src/usage-worker-controller.ts`, `packages/database/src/integrity-check-runner.ts`, `packages/database/src/database-operations.ts` (2 more spawn sites) | `new Worker(blobURL, {smol:true})` + `.onmessage=`/`.onerror=` → `import { Worker } from "node:worker_threads"` + `new Worker(code, {eval:true})` + `.on("message")`/`.on("error")` |
| `packages/proxy/src/inline-worker.ts`, `packages/database/src/inline-vacuum-worker.ts`, `inline-incremental-vacuum-worker.ts`, `inline-integrity-check-worker.ts` | Still auto-generated/never-hand-edited, but generator swaps `bun build` for esbuild CJS bundling |
| `apps/cli/package.json` (`build` script) | Rewritten to call the new worker-bundling script + esbuild-based dashboard/CLI packaging instead of `bun build --compile` |
| `apps/cli/build-multi-arch.ts` | `bun build --compile --target=bun-<platform>` → Node SEA build per platform |
| `.github/workflows/release.yml`, other workflow files using `oven-sh/setup-bun` | `setup-node` + `npm ci`; potentially split into per-platform native runners for SEA cross-compile safety |
| `Dockerfile` | Only if binary artifact naming/build mechanism changes; otherwise unaffected (already just downloads a release binary) |

## Anti-Patterns to Avoid During This Migration

### Anti-Pattern 1: Treating the DB adapter swap as "just implement the interface"
**What people do:** read `database-operations.ts` as a thin consumer of `BunSqlAdapter` and assume porting the adapter class alone is sufficient.
**Why it's wrong:** `database-operations.ts` has ~20 direct `bun:sqlite` call sites (PRAGMA/vacuum/integrity bookkeeping) that reach past the adapter entirely — verified by grep, not assumed.
**Instead:** scope Phase 3 explicitly to include `database-operations.ts` and `migrations.ts`, not just `bun-sql-adapter.ts`.

### Anti-Pattern 2: Assuming ESM eval-string workers work in Node like Blob-URL workers do in Bun
**What people do:** port the Blob+`createObjectURL` pattern literally, expecting `new Worker(codeString, {eval:true})` to accept the same ESM bundle Bun produced.
**Why it's wrong:** Node's `eval: true` worker mode does not support ESM source strings (confirmed open Node.js gap) — and the codebase's `post-processor.worker.ts` has genuine top-level `await`, which is invalid in CJS regardless.
**Instead:** bundle workers as CJS via esbuild specifically for the embedded/eval path, and wrap the one top-level-await site in an async IIFE.

### Anti-Pattern 3: Migrating the root tsconfig without addressing the DOM/Node lib collision
**What people do:** delete `bun-types`, add `@types/node`, leave `"lib": ["ESNext","DOM","DOM.Iterable"]` untouched since it "still compiles" (thanks to `skipLibCheck`).
**Why it's wrong:** timer-handle types (`setTimeout` return value) and other DOM-vs-Node global type mismatches become silently wrong, not compile-errors, because `skipLibCheck` suppresses the declaration conflict rather than resolving it.
**Instead:** split into a Node-targeted tsconfig (no DOM lib) for `apps/server`, `apps/cli`, all `packages/*` except `dashboard-web`, and keep a separate DOM-lib config for the dashboard.

## Sources

- Codebase (all file paths and line numbers cited inline throughout this document are from direct reads of the actual repository at `/home/coder/development`, not inferred)
- [Node.js Worker threads documentation](https://nodejs.org/api/worker_threads.html)
- [Worker eval as ES Module · Issue #30682 · nodejs/node](https://github.com/nodejs/node/issues/30682) — confirms no ESM eval-string support for workers
- [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html) — `DatabaseSync`/`prepare`/`exec` API, stability 1.2 (Release Candidate) as of mid-2026
- [doc,lib,src,test: unflag sqlite module · nodejs/node@55239a4](https://github.com/nodejs/node/commit/55239a48b6) — confirms `node:sqlite` no longer requires `--experimental-sqlite` as of Node 24
- [Modules: TypeScript | Node.js documentation](https://nodejs.org/api/typescript.html) — native type-stripping default behavior, erasable-syntax constraints
- [TypeScript 5.8 Ships --erasableSyntaxOnly To Disable Enums | Total TypeScript](https://www.totaltypescript.com/erasable-syntax-only) — confirms parameter properties, enums, namespaces, decorators are non-erasable
- [Single executable applications | Node.js documentation](https://nodejs.org/api/single-executable-applications.html) — SEA `assets` field, `--build-sea`, cross-platform `useCodeCache`/`useSnapshot` constraint
- [Node.js — Node.js 24.0.0 (Current) release notes](https://nodejs.org/en/blog/release/v24.0.0)

---
*Architecture research for: better-ccflare Bun-to-Node.js runtime migration*
*Researched: 2026-07-17*
