# Phase 12: Foundation — Package Manager & TypeScript Config - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Swap the package manager (`bun.lock` → npm workspaces) and the TypeScript config (`bun-types` → `@types/node`, DOM/Node `lib` split) with **zero runtime or functional change**. The app keeps running on Bun through this phase — `Bun.serve()`, `bun:sqlite`, and worker-thread runtime migration don't happen until Phase 15+. This phase only touches install/resolve/typecheck mechanics, plus the CI install step and env-loading wiring needed to keep the repo deployable and Criterion #4 satisfiable within this phase's boundary.

</domain>

<decisions>
## Implementation Decisions

### CI workflow compatibility
- **D-01:** Patch the install step in all 3 GitHub Actions workflows (`release.yml`, `release-dispatch.yml`, `signpath-test.yml`) from `bun install --frozen-lockfile` to `npm ci` in the same commit that removes `bun.lock`. `bun install --frozen-lockfile` hard-fails the instant `bun.lock` is gone/out of sync, and `release.yml` fires on every tag push — this is not deferrable to Phase 19 without a release blackout, which would violate the project's always-deployable constraint.
- **D-02:** Leave `oven-sh/setup-bun` and every `bun run build:dashboard`/`build:cli`/`build:multi` step untouched — those are unaffected (Bun still runs the actual build/runtime this phase) and are Phase 19's job.
- **D-03:** Clean up the stale bun-path debug echoes in `release.yml`'s "Verify dependencies" step in the same pass (non-gating today, but misleading once npm owns install).

### Internal package version specifier
- **D-04:** Rewrite every `"@better-ccflare/*": "workspace:*"` value across all ~15 internal `package.json` files to bare `"*"`. npm has no `workspace:` protocol (confirmed via open `npm/cli#8845`) — `npm install` fails with `EUNSUPPORTEDPROTOCOL` on the first workspace package otherwise. `"*"` is npm's own documented answer for internal, never-individually-published packages (matches Turborepo's guidance) and carries zero version-drift risk. Rejected: synced semver ranges (missed bump → silent public-registry fallback under the `@better-ccflare` scope — a dependency-confusion risk) and `file:` protocol (unnecessary path fragility) and sync tooling (solves a coordination problem this repo doesn't have).

### tsconfig split shape + @types/node version
- **D-05:** Two-file targeted override — root `tsconfig.json` becomes the Node config in place (drop `DOM`/`DOM.Iterable` from `lib`, swap `"types": ["bun-types"]` → `"types": ["node"]`); `packages/dashboard-web/tsconfig.json` (which already overrides `lib`) gains `"types": []`. Rejected the 3-file `base/node/dom.json` split and per-package independent configs: CLAUDE.md explicitly warns against structural changes to shared packages (upstream-merge friction), and only one package (`dashboard-web`) actually needs a lib/types override today.
- **D-06:** This split is incomplete unless the root `"typecheck": "bunx tsc --noEmit"` script also stops compiling all 19 packages (including `dashboard-web`) as one shared `tsc` program via the root config's broad `include` glob (`packages/*/src/**/*`, `apps/*/src/**/*`). Fix the typecheck script to fan out per-workspace (e.g. `npm run typecheck --workspaces --if-present`, invoking each package's own already-present local `typecheck` script) — otherwise the DOM/Node lib collision resurfaces the moment typecheck actually runs, defeating the whole point of the split.
- **D-07 (locked as a factual correction, not a preference — see canonical refs):** Pin `@types/node@^24` everywhere (root — currently absent — plus bump `apps/cli/package.json` off its stray `^20.0.0`, and align `ui-common`/`http-common`/`agents` off their `^22.x` pins). Node 24 is the confirmed, locked LTS floor for this whole migration (Active LTS until 2028-04-30). `STACK.md`'s `^26` Installation-section line is stale/unreviewed boilerplate — Node 26 is Current/non-LTS until Oct 2026, and this project's own `ARCHITECTURE.md` independently and correctly concluded `^24.x`. Remove `@types/bun`/`bun-types` from every `package.json` that has them (root, `apps/cli`, `packages/dashboard-web`, `packages/ui-constants`, `packages/errors`).

### dotenv / $VAR expansion timing
- **D-08:** Wire explicit `dotenv` + `dotenv-expand` into `apps/server/src/server.ts` in this phase (not deferred to Phase 15). This isolates env-loading correctness from the much riskier Bun.serve→node:http swap, and satisfies Success Criterion #4 as literally scoped. `apps/cli/src/main.ts` already imports `dotenv` (^17.4.0) but has never had `dotenv-expand` layered on top — fix that gap too, in the same pass.
- **D-09:** During Phases 12–14 the server still runs under the `bun` executable, so Bun's native `.env` auto-loader (which already does `$VAR` expansion) and the new explicit `dotenv.config()` + `dotenvExpand.expand()` call both execute in the same process. This is provably harmless: `dotenv` defaults to `override:false`, so the explicit call is a same-value no-op on top of Bun's already-correct values. Add a one-line comment in `server.ts` explaining the overlap so a future reader doesn't mistake it for a bug.
- **D-10:** Verify with a spawned-process integration test — write a temp `.env` pair (e.g. `A=foo` / `B=${A}bar`), spawn the real entrypoint as a child process, assert the child's `process.env.B === "foobar"`. An in-process unit test against `dotenv-expand` alone is not sufficient on its own (it only proves the library works, not that `server.ts`'s actual wiring — import order, call placement before any `process.env` read — is correct); the integration test is required, a unit test may supplement it. No Anthropic/`claude` account involvement — this is pure env-var mechanics, no network call.

