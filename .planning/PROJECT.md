# better-ccflare (Personal Fork)

## What This Is

A maintained personal fork of [better-ccflare](https://github.com/tombii/better-ccflare) — a Bun-based Claude API load balancer proxy that distributes requests across multiple account providers to avoid rate limiting. This fork continuously pulls upstream releases and layers personal improvements: corrected OpenRouter billing and cache injection, fork patch annotations and regression tests, and operational tooling for safe upstream merges.

## Core Value

Stay current with upstream while running a stable personal instance enhanced with features I need — primarily around OpenRouter caching, provider selection, and a clean patch workflow.

## Current State: v1.1 Shipped (2026-05-21)

**Shipped:** v1.1 — Extended caching for openrouter models. 4 phases, 11 plans, ~268 commits in 16 days.

**Next milestone:** Planning phase — use `/gsd-new-milestone` to define v1.2 goals.

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

### Active

*(Next milestone requirements go here — run `/gsd-new-milestone` to define them)*

### Future

- [ ] Per-request OpenRouter provider selection (`x-better-ccflare-openrouter-provider` header → `provider.order` injection) — deferred from v1.1

### Out of Scope

- Maintaining the upstream project — that's tombii's responsibility; we contribute back selectively
- Auto-publishing to npm/GitHub Container Registry — upstream's release system handles this; never bump versions manually
- Rebuilding or replacing core proxy logic — extend the existing provider abstraction, don't rewrite it
- `provider.only` support — eliminates all fallback; always use `provider.order`

## Context

**Shipped:** v1.1 (2026-05-21) — 4 phases, 11 plans, ~268 commits in 16 days.

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

**Known tech debt (v1.1):**
- Pre-existing 27 Biome lint errors in dashboard React components (unrelated to fork patches)
- Discard Changes dialog behavior has no formal UAT test (SC-4 gap) — testing gap only

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
*Last updated: 2026-05-21 after v1.1 milestone — all 9 requirements validated; v1.2 planning pending*
