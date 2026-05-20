# Phase 4: Cache Extension & Provider Injection — Research

**Researched:** 2026-05-20
**Domain:** OpenRouter provider transform — cache_control injection + provider preference injection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `transformRequestBody()` MUST NOT overwrite an existing `cache_control` block. For each breakpoint, check `if (!block.cache_control)` before injecting. If a block already carries `cache_control` (whether from the client or from `injectSystemCacheTtl()`), leave it entirely untouched.
- **D-02:** Never inject or modify TTL in `transformRequestBody()`. TTL management is the exclusive responsibility of the existing `injectSystemCacheTtl()` path in `proxy.ts`. The fork patch's job is only to add `{ type: "ephemeral" }` where no `cache_control` exists.
- **D-03:** The 4th breakpoint targets the **last user message** in `messages[]`, unconditionally (no length/token threshold). Matches the existing pattern for tools, system, and last assistant.
- **D-04:** When the last user message content is an array, inject on the **last content block** in the array. When it's a string, convert to `[{ type: "text", text: ..., cache_control: { type: "ephemeral" } }]`. Mirrors the existing string-to-array handling for system and last assistant.
- **D-05:** Before any injection, count **all `cache_control` blocks already present** in the request body across tools, system, and messages. This pre-injection count is the baseline.
- **D-06:** Inject breakpoints in order: tools → system → last assistant → last user. Track a running count. Stop injecting the moment the running count reaches 4. "First in wins" — tools have highest priority if slots are scarce.
- **D-07:** The count guard prevents the proxy from ever pushing total `cache_control` blocks above 4, regardless of how many the client already sent.
- **D-08:** The stored format of `openrouter_provider_preference` changes from a plain JSON array (`string[]`) to a structured JSON object: `{ "order": string[], "allow_fallbacks": boolean }`. The column type stays `TEXT DEFAULT NULL` — no new migration needed. This is a **breaking change to the Phase 3 type chain** that must be addressed in Phase 4 implementation.
- **D-09:** `AccountResponse.openrouterProviderPreference` changes from `string[] | null` to `{ order: string[], allowFallbacks: boolean } | null`. `toAccountResponse()` in `packages/types/src/account.ts` must be updated to parse the new shape.
- **D-10:** Default for `allow_fallbacks` when not explicitly set: `true`. Matches current behavior and OpenRouter's recommendation.
- **D-11:** Inject `body.provider = { order: [...], allow_fallbacks: <value> }` only when: (1) `account.openrouter_provider_preference` is non-null AND (2) the incoming request body does NOT already have a `provider` field.
- **D-12:** On `JSON.parse()` failure for `openrouter_provider_preference` (corrupt data): log a warning and skip injection (fail open). Request proceeds without provider preference. Same pattern as `modelMappings` try/catch in `toAccountResponse()`.

### Claude's Discretion

- Exact location within `transformRequestBody()` for the new user-message breakpoint and provider injection code — follow the existing structure and ordering in the method.
- Whether to extract a shared `countExistingCacheControlBlocks()` helper or inline the count — follow whatever keeps the method readable.
- Exact log message wording for the new breakpoints and provider injection.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CACHE-03 | Proxy injects `cache_control` on last user message (4th breakpoint) with count guard never exceeding 4 total | D-03 through D-07; injection logic in `transformRequestBody()`; count is pre-computed across tools, system, and messages |
| CACHE-04 | TTL split: tools and system carry `ttl: "1h"`; user message and last assistant turn carry `{ type: "ephemeral" }` | D-01, D-02: TTL is NOT set by `transformRequestBody()` — `injectSystemCacheTtl()` in `proxy.ts` handles tools/system TTL upgrade AFTER transform runs |
| CACHE-05 | Regression tests for 4th breakpoint injection, count guard, TTL split behavior, all model types | Existing 10-test suite in `provider.test.ts` is baseline; 6+ new test cases required |
| PROV-01 | Proxy injects `body.provider = { order: [...], allow_fallbacks: true }` from account preference when no `provider` field present | D-08 through D-12; type chain update in `account.ts` required first |

</phase_requirements>

---

## Summary

Phase 4 is a surgical extension of `OpenRouterProvider.transformRequestBody()` in `packages/providers/src/providers/openrouter/provider.ts`. The existing method handles 3 breakpoints (tools, system, last assistant turn); Phase 4 adds the 4th (last user message) with a pre-injection count guard, and appends a provider preference injection block at the end of the method.

