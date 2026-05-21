# Phase 4: Cache Extension & Provider Injection - Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 5
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/providers/src/providers/openrouter/provider.ts` | provider transform | request-response | self (extending existing method) | exact |
| `packages/types/src/account.ts` | type/transform | transform | self (extending existing parse) | exact |
| `packages/http-api/src/handlers/accounts.ts` | handler | request-response | self (parallel parse site) | exact |
| `packages/database/src/migrations-pg.ts` | migration | config | self (columnsToAdd pattern) | exact |
| `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` | test | batch | self (extending existing suite) | exact |

---

## Pattern Assignments

### `packages/providers/src/providers/openrouter/provider.ts` (provider transform, request-response)

**Analog:** Self — extending the existing `transformRequestBody()` method in the same file.

**Imports pattern** (lines 1–7):
```typescript
import { Logger } from "@better-ccflare/logger";
import type { Account } from "@better-ccflare/types";
import { AnthropicCompatibleProvider } from "../anthropic-compatible/provider";

const log = new Logger("OpenRouterProvider");
```

**Core method structure** (lines 39–117 — full current method, shown as the template):
```typescript
// FORK PATCH: 3-breakpoint cache_control injection (tools, system, last assistant turn)
override async transformRequestBody(
	request: Request,
	account?: Account,
): Promise<Request> {
	// First apply model mapping from parent
	const mapped = await super.transformRequestBody(request, account);

	try {
		const body = await mapped.clone().json();
		if (body && typeof body === "object") {
			// Breakpoint 1: last tool in tools[] (most stable — invalidates everything below)
			if (Array.isArray(body.tools) && body.tools.length > 0) {
				const lastTool = body.tools[body.tools.length - 1];
				if (lastTool && typeof lastTool === "object") {
					(lastTool as any).cache_control = { type: "ephemeral" };
				}
			}

			// Breakpoint 2: last content block in system (or convert string to array)
			if (typeof body.system === "string" && body.system.length > 0) {
				body.system = [
					{
						type: "text",
						text: body.system,
						cache_control: { type: "ephemeral" },
					},
				];
			} else if (Array.isArray(body.system) && body.system.length > 0) {
				const lastBlock = body.system[body.system.length - 1];
				if (lastBlock && typeof lastBlock === "object") {
					(lastBlock as any).cache_control = { type: "ephemeral" };
				}
			}

			// Breakpoint 3: last content block of last assistant turn in messages[]
			if (Array.isArray(body.messages)) {
				const lastAssistant = [...body.messages]
					.reverse()
					.find((m: any) => m.role === "assistant");
				if (lastAssistant) {
					if (
						Array.isArray(lastAssistant.content) &&
						lastAssistant.content.length > 0
					) {
						const lastBlock =
							lastAssistant.content[lastAssistant.content.length - 1];
						if (lastBlock && typeof lastBlock === "object") {
							(lastBlock as any).cache_control = { type: "ephemeral" };
						}
					} else if (
						typeof lastAssistant.content === "string" &&
						lastAssistant.content.length > 0
					) {
						lastAssistant.content = [
							{
								type: "text",
								text: lastAssistant.content,
								cache_control: { type: "ephemeral" },
							},
						];
					}
				}
			}

			log.debug("Injected cache_control breakpoints into OpenRouter request");
			return new Request(mapped.url, {
				method: mapped.method,
				headers: mapped.headers,
				body: JSON.stringify(body),
			});
		}
	} catch (error) {
		log.debug("Failed to inject cache_control:", error);
	}

	return mapped;
}
```

**Phase 4 changes to apply to this method:**

1. **Count guard — insert before Breakpoint 1** (replaces unconditional injection with slot-aware injection):
```typescript
// FORK PATCH: pre-count existing cache_control blocks (D-05)
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

