---
phase: 01
slug: correctness-patch-hardening
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-04
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for Phase 01: correctness-patch-hardening.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test (built-in) |
| **Config file** | none — uses `bun test` directly |
| **Quick run command** | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` |
| **Full suite command** | `bun test packages/providers/` |
| **Estimated runtime** | ~20ms (quick), ~2s (full) |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | CACHE-01 | T-01-02 | extractUsageInfo returns null on malformed response (try/catch) | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ✅ | ✅ green |
| 01-01-02 | 01 | 1 | CACHE-02 | T-01-01 | per-block injection only — no top-level cache_control leaks | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ✅ | ✅ green |
| 01-02-01 | 02 | 1 | PATCH-01 | T-02-01 | comment-only change — no runtime behavior | manual | see Manual-Only table | — | ✅ verified |
| 01-03-01 | 03 | 2 | PATCH-02 | — | removing extractUsageInfo override breaks regression guard | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No Wave 0 setup needed — `bun:test` is built into the runtime and requires no install step. Test file existed prior to this phase and was expanded during TDD execution.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `// FORK PATCH: cache_write_tokens from prompt_tokens_details (OpenRouter)` comment present in `openai/provider.ts` immediately above `const cacheCreationInputTokens =` | PATCH-01 | Comment is a merge-safety convention marker, not functional behavior. Adding a grep test was declined — acceptable since the comment is visible in git diff and surfaced during any upstream merge review. | `grep -A1 "FORK PATCH" packages/providers/src/providers/openai/provider.ts` — should show the comment followed by `const cacheCreationInputTokens =` |

---

## Validation Audit 2026-05-04

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved (automated) | 0 |
| Escalated to manual-only | 1 |

### Coverage Summary

| Requirement | Tests | Result |
|-------------|-------|--------|
| CACHE-01 — extractUsageInfo reads OpenRouter prompt_tokens_details | 4 tests (reads cache_write_tokens, reads cached_tokens, returns null on no usage, returns prompt/completion tokens) | ✅ COVERED |
| CACHE-02 — 3-breakpoint per-block cache_control injection | 6 tests (tools breakpoint, string system conversion, array system last block, assistant string turn, no top-level key, field preservation) | ✅ COVERED |
| PATCH-01 — FORK PATCH comment in openai/provider.ts | manual grep check | ✅ COVERED (manual) |
| PATCH-02 — extractUsageInfo regression guard | 1 test (cacheCreationInputTokens===50 from cache_write_tokens) | ✅ COVERED |

10/10 automated tests passing. 1/1 manual check verified.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or manual-only justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0: not required — existing infrastructure sufficient
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-04
