# Phase 10: Type Wiring + CLI + HTTP API + SSE Sniffer — Research

**Researched:** 2026-06-04
**Domain:** TypeScript type propagation, CLI/HTTP account registration, SSE failover, debug logging
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Add `"openrouter-anthropic"` to `ANTHROPIC_SHAPE_PROVIDERS` in `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` (line 43). One-line change. OVERRIDES ARCHITECTURE §3C which incorrectly said no change needed. SC#4 in ROADMAP is the authority.
- **D-02:** Verify via a **synthetic `overloaded_error` SSE fixture** fed to the sniffer with `provider: "openrouter-anthropic"`, asserting failover fires. Real overload verification deferred to Phase 12.
- **D-03:** **Always inject** `X-OpenRouter-Experimental-Metadata: enabled` on every `openrouter-anthropic` request (unconditional). No conditional on DEBUG.
- **D-04:** Extract `openrouter_metadata` from the `message_stop` SSE event and **log only when `BETTER_CCFLARE_DEBUG` is set** (Logger debug level). Logging-only — no response change.
- **D-05:** **Dedicated handler + route.** `createOpenRouterAnthropicAccountAddHandler()` in `packages/http-api/src/handlers/accounts.ts` + `POST:/api/accounts/openrouter-anthropic` in `router.ts`.
- **D-06:** Implement all type-union and runtime-condition sites from ARCHITECTURE §3 A+B plus the `PROVIDER_NAMES`/`PROVIDER_CONFIG` entry from §3D. Dashboard sites (AccountAddForm, AccountListItem, api.ts, AccountsTab) are Phase 11.

### Claude's Discretion

- Exact extraction mechanism for `openrouter_metadata` from the SSE stream (provider hook vs. response-processor tap) — only the "extract from `message_stop`, log under DEBUG" property matters.
- Precise field set logged from `openrouter_metadata` (log what the object actually contains — backend/provider name + latency at minimum).
- Whether `X-OpenRouter-Experimental-Metadata` header is set in `buildRequest`/header construction vs. `transformRequestBody`.

### Deferred Ideas (OUT OF SCOPE)

- Dashboard wiring (AccountAddForm SelectItem, AccountListItem provider-preference gate, api.ts/AccountsTab unions) — Phase 11 (MGMT-03/04).
- Live end-to-end overload/failover verification with a real OpenRouter request — Phase 12 integration.
- Making the experimental-metadata header conditional on `BETTER_CCFLARE_DEBUG` — explicitly rejected (D-03).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MGMT-01 | User can add an `openrouter-anthropic` account via CLI (`--add-account --mode openrouter-anthropic`) | CLI wiring sites verified at live lines: mode unions at lines 47 and 79 of `account.ts`; dispatch branch at line 1334 after `"openrouter"`; `listAccounts()` inference at line 1659; `help.ts` mode list line 9 and table line 20 |
| MGMT-02 | User can add an `openrouter-anthropic` account via HTTP API (`POST /api/accounts/openrouter-anthropic`) | `createOpenRouterAccountAddHandler` template verified at line 3424 of `accounts.ts`; router slot at lines 248–250; exact INSERT columns confirmed |
| OBS-01 | User can opt into debug logging of which OpenRouter backend served each request (`openrouter_metadata` from `message_stop`) | `message_stop` shape confirmed from OpenRouter spec — `type` + optional `openrouter_metadata`; Logger debug pattern established in provider class |
| FAIL-01 | Mid-stream `overloaded_error` frames on the new provider trigger account failover (`ANTHROPIC_SHAPE_PROVIDERS` extended) | Sniffer file verified: `ANTHROPIC_SHAPE_PROVIDERS` is at line 43; gating logic at lines 79–82 confirmed live; existing sniffer tests are the exact pattern to mirror |
</phase_requirements>

---

## Summary

Phase 10 is purely wiring work — the provider class (`OpenRouterAnthropicProvider`) was fully implemented in Phase 9 and lives at `packages/providers/src/providers/openrouter-anthropic/provider.ts`. Phase 10 connects it to the rest of the system: type unions, CLI dispatch, HTTP handler, and SSE failover. No new DB migrations, no new npm dependencies, no changes to base classes.

**Codebase verification confirms:** zero `openrouter-anthropic` strings exist outside the provider package itself. All 10+ wiring sites enumerated in CONTEXT.md and ARCHITECTURE.md are confirmed not yet done and have exact live line numbers. Line numbers are accurate to within ±3 lines — verified by reading each file.

