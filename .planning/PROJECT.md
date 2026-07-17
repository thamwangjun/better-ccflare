# better-ccflare (Personal Fork)

## What This Is

A maintained personal fork of [better-ccflare](https://github.com/tombii/better-ccflare) — a Bun-based Claude API load balancer proxy that distributes requests across multiple account providers to avoid rate limiting. This fork continuously pulls upstream releases and layers personal improvements: corrected OpenRouter billing and cache injection, fork patch annotations and regression tests, and operational tooling for safe upstream merges.

## Core Value

Stay current with upstream while running a stable personal instance enhanced with features I need — primarily around OpenRouter caching, provider selection, and a clean patch workflow.

## Current State

**Shipped:** v1.3 OpenRouter Anthropic Messages Provider (2026-07-17, work completed 2026-06-04) — 3 phases, 7 plans. Added a new `openrouter-anthropic` account type that routes to OpenRouter's native Anthropic Messages endpoint (`POST https://openrouter.ai/api/v1/messages`), passing Claude Code's requests through verbatim instead of transforming Anthropic → OpenAI chat-completions and back. Coexists with the original OpenAI-format `openrouter` provider. Fully wired through provider class, CLI, HTTP API, SSE failover, debug observability, and dashboard.

## Current Milestone: v100.0 Bun-to-Node.js Migration

**Goal:** Fully migrate better-ccflare off Bun — runtime, package manager/workspaces, test runner, SQLite driver, HTTP server, worker threads, standalone CLI binary packaging, and Docker/CI. By the end of this milestone, Bun is dropped completely from the repo.

**Target features:**
- Package manager/workspaces: `bun.lock` → npm workspaces
- Runtime/HTTP server: `Bun.serve()` → Node.js equivalent (research-pending)
- Test runner: `bun:test` → Node.js equivalent (research-pending)
- SQLite driver: `packages/database/src/adapters/bun-sql-adapter.ts` → Node.js equivalent (research-pending)
- Worker threads: 3 inline Bun workers (`inline-worker.ts`, `inline-vacuum-worker.ts`, `inline-integrity-check-worker.ts`) → `node:worker_threads`
- Standalone CLI binary packaging: Bun's compiler → Node.js equivalent (research-pending)
- Docker base image (currently `debian:bookworm-slim` + Bun) and CI/release automation → Node-based

**Why:** Business-continuity risk aversion around depending on Bun (Oven) as a single-vendor runtime — community support continuity, code-quality/AI-slop-rewrite risk, and commercial buyout/licensing risk. Not primarily a bug fix, though it may incidentally help the two open Bun-worker-related debug sessions (`chunk-dropped-worker-stopped`, `stalled-streaming-requests`).

**Constraints locked before requirements:**
- Migration strategy: incremental — every phase leaves the app fully functional/deployable, never a big-bang cutover
- Package manager: npm workspaces (zero additional vendor dependency)
- Node version floor: Node 24 (current LTS per user correction — verify via research, not assumed from training data)
- **Verification expectation:** every phase's "app still starts/serves requests with no regression" success criterion is anticipated to fail on the first pass for at least some phases, given real Bun/Node behavioral differences (see `.planning/research/PITFALLS.md`). Planning and execution should budget a gap-closure plan/wave per phase by default rather than treating first-pass failure as a sign of mis-scoping. See `.planning/ROADMAP.md`'s "Verification Expectation" note for the full directive to planner/executor/verifier agents.

## Requirements

### Validated

- ✓ OpenRouter `extractUsageInfo` reads `prompt_tokens_details.cache_write_tokens` (accurate cache billing) — v1.0
- ✓ OpenRouter `cache_control` ephemeral per-block injection at 3 Anthropic breakpoints — v1.0
- ✓ `// FORK PATCH:` comment annotations on fork-specific code for upstream merge safety — v1.0
- ✓ 10-test regression suite covering all OpenRouter cache scenarios — v1.0
- ✓ `pre-merge-check.sh` + `post-merge-export.sh` scripts with `bun run` aliases — v1.0
- ✓ Agent-executable 6-step `UPSTREAM_MERGE.md` SOP with per-file conflict resolution — v1.0
- ✓ Extended cache injection to 4 breakpoints with count guard (never exceeds 4 total) — v1.1
- ✓ `ttl: "1h"` on system/tools blocks; `{ type: "ephemeral" }` on user/assistant blocks, gated on `SYSTEM_PROMPT_CACHE_TTL_1H=true` — v1.1
- ✓ Per-account `openrouter_provider_preference` data model (SQLite + PG migrations, full type chain) — v1.1
- ✓ Proxy injects `body.provider = { order, allow_fallbacks }` from stored preference when client hasn't supplied `provider` field — v1.1
- ✓ PUT/DELETE REST endpoints for per-account provider preference management — v1.1
- ✓ Dashboard dialog for OpenRouter accounts to set/clear provider order (gated on `account.provider === "openrouter"`) — v1.1
- ✓ pre-merge-check.sh HIGH_RISK_FILES extended to 5 entries; 27 FORK PATCH annotations confirmed — v1.1
- ✓ OpenRouter `extractUsageInfo()` reads `usage.cost` from non-streaming JSON and returns it as `costUsd` (typeof-guarded) — v1.2 (COST-01)
- ✓ Post-processor worker reads `usage.cost` from SSE `message_delta` and non-streaming body JSON into `providerCostUsd` — v1.2 (COST-02/03)
- ✓ `estimateCostUSD()` skipped when provider-returned `costUsd` is available; live streaming covered via `extractStreamingUsage`/`parseUsage` override — v1.2
- ✓ `requests.cost_usd` populated with real OpenRouter USD amounts; genuine `$0` preserved (`?? null`), estimate-`$0` collapses to `null`, COALESCE guards dual write — v1.2 (COST-04)
- ✓ Dashboard Add Account form offers `openrouter-anthropic` mode and submits to `POST /api/accounts/openrouter-anthropic` — v1.3 Phase 11 (MGMT-03)
- ✓ Dashboard provider-preference dialog gate widened to surface for `openrouter-anthropic` account cards — v1.3 Phase 11 (MGMT-04)
- ✓ `OpenRouterAnthropicProvider` extends `AnthropicCompatibleProvider`, routes to `https://openrouter.ai/api/v1/messages` with `Authorization: Bearer`, coexists with the OpenAI-format `openrouter` provider — v1.3 Phase 9 (PROV-01/02/03)
- ✓ Native `cache_control` passthrough — zero injection, verbatim passthrough — v1.3 Phase 9 (CACHE-01)
- ✓ Provider preference injection (`body.provider = { order, allow_fallbacks }`) reusing `openrouter_provider_preference` on the new provider — v1.3 Phase 9 (ROUTE-01)
- ✓ Stable per-account `session_id` injection (SHA-256 of `account.id`) for prompt-cache stickiness — v1.3 Phase 9 (ROUTE-02)
- ✓ Real cost tracking (`usage.cost`) persisted to `requests.cost_usd` from the native Anthropic usage object, both streaming and non-streaming paths — v1.3 Phase 9 (COST-01/02)
- ✓ CLI (`--mode openrouter-anthropic`) and HTTP API (`POST /api/accounts/openrouter-anthropic`) account creation — v1.3 Phase 10 (MGMT-01/02)
- ✓ Mid-stream `overloaded_error` SSE failover for `openrouter-anthropic` accounts (`ANTHROPIC_SHAPE_PROVIDERS` extension) — v1.3 Phase 10 (FAIL-01)
- ✓ Opt-in DEBUG logging of `openrouter_metadata` (backend, latency) via `X-OpenRouter-Experimental-Metadata` header — v1.3 Phase 10 (OBS-01)

### Active

<!-- Awaiting next milestone requirements -->

(None yet — see REQUIREMENTS.md once next milestone is scoped)

### Future

- [ ] Per-request OpenRouter provider selection (`x-better-ccflare-openrouter-provider` header → `provider.order` injection) — deferred from v1.1
- [ ] Extended `provider` routing fields in `openrouter_provider_preference` schema (`sort`, `data_collection`, `zdr`, `max_price`) — deferred from v1.3, requires schema migration + UI expansion

### Out of Scope

- Maintaining the upstream project — that's tombii's responsibility; we contribute back selectively
- Auto-publishing to npm/GitHub Container Registry — upstream's release system handles this; never bump versions manually
- Rebuilding or replacing core proxy logic — extend the existing provider abstraction, don't rewrite it
- `provider.only` support — eliminates all fallback; always use `provider.order`
- Modifying the existing OpenAI-format `openrouter` provider — v1.3's `openrouter-anthropic` coexists as a separate provider; isolating native-endpoint logic keeps upstream merges clean

## Context

**Shipped:** v1.3 (2026-07-17 archived, work completed 2026-06-04) — 3 phases, 7 plans in 2 days. v1.2 (2026-06-02) — 2 phases, 4 plans, 5 quick tasks in 2 days. v1.1 (2026-05-21) — 4 phases, 11 plans, ~268 commits in 16 days.

**Codebase:** Bun monorepo (`apps/server`, `apps/cli`, ~15 `packages/`). Provider abstraction layer in `packages/providers/src/providers/` — each provider extends `BaseProvider` with `buildRequest()`, `parseRateLimit()`, `getUsage()`. OpenRouter lives at `packages/providers/src/providers/openrouter/`.

**Branch strategy:** `thamw-main` is the personal working branch. `main` tracks upstream. Upstream is added as a remote (`upstream`). Merges flow: `upstream/main` → `main` → `thamw-main`.

**Fork patches on `thamw-main` (v1.1 state):**
- `// FORK PATCH:` comment + `cache_write_tokens` extraction from `prompt_tokens_details` (`openai/provider.ts`)
- OpenRouter `cache_control` injection at 4 breakpoints with count guard + non-destructive retrofit (`openrouter/provider.ts`)
- Provider preference injection (`body.provider = { order, allow_fallbacks }`) when account has preference set (`openrouter/provider.ts`)
- 20-test regression suite (`openrouter/__tests__/provider.test.ts`)
- `openrouter_provider_preference` column + type chain + repository + facade (`packages/database/`, `packages/types/`)
- PUT/DELETE endpoints for provider preference (`packages/http-api/src/handlers/accounts.ts`, `router.ts`)
- Dashboard Provider Preferences dialog (`packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx`)
- Pre/post merge scripts + SOP with 5-entry HIGH_RISK_FILES list (`.planning/scripts/`)

**Testing constraint:** Never test via the `claude` account or direct Anthropic endpoints. Use non-Anthropic accounts (ollama, litellm, openrouter with `z-ai/glm-4.5-air:free`) and force-route with `x-better-ccflare-account-id`.

**Fork patches added in v1.2 (`thamw-main`):**
- `usage.cost` extraction in `OpenRouterProvider.extractUsageInfo()` (non-streaming) + `extractStreamingUsage`/`parseUsage` overrides (live streaming) (`openrouter/provider.ts`)
- Worker `providerCostUsd` threading from SSE `message_delta` + non-streaming body, gating `estimateCostUSD()` (`post-processor.worker.ts`)
- Shared `usage-extraction.ts` module (`parseSSELine`, `resolveCostUsd`, `extractUsageFromJson`, `extractUsageFromData`) imported by worker + tests
- `cost_usd` writers use `?? null` (preserve real `$0`); COALESCE in `save()` `ON CONFLICT` (`request.repository.ts`)

**Fork patches added in v1.3 (`thamw-main`):**
- `OpenRouterAnthropicProvider` class extending `AnthropicCompatibleProvider` (`packages/providers/src/providers/openrouter-anthropic/provider.ts`) — buildUrl, transformRequestBody (3 FORK-PATCH injections: provider preference, session_id, usage), extractUsageInfo/extractStreamingUsage/parseUsage/readFinalSseCost
- `PROVIDER_NAMES.OPENROUTER_ANTHROPIC` + `PROVIDER_CONFIG` entry + account-mode unions across the shared type system
- CLI `--mode openrouter-anthropic` dispatch + HTTP API `POST /api/accounts/openrouter-anthropic` route
- `ANTHROPIC_SHAPE_PROVIDERS` extended for `openrouter-anthropic` mid-stream `overloaded_error` failover (`sse-rate-limit-sniffer.ts`)
- `X-OpenRouter-Experimental-Metadata` header + DEBUG-gated `openrouter_metadata` logging tap
- Dashboard Add Account form + provider-preference dialog gate widened for `openrouter-anthropic`

**Known tech debt:**
- Pre-existing 27 Biome lint errors in dashboard React components (unrelated to fork patches) — v1.1
- Discard Changes dialog behavior has no formal UAT test (SC-4 gap) — testing gap only — v1.1
- Manual live-streaming USD-in-logs check (D-05) unperformed by design — requires `:free` model force-routed to OpenRouter, never Anthropic/`claude` — v1.2
- Dashboard `$0` display gap (`RequestDetailsModal.tsx:149`, `RequestsTab.tsx:886`) — out of scope; data persisted, display only — v1.2
- Two open debug sessions carried into next milestone as deferred tech debt (see `.planning/STATE.md` Deferred Items): `chunk-dropped-worker-stopped` (root cause of async usage-collector worker entering `stopped` state, unconfirmed after 3 cycles) and `stalled-streaming-requests` (two untested competing hypotheses — OAuth refresh fetch hang vs. SQLite `SQLITE_BUSY` lock contention)
- 6 quick tasks with unresolved completion status acknowledged as deferred at v1.3 close (see `.planning/STATE.md` Deferred Items) — v1.3

## Constraints

- **Safety**: Never curl Anthropic endpoint in tests — risk of account ban
- **Generated file**: `inline-worker.ts` is auto-generated — never edit directly
- **Versioning**: Version bumps are automated — never bump manually
- **Compatibility**: Patches must apply cleanly after upstream merges; avoid structural changes to shared packages
- **Stack**: Bun runtime, TypeScript, biome for lint/format — must pass `bun run lint && bun run typecheck && bun run format` after every change

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork upstream rather than contribute all changes back | Some changes (infra, personal config) aren't appropriate for upstream; faster iteration | ✓ Good |
| Target OpenRouter as primary enhancement surface | Most flexible provider — supports provider selection, has non-standard behavior worth improving | ✓ Good |
| Keep patches minimal and localized | Easier to reapply after upstream merges; smaller conflict surface | ✓ Good |
| Override `extractUsageInfo` in `OpenRouterProvider` rather than modify base class | OpenRouter's `prompt_tokens_details` format is non-standard; modifying base would break Anthropic/Bedrock paths | ✓ Good |
| Omit `anthropic/*` model prefix gate on `cache_control` injection | Gate would block all non-Anthropic OpenRouter requests; per-block injection is safe for all routes | ✓ Good |
| Hardcode high-risk file list in `pre-merge-check.sh` | Simpler and stable for a 3-file surface; dynamic scanning adds complexity without benefit | ✓ Good |
| Gitignore generated patch exports (`.planning/patches/`) | Regenerated on every merge run; git tags provide durable commit references | ✓ Good |
| Store `openrouter_provider_preference` as JSON object `{ order, allow_fallbacks }` rather than bare array | Supports adding further OpenRouter provider fields without a schema change; `allow_fallbacks ?? true` preserves explicit `false` | ✓ Good |
| `"provider" in body` field-presence check for provider injection guard | Preserves `body.provider = {}` (empty object would be falsy with `!body.provider`); explicit is safer than truthy | ✓ Good |
| `countExistingCacheControlBlocks()` extracted as module-level helper | Improves readability and testability of `transformRequestBody()`; count guard runs once before any mutation | ✓ Good |
| No `ttl:` injected in `transformRequestBody()` — delegate to `injectSystemCacheTtl()` | Avoids double-injection on the TTL upgrade path; single source of truth for TTL logic in proxy.ts | ✓ Good |
| Dashboard Provider Preferences dialog gated on `account.provider === "openrouter"` | Non-OpenRouter accounts show no dialog — avoids surfacing irrelevant controls | ✓ Good |
| `typeof json.usage.cost === "number"` guard before assigning `costUsd` | Provider-controlled field; rejects null/absent/string to avoid persisting tampered/garbage cost | ✓ Good |
| Split COST-01/02/03 (extraction, Phase 7) from COST-04 (persistence, Phase 8) | Gives a verification checkpoint — extraction testable before wiring through to the DB | ✓ Good |
| Override `extractStreamingUsage` (clone-before-super) on OpenRouterProvider, base untouched | Live streaming path needs real `usage.cost` from final SSE chunk; super consumes the single-use body reader, so clone first | ✓ Good |
| `?? null` (not `\|\| null`) for `cost_usd` writers; estimate-`0 → undefined` in worker | Distinguishes a genuine `$0` from `:free` models (persist as `0`) from an estimate-`$0` for unknown models (collapse to `null`) | ✓ Good |
| `COALESCE(EXCLUDED.cost_usd, requests.cost_usd)` in `save()` ON CONFLICT | Live path writes real cost first; worker's later upsert with a failed parse (`null`) must not overwrite it | ✓ Good |
| Extract `usage-extraction.ts` shared module imported by worker + tests | Eliminates inline-copy drift — tests exercise the exact production code path | ✓ Good |
| Extend `AnthropicCompatibleProvider`, not `OpenRouterProvider`, for `openrouter-anthropic` | Avoids inheriting the 4-breakpoint `cache_control` injector and OAI-format `extractUsageInfo`; native endpoint needs neither | ✓ Good |
| Zero `cache_control` injection on `openrouter-anthropic` — verbatim passthrough | Claude Code already sends its own cache blocks in Anthropic format; no breakpoint-injection hacks needed on the native endpoint | ✓ Good |
| Stable per-account `session_id` (SHA-256 hash of `account.id`), always-on injection | Maximizes prompt-cache stickiness for a single-user personal fork; deterministic and easy to unit-test; rejected per-conversation hashing as unnecessary complexity | ✓ Good |
| Add `openrouter-anthropic` to `ANTHROPIC_SHAPE_PROVIDERS` in the SSE sniffer | Native endpoint's SSE stream is byte-for-byte Anthropic shape and emits genuine `overloaded_error` envelopes — without this, failover only matches `rate_limit_error` | ✓ Good |
| Always inject `X-OpenRouter-Experimental-Metadata: enabled` header (no conditional) | Simpler branch-free header logic; accepted trade-off of every production request carrying an experimental header in exchange for `openrouter_metadata` visibility | ✓ Good |
| `openrouter_metadata` logged only when `BETTER_CCFLARE_DEBUG` is set | `message_stop` carries no usage/cost — separate observability tap from the cost path, silenced by default like all other debug logging | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-17 after v1.3 milestone completion*
