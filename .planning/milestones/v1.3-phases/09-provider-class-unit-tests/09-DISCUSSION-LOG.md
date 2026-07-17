# Phase 9: Provider Class + Unit Tests - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 9-provider-class-unit-tests
**Areas discussed:** session_id strategy, usage:{include:true}, Test fixtures, session_id gating

---

## session_id derivation strategy (ROUTE-02 / SC#4)

| Option | Description | Selected |
|--------|-------------|----------|
| Per-account | `session_id = stable hash of account.id`. Trivially stable across all turns, deterministic, easy to test. All conversations share one warm backend — ideal for single-user personal fork. | ✓ |
| Per-conversation hash | Hash `messages[0]`. Semantically per-conversation but more logic, harder fixtures; no single-user benefit (system prompt identical across CC sessions). | |
| Reuse metadata.user_id | Use Claude Code's per-machine stable hash. Effectively per-account but couples to an undocumented field. | |

**User's choice:** Per-account (recommended)
**Notes:** SC#4 only requires stability across turns, not per-conversation uniqueness — per-account satisfies it trivially and maximizes cache stickiness for personal use.

---

## usage:{include:true} injection policy

| Option | Description | Selected |
|--------|-------------|----------|
| Always inject | FORK PATCH: inject when client hasn't set `usage`. Guarantees cost appears; removes a Phase 12 failure mode; one assertable line. | ✓ |
| Probe-first | Re-run probe without the line; inject only if needed. Extra step; doesn't change the safe action. | |

**User's choice:** Always inject (recommended)
**Notes:** The probe-first answer doesn't change the safe action, so no gate needed.

---

## Unit test fixture approach

| Option | Description | Selected |
|--------|-------------|----------|
| Both real + synthetic | Captured-real `message_delta` (from probe) for the happy path; synthetic mocks for edge cases (missing/string cost, cache-hit zeros, 4-block passthrough). | ✓ |
| Captured-real only | Only probe-captured fixtures. High fidelity but awkward for edge cases. | |
| Synthetic only | Hand-written mocks only. Full control but doesn't prove real-shape parsing. | |

**User's choice:** Both real + synthetic (recommended)
**Notes:** Real fixture proves we parse OpenRouter's actual emitted shape; synthetic covers the typeof-guard and edge cases.

---

## session_id injection gating

| Option | Description | Selected |
|--------|-------------|----------|
| Always-on | Inject when client hasn't supplied `session_id`. Pure upside; no behavior risk. | ✓ |
| Env-flag gated | Opt-in behind an env flag (mirroring `SYSTEM_PROMPT_CACHE_TTL_1H`). Extra config for no safety gain. | |

**User's choice:** Always-on (recommended)
**Notes:** Adds a field Claude Code never sends; nothing to gate against.

---

## Claude's Discretion

- Exact hash function for the per-account `session_id` (only stability + determinism matter).
- File layout under `packages/providers/src/providers/openrouter-anthropic/` (mirror existing provider dirs).
- Which cost methods are shared vs copied (port the minimum; do not inherit from `OpenRouterProvider`).

## Deferred Ideas

- Probe-without-`include` empirical check → Phase 12.
- Test model availability on `/api/v1/messages` → Phase 12 (mocked fetch in Phase 9).
- `openrouter_metadata` debug logging (OBS-01) → Phase 10.
- `ANTHROPIC_SHAPE_PROVIDERS` / failover (FAIL-01) → Phase 10.
- Per-request provider selection via `x-better-ccflare-openrouter-provider` header → Future (ROUTE-F1).
