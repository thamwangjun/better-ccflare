# Phase 4: Cache Extension & Provider Injection - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 4-cache-extension-provider-injection
**Areas discussed:** 4th breakpoint eligibility, TTL coordination, Count guard scope, Provider injection edge cases

---

## 4th Breakpoint Eligibility

| Option | Description | Selected |
|--------|-------------|----------|
| Unconditional — last user message always gets it | Matches existing pattern for tools/system/last assistant. Simplest. | ✓ |
| Only if content length exceeds a threshold | Requires picking a threshold; avoids cache_control on tiny messages. | |
| Only if there are 3+ messages in the conversation | Skip on early turns, inject once conversation has depth. | |

**User's choice:** Unconditional — last user message always gets the 4th breakpoint.
**Notes:** Matches the no-gate philosophy from v1.0 (no model-prefix gate, no length threshold).

When content is an array: inject on the **last content block** (mirrors existing system and assistant handling). When content is a string: convert to array with `cache_control` inline.

---

## TTL Coordination

| Option | Description | Selected |
|--------|-------------|----------|
| transformRequestBody() writes {type: 'ephemeral', ttl: '1h'} directly for tools/system | Takes TTL ownership in the fork patch. injectSystemCacheTtl() becomes supplementary. | |
| Run injectSystemCacheTtl() after transformRequestBody() | Reverse order, post-processes all injected blocks. Structural change to proxy.ts. | |
| Extend injectSystemCacheTtl() to cover tools blocks | Single TTL pass, same ordering risk. | |
| Non-destructive: only inject if cache_control absent (user-clarified) | Don't add TTL at all. Don't overwrite existing cache_control. Let injectSystemCacheTtl() handle TTL on pre-existing blocks. | ✓ |

**User's choice:** Non-destructive injection — `transformRequestBody()` only adds `{ type: "ephemeral" }` when a block has **no** `cache_control` at all. Never overwrite. Never set TTL.
**Notes:** Mid-discussion the user stopped to investigate `injectSystemCacheTtl()` behavior. Found: it only operates on pre-existing array system blocks with `cache_control.type === "ephemeral"` and no TTL. It's also gated on the `SYSTEM_PROMPT_CACHE_TTL_1H` env var. The correct design is non-destructive: the fork patch never conflicts with TTL injection because it only touches blocks that have no `cache_control` at all.

---

## Count Guard Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All cache_control blocks already in the request (before injection) | Count pre-existing blocks across tools, system, messages. Inject tools-first until total reaches 4. | ✓ |
| Only blocks we add ourselves | Ignore client-supplied blocks. Risk: could push total above 4. | |

**User's choice:** Count all pre-existing `cache_control` blocks as the baseline. Inject in tools → system → last assistant → last user order (tools-first = highest cache value). Stop when running total reaches 4.
**Notes:** "First in wins" — tools have priority when slots are scarce. This ensures the proxy never pushes total above 4 regardless of client-supplied blocks.

---

## Provider Injection Edge Cases

| Option | Description | Selected |
|--------|-------------|----------|
| Fail open on JSON.parse error | Log warning, skip injection, request proceeds. Matches modelMappings pattern. | ✓ |
| Throw and surface error to client | Hard fail on corrupt account config. | |

**User's choice:** Fail open.
**Notes:** User also introduced new scope during this discussion: `allow_fallbacks` should be **user-configurable** (not hardcoded `true`), and the UI should expose a toggle for it (Phase 6 concern). This changes the stored format from `string[]` to `{ order: string[], allow_fallbacks: boolean }`.

Stored format decision:

| Option | Description | Selected |
|--------|-------------|----------|
| JSON object: { order: string[], allow_fallbacks: boolean } | Single column, structured. No new migration (column already TEXT). Type layer handles shape change. | ✓ |
| Separate openrouter_allow_fallbacks column | Cleaner schema but requires additional DB migration on top of Phase 3. | |

Default for `allow_fallbacks`: `true` (matches current behavior and OpenRouter recommendation).

---

## Claude's Discretion

- Exact location of new code blocks within `transformRequestBody()` — follow existing structure
- Whether to extract a `countExistingCacheControlBlocks()` helper or inline — whatever keeps the method readable
- Log message wording for new breakpoints and provider injection

## Deferred Ideas

None — discussion stayed within phase scope. (Dashboard UI for `allow_fallbacks` toggle is Phase 6 scope and was noted there.)
