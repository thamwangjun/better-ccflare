---
phase: 10-type-wiring-cli-http-api-sse-sniffer
plan: 02
subsystem: cli-http-api
tags: [cli, http-api, account-creation, openrouter-anthropic, routing]

# Dependency graph
requires:
  - phase: 10-type-wiring-cli-http-api-sse-sniffer
    plan: 01
    provides: openrouter-anthropic in ProviderName, PROVIDER_CONFIG, and account mode unions
provides:
  - "CLI accepts --mode openrouter-anthropic (dispatch branch + createOpenRouterAnthropicAccount helper)"
  - "CLI --list infers openrouter-anthropic mode from provider value"
  - "Help text documents openrouter-anthropic mode"
  - "createOpenRouterAnthropicAccountAddHandler factory (HTTP) inserting provider: openrouter-anthropic"
  - "POST:/api/accounts/openrouter-anthropic route registered"
affects: [10-04-sse-sniffer-and-provider, phase-11-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling dispatch branch mirroring the openrouter branch exactly, swapping provider literal"
    - "// FORK PATCH: annotation on every fork-specific addition for upstream merge safety"
    - "HTTP handler factory mirrored verbatim with only provider literal + log/message strings changed"

key-files:
  created: []
  modified:
    - packages/cli-commands/src/commands/account.ts
    - packages/cli-commands/src/commands/help.ts
    - packages/http-api/src/handlers/accounts.ts
    - packages/http-api/src/router.ts

key-decisions:
  - "Mirrored the existing openrouter CLI dispatch branch's console.log output style (not Logger) to preserve consistency with the surrounding sibling branches"
  - "D-05: POST:/api/accounts/openrouter-anthropic registered alongside existing openrouter route, sharing the same auth posture and validation"
  - "D-06: CLI mode union + dispatch + listAccounts inference extended for openrouter-anthropic"

patterns-established:
  - "When adding a new account provider surface, mirror the nearest existing sibling (openrouter) exactly and change only the provider literal + user-facing strings"

requirements-completed: [MGMT-01, MGMT-02]

# Metrics
duration: 12 min
completed: 2026-06-04
---

# Phase 10 Plan 02: CLI + HTTP API Wiring (openrouter-anthropic account creation) Summary

**Wired `openrouter-anthropic` into both user-facing account-creation surfaces — CLI (`--mode openrouter-anthropic` dispatch branch, `createOpenRouterAnthropicAccount` DB helper, `--list` inference, help text) and HTTP API (`createOpenRouterAnthropicAccountAddHandler` factory + `POST:/api/accounts/openrouter-anthropic` route) — with `bun run typecheck` passing zero errors.**

## Performance

- **Duration:** 12 min
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- CLI: added `"openrouter-anthropic"` to `AddAccountOptionsWithAdapter.mode` and `AccountListItemWithMode.mode` unions
- CLI: added `createOpenRouterAnthropicAccount()` private helper mirroring `createOpenRouterAccount()`, inserting `provider: "openrouter-anthropic"`
- CLI: added `else if (mode === "openrouter-anthropic")` dispatch branch prompting for API key, priority, and model mappings
- CLI: extended `listAccounts()` inference so `--list` reports the correct mode for openrouter-anthropic accounts
- CLI: documented `openrouter-anthropic` in help text (mode list line + description table)
- HTTP: added exported `createOpenRouterAnthropicAccountAddHandler()` mirroring `createOpenRouterAccountAddHandler()` (same validation, error handling, response shape), changing only the provider literal and user-facing strings
- HTTP: imported, instantiated, and registered the new handler at `POST:/api/accounts/openrouter-anthropic`
- `bun run typecheck` exits 0; existing `openrouter` route/handler unmodified (no regression)

## Task Commits

1. **Task 1: CLI mode union extensions + dispatch branch + help text (MGMT-01 / D-06)** — `ba021c7d` (feat)
2. **Task 2: HTTP handler factory + route registration (MGMT-02 / D-05)** — `c5a09458` (feat)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Files Created/Modified
- `packages/cli-commands/src/commands/account.ts` — mode unions, `createOpenRouterAnthropicAccount` helper, dispatch branch, listAccounts inference
- `packages/cli-commands/src/commands/help.ts` — mode list + description row
- `packages/http-api/src/handlers/accounts.ts` — `createOpenRouterAnthropicAccountAddHandler` factory
- `packages/http-api/src/router.ts` — import, instantiation, and `POST:/api/accounts/openrouter-anthropic` registration

## Decisions Made
- Mirrored the existing `openrouter` CLI branch's `console.log` style rather than switching to `Logger`, to stay consistent with all surrounding sibling dispatch branches (changing only this branch would be an inconsistency, and the plan's intent was an exact mirror).
- Followed D-05 and D-06 verbatim — same validation/auth posture, same input/response shape, only the provider literal and user-facing strings differ.

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<action>` mentioned "Use Logger, not console.*" as a general convention, but the explicit instruction was to mirror the `openrouter` branch exactly; that branch uses `console.log`. Mirroring (and thus preserving consistency) was treated as the binding instruction. This is a clarification, not a deviation — no behavior diverged from the plan's intent.

## Threat Model Compliance
- **T-10-02-A (Tampering):** new HTTP handler mirrors `createOpenRouterAccountAddHandler` validation exactly (`validateString` name/apiKey, `validateNumber` priority, model-mapping sanitization) — no validation skipped.
- **T-10-02-B (Elevation of Privilege):** route registered in the same `this.handlers` map as the existing `openrouter` route, inheriting the identical auth middleware scope.
- **T-10-02-D (Information Disclosure):** handler logs provider + name + priority only; the API key is never logged.

## Issues Encountered
The fresh worktree had no built worker artifacts, so `bun run typecheck` initially reported 5 pre-existing `TS2307 Cannot find module` errors for auto-generated worker modules (`inline-worker`, `inline-vacuum-worker`, `inline-incremental-vacuum-worker`, `inline-integrity-check-worker`, `embedded-tiktoken-wasm`). These are CLAUDE.md-protected generated files (build output), unrelated to the plan's changes. Generated the database workers via `bun run build` and copied the remaining gitignored artifacts (`embedded-tiktoken-wasm.ts`, `inline-worker.ts`) from the main repo so the compiler could resolve them; after that `bun run typecheck` exited 0. None of the four edited files ever produced an error. No generated artifact was committed.

## Verification Results
- `bun run typecheck` — exits 0
- `grep openrouter-anthropic packages/http-api/src/router.ts` — handler.set line present (line 257)
- `grep createOpenRouterAnthropicAccountAddHandler` — present in both accounts.ts (line 3578) and router.ts (lines 36, 177)
- `grep openrouter-anthropic packages/cli-commands/src/commands/account.ts` — present in both unions, helper, dispatch branch, and listAccounts inference
- `grep openrouter-anthropic packages/cli-commands/src/commands/help.ts` — present in mode list (line 9) and description table (line 21)

## Next Phase Readiness
- Both account-creation surfaces now register `openrouter-anthropic`. Plan 10-04 (SSE sniffer + provider) and phase-11 (dashboard) can rely on accounts of this provider being creatable via CLI and HTTP.
- No blockers.

## Self-Check: PASSED

- `packages/cli-commands/src/commands/account.ts` — FOUND (openrouter-anthropic at lines 48, 81, 367, 399, 1412, 1738)
- `packages/cli-commands/src/commands/help.ts` — FOUND (lines 9, 21)
- `packages/http-api/src/handlers/accounts.ts` — FOUND (createOpenRouterAnthropicAccountAddHandler at line 3578)
- `packages/http-api/src/router.ts` — FOUND (lines 36, 177, 257)
- Commit `ba021c7d` (Task 1) — committed
- Commit `c5a09458` (Task 2) — committed
- `bun run typecheck` — exits 0

---
*Phase: 10-type-wiring-cli-http-api-sse-sniffer*
*Completed: 2026-06-04*