**Critical doc conflict:** ARCHITECTURE.md §3C says the SSE sniffer needs no change. This is wrong. D-01 overrides it. The planner must anchor the sniffer change to SC#4 in ROADMAP.md (not §3C) so future reviewers do not revert it.

**Primary recommendation:** Implement all changes in a single wave — the type changes feed forward into CLI/HTTP/sniffer; `bun run typecheck` is the single gate that proves wiring completeness.

---

## Standard Stack

### Core (all existing — no new dependencies)

| Package | Purpose | Phase 10 use |
|---------|---------|--------------|
| `@better-ccflare/types` | Shared type unions | Add `"openrouter-anthropic"` to `PROVIDER_NAMES`, `PROVIDER_CONFIG`, `AccountListItem.mode`, `AddAccountOptions.mode` |
| `@better-ccflare/cli-commands` | CLI account management | Mode union extensions + new dispatch branch + `listAccounts()` inference extension |
| `@better-ccflare/http-api` | REST handlers + router | New `createOpenRouterAnthropicAccountAddHandler` + route registration |
| `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` | SSE failover | Extend `ANTHROPIC_SHAPE_PROVIDERS` set (one line) |
| `@better-ccflare/providers` | Provider class (Phase 9) | Add `X-OpenRouter-Experimental-Metadata` header injection + `message_stop` metadata tap |

**Installation:** no new packages needed.

---

## Architecture Patterns

### Established Pattern: One-Handler-Per-Route (HTTP API)

Every provider mode has a dedicated `createXxxAccountAddHandler(dbOps)` factory function and a dedicated `POST:/api/accounts/xxx` route. The router is a simple `Map<string, handler>` (no framework).

**Template to copy:** `createOpenRouterAccountAddHandler` at line 3424 of `packages/http-api/src/handlers/accounts.ts`. Change only:
- Function name → `createOpenRouterAnthropicAccountAddHandler`
- `provider: "openrouter"` in the INSERT → `provider: "openrouter-anthropic"`
- Success message strings
- Log label

Router registration: mirror lines 248–249 in `packages/http-api/src/router.ts`:
```typescript
// FORK PATCH: openrouter-anthropic account creation route (MGMT-02)
this.handlers.set("POST:/api/accounts/openrouter-anthropic", (req) =>
  openrouterAnthropicAccountAddHandler(req),
);
```
[VERIFIED: direct codebase read]

### Established Pattern: Sibling Branch in CLI Dispatch

`packages/cli-commands/src/commands/account.ts` has a long `if/else if` chain at line 1334. The `"openrouter"` branch (lines 1334–1360) is the exact template:
- Prompt API key, priority, model mappings
- Call `createOpenRouterAccount(dbOps, name, apiKey, priority, finalModelMappings)`

New branch: `else if (mode === "openrouter-anthropic")` immediately after the `"openrouter"` branch. Needs a matching `createOpenRouterAnthropicAccount()` helper that inserts `provider: "openrouter-anthropic"`.

### Established Pattern: `listAccounts()` Mode Inference

At line 1652–1663 in `account.ts`, a direct-mapping block returns `account.provider` as mode for some providers. The `"openrouter"` check is at line 1659 in this block. Add `|| account.provider === "openrouter-anthropic"` to the same condition (or insert a sibling `account.provider === "openrouter-anthropic"` return).

### Established Pattern: `ANTHROPIC_SHAPE_PROVIDERS` Set Extension

`packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` line 43:
```typescript
// CURRENT (verified):
const ANTHROPIC_SHAPE_PROVIDERS = new Set(["anthropic", "claude-oauth"]);

// AFTER D-01 (// FORK PATCH annotation required):
// FORK PATCH: openrouter-anthropic emits Anthropic-shape overloaded_error (FAIL-01 / SC#4)
// Do not revert — see Phase 10 CONTEXT.md D-01 and ROADMAP SC#4.
const ANTHROPIC_SHAPE_PROVIDERS = new Set(["anthropic", "claude-oauth", "openrouter-anthropic"]);
```
[VERIFIED: direct file read — line 43 confirmed]

### Established Pattern: `PROVIDER_NAMES` / `PROVIDER_CONFIG` Extension

`packages/types/src/provider-config.ts` defines the canonical provider metadata record typed as `Record<ProviderName, ProviderConfig>`. Adding to `PROVIDER_NAMES` without adding to `PROVIDER_CONFIG` produces a TypeScript error at the `as const satisfies Record<ProviderName, ProviderConfig>` assertion on line 147. Both must be added atomically.

