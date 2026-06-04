### Phase 11: Dashboard Wiring

**Goal**: Users can create and manage `openrouter-anthropic` accounts entirely through the dashboard UI, with the provider-preference dialog available for the new account type
**Depends on**: Phase 10
**Requirements**: MGMT-03, MGMT-04
**Success Criteria** (what must be TRUE):

  1. The Add Account form surfaces `"OpenRouter Anthropic Messages (API Key)"` as a selectable mode option and successfully submits account creation to `POST /api/accounts/openrouter-anthropic`
  2. An `openrouter-anthropic` account card in the accounts list displays the provider-preference settings button (the dialog gate is widened from `openrouter`-only)

**Plans**: 2 plans
Plans:

**Wave 1**

- [ ] 11-01-PLAN.md — Wave 0 SSR tests (MGMT-03 form-render RED, MGMT-04 gate) + the provider-preference gate widen (MGMT-04 complete)

**Wave 2** *(depends on 11-01: form-render test must exist first)*

- [ ] 11-02-PLAN.md — MGMT-03 full add-account wiring: SelectItem + form block + submit branch (AccountAddForm), addOpenRouterAnthropicAccount (api.ts), handler + prop pass-through (AccountsTab)

**UI hint**: yes
