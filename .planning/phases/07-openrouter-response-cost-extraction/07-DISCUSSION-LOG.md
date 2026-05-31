# Phase 7: OpenRouter Response Cost Extraction - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 07-openrouter-response-cost-extraction
**Areas discussed:** Provider extractUsageInfo() (COST-01), Worker SSE streaming path (COST-02), Worker non-streaming body (COST-03), Cost data threading

---

## Provider extractUsageInfo() (COST-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Direct field read | Read `json.usage.cost` directly in the existing override at openrouter/provider.ts:227 — minimal change, same pattern as existing token parsing | ✓ |
| Shared cost helper | Extract a shared utility used by both the provider and worker — more abstraction but adds a file for a single field | |
| Delegate to base class | Let AnthropicCompatibleProvider handle it — OpenRouter JSON has `usage.cost` in standard OpenAI format | |

**User's choice:** Direct field read (Recommended)
**Notes:** OpenRouter-only — do NOT add `usage.cost` reading to the base class. The override pattern is already established.

---

## Worker SSE streaming path (COST-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Stash in new state field | Parse `usage.cost` from `message_delta` event, stash in `providerCostUsd` state field, skip estimate when set | ✓ |
| message_stop event handler | Parse cost from `message_stop` event type — separate from token-counting path | |
| Last-event cost capture | Read cost from the final SSE line or last `message_delta` with cost field | |

**User's choice:** Stash in new state field (Recommended)
**Notes:** New `providerCostUsd` field on `RequestState.usage` — avoids shadowing existing `costUsd` (which holds the final value after estimate).

---

## Worker non-streaming body (COST-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Extend extractUsageFromJson() | Extend the existing function to also read `usage.cost` — one function, same pattern as existing token field reads | ✓ |
| Separate cost extraction step | Add a separate extraction step after extractUsageFromJson() in handleEnd() | |

**User's choice:** Extend extractUsageFromJson() (Recommended)
**Notes:** Add `cost` to the JSON type annotation for TypeScript correctness.

---

## Cost data threading

| Option | Description | Selected |
|--------|-------------|----------|
| Conditionally skip estimate | Only skip estimateCostUSD() when provider-returned costUsd is present (> 0 or explicit 0). Non-OpenRouter providers continue using estimates. | ✓ |
| Always use provider cost if present | Use provider cost unconditionally — simpler but risky for non-OpenRouter providers | |
| Gate on OpenRouter provider only | Only use provider cost for 'openrouter' accounts — safest but adds provider check in generic worker path | |

**User's choice:** Conditionally skip estimate (Recommended)
**Notes:** The actual gating logic is Phase 8 scope, but the field plumbing must be in place in Phase 7. The three capture points all write to the same conceptual field.

---

## Claude's Discretion

- Exact field name: `providerCostUsd` vs `costUsd` on the worker state — pick whichever avoids shadowing the existing `costUsd`
- Whether to add `cost` to the `extractUsageFromJson` JSON type annotation — yes