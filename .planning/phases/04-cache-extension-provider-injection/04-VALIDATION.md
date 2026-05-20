---
phase: 04
slug: cache-extension-provider-injection
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
audited: 2026-05-20
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (built-in Bun test runner) |
| **Config file** | None — bun discovers test files automatically |
| **Quick run command** | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` |
| **Full suite command** | `bun test && bun run lint && bunx tsc --noEmit && bun run format` |
| **Estimated runtime** | ~5 seconds (provider tests); ~30 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts && bunx tsc --noEmit`
- **After every plan wave:** `bun test && bun run lint && bunx tsc --noEmit && bun run format`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds (quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | PROV-01 | T-04-01-01 | PG migration idempotent (ADD COLUMN IF NOT EXISTS semantics) | grep | `grep -n "openrouter_provider_preference" packages/database/src/migrations-pg.ts` | ✅ | ✅ green |
| 04-01-02 | 01 | 1 | PROV-01 | T-04-01-03 | JSON.parse wrapped in try/catch; corrupt data returns null (fail-open) | type-check + unit | `bunx tsc --noEmit 2>&1 \| grep -v "inline-worker\|tiktoken\|embedded"; bun test packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts packages/types/src/__tests__/account-mappers.test.ts --timeout 10000` | ✅ | ✅ green |
| 04-02 | 02 | 2 | CACHE-03, CACHE-04, CACHE-05, PROV-01 | T-04-02-02 | Existing 10 tests untouched; 9 new tests RED; 1 CACHE-04 scope test GREEN | unit (RED gate) | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ✅ | ✅ green |
| 04-03 | 03 | 3 | CACHE-03, CACHE-04, CACHE-05, PROV-01 | T-04-03-01, T-04-03-02, T-04-03-03, T-04-03-04, T-04-03-05 | Client-supplied `provider` field wins; allow_fallbacks uses `?? true` (not `\|\| true`); no TTL in transform | unit (GREEN gate) | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ✅ | ✅ green |
| 04-03-ttl | 03 | 3 | CACHE-04 | T-04-03-04 | injectSystemCacheTtl() does not touch tool blocks | unit | `bun test packages/proxy/src/__tests__/inject-system-cache-ttl.test.ts` | ✅ | ✅ green |
| 04-03-lint | 03 | 3 | CACHE-05 | — | No new lint errors beyond pre-existing dashboard errors | lint | `bun run lint` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files, frameworks, or fixtures need to be installed:

- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — exists with 10 passing tests (Phase 3 baseline); Plan 02 extends it
- `packages/proxy/src/__tests__/inject-system-cache-ttl.test.ts` — exists; covers CACHE-04 TTL scope
- `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts` — exists (Phase 3); covers PROV-01 DB layer
- `packages/types/src/__tests__/account-mappers.test.ts` — exists (Phase 3); covers type chain

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## CACHE-04 Scope Clarification

CACHE-04 ("TTL split") is verified by two complementary automated tests:

1. **System block gets `ttl: "1h"`** — covered by the existing `inject-system-cache-ttl.test.ts` suite
2. **Tool block keeps `{ type: "ephemeral" }` with NO ttl** — covered by the new CACHE-04 scope test added in Plan 02 to `provider.test.ts`

`injectSystemCacheTtl()` in `proxy.ts` exclusively operates on `body.system` blocks (guarded by `if (!Array.isArray(body.system)) return null` at line 564). Tools blocks are never touched by that function. This is confirmed behavior, not an assumption.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — existing infra sufficient)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (quick run < 5s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-05-20

---

## Validation Audit 2026-05-20

| Metric | Count |
|--------|-------|
| Tasks audited | 6 |
| Gaps found | 1 |
| Resolved | 1 |
| Escalated | 0 |

**Gap resolved:** `04-03-ttl` — `inject-system-cache-ttl.test.ts` failed due to missing `inline-integrity-check-worker.ts` (auto-generated, not produced by plain `bun test` without a prior build). Running `cd apps/cli && bun run build` generates all inline workers; test passes 11/11 afterward. Pre-existing infra gap, not introduced by phase 4. Recommend running `bun run build:cli` before any full test suite run on a fresh checkout.
