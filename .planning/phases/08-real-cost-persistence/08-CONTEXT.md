# Phase 8: Real Cost Persistence - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase ensures the real OpenRouter USD cost extracted in Phase 7 (`usage.cost`)
actually lands in the `requests.cost_usd` column for **both streaming and
non-streaming** requests, skipping `estimateCostUSD()` wherever a real
provider-returned cost exists — with **zero regression** for non-OpenRouter
providers (Anthropic, Bedrock, Qwen, etc.).

**Requirement:** COST-04.

**What Phase 7 already delivered (do NOT redo):**
- Non-streaming OpenRouter provider path: `OpenRouterProvider.extractUsageInfo()`
  returns real `costUsd` from `json.usage.cost` (`provider.ts:273`).
- Worker path (SSE + non-streaming body): `handleEnd()` is already gated —
  uses `state.usage.providerCostUsd` directly when set, else estimates
  (`post-processor.worker.ts:678`).

**What is STILL broken (this phase fixes):**
1. **Streaming OpenRouter via the live response-processor path estimates.**
   OpenRouter has no `parseUsage`, so streaming falls through to
   `extractUsageInfo → super.extractUsageInfo → extractStreamingUsage`
   (`base-anthropic-compatible.ts:557`), which calls `estimateCostUSD()` and
   never reads `usage.cost`.
2. **Two writers race for `cost_usd`.** Both run for every successful request:
   the worker (`saveRequest`, UPSERT, unconditional `cost_usd = EXCLUDED.cost_usd`)
   and the live path (`updateUsage`, `cost_usd = COALESCE(?, cost_usd)`). Write
   order is undefined, so the streaming estimate can clobber the worker's real
   value.
3. **Real `$0` is silently dropped.** Both DB writers use `usage?.costUsd || null`,
   converting a legitimate `$0` from `:free` models into `null`.

**Phase 8 does NOT:** change the DB schema, change the dashboard, add a
`cost_details` breakdown, or alter cost handling for non-OpenRouter providers.
</domain>

<decisions>
## Implementation Decisions

### Streaming reconciliation — make both writers converge on real cost (D-01)
- **D-01:** Fix the OpenRouter **streaming provider path** to read the real
  `usage.cost` (from the final SSE chunk), mirroring the existing non-streaming
  `extractUsageInfo` override (the CACHE-01 / COST-01 fork override pattern).
  Once the provider streaming path returns real cost, BOTH writers
  (worker `saveRequest` and live `updateUsage`) persist the **same real value**,
  so the undefined write-ordering race becomes harmless. This is preferred over
  suppressing the live path or enforcing writer ordering — it removes the race
  by construction rather than papering over it.
- **D-02:** The implementing mechanism (override `extractStreamingUsage`, override
  `parseUsage`, or read the final SSE cost some other way) is the planner's call,
  but it MUST follow the fork's provider-override convention — override in
  `OpenRouterProvider`, do NOT modify `base-anthropic-compatible.ts` or other
  providers' streaming logic.

### Zero-cost — persist real $0 only (D-03)
- **D-03:** A genuine provider-returned `$0` (e.g. `:free` models) MUST persist as
  `0` in `cost_usd`. Switch the **real-cost** value handling from `|| null` to
  `?? null` so `0` survives. Free models should show an accurate `$0.00`, not an
  estimate or null.
- **D-04:** An estimate-of-`$0` for an **unknown model** must NOT start being
  persisted as a literal `0` (that is the original bug the roadmap calls out:
  "$0 for unknown models"). Real-$0 persists; estimate-$0 stays null/undefined.
  See Claude's Discretion below for the open mechanism question research must
  resolve.

### Verification — unit tests + logs, no live paid calls (D-05)
- **D-05:** Verify via **unit tests** on the changed writers/override plus **log
  inspection** of extracted cost values. Do NOT make live paid OpenRouter calls
  for verification. (Respects CLAUDE.md: never curl Anthropic; avoid spend.)
  Unit tests must cover: streaming OpenRouter real cost extracted; real `$0`
  persists; estimate-$0 for unknown model does NOT persist as 0; non-OpenRouter
  providers unchanged (estimate still runs, no real cost present).

### Claude's Discretion
- **Open mechanism for D-03/D-04 (research MUST resolve):** The DB writers
  (`request.repository.ts` `save()` L115 and `updateUsage()` L158) cannot
  distinguish real-$0 from estimate-$0 — both arrive as `usage.costUsd`. Research
  must confirm what `estimateCostUSD()` (`packages/core/src/pricing.ts:770`)
  returns for an **unknown model**: if it returns `0`, a global `?? null` switch
  would wrongly persist estimate-$0, so the distinction must be enforced upstream
  (e.g. ensure only the real-cost value carries `0` while the unknown-model
  estimate yields `undefined`). If `estimateCostUSD()` already returns `undefined`
  for unknown models, a scoped `?? null` on the real-cost value is sufficient.
