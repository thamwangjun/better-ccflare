---
phase: 7
slug: openrouter-response-cost-extraction
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 7-01-01 | 01 | 1 | COST-01 | T-7-01 | typeof guard on `usage.cost` before assignment | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ❌ W0 | ⬜ pending |
| 7-01-02 | 01 | 1 | COST-02 | T-7-02 | typeof guard on `parsed.usage.cost` in SSE path | unit | `bun test packages/proxy/src/__tests__/sse-parsing.test.ts` | ❌ W0 | ⬜ pending |
| 7-01-03 | 01 | 1 | COST-03 | T-7-03 | typeof guard on `usageObj.cost` in JSON path | unit | New test file for extractUsageFromJson | ❌ W0 | ⬜ pending |
| 7-01-04 | 01 | 1 | COST-04 | — | Non-OpenRouter providers unaffected | integration | Manual test with non-OR account | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — Add COST-01 test cases: cost extraction, null cost, absent cost field
- [ ] `packages/proxy/src/__tests__/sse-parsing.test.ts` — Add COST-02 test cases: message_delta cost parsing
- [ ] `packages/proxy/src/__tests__/extract-usage-from-json.test.ts` — New file for COST-03: extractUsageFromJson with cost field
- [ ] Framework install: none needed — `bun:test` is built-in
