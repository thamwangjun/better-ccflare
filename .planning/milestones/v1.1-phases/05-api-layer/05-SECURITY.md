---
phase: 5
slug: api-layer
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-20
---

# Phase 5 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| test → handler | Tests call handler functions directly with Request objects — no network boundary | HTTP Request/Response objects; JSON payloads |
| client → router | Incoming HTTP request with accountId path param — untrusted | accountId (path param), JSON body (PUT) |
| router → handler | Dispatches accountId extracted from URL path to handler function | accountId string (validated by handler) |
| handler → DB | dbOps.setAccountOpenrouterProviderPreference — parameterized SQL, no injection surface | order array (JSON), allow_fallbacks (boolean), accountId |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-05-01 | Tampering | PUT body deserialization | mitigate | order array validated: non-empty, all string items; allow_fallbacks coerced to boolean. Tests T-05/T-06/T-07 prove 400 for invalid input. All 11 tests pass. | closed |
| T-05-02 | Elevation of Privilege | PUT/DELETE on non-existent account | mitigate | 404 guard reads account from DB before any mutation. Tests T-08/T-09 prove 404 for missing account. All 11 tests pass. | closed |
| T-05-03 | Information Disclosure | Error messages in catch block | accept | Errors return generic message strings; no PII or internal DB details exposed in errorResponse output. | closed |
| T-05-04 | Denial of Service | Large order array in PUT body | accept | No max-length enforcement; array stored as JSON string with no compute-intensive processing. Operator-only endpoint, low risk. | closed |
| T-05-05 | Spoofing | DELETE /api/accounts/:id/openrouter-provider-preference | accept | API key auth enforced at router's outer auth middleware (pre-existing); handler runs only for authenticated callers. | closed |
| T-05-06 | Tampering | DELETE path — wrong handler matched | mitigate | DELETE block placed before generic account-removal block (parts.length === 4 && method === "DELETE"). Confirmed in router.ts: DELETE dispatch at line 632 precedes Account removal at line 647. | closed |
| T-05-07 | Information Disclosure | 404 response body | accept | Returns standard "Account not found" string — no DB internals, no stack traces in production error responses. | closed |
| T-05-08 | Denial of Service | Repeated DELETE to clear non-existent account | accept | Returns 404 immediately after single DB read; no expensive operations. Low risk. | closed |
| T-05-09 | Elevation of Privilege | DELETE clears another account's preference | accept | accountId extracted from authenticated request path; caller must have valid API key. Consistent with existing handler patterns — no RBAC at this layer. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-01 | T-05-03 | Error messages use generic strings with no PII/DB internals; no additional masking required for operator-only endpoint. | plan-time | 2026-05-20 |
| AR-05-02 | T-05-04 | No max-length on order array; payload stored as JSON string, no CPU-intensive transform. Endpoint is operator-only (API key required), making amplification attacks impractical. | plan-time | 2026-05-20 |
| AR-05-03 | T-05-05 | Auth is handled by pre-existing outer middleware; re-implementing auth at the handler layer would be inconsistent with all other handlers in this codebase. | plan-time | 2026-05-20 |
| AR-05-04 | T-05-07 | 404 body is a static string constant — no dynamic data included. Acceptable disclosure level. | plan-time | 2026-05-20 |
| AR-05-05 | T-05-08 | Single DB read per request; 404 path is O(1). No throttling required at this layer. | plan-time | 2026-05-20 |
| AR-05-06 | T-05-09 | RBAC is not implemented in this codebase at the handler layer. All existing handlers follow the same pattern. Scope is a single account preference field — blast radius is minimal. | plan-time | 2026-05-20 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-20 | 9 | 9 | 0 | gsd-secure-phase (short-circuit: register_authored_at_plan_time=true, threats_open=0) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-20
