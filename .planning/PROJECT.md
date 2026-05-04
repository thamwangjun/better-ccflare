# better-ccflare (Personal Fork)

## What This Is

A maintained personal fork of [better-ccflare](https://github.com/tombii/better-ccflare) — a Bun-based Claude API load balancer proxy that distributes requests across multiple account providers to avoid rate limiting. This fork continuously pulls upstream releases and layers personal improvements: provider enhancements, bug fixes that haven't landed upstream, and infra customizations.

## Core Value

Stay current with upstream while running a stable personal instance enhanced with features I need — primarily around OpenRouter caching, provider selection, and a clean patch workflow.

## Requirements

### Validated

- ✓ OpenRouter cache_write_tokens extraction from `prompt_tokens_details` — on branch
- ✓ OpenRouter `cache_control` ephemeral injection into requests — on branch
- ✓ Biome formatter applied to test files — on branch

### Active

- [ ] Improved caching for the OpenRouter provider (deeper cache hit optimization beyond basic injection)
- [ ] Per-request OpenRouter provider selection (ability to pin requests to a specific upstream provider on OpenRouter, e.g. force `openai` or `anthropic` as the backend)
- [ ] Documented, repeatable upstream merge process (merge → resolve conflicts → reapply patches safely)

### Out of Scope

- Maintaining the upstream project — that's tombii's responsibility; we contribute back selectively
- Auto-publishing to npm/GitHub Container Registry — upstream's release system handles this; never bump versions manually
- Rebuilding or replacing core proxy logic — extend the existing provider abstraction, don't rewrite it

## Context

**Codebase:** Bun monorepo (`apps/server`, `apps/cli`, ~15 `packages/`). Provider abstraction layer in `packages/providers/src/providers/` — each provider extends `BaseProvider` with `buildRequest()`, `parseRateLimit()`, `getUsage()`. OpenRouter lives at `packages/providers/src/providers/openrouter/`.

**Branch strategy:** `thamw-main` is the personal working branch. `main` tracks upstream. Upstream is added as a remote (`upstream`). Merges flow: `upstream/main` → `main` → `thamw-main`.

**Existing patches:** All three validated requirements are already merged onto `thamw-main`. They touch the OpenRouter provider and test files — low conflict surface with upstream.

**OpenRouter specifics:** OpenRouter's API supports a `provider` parameter in requests to pin the backend provider. It also has non-standard streaming behavior for tool calls (incremental argument chunks vs. cumulative). Any OpenRouter work must account for this.

**Testing constraint:** Never test via the `claude` account or direct Anthropic endpoints. Use non-Anthropic accounts (ollama, litellm, openrouter with `z-ai/glm-4.5-air:free`) and force-route with `x-better-ccflare-account-id`.

## Constraints

- **Safety**: Never curl Anthropic endpoint in tests — risk of account ban
- **Generated file**: `inline-worker.ts` is auto-generated — never edit directly
- **Versioning**: Version bumps are automated — never bump manually
- **Compatibility**: Patches must apply cleanly after upstream merges; avoid structural changes to shared packages
- **Stack**: Bun runtime, TypeScript, biome for lint/format — must pass `bun run lint && bun run typecheck && bun run format` after every change

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork upstream rather than contribute all changes back | Some changes (infra, personal config) aren't appropriate for upstream; faster iteration | — Pending |
| Target OpenRouter as primary enhancement surface | Most flexible provider — supports provider selection, has non-standard behavior worth improving | — Pending |
| Keep patches minimal and localized | Easier to reapply after upstream merges; smaller conflict surface | ✓ Good |

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
*Last updated: 2026-05-04 after initialization*