```typescript
// In PROVIDER_NAMES (after OPENROUTER at line 15):
// FORK PATCH: openrouter-anthropic provider metadata (D-06)
OPENROUTER_ANTHROPIC: "openrouter-anthropic",

// In PROVIDER_CONFIG (after OPENROUTER block ending at line 115):
// FORK PATCH: openrouter-anthropic provider config (D-06)
[PROVIDER_NAMES.OPENROUTER_ANTHROPIC]: {
  requiresSessionTracking: false,
  supportsUsageTracking: false,
  supportsOAuth: false,
  defaultEndpoint: "https://openrouter.ai/api/v1",
},
```
[VERIFIED: full provider-config.ts read — PROVIDER_NAMES + PROVIDER_CONFIG shape confirmed]

### Pattern: Debug Metadata Logging (OBS-01)

The `openrouter_metadata` field appears on `message_stop` events only when `X-OpenRouter-Experimental-Metadata: enabled` was sent. The provider's `transformRequestBody()` (at line 46 of `provider.ts`) is the natural place to inject the header — it already assembles and returns a new `Request` object with cloned headers.

Injection:
```typescript
// In transformRequestBody(), before returning the new Request:
// FORK PATCH: inject experimental metadata header to surface routing info (OBS-01 / D-03)
headers.set("X-OpenRouter-Experimental-Metadata", "enabled");
```

`openrouter_metadata` extraction: the `message_stop` SSE event is currently ignored by the provider — the sniffer and cost extraction both pass it by. The extraction can be a private tap in the provider's streaming path, or in `extractStreamingUsage()` as a side-effect that calls `log.debug()`. No return value change needed. The simplest approach: parse `message_stop` events in `readFinalSseCost()` (already iterates all SSE events) or add a parallel scan in `extractStreamingUsage()`.

The Logger pattern in use:
```typescript
const log = new Logger("OpenRouterAnthropicProvider");
// Already present in provider.ts line 8; log.debug() is silenced unless BETTER_CCFLARE_DEBUG
```
[VERIFIED: provider.ts read]

---

## Verified Wiring Sites — Live Line Numbers

The following table de-risks line-number drift. All lines verified by direct file read on 2026-06-04.

### Type Unions to Extend (§3A subset — Phase 10 scope only)

| File | Live Line | Type | Action |
|------|-----------|------|--------|
| `packages/types/src/account.ts` | 270–286 | `AccountListItem.mode` union | Add `\| "openrouter-anthropic"` after `"openrouter"` at line 281 |
| `packages/types/src/account.ts` | 296–305 | `AddAccountOptions.mode` union | Add `\| "openrouter-anthropic"` after `"openrouter"` at line 304 |
| `packages/types/src/provider-config.ts` | 15 | `PROVIDER_NAMES` object | Add `OPENROUTER_ANTHROPIC: "openrouter-anthropic"` |
| `packages/types/src/provider-config.ts` | 49–147 | `PROVIDER_CONFIG` record | Add `[PROVIDER_NAMES.OPENROUTER_ANTHROPIC]` entry after OPENROUTER block |
| `packages/cli-commands/src/commands/account.ts` | 40–52 | `AddAccountOptionsWithAdapter.mode` union | Add `\| "openrouter-anthropic"` after `"openrouter"` at line 47 |
| `packages/cli-commands/src/commands/account.ts` | 69–84 | `AccountListItemWithMode.mode` union | Add `\| "openrouter-anthropic"` after `"openrouter"` at line 79 |

[VERIFIED: all live file reads]

### Runtime Conditions to Add (§3B subset — Phase 10 scope only)

| File | Live Line | Condition | Action |
|------|-----------|-----------|--------|
| `packages/cli-commands/src/commands/account.ts` | 1334 | `else if (mode === "openrouter")` | Add `else if (mode === "openrouter-anthropic")` branch after it |
| `packages/cli-commands/src/commands/account.ts` | 1659 | `account.provider === "openrouter"` in list inference | Add `\|\| account.provider === "openrouter-anthropic"` |
| `packages/http-api/src/handlers/accounts.ts` | ~3424 | `createOpenRouterAccountAddHandler` | Add parallel `createOpenRouterAnthropicAccountAddHandler` inserting `"openrouter-anthropic"` |
| `packages/http-api/src/router.ts` | 248–250 | `POST:/api/accounts/openrouter` | Add `POST:/api/accounts/openrouter-anthropic` route |
| `packages/proxy/src/handlers/sse-rate-limit-sniffer.ts` | 43 | `ANTHROPIC_SHAPE_PROVIDERS` set | Add `"openrouter-anthropic"` |

