# better-ccflare (Personal Fork)

## What This Is

A maintained personal fork of [better-ccflare](https://github.com/tombii/better-ccflare) — a Bun-based Claude API load balancer proxy that distributes requests across multiple account providers to avoid rate limiting. This fork continuously pulls upstream releases and layers personal improvements: corrected OpenRouter billing and cache injection, fork patch annotations and regression tests, and operational tooling for safe upstream merges.

## Core Value

Stay current with upstream while running a stable personal instance enhanced with features I need — primarily around OpenRouter caching, provider selection, and a clean patch workflow.

## Current Milestone: v1.1 Extended caching for openrouter models

**Goal:** Extend OpenRouter cache injection to the full 4-breakpoint limit, add long-TTL cache support for agentic sessions, and enable per-account OpenRouter provider preferences.

**Target features:**
- Extended cache breakpoints — add the 4th (high-token user message) to reach the full Anthropic cache breakpoint limit
- 1-hour TTL cache blocks — for agentic sessions exceeding the 5-min sticky routing window
- Per-account provider preference — ENV var + Dashboard UI to set a default OpenRouter provider per account

## Requirements

### Validated

- ✓ OpenRouter `extractUsageInfo` reads `prompt_tokens_details.cache_write_tokens` (accurate cache billing) — v1.0
- ✓ OpenRouter `cache_control` ephemeral per-block injection at 3 Anthropic breakpoints — v1.0
- ✓ `// FORK PATCH:` comment annotations on fork-specific code for upstream merge safety — v1.0
- ✓ 10-test regression suite covering all OpenRouter cache scenarios — v1.0
- ✓ `pre-merge-check.sh` + `post-merge-export.sh` scripts with `bun run` aliases — v1.0
- ✓ Agent-executable 6-step `UPSTREAM_MERGE.md` SOP with per-file conflict resolution — v1.0

### Active

- [ ] Extended cache breakpoints (up to 4-breakpoint limit — system + high-token user message) — v1.1
- [ ] 1-hour TTL on cache blocks for agentic sessions exceeding the 5-minute sticky routing window — v1.1
- [ ] Per-account OpenRouter provider preference via ENV var — v1.1
- [ ] Dashboard UI for per-account OpenRouter provider preference — v1.1

### Future

- [ ] Per-request OpenRouter provider selection (`x-better-ccflare-openrouter-provider` header → `provider.order` injection) — deferred from v1.1

### Out of Scope

- Maintaining the upstream project — that's tombii's responsibility; we contribute back selectively
- Auto-publishing to npm/GitHub Container Registry — upstream's release system handles this; never bump versions manually
- Rebuilding or replacing core proxy logic — extend the existing provider abstraction, don't rewrite it
- `provider.only` support — eliminates all fallback; always use `provider.order`

## Context

**Shipped:** v1.0 (2026-05-05) — 2 phases, 4 plans, ~35 commits in 2 days.

**Codebase:** Bun monorepo (`apps/server`, `apps/cli`, ~15 `packages/`). Provider abstraction layer in `packages/providers/src/providers/` — each provider extends `BaseProvider` with `buildRequest()`, `parseRateLimit()`, `getUsage()`. OpenRouter lives at `packages/providers/src/providers/openrouter/`.

**Branch strategy:** `thamw-main` is the personal working branch. `main` tracks upstream. Upstream is added as a remote (`upstream`). Merges flow: `upstream/main` → `main` → `thamw-main`.

**Fork patches on `thamw-main` (v1.0 state):**
- `// FORK PATCH:` comment + `cache_write_tokens` extraction from `prompt_tokens_details` (`openai/provider.ts` line ~262)
- OpenRouter `cache_control` ephemeral per-block injection at 3 breakpoints (`openrouter/provider.ts`)
- 10-test regression suite (`openrouter/__tests__/provider.test.ts`)
- Pre/post merge scripts + SOP (`.planning/scripts/`, `.planning/fork_plans/UPSTREAM_MERGE.md`)

**Testing constraint:** Never test via the `claude` account or direct Anthropic endpoints. Use non-Anthropic accounts (ollama, litellm, openrouter with `z-ai/glm-4.5-air:free`) and force-route with `x-better-ccflare-account-id`.

**Known tech debt (v1.0):**
- Live non-Anthropic model request test deferred — manual verification needed: send `z-ai/glm-4.5-air:free` via proxy to OpenRouter account and confirm 2xx with no 400 errors
- Pre-existing 27 Biome lint errors in dashboard React components (unrelated to fork patches)

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
*Last updated: 2026-05-20 — Phase 5 complete (DELETE /api/accounts/:id/openrouter-provider-preference endpoint, PROV-03 satisfied, 11-case TDD suite)*
