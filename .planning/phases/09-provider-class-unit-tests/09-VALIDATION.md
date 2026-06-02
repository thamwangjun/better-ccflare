---
phase: 9
slug: provider-class-unit-tests
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-02
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `09-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (Bun built-in, no config file) |
| **Config file** | none — `bun:test` discovers `*.test.ts` automatically |
| **Quick run command** | `bun test packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` |
| **Full suite command** | `bun test packages/providers/` |
| **Estimated runtime** | ~2 seconds (mocked fetch, no network) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts`
- **After every plan wave:** Run `bun test packages/providers/`
- **Before `/gsd-verify-work`:** Full suite green + `bun run lint && bun run typecheck && bun run format`
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 9-buildUrl | TBD | — | PROV-01 | — | N/A | unit | `bun test .../provider.test.ts` | ❌ W0 | ⬜ pending |
| 9-cache-passthrough | TBD | — | PROV-02 / CACHE-01 | — | N/A | unit | `bun test .../provider.test.ts` | ❌ W0 | ⬜ pending |
| 9-provider-pref | TBD | — | ROUTE-01 | — | corrupt JSON → no throw, no injection | unit | `bun test .../provider.test.ts` | ❌ W0 | ⬜ pending |
| 9-session-id | TBD | — | ROUTE-02 | — | client-supplied not overridden | unit | `bun test .../provider.test.ts` | ❌ W0 | ⬜ pending |
| 9-cost-nonstream | TBD | — | COST-01 | — | string/null cost → undefined (typeof guard) | unit | `bun test .../provider.test.ts` | ❌ W0 | ⬜ pending |
| 9-cost-stream | TBD | — | COST-02 | — | absent/null/string cost → undefined, no estimate | unit | `bun test .../provider.test.ts` | ❌ W0 | ⬜ pending |
| 9-usage-include | TBD | — | PROV-03 (D-03) | — | not overridden when client sends `usage` | unit | `bun test .../provider.test.ts` | ❌ W0 | ⬜ pending |

*Task IDs are placeholders — bind to real plan/wave numbers after planning. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` — covers PROV-01/02/03, CACHE-01, ROUTE-01/02, COST-01/02
- [ ] `packages/providers/src/providers/openrouter-anthropic/provider.ts` — the provider class itself
- [ ] `packages/providers/src/providers/openrouter-anthropic/index.ts` — barrel export

*No existing test-infrastructure gaps — `bun:test` needs no config; discovery is file-name based.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live native-endpoint cost return | COST-02 | Requires real OpenRouter call (banned in CI; deferred to Phase 12 integration) | Phase 12 empirical probe — out of scope here |

*All Phase 9 behaviors have automated unit verification via mocked fetch. The single manual item is explicitly deferred to Phase 12.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