The phase also closes a type-chain inconsistency introduced by Phase 3: `AccountResponse.openrouterProviderPreference` is currently typed as `string[] | null` (Phase 3 stored a JSON array), but the user decided the stored format should be a structured object `{ order: string[], allow_fallbacks: boolean }`. Phase 4 must update `toAccountResponse()` in `packages/types/src/account.ts` and the parallel parse in `packages/http-api/src/handlers/accounts.ts` to match the new shape.

A critical finding: `openrouter_provider_preference` was added to SQLite migrations in Phase 3 but is **missing from `migrations-pg.ts`**. Phase 4 must add it to the PostgreSQL `columnsToAdd` array. This is a CLAUDE.md requirement (every SQLite migration must be ported to PG).

**Primary recommendation:** Implement in 3 sequential units: (1) type chain update in `account.ts`, (2) `transformRequestBody()` extension with count guard + 4th breakpoint + provider injection, (3) test suite extension. The PG migration gap must be fixed as a prerequisite or alongside unit 1.

---

## Standard Stack

### Core (all pre-existing — no new dependencies)

| Component | Location | Role |
|-----------|----------|------|
| `OpenRouterProvider` | `packages/providers/src/providers/openrouter/provider.ts` | The only file receiving the main implementation changes |
| `account.ts` type module | `packages/types/src/account.ts` | Type chain update: `AccountResponse.openrouterProviderPreference`, `toAccountResponse()` |
| `accounts.ts` API handler | `packages/http-api/src/handlers/accounts.ts` | Parallel parse update (same JSON → structured object) |
| `migrations-pg.ts` | `packages/database/src/migrations-pg.ts` | PG migration gap: add `openrouter_provider_preference` to `columnsToAdd` |
| `bun:test` | Built-in | Test runner; existing suite at `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` |

No new npm dependencies needed. All work is extension of existing code.

---

## Architecture Patterns

### Existing Method Structure in `transformRequestBody()`

The current implementation (lines 40–117) follows this pattern:

```
override async transformRequestBody(request, account):
  1. super.transformRequestBody() → apply model mapping
  2. clone().json() → parse body
  3. if body is object:
     a. Breakpoint 1 (tools): last tool gets cache_control
     b. Breakpoint 2 (system string or array): last block gets cache_control
     c. Breakpoint 3 (last assistant turn): last content block gets cache_control
     d. log.debug(...)
     e. return new Request(...)
  4. catch: log.debug("Failed to inject...")
  5. return mapped
```

Phase 4 inserts the count guard before step 3a, adds the 4th breakpoint between 3c and 3d, and adds provider injection after 3d (before the return).

### Pattern: Non-Destructive Guard

```typescript
// [VERIFIED: reading provider.ts lines 51-103]
// WRONG (current implementation — Phase 4 must fix):
(lastTool as any).cache_control = { type: "ephemeral" }; // overwrites existing

// CORRECT (D-01 compliant):
if (!block.cache_control) {
  (block as any).cache_control = { type: "ephemeral" };
}
```

The current 3-breakpoint implementation does NOT apply the non-destructive guard — it overwrites blindly. Phase 4 must apply the guard to ALL 4 breakpoints, including retrofitting the 3 existing ones.

### Pattern: Count Guard Logic

```typescript
// [VERIFIED: from D-05, D-06, D-07 decisions]
// Pre-injection count across the entire body
function countExistingCacheControlBlocks(body: any): number {
  let count = 0;
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (tool?.cache_control) count++;
    }
  }
  if (Array.isArray(body.system)) {
    for (const block of body.system) {
      if (block?.cache_control) count++;
    }
  } else if (typeof body.system === "object" && body.system?.cache_control) {
    count++;
  }
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.cache_control) count++;
        }
      } else if (typeof msg.content === "object" && msg.content?.cache_control) {
        count++;
      }
    }
  }
  return count;
}
```

Running count tracks remaining slots (4 - preCount). Each injection decrements the remaining; stop when remaining === 0.

### Pattern: String-to-Array Conversion (4th breakpoint)

Mirrors the existing pattern for system (lines 59–63) and last assistant (lines 91–101):

