# Phase 8: Real Cost Persistence - Research

**Researched:** 2026-05-31
**Domain:** OpenRouter cost plumbing — provider streaming-usage override + DB writer zero-handling (no new deps, no schema change)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Fix the OpenRouter **streaming provider path** to read the real `usage.cost` (from the final SSE chunk), mirroring the existing non-streaming `extractUsageInfo` override (the CACHE-01 / COST-01 fork override pattern). Once the provider streaming path returns real cost, BOTH writers (worker `saveRequest` and live `updateUsage`) persist the **same real value**, so the undefined write-ordering race becomes harmless. Preferred over suppressing the live path or enforcing writer ordering — removes the race by construction.
- **D-02:** The implementing mechanism is the planner's call, but it MUST follow the fork's provider-override convention — override in `OpenRouterProvider`, do NOT modify `base-anthropic-compatible.ts` or other providers' streaming logic.
- **D-03:** A genuine provider-returned `$0` (e.g. `:free` models) MUST persist as `0` in `cost_usd`. Switch the **real-cost** value handling from `|| null` to `?? null` so `0` survives.
- **D-04:** An estimate-of-`$0` for an **unknown model** must NOT start being persisted as a literal `0`. Real-$0 persists; estimate-$0 stays null/undefined.
- **D-05:** Verify via **unit tests** on the changed writers/override plus **log inspection**. Do NOT make live paid OpenRouter calls. Do NOT curl the Anthropic endpoint (CLAUDE.md hard rule). Unit tests must cover: streaming OpenRouter real cost extracted; real `$0` persists; estimate-$0 for unknown model does NOT persist as 0; non-OpenRouter providers unchanged.

### Claude's Discretion
- **Open mechanism for D-03/D-04 (research MUST resolve):** confirm what `estimateCostUSD()` returns for an unknown model (0 vs undefined). If `0`, a global `?? null` switch wrongly persists estimate-$0, so the distinction must be enforced upstream. — **RESOLVED below: it returns literal `0`.**
- Whether to change `?? null` in only `save()`, only `updateUsage()`, or both — determined by which writer carries the real OpenRouter value in practice.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within COST-04 scope. Out of scope per REQUIREMENTS.md: `cost_details` breakdown, dashboard changes, DB schema changes, cost handling for non-OpenRouter providers.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COST-04 | Skip `estimateCostUSD()` when provider-returned `costUsd` is already available, ensuring `cost_usd` ends up in `requests` table for OpenRouter accounts | Worker path already gated (Phase 7, `handleEnd()` L678). Remaining gaps: (1) live streaming provider path estimates — fix via `extractStreamingUsage` override in `OpenRouterProvider`; (2) DB writers drop real `$0` via `|| null` — fix via scoped `?? null` on the real-cost value while preventing estimate-$0 leakage (estimate returns literal `0`). |
</phase_requirements>

## Summary

Phase 7 made the **worker** path authoritative for OpenRouter real cost (`handleEnd()` uses `state.usage.providerCostUsd` when set, else estimates — `post-processor.worker.ts:678`). Phase 8 closes two remaining gaps so the real `usage.cost` reliably lands in `requests.cost_usd` for both streaming and non-streaming OpenRouter requests, with zero non-OpenRouter regression.

**Gap 1 (live streaming path).** OpenRouter has no `parseUsage`, so the live response-processor routes streaming through `extractUsageInfo` → (event-stream content-type) → `extractStreamingUsage` (`base-anthropic-compatible.ts:331`). That base method reads `data.usage` from the `message_delta` SSE event (L495-509) but extracts only tokens, then calls `estimateCostUSD()` (L557). The OpenRouter SSE `message_delta` event DOES carry `usage.cost` — confirmed by Phase 7's worker reading `parsed.usage.cost` from the very same event (`post-processor.worker.ts:379`). The fix: override `extractStreamingUsage` in `OpenRouterProvider`, call `super.extractStreamingUsage()` for the token/model breakdown, re-read `usage.cost` from the final `message_delta` chunk with a `typeof === "number"` guard, and overwrite `costUsd` when present.

