# Phase 11: Dashboard Wiring - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 11 completes the dashboard sites deferred from Phase 10 so users can create and manage `openrouter-anthropic` accounts entirely through the dashboard UI. It mirrors the existing `openrouter` dashboard wiring across four files: the Add Account form (`AccountAddForm.tsx`), the API client (`api.ts`), the accounts container (`AccountsTab.tsx`), and the account card (`AccountListItem.tsx`).

Covers Phase 11 requirements: **MGMT-03** (add `openrouter-anthropic` account via the dashboard Add Account form) and **MGMT-04** (set/clear provider order for `openrouter-anthropic` accounts via the provider-preference dialog).

**In scope:** dropdown SelectItem + per-type form block in `AccountAddForm`, the `onAddOpenRouterAnthropicAccount` form prop + mode-union extensions, the `addOpenRouterAnthropicAccount` API client method, the `AccountsTab` handler + union + form prop wiring, and widening the provider-preference dialog gate in `AccountListItem` to include `openrouter-anthropic`.

**Out of scope:** live end-to-end integration test with a real `:free` model request (Phase 12). Provider class (Phase 9, done); type/CLI/HTTP/sniffer wiring (Phase 10, done) — `POST /api/accounts/openrouter-anthropic` already exists and is the submit target.

</domain>

<decisions>
## Implementation Decisions

