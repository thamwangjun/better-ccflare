---
phase: 6
slug: dashboard-ui-maintenance-hardening
status: audited
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
audited: 2026-05-21
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (built-in) |
| **Config file** | None — `bun test` discovers `*.test.ts` / `*.test.tsx` automatically |
| **Quick run command** | `bun test packages/dashboard-web/src/components/accounts/` |
| **Full suite command** | `bun test` (from repo root) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run typecheck && bun run lint`
- **After every plan wave:** Run `bun test packages/dashboard-web/src/`
- **Before `/gsd-verify-work`:** Full suite must be green (`bun test`)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | PROV-04 | — | Comma-separated input parsed and validated client-side | unit | `bun test packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.ts` | ✅ | ✅ green |
| 06-01-02 | 01 | 1 | PROV-04 | — | Empty order → DELETE called; non-empty → PUT called | unit | Same test file (`resolveProviderPreferenceSaveAction`) | ✅ | ✅ green |
| 06-01-03 | 01 | 1 | PROV-04 | — | Dialog only renders for provider=openrouter accounts | manual | SC-1 UAT (SC-1 PASSED 2026-05-21) | N/A — jsdom not in repo | ✅ manual |
| 06-01-04 | 01 | 1 | MAINT-04 | — | HIGH_RISK_FILES includes both new paths | smoke | `grep "migrations.ts\|accounts.ts" .planning/scripts/pre-merge-check.sh` | N/A | ✅ green |
| 06-01-05 | 01 | 1 | MAINT-05 | — | All fork-specific v1.1 code blocks have FORK PATCH comment | smoke | `grep -rn "// FORK PATCH" packages/ --include="*.ts" --include="*.tsx" \| wc -l` (returned 32) | N/A | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.ts` — 12 tests for PROV-04 parse/branch/sync logic (commit 3aa6eda7)
- [x] No framework install needed — `bun:test` is built-in

*All Wave 0 requirements completed. 12 tests GREEN (commit 91349261 turned RED gate GREEN).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Provider Preferences dialog renders in browser with correct initial state | PROV-04 | DOM rendering requires browser; no jsdom setup exists in repo | Start server, open dashboard, click dropdown on OpenRouter account, verify dialog opens with pre-populated fields |
| Non-OpenRouter accounts have no "Provider Preferences" menu item | PROV-04 | Requires live UI | Verify dropdown menu on a non-OpenRouter account has no such item |

---

## Validation Sign-Off

- [x] All tasks have automated verify or manual-only with documented rationale
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (test file created in plan 01, turned GREEN in plan 02)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (bun test runs in ~92ms)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-05-21 — 4 automated (12 unit + 2 smoke), 1 manual-only (SC-1 UAT PASSED)

---

## Validation Audit 2026-05-21

| Metric | Count |
|--------|-------|
| Tasks audited | 5 |
| COVERED (automated) | 4 |
| MANUAL (UAT verified) | 1 |
| Gaps found | 0 |
| Tests generated | 0 (pre-existing from plans 01–02) |
| Escalated | 0 |

All automated commands executed and verified green. Phase is Nyquist-compliant.