**Gap 2 (zero-cost drop + the estimate-$0 trap).** Both DB writers convert `0` to `null`: `save()` uses `usage?.costUsd || null` (`request.repository.ts:115`) and `updateUsage()` uses `usage.costUsd || null` (L158). Switching to `?? null` makes real `$0` survive. **Critical constraint:** `estimateCostUSD()` returns **literal `0`** for unknown models (catch block, `pricing.ts:802`) — so a blind global `?? null` would wrongly persist estimate-$0 as a literal `0`, reintroducing the exact "$0 for unknown models" bug. The real-$0 vs estimate-$0 distinction MUST be enforced **upstream** of the writers: only a genuine provider cost may carry `0` into `costUsd`; the unknown-model estimate path must yield `undefined` (or skip the write) so `?? null` collapses it to `null`.

**Primary recommendation:** (1) Override `extractStreamingUsage` in `OpenRouterProvider` to inject real SSE `usage.cost` (typeof-guarded), delegating to `super` for everything else. (2) Switch both writers' cost line from `|| null` to `?? null`. (3) Enforce the real/estimate distinction upstream: ensure the unknown-model estimate produces `undefined` rather than `0` before it reaches the writers (either in `handleEnd()`'s estimate branch and the base `extractStreamingUsage`/`extractUsageInfo` estimate branches, OR — minimal-blast-radius alternative — gate the writer switch so it only applies to OpenRouter-sourced rows). Resolve the upstream-enforcement location during planning; see "Critical Findings" for the two candidate approaches.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read real `usage.cost` from streaming SSE | Provider layer (`OpenRouterProvider.extractStreamingUsage`) | — | Fork convention: provider-specific response parsing lives in the concrete provider override, never the base class (D-02). Mirrors the existing `extractUsageInfo` override. |
| Read real `usage.cost` from non-streaming JSON | Provider layer (`OpenRouterProvider.extractUsageInfo`) | — | Already done in Phase 7 (`provider.ts:273`). No change needed. |
| Read real `usage.cost` from worker SSE/JSON | Worker (`post-processor.worker.ts`) | — | Already done in Phase 7 (`providerCostUsd` + `handleEnd()` gating). No change needed. |
| Persist real `$0`, reject estimate-$0 | Database layer (`request.repository.ts` writers) + upstream estimate guard | — | The `|| null` → `?? null` switch lives in the writers; the real/estimate distinction must be enforced upstream because the writers cannot tell them apart. |

## Standard Stack

No new libraries. This phase is pure plumbing inside existing packages.

### Core (existing, unchanged versions)
| Library / Module | Purpose | Why Relevant |
|------------------|---------|--------------|
| `@better-ccflare/providers` (`OpenRouterProvider`) | Provider-specific response parsing | D-01/D-02 override target |
| `@better-ccflare/proxy` (`post-processor.worker.ts`, `response-processor.ts`) | Usage extraction + dual-writer dispatch | Already gated (worker); live path routes streaming through `extractStreamingUsage` |
| `@better-ccflare/database` (`request.repository.ts`) | `save()` UPSERT + `updateUsage()` UPDATE | D-03/D-04 `?? null` target |
| `@better-ccflare/core` (`pricing.ts` `estimateCostUSD`) | Cost estimate fallback | Returns literal `0` for unknown models — root cause of the D-04 trap |
| `bun:test` | Test runner | All verification (D-05) |

**Installation:** None. No `package.json` change. No schema change → **no PostgreSQL migration parity work** (the CLAUDE.md migration rule does not apply here).

## Critical Findings (Claude's Discretion resolutions)

### Finding 1 — `estimateCostUSD()` returns LITERAL `0` for unknown models [VERIFIED: codebase]

`packages/core/src/pricing.ts:770-804`. The function accumulates `totalCost` from per-token rates. For each token kind it calls `getCostRate()`, which **throws** `Error("Model ${modelId} not found in pricing catalogue")` (L763) when the model is absent from the catalogue. The outer `try/catch` (L776-803) catches that throw and **returns `0`** (L802):

```ts
// pricing.ts:776-803 (verbatim)
try {
    let totalCost = 0;
    if (tokens.inputTokens) { const rate = await getCostRate(modelId, "input"); totalCost += tokens.inputTokens * rate; }
    // ... output / cache_read / cache_write ...
    return totalCost;
} catch (error) {
    catalogue.warnOnce(modelId, error instanceof Error ? error : String(error));
    return 0;   // ← unknown model yields literal 0, NOT undefined
}
```

**Consequence (decisive for D-03/D-04):** A blind, global `?? null` switch in the writers would persist the unknown-model estimate-$0 as a literal `0` — the exact bug the roadmap warns against. Therefore the real-$0 vs estimate-$0 distinction **must be enforced UPSTREAM** of the writers. Two viable enforcement strategies (planner picks one):