### Add Account form fields (MGMT-03 / SC#1)
- **D-01:** **Mirror the `openrouter` block exactly** — API key field + optional Opus/Sonnet/Haiku model mappings, copy-pasted as a sibling `{newAccount.mode === "openrouter-anthropic" && (...)}` block. Maximum consistency with the existing OpenRouter UI path; no slimming, no field divergence.
- **D-02:** The new `SelectItem` uses the ROADMAP-locked label **`"OpenRouter Anthropic Messages (API Key)"`** (SC#1) and is placed **directly below the existing `openrouter` `SelectItem`** to group the two OpenRouter entries.
- **D-03:** Include an endpoint helper hint in the form block: **`Endpoint: https://openrouter.ai/api/v1 (native Anthropic Messages)`** — distinguishes it from the OAI-shape `openrouter` provider.
- **D-04:** Submit path mirrors `handleAddOpenRouterAccount` → `api.addOpenRouterAnthropicAccount` → `POST /api/accounts/openrouter-anthropic`. Add a dedicated `onAddOpenRouterAnthropicAccount` form prop and handler (one-prop-per-provider pattern), not a shared branch.

### Provider-preference dialog (MGMT-04 / SC#2)
- **D-05:** **Reuse the existing OpenRouter provider-preference path as-is.** Widen the gate in `AccountListItem.tsx:350` from `account.provider === "openrouter"` to `account.provider === "openrouter" || account.provider === "openrouter-anthropic"`. Reuse the same `/api/accounts/:id/openrouter-provider-preference` endpoint, the `openrouterProviderPreference` account field, and the existing `AccountOpenrouterProviderPreferenceDialog` component **without relabeling** — the endpoint is account-id-keyed and provider-agnostic, so no API or component changes are needed beyond the gate.

### Type-union extensions (mechanical)
- **D-06:** Extend the `mode`/`provider` string unions at every dashboard site that currently lists `"openrouter"` to also include `"openrouter-anthropic"`: `AccountAddForm` (props union, `newAccount.mode` state union, `Select.onValueChange` union, `accountParams` cast union), `api.ts:259`, `AccountsTab.tsx:120`. Add `// FORK PATCH:` annotations on every fork-specific addition for upstream-merge safety.

### Claude's Discretion
- Exact placement of the new `onAddOpenRouterAnthropicAccount` prop/handler within each file (follow the existing `openrouter` sibling location).
- Whether to extract the duplicated form block into a shared component vs. copy-paste — copy-paste is acceptable and consistent with the existing per-provider blocks; refactoring is optional and out of the success-criteria path.
- Test coverage approach for the widened dialog gate (the existing `AccountOpenrouterProviderPreferenceDialog.test.ts` is the nearest analog).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Code to modify / mirror
- `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` — add `SelectItem` (after the `openrouter` item, ~line 1051), the `{mode === "openrouter-anthropic"}` form block (mirror the `openrouter` block at lines 1665–1748), the `onAddOpenRouterAnthropicAccount` prop (~line 99), and extend all four `mode` unions (props ~17, state ~146, `onValueChange` ~1011, `accountParams` cast ~422).
- `packages/dashboard-web/src/api.ts` — add `addOpenRouterAnthropicAccount` mirroring `addOpenRouterAccount` (lines 481–488, POST to `/api/accounts/openrouter-anthropic`); extend the mode union at line 259. Provider-preference methods (lines 1329–1361) are reused **unchanged** for D-05.
- `packages/dashboard-web/src/components/AccountsTab.tsx` — add `handleAddOpenRouterAnthropicAccount` (mirror line 293), pass `onAddOpenRouterAnthropicAccount` to the form (mirror line 644), extend the union at line 120. Existing `handleProviderPreferenceChange`/`handleSetProviderPreference`/`handleClearProviderPreference` (lines 510–534) are reused unchanged for D-05.
- `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` — widen the provider-preference button gate at line 350 (D-05).

### Requirements / roadmap
- `.planning/REQUIREMENTS.md` — MGMT-03, MGMT-04 definitions (lines 42–43).
- `.planning/ROADMAP.md` "Phase 11" — the two success criteria this phase must make TRUE. **SC#1 is the authority for the exact dropdown label (D-02).**

### Prior-phase context
- `.planning/phases/10-type-wiring-cli-http-api-sse-sniffer/10-CONTEXT.md` — confirms dashboard sites were deferred here and that `POST /api/accounts/openrouter-anthropic` (the submit target) already exists.
- `.planning/research/ARCHITECTURE.md` §3 — enumerates the dashboard-side `"openrouter"` sites that need a sibling `"openrouter-anthropic"` branch.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The `openrouter` form block (`AccountAddForm.tsx:1665–1748`) — copy verbatim as the `openrouter-anthropic` block (D-01).
- `addOpenRouterAccount` (`api.ts:481–488`) — template for the new client method (D-04).
- `handleAddOpenRouterAccount` (`AccountsTab.tsx:293`) — template for the new container handler (D-04).
- `AccountOpenrouterProviderPreferenceDialog` + the `/openrouter-provider-preference` API methods + `handleProviderPreferenceChange` family — reused **unchanged** for `openrouter-anthropic` (D-05); the endpoint is account-id-keyed, not provider-specific.

### Established Patterns
- One-prop-per-provider in `AccountAddForm` (`onAddXxxAccount`) and one-handler-per-provider in `AccountsTab` (D-04 follows it).
- Per-provider `{newAccount.mode === "X" && (...)}` conditional form blocks (D-01 follows it).
- `// FORK PATCH:` annotation on every fork-specific addition (upstream merge safety) — already used for the existing provider-preference code (e.g. `AccountListItem.tsx:349`, `AccountsTab.tsx:76`).
- Sibling `=== "openrouter-anthropic"` / `|| "openrouter-anthropic"` conditions added next to existing `"openrouter"` checks.

### Integration Points
- Form submit → `api.addOpenRouterAnthropicAccount` → existing `POST /api/accounts/openrouter-anthropic` (Phase 10).
- Provider-preference button → existing `handleProviderPreferenceChange` → existing dialog → existing `/openrouter-provider-preference` endpoint, now also reachable for `openrouter-anthropic` cards via the widened gate.

</code_context>

<specifics>
## Specific Ideas

- ROADMAP SC#1 fixes the dropdown label string exactly: `"OpenRouter Anthropic Messages (API Key)"` — do not paraphrase.
- The provider-preference dialog component keeps its OpenRouter name/labels (D-05, no relabel) even though it now serves two providers — chosen for minimal diff and upstream-merge safety; revisit only if a third consumer appears.

</specifics>

<deferred>
## Deferred Ideas

- **Relabeling `AccountOpenrouterProviderPreferenceDialog`** to a provider-neutral name now that two providers use it — explicitly deferred (D-05 chose reuse-as-is for minimal diff).
- **Extracting the duplicated per-provider form blocks** into a shared component — optional refactor, out of the success-criteria path (Claude's Discretion).
- **Live end-to-end verification** of dashboard-created `openrouter-anthropic` accounts with a real `:free` request — Phase 12.

None of the above is scope creep into Phase 11 — discussion stayed within the dashboard-wiring boundary.

</deferred>

---

*Phase: 11-dashboard-wiring*
*Context gathered: 2026-06-04*
