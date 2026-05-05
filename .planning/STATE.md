---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: TBD
current_phase: none
status: milestone_complete
last_updated: "2026-05-05"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** better-ccflare (Personal Fork)
**v1.0 Shipped:** 2026-05-05
**Current Phase:** None — planning next milestone

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Correctness & Patch Hardening | ✅ Complete |
| 2 | Fork Maintenance Tooling | ✅ Complete |

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-05 after v1.0 milestone)

**Core value:** Stay current with upstream while running a stable personal instance enhanced with OpenRouter improvements and a clean patch workflow.
**Current focus:** Planning v1.1 — run `/gsd-new-milestone` to define scope

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-05-05:

| Category | Item | Status |
|----------|------|--------|
| tech_debt | SC-2 (CACHE-02): Live non-Anthropic model request test | Deferred — human verification required |
| tech_debt | REQUIREMENTS.md CACHE-02 wording mismatch | Deferred — cosmetic only |
| tech_debt | Phase 2 missing VERIFICATION.md | Deferred — artifact gap only |

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases completed | 2 / 2 |
| Requirements delivered | 7 / 7 |
| Plans completed | 4 |

## Key Constraints

- Never test via `claude` account or direct Anthropic endpoints — risk of account ban
- `inline-worker.ts` is auto-generated — never edit directly
- Version bumps are automated — never bump manually
- All changes must pass `bun run lint && bun run typecheck && bun run format`

## High-Risk Files (for upstream merges)

- `packages/providers/src/providers/openai/provider.ts` — contains `cache_write_tokens` FORK PATCH (~line 262), upstream actively refactors this file
- `packages/providers/src/providers/openrouter/provider.ts` — OpenRouter-specific overrides
- `packages/types/src/account.ts` — shared type file; structural changes here cause cascade conflicts

## Fork Patches on `thamw-main` (v1.0 state)

- `// FORK PATCH:` comment + `cache_write_tokens` extraction from `prompt_tokens_details` (`openai/provider.ts`)
- OpenRouter `cache_control` ephemeral per-block injection at 3 breakpoints (`openrouter/provider.ts`)
- 10-test regression suite (`openrouter/__tests__/provider.test.ts`)
- Pre/post merge scripts + SOP (`.planning/scripts/`, `.planning/fork_plans/UPSTREAM_MERGE.md`)

## Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260505-001 | Fix SOP issues from v1.0 audit | 2026-05-05 | 134f689 | [260505-001-fix-sop-issues](./quick/260505-001-fix-sop-issues/) |

## Session Continuity

**v1.0 archived.** To start v1.1: run `/gsd-new-milestone` for questioning → research → requirements → roadmap.