- **Strategy A — make the estimate path yield `undefined` for unknown models.** Wherever an estimate is the source of `costUsd`, treat a `0` estimate as "no cost known" → leave `costUsd` undefined. Sites: `handleEnd()` estimate branch (`post-processor.worker.ts:681`), base `extractStreamingUsage` estimate (`base-anthropic-compatible.ts:557`), base non-streaming `extractUsageInfo` estimate (`base-anthropic-compatible.ts:300`). Then a global `?? null` in both writers is safe. **Risk:** broader blast radius — touches the shared base class and worker, and changes behaviour for *all* providers (a known model that legitimately costs exactly `$0` via estimate would also become `undefined`; in practice estimate-$0 only occurs for unknown/uncatalogued models, so this is acceptable, but it is a behaviour change to verify per provider). Note D-02 forbids modifying `base-anthropic-compatible.ts` *for the streaming-cost read*; an estimate-guard tweak there is a separate concern but still widens scope — prefer to keep base untouched.
- **Strategy B (recommended) — keep the estimate path returning `0`, but scope the writer switch.** Only switch `|| null` → `?? null` AND only let a `0` through when the cost is **real provider cost**, not an estimate. Because only OpenRouter currently returns `usage.cost`, the cleanest scoping is: the real cost is already isolated as `providerCostUsd` (worker) / the OpenRouter override's `costUsd`. Carry a signal that the `0` is real (e.g. the value originates from `providerCostUsd`/override, not the estimate branch) so the writer can persist `0` only for real costs. In `handleEnd()`, this is naturally satisfied: when `providerCostUsd !== undefined` the real value (possibly `0`) is assigned to `costUsd`; when it's undefined the estimate (possibly `0`) is assigned. To distinguish them at the writer, the upstream code must NOT let an estimate-$0 reach `costUsd` as a "to-persist" `0` — i.e. the estimate branch should map `0 → undefined` *locally* (worker `handleEnd()` only, not the base class). This keeps the base class untouched (honors D-02 spirit) and confines the change to the worker + writers + OpenRouter override.

**Recommendation:** Strategy B, confined to the worker `handleEnd()` estimate branch (map estimate `0 → undefined` there) + OpenRouter `extractStreamingUsage` override (real cost, may be `0`) + both writers (`?? null`). This keeps `base-anthropic-compatible.ts` fully untouched and limits behaviour change to OpenRouter rows. Confirm in planning whether the live path's estimate branch (base `extractStreamingUsage`/`extractUsageInfo`) also needs the `0 → undefined` map; if the live path is only ever the *real* OpenRouter override for OpenRouter accounts and the estimate for other providers, then non-OpenRouter estimate-$0 only matters if some non-OpenRouter unknown model currently estimates to `0` and we are about to start persisting it — see Open Questions Q1.

### Finding 2 — Cleanest D-01/D-02 mechanism: override `extractStreamingUsage` in `OpenRouterProvider` [VERIFIED: codebase]

Three candidate mechanisms were compared:

| Mechanism | Feasible? | Verdict |
|-----------|-----------|---------|
| Override `extractStreamingUsage` | YES — it is `protected` (`base-anthropic-compatible.ts:331`), `OpenRouterProvider extends AnthropicCompatibleProvider` (`provider.ts:41`), and the live path reaches it via `extractUsageInfo` (`base...:276`) since OpenRouter's own `extractUsageInfo` override delegates streaming to `super` (`provider.ts:247`). | **RECOMMENDED** |
| Add a `parseUsage` to OpenRouter | Possible but WRONG — `parseUsage` takes priority in the live path (`response-processor.ts:154`) and would duplicate the entire SSE parsing the base already does. More code, more drift risk, violates "minimal change / extend existing override" fork convention. | Rejected |
| Read final SSE cost "some other way" (e.g. intercept stream) | Re-implements the buffered SSE reader already in the base. High risk. | Rejected |

**Why `extractStreamingUsage` is correct and sufficient:** The base method already buffers the stream and parses the final `message_delta` event into a `data.usage` object (`base...:495-509`). It extracts `input_tokens`/`output_tokens`/`cache_read_input_tokens` from that object but **drops `cost`**. The OpenRouter SSE `message_delta.usage.cost` field is real and present — proven by Phase 7's worker reading `parsed.usage.cost` from the identical event (`post-processor.worker.ts:379`). The override should:

