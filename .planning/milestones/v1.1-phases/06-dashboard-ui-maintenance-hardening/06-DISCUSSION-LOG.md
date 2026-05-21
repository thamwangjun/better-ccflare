# Phase 6: Dashboard UI & Maintenance Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 6-Dashboard UI & Maintenance Hardening
**Areas discussed:** allow_fallbacks toggle UX, Clearing behavior, Dialog entry point, MAINT-05 audit scope

---

## allow_fallbacks toggle UX

| Option | Description | Selected |
|--------|-------------|----------|
| Radix Switch, default ON | Matches existing Switch usage in AccountListItem; labeled "Allow fallbacks" row | ✓ |
| Checkbox row | Similar look but uses Checkbox component; less consistent with account row pattern | |

**User's choice:** Radix Switch, default ON

---

### Empty order + Save behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Save is blocked | Require at least one provider entry; show inline error if order is empty | |
| Clear the preference entirely (call DELETE) | Empty order on Save = no preference = call DELETE regardless of toggle state | ✓ |
| You decide | Claude uses best judgment | |

**User's choice:** Clear the preference entirely (call DELETE)

---

## Clearing behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, empty + Save is enough | No separate button; matches AccountModelMappingsDialog clearing pattern | ✓ |
| Also add a 'Clear All' button | Explicit affordance; third button in footer alongside Cancel/Save | |

**User's choice:** Yes, empty + Save is enough

---

## Dialog entry point

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown menu item | Consistent with Model Mappings; zero visual noise for non-OpenRouter accounts | ✓ |
| Inline icon/button on the row | More discoverable but breaks row layout consistency | |

**User's choice:** Dropdown menu item

---

## MAINT-05 audit scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full v1.1 scan | Scan all files modified in phases 3–6; comprehensive before merge | ✓ |
| Phase 6 additions only | Trust prior phases; faster but risks missing a forgotten annotation | |

**User's choice:** Full v1.1 scan

---

## Claude's Discretion

- Dialog component name and file location (follow AccountModelMappingsDialog naming)
- `onProviderPreferenceChange` callback prop wiring (follow `onModelMappingsChange` pattern)
- Order of "Provider Preferences" item in the dropdown menu (adjacent to "Model Mappings")
- AccountsTab mutation wiring (follow `updateModelMappings` pattern)
- Input placeholder text for provider order field

## Deferred Ideas

None — discussion stayed within phase scope.
