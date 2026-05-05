---
phase: 3
slug: data-model
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-05
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none — built into Bun |
| **Quick run command** | `bun test packages/database packages/types --timeout 10000` |
| **Full suite command** | `bun test --timeout 30000` |
| **Estimated runtime** | ~15 seconds (quick), ~60 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/database packages/types --timeout 10000`
- **After every plan wave:** Run `bun test --timeout 30000`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | PROV-02 | — | Migration does not drop/modify existing account data | unit | `bun test packages/database --timeout 10000` | ✅ | ⬜ pending |
| 3-01-02 | 01 | 1 | PROV-02 | — | AccountRow/Account types carry new field | typecheck | `bun run typecheck` | ✅ | ⬜ pending |
| 3-01-03 | 01 | 1 | PROV-02 | — | SELECT returns new field; UPDATE persists and nulls correctly | unit | `bun test packages/database --timeout 10000` | ✅ | ⬜ pending |
| 3-01-04 | 01 | 1 | PROV-02 | — | AccountResponse parses JSON field correctly | unit | `bun test packages/types --timeout 10000` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/database/src/__tests__/account.repository.test.ts` — add test stubs for `openrouter_provider_preference` SELECT and UPDATE coverage
- [ ] `packages/types/src/__tests__/account.test.ts` — add test stubs for `toAccount()` and `toAccountResponse()` new field mapping

*Existing bun:test infrastructure covers the framework — Wave 0 only needs new test stubs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration is idempotent on live DB | PROV-02 | Requires running against actual DB file | `sqlite3 ~/.config/better-ccflare/better-ccflare.db "PRAGMA table_info(accounts);"` and verify `openrouter_provider_preference` column present with correct type |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
