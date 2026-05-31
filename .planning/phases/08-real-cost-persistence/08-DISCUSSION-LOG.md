# Phase 8: Real Cost Persistence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 8-real-cost-persistence
**Areas discussed:** Writer authority, Streaming provider path, Zero-cost handling, Verification method

---

## Streaming reconciliation (merged: Writer authority + Streaming provider path)

Both selected areas resolved to the same underlying decision — how the live
streaming provider path and the worker reconcile so real cost wins.

| Option | Description | Selected |
|--------|-------------|----------|
| Override provider path | Add an OpenRouter streaming override that reads `usage.cost` from the final SSE chunk, mirroring the non-streaming COST-01 override. Both writers then persist the same real value; ordering stops mattering. | ✓ |
| Worker-only, suppress live | Leave the provider estimating; make response-processor skip writing `cost_usd` for OpenRouter so only the Phase-7-gated worker writes it. | |

**User's choice:** Override provider path
**Notes:** Removes the undefined-write-order race by construction. Must follow the
fork's provider-override convention — override in `OpenRouterProvider`, never touch
`base-anthropic-compatible.ts`.

---

## Zero-cost handling

| Option | Description | Selected |
|--------|-------------|----------|
| Persist real $0 only | Use `?? null` for the real provider cost so a genuine $0 is stored, while estimate-$0 for unknown models still resolves to null. | ✓ |
| Global ?? null | Switch both writers to `?? null` unconditionally — also persists estimate-$0 for unknown models as literal 0. | |
| Leave as-is | Keep `\|\| null`; free-model $0 stays null/estimate. | |

**User's choice:** Persist real $0 only
**Notes:** Free models must show accurate $0.00. Open mechanism: DB layer can't tell
real-$0 from estimate-$0 — research must confirm `estimateCostUSD()`'s unknown-model
return (0 vs undefined) to decide whether a guard is needed alongside `?? null`.

---

## Verification method

| Option | Description | Selected |
|--------|-------------|----------|
| Paid + free, DB query | Force-route a small paid OpenRouter model + a :free model, streaming + non-streaming, then read `cost_usd` from the DB. | |
| Free model only | Only glm-4.5-air:free; verify $0 persists. | |
| Unit tests + logs | No live paid calls; verify via unit tests on writers/override plus log inspection. | ✓ |

**User's choice:** Unit tests + logs
**Notes:** Respects CLAUDE.md testing rules (never curl Anthropic; avoid spend). Unit
tests must cover streaming real cost, real-$0 persistence, estimate-$0 NOT persisted,
and non-OpenRouter regression.

---

## Claude's Discretion

- Exact override mechanism for the streaming path (override `extractStreamingUsage`
  vs `parseUsage` vs other), provided it overrides in `OpenRouterProvider`.
- Whether `?? null` changes land in `save()`, `updateUsage()`, or both.
- Resolving real-$0 vs estimate-$0 distinction pending `estimateCostUSD()`
  unknown-model behavior (research).

## Deferred Ideas

None — discussion stayed within COST-04 scope.
