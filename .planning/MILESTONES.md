# Milestones — better-ccflare (Personal Fork)

## v1.0 — Correctness & Maintenance

**Shipped:** 2026-05-05
**Phases:** 2 (Phase 1: Correctness & Patch Hardening, Phase 2: Fork Maintenance Tooling)
**Plans:** 4 | **Commits:** ~35 | **Timeline:** 2 days (2026-05-04 → 2026-05-05)

### Delivered

Stabilized the fork's OpenRouter provider correctness and established a repeatable upstream merge workflow. Operators no longer see silently understated cache billing, cache injection now targets the correct per-block locations, and all fork patches are annotated and test-guarded for upstream survivability. Merge tooling and a 6-step agent SOP make future upstream syncs safe and auditable.

### Key Accomplishments

1. Fixed OpenRouterProvider `extractUsageInfo` to read `prompt_tokens_details.cache_write_tokens` — operator billing no longer understated by 5x (CACHE-01)
2. Replaced broken top-level `cache_control` injection with per-block injection at 3 Anthropic breakpoints (CACHE-02)
3. Added `// FORK PATCH:` comment to `cacheCreationInputTokens` in `openai/provider.ts` for upstream merge safety (PATCH-01)
4. 10-test regression suite — fails if any OpenRouter cache patch is removed (PATCH-02)
5. `pre-merge-check.sh` + `post-merge-export.sh` with `bun run` aliases for full upstream merge workflow (MAINT-01/02/03)
6. Agent-executable 6-step `UPSTREAM_MERGE.md` SOP with per-file conflict resolution notes for all 3 high-risk files

### Known Deferred Items

- SC-2 (CACHE-02): Live non-Anthropic model request test deferred — human verification required: send `z-ai/glm-4.5-air:free` via proxy and confirm 2xx
- REQUIREMENTS.md CACHE-02 wording mismatch with implementation (cosmetic)
- Phase 2 no VERIFICATION.md (VALIDATION.md + SUMMARY.md present; nyquist_compliant: true)

### Archive

- Roadmap: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- Requirements: [milestones/v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md)
- Audit: [milestones/v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md)
