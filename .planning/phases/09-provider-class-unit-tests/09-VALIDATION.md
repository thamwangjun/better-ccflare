---
phase: 9
slug: provider-class-unit-tests
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-02
validated: 2026-06-03
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
| 9-buildUrl | 09-01 | 1 | PROV-01 | — | N/A | unit | `bun test .../provider.test.ts` | ✅ | ✅ green |
| 9-cache-passthrough | 09-01 | 1 | PROV-02 / CACHE-01 | — | N/A | unit | `bun test .../provider.test.ts` | ✅ | ✅ green |
| 9-provider-pref | 09-01 | 1 | ROUTE-01 | T-9-02 | corrupt JSON → no throw, no injection | unit | `bun test .../provider.test.ts` | ✅ | ✅ green |
| 9-session-id | 09-01 | 1 | ROUTE-02 | T-9-03 | client-supplied not overridden; SHA-256 one-way | unit | `bun test .../provider.test.ts` | ✅ | ✅ green |
| 9-cost-nonstream | 09-01 | 1 | COST-01 | T-9-01 | string/null cost → undefined (typeof guard) | unit | `bun test .../provider.test.ts` | ✅ | ✅ green |
| 9-cost-stream | 09-01 | 1 | COST-02 | T-9-01 | absent/null/string cost → undefined, no estimate | unit | `bun test .../provider.test.ts` | ✅ | ✅ green |
| 9-usage-include | 09-01 | 1 | PROV-03 (D-03) | — | not overridden when client sends `usage` | unit | `bun test .../provider.test.ts` | ✅ | ✅ green |

*Bound to Plan 09-01, Wave 1 (Tasks 1–2). All requirements proven by the 34-test `provider.test.ts` suite. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` — covers PROV-01/02/03, CACHE-01, ROUTE-01/02, COST-01/02 (34 tests green)
- [x] `packages/providers/src/providers/openrouter-anthropic/provider.ts` — the provider class itself
- [x] `packages/providers/src/providers/openrouter-anthropic/index.ts` — barrel export

*No existing test-infrastructure gaps — `bun:test` needs no config; discovery is file-name based.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live native-endpoint cost return | COST-02 | Requires real OpenRouter call (banned in CI; deferred to Phase 12 integration) | Phase 12 empirical probe — out of scope here |

*All Phase 9 behaviors have automated unit verification via mocked fetch. The single manual item is explicitly deferred to Phase 12.*

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-03 — all 7 requirement rows green, 0 gaps

## Validation Audit 2026-06-03

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Audit method: cross-referenced all 8 phase requirements (PROV-01/02/03, CACHE-01, ROUTE-01/02, COST-01/02) and D-03 against the 34-test `provider.test.ts` suite. Ran `bun test packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` → 34 pass / 0 fail. Ran `bun test packages/providers/` → 492 pass / 0 fail (PROV-03 coexistence confirmed, no sibling regression). All three LOW threats (T-9-01 type confusion, T-9-02 corrupt-JSON, T-9-03 session_id one-way hash) have dedicated negative-path tests. No new test files needed — phase was already Nyquist-compliant on execution.