- Whether to change `?? null` in only `save()`, only `updateUsage()`, or both —
  determined by which writer carries the real OpenRouter value in practice.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — COST-04 requirement; out-of-scope list
  (`cost_details` breakdown, dashboard changes)
- `.planning/ROADMAP.md` — Phase 8 goal + 3 success criteria; Phase 7/8 split
- `.planning/phases/07-openrouter-response-cost-extraction/07-CONTEXT.md` —
  Phase 7 decisions (D-01..D-06), especially `providerCostUsd` field and the
  `handleEnd()` gating that this phase builds on
- `.planning/phases/07-openrouter-response-cost-extraction/07-02-SUMMARY.md` —
  exactly what the worker gating already does (so Phase 8 does not redo it)

### Key Source Files — the remaining gaps
- `packages/providers/src/providers/openrouter/provider.ts` — `extractUsageInfo()`
  override returning real `costUsd` (L227–289, non-streaming). The streaming
  branch currently delegates to `super` (L247); target for D-01/D-02.
- `packages/providers/src/providers/base-anthropic-compatible.ts` —
  `extractStreamingUsage()` (L331) estimates at `estimateCostUSD()` (L557) and
  never reads `usage.cost`; `extractUsageInfo()` non-streaming estimate at L300.
  Reference only — do NOT modify (override in OpenRouter instead).
- `packages/proxy/src/handlers/response-processor.ts` — live usage path:
  streaming uses `parseUsage` if present else `extractUsageInfo` (L154/L179) →
  `updateRequestUsage` (L166/L193). OpenRouter has no `parseUsage`.
- `packages/proxy/src/post-processor.worker.ts` — `handleEnd()` cost gating
  (L678–687, already done in Phase 7); writes final cost via `saveRequest` (L785).
- `packages/database/src/repositories/request.repository.ts` — `save()` UPSERT
  with `cost_usd = EXCLUDED.cost_usd` (L87) and `usage?.costUsd || null` (L115);
  `updateUsage()` with `cost_usd = COALESCE(?, cost_usd)` (L145) and
  `usage.costUsd || null` (L158). Targets for D-03/D-04 (`|| null` → `?? null`).
- `packages/database/src/database-operations.ts` — `updateRequestUsage()` facade
  (L852) → `requests.updateUsage()`.
- `packages/core/src/pricing.ts` — `estimateCostUSD()` (L770); research must
  confirm its unknown-model return value (0 vs undefined) per Claude's Discretion.

### Existing Tests (extend, don't replace)
- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` —
  `extractUsageInfo` COST-01 suite; add streaming-cost assertions here.
- `packages/proxy/src/__tests__/sse-parsing.test.ts` and
  `packages/proxy/src/__tests__/extract-usage-from-json.test.ts` — Phase 7
  worker cost tests; reference for assertion patterns.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **OpenRouter `extractUsageInfo` override** (`provider.ts:227`): the non-streaming
  half already reads `usage.cost` with a `typeof === "number"` guard. The
  streaming half delegates to `super` — extend the override to read SSE
  `usage.cost` too (D-01).
- **`providerCostUsd` field + `handleEnd()` gating** (`post-processor.worker.ts`):
  Phase 7 already makes the worker authoritative for real cost. The remaining
  work is making the *live provider path* match, not re-gating the worker.
- **`typeof x === "number"` guard pattern**: established in Phase 7 for
  provider-controlled numeric fields (tampering mitigation) — reuse for any new
  SSE cost read.

### Established Patterns
- **Provider override, never base-class change**: all fork patches override in the
  concrete `OpenRouterProvider`. D-01/D-02 must follow this.
- **Dual-writer UPSERT/UPDATE**: `save()` overwrites unconditionally; `updateUsage()`
  COALESCEs. Both already run per request — the fix converges their *input*
  (real cost) rather than re-plumbing the writers.

### Integration Points
- **Live path → DB**: `processProxyResponse` (proxy-operations.ts:960) →
  response-processor usage block → `updateRequestUsage` → `updateUsage`
  (`cost_usd = COALESCE`).
- **Worker → DB**: SSE/JSON cost → `providerCostUsd` → `handleEnd()` →
  `saveRequest` (`cost_usd = EXCLUDED`, unconditional).
- **Non-OpenRouter providers**: no `usage.cost` field → `providerCostUsd`/override
  cost stays undefined → `estimateCostUSD()` runs unchanged. Must remain true
  after this phase (regression guard).

</code_context>

<specifics>
## Specific Ideas

No external design references. Implementation follows the existing Phase 7
override and worker-gating patterns already in the codebase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within COST-04 scope.

</deferred>

---

*Phase: 8-Real Cost Persistence*
*Context gathered: 2026-05-31*