1. Re-buffer the clone (or call `super.extractStreamingUsage(clone, headers)` for the token/model result), then
2. Independently read the final `message_delta` `usage.cost` with the established `typeof === "number"` guard, and
3. If a numeric cost is present, set `costUsd` to it (overwriting the estimate `super` computed); otherwise return `super`'s result unchanged.

**Data-availability caveat (must verify in planning):** `super.extractStreamingUsage` consumes the stream reader (`clone.body.getReader()`, `base...:345`) and does NOT expose the raw parsed `message_delta.usage` object to a subclass — it only returns the computed token/cost result. A `Response` body can be read only once. Therefore the override CANNOT call `super` and *then* re-read the same body for cost. Two ways out:
- **(a)** Override clones the response **before** delegating: `const c1 = clone.clone(); const base = await super.extractStreamingUsage(clone, headers); const cost = await readFinalSseCost(c1);` — read cost from the independent clone. This re-buffers the SSE stream a second time (acceptable; the base already does a bounded buffered read with `ANTHROPIC_STREAM_CAP_BYTES`).
- **(b)** Override does NOT call `super`; it re-implements a small buffered reader that extracts both tokens and cost. More code, more duplication — rejected vs (a).

**Recommendation:** Mechanism = override `extractStreamingUsage`; approach = **(a)** clone-before-delegate, read `usage.cost` from the independent clone with a `typeof` guard, overwrite `costUsd` only when numeric. This honors D-02 (no base-class edit), reuses `super` for all token/model logic, and mirrors the non-streaming `extractUsageInfo` override's `typeof json.usage.cost === "number"` guard (`provider.ts:273`).

## Architecture Patterns

### Data flow (real OpenRouter cost → `requests.cost_usd`)

```
OpenRouter response (streaming SSE  OR  non-streaming JSON)
        │
        ├── LIVE PATH (response-processor.ts:148-207) ──────────────────────────┐
        │     isStream && provider.parseUsage?  → NO for OpenRouter (no parseUsage)│
        │     → extractUsageInfo(clone)                                           │
        │         streaming (event-stream)? → extractStreamingUsage   ← FIX (D-01)│
        │             [base: tokens only + estimate]                              │
        │             [OpenRouter override: + real usage.cost via typeof guard]   │
        │         non-streaming JSON → OpenRouter extractUsageInfo (Phase 7 done) │
        │     → updateRequestUsage(requestId, usageInfo)                          │
        │     → request.repository.updateUsage()  cost_usd = COALESCE(?, ...)     │
        │         line 158: usage.costUsd || null   ← FIX (D-03)  → ?? null       │
        │                                                                          ▼
        │                                                            requests.cost_usd
        │                                                                          ▲
        └── WORKER PATH (post-processor.worker.ts) ───────────────────────────────┤
              SSE message_delta usage.cost → providerCostUsd (Phase 7 done, L379)  │
              non-streaming JSON usage.cost → providerCostUsd (Phase 7 done, L316) │
              handleEnd(): providerCostUsd !== undefined ? real : estimate (L678)  │
                 [estimate branch returns literal 0 for unknown model — TRAP D-04] │
              → saveRequest(... costUsd: state.usage.costUsd ...) (L785, L804)     │
              → request.repository.save()  cost_usd = EXCLUDED.cost_usd (UPSERT)   │
                  line 115: usage?.costUsd || null   ← FIX (D-03)  → ?? null ──────┘
```

Both writers run for every successful request; write order is undefined. Once the live streaming path returns the **same real cost** the worker already persists, the race is harmless (D-01 by construction).

### Pattern 1: Provider override with `typeof` numeric guard (tampering mitigation)
**What:** Read provider-controlled numeric fields only when `typeof x === "number"`; otherwise leave `undefined`.
**When to use:** Any new SSE/JSON cost read in the OpenRouter override (D-01).
**Example (existing, non-streaming — mirror this in the streaming override):**
```ts
// Source: packages/providers/src/providers/openrouter/provider.ts:271-274 [VERIFIED: codebase]
// COST-01: typeof guard rejects string/non-numeric values (T-7-01 tampering mitigation).
const costUsd =
    typeof json.usage.cost === "number" ? json.usage.cost : undefined;
```

