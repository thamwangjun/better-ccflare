# Phase 11: Dashboard Wiring - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 4 modified + 2 new tests
**Analogs found:** 6 / 6 (every site has an exact in-file `openrouter` analog)

> This phase is a pure mirror: every new code element has an exact `openrouter` template living in the same file. The planner should instruct the implementer to copy the cited excerpt verbatim, swap `openrouter` → `openrouter-anthropic`, apply the D-02 label and D-03 endpoint-hint edits, and add a `// FORK PATCH:` comment on every addition. Run `bunx tsc --noEmit` after the union edits — TS surfaces any missed union site as a compile error.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `AccountAddForm.tsx` | component (form) | request-response (submit) | in-file `openrouter` sites | exact |
| `api.ts` | service (HTTP client) | request-response (POST) | in-file `addOpenRouterAccount` | exact |
| `AccountsTab.tsx` | component (container) | request-response | in-file `handleAddOpenRouterAccount` | exact |
| `AccountListItem.tsx` | component (card) | event-driven (button click) | in-file `openrouter` gate | exact |
| `AccountListItem.test.tsx` (new) | test | SSR render assertion | `RateLimitProgress.test.tsx` | exact (harness) |
| form/submit test (new) | test | pure-helper or SSR | `AccountOpenrouterProviderPreferenceDialog.test.ts` / `RateLimitProgress.test.tsx` | exact (harness) |

## Pattern Assignments

### `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` (component, request-response)

Eight sites. The `openrouter` analog for each lives in the same file. All additions need `// FORK PATCH:` annotations (D-06).

**Site 1 — props `mode` union (line 28):** add `| "openrouter-anthropic"` to the `onAddAccount` `mode` union (lines 17–32). The `"openrouter"` member is at line 28.

**Site 2 — `onAddOpenRouterAccount` prop signature (lines 99–104):** add a sibling prop directly below, same shape:
```tsx
onAddOpenRouterAccount: (params: {
	name: string;
	apiKey: string;
	priority: number;
	modelMappings?: { [key: string]: string };
}) => Promise<void>;
```
Also add the new prop name to the destructure block (line 134, `onAddOpenRouterAccount,` → add `onAddOpenRouterAnthropicAccount,` sibling).

**Site 3 — `newAccount` state `mode` union (line 157):** add `| "openrouter-anthropic"` (state union lines 146–162; `"openrouter"` at 157).

**Site 4 — `accountParams` cast union (line 431):** add `| "openrouter-anthropic"` (cast union lines 422–432; `"openrouter"` at 431).

**Site 5 — submit-dispatch branch (lines 710–744) — LANDMINE (Pitfall 1, omitted from CONTEXT canonical_refs):** copy the entire `openrouter` branch verbatim as a sibling `if (newAccount.mode === "openrouter-anthropic")`. Includes API-key guard, modelMappings assembly, `await onAddOpenRouterAnthropicAccount({...})`, the full `setNewAccount({...})` reset (lines 726–741), `onSuccess()`, and `return`. Without this branch the form renders but submit silently no-ops and MGMT-03 fails.
```tsx
if (newAccount.mode === "openrouter") {
	if (!newAccount.apiKey) {
		onError("API key is required for OpenRouter accounts");
		return;
	}
	const modelMappings: { [key: string]: string } = {};
	if (newAccount.opusModel) modelMappings.opus = newAccount.opusModel;
	if (newAccount.sonnetModel) modelMappings.sonnet = newAccount.sonnetModel;
	if (newAccount.haikuModel) modelMappings.haiku = newAccount.haikuModel;
	await onAddOpenRouterAccount({
		name: newAccount.name,
		apiKey: newAccount.apiKey,
		priority: newAccount.priority,
		modelMappings:
			Object.keys(modelMappings).length > 0 ? modelMappings : undefined,
	});
	setNewAccount({ /* full reset, lines 726-741 — copy verbatim */ });
	onSuccess();
	return;
}
```
New branch: change the error string to `"API key is required for OpenRouter Anthropic accounts"` and the call to `onAddOpenRouterAnthropicAccount`. Copy the reset block verbatim (Assumption A1).

