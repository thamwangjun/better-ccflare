# Phase 11: Dashboard Wiring - Research

**Researched:** 2026-06-04
**Domain:** React 19 / TypeScript dashboard wiring (mirror existing `openrouter` provider UI to `openrouter-anthropic`)
**Confidence:** HIGH (every cited line number verified against the live codebase this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Mirror the `openrouter` form block exactly — API key field + optional Opus/Sonnet/Haiku model mappings, copy-pasted as a sibling `{newAccount.mode === "openrouter-anthropic" && (...)}` block. No slimming, no field divergence.
- **D-02:** New `SelectItem` uses the ROADMAP-locked label **`"OpenRouter Anthropic Messages (API Key)"`** (SC#1), placed directly below the existing `openrouter` `SelectItem`.
- **D-03:** Include an endpoint helper hint in the form block: **`Endpoint: https://openrouter.ai/api/v1 (native Anthropic Messages)`**.
- **D-04:** Submit path mirrors `handleAddOpenRouterAccount` → `api.addOpenRouterAnthropicAccount` → `POST /api/accounts/openrouter-anthropic`. Add a dedicated `onAddOpenRouterAnthropicAccount` form prop + handler (one-prop-per-provider), not a shared branch.
- **D-05:** Reuse the existing OpenRouter provider-preference path as-is. Widen the gate in `AccountListItem.tsx` from `account.provider === "openrouter"` to `account.provider === "openrouter" || account.provider === "openrouter-anthropic"`. Reuse the same `/api/accounts/:id/openrouter-provider-preference` endpoint, the `openrouterProviderPreference` account field, and the existing `AccountOpenrouterProviderPreferenceDialog` component **without relabeling**.
- **D-06:** Extend the `mode`/`provider` string unions at every dashboard site that lists `"openrouter"` to also include `"openrouter-anthropic"`. Add `// FORK PATCH:` annotations on every fork-specific addition.

### Claude's Discretion
- Exact placement of the new `onAddOpenRouterAnthropicAccount` prop/handler within each file (follow the existing `openrouter` sibling location).
- Whether to extract the duplicated form block into a shared component vs. copy-paste — copy-paste is acceptable.
- Test coverage approach for the widened dialog gate (existing `AccountOpenrouterProviderPreferenceDialog.test.ts` is the nearest analog).

### Deferred Ideas (OUT OF SCOPE)
- Relabeling `AccountOpenrouterProviderPreferenceDialog` to a provider-neutral name.
- Extracting duplicated per-provider form blocks into a shared component.
- Live end-to-end verification with a real `:free` request (Phase 12).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MGMT-03 | User can add an `openrouter-anthropic` account via the dashboard Add Account form | Verified touchpoints in `AccountAddForm.tsx`, `api.ts`, `AccountsTab.tsx` (Standard Stack + Architecture Patterns below). Submit target `POST /api/accounts/openrouter-anthropic` confirmed to exist from Phase 10. |
| MGMT-04 | User can set/clear provider order for `openrouter-anthropic` accounts via the dashboard provider-preference dialog | Verified single-line gate widen in `AccountListItem.tsx:350`; endpoint/dialog/account-field reuse confirmed provider-agnostic (ARCHITECTURE §4). |
</phase_requirements>

## Summary

Phase 11 is a bounded, mechanical mirror: the existing `openrouter` dashboard wiring is copied across four files to add `openrouter-anthropic`. Every line number cited by CONTEXT.md and ARCHITECTURE.md §3 was re-verified against the live codebase this session and **all match exactly** — no drift. The submit target `POST /api/accounts/openrouter-anthropic` was delivered in Phase 10, so this phase is pure frontend wiring with no backend dependency beyond what already ships.

The work splits cleanly: MGMT-03 (add-account form) requires a new SelectItem, a copy-pasted conditional form block, a new form prop, a new submit-handler branch, a new API client method, a new container handler + prop pass-through, and several mode-union extensions. MGMT-04 (provider preference) requires exactly one widened boolean gate — the endpoint, dialog component, and account field are all account-id-keyed and provider-agnostic.

**Primary recommendation:** Treat the existing `openrouter` code as a verbatim template for every site. After making the union extensions, run `bunx tsc --noEmit` — TypeScript will surface any missed union site as a compile error before runtime.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19 | Dashboard UI | Already the project's UI framework [VERIFIED: CLAUDE.md tech stack] |
| TypeScript | 6.0.2 | Type safety; union extension enforcement | Project standard [VERIFIED: CLAUDE.md] |
| Radix UI (`Select`, `Button`, `Label`, `Input`) | per package | Form controls in `AccountAddForm` | Existing component primitives [VERIFIED: AccountAddForm.tsx imports] |
| `bun:test` | bundled with Bun >=1.2.8 | Unit tests | Project test runner [VERIFIED: package.json `"test": "bun test"`] |

**No new dependencies.** This phase adds no npm packages.

## Architecture Patterns

### Verified touchpoint map (all line numbers confirmed live, 2026-06-04)

**`packages/dashboard-web/src/components/accounts/AccountAddForm.tsx`** — 8 sites:
| Line | Current | Action |
|------|---------|--------|
| 28 | props `mode` union lists `"openrouter"` | add `\| "openrouter-anthropic"` |
| 99–104 | `onAddOpenRouterAccount` prop signature | add sibling `onAddOpenRouterAnthropicAccount` prop (same shape) |
| 157 | `newAccount` state `mode` union | add `\| "openrouter-anthropic"` |
| 431 | `accountParams` cast union (lines 422–432) | add `\| "openrouter-anthropic"` |
| 710 | `if (newAccount.mode === "openrouter") {` submit-handler branch | add sibling `if (newAccount.mode === "openrouter-anthropic")` branch calling `onAddOpenRouterAnthropicAccount` — **see Pitfall 1** |
| 1020 | `Select.onValueChange` cast union | add `\| "openrouter-anthropic"` |
| 1051 | `<SelectItem value="openrouter">OpenRouter (API Key)</SelectItem>` | add sibling `<SelectItem value="openrouter-anthropic">OpenRouter Anthropic Messages (API Key)</SelectItem>` directly below |
| 1665–1748 | `{newAccount.mode === "openrouter" && (...)}` form block | copy verbatim as `"openrouter-anthropic"` block; change endpoint hint per D-03 |

**`packages/dashboard-web/src/api.ts`** — 2 sites:
| Line | Current | Action |
|------|---------|--------|
| 259 | `initAddAccount` mode param union | add `\| "openrouter-anthropic"` |
| 481–488+ | `async addOpenRouterAccount(...)` (`url = "/api/accounts/openrouter"`) | add sibling `addOpenRouterAnthropicAccount` posting to `/api/accounts/openrouter-anthropic` |
| 1336, 1361 | `/openrouter-provider-preference` methods | **reused unchanged** (D-05) |

**`packages/dashboard-web/src/components/AccountsTab.tsx`** — 3 sites:
| Line | Current | Action |
|------|---------|--------|
| 120 | `handleAddAccount` mode param union | add `\| "openrouter-anthropic"` |
| 293–308 | `handleAddOpenRouterAccount` (calls `api.addOpenRouterAccount`) | add sibling `handleAddOpenRouterAnthropicAccount` calling `api.addOpenRouterAnthropicAccount` |
| 644 | `onAddOpenRouterAccount={handleAddOpenRouterAccount}` form prop | add sibling `onAddOpenRouterAnthropicAccount={handleAddOpenRouterAnthropicAccount}` |

**`packages/dashboard-web/src/components/accounts/AccountListItem.tsx`** — 1 site:
| Line | Current | Action |
|------|---------|--------|
| 350 | `{account.provider === "openrouter" && onProviderPreferenceChange && (` | widen to `(account.provider === "openrouter" \|\| account.provider === "openrouter-anthropic")`. FORK PATCH comment already at line 349. |

### Pattern: One-prop-per-provider / one-handler-per-provider
`AccountAddForm` exposes a distinct `onAddXxxAccount` prop per provider; `AccountsTab` defines a matching `handleAddXxxAccount`. D-04 follows this; do not introduce a shared branch. [VERIFIED: AccountAddForm.tsx:99–104, AccountsTab.tsx:293–308]

### Pattern: FORK PATCH annotation
Every fork-specific addition gets a `// FORK PATCH:` comment for upstream-merge safety. The provider-preference button already carries `// FORK PATCH: Provider preferences button (PROV-04)` at AccountListItem.tsx:349. Annotate every new union member, prop, handler, branch, SelectItem, and form block. [VERIFIED: AccountListItem.tsx:349]

### Anti-Patterns
- **Sharing a submit branch between `openrouter` and `openrouter-anthropic`:** contradicts D-04 and the one-handler-per-provider convention. Each calls a different endpoint.
- **Relabeling the provider-preference dialog:** explicitly deferred (D-05). Leave its OpenRouter name/labels.
- **`export default`:** repo uses named exports only [VERIFIED: CLAUDE.md conventions].
- **Relative cross-package imports / paraphrasing the dropdown label:** label is ROADMAP-locked verbatim (SC#1, D-02).

## Solved Problems

| Problem | Build Nothing — Use Instead | Why |
|---------|-----------------------------|-----|
| Provider-order set/clear UI | Existing `AccountOpenrouterProviderPreferenceDialog` + `/openrouter-provider-preference` endpoint + `openrouterProviderPreference` field | Account-id-keyed, provider-agnostic (ARCHITECTURE §4). One gate widen is the entire MGMT-04 surface. |
| Add-account form fields | Copy the `openrouter` block (AccountAddForm.tsx:1665–1748) verbatim | D-01; identical field set. |

**Key insight:** MGMT-04 is a one-line change. The hard infrastructure (DB column, REST endpoints, dialog) already exists and does not branch on provider.

## Common Pitfalls

### Pitfall 1: Missing submit-handler branch at AccountAddForm.tsx:710
**What goes wrong:** CONTEXT.md `canonical_refs` enumerates the prop (~99), SelectItem (~1051), form block (1665), and four unions, but does **not** explicitly list the submit dispatch branch at line 710. Without a sibling `if (newAccount.mode === "openrouter-anthropic")` branch, the form renders correctly but the submit button silently does nothing for the new mode — the account is never created and MGMT-03 fails its success criterion.
**Root cause:** `handleSubmit` dispatches per-mode; an unhandled mode falls through with no API call.
**Prevention:** Add the sibling submit branch (ARCHITECTURE §3B line 146 flags this site). It calls `onAddOpenRouterAnthropicAccount` with the same `{name, apiKey, priority, modelMappings}` payload as the `openrouter` branch (lines 715–725).
**Warning signs:** Form submits, dialog stays open / no new card appears, no network request to `/api/accounts/openrouter-anthropic`.

### Pitfall 2: Five distinct mode unions in AccountAddForm, not one
**What goes wrong:** Adding `"openrouter-anthropic"` to only some unions leaves a TypeScript error or a runtime cast mismatch. The four union sites are lines 28 (props), 157 (state), 431 (accountParams cast, lines 422–432), and 1020 (`onValueChange` cast).
**Prevention:** Extend all four. Then run `bunx tsc --noEmit` — it surfaces any miss as a compile error.

### Pitfall 3: Endpoint hint divergence (D-03)
**What goes wrong:** Copy-pasting the form block leaves the `openrouter` hint `Endpoint: https://openrouter.ai/api/v1` (line 1682). D-03 requires the new block read `Endpoint: https://openrouter.ai/api/v1 (native Anthropic Messages)` to distinguish it from the OAI-shape provider.
**Prevention:** Edit the hint string in the copied block.

### Pitfall 4: Dropdown label must be verbatim
The SelectItem text must be exactly `"OpenRouter Anthropic Messages (API Key)"` — ROADMAP SC#1 / D-02. Do not paraphrase, change casing, or drop `(API Key)`.

## Code Examples

### Submit-handler sibling branch (mirror of AccountAddForm.tsx:710–725)
```tsx
// FORK PATCH: openrouter-anthropic submit branch (MGMT-03)
if (newAccount.mode === "openrouter-anthropic") {
	if (!newAccount.apiKey) {
		onError("API key is required for OpenRouter Anthropic accounts");
		return;
	}
	const modelMappings: { [key: string]: string } = {};
	if (newAccount.opusModel) modelMappings.opus = newAccount.opusModel;
	if (newAccount.sonnetModel) modelMappings.sonnet = newAccount.sonnetModel;
	if (newAccount.haikuModel) modelMappings.haiku = newAccount.haikuModel;
	await onAddOpenRouterAnthropicAccount({
		name: newAccount.name,
		apiKey: newAccount.apiKey,
		priority: newAccount.priority,
		modelMappings:
			Object.keys(modelMappings).length > 0 ? modelMappings : undefined,
	});
	// ...mirror the setNewAccount reset + onSuccess() + return from the openrouter branch
}
```
Source: AccountAddForm.tsx:710–725 [VERIFIED: live read]

### API client method (mirror of api.ts:481–488)
```ts
// FORK PATCH: openrouter-anthropic account creation (MGMT-03)
async addOpenRouterAnthropicAccount(data: {
	name: string;
	apiKey: string;
	priority: number;
	modelMappings?: { [key: string]: string };
}): Promise<{ message: string; account: Account }> {
	const url = "/api/accounts/openrouter-anthropic";
	// ...mirror addOpenRouterAccount body (logger.debug, this.post, error handling)
}
```
Source: api.ts:481+ [VERIFIED: live read]

### Gate widen (AccountListItem.tsx:350)
```tsx
{(account.provider === "openrouter" ||
	account.provider === "openrouter-anthropic") &&
	onProviderPreferenceChange && (
		/* existing button unchanged */
	)}
```
Source: AccountListItem.tsx:350 [VERIFIED: live read]

## State of the Art

No deprecations relevant. All patterns are the project's current conventions as of 2026-06-04. No external library version checks needed (no new deps).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `setNewAccount` reset block + `onSuccess()` in the `openrouter` submit branch (lines 726+) should be mirrored identically | Code Examples / Pitfall 1 | LOW — if reset differs, form retains stale state after submit; cosmetic, caught in manual test |

**Note:** A1 is the only assumption; the exact tail of the `openrouter` submit branch (post line 725) was not fully read but follows the established per-provider reset pattern. The planner should instruct the implementer to copy the full branch tail verbatim.

## Open Questions (RESOLVED)

1. **Does `initAddAccount` (api.ts:259) need the new mode for any path other than the dedicated method?**
   - What we know: D-04/D-06 say extend the union at 259; the dedicated `addOpenRouterAnthropicAccount` method is the actual submit path.
   - What is unclear: whether `initAddAccount` is also invoked for openrouter today.
   - Recommendation: extend the union per D-06 regardless (mechanical, type-only); no behavioral risk.
   - **RESOLVED:** extend union per D-06 (mechanical, type-only) — implemented in Plan 11-02 Task 1.

## Environment Availability

Step 2.6: SKIPPED for external services. This phase is frontend code-only. The only tooling required is the project toolchain, verified present via package.json scripts:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | build/test/typecheck | Assumed (project baseline) | >=1.2.8 | — |
| `bunx tsc --noEmit` | union-completeness check | ✓ (root script `typecheck`) | TS 6.0.2 | — |
| `bun test` | unit tests | ✓ (root script `test`) | bun:test | — |
| Biome | lint/format | ✓ (root scripts `lint`/`format`) | 2.4 | — |

No external services, no `curl` to any Anthropic endpoint (CLAUDE.md safety rule — not applicable here; no live account testing this phase).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` |
| Config file | none — uses `bun test` default discovery |
| Quick run command | `bun test packages/dashboard-web/src/components/accounts/` |
| Full suite command | `bun test` |

**Two established dashboard test styles** (both `bun:test`):
- **Pure-function unit test** — `AccountOpenrouterProviderPreferenceDialog.test.ts` imports exported helpers and asserts on them. No DOM. [VERIFIED: live read]
- **SSR markup assertion** — `RateLimitProgress.test.tsx` uses `renderToStaticMarkup` from `react-dom/server` and asserts on the HTML string. This is the harness for testing rendered component branches (e.g., the widened gate). [VERIFIED: live read]

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MGMT-03 | `addOpenRouterAnthropicAccount` posts to `/api/accounts/openrouter-anthropic` | unit | `bun test packages/dashboard-web/src/api*.test.ts` | no — Wave 0 (no api.ts test exists today) |
| MGMT-03 | Add-account form renders the new SelectItem + form block for the new mode | render (SSR) | `bun test packages/dashboard-web/src/components/accounts/` | no — Wave 0 |
| MGMT-04 | Provider-preference button renders for `openrouter-anthropic` accounts | render (SSR) | `bun test packages/dashboard-web/src/components/accounts/` | no — Wave 0 (extend the dialog test analog) |
| MGMT-03/04 | Union completeness — no missed `"openrouter-anthropic"` site | static | `bunx tsc --noEmit` | yes (root script) |

### Sampling Rate
- **Per task commit:** `bunx tsc --noEmit && bun test packages/dashboard-web/`
- **Per wave merge:** `bun run lint && bun run typecheck && bun test`
- **Phase gate:** `bun run lint && bun run typecheck && bun run format` (CLAUDE.md after-code-changes rule) + full `bun test` green.

### Wave 0 Gaps
- [ ] `packages/dashboard-web/src/components/accounts/__tests__/AccountListItem.test.tsx` — SSR test asserting the provider-preference button renders for an `openrouter-anthropic` account and not for unrelated providers (covers MGMT-04). Use `renderToStaticMarkup` per RateLimitProgress.test.tsx.
- [ ] Form-render / submit-dispatch coverage for MGMT-03 — either an SSR test on `AccountAddForm` for the new SelectItem/block, or refactor the submit dispatch into an exported pure helper to unit-test the mode→handler routing. (Discretion: the existing dialog test extracts pure helpers; same approach minimizes DOM coupling.)
- Note: `bunx tsc --noEmit` is the cheapest gate for union completeness — make it a required check, not optional.

## Security Domain

Security enforcement: no explicit `security_enforcement` key in config.json. Phase is frontend-only string/union wiring with no new auth, crypto, or data-handling surface.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | unchanged — reuses existing account-creation auth |
| V3 Session Management | no | n/a |
| V4 Access Control | no | endpoint reuse; no new authorization paths |
| V5 Input Validation | partial | API key field reuses existing form validation (required-check at submit, mirrors openrouter) |
| V6 Cryptography | no | n/a — no new secret handling; API key passed to existing endpoint |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key echoed in logs | Information Disclosure | `logger.debug` already logs `{ data }` in `addOpenRouterAccount` (api.ts:489). Mirror existing behavior; do not add new logging of the key. Pre-existing behavior — flag to user if key-redaction is desired, but out of this phase's scope. |

## Sources

### Primary (HIGH confidence)
- Direct `Read`/`grep` of the four target files (2026-06-04): `AccountAddForm.tsx` (lines 28, 99–104, 157, 420–437, 710–748, 1020, 1045–1054, 1665–1748), `api.ts` (259, 481–492, 1336, 1361), `AccountsTab.tsx` (120, 293–308, 644), `AccountListItem.tsx` (345–352).
- `AccountOpenrouterProviderPreferenceDialog.test.ts` + `RateLimitProgress.test.tsx` — test-harness patterns.
- `.planning/research/ARCHITECTURE.md` §3, §4 — touchpoint enumeration (cross-verified against live code; all matched).
- `.planning/phases/11-dashboard-wiring/11-CONTEXT.md` — locked decisions.
- `./CLAUDE.md` — conventions, scripts, FORK PATCH rule, safety rules.
- `package.json` — verified `test`/`lint`/`typecheck`/`format` scripts.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; existing primitives verified in file.
- Architecture / touchpoints: HIGH — every cited line number re-verified live; zero drift from CONTEXT/ARCHITECTURE.
- Pitfalls: HIGH — Pitfall 1 (line 710) cross-confirmed in ARCHITECTURE §3B and read directly.

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (stable internal code; only invalidated by edits to the four files before planning)