[VERIFIED: all live file reads]

### Help Text (ARCHITECTURE §2)

| File | Live Line | Change |
|------|-----------|--------|
| `packages/cli-commands/src/commands/help.ts` | 9 | Add `openrouter-anthropic` to mode option list string |
| `packages/cli-commands/src/commands/help.ts` | 20 | Add description line: `openrouter-anthropic: OpenRouter native Anthropic Messages endpoint (API key)` |

[VERIFIED: direct file read]

### Provider Additions (in existing Phase 9 file)

| File | Change |
|------|--------|
| `packages/providers/src/providers/openrouter-anthropic/provider.ts` | Inject `X-OpenRouter-Experimental-Metadata: enabled` header in `transformRequestBody()` (D-03); add `message_stop` metadata tap + `log.debug()` (D-04) |

[VERIFIED: provider.ts fully read — header injection and metadata logging not yet present]

---

## Sites Confirmed NOT Needing Change (Phase 10)

These were verified by live codebase reads. No action needed:

| File | Why |
|------|-----|
| `packages/proxy/src/handlers/response-processor.ts` | No `provider === "openrouter"` special-case. Per-provider logic is polymorphic via provider class methods. [VERIFIED: ARCHITECTURE.md §3C — no drift from live code] |
| `packages/proxy/src/usage-extraction.ts` | `typeof === "number"` guard on `usage.cost` — provider-agnostic. [VERIFIED] |
| `packages/proxy/src/post-processor.worker.ts` | `resolveCostUsd()` is provider-agnostic. [VERIFIED] |
| `packages/database/src/migrations.ts` + `migrations-pg.ts` | No new columns needed. `openrouter_provider_preference` already exists. [VERIFIED: REQUIREMENTS.md out-of-scope table] |
| `packages/database/src/repositories/account.repository.ts` | String-based reads/writes; provider-agnostic. [VERIFIED] |
| `packages/proxy/src/auto-refresh-scheduler.ts` | `openrouter_provider_preference: null` is a structural field on the Account type; not a provider special-case. [VERIFIED] |
| `packages/types/src/account.ts` — `toAccount()`, `toAccountResponse()` | FORK PATCH for `openrouter_provider_preference` parsing is unconditional. [VERIFIED] |

**Dashboard files (Phase 11 — do not touch in Phase 10):**
- `packages/dashboard-web/src/api.ts` line 259
- `packages/dashboard-web/src/components/AccountsTab.tsx` line 120
- `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` lines 28, 157, 431, 1020, 710, 1051, 1665
- `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` line 350

---

## Common Pitfalls

### Pitfall 1: Reverting the Sniffer Change Based on §3C

**What goes wrong:** A reviewer reads ARCHITECTURE.md §3C which says "no change needed" for the sniffer and reverts the `ANTHROPIC_SHAPE_PROVIDERS` extension.
**Root cause:** §3C was written before the endpoint SSE shape was confirmed empirically. The correction is in the annotated §3C itself and in CONTEXT.md D-01.
**Prevention:** Include a comment in the sniffer that cites SC#4 and CONTEXT.md D-01. Make the PLAN.md rationale for D-01 explicit enough to survive a future upstream merge review.
**Warning signs:** If `ANTHROPIC_SHAPE_PROVIDERS` only contains `["anthropic", "claude-oauth"]` after Phase 10 is complete, FAIL-01 is broken.

### Pitfall 2: `PROVIDER_CONFIG` TypeScript Error

**What goes wrong:** Adding `OPENROUTER_ANTHROPIC` to `PROVIDER_NAMES` without adding the matching entry to `PROVIDER_CONFIG` produces a TypeScript error because of the `as const satisfies Record<ProviderName, ProviderConfig>` constraint on line 147 of `provider-config.ts`.
**Root cause:** The record is typed to match every `ProviderName` value exactly.
**Prevention:** Always add both in the same edit. The typecheck gate catches this automatically.

### Pitfall 3: HTTP Handler Missing from Router Exports

**What goes wrong:** The new handler factory is defined in `accounts.ts` but not imported in `router.ts`, so the route 404s silently.
**Root cause:** `router.ts` imports handlers explicitly by name; there is no barrel auto-export.
**Prevention:** Check router.ts imports after adding the handler. The integration test for MGMT-02 (POST returns 200) catches this.

