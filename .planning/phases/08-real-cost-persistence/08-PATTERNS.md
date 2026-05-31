# Phase 8: Real Cost Persistence - Pattern Map

**Mapped:** 2026-05-31
**Files analyzed:** 6 (3 source + 3 test)
**Analogs found:** 6 / 6 (all in-codebase, exact same-package analogs)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/providers/src/providers/openrouter/provider.ts` (ADD `extractStreamingUsage` override) | provider | streaming / transform | same file `extractUsageInfo` override (L227-289) | exact (same class, same field, sibling method) |
| `packages/database/src/repositories/request.repository.ts` (`\|\| null` → `?? null` at L115, L158) | repository | CRUD (write) | self — both lines are siblings; surrounding `\|\| null` columns stay as-is | exact |
| `packages/proxy/src/post-processor.worker.ts` (estimate `0 → undefined` guard, ~L681-687) | worker | event-driven / streaming | self — the real-cost branch directly above (L678-679) | exact |
| `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` (extend COST suite) | test | unit | self — COST-01 non-streaming suite (L115-218) | exact |
| `packages/proxy/src/__tests__/sse-parsing.test.ts` + `extract-usage-from-json.test.ts` (extend) | test | unit | self — SSE cost extraction tests (L60-127) | exact |
| `packages/database/src/repositories/__tests__/request-cost-zero.test.ts` (NEW) | test | unit | `__tests__/stats-session-cost.test.ts` (mock-adapter pattern) | role-match (repo test, different repo) |

## Pattern Assignments

### `provider.ts` — ADD `extractStreamingUsage` override (provider, streaming)

**Analog (template):** the non-streaming `extractUsageInfo` override in the SAME file. Mirror its return shape, its `typeof === "number"` cost guard, and its `try/catch → return null` structure.

**Return-shape + typeof guard to copy** (`provider.ts:227-288`, key lines 271-284):
```ts
// COST-01: typeof guard rejects string/non-numeric values (T-7-01 tampering mitigation).
const costUsd =
    typeof json.usage.cost === "number" ? json.usage.cost : undefined;

