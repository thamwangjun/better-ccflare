# Phase 11: Dashboard Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 11-dashboard-wiring
**Areas discussed:** Form fields, Provider-preference dialog, Dropdown placement

---

## Form fields

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror openrouter exactly | API key + optional Opus/Sonnet/Haiku model mappings, identical to the openrouter block | ✓ |
| API key only (no mappings) | Native Anthropic endpoint passes Claude models through; mappings arguably don't apply | |
| API key + mappings, different hint | Same fields, updated helper text for native endpoint | |

**User's choice:** Mirror openrouter exactly
**Notes:** Copy-paste the existing openrouter form block as a sibling for max consistency.

---

## Provider-preference dialog

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing openrouter path | Widen gate, reuse endpoint/field/dialog as-is | ✓ |
| Reuse path, relabel dialog | Same reuse but make dialog title provider-neutral | |

**User's choice:** Reuse existing openrouter path
**Notes:** Endpoint is account-id-keyed and provider-agnostic; only the gate at AccountListItem.tsx:350 needs widening. No API/component changes.

---

## Dropdown placement

| Option | Description | Selected |
|--------|-------------|----------|
| Directly below OpenRouter | Group the two OpenRouter entries; add native-endpoint hint | ✓ |
| Below OpenRouter, no extra hint | Place next to OpenRouter, minimal block | |

**User's choice:** Directly below OpenRouter
**Notes:** Helper hint `Endpoint: https://openrouter.ai/api/v1 (native Anthropic Messages)`. Label locked by ROADMAP SC#1.

---

## Claude's Discretion

- Exact placement of the new prop/handler within each file (follow openrouter sibling location).
- Copy-paste vs. shared-component extraction for the form block (copy-paste acceptable).
- Test coverage approach for the widened dialog gate.

## Deferred Ideas

- Relabeling the provider-preference dialog to a provider-neutral name (chose reuse-as-is).
- Extracting duplicated per-provider form blocks into a shared component.
- Live end-to-end verification (Phase 12).

## Notes

Advisor-mode external research was intentionally skipped: every decision is codebase-mirroring of the existing `openrouter` dashboard path, not a general technology trade-off. Vendor philosophy: pragmatic; calibration tier: standard.