**Site 6 — `Select.onValueChange` cast union (line 1020):** add `| "openrouter-anthropic"` (union lines 1011–1024; `"openrouter"` at 1020).

**Site 7 — SelectItem (line 1051):** add a sibling directly below the `openrouter` item. Label is ROADMAP-locked verbatim (D-02, Pitfall 4):
```tsx
<SelectItem value="openrouter">OpenRouter (API Key)</SelectItem>
{/* FORK PATCH: openrouter-anthropic dropdown item (MGMT-03) */}
<SelectItem value="openrouter-anthropic">
	OpenRouter Anthropic Messages (API Key)
</SelectItem>
```

**Site 8 — conditional form block (lines 1665–1748):** copy the entire `{newAccount.mode === "openrouter" && (...)}` block verbatim as a `"openrouter-anthropic"` sibling. The block contains: API-key `Input` (password), endpoint hint `<p>`, and Opus/Sonnet/Haiku model-mapping `Input`s. **D-03 / Pitfall 3:** change the hint at line 1682 from `Endpoint: https://openrouter.ai/api/v1` to `Endpoint: https://openrouter.ai/api/v1 (native Anthropic Messages)`. Leave all other strings/placeholders identical.

---

### `packages/dashboard-web/src/api.ts` (service, request-response)

**Site 1 — `initAddAccount` mode union (line 259):** add `| "openrouter-anthropic"` (union lines 250–263; `"openrouter"` at 259). Type-only per D-06 / Open Question 1 — mechanical, no behavioral risk.

**Site 2 — `addOpenRouterAccount` method (lines 481–~505):** add a sibling `addOpenRouterAnthropicAccount` directly below, identical body except `url = "/api/accounts/openrouter-anthropic"`. Mirror the `startTime`/`logger.debug`/`this.post`/duration-log/catch-with-error-log structure verbatim:
```ts
async addOpenRouterAccount(data: {
	name: string;
	apiKey: string;
	priority: number;
	modelMappings?: { [key: string]: string };
}): Promise<{ message: string; account: Account }> {
	const startTime = Date.now();
	const url = "/api/accounts/openrouter";
	this.logger.debug(`→ POST ${url}`, { data });
	try {
		const response = await this.post<{ message: string; account: Account }>(url, data);
		const duration = Date.now() - startTime;
		this.logger.debug(`← POST ${url} - 200 (${duration}ms)`);
		return response;
	} catch (error) { /* error log + rethrow */ }
}
```
**Note (security):** the existing `logger.debug(`→ POST ${url}`, { data })` echoes the API key — this is pre-existing behavior. Mirror it as-is; do not add new key logging.

---

### `packages/dashboard-web/src/components/AccountsTab.tsx` (component, container)

**Site 1 — `handleAddAccount` mode union (line 120):** add `| "openrouter-anthropic"` (union lines 110–124; `"openrouter"` at 120).

**Site 2 — `handleAddOpenRouterAccount` (lines 293–308):** add a sibling `handleAddOpenRouterAnthropicAccount` directly below, calling `api.addOpenRouterAnthropicAccount`. Mirror the `try { await ...; await loadAccounts(); setAdding(false); setActionError(null); } catch { setActionError(formatError(err)); throw err; }` structure verbatim:
```tsx
const handleAddOpenRouterAccount = async (params: {
	name: string; apiKey: string; priority: number;
	modelMappings?: { [key: string]: string };
}) => {
	try {
		await api.addOpenRouterAccount(params);
		await loadAccounts();
		setAdding(false);
		setActionError(null);
	} catch (err) {
		setActionError(formatError(err));
		throw err;
	}
};
```

**Site 3 — form prop pass-through (line 644):** add sibling next to `onAddOpenRouterAccount={handleAddOpenRouterAccount}`:
```tsx
onAddOpenRouterAccount={handleAddOpenRouterAccount}
onAddOpenRouterAnthropicAccount={handleAddOpenRouterAnthropicAccount}
```

