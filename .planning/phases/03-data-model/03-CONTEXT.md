# Phase 3: Data Model - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the account schema with an `openrouter_provider_preference TEXT DEFAULT NULL` column. Deliver the complete type chain: DB migration → `AccountRow` → `Account` domain type → repository SELECT/UPDATE queries → `AccountResponse` + mapper. All changes annotated with `// FORK PATCH:`. No API endpoint (Phase 5), no UI (Phase 6), no proxy injection logic (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Account Type Representation

- **D-01:** `openrouter_provider_preference` is typed as `string | null` in both `AccountRow` and `Account` — raw JSON string, consistent with the `model_mappings` pattern. Phase 4 will `JSON.parse()` when constructing `provider.order`.
- **D-02:** Inline field comment on both `AccountRow` and `Account`: `// FORK PATCH: JSON string for OpenRouter provider.order preference`

### AccountResponse Scope

- **D-03:** Phase 3 completes the full type chain — `openrouterProviderPreference: string[] | null` is added to `AccountResponse` and `toAccountResponse()` parses the raw JSON string into an array (same pattern as `modelMappings`). Phases 5 and 6 can read/display the field without further type changes.

### Claude's Discretion

- Repository method naming and placement (dedicated `updateOpenrouterProviderPreference()` vs inline query) — follow the existing pattern for similar fields (e.g., `billing_type`)
- Whether to add a try/catch around the JSON parse in `toAccountResponse()` — follow the same guard pattern used for `modelMappings`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements

- `.planning/REQUIREMENTS.md` §PROV-02 — Locked requirement: field name, column type (`openrouter_provider_preference TEXT DEFAULT NULL`), annotation requirement (`// FORK PATCH:`), and what must be updated (schema, type, repository SELECT/UPDATE, facade)

### Existing Schema & Type Patterns

- `packages/database/src/migrations.ts` — Migration pattern: `ALTER TABLE accounts ADD COLUMN <field> TEXT DEFAULT NULL` applied at a new migration version. The last migration is the reference point for the new version number.
- `packages/types/src/account.ts` — Contains `AccountRow`, `Account`, `AccountResponse`, `toAccount()`, `toAccountResponse()` — all four must be updated
- `packages/database/src/repositories/account.repository.ts` — Repository SELECT columns list and UPDATE methods; add `openrouter_provider_preference` to SELECT and add an UPDATE method
- `packages/database/src/database-operations.ts` — Facade layer; check if it delegates preference updates or wraps them

### Fork Patch Convention

- `.planning/PROJECT.md` §Key Decisions — Annotation requirement: every fork-specific code block carries `// FORK PATCH:`
- `packages/providers/src/providers/openrouter/provider.ts` — Reference for existing `// FORK PATCH:` annotation style in this codebase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `toAccount()` in `packages/types/src/account.ts` — Maps `AccountRow` to `Account`. The `billing_type` and `model_mappings` fields are the direct template for adding `openrouter_provider_preference`.
- `toAccountResponse()` in `packages/types/src/account.ts` — The `modelMappings` handling (JSON.parse with try/catch guard) is the template for parsing `openrouter_provider_preference` to `string[] | null`.

### Established Patterns

- **Column addition pattern:** `ALTER TABLE accounts ADD COLUMN <field> TEXT DEFAULT NULL` in migrations (see `billing_type` at migration ~v443, `cross_region_mode` at ~v429)
- **SELECT list pattern:** All column-addition phases add the new field to both the `getAccount()` and `getAccounts()` SELECT lists in the repository
- **`// FORK PATCH:` annotation:** Comment goes on the line directly preceding or inline with the fork-specific code block (not on a separate block comment)
- **JSON field in `AccountResponse`:** Parse in `toAccountResponse()`, type as `FieldType | null`, guard with try/catch (see `modelMappings`)

### Integration Points

- Migration runs on startup via `packages/database/src/migrations.ts` — adding to the latest migration version (or a new one) ensures existing DBs get the column without data loss
- `AccountRow` → `Account` via `toAccount()` in `packages/types/src/account.ts` — new field flows through here
- `Account` → `AccountResponse` via `toAccountResponse()` — Phase 3 adds `openrouterProviderPreference: string[] | null` here
- Phase 4 will read `account.openrouter_provider_preference` (the `string | null` field on `Account`) directly from `ProxyContext`

</code_context>

<specifics>
## Specific Ideas

No specific references beyond the established patterns. Implementation follows the `model_mappings` / `billing_type` template exactly.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 3-Data Model*
*Context gathered: 2026-05-05*