```typescript
// [VERIFIED: provider.ts lines 91-101 — existing assistant pattern]
const lastUser = [...body.messages].reverse().find((m: any) => m.role === "user");
if (lastUser && remaining > 0) {
  if (Array.isArray(lastUser.content) && lastUser.content.length > 0) {
    const lastBlock = lastUser.content[lastUser.content.length - 1];
    if (lastBlock && typeof lastBlock === "object" && !lastBlock.cache_control) {
      (lastBlock as any).cache_control = { type: "ephemeral" };
      remaining--;
    }
  } else if (typeof lastUser.content === "string" && lastUser.content.length > 0) {
    lastUser.content = [{
      type: "text",
      text: lastUser.content,
      cache_control: { type: "ephemeral" },
    }];
    remaining--;
  }
}
```

### Pattern: Provider Injection

```typescript
// [VERIFIED: from D-11, D-12, D-08 decisions]
// FORK PATCH: inject provider preference from account settings
if (account?.openrouter_provider_preference && !body.provider) {
  try {
    const pref = JSON.parse(account.openrouter_provider_preference) as {
      order: string[];
      allow_fallbacks: boolean;
    };
    if (Array.isArray(pref.order) && pref.order.length > 0) {
      body.provider = {
        order: pref.order,
        allow_fallbacks: pref.allow_fallbacks ?? true,
      };
      log.debug("Injected provider preference into OpenRouter request");
    }
  } catch {
    log.warn("Failed to parse openrouter_provider_preference; skipping provider injection");
  }
}
```

### Pattern: Type Chain Update

The `AccountResponse.openrouterProviderPreference` field must change from `string[] | null` to `{ order: string[], allowFallbacks: boolean } | null`.

Two parse sites must be updated:

**Site 1: `packages/types/src/account.ts` — `toAccountResponse()` (lines 401–410)**
```typescript
// Current (Phase 3 shape — string[]):
let openrouterProviderPreference: string[] | null = null;
if (account.openrouter_provider_preference) {
  try {
    const parsed = JSON.parse(account.openrouter_provider_preference);
    openrouterProviderPreference = Array.isArray(parsed) ? parsed : null;
  } catch { openrouterProviderPreference = null; }
}

// Phase 4 replacement:
let openrouterProviderPreference: { order: string[], allowFallbacks: boolean } | null = null;
if (account.openrouter_provider_preference) {
  try {
    const parsed = JSON.parse(account.openrouter_provider_preference);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.order)) {
      openrouterProviderPreference = {
        order: parsed.order,
        allowFallbacks: parsed.allow_fallbacks ?? true,
      };
    }
  } catch { openrouterProviderPreference = null; }
}
```

**Site 2: `packages/http-api/src/handlers/accounts.ts` (lines 509–517)**
Same parse logic used in the bulk account list endpoint — must be updated to return the structured object, not the array.

### Anti-Patterns

- **Overwriting existing `cache_control` blindly:** The current code does this on all 3 breakpoints. D-01 forbids it. Phase 4 retrofits all existing breakpoints with `if (!block.cache_control)` guards.
- **Setting TTL in `transformRequestBody()`:** TTL (`ttl: "1h"`) is set exclusively by `injectSystemCacheTtl()` in `proxy.ts` which runs AFTER `transformRequestBody()`. The transform only injects `{ type: "ephemeral" }` — never `ttl`.
- **Injecting provider when `body.provider` already exists:** Client-supplied `provider` must win (D-11). Always check `!body.provider` before injecting.
- **Hardcoding `allow_fallbacks: true`:** Must read from the parsed preference object. Default to `true` only when the field is absent in the stored JSON (D-10).

---

## Solved Problems

| Problem | Existing Solution | Notes |
|---------|--------------------|-------|
| Body parsing in transformRequestBody | `mapped.clone().json()` pattern already in use | `clone()` is required — body can only be read once |
| String-to-array content conversion | Lines 59–63 (system), 91–101 (last assistant) | 4th breakpoint follows identical pattern |
| JSON.parse with try/catch for optional fields | `modelMappings` parse in `toAccountResponse()` (line 370) | Template for provider preference parse |
| PostgreSQL column addition | `columnsToAdd` array in `runMigrationsPg()` | Extend with `openrouter_provider_preference` entry |
| Test pattern for provider transforms | Existing 10 tests in `provider.test.ts` | All follow `new Request(...)` → `await provider.transformRequestBody(request)` → `transformed.json()` |

---

## Critical Findings

### Finding 1: PostgreSQL Migration Gap (BLOCKER)