---

### `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` (component, event-driven)

**Site 1 — provider-preference gate (line 350) — D-05 widen, one-line:** the `// FORK PATCH:` comment already exists at line 349. Widen the boolean only; the button body (lines 351–364), the `onProviderPreferenceChange` handler, the endpoint, and the `openrouterProviderPreference` field are all reused unchanged.
```tsx
{/* FORK PATCH: Provider preferences button (PROV-04) */}
{(account.provider === "openrouter" ||
	account.provider === "openrouter-anthropic") &&
	onProviderPreferenceChange && (
		/* existing button unchanged */
	)}
```

---

### New tests (Wave 0)

**`__tests__/AccountListItem.test.tsx` (new) — SSR render, harness from `RateLimitProgress.test.tsx`:**
Use `renderToStaticMarkup` from `react-dom/server`, assert on the HTML string. Verify the provider-preference button renders for an `openrouter-anthropic` account (gate passes) and does not for an unrelated provider. Header/imports pattern:
```tsx
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RateLimitProgress } from "./RateLimitProgress";
// render, then: const html = renderToStaticMarkup(<Component .../>); expect(html).toContain(...)
```
Source: `RateLimitProgress.test.tsx:7-36`.

**MGMT-03 form/submit test (new) — two viable harnesses:**
- *Pure-helper style* (preferred if submit dispatch is extracted): import exported helpers and assert directly. Source: `AccountOpenrouterProviderPreferenceDialog.test.ts:1-37` — note the `// FORK PATCH: TDD RED gate ...` header, `import { describe, expect, it } from "bun:test"`, named-export helper imports (`parseProviderOrder`, etc.), and `describe`/`it`/`expect(...).toEqual(...)` structure.
- *SSR style* — same `renderToStaticMarkup` harness as above to assert the new SelectItem label `"OpenRouter Anthropic Messages (API Key)"` and form block render for the new mode.
An `api.ts` test for `addOpenRouterAnthropicAccount` posting to `/api/accounts/openrouter-anthropic` does not exist today (Wave 0 — no api test file).

## Shared Patterns

### FORK PATCH annotation
**Source:** `AccountListItem.tsx:349` (`// FORK PATCH: Provider preferences button (PROV-04)`), `AccountOpenrouterProviderPreferenceDialog.test.ts:1`.
**Apply to:** every new union member, prop, handler, submit branch, SelectItem, form block, API method, and test file in this phase. Required for upstream-merge safety (D-06).

### One-prop-per-provider / one-handler-per-provider
**Source:** `AccountAddForm.tsx:99-104` (prop) + `AccountsTab.tsx:293-308` (handler) + `AccountAddForm.tsx:710` (submit branch).
**Apply to:** the new `onAddOpenRouterAnthropicAccount` prop + `handleAddOpenRouterAnthropicAccount` + `"openrouter-anthropic"` submit branch. Do NOT share a branch with `openrouter` (anti-pattern, D-04) — each posts to a different endpoint.

### Named exports only
**Source:** CLAUDE.md conventions. No `export default` anywhere; cross-package via `@better-ccflare/*`. The new test files use named-export imports (see `AccountOpenrouterProviderPreferenceDialog.test.ts:4-8`).

### Mode-union completeness (typecheck-enforced)
**Source:** the five distinct unions in `AccountAddForm.tsx` (28, 157, 431, 1020) + `api.ts:259` + `AccountsTab.tsx:120`.
**Apply to:** extend ALL of them. `bunx tsc --noEmit` surfaces any miss as a compile error — make it a required gate.

## No Analog Found

None. Every new code element has an exact in-file `openrouter` template.

## Metadata

**Analog search scope:** `packages/dashboard-web/src/` (api.ts, components/AccountsTab.tsx, components/accounts/{AccountAddForm,AccountListItem}.tsx, + two test files).
**Files scanned:** 6.
**Pattern extraction date:** 2026-06-04.
