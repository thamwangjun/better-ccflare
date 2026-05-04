---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 01
status: ready_to_plan
last_updated: "2026-05-04T09:56:30.771Z"
progress:
  total_phases: 2
  completed_phases: 2
  total_plans: 3
  completed_plans: 0
  percent: 100
---

# Project State

**Project:** better-ccflare (Personal Fork)
**Started:** 2026-05-04
**Current Phase:** 2

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Correctness & Patch Hardening | Pending |
| 2 | Fork Maintenance Tooling | Pending |

## Current Position

Phase: 01 (correctness-patch-hardening) — EXECUTING
Plan: Not started
**Active phase:** None — project initialized, ready for Phase 1
**Active plan:** None
**Last action:** Roadmap created (2026-05-04)

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-04)

**Core value:** Stay current with upstream while running a stable personal instance enhanced with OpenRouter improvements and a clean patch workflow.
**Current focus:** Phase 01 — correctness-patch-hardening

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases completed | 0 / 2 |
| Requirements delivered | 0 / 7 |
| Plans completed | 0 |

## Accumulated Context

### Key constraints active

- Never test via `claude` account or direct Anthropic endpoints — risk of account ban
- `inline-worker.ts` is auto-generated — never edit directly
- Version bumps are automated — never bump manually
- All changes must pass `bun run lint && bun run typecheck && bun run format`

### High-risk files (require pre-merge inspection)

- `packages/providers/src/providers/openai/provider.ts` — contains `cache_write_tokens` FORK PATCH, upstream actively refactors this file
- `packages/providers/src/providers/openrouter/provider.ts` — OpenRouter-specific overrides
- `packages/types/src/account.ts` — shared type file; structural changes here cause cascade conflicts

### Fork patches currently on `thamw-main`

- `cache_write_tokens` extraction from `prompt_tokens_details` (openai/provider.ts)
- OpenRouter `cache_control` ephemeral injection (openrouter/provider.ts)
- Biome formatter applied to test files

## Session Continuity

**To resume:** Run `/gsd-plan-phase 1` to create an executable plan for Phase 1.

**Phase 1 entry conditions:** None — can start immediately.

**Phase 2 entry conditions:** Phase 1 complete and stable (correctness fixes validated before adding merge process complexity).