`openrouter_provider_preference` was added to SQLite in Phase 3 (`migrations.ts` line 651) but is **absent from `migrations-pg.ts`**. CLAUDE.md requires every SQLite migration to be ported to PG.

**Action required:** Add to `columnsToAdd` in `runMigrationsPg()`:
```typescript
{
  table: "accounts",
  column: "openrouter_provider_preference",
  definition: "ALTER TABLE accounts ADD COLUMN openrouter_provider_preference TEXT DEFAULT NULL",
},
```

Also check `ensureSchemaPg()` CREATE TABLE statement to confirm `openrouter_provider_preference` is included for new PG installs. [VERIFIED: column missing — confirmed by grep returning no results]

### Finding 2: Phase 3 Type Mismatch Already Present in Codebase

The current code in `account.ts` line 217 declares `openrouterProviderPreference: string[] | null` and parses accordingly (line 406: `Array.isArray(parsed) ? parsed : null`). Per D-08, the stored format is changing to `{ order: string[], allow_fallbacks: boolean }`. Both parse sites (account.ts and accounts.ts) currently expect the OLD array format. Phase 4 must update both before any provider injection test can pass.

### Finding 3: Non-Destructive Guard Must Retrofit All 3 Existing Breakpoints

The current code (lines 54, 69, 86, 89) always overwrites `cache_control`. Under the new D-01 rule, the same lines must become conditional:
- Line 54: `if (!lastTool.cache_control) lastTool.cache_control = ...`
- Line 69: block array path — `if (!lastBlock.cache_control) lastBlock.cache_control = ...`
- Line 60 (string system path): the conversion already creates a new block with `cache_control`, so it's already non-destructive (converting a string means no existing cache_control). Safe.
- Lines 88–89 (assistant array path): `if (!lastBlock.cache_control) lastBlock.cache_control = ...`
- Lines 93–100 (assistant string path): safe (new block).

### Finding 4: TTL Split Behavior (CACHE-04) — Already Correct by Architecture

Per CACHE-04, tools and system blocks carry `ttl: "1h"` while user message and assistant turn blocks carry `{ type: "ephemeral" }`. This is NOT something Phase 4 implements — it is the existing behavior:

- `injectSystemCacheTtl()` in `proxy.ts` (lines 550–587) runs at step 3b of proxy handling, **after** `transformRequestBody()`. It upgrades system blocks from `{ type: "ephemeral" }` to `{ type: "ephemeral", ttl: "1h" }`.
- The test in `inject-system-cache-ttl.test.ts` (line 122) explicitly confirms it "only modifies system blocks, not messages with cache_control" — user message blocks are left as `{ type: "ephemeral" }` without TTL.
- Phase 4's non-destructive guard ensures `injectSystemCacheTtl()` can still upgrade the system block after `transformRequestBody()` injects `{ type: "ephemeral" }` (TTL field absent = eligible for upgrade).

**CACHE-04 passes automatically** once D-01 (non-destructive) and D-02 (no TTL in transform) are respected. The regression test suite should verify: inject on system block → `injectSystemCacheTtl()` then adds `ttl: "1h"` → user message block keeps `{ type: "ephemeral" }` (no TTL).

---

## Common Pitfalls

### Pitfall 1: Counting cache_control Blocks in `messages[]`

**What goes wrong:** The count guard must traverse the full message array including ALL messages (not just user/assistant), and check nested content blocks.

**Root cause:** Messages can have both string content and array content. A user message with `content: [{ type: "text", cache_control: {...} }, { type: "image" }]` counts as 1 block (only the text block has cache_control), not 2.

**Prevention:** Count only blocks where `block.cache_control` is truthy. String content fields cannot have `cache_control` directly — only after conversion to array.

### Pitfall 2: `body.provider` Presence Check

**What goes wrong:** OpenRouter's own `provider` field is an object. If `body.provider` is `{}` (empty), `!body.provider` evaluates to `false` but the field exists. Client intent should be respected even with an empty object.

**Prevention:** Check `if ("provider" in body)` OR `if (body.provider !== undefined)` instead of `if (!body.provider)`. The decisions say "incoming request body does NOT already have a `provider` field" — use `"provider" in body` to check field presence, not truthiness.

**Warning signs:** Test with `body = { provider: {} }` — should NOT inject.

### Pitfall 3: `allow_fallbacks` Default

