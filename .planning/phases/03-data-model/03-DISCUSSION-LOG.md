# Phase 3: Data Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-05
**Phase:** 3-Data Model
**Areas discussed:** Account type representation, AccountResponse scope

---

## Account Type Representation

| Option | Description | Selected |
|--------|-------------|----------|
| `string \| null` (raw JSON) | Follows `model_mappings` pattern — Phase 4 `JSON.parse()`s when injecting `provider.order` | ✓ |
| `string[] \| null` (pre-parsed) | `toAccount()` parses once; Phase 4 uses directly. Deviates from existing pattern. | |
| You decide | Pick whichever fits better | |

**User's choice:** `string | null` (raw JSON)

| Option | Description | Selected |
|--------|-------------|----------|
| `// FORK PATCH: JSON string for OpenRouter provider.order preference` | Inline annotation on the field itself | ✓ |
| `// JSON string — OpenRouter provider.order preference` | Same style as `model_mappings`, FORK PATCH only on migration/repo code | |
| You decide | Pick whichever is cleaner | |

**User's choice:** `// FORK PATCH: JSON string for OpenRouter provider.order preference`

---

## AccountResponse Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — complete type chain in Phase 3 | Add `openrouterProviderPreference: string[] \| null` to AccountResponse + mapper now. Phase 5/6 no type changes needed. | ✓ |
| No — defer to Phase 5 | Phase 3 stops at Account + AccountRow + repository. Phase 5 adds to AccountResponse. | |

**User's choice:** Yes — complete type chain in Phase 3

| Option | Description | Selected |
|--------|-------------|----------|
| `string[] \| null` (parsed array) | Parse in `toAccountResponse()` — consistent with `modelMappings` pattern | ✓ |
| `string \| null` (raw pass-through) | Skip parsing, inconsistent with `modelMappings` precedent | |
| You decide | Pick whichever is cleaner | |

**User's choice:** `string[] | null` (parsed array)

---

## Claude's Discretion

- Repository method naming for the UPDATE query (dedicated method vs inline)
- JSON parse guard style in `toAccountResponse()` — follow `modelMappings` try/catch pattern

## Deferred Ideas

None.
