---
phase: 06
slug: dashboard-ui-maintenance-hardening
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-21
---

# Phase 06 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser ↔ Dashboard API | React SPA communicates with server REST endpoints for account CRUD and preference updates | Account metadata, provider preference strings (non-sensitive) |
| Proxy ↔ Upstream providers | Provider preference header injected into outbound requests | Provider name strings (non-sensitive configuration) |
| Test harness ↔ nc echo server | Local-only nc listener captures upstream request body for test assertion | Request payload; local terminal only, no data leaves host |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-06-01-01 | Tampering | test assertions | accept | Test file is not production code; no user-facing trust boundary | closed |
| T-06-02-01 | Tampering | PUT body key casing | mitigate | `putAccountOpenrouterProviderPreference` sends `{ allow_fallbacks }` in snake_case — verified against `accounts.ts` handler which reads `body.allow_fallbacks` | closed |
| T-06-02-02 | Tampering | Malformed provider names | accept | Server-side validation in `accounts.ts` (lines 3602–3614) validates each element is a non-empty string; client `filter(Boolean)` removes blanks | closed |
| T-06-02-03 | Tampering | XSS via provider name in title attribute | accept | React renders `title` as a text attribute (not `innerHTML`); no XSS risk | closed |
| T-06-03-01 | Tampering | pre-merge-check.sh path accuracy | mitigate | Paths added to `HIGH_RISK_FILES` are exact repo-root-relative strings matching `git diff --name-only` format (no leading slash) — verified in 06-03-SUMMARY | closed |
| T-06-03-02 | Repudiation | FORK PATCH audit completeness | mitigate | `grep` count of 27 annotation blocks provides objective evidence; all required `FORK PATCH` blocks confirmed annotated — recorded in 06-03-SUMMARY | closed |
| T-06-04-01 | Information Disclosure | nc echo server (SC-2/SC-3 test) | accept | `nc` is a local listener; upstream body captured only in local terminal session; no data leaves the host | closed |
| T-06-04-02 | Spoofing | x-better-ccflare-account-id header | accept | Header used in test context only to force-route to a non-Anthropic account — this is the CLAUDE.md-approved test pattern | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-06-01 | T-06-01-01 | Test file imposes no user-facing trust boundary; tampering risk is contained to test assertions only | thamw | 2026-05-21 |
| AR-06-02 | T-06-02-02 | Malformed provider names are already rejected server-side; client-side `filter(Boolean)` is defence-in-depth, not the sole control | thamw | 2026-05-21 |
| AR-06-03 | T-06-02-03 | React's JSX attribute rendering is text-safe by framework guarantee; no injection vector exists | thamw | 2026-05-21 |
| AR-06-04 | T-06-04-01 | nc listener is local-only; no credentials or PII cross a network boundary during test execution | thamw | 2026-05-21 |
| AR-06-05 | T-06-04-02 | Force-routing via `x-better-ccflare-account-id` is an approved test pattern documented in CLAUDE.md; not used in production flows | thamw | 2026-05-21 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-21 | 8 | 8 | 0 | gsd-security-auditor (short-circuit: all plan-time threats verified CLOSED) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-21
