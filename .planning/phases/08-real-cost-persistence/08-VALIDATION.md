---
phase: 8
slug: real-cost-persistence
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-31
audited: 2026-06-01
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (built-in) |
| **Config file** | none — `bun test` discovers `*.test.ts` |
| **Quick run command** | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts packages/proxy/src/__tests__/sse-parsing.test.ts packages/proxy/src/__tests__/extract-usage-from-json.test.ts` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~30 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run quick run command (provider + worker SSE/JSON tests)
- **After every plan wave:** Run `bun test packages/providers packages/proxy packages/database`
- **Before `/gsd-verify-work`:** `bun test` full suite green + `bun run lint && bun run typecheck && bun run format`
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. Each task implementing a behavior below MUST carry the matching automated command. Rows are behavior-anchored; the planner maps them to concrete task IDs.

| Behavior | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Streaming OpenRouter real `usage.cost` extracted via `extractStreamingUsage` override (clone body before `super`, `typeof === "number"` guard) | 1 | COST-04 | T-7-01 | Non-numeric/string `usage.cost` rejected; `costUsd` left undefined | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts -t "extractStreamingUsage"` | ✅ provider.test.ts:257 | ✅ green |
| Real provider `$0` (`:free` model) persists as `0`, not `null` (`?? null` in writers) | 1 | COST-04 | — | N/A | unit | `bun test packages/database/src/repositories/__tests__/request-cost-zero.test.ts` | ✅ request-cost-zero.test.ts | ✅ green |
| Estimate-$0 for UNKNOWN model does NOT persist as `0` (upstream `0 → undefined` guard in worker estimate branch) | 1 | COST-04 | — | N/A | unit | `bun test packages/proxy/src/__tests__/sse-parsing.test.ts packages/proxy/src/__tests__/extract-usage-from-json.test.ts` | ✅ sse-parsing.test.ts:196 | ✅ green |
| Non-OpenRouter provider unchanged — still estimates, carries no real cost (regression guard) | 1 | COST-04 | — | N/A | unit | `bun test packages/proxy/src/__tests__/sse-parsing.test.ts -t "non-OpenRouter"` | ✅ sse-parsing.test.ts:214 | ✅ green |
| `usage.cost` typeof guard rejects string/non-numeric in streaming path | 1 | COST-04 | T-7-01 | Type-confusion input does not corrupt numeric cost field | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ✅ provider.test.ts (string case) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] DB-writer-level test asserting `?? null` persists real `$0` — landed at `packages/database/src/repositories/__tests__/request-cost-zero.test.ts` (real `RequestRepository`, genuine RED signal at commit `7111bc97`)
- [x] `extractStreamingUsage` override fixture — SSE byte stream (`makeStreamingResponse`) covering numeric, `0`, `null`/absent, and string cases at `provider.test.ts:227+`
- [x] Explicit non-OpenRouter regression assertion — `sse-parsing.test.ts:214` (estimate branch runs, no real cost); estimate-$0 unknown model → undefined at `sse-parsing.test.ts:196`
- No framework install needed (`bun:test` is built in)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real extracted cost appears in logs for a live streaming OpenRouter request | COST-04 | D-05: confirms end-to-end extraction without a unit harness; SSE shape was ASSUMED (A1), not live-verified | Force-route a **free** model (`z-ai/glm-4.5-air:free`) via `x-better-ccflare-account-id` to an OpenRouter account; inspect logs for the extracted `usage.cost`. NEVER a paid model, NEVER the Anthropic endpoint, NEVER the `claude` account. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (writer $0 test, streaming SSE fixture, non-OpenRouter regression assertion)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-01 (audit)

---

## Validation Audit 2026-06-01

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 5 behavior rows COVERED by green tests (60 pass / 0 fail across the 4 target suites). All three Wave 0 gaps were filled during execution (plans 08-01, 08-02). The single live-streaming log check remains Manual-Only by design (D-05). No auditor spawn required.

**Caveat:** behaviors 3 & 4 (worker estimate-$0 guard, non-OpenRouter regression) are verified via inline `handleEnd()` simulations mirroring `post-processor.worker.ts` rather than importing the real worker — consistent with the existing simulation pattern in those suites. The real-RED signal for the writer `?? null` change came from `request-cost-zero.test.ts` importing the actual `RequestRepository`.
