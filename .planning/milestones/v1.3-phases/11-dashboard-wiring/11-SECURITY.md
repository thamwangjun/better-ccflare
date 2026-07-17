---
phase: 11
slug: dashboard-wiring
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-04
---

# Phase 11 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| dashboard UI → account-id-keyed REST endpoint | Provider-preference set/clear reuses the existing `/api/accounts/:id/openrouter-provider-preference` endpoint; no new boundary introduced (Plan 11-01) | account id, provider-preference selection |
| browser form → proxy REST endpoint | API key entered in the Add Account form is transmitted to the existing `POST /api/accounts/openrouter-anthropic` endpoint, same-origin via the dashboard (Plan 11-02) | OpenRouter Anthropic API key (secret) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-11-01 | Elevation of Privilege | Widened client gate exposing provider-preference button to openrouter-anthropic cards | accept | Endpoint is account-id-keyed and provider-agnostic; widening the client gate grants no capability the server does not already authorize per account. No new authorization path. | closed |
| T-11-02 | Information Disclosure | Test fixtures containing fake API keys | accept | Tests construct dummy account props with no real secrets; SSR markup is not persisted or logged. | closed |
| T-11-03 | Information Disclosure | API key echoed by `logger.debug(\`→ POST ${url}\`, { data })` in the mirrored `addOpenRouterAnthropicAccount` api method | accept | Pre-existing behavior mirrored verbatim from `addOpenRouterAccount`; no new key logging introduced. Key-redaction is a pre-existing concern out of this phase's scope — surfaced to user. | closed |
| T-11-04 | Tampering | Submit branch dispatching to the wrong endpoint | mitigate | Dedicated one-handler-per-provider submit branch (`AccountAddForm.tsx:758`) calls `onAddOpenRouterAnthropicAccount`, which posts only to `/api/accounts/openrouter-anthropic` (`api.ts:520`). Verified present. | closed |
| T-11-05 | Information Disclosure | API-key Input field type | mitigate | openrouter-anthropic form block (`AccountAddForm.tsx:1803`) uses `type="password"` Input (`:1809`), masking the key in the UI exactly as the existing openrouter provider. Verified present. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-11-01 | T-11-01 | Client gate widening grants no server capability not already authorized per account; endpoint is account-id-keyed and provider-agnostic. | Phase author (Plan 11-01) | 2026-06-04 |
| AR-11-02 | T-11-02 | Test fixtures use dummy props with no real secrets; SSR markup not persisted or logged. | Phase author (Plan 11-01) | 2026-06-04 |
| AR-11-03 | T-11-03 | Pre-existing `logger.debug` key echo mirrored verbatim from `addOpenRouterAccount`; redaction is an out-of-scope pre-existing concern surfaced to user. | Phase author (Plan 11-02) | 2026-06-04 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-04 | 5 | 5 | 0 | /gsd-secure-phase (orchestrator verification) |

Register authored at plan time (both PLAN files contained parseable `<threat_model>` blocks). `threats_open: 0` with all dispositions resolved → short-circuit verification per skill rule. Mitigate-disposition threats (T-11-04, T-11-05) verified directly against implementation; accept-disposition threats (T-11-01–03) documented in Accepted Risks Log.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-04