### Pattern 2: Real-vs-estimate cost gating (worker, Phase 7 — reference, do NOT redo)
```ts
// Source: packages/proxy/src/post-processor.worker.ts:676-687 [VERIFIED: codebase]
if (state.usage.providerCostUsd !== undefined) {
    state.usage.costUsd = state.usage.providerCostUsd;          // real cost (may be 0)
} else {
    state.usage.costUsd = await estimateCostUSD(state.usage.model, { /* tokens */ }); // ← returns 0 for unknown model (D-04 trap)
}
```
**Phase 8 touchpoint (Strategy B):** in the `else` branch, map estimate `0 → undefined` so an unknown-model estimate does not reach the writer as a persist-worthy `0`.

### Anti-Patterns to Avoid
- **Global `?? null` without upstream guard:** persists estimate-$0 from unknown models as literal `0` (re-introduces the D-04 bug). MUST pair with upstream estimate-$0 → undefined enforcement.
- **Editing `base-anthropic-compatible.ts` streaming logic:** violates D-02 and the fork's provider-override convention; risks regressing every other AnthropicCompatible provider and breaking clean upstream re-merges.
- **Adding `parseUsage` to OpenRouter:** duplicates base SSE parsing, takes priority over `extractUsageInfo` in the live path, more drift surface.
- **Re-reading the same `Response` body twice:** a body is single-use; clone before delegating to `super.extractStreamingUsage` (which consumes the reader).
- **Re-gating the worker:** Phase 7 already made the worker authoritative. Do not touch `handleEnd()` gating except the estimate-$0→undefined map (Strategy B).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Buffered SSE final-chunk parsing | A new stream reader in the OpenRouter override | `super.extractStreamingUsage()` for tokens; clone + minimal cost read for `usage.cost` | Base already handles timeouts, byte caps (`ANTHROPIC_STREAM_CAP_BYTES`), and `message_start`/`message_delta` reconciliation |
| Cost estimation | Anything | `estimateCostUSD()` (`pricing.ts:770`) | Already the fallback; only its `0`-for-unknown return needs guarding |
| DB cost write | New column / new query | Existing `save()` UPSERT + `updateUsage()` UPDATE | Schema unchanged; only the `|| null` → `?? null` operator changes |

**Key insight:** Phase 8 is a 3-line-class-of-change phase: one provider override method, one operator switch in two writer lines, one estimate-$0→undefined guard. The risk is entirely in *where* the real/estimate distinction is enforced — not in volume of code.

## Common Pitfalls

### Pitfall 1: Persisting estimate-$0 as literal 0
**What goes wrong:** Switching writers to `?? null` without an upstream guard makes unknown-model estimates (which `estimateCostUSD` returns as `0`) persist as `0` instead of `null`.
**Why it happens:** `estimateCostUSD()` catches "model not in catalogue" and returns `0` (`pricing.ts:802`), indistinguishable at the writer from a real `$0`.
**How to avoid:** Enforce real/estimate distinction upstream (Strategy B: map estimate `0 → undefined` in the worker `handleEnd()` estimate branch; OpenRouter override carries real cost that may legitimately be `0`).
**Warning signs:** Unit test "estimate-$0 for unknown model" persists `0` instead of `null`/leaving prior value.

### Pitfall 2: Reading the response body twice
**What goes wrong:** Override calls `super.extractStreamingUsage(clone, ...)` (consumes the stream) then tries to re-read `clone` for cost → empty body / null cost.
**Why it happens:** `Response.body` is a single-use `ReadableStream`.
**How to avoid:** `clone.clone()` an independent copy *before* delegating to `super`; read cost from the independent clone.
**Warning signs:** Streaming cost always `undefined` in tests even when `usage.cost` is present.

### Pitfall 3: Clobbering the worker's real value with a live-path estimate
**What goes wrong:** Live streaming path writes an estimate via `updateUsage` (COALESCE) while the worker writes the real value via `save` (EXCLUDED); undefined order can overwrite real with estimate.
**Why it happens:** Two writers, undefined order, divergent inputs.
**How to avoid:** D-01 — make the live streaming path return the SAME real cost, so both inputs converge. (Do not attempt to order the writers.)
**Warning signs:** `cost_usd` flips between real and estimate across otherwise-identical streaming requests.

### Pitfall 4: Non-OpenRouter regression
**What goes wrong:** A change to the base class or a global estimate guard alters cost for Anthropic/Bedrock/Qwen.
**Why it happens:** Touching shared code paths instead of the OpenRouter override.
**How to avoid:** Confine the streaming-cost read to `OpenRouterProvider`; confine the estimate-$0 guard to the worker `handleEnd()` (Strategy B). Add a regression test asserting non-OpenRouter providers still estimate and carry no real cost.
**Warning signs:** Non-OpenRouter unit tests change expected cost values.

