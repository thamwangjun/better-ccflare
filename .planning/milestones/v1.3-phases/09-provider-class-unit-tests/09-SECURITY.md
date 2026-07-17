---
phase: 09
slug: provider-class-unit-tests
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-03
---

# Phase 09 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| upstream OpenRouter response → provider cost parsing | `usage.cost` is attacker-influenceable-in-principle data from an external API, parsed into a numeric cost that persists to the DB | `usage.cost` (numeric, informational — not auth/secret) |
| account config (`openrouter_provider_preference`) → request body | Operator-supplied JSON string parsed and injected into the outbound `body.provider` routing field | provider routing JSON (operator-controlled) |
| `account.id` → `session_id` derivation | account.id hashed to a value sent to OpenRouter | account.id (internal UUID, not secret) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-9-01 | Tampering | `usage.cost` type confusion (string/null injected) in `extractUsageInfo` / `extractStreamingUsage` | mitigate | `typeof json.usage.cost === "number"` guard before attaching `costUsd`; null/string/absent → `undefined`, no estimate fallback for streaming. `provider.ts:148-151` (non-streaming), `:219` (streaming). Asserted by unit tests. | closed |
| T-9-02 | Tampering | Corrupt/malicious JSON in `openrouter_provider_preference` could throw or inject attacker-controlled provider routing | mitigate | Parse inside try/catch → on failure `log.warn` and skip injection (no throw, no partial body); `Array.isArray(pref.order) && pref.order.length > 0` guard; `!("provider" in body)` so a client-supplied value (incl. `{}`) is never overridden. `provider.ts:63-77`. Corrupt-JSON unit test asserts no throw, no provider field. | closed |
| T-9-03 | Information Disclosure | `session_id` derived from `account.id` could leak account.id if reversible | mitigate | SHA-256 one-way digest of account.id via `crypto.subtle.digest` (first 32 hex chars), not the raw id. account.id is an internal UUID, not secret. `provider.ts:82-92`. Stability + one-wayness asserted by unit tests. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Severity summary:** No HIGH threats. Surface is a provider class with mocked-fetch unit tests — no live I/O, no auth boundary, no new DB columns. All three threats are LOW and mitigated by typeof/`in`-operator guards and a one-way hash already standard in the codebase (`pkce.ts`).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|

No accepted risks.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-03 | 3 | 3 | 0 | /gsd-secure-phase (orchestrator verification) |

**Verification method:** Plan-time threat register (`register_authored_at_plan_time: true`) — short-circuit rule. All three plan-time mitigations verified present in `packages/providers/src/providers/openrouter-anthropic/provider.ts` and exercised by the 34-case `__tests__/provider.test.ts` suite (per 09-01-SUMMARY.md). No new-threat scan performed (register authored at plan time and complete).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-03
