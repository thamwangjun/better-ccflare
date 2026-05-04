# Requirements: better-ccflare (Personal Fork)

**Defined:** 2026-05-04
**Core Value:** Stay current with upstream while running a stable personal instance enhanced with OpenRouter improvements and a clean patch workflow.

## v1 Requirements

### OpenRouter Caching

- [ ] **CACHE-01**: Non-streaming OpenRouter responses report accurate cache token counts (reads `usage.prompt_tokens_details` instead of Anthropic-native field names that don't exist in OpenRouter responses)
- [ ] **CACHE-02**: `cache_control` ephemeral injection is gated on `anthropic/*` model prefix and applied per-block on the last system message content item (not top-level, which silently fails for Bedrock/Vertex routes)

### Fork Patch Hardening

- [ ] **PATCH-01**: The `cache_write_tokens` extraction patch in `packages/providers/src/providers/openai/provider.ts` is tagged with a `// FORK PATCH:` comment so upstream reviewers don't remove it as dead code during merges
- [ ] **PATCH-02**: A unit test covers the OpenRouter non-streaming cache token extraction path and fails if the patch is removed or regresses

### Fork Maintenance

- [ ] **MAINT-01**: A pre-merge check script (`.planning/scripts/pre-merge-check.sh`) runs targeted `git diff`/`git log` commands on the highest-risk files before each upstream integration
- [ ] **MAINT-02**: Upstream merge commits are tagged (`merged-upstream-YYYYMMDD`) for programmatic queryability
- [ ] **MAINT-03**: Post-merge patch export runs after each upstream integration, writing current fork patches to `.planning/patches/` as recovery insurance

## v2 Requirements

### OpenRouter Provider Selection (Next Milestone)

- **PROV-01**: Requests can specify an OpenRouter provider preference via `x-better-ccflare-openrouter-provider` header, injecting `provider.order` into the upstream request
- **PROV-02**: Per-account OpenRouter provider preference configurable via ENV var (before UI implementation)
- **PROV-03**: Dashboard UI for configuring per-account OpenRouter provider preference
- **PROV-04**: Provider pinning uses `provider.order` with `allow_fallbacks: true` (never `provider.only`, which eliminates fallback)

### Extended Caching

- **CACHE-03**: Cache breakpoints placed on both system message and high-token user message (up to 4-breakpoint limit) for more granular cache efficiency
- **CACHE-04**: `ttl: "1h"` on cache content blocks for agentic sessions exceeding the 5-minute sticky routing window

## Out of Scope

| Feature | Reason |
|---------|--------|
| Maintaining the upstream project | That's tombii's responsibility; contribute back selectively |
| Auto-publishing to npm/GHCR | Upstream's release system handles this; never bump versions manually |
| Replacing core proxy logic | Extend the provider abstraction, don't rewrite it |
| Non-Anthropic model usage extraction | OpenRouter-routed GPT/Gemini models via OpenAI-format SSE will report 0 usage; deferred until actively needed |
| provider.only support | Eliminates all fallback — too risky; always use provider.order |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CACHE-01 | Phase 1 | Pending |
| CACHE-02 | Phase 1 | Pending |
| PATCH-01 | Phase 1 | Pending |
| PATCH-02 | Phase 1 | Pending |
| MAINT-01 | Phase 2 | Pending |
| MAINT-02 | Phase 2 | Pending |
| MAINT-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-04*
*Last updated: 2026-05-04 after roadmap creation — traceability validated against ROADMAP.md*