### Claude's Discretion
- Exact npm script names/wiring for the per-workspace typecheck fan-out (D-06) — any equivalent that stops the single-shared-`tsc`-program behavior is acceptable.
- Where exactly to place the `dotenv-expand` wiring relative to other `server.ts` startup code, as long as it runs before `packages/config/src/index.ts`'s `process.env` reads.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & requirements
- `.planning/ROADMAP.md` §Phase 12 — goal, success criteria (5), requirements FOUND-01/02/03
- `.planning/REQUIREMENTS.md` — FOUND-01, FOUND-02, FOUND-03 full text
- `.planning/PROJECT.md` — fork constraints (never curl Anthropic, `inline-worker.ts` generated, patches must apply cleanly after upstream merges)

### Migration research (all dated 2026-07-17, written for this milestone)
- `.planning/research/STACK.md` §6 (Package Manager/Workspaces) — **note:** its Installation section's `@types/node@^26` line is superseded by D-07 (`^24`); treat as stale boilerplate, not a decision
- `.planning/research/ARCHITECTURE.md` §Q1 (TypeScript configuration) — the authoritative source for the tsconfig split analysis (D-05/D-06/D-07); read this over STACK.md for `@types/node` version
- `.planning/research/PITFALLS.md` Pitfall 3 (`workspace:*` incompatibility) — full mechanics of the `EUNSUPPORTEDPROTOCOL` failure this phase avoids
- `.planning/research/FEATURES.md` #9 (env var / `.env` loading parity) — Bun-vs-Node `$VAR` expansion gap, `dotenv-expand` requirement
- `.planning/research/SUMMARY.md` — cross-doc synthesis; confirms Node 24 floor and npm workspace rewrite requirement

### CI workflows to edit (D-01/D-02/D-03)
- `.github/workflows/release.yml` — tag-triggered release build; install step + stale debug echoes
- `.github/workflows/release-dispatch.yml` — manual release-cut entry point; install step
- `.github/workflows/signpath-test.yml` — Windows code-signing verification; install step

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/cli/src/main.ts:3` — existing `import { config } from "dotenv"` call; extend with `dotenv-expand` rather than reimplementing expansion.
- Every package/app already has its own two-line `tsconfig.json` (`{ "extends": "../../tsconfig.json", "include": [...] }`) and (per `ARCHITECTURE.md`) its own local `"typecheck": "tsc --noEmit"` script — reuse these for the per-workspace fan-out in D-06 rather than inventing new per-package scripts.

### Established Patterns
- `packages/database/src/adapters/bun-sql-adapter.ts` already uses `ReturnType<typeof setTimeout>` defensively instead of bare `number` — the correct pattern under the Node `lib`; any bare-`number` timer-handle typing elsewhere is the actual latent bug the tsconfig split (D-05) surfaces.
- `packages/config/src/index.ts` reads `process.env.*` directly everywhere (~15+ settings) and never calls `dotenv` itself — it just trusts `process.env` is already populated by the time it runs, which is why D-08's `dotenv`/`dotenv-expand` call in `server.ts` must execute before any config parsing.

### Integration Points
- Root `package.json` `"workspaces": ["apps/*", "packages/*"]` field already exists and is npm-workspaces-compatible as-is — no change needed there, only the `workspace:*` dependency values (D-04) and devDependencies (D-07).
- Root `tsconfig.json` `"paths"` mapping (`@better-ccflare/*`, `@better-ccflare/server`, `@better-ccflare/dashboard-web/dist/*`) is unaffected by the `lib`/`types` split (D-05) — leave as-is.

</code_context>

<specifics>
## Specific Ideas

No UI/UX specifics — this is an infrastructure-only phase. The concrete artifacts to produce are: 3 CI workflow edits, ~15 `package.json` version-specifier edits, 2 tsconfig edits + 1 script fix, and `dotenv`/`dotenv-expand` wiring in 2 entrypoints (server + CLI) each with its own verification test.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (The three-file tsconfig split and the synced-semver-range version strategy were considered and explicitly rejected for this phase, not deferred — see Implementation Decisions above for why.)

</deferred>

---

*Phase: 12-foundation-package-manager-typescript-config*
*Context gathered: 2026-07-17*