### Pitfall 4: `listAccounts()` Missing the New Provider

**What goes wrong:** After CLI `--add-account --mode openrouter-anthropic`, `--list` shows the account with mode `"console"` (the final fallback) because `account.provider === "openrouter-anthropic"` is not in the inference block at line 1652.
**Root cause:** The mode-inference block has explicit provider-to-mode mappings; new providers must be added here.
**Prevention:** Integration test: add account via CLI, run `--list`, assert mode shows `"openrouter-anthropic"`.

### Pitfall 5: `X-OpenRouter-Experimental-Metadata` Header Not on Cloned Request

**What goes wrong:** `transformRequestBody()` clones the request to parse the body, then constructs a new `Request`. If the header is set on the intermediate `headers` but the final `new Request(url, { headers })` is not constructed with the updated headers, the header is lost.
**Root cause:** `Request` headers are immutable once constructed; must pass the mutated `Headers` object to the final `new Request(...)`.
**Prevention:** Verify by reading `transformRequestBody()` — it already builds a `new Request(mapped.url, { method, headers: mapped.headers, body })`. Set the header on `mapped.headers` before constructing the return value, or clone `mapped.headers` into a mutable `Headers` and set there.

---

## Code Examples

### Sniffer Extension (D-01)
```typescript
// packages/proxy/src/handlers/sse-rate-limit-sniffer.ts line 43
// FORK PATCH: openrouter-anthropic emits Anthropic-shape overloaded_error (FAIL-01 / SC#4)
// Do not revert — see Phase 10 CONTEXT.md D-01. §3C in ARCHITECTURE.md is incorrect.
const ANTHROPIC_SHAPE_PROVIDERS = new Set([
  "anthropic",
  "claude-oauth",
  "openrouter-anthropic",
]);
```
[VERIFIED: current value confirmed at line 43]

### Metadata Header Injection (D-03) — in `transformRequestBody()`
```typescript
// After cloning and parsing body, before constructing the return Request:
// FORK PATCH: inject routing metadata header unconditionally (OBS-01 / D-03)
const headers = new Headers(mapped.headers);
headers.set("X-OpenRouter-Experimental-Metadata", "enabled");
return new Request(mapped.url, {
  method: mapped.method,
  headers,
  body: JSON.stringify(body),
});
```
[ASSUMED — exact integration point depends on provider.ts header-assembly flow; verify at implementation]

### Metadata Debug Logging (D-04) — in SSE parsing
```typescript
// Where message_stop events are parsed:
// FORK PATCH: log openrouter_metadata under DEBUG only (OBS-01 / D-04)
if (data.openrouter_metadata) {
  log.debug("OpenRouter routing metadata:", JSON.stringify(data.openrouter_metadata));
}
```
[ASSUMED — exact location depends on which method taps message_stop; executor chooses]

### Sniffer Test (D-02 — mirrors existing test style)
```typescript
// packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts
it("openrouter-anthropic provider fires on overloaded_error (Anthropic-shape)", () => {
  const sniffer = createSseRateLimitSniffer({ provider: "openrouter-anthropic" });
  const frame = encode(
    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
  );
  expect(sniffer.feed(frame)).toBe(true);
  expect(sniffer.firedReason).toBe("overloaded_error");
});
```
[VERIFIED: existing test file read — exact pattern at lines 147–154]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `X-OpenRouter-Experimental-Metadata` header can be injected by mutating `new Headers(mapped.headers)` before the final `new Request(...)` | Code Examples — D-03 | Low: the existing `transformRequestBody()` already constructs a `new Request` with custom body; the header addition is a one-line set on the Headers object |
| A2 | `message_stop` SSE events reach the provider's streaming path (not consumed/dropped by an upstream layer) | Code Examples — D-04 | Low: the sniffer reads the outgoing response body; the provider's `extractStreamingUsage()` reads a clone; both see all events |

---

## Open Questions

1. **Where exactly to tap `message_stop` for OBS-01**
   - What we know: `extractStreamingUsage()` in the provider already scans `message_delta` events; `readFinalSseCost()` scans the full SSE body
   - What is unclear: adding a second full-body scan for `message_stop` is wasteful if the SSE body can only be read once; but the provider already clones before each scan (line 210: `const costClone = clone.clone()`)
   - Recommendation: extend `readFinalSseCost()` to also detect and log `message_stop` metadata in the same pass, avoiding a second clone. This is executor discretion per CONTEXT.md.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 10 is code/config-only changes. No external services, CLI utilities, or databases beyond the existing project runtime are needed.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test |
