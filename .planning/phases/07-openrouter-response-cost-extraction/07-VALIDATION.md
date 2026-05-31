---
phase: 7
slug: openrouter-response-cost-extraction
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-31
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (built-in Bun test runner) |
| **Config file** | none — `bun:test` uses test file conventions |
| **Quick run command** | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts packages/proxy/src/__tests__/sse-parsing.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** `bun test packages/providers/src/providers/openrouter/__tests__/` + `bun test packages/proxy/src/__tests__/sse-parsing.test.ts`
- **After every plan wave:** `bun run lint && bun run typecheck && bun run format`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | COST-01 | T-7-01 | typeof guard on `json.usage.cost` before assignment | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ✅ | ✅ green |
| 7-02-01 | 02 | 1 | COST-02, COST-03 | T-7-02, T-7-03 | typeof guard on `parsed.usage.cost` in SSE + JSON body paths | unit | `bun test packages/proxy/src/__tests__/sse-parsing.test.ts packages/proxy/src/__tests__/extract-usage-from-json.test.ts` | ✅ | ✅ green |
| 7-02-02 | 02 | 1 | COST-02, COST-03 | T-7-04 | handleEnd() skips estimateCostUSD when providerCostUsd is set | unit | `bun test packages/proxy/src/__tests__/sse-parsing.test.ts packages/proxy/src/__tests__/extract-usage-from-json.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — COST-01 test cases: cost extraction, null cost, absent cost field, zero, string-type-confusion
- [x] `packages/proxy/src/__tests__/sse-parsing.test.ts` — COST-02 test cases: message_delta cost parsing (present/absent/null)
- [x] `packages/proxy/src/__tests__/extract-usage-from-json.test.ts` — COST-03: extractUsageFromJson with cost field + handleEnd gating
- [x] Framework install: none needed — `bun:test` is built-in

---

## Manual-Only / Quality Notes

- **COST-02 / COST-03 inline-copy test risk (non-blocking, WARNING):** The SSE (`sse-parsing.test.ts`) and JSON (`extract-usage-from-json.test.ts`) tests assert against INLINE COPIES of `extractUsageFromData` / `extractUsageFromJson`, not the production functions exported from `post-processor.worker.ts` (those functions are not exported). Future drift between the inline copy and the real worker would not be caught automatically. Production behavior was independently source-verified during `/gsd-verify-work` (worker `:314-317`, `:378-381`, `:678-687`). COST-01 has TRUE integration coverage (instantiates the real `OpenRouterProvider`).
- **COST-04 (cost_usd DB persistence):** Intentionally out of Phase 7 scope — deferred to Phase 8 per ROADMAP/PROJECT.

---

## Validation Audit 2026-05-31

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 3 Per-Task-Map requirements (COST-01, COST-02, COST-03) covered by passing automated tests — `bun test` across the 3 files: **44 pass / 0 fail**. No test generation required; the planning-time draft was reconciled to the executed state. Phase is Nyquist-compliant.