2. **Non-destructive guard — retrofit all 3 existing breakpoints** (lines 53–54, 69–70, 87–89):
```typescript
// Pattern: wrap all direct cache_control assignments with:
if (!(block as any).cache_control) {
	(block as any).cache_control = { type: "ephemeral" };
	remaining--;
}
// AND guard each injection with: if (remaining > 0)
```

3. **4th breakpoint — insert after Breakpoint 3, before log.debug** (mirrors Breakpoint 3 pattern):
```typescript
// FORK PATCH: Breakpoint 4 — last user message (D-03, D-04)
if (Array.isArray(body.messages) && remaining > 0) {
	const lastUser = [...body.messages]
		.reverse()
		.find((m: any) => m.role === "user");
	if (lastUser && remaining > 0) {
		if (
			Array.isArray(lastUser.content) &&
			lastUser.content.length > 0
		) {
			const lastBlock = lastUser.content[lastUser.content.length - 1];
			if (lastBlock && typeof lastBlock === "object" && !lastBlock.cache_control) {
				(lastBlock as any).cache_control = { type: "ephemeral" };
				remaining--;
			}
		} else if (
			typeof lastUser.content === "string" &&
			lastUser.content.length > 0
		) {
			lastUser.content = [
				{
					type: "text",
					text: lastUser.content,
					cache_control: { type: "ephemeral" },
				},
			];
			remaining--;
		}
	}
}
```

4. **Provider injection — insert after log.debug, before the return** (D-11, D-12):
```typescript
// FORK PATCH: inject provider preference from account settings (PROV-01)
if (account?.openrouter_provider_preference && !("provider" in body)) {
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

**Error handling pattern** (lines 112–114 — existing catch block, unchanged):
```typescript
} catch (error) {
	log.debug("Failed to inject cache_control:", error);
}
```

**Body reconstruction pattern** (lines 106–110 — must preserve after all mutations):
```typescript
return new Request(mapped.url, {
	method: mapped.method,
	headers: mapped.headers,
	body: JSON.stringify(body),
});
```

---

### `packages/types/src/account.ts` (type/transform)

**Analog:** Self — the existing `modelMappings` try/catch pattern at lines 367–388 is the exact template. The `openrouterProviderPreference` parse at lines 401–410 must be updated.

**Template pattern — modelMappings JSON.parse** (lines 367–388):
```typescript
// Parse model mappings (supported for any provider)
let modelMappings: { [key: string]: string } | null = null;
if (account.model_mappings) {
	try {
		const parsed = JSON.parse(account.model_mappings);
		// Stored as flat {"model": "target"} object
		modelMappings =
			typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		// If parsing fails, ignore model mappings
		modelMappings = null;
	}
}
```

**Current openrouterProviderPreference parse (lines 401–410 — to be replaced):**
```typescript
// FORK PATCH: parse openrouter_provider_preference JSON string to string[]
let openrouterProviderPreference: string[] | null = null;
if (account.openrouter_provider_preference) {
	try {
		const parsed = JSON.parse(account.openrouter_provider_preference);
		openrouterProviderPreference = Array.isArray(parsed) ? parsed : null;
	} catch {
		openrouterProviderPreference = null;
	}
}
```

**Phase 4 replacement (D-08, D-09, D-10):**
```typescript
// FORK PATCH: parse openrouter_provider_preference JSON string to structured object
let openrouterProviderPreference: { order: string[]; allowFallbacks: boolean } | null = null;
if (account.openrouter_provider_preference) {
	try {
		const parsed = JSON.parse(account.openrouter_provider_preference);
		if (parsed && typeof parsed === "object" && Array.isArray(parsed.order)) {
			openrouterProviderPreference = {
				order: parsed.order,
				allowFallbacks: parsed.allow_fallbacks ?? true,
			};
		}
	} catch {
		openrouterProviderPreference = null;
	}
}
```

**AccountResponse interface field (line 217 — to be updated):**
```typescript
// Current:
openrouterProviderPreference: string[] | null;

