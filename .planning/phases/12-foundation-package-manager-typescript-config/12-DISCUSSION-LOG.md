# Phase 12: Foundation — Package Manager & TypeScript Config - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 12-foundation-package-manager-typescript-config
**Areas discussed:** CI workflow compatibility, Internal package version specifier, tsconfig split shape + @types/node version, dotenv/$VAR expansion timing

---

## CI workflow compatibility

| Option | Description | Selected |
|--------|-------------|----------|
| Patch install now (npm ci) + clean debug echoes | Fix all 3 workflows' install step to `npm ci` in the same PR, and delete the stale bun-path debug echoes in `release.yml`. Keeps releases alive through the whole migration. | ✓ |
| Patch install now (npm ci) only | Fix the install step but leave the stale debug echoes as-is. | |
| Leave CI red until Phase 19 | Accept a release blackout for phases 12-18. | |
| Freeze releases on a maintenance branch | Cut hotfixes on a separate branch during the migration. | |

**User's choice:** Patch install now (npm ci) + clean debug echoes (recommended option)
**Notes:** Advisor research confirmed `bun install --frozen-lockfile` hard-fails the instant `bun.lock` is deleted, and `release.yml` triggers on every tag push — deferring to Phase 19 would break release automation for 7 phases, contradicting the project's always-deployable constraint.

---

## Internal package version specifier

| Option | Description | Selected |
|--------|-------------|----------|
| Bare "*" | Matches any local version, zero drift risk. npm's own documented answer for unpublished internal packages; matches Turborepo's guidance. | ✓ |
| Synced semver range (e.g. ^1.0.0) | Reads like a real contract, but a missed bump causes silent registry fallback under the `@better-ccflare` scope. | |
| file: protocol | Immune to registry-fallback risk, but path-fragile. | |
| Automated version-sync tooling (syncpack/Changesets) | Removes human error, but new dependency/config for a non-problem here. | |

**User's choice:** Bare "*" (recommended option)
**Notes:** Confirmed via npm/rfcs#301 that npm workspace linking only understands semver ranges — no `workspace:` protocol equivalent. None of the ~15 internal packages are published individually (only `apps/cli` ships, as a Bun-bundled standalone binary), so there's no external consumer needing a stricter contract.

---

## tsconfig split shape + @types/node version

| Option | Description | Selected |
|--------|-------------|----------|
| Two-file targeted override | Root tsconfig becomes the Node config in place; dashboard-web gets its own override; also fix the root typecheck script's global-include behavior. Smallest diff, avoids upstream-merge friction. | ✓ |
| Three-file explicit split (base/node/dom.json) | Self-documenting, standard convention, but touches ~21 files and is a structural change CLAUDE.md warns against. | |
| Per-package independent configs | Maximum isolation, but 19x duplication solving a non-existent divergence problem. | |
| TypeScript Project References (composite builds) | Solves build-caching, not the lib-collision problem — wrong tool. | |

**User's choice:** Two-file targeted override (recommended option)
**Notes:** `@types/node` version was locked to `^24` as a factual correction (not put to a vote) — `STACK.md`'s `^26` line contradicts this project's own confirmed Node 24 LTS floor and its own `ARCHITECTURE.md` analysis. The two-file option is incomplete unless paired with fixing the root `typecheck` script, which currently compiles all 19 packages (including dashboard-web) as one shared `tsc` program via a broad `include` glob — this fix was folded into the same decision.

---

## dotenv/$VAR expansion timing

| Option | Description | Selected |
|--------|-------------|----------|
| Wire server now, verify via spawned-process integration test | Add dotenv+dotenv-expand to server.ts in Phase 12, verified with a real child-process test. Isolates this risk from the riskier Phase 15 HTTP migration. | ✓ |
| Wire server now, verify via in-process unit test only | Faster, but only proves the library works — not that server.ts's wiring is correct. | |
| Defer all server wiring to Phase 15 | Zero redundant work now, but can't satisfy Criterion #4 this phase and stacks risk onto Phase 15. | |
| Wire CLI only now, defer server | Smallest footprint, fixes a real pre-existing CLI gap, but doesn't touch the harder server half. | |

**User's choice:** Wire server now, verify via spawned-process integration test (recommended option)
**Notes:** Confirmed plain `dotenv` never does `$VAR` expansion on its own (needs `dotenv-expand`). Server still runs under `bun` through Phase 14, so Bun's native auto-loader and the new explicit call coexist safely — `dotenv`'s `override:false` default makes this a provable no-op overlap, not a conflict.

---

## Claude's Discretion

- Exact npm script names/wiring for the per-workspace typecheck fan-out — any equivalent that stops the single-shared-`tsc`-program behavior is acceptable.
- Where exactly to place the `dotenv-expand` wiring relative to other `server.ts` startup code, as long as it runs before `packages/config/src/index.ts`'s `process.env` reads.

## Deferred Ideas

None — discussion stayed within phase scope. The three-file tsconfig split and synced-semver-range version strategy were considered and explicitly rejected for this phase (not deferred to a later one) — see CONTEXT.md Implementation Decisions for rationale.
