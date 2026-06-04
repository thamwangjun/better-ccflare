---
phase: 11
slug: dashboard-wiring
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` |
| **Config file** | none — uses `bun test` default discovery |
| **Quick run command** | `bun test packages/dashboard-web/src/components/accounts/` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~10 seconds (scoped); full suite varies |

Two established dashboard test styles (both `bun:test`):
- **Pure-function unit test** — `AccountOpenrouterProviderPreferenceDialog.test.ts` imports exported helpers and asserts on them. No DOM.
- **SSR markup assertion** — `RateLimitProgress.test.tsx` uses `renderToStaticMarkup` from `react-dom/server` and asserts on the HTML string. Harness for testing rendered component branches (e.g., the widened gate).

---

## Sampling Rate

- **After every task commit:** Run `bunx tsc --noEmit && bun test packages/dashboard-web/`
- **After every plan wave:** Run `bun run lint && bun run typecheck && bun test`
- **Before `/gsd-verify-work`:** Full suite must be green + `bun run lint && bun run typecheck && bun run format`
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-W0-01 | 01 | 0 | MGMT-04 | — | N/A | render (SSR) | `bun test packages/dashboard-web/src/components/accounts/` | ❌ W0 | ⬜ pending |
| 11-W0-02 | 01 | 0 | MGMT-03 | — | N/A | unit/render | `bun test packages/dashboard-web/` | ❌ W0 | ⬜ pending |
| 11-XX | — | 1+ | MGMT-03/04 | — | N/A | static | `bunx tsc --noEmit` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/dashboard-web/src/components/accounts/__tests__/AccountListItem.test.tsx` — SSR test asserting the provider-preference button renders for an `openrouter-anthropic` account and not for unrelated providers (MGMT-04). Use `renderToStaticMarkup` per RateLimitProgress.test.tsx.
- [ ] MGMT-03 form-render / submit-dispatch coverage — either an SSR test on `AccountAddForm` for the new SelectItem/block, or refactor the submit dispatch into an exported pure helper to unit-test mode→handler routing (mirror the dialog test's helper-extraction approach).
- [ ] `bunx tsc --noEmit` enforced as a required union-completeness gate (cheapest check for missed `"openrouter-anthropic"` sites).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live end-to-end account creation with a real `:free` request | — | Deferred to Phase 12 by CONTEXT.md; out of scope | N/A this phase |

*All in-scope Phase 11 behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