// Phase 4 replacement:
openrouterProviderPreference: { order: string[]; allowFallbacks: boolean } | null;
```

---

### `packages/http-api/src/handlers/accounts.ts` (handler, request-response)

**Analog:** Self — the IIFE parse at lines 509–517 is a parallel parse site that must mirror the type change.

**Current parse site (lines 508–517 — to be replaced):**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouterProviderPreference: (() => {
	if (!account.openrouter_provider_preference) return null;
	try {
		const parsed = JSON.parse(account.openrouter_provider_preference);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
})(),
```

**Phase 4 replacement (same IIFE pattern, updated shape):**
```typescript
// FORK PATCH: JSON string for OpenRouter provider.order preference
openrouterProviderPreference: (() => {
	if (!account.openrouter_provider_preference) return null;
	try {
		const parsed = JSON.parse(account.openrouter_provider_preference);
		if (parsed && typeof parsed === "object" && Array.isArray(parsed.order)) {
			return {
				order: parsed.order,
				allowFallbacks: parsed.allow_fallbacks ?? true,
			};
		}
		return null;
	} catch {
		return null;
	}
})(),
```

---

### `packages/database/src/migrations-pg.ts` (migration, config)

**Analog:** Self — the `columnsToAdd` array pattern at lines 272–386 and `ensureSchemaPg()` CREATE TABLE at lines 44–79.

**columnsToAdd entry pattern** (example from lines 296–298):
```typescript
{
	table: "accounts",
	column: "model_fallbacks",
	definition: "ALTER TABLE accounts ADD COLUMN model_fallbacks TEXT",
},
```

**Phase 4 addition — append to columnsToAdd array (before line 386 closing `]`):**
```typescript
{
	table: "accounts",
	column: "openrouter_provider_preference",
	definition: "ALTER TABLE accounts ADD COLUMN openrouter_provider_preference TEXT DEFAULT NULL",
},
```

**ensureSchemaPg() CREATE TABLE accounts** (lines 44–79 — confirmed missing column):

The `openrouter_provider_preference` column is absent from the CREATE TABLE for new PG installs. Add before the closing `)` of the accounts CREATE TABLE:
```typescript
openrouter_provider_preference TEXT DEFAULT NULL
```

Full position context — add after `rate_limited_at BIGINT` (line 77), before `)` (line 78):
```typescript
rate_limited_at BIGINT,
openrouter_provider_preference TEXT DEFAULT NULL
```

---

### `packages/providers/src/providers/openrouter/__tests__/provider.test.ts` (test, batch)

**Analog:** Self — extend the existing `describe("OpenRouterProvider.transformRequestBody")` block (currently lines 95–240). The 10 existing tests are the regression baseline.

**Test structure pattern** (lines 95–118 — template for new tests):
```typescript
it("injects cache_control on the last tool when tools array is present", async () => {
	const provider = new OpenRouterProvider();
	const body = {
		model: "anthropic/claude-sonnet-4-6",
		tools: [{ name: "tool_a" }, { name: "tool_b" }],
		messages: [{ role: "user", content: "hello" }],
		max_tokens: 10,
	};
	const request = new Request("https://openrouter.ai/api/v1/messages", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	const transformed = await provider.transformRequestBody(request);
	const result = await transformed.json();

	expect(result.tools[result.tools.length - 1].cache_control).toEqual({
		type: "ephemeral",
	});
});
```

**Account fixture pattern** (needed for provider injection tests — no existing example, construct inline):
```typescript
// Inline account fixture for PROV-01 tests
const account = {
	openrouter_provider_preference: JSON.stringify({
		order: ["anthropic/claude-3-5-sonnet"],
		allow_fallbacks: true,
	}),
} as any; // Cast to Account — only openrouter_provider_preference matters for these tests

const transformed = await provider.transformRequestBody(request, account);
```