## Runtime State Inventory

Not applicable — Phase 8 is a code-only persistence/refactor phase with no rename, no schema change, no migration, and no external service reconfiguration. No stored data keys, service config, OS-registered state, secrets, or build artifacts are affected. (Verified: REQUIREMENTS.md lists schema/dashboard/`cost_details` as out of scope; CONTEXT.md confirms no schema change → no PG migration parity required.)

## Code Examples

### Recommended D-01/D-02 override skeleton (OpenRouterProvider)
```ts
// Source: pattern derived from existing OpenRouterProvider.extractUsageInfo override
// (provider.ts:227-288) + base extractStreamingUsage (base-anthropic-compatible.ts:331). [VERIFIED: codebase]
protected override async extractStreamingUsage(
    clone: Response,
    originalHeaders: Headers,
): Promise<{ /* same shape as base */ costUsd?: number; /* ... */ } | null> {
    // Clone BEFORE delegating — super consumes the body reader.
    const costClone = clone.clone();
    const base = await super.extractStreamingUsage(clone, originalHeaders);
    if (!base) return base;

    // Re-read the final message_delta usage.cost from the independent clone.
    // Reuse a small buffered reader OR a shared SSE helper; guard with typeof.
    const realCost = await this.readFinalSseCost(costClone); // returns number | undefined
    if (typeof realCost === "number") {
        return { ...base, costUsd: realCost }; // overwrite estimate with real cost (may be 0)
    }
    return base;
}
```
*(`readFinalSseCost` reads `message_delta.usage.cost` with the same `typeof === "number"` guard used at `provider.ts:273` and the worker at `post-processor.worker.ts:379`.)*

### D-03 writer switch (both writers)
```ts
// request.repository.ts:115 (save UPSERT)  — change:
usage?.costUsd || null   →   usage?.costUsd ?? null
// request.repository.ts:158 (updateUsage)  — change:
usage.costUsd || null    →   usage.costUsd ?? null
```

### D-04 upstream guard (worker handleEnd estimate branch — Strategy B)
```ts
// post-processor.worker.ts:680-687 estimate branch — map estimate 0 → undefined:
const est = await estimateCostUSD(state.usage.model, { /* tokens */ });
state.usage.costUsd = est === 0 ? undefined : est;  // unknown-model estimate must NOT persist as literal 0
```
*(Real cost path at L678-679 is unchanged: `providerCostUsd` — possibly `0` — is assigned directly and persists via `?? null`.)*

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All cost estimated via `estimateCostUSD()` | Worker uses real `usage.cost` when present (`providerCostUsd` gating) | Phase 7 (2026-05-31) | Worker path already correct; Phase 8 brings live streaming path + zero-handling to parity |

**Deprecated/outdated:** None relevant to this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenRouter emits `usage.cost` in the SSE `message_delta` event (the same event the base parser reads tokens from), not a separate trailing event | Finding 2 / Architecture | If cost arrives in a different/later SSE event the base buffered reader breaks out of its loop on (`messageDeltaUsage` at `base...:518`), the override's clone read might miss it. Mitigation: strongly supported by Phase 7's worker reading `parsed.usage.cost` at the message_delta handler (`worker:379`) and shipping; still tag ASSUMED because it's inferred from the worker, not independently re-verified against a live OpenRouter SSE capture (D-05 forbids live calls). Plan unit tests with a fixture SSE that places `cost` in `message_delta.usage`. |
| A2 | Only OpenRouter currently returns a real `usage.cost`; all other providers leave `providerCostUsd`/override-cost undefined and continue to estimate | Strategy B scoping | If another provider also returns `usage.cost`, scoping the fix to OpenRouter would miss it. Risk low — confirmed by CONTEXT.md regression-guard note and Phase 7 design. |
| A3 | A known/catalogued model that genuinely estimates to exactly `$0` does not occur in practice (so mapping estimate `0 → undefined` loses no real data) | Strategy B / Finding 1 | If a catalogued model legitimately costs `$0` via estimate, that `$0` would become `null`. Acceptable per D-04 intent (free models report real `$0` via provider cost, not estimate); flag for planner confirmation. |

## Open Questions