| Config file | none — bun native |
| Quick run command | `bun test packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` |
| Full suite command | `bun run typecheck && bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FAIL-01 | `overloaded_error` SSE frame with `provider: "openrouter-anthropic"` fires sniffer | unit | `bun test packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts` | yes — add 2 new cases to existing file |
| FAIL-01 | `overloaded_error` with non-Anthropic provider does NOT fire | unit | same | yes — pattern already present for `openai-compatible`; add `openrouter` (OAI-shape) negative case |
| MGMT-01 | `AddAccountOptionsWithAdapter.mode` accepts `"openrouter-anthropic"` | type-check | `bun run typecheck` | yes — zero errors is the gate |
| MGMT-01 | CLI `--list` shows mode `"openrouter-anthropic"` after add | integration | manual-only (no CLI test harness) | manual — flag for Phase 12 |
| MGMT-02 | `POST /api/accounts/openrouter-anthropic` returns 200 | integration | manual-only (no HTTP test harness in scope) | manual — flag for Phase 12 |
| OBS-01 | `openrouter_metadata` is logged at debug level when DEBUG set | unit | `bun test packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` | yes — add test case to existing provider test file |

### Sampling Rate

- **Per commit:** `bun run typecheck` (zero-error gate)
- **Per wave merge:** `bun run typecheck && bun test packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts`
- **Phase gate:** Full `bun run typecheck && bun run lint && bun run format && bun test` before `/gsd-verify-work`

### Wave 0 Gaps

None — existing test files cover all Phase 10 test targets. Tests are additions to existing files, not new files.

---

## Project Constraints (from CLAUDE.md)

All of the following apply to Phase 10 changes:

- **NEVER curl the Anthropic endpoint** — no live end-to-end tests against real accounts. Synthetic SSE fixtures only (D-02).
- **NEVER bump the version** — auto-handled.
- **NEVER edit auto-generated files** — `packages/proxy/src/inline-worker.ts`, `packages/database/src/inline-vacuum-worker.ts`, `packages/database/src/inline-integrity-check-worker.ts`. Do not touch.
- **DB migrations must be dual-ported** — not applicable to Phase 10 (no new columns).
- **`// FORK PATCH:` annotation** — required on every fork-specific line/block. All Phase 10 additions are fork-specific and must carry this annotation.
- **After code changes:** `bun run lint && bun run typecheck && bun run format` before committing.
- **`git add <specific-files>`** — never `git add .` (avoids committing `inline-worker.ts`).
- **Commit prefixes:** `feat:` for new CLI/HTTP modes; `fix:` for the sniffer extension (fixing a gap in failover coverage).
- **Named exports only** — no `export default`; cross-package via `@better-ccflare/*` barrel imports.
- **Logger, not `console.*`** — the `log.debug()` calls for OBS-01 must use the `Logger` class.

---

## Sources

### Primary (HIGH confidence)

- Live codebase reads (2026-06-04) — `sse-rate-limit-sniffer.ts`, `provider-config.ts`, `account.ts` (types), `account.ts` (cli-commands), `accounts.ts` (http-api), `router.ts`, `provider.ts` (openrouter-anthropic), `provider.test.ts`, `sse-rate-limit-sniffer.test.ts`
- `.planning/phases/10-type-wiring-cli-http-api-sse-sniffer/10-CONTEXT.md` — locked decisions D-01 through D-06
- `.planning/research/ARCHITECTURE.md` §3 — grep-backed site enumeration (with §3C correction confirmed)
- `.planning/research/STACK.md` — OpenRouter spec-confirmed SSE shapes and `message_stop` schema

### Secondary (MEDIUM confidence)

- `.planning/research/SUMMARY.md` + `.planning/REQUIREMENTS.md` — requirements traceability

### Flagged for Validation (LOW confidence)

None — all critical claims verified from live codebase.

---

## Metadata

**Confidence breakdown:**
- Wiring sites and live line numbers: HIGH — verified by direct file reads
- Test strategy: HIGH — mirrors existing Phase 9 + sniffer test patterns exactly
- D-03 header injection location: MEDIUM — provider structure confirmed, exact injection point executor discretion
- D-04 metadata extraction location: MEDIUM — `message_stop` parsing location is executor discretion

**Research date:** 2026-06-04
**Valid until:** Stable — no external APIs; only changes are when upstream merges modify the enumerated files