return {
    model: json.model,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    costUsd, // per D-01: provider-returned cost from OpenRouter
};
```

**Base method being overridden** (`base-anthropic-compatible.ts:331-344`) — match this EXACT signature (`protected`, two args `clone: Response, _originalHeaders: Headers`, same return union):
```ts
protected async extractStreamingUsage(
    clone: Response,
    _originalHeaders: Headers,
): Promise<{
    model?: string; promptTokens?: number; completionTokens?: number;
    totalTokens?: number; costUsd?: number; inputTokens?: number;
    cacheReadInputTokens?: number; cacheCreationInputTokens?: number;
    outputTokens?: number;
} | null> {
```

**How the live path reaches it** — OpenRouter's own `extractUsageInfo` delegates the streaming branch to `super` (`provider.ts:243-248`):
```ts
if (this.config.supportsStreaming && contentType?.includes("text/event-stream")) {
    return super.extractUsageInfo(response);   // → base extractUsageInfo → this.extractStreamingUsage(...)
}
```
Because base `extractUsageInfo` calls `this.extractStreamingUsage(...)` (`base-anthropic-compatible.ts:276`), a subclass override is invoked automatically (virtual dispatch). No call-site change needed.

**Single-read body caveat (critical):** `super.extractStreamingUsage` consumes the body via `clone.body?.getReader()` (`base-anthropic-compatible.ts:345`). A `Response` body is single-use. The override MUST `clone.clone()` BEFORE delegating to `super`, then read cost from the independent clone. Per RESEARCH Mechanism (a):
```ts
protected override async extractStreamingUsage(clone, originalHeaders) {
    const costClone = clone.clone();                              // clone BEFORE super consumes the reader
    const base = await super.extractStreamingUsage(clone, originalHeaders);
    if (!base) return base;
    const realCost = await readFinalSseCost(costClone);           // number | undefined
    return typeof realCost === "number" ? { ...base, costUsd: realCost } : base;
}
```

**Where the cost field lives in the SSE stream** — the worker reads it from the `message_delta` event's `parsed.usage.cost` (`post-processor.worker.ts:378-381`). The override's `readFinalSseCost` must look in the same place with the same guard:
```ts
// per D-03 (COST-02): extract OpenRouter provider-returned cost with typeof guard
if (typeof parsed.usage.cost === "number") {
    state.usage.providerCostUsd = parsed.usage.cost;
}
```
Note: the base buffered reader's local `data.usage` type (`base-anthropic-compatible.ts:495-501`) does NOT include `cost` — that is why the base drops it. The override's own buffered read (or a small helper) must parse `usage.cost` itself.

---

### `request.repository.ts` — `|| null` → `?? null` (repository, CRUD write)

**Analog:** the two sibling lines themselves. Change ONLY the cost lines; leave every other `|| null` column untouched (those are token counts where `0` and absent are equivalent — D-03 scopes the change to cost).

**`save()` UPSERT param** (`request.repository.ts:115`, cost column persisted unconditionally via `cost_usd = EXCLUDED.cost_usd` at L87):
```ts
usage?.costUsd || null,    // → usage?.costUsd ?? null
```

**`updateUsage()` param** (`request.repository.ts:158`, written via `cost_usd = COALESCE(?, cost_usd)` at L145):
```ts
usage.costUsd || null,     // → usage.costUsd ?? null
```
Per RESEARCH Open Question 2: switch BOTH (both writers can carry the real OpenRouter value depending on path).

---

### `post-processor.worker.ts` — estimate `0 → undefined` guard (worker, event-driven)

**Analog:** the real-cost branch directly above (`handleEnd()` L676-687). The fix is Strategy B — map estimate `0 → undefined` in the `else` (estimate) branch ONLY, leaving the real-cost branch (`providerCostUsd`, which may legitimately be `0`) untouched. Do NOT touch `base-anthropic-compatible.ts`.

**Current gating** (`post-processor.worker.ts:676-687`):
```ts
if (state.usage.providerCostUsd !== undefined) {
    state.usage.costUsd = state.usage.providerCostUsd;          // real cost — may be 0, persists via ?? null
} else {
    state.usage.costUsd = await estimateCostUSD(state.usage.model, {
        inputTokens: state.usage.inputTokens,
        outputTokens: finalOutputTokens,
        cacheReadInputTokens: state.usage.cacheReadInputTokens,
        cacheCreationInputTokens: state.usage.cacheCreationInputTokens,
    });
}
```
**Change (estimate branch only):** capture the estimate, map `0 → undefined`:
```ts
const est = await estimateCostUSD(state.usage.model, { /* same tokens */ });
state.usage.costUsd = est === 0 ? undefined : est;
```
Rationale: `estimateCostUSD()` returns literal `0` for unknown models (RESEARCH Finding 1, `pricing.ts:802`). Without this guard the new `?? null` would persist estimate-$0 as a literal `0`, reintroducing the "$0 for unknown models" bug (D-04).

**CRITICAL — edit the SOURCE, not the artifact:** edit `post-processor.worker.ts`. NEVER touch `packages/proxy/src/inline-worker.ts` (auto-generated; CLAUDE.md hard rule).

---

### Test: `provider.test.ts` — extend COST suite (test, unit)

**Analog:** the COST-01 non-streaming cases (`provider.test.ts:115-218`): one `it` per cost shape (number, null, absent, `0`, string-guard), each builds a `new Response(JSON.stringify(body), { headers })` and asserts `usage?.costUsd`. Mirror this exactly but for the streaming path — build an SSE byte-stream `Response` with `content-type: text/event-stream` whose final `message_delta` event carries `usage.cost`.

**Pattern to copy** (number + zero + string-guard cases, L116-218):
```ts
it("returns costUsd from usage.cost when it is a number", async () => {
    const provider = new OpenRouterProvider();
    const response = new Response(JSON.stringify(responseBody), {
        headers: { "content-type": "application/json" },   // ← for streaming: "text/event-stream" + SSE body
    });
    const usage = await provider.extractUsageInfo(response);
    expect(usage?.costUsd).toBe(0.0012);
});
```
New streaming cases to add (mirror shapes): cost numeric → extracted; cost `0` → `0` (free model); cost `null`/absent → `undefined` (falls back to base estimate); cost string → `undefined` (typeof guard). SSE body must place `cost` inside the `message_delta` `usage` object (A1 assumption — see RESEARCH).

---

### Test: `sse-parsing.test.ts` / `extract-usage-from-json.test.ts` — extend (test, unit)

**Analog:** the in-test inline `extractUsageFromData` simulation (`sse-parsing.test.ts:60-127`) which already asserts the `typeof parsed.usage.cost === "number"` → `providerCostUsd` extraction (L85-88). Add an explicit estimate-$0 → not-persisted-as-0 case (the D-04 guard) and a non-OpenRouter regression case (no `usage.cost` → estimate runs, no real cost).

**Existing cost-extraction assertion to mirror** (`sse-parsing.test.ts:82-90`):
```ts
if (parsed.usage) {
    state.usage.outputTokens = parsed.usage.output_tokens || 0;
    if (typeof parsed.usage.cost === "number") {
        state.usage.providerCostUsd = parsed.usage.cost;   // assert this in tests
    }
}
```

---

### Test: NEW `request-cost-zero.test.ts` (test, unit) — Wave 0 gap

**Analog:** `__tests__/stats-session-cost.test.ts` — the repository mock-adapter pattern. For a writer test, the mock must capture the params array passed to `run` (not `query`):
```ts
import { describe, expect, it } from "bun:test";
import { RequestRepository } from "../request.repository";

const createRepoCapturingRun = () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const adapter = {
        run: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); },
        query: async () => [],
    };
    return { repo: new RequestRepository(adapter as any), calls };
};
```
Assert a real `costUsd: 0` lands as `0` (not `null`) in the captured params for both `save()` (cost_usd is the 15th positional param, `request.repository.ts:115`) and `updateUsage()` (5th positional after `model/prompt/completion/total`, L158). Confirm the exact `RequestRepository` constructor signature and the base `run` method against `base.repository.ts` when writing the test.

## Shared Patterns

### Provider-controlled numeric guard (V5 Input Validation)
**Source:** `provider.ts:271-274` (non-streaming) and `post-processor.worker.ts:379` (worker SSE).
**Apply to:** every new `usage.cost` read in the streaming override.
```ts
typeof x.cost === "number" ? x.cost : undefined
```
Planner discretion: optionally add `Number.isFinite()` to reject `NaN`/`Infinity`; Phase 7 used `typeof` only — match it for consistency unless stricter is requested.

### Real-vs-estimate cost gating (do NOT redo, extend only)
**Source:** `post-processor.worker.ts:676-687` (Phase 7). The worker is already authoritative. Phase 8's ONLY worker change is the estimate-branch `0 → undefined` map.

### Repository test harness (mock adapter)
**Source:** `__tests__/stats-session-cost.test.ts:5-11`. Inject a fake `{ query, run }` adapter into the repository constructor; assert on captured calls. No real DB needed.

### Dual-writer convergence (architectural, no code change)
**Source:** `save()` (`cost_usd = EXCLUDED`, unconditional, L87) + `updateUsage()` (`cost_usd = COALESCE`, L145). Both run per request, undefined order. D-01 makes both inputs converge on the same real cost — do NOT attempt to order or suppress a writer.

## No Analog Found

None — every change has a same-package (often same-file) analog. The new writer-cost-zero test is the only file without a same-repo predecessor, and `stats-session-cost.test.ts` supplies the harness pattern.

## Constraints (from CLAUDE.md / RESEARCH)

- **NEVER edit** `packages/proxy/src/inline-worker.ts` (auto-generated artifact of `post-processor.worker.ts`). Edit the `.worker.ts` SOURCE only.
- No schema change → **no PostgreSQL migration parity** required this phase.
- `git add <specific-files>` only (never `git add .`).
- Run `bun run lint && bun run typecheck && bun run format` after changes.
- GitNexus `gitnexus_impact` before editing `extractStreamingUsage`, `extractUsageInfo`, `save`, `updateUsage`, `handleEnd`; `gitnexus_detect_changes()` before commit.
- D-05: no live paid OpenRouter calls, never curl Anthropic; verify via `bun:test` + log inspection (forced free model `z-ai/glm-4.5-air:free` via `x-better-ccflare-account-id` if a live check is wanted).

## Metadata

**Analog search scope:** `packages/providers/src/providers/openrouter/`, `base-anthropic-compatible.ts`, `packages/proxy/src/`, `packages/database/src/repositories/`
**Files scanned:** 7 (3 source + 4 test/harness)
**Pattern extraction date:** 2026-05-31
