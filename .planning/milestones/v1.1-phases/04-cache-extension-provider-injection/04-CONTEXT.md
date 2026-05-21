# Phase 4: Cache Extension & Provider Injection - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend `OpenRouterProvider.transformRequestBody()` to (1) inject `cache_control: { type: "ephemeral" }` on up to 4 breakpoints using a non-destructive, count-guarded approach, and (2) inject `provider.order` + `allow_fallbacks` from the account's stored preference when the request doesn't already carry a `provider` field. Also update the Phase 3 type chain to accommodate the richer `openrouter_provider_preference` schema. All changes annotated with `// FORK PATCH:` and covered by extended regression tests (CACHE-05).

No API endpoint changes (Phase 5). No dashboard UI (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Cache Injection — Non-Destructive Rule

- **D-01:** `transformRequestBody()` MUST NOT overwrite an existing `cache_control` block. For each breakpoint, check `if (!block.cache_control)` before injecting. If a block already carries `cache_control` (whether from the client or from `injectSystemCacheTtl()`), leave it entirely untouched.
- **D-02:** Never inject or modify TTL in `transformRequestBody()`. TTL management is the exclusive responsibility of the existing `injectSystemCacheTtl()` path in `proxy.ts`. The fork patch's job is only to add `{ type: "ephemeral" }` where no `cache_control` exists.

### 4th Breakpoint — Last User Message

- **D-03:** The 4th breakpoint targets the **last user message** in `messages[]`, unconditionally (no length/token threshold). Matches the existing pattern for tools, system, and last assistant.
- **D-04:** When the last user message content is an array, inject on the **last content block** in the array. When it's a string, convert to `[{ type: "text", text: ..., cache_control: { type: "ephemeral" } }]`. Mirrors the existing string-to-array handling for system and last assistant.

### Count Guard

- **D-05:** Before any injection, count **all `cache_control` blocks already present** in the request body across tools, system, and messages. This pre-injection count is the baseline.
- **D-06:** Inject breakpoints in order: tools → system → last assistant → last user. Track a running count. Stop injecting the moment the running count reaches 4. "First in wins" — tools have highest priority if slots are scarce.
- **D-07:** The count guard prevents the proxy from ever pushing total `cache_control` blocks above 4, regardless of how many the client already sent.

### Provider Preference — Stored Format (Phase 3 Type Update Required)

- **D-08:** The stored format of `openrouter_provider_preference` changes from a plain JSON array (`string[]`) to a structured JSON object: `{ "order": string[], "allow_fallbacks": boolean }`. The column type stays `TEXT DEFAULT NULL` — no new migration needed. This is a **breaking change to the Phase 3 type chain** that must be addressed in Phase 4 implementation.
- **D-09:** `AccountResponse.openrouterProviderPreference` changes from `string[] | null` to `{ order: string[], allowFallbacks: boolean } | null`. `toAccountResponse()` in `packages/types/src/account.ts` must be updated to parse the new shape.
- **D-10:** Default for `allow_fallbacks` when not explicitly set: `true`. Matches current behavior and OpenRouter's recommendation.

### Provider Injection — Behavior

- **D-11:** Inject `body.provider = { order: [...], allow_fallbacks: <value> }` only when:
  1. `account.openrouter_provider_preference` is non-null, AND
  2. The incoming request body does NOT already have a `provider` field (client-supplied wins).
- **D-12:** On `JSON.parse()` failure for `openrouter_provider_preference` (corrupt data): log a warning and skip injection (fail open). Request proceeds without provider preference. Same pattern as `modelMappings` try/catch in `toAccountResponse()`.

### Claude's Discretion

- Exact location within `transformRequestBody()` for the new user-message breakpoint and provider injection code — follow the existing structure and ordering in the method.
- Whether to extract a shared `countExistingCacheControlBlocks()` helper or inline the count — follow whatever keeps the method readable.
- Exact log message wording for the new breakpoints and provider injection.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` §CACHE-03, CACHE-04, CACHE-05 — Cache breakpoint and TTL requirements for Phase 4
- `.planning/REQUIREMENTS.md` §PROV-01 — Provider injection requirement (note: `allow_fallbacks` is now user-configurable per D-10, not hardcoded `true`)

### Phase 3 Type Chain (must be updated in Phase 4)

- `packages/types/src/account.ts` — Contains `AccountRow`, `Account`, `AccountResponse`, `toAccount()`, `toAccountResponse()`. `openrouterProviderPreference` shape changes from `string[] | null` to `{ order: string[], allowFallbacks: boolean } | null`.
- `packages/database/src/repositories/account.repository.ts` — Stored value is TEXT; the object is serialized/deserialized in the type layer, not the repository.

### Existing Cache Injection (fork patch baseline)

- `packages/providers/src/providers/openrouter/provider.ts` — Current `transformRequestBody()` with 3-breakpoint injection. Phase 4 extends this method with the 4th breakpoint (last user message) and non-destructive guard, and adds provider injection.
- `packages/proxy/src/proxy.ts` — `injectSystemCacheTtl()` and the call site at step 3b. **Do NOT change this function or its call order.** Phase 4's non-destructive injection rule ensures no conflict.
- `packages/proxy/src/__tests__/inject-system-cache-ttl.test.ts` — Reference test for TTL injection behavior.

### Existing Tests (regression baseline)

- `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` — 10-test regression suite. Phase 4 extends this with cases for: 4th breakpoint injection, count guard, non-destructive behavior (existing `cache_control` preserved), and provider injection.

### Fork Patch Convention

- `.planning/PROJECT.md` §Key Decisions — `// FORK PATCH:` annotation requirement
- `packages/providers/src/providers/openrouter/provider.ts` — Reference for existing annotation style

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `OpenRouterProvider.transformRequestBody()` in `packages/providers/src/providers/openrouter/provider.ts` — The existing 3-breakpoint implementation is the direct template. Phase 4 adds the 4th breakpoint and count guard within this method, and appends the provider injection block at the end.
- `toAccountResponse()` in `packages/types/src/account.ts` — The `modelMappings` try/catch JSON.parse pattern is the exact template for `openrouterProviderPreference` parsing. Update the parsed type shape from `string[]` to `{ order: string[], allowFallbacks: boolean }`.

### Established Patterns

- **Non-destructive guard:** Check `if (!block.cache_control)` before setting. Never `block.cache_control = ...` unconditionally.
- **String-to-array conversion:** When a content field is a string, convert to `[{ type: "text", text: ..., cache_control: ... }]` — existing pattern in the system block handler.
- **Try/catch on JSON parse:** Wrap `JSON.parse(account.openrouter_provider_preference)` in try/catch; on error, log debug and skip (same as `modelMappings`).
- **`// FORK PATCH:` annotation:** Goes on the line directly before the fork-specific code block.

### Integration Points

- `account.openrouter_provider_preference` (the `string | null` field on `Account`) is available via the `account` parameter passed to `transformRequestBody(request, account)`. Phase 4 reads it directly here.
- The count guard operates entirely within `transformRequestBody()` — no changes to proxy.ts, proxy-operations.ts, or the call stack above.
- `AccountResponse.openrouterProviderPreference` shape change may affect Phase 5 (API handler serialization) and Phase 6 (dashboard display) — note this dependency.

</code_context>

<specifics>
## Specific Ideas

- `allow_fallbacks` is user-configurable (true/false), not hardcoded. The stored JSON object carries it: `{ "order": ["anthropic/claude-3-5-sonnet"], "allow_fallbacks": true }`.
- UI will expose a toggle for `allow_fallbacks` alongside the provider order input (Phase 6 concern — noted here for Phase 5/6 awareness).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 4-Cache Extension & Provider Injection*
*Context gathered: 2026-05-20*
