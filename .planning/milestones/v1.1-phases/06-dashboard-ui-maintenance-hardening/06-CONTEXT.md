# Phase 6: Dashboard UI & Maintenance Hardening - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Two deliverables:

1. **PROV-04 — Provider Preferences Dialog:** A dashboard dialog on OpenRouter accounts that lets operators set or clear per-account OpenRouter provider order and `allow_fallbacks` flag. The dialog appears only when `account.provider === "openrouter"`. It calls the Phase 5 `PUT /api/accounts/:id/openrouter-provider-preference` (set) and `DELETE /api/accounts/:id/openrouter-provider-preference` (clear) endpoints.

2. **MAINT-04 + MAINT-05 — Maintenance Hardening:** Update `pre-merge-check.sh` `HIGH_RISK_FILES` to include `migrations.ts` and `http-api/src/handlers/accounts.ts`. Perform a full v1.1 annotation audit across all files modified in phases 3–6 to confirm every fork-specific code block carries a `// FORK PATCH:` comment.

No proxy changes. No new API endpoints. No schema migrations.

</domain>

<decisions>
## Implementation Decisions

### allow_fallbacks Toggle

- **D-01:** The dialog includes a labeled "Allow fallbacks" row using a Radix `Switch` component. Default state: checked (ON), matching the stored default of `true` and the existing `Switch` usage in `AccountListItem` (autoFallback, autoRefresh).
- **D-02:** When the provider order input is empty on Save (regardless of the toggle state), the dialog calls `DELETE` to remove the preference entirely. Empty order + any toggle state = "no preference" → clear. No separate "Clear All" button is needed.

### Clearing Behavior

- **D-03:** The sole clearing mechanism is: empty the provider order input field and click Save. This calls `DELETE /api/accounts/:id/openrouter-provider-preference` and returns the account to no preference (proxy stops injecting `provider.order`).

### Dialog Entry Point

- **D-04:** The action surfaces as a **dropdown menu item** in `AccountListItem` labeled "Provider Preferences", gated on `account.provider === "openrouter"`. Non-OpenRouter accounts never see this item. Consistent with the existing "Model Mappings" dropdown pattern.

### MAINT-05 Audit Scope

- **D-05:** The `// FORK PATCH:` annotation audit is a **full v1.1 scan** — all files modified across phases 3–6 that carry fork-specific logic. Not limited to Phase 6 additions. This runs as a completion gate before the milestone is marked done.

### Claude's Discretion