1. **Does the live-path base estimate branch also need the `0 → undefined` map, or only the worker?**
   - What we know: For OpenRouter accounts the live streaming path will return real cost via the new override; the base estimate branch only runs for non-OpenRouter providers on the live path. The worker's estimate branch runs for any provider lacking `providerCostUsd`.
   - What's unclear: Whether any non-OpenRouter provider's unknown-model estimate currently reaches a writer as `0` and would start persisting as `0` after the `?? null` switch (today `|| null` masks it).
   - Recommendation: Add a regression unit test for a non-OpenRouter unknown-model estimate asserting it does NOT persist as `0`. If it would, apply the `0 → undefined` map in the worker `handleEnd()` estimate branch (covers worker path for all providers); confirm the live path's base estimate branch behaviour with a test before deciding whether further (non-base) guarding is needed. Do NOT edit `base-anthropic-compatible.ts`.

2. **Which writer(s) need the `?? null` switch?**
   - What we know: Worker → `save()` (L115, EXCLUDED, unconditional). Live path → `updateUsage()` (L158, COALESCE). Both run per request.
   - Recommendation: Switch BOTH (CONTEXT.md D-03 allows it; both can carry the real OpenRouter value depending on path). Symmetric change is safest and matches the dual-writer convergence model.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in) |