**Section divider pattern** (line 91 — use for new test groups):
```typescript
// ─────────────────────────────────────────────────────────────────────────────
// transformRequestBody — CACHE-03: 4th breakpoint + count guard
// ─────────────────────────────────────────────────────────────────────────────
```

**New test cases to add (6+ required per RESEARCH.md):**

| Test name | Requirement |
|-----------|-------------|
| `"injects cache_control on last user message with array content"` | CACHE-03 |
| `"converts string user message content to array with cache_control"` | CACHE-03 / D-04 |
| `"does not inject when 4 cache_control blocks already present"` | CACHE-03 / D-07 |
| `"injects remaining slots when 2 blocks already present"` | CACHE-03 / D-06 |
| `"does not overwrite existing cache_control on a block"` | D-01 |
| `"injects body.provider when account has preference and no provider field"` | PROV-01 / D-11 |
| `"does not inject body.provider when request already has provider field"` | D-11 |
| `"defaults allow_fallbacks to true when field absent from stored JSON"` | D-10 |
| `"skips provider injection on corrupt openrouter_provider_preference JSON"` | D-12 |

---

## Shared Patterns

### FORK PATCH Annotation Convention
**Source:** `packages/providers/src/providers/openrouter/provider.ts` lines 39, 119
**Apply to:** Every new code block added by Phase 4

```typescript
// FORK PATCH: <description of what this patch does>
```

The annotation goes on the line directly before the fork-specific block, not inline.

### JSON.parse with try/catch (fail-open)
**Source:** `packages/types/src/account.ts` lines 367–388 (modelMappings pattern)
**Apply to:** All JSON.parse calls in provider.ts, account.ts, accounts.ts

```typescript
try {
	const parsed = JSON.parse(someField);
	// validate shape before using
} catch {
	// silently fail, use null/default
}
```

Never let JSON.parse throw propagate — always catch and degrade gracefully.

### `"provider" in body` — field presence check
**Source:** Decision D-11 / RESEARCH.md pitfall 2
**Apply to:** Provider injection guard in transformRequestBody()

```typescript
// CORRECT — checks field presence, not truthiness
if (!("provider" in body)) { ... }

// WRONG — fails for body.provider = {}
if (!body.provider) { ... }
```

### `?? true` — nullish coalescing for boolean default
**Source:** Decision D-10 / RESEARCH.md pitfall 3
**Apply to:** `allow_fallbacks` field access in both provider.ts and account.ts parse sites

```typescript
allowFallbacks: parsed.allow_fallbacks ?? true,
// NOT: parsed.allow_fallbacks || true  — would coerce false → true
```

### `account?.` — optional chaining for optional account parameter
**Source:** `packages/providers/src/providers/openrouter/provider.ts` line 40 (`account?: Account`)
**Apply to:** All account field accesses in transformRequestBody()

```typescript
if (account?.openrouter_provider_preference && ...) { ... }
```

### Clone before reading body
**Source:** `packages/providers/src/providers/openrouter/provider.ts` line 48
**Apply to:** Any new code that reads the request body

```typescript
const body = await mapped.clone().json();
// clone() is mandatory — body can only be consumed once
```

### Logger usage
**Source:** `packages/providers/src/providers/openrouter/provider.ts` lines 7, 105, 113
**Apply to:** All log calls in provider.ts

```typescript
const log = new Logger("OpenRouterProvider");
// ...
log.debug("message");
log.warn("message");
// Never console.log/console.error in application code
```

---

## No Analog Found

All files for this phase have existing analogs or are extensions of existing files. No file requires greenfield pattern design from RESEARCH.md examples alone.

---

## Metadata

**Analog search scope:** `packages/providers/src/providers/openrouter/`, `packages/types/src/`, `packages/http-api/src/handlers/`, `packages/database/src/`
**Files scanned:** 5 primary files read directly
**Pattern extraction date:** 2026-05-20
