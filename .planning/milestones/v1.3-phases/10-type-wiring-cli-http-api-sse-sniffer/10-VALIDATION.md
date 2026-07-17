---
phase: 10
slug: type-wiring-cli-http-api-sse-sniffer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun:test |
| **Config file** | none — bun native |
| **Quick run command** | `bun test packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` |
| **Full suite command** | `bun run typecheck && bun test` |
| **Estimated runtime** | ~30 seconds (typecheck dominates) |

---

## Sampling Rate

- **After every task commit:** Run `bun run typecheck` (zero-error gate — SC#1)
- **After every plan wave:** Run `bun run typecheck && bun test packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts`
- **Before `/gsd-verify-work`:** Full suite must be green — `bun run typecheck && bun run lint && bun run format && bun test`
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-xx | 01 (types) | 1 | MGMT-01 | — | N/A | type-check | `bun run typecheck` | ✅ | ⬜ pending |
| 10-02-xx | 02 (CLI) | 2 | MGMT-01 | — | N/A | type-check | `bun run typecheck` | ✅ | ⬜ pending |
| 10-03-xx | 03 (HTTP API) | 2 | MGMT-02 | T-10 (input validation on new route) | New route validates payload like sibling `openrouter` handler; no auth bypass | type-check + manual | `bun run typecheck` | ✅ | ⬜ pending |
| 10-04-xx | 04 (sniffer) | 2 | FAIL-01 | — | Failover fires on `overloaded_error` for Anthropic-shape provider | unit | `bun test packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts` | ✅ | ⬜ pending |
| 10-05-xx | 05 (metadata log) | 2 | OBS-01 | T-10 (no secret leakage in logs) | `openrouter_metadata` logged only under `BETTER_CCFLARE_DEBUG`; no token/key in log | unit | `bun test packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Note: final task IDs assigned by planner. Wave/plan grouping above is indicative; planner owns the authoritative wave assignment.*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* No new test files needed — all test targets are additions to existing files:
- `packages/proxy/src/handlers/__tests__/sse-rate-limit-sniffer.test.ts` (positive + negative cases already present to mirror)
- `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts` (provider test file from Phase 9)

No framework install required (bun native).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CLI `--list` shows mode `openrouter-anthropic` after add | MGMT-01 | No CLI integration test harness in scope; SC#2 is an integration behavior | `bun run cli --add-account testor --mode openrouter-anthropic` then `bun run cli --list` — row shows provider `openrouter-anthropic`. Deferred live confirmation to Phase 12. |
| `POST /api/accounts/openrouter-anthropic` returns 200 with correct provider row | MGMT-02 | No HTTP integration test harness in scope; SC#3 is an integration behavior | Start server on test port, POST to the new route, assert 200 + DB row `provider = "openrouter-anthropic"`. Deferred live confirmation to Phase 12. |

*Type-wiring (MGMT-01) and failover (FAIL-01) and metadata logging (OBS-01) all have automated verification. Only the CLI/HTTP end-to-end creation paths (SC#2/SC#3) are manual — flagged for Phase 12 integration per CONTEXT.md scope.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (typecheck covers every task)
- [ ] Wave 0 covers all MISSING references (none — existing files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
