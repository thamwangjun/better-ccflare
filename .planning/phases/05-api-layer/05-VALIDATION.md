---
phase: 5
slug: api-layer
status: compliant
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
audited: 2026-05-21
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (built-in) |
| **Config file** | none — built-in runner |
| **Quick run command** | `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` |
| **Full suite command** | `bun run typecheck && bun test packages/http-api/` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts`
- **After every plan wave:** Run `bun run typecheck && bun test packages/http-api/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | PROV-03 | — | Failing tests define PUT/DELETE contract; no prod code runs | tdd-red | `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts 2>&1 \| grep -E "pass\|fail\|error"` | ✅ | ✅ green |
| 05-02-01 | 02 | 2 | PROV-03 | — | DELETE handler sets preference to null; PUT already persists preference | tdd-green | `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` | ✅ | ✅ green |
| 05-02-02 | 02 | 2 | PROV-03 | — | Route dispatch returns 404 for unknown account; DELETE dispatched before generic account-removal block | integration | `bun test packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/http-api/src/handlers/__tests__/openrouter-provider-preference.test.ts` — stubs for PROV-03 (all tests failing = RED gate)
- [x] Test DB path: `/tmp/test-openrouter-provider-preference.db` — created by `DatabaseFactory.initialize()` in `beforeAll`

---

## Validation Architecture

### Dimensions

| Dim | Name | Gate | Verification Method |
|-----|------|------|---------------------|
| 1 | Functional correctness | Wave 1 (RED) | All 5 required test cases in D-08 exist and fail only because handler/endpoint missing |
| 2 | Handler implementation | Wave 2 (GREEN) | All tests pass: PUT sets, DELETE clears, 400/404 guards work |
| 3 | Route dispatch | Wave 2 (GREEN) | DELETE route registered before generic account-removal block |
| 4 | Type safety | Wave 2 (GREEN) | `bun run typecheck` exits 0 |
| 5 | Fork patch annotations | Wave 2 (GREEN) | PUT handler function and DELETE handler function both carry `// FORK PATCH:` on definition line |
| 6 | Lint/format | Wave 2 (GREEN) | `bun run lint && bun run format` exits 0 |
| 7 | DB null handling | Wave 2 (GREEN) | `setAccountOpenrouterProviderPreference(id, null)` sets column to NULL (verified by `readPreference()` returning null) |
| 8 | Nyquist sampling | Each task | Quick run after every task commit; full suite after each wave |

---

## Validation Audit 2026-05-21

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Tests passing | 12/12 (T-01–T-11 + T-12 bonus) |
| Stale statuses updated | 3 |

**Notes:** VALIDATION.md was created pre-execution with all statuses `⬜ pending`. Audit confirmed all 3 task requirements COVERED by live test run (12 pass, 0 fail). T-12 is bonus coverage (idempotent DELETE on account with no prior preference). All 8 validation dimensions verified: typecheck clean, lint 218 pre-existing warnings only, 3× FORK PATCH annotations confirmed.
