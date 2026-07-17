---
phase: 11
slug: dashboard-wiring
status: validated
nyquist_compliant: true
wave_0_complete: true
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
| 11-W0-01 | 01 | 0 | MGMT-04 | — | N/A | render (SSR) | `bun test packages/dashboard-web/src/components/accounts/` | ✅ AccountListItem.test.tsx | ✅ green |
| 11-W0-02 | 01/02 | 0 | MGMT-03 | — | N/A | unit/render | `bun test packages/dashboard-web/src/components/accounts/` | ✅ AccountAddForm.test.tsx | ✅ green |
| 11-XX | — | 1+ | MGMT-03/04 | — | N/A | static | `bunx tsc --noEmit` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/dashboard-web/src/components/accounts/__tests__/AccountListItem.test.tsx` — SSR test asserting the provider-preference button renders for an `openrouter-anthropic` account and not for unrelated providers (MGMT-04). Uses `renderToStaticMarkup` per RateLimitProgress.test.tsx. **3/3 green.**
- [x] MGMT-03 form-render / submit-dispatch coverage — `AccountAddForm.test.tsx` SSR test asserting the `OpenRouter Anthropic Messages (API Key)` SelectItem label renders. Started RED in Plan 01, turned GREEN in Plan 02 after SelectItem + form block wired.
- [x] `bunx tsc --noEmit` enforced as union-completeness gate — exits 0 (excluding pre-existing auto-generated worker file errors).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live end-to-end account creation with a real `:free` request | — | Deferred to Phase 12 by CONTEXT.md; out of scope | N/A this phase |

*All in-scope Phase 11 behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-04

---

## Validation Audit 2026-06-04

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Audit re-ran the verification map against the executed codebase. Both Wave 0 tests exist and pass (`bun test packages/dashboard-web/src/components/accounts/` → 20 pass, 0 fail), the `tsc --noEmit` union-completeness gate exits 0, and both source gates are present (`AccountListItem.tsx` widened gate, `AccountAddForm.tsx` SelectItem label). All in-scope requirements (MGMT-03, MGMT-04) are COVERED. No new tests required.