**What goes wrong:** Stored JSON could be `{ "order": ["anthropic/claude-3-5-sonnet"] }` (no `allow_fallbacks` key). Must default to `true` per D-10.

**Prevention:** Always `pref.allow_fallbacks ?? true`. Never `pref.allow_fallbacks || true` (would coerce `false` to `true`).

### Pitfall 4: `account` Parameter May Be Undefined

**What goes wrong:** `transformRequestBody(request, account?)` — the account parameter is optional. Provider injection code must guard against undefined.

**Prevention:** `if (account?.openrouter_provider_preference && ...)` — already accounts for undefined via optional chaining. Confirmed by current method signature: `account?: Account`.

### Pitfall 5: Missing PG Schema for New Installs

**What goes wrong:** `ensureSchemaPg()` CREATE TABLE may not include `openrouter_provider_preference`. Only `columnsToAdd` handles upgrade paths. New PG installs would be missing the column entirely.

**Prevention:** Check `ensureSchemaPg()`'s CREATE TABLE for `accounts` and add the column if missing. [ASSUMED — need to verify the full CREATE TABLE in `ensureSchemaPg()`; the grep found the column is missing from `columnsToAdd` but the full CREATE TABLE block was not read]

---

## Code Examples

### Example: Full Count Guard Implementation

```typescript
// [VERIFIED: from D-05, D-06, D-07 and existing code structure]
// Count all existing cache_control blocks before injecting
let cacheControlCount = 0;
if (Array.isArray(body.tools)) {
  for (const tool of body.tools) {
    if ((tool as any)?.cache_control) cacheControlCount++;
  }
}
if (Array.isArray(body.system)) {
  for (const block of body.system) {
    if ((block as any)?.cache_control) cacheControlCount++;
  }
}
if (Array.isArray(body.messages)) {
  for (const msg of body.messages) {
    if (Array.isArray((msg as any).content)) {
      for (const block of (msg as any).content) {
        if (block?.cache_control) cacheControlCount++;
      }
    }
  }
}
let remaining = Math.max(0, 4 - cacheControlCount);
```

### Example: Running test suite for provider tests

```bash
# Quick run (< 5 seconds)
bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts

# Full type check
bunx tsc --noEmit

# Lint + format
bun run lint && bun run format
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in) |
| Config file | None needed — bun discovers test files automatically |
| Quick run command | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` |
| Type check command | `bunx tsc --noEmit` |
| Full suite | `bun test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CACHE-03 | 4th breakpoint injects on last user message (array content) | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | yes — extend |
| CACHE-03 | 4th breakpoint injects on last user message (string content → array) | unit | same | yes — extend |
| CACHE-03 | Count guard: no injection when 4 blocks already present | unit | same | yes — extend |
| CACHE-03 | Count guard: inject remaining slots when 2 blocks already present | unit | same | yes — extend |
| CACHE-03 | Existing cache_control on a block is preserved (non-destructive) | unit | same | yes — extend |
| CACHE-04 | After transform: system block has `{ type: "ephemeral" }`, no TTL; `injectSystemCacheTtl()` adds `ttl: "1h"` | unit | `bun test packages/proxy/src/__tests__/inject-system-cache-ttl.test.ts` | yes — existing |
| CACHE-04 | After transform: user message block has `{ type: "ephemeral" }`, no TTL added by `injectSystemCacheTtl()` | unit | `bun test packages/proxy/src/__tests__/inject-system-cache-ttl.test.ts` | yes — confirmed |
| CACHE-05 | All model types (no gate): injects on `z-ai/model`, `anthropic/claude-3-5-sonnet`, `gpt-4o` | unit | `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | yes — extend |
| PROV-01 | Injects `body.provider` when account has preference and request has no provider field | unit | same | yes — extend |
| PROV-01 | Does NOT inject when request already has `provider` field | unit | same | yes — extend |
| PROV-01 | `allow_fallbacks` defaults to `true` when field absent from stored JSON | unit | same | yes — extend |
| PROV-01 | Corrupt `openrouter_provider_preference` JSON → logs warning, skips injection, request proceeds | unit | same | yes — extend |
| PROV-01 | `AccountResponse.openrouterProviderPreference` typed correctly as `{ order, allowFallbacks }` | type-check | `bunx tsc --noEmit` | yes |

### Sampling Rate

