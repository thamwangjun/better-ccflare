---
phase: 8
slug: real-cost-persistence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-31
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
| Streaming OpenRouter real `usage.cost` extracted via `extractStreamingUsage` override (clone body before `super`, `typeof === "number"` guard) | 1 | COST-04 | T-7-01 | Non-numeric/string `usage.cost` rejected; `costUsd` left undefined | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts -t "extractStreamingUsage"` | ✅ extend COST-01 suite | ⬜ pending |
| Real provider `$0` (`:free` model) persists as `0`, not `null` (`?? null` in writers) | 1 | COST-04 | — | N/A | unit | `bun test packages/database/src/repositories/__tests__/request.repository.test.ts` | ❌ W0 | ⬜ pending |
| Estimate-$0 for UNKNOWN model does NOT persist as `0` (upstream `0 → undefined` guard in worker estimate branch) | 1 | COST-04 | — | N/A | unit | `bun test packages/proxy/src/__tests__/sse-parsing.test.ts packages/proxy/src/__tests__/extract-usage-from-json.test.ts` | ✅ extend | ⬜ pending |
| Non-OpenRouter provider unchanged — still estimates, carries no real cost (regression guard) | 1 | COST-04 | — | N/A | unit | `bun test packages/providers` + worker estimate test | ❌ W0 (explicit assertion) | ⬜ pending |
| `usage.cost` typeof guard rejects string/non-numeric in streaming path | 1 | COST-04 | T-7-01 | Type-confusion input does not corrupt numeric cost field | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | ✅ mirror non-streaming guard test | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] DB-writer-level test asserting `?? null` persists real `$0` — add to `packages/database/src/repositories/__tests__/request.repository.test.ts` (no existing direct test for `save()`/`updateUsage()` cost zero-handling)
- [ ] `extractStreamingUsage` override fixture — an SSE byte stream whose final `message_delta` carries `usage.cost` (numeric, `0`, `null`, and string cases); mirror non-streaming COST-01 fixtures at `provider.test.ts:115-218`
- [ ] Explicit non-OpenRouter regression assertion — estimate still runs, no real cost; estimate-$0 unknown model → not persisted as `0`
- No framework install needed (`bun:test` is built in)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real extracted cost appears in logs for a live streaming OpenRouter request | COST-04 | D-05: confirms end-to-end extraction without a unit harness; SSE shape was ASSUMED (A1), not live-verified | Force-route a **free** model (`z-ai/glm-4.5-air:free`) via `x-better-ccflare-account-id` to an OpenRouter account; inspect logs for the extracted `usage.cost`. NEVER a paid model, NEVER the Anthropic endpoint, NEVER the `claude` account. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (writer $0 test, streaming SSE fixture, non-OpenRouter regression assertion)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