| Config file | none — `bun test` discovers `*.test.ts` |
| Quick run command | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts packages/proxy/src/__tests__/sse-parsing.test.ts packages/proxy/src/__tests__/extract-usage-from-json.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| COST-04 | Streaming OpenRouter real `usage.cost` extracted via `extractStreamingUsage` override | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts -t "extractStreamingUsage"` | ✅ (extend existing COST-01 suite) |
| COST-04 | Real provider `$0` (`:free` model) persists as `0`, not `null` (`?? null`) | unit | `bun test packages/database/.../request.repository.test.ts` (or worker/repo-level test) | ❌ Wave 0 — add a writer-level test for `?? null` (see gaps) |
| COST-04 | Estimate-$0 for UNKNOWN model does NOT persist as `0` (upstream guard) | unit | `bun test packages/proxy/src/__tests__/sse-parsing.test.ts` / `extract-usage-from-json.test.ts` (extend Phase 7 worker tests) | ✅ (extend) |
| COST-04 | Non-OpenRouter provider unchanged — still estimates, carries no real cost (regression guard) | unit | `bun test packages/providers/...` + worker estimate test | ⚠️ partial — add explicit non-OpenRouter assertion |
| COST-04 | `usage.cost` typeof guard rejects string/non-numeric in streaming path | unit | OpenRouter provider test (mirror non-streaming COST-01 guard test) | ✅ (extend) |

### Sampling Rate
- **Per task commit:** quick run command above (provider + worker SSE/JSON tests).
- **Per wave merge:** `bun test packages/providers packages/proxy packages/database`.
- **Phase gate:** `bun test` full suite green, plus `bun run lint && bun run typecheck && bun run format` (per CLAUDE.md). Plus **log inspection** (D-05): run a forced non-Anthropic account request (e.g. OpenRouter free model `z-ai/glm-4.5-air:free` via `x-better-ccflare-account-id`) and confirm extracted cost in logs — never a paid model, never Anthropic.

### Wave 0 Gaps
- [ ] DB-writer-level test asserting `?? null` persists real `$0` (no existing direct test for `save()`/`updateUsage()` cost zero-handling). Add to `packages/database/src/repositories/` tests or a focused repo test.
- [ ] `extractStreamingUsage` override fixture: an SSE byte stream whose final `message_delta` carries `usage.cost` (numeric, `0`, `null`, and string cases) — mirror the non-streaming COST-01 fixtures (`provider.test.ts:115-218`).
- [ ] Explicit non-OpenRouter regression assertion (estimate still runs, no real cost; estimate-$0 unknown model → not persisted as `0`).
- No framework install needed (`bun:test` built in).

*(Existing assertion patterns to mirror: OpenRouter non-streaming COST-01 cases at `provider.test.ts:115-218`; worker SSE/JSON cost at `sse-parsing.test.ts:83-90` and `extract-usage-from-json.test.ts`.)*

## Security Domain

`security_enforcement` not set to `false` in config; this phase handles provider-controlled numeric input.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | `typeof x === "number"` guard on all provider-returned `usage.cost` reads (existing pattern, `provider.ts:273`; reuse in streaming override). Rejects string/object type-confusion before assigning to a numeric field. |
| V6 Cryptography | no | — |
| V2/V3/V4 Auth/Session/Access | no | No auth/session/access surface touched. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Provider supplies non-numeric `usage.cost` (string/object) to corrupt cost accounting | Tampering | `typeof === "number"` guard (T-7-01, already established in Phase 7); leave `costUsd` undefined otherwise |
| Provider supplies `NaN`/`Infinity` as a numeric cost | Tampering | Consider `Number.isFinite()` in addition to `typeof` for the new streaming read (planner discretion — Phase 7's non-streaming guard uses `typeof` only; matching it keeps consistency, but `Number.isFinite` is stricter) |

## Project Constraints (from CLAUDE.md)
- Run `bun run lint && bun run typecheck && bun run format` after every change.
- **NEVER edit** auto-generated files: `packages/proxy/src/inline-worker.ts`, `packages/database/src/inline-vacuum-worker.ts`, `packages/database/src/inline-integrity-check-worker.ts`. (Note: `post-processor.worker.ts` is the SOURCE — editing it is fine; `inline-worker.ts` is its generated artifact and must stay untouched. Phase 7 verified `inline-worker.ts` was not modified — Phase 8 must do the same.)
- `git add <specific-files>` only (never `git add .`) to avoid committing `inline-worker.ts`.
- NEVER bump version (automated release system).
- NEVER curl the Anthropic endpoint, and never route the `claude` account through the proxy for tests. Use non-Anthropic forced-route accounts (`x-better-ccflare-account-id`) only (D-05).
- Code style: tabs, double quotes (Biome).
- No schema change in this phase → the PostgreSQL migration-parity rule does NOT apply.
- GitNexus: run `gitnexus_impact({target, direction:"upstream"})` before editing `extractStreamingUsage`, `extractUsageInfo`, `estimateCostUSD`, `save`, `updateUsage`, and `handleEnd`; run `gitnexus_detect_changes()` before committing.

## Sources

### Primary (HIGH confidence — codebase, this session)
- `packages/core/src/pricing.ts:730-804` — `estimateCostUSD()` returns literal `0` for unknown models (Finding 1)
- `packages/providers/src/providers/base-anthropic-compatible.ts:256-579` — `extractUsageInfo` dispatch + `protected extractStreamingUsage` (token-only, estimate at L557)
- `packages/providers/src/providers/openrouter/provider.ts:41,227-289` — `OpenRouterProvider extends AnthropicCompatibleProvider`; non-streaming `usage.cost` override + `super` delegation for streaming
- `packages/proxy/src/handlers/response-processor.ts:148-207` — live path: `parseUsage` (absent for OpenRouter) → `extractUsageInfo` → `updateRequestUsage`
- `packages/proxy/src/post-processor.worker.ts:340-385,660-823` — SSE `usage.cost` read (L379), `handleEnd()` gating (L678), `saveRequest` (L785,L804)
- `packages/database/src/repositories/request.repository.ts:75-167` — `save()` `cost_usd = EXCLUDED` + `|| null` (L115); `updateUsage()` `cost_usd = COALESCE` + `|| null` (L158)
- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts:115-218` — COST-01 non-streaming cost tests (number/null/absent/0/string-guard) — pattern to mirror for streaming
- `packages/proxy/src/__tests__/sse-parsing.test.ts:79-130` — worker SSE cost extraction pattern (Phase 7)
- `.planning/config.json` — `nyquist_validation: true`

### Secondary (MEDIUM)
- Phase 7 `07-02-SUMMARY.md` — confirms `providerCostUsd` field + `handleEnd()` gating already shipped (do not redo)

### Tertiary (LOW)
- None — all findings verified against the codebase.

## Metadata

**Confidence breakdown:**
- D-01/D-02 mechanism (override `extractStreamingUsage`): HIGH — method is `protected`, inheritance + delegation path verified, single-read body caveat identified.
- D-03/D-04 (`?? null` + estimate-$0 trap): HIGH — `estimateCostUSD` return value verified as literal `0`; both writer lines located.
- OpenRouter SSE cost field shape: MEDIUM (A1) — inferred from Phase 7 worker behaviour, not re-verified against a live capture (D-05 forbids live calls); covered by planned fixture tests.

**Research date:** 2026-05-31
**Valid until:** 2026-06-30 (stable internal code; only an upstream re-merge touching `base-anthropic-compatible.ts` streaming logic would invalidate the override path)