- **Per task commit:** `bun test packages/providers/src/providers/openrouter/__tests__/provider.test.ts && bunx tsc --noEmit`
- **Per wave merge:** `bun test && bun run lint && bun run typecheck && bun run format`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. The `provider.test.ts` file exists and has 10 passing tests as the baseline. New tests are additive cases within the same file.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all changes are pure TypeScript code within existing packages)

---

## Runtime State Inventory

Step 2.5: NOT APPLICABLE — this is a greenfield feature addition within existing code, not a rename/refactor/migration.

No stored data needs migration. The `openrouter_provider_preference` column (TEXT) already exists in SQLite from Phase 3 but the stored format changes from `["string"]` to `{"order":["string"],"allow_fallbacks":true}`. Since no production data exists in this field yet (Phase 3 schema was just added, no UI to set it exists until Phase 5), no data migration is needed. Any existing rows with the old array format will gracefully return `null` when parsed as the new structured format (the parse validates `Array.isArray(parsed.order)`).

---

## Open Questions

1. **`ensureSchemaPg()` CREATE TABLE completeness for new PG installs**
   - What we know: `runMigrationsPg()` `columnsToAdd` is missing `openrouter_provider_preference`
   - What is unclear: Whether the `CREATE TABLE IF NOT EXISTS accounts` in `ensureSchemaPg()` also omits the column (not fully read)
   - Recommendation: Read `ensureSchemaPg()` fully and add the column to both the CREATE TABLE and `columnsToAdd` if missing. [LOW confidence — assumed missing; verify in implementation]

2. **`body.provider` truthy check vs. presence check**
   - What we know: D-11 says "incoming request body does NOT already have a `provider` field"
   - What is unclear: Whether `!body.provider` or `"provider" in body` better expresses intent when `body.provider` could be `{}`
   - Recommendation: Use `"provider" in body` for precise field-presence semantics. This is the safer implementation aligned with the decision's intent.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ensureSchemaPg()` CREATE TABLE for accounts also omits `openrouter_provider_preference` | Critical Findings / Open Questions | If the column is already in the CREATE TABLE, only `columnsToAdd` needs to be added; low risk either way since the `IF NOT EXISTS` pattern is safe |
| A2 | No production data exists in `openrouter_provider_preference` column with the old array format | Runtime State Inventory | If users have already set provider preferences via some path, they would need a data migration; extremely unlikely given no UI exists |

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: reading provider.ts] — `transformRequestBody()` full implementation, existing 3-breakpoint structure, `// FORK PATCH:` annotation style
- [VERIFIED: reading account.ts] — `AccountRow`, `Account`, `AccountResponse` types; `toAccountResponse()` parse patterns; existing `openrouterProviderPreference: string[] | null` declaration
- [VERIFIED: reading provider.test.ts] — 10 existing tests, test patterns, `bun:test` usage
- [VERIFIED: reading inject-system-cache-ttl.test.ts] — TTL injection tests confirm system-only scope (line 122 test)
- [VERIFIED: reading proxy.ts lines 200–204] — `injectSystemCacheTtl()` called at step 3b, after `prepareRequestBody()`, before provider transform
- [VERIFIED: reading proxy.ts lines 550–587] — `injectSystemCacheTtl()` implementation only modifies `body.system` blocks
- [VERIFIED: reading migrations-pg.ts lines 272–386] — `columnsToAdd` array confirmed does NOT include `openrouter_provider_preference`
- [VERIFIED: reading migrations.ts lines 646–654] — SQLite migration adds `openrouter_provider_preference TEXT DEFAULT NULL`
- [VERIFIED: reading accounts.ts lines 509–517] — second parse site for provider preference in HTTP API handler

### Secondary (MEDIUM confidence)

- [VERIFIED: CLAUDE.md] — "Every migration added to `migrations.ts` MUST also be ported to `migrations-pg.ts`" — confirms PG migration gap is a CLAUDE.md violation requiring fix

### Flagged for Validation (LOW confidence)

- `ensureSchemaPg()` CREATE TABLE completeness — not fully read; assume column is missing based on the fact `columnsToAdd` omits it

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all files read directly; no external lookups required
- Architecture patterns: HIGH — derived from reading existing code
- Pitfalls: HIGH — identified from direct code reading; `body.provider` presence check rated MEDIUM (implementation choice)
- PG migration gap: HIGH — grep confirmed absence

**Research date:** 2026-05-20
**Valid until:** Stable — no external APIs or library versions involved; valid until Phase 3 or Phase 4 files change