- Exact `AccountOpenrouterProviderPreferenceDialog` component name and file location — follow `AccountModelMappingsDialog.tsx` naming and placement
- Whether to add an `onProviderPreferenceChange` prop to `AccountListItem` or follow a different callback wiring pattern (follow the `onModelMappingsChange` pattern exactly)
- Order of the "Provider Preferences" item relative to "Model Mappings" in the dropdown menu — place adjacent to it
- `AccountsTab.tsx` mutation wiring — follow the existing `updateModelMappings` pattern for `setProviderPreference` / `clearProviderPreference` mutations
- Input placeholder for provider order — e.g., `"e.g., anthropic/claude-3-5-sonnet, openai/gpt-4o"`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` §PROV-04 — Dashboard UI requirement: dialog gated on provider=openrouter, comma-separated input, calls PUT/DELETE endpoints
- `.planning/REQUIREMENTS.md` §MAINT-04 — HIGH_RISK_FILES update: add `migrations.ts` and `http-api/src/handlers/accounts.ts`
- `.planning/REQUIREMENTS.md` §MAINT-05 — FORK PATCH annotation enforcement: all v1.1 fork-specific code blocks

### Dialog Pattern (mirror this)

- `packages/dashboard-web/src/components/accounts/AccountModelMappingsDialog.tsx` — Direct template for the new dialog: Dialog, DialogContent, DialogHeader, DialogFooter, Input, Label, Switch; comma-separated input → array serialization; empty = clear
- `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` — Where the dropdown menu item is added (gated on `account.provider === "openrouter"`); callback prop pattern to mirror

### Phase 5 API Endpoints (what the dialog calls)

- `packages/http-api/src/handlers/accounts.ts` — `createAccountOpenrouterProviderPreferenceHandler` (PUT, ~line 3594) and `createAccountOpenrouterProviderPreferenceDeleteHandler` (DELETE, ~line 3674)
- `packages/http-api/src/router.ts` — Route dispatch for PUT and DELETE at ~lines 619–635

### Type Shape (from Phase 4)

- `packages/types/src/account.ts` — `AccountResponse.openrouterProviderPreference: { order: string[], allowFallbacks: boolean } | null`

### Maintenance Tooling (MAINT-04 target)

- `.planning/scripts/pre-merge-check.sh` — `HIGH_RISK_FILES` array: add `packages/database/src/migrations.ts` and `packages/http-api/src/handlers/accounts.ts`

### Fork Patch Convention

- `.planning/PROJECT.md` §Key Decisions — `// FORK PATCH:` annotation style and placement

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `AccountModelMappingsDialog.tsx` — Direct template: Dialog shell, Input, Label, `useEffect` for account sync, `handleSave` with async loading state, empty → null treatment, Cancel/Save footer. Clone and adapt.
- Radix `Switch` component at `packages/dashboard-web/src/components/ui/switch.tsx` — already used in `AccountListItem` for `autoFallback` / `autoRefresh`; same component for `allow_fallbacks` toggle in the dialog
- `AccountListItem` dropdown menu items — existing `DropdownMenuItem` entries for "Model Mappings", "Priority", "Custom Endpoint" show exact prop/callback wiring to copy

### Established Patterns

- **Dialog props:** `isOpen: boolean`, `account: Account | null`, `onOpenChange: (open: boolean) => void`, `onUpdate...: (...) => Promise<void>` — every account dialog follows this shape
- **`useEffect` sync:** Update local state when `account` prop changes (same as ModelMappingsDialog)
- **Comma-separated → array:** `value.split(",").map(s => s.trim()).filter(Boolean)` — existing `parseMappingValue()` helper is the exact pattern; empty array after filter → call DELETE
- **Provider gate in AccountListItem:** `account.provider === "openrouter"` — wrap the DropdownMenuItem in a conditional render
- **AccountsTab wiring:** Find `handleUpdateModelMappings` in `AccountsTab.tsx` — `setProviderPreference` / `clearProviderPreference` follow the same fetch + query invalidation pattern

### Integration Points

- `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` — add `onProviderPreferenceChange?: (account: Account) => void` prop and the conditional dropdown item
- `packages/dashboard-web/src/components/accounts/AccountsTab.tsx` — wire `setProviderPreference` and `clearProviderPreference` API calls, pass handler to AccountListItem
- `packages/dashboard-web/src/api.ts` (or equivalent API client) — add `putProviderPreference(accountId, order, allowFallbacks)` and `deleteProviderPreference(accountId)` fetch calls
- `packages/dashboard-web/src/components/accounts/index.ts` — export the new dialog component

</code_context>

<specifics>
## Specific Ideas

- The new dialog is deliberately simpler than ModelMappingsDialog: one text input (provider order, comma-separated) + one Switch (allow_fallbacks). Two controls, not a grid.
- Provider order input placeholder suggestion: `"e.g., anthropic/claude-3-5-sonnet, openai/gpt-4o"` — helps users understand the format
- Saving with an empty provider order field → call DELETE (remove preference). This means the dialog's `handleSave` branches: if parsed array is empty → `deleteProviderPreference(account.id)`; otherwise → `putProviderPreference(account.id, parsedOrder, allowFallbacks)`.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 6-Dashboard UI & Maintenance Hardening*
*Context gathered: 2026-05-20*
