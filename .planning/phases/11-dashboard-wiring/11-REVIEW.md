---
phase: 11-dashboard-wiring
reviewed: 2026-06-04T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - packages/dashboard-web/src/api.ts
  - packages/dashboard-web/src/components/AccountsTab.tsx
  - packages/dashboard-web/src/components/accounts/AccountAddForm.tsx
  - packages/dashboard-web/src/components/accounts/AccountListItem.tsx
  - packages/dashboard-web/src/components/accounts/__tests__/AccountAddForm.test.tsx
  - packages/dashboard-web/src/components/accounts/__tests__/AccountListItem.test.tsx
findings:
  critical: 0
  warning: 1
  info: 4
  total: 5
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-06-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the dashboard wiring for the `openrouter-anthropic` account mode (MGMT-03/04) plus the surrounding accounts UI. The new wiring is consistent end-to-end: the API method (`addOpenRouterAnthropicAccount`), the `AccountsTab` handler, the `AccountAddForm` mode/submit branch, and the `AccountListItem` provider-preference gate all align, and both test files match the implementation. No security issues or correctness bugs were found.

The findings are limited to one type-union drift that could cause a future compile/runtime mismatch, plus minor maintainability concerns (large duplicated form-reset blocks, an undocumented `ollama-cloud` mode gap, and `console.*` usage that diverges from project logging conventions).

## Warnings

### WR-01: `mode` union drift between state, submit cast, and parent unions

**File:** `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx:432-443` (vs state union `155-172`, props union `17-33`, onValueChange cast `1058-1073`)
**Issue:** Four separate `mode` string-literal unions are hand-maintained and have diverged. The `newAccount.mode` state union (155-172) includes `nanogpt`, `vertex-ai`, `qwen`, `codex`, `ollama`, `ollama-cloud`. The `accountParams` cast (432-443) omits all of those. The `onValueChange` cast (1058-1073) drops `nanogpt`, `vertex-ai`, and `alibaba-coding-plan`. This is currently safe because each omitted mode returns early before `accountParams` reaches `onAddAccount` — but the manual `as` assertion silently narrows the type, so a future mode that does NOT early-return (or a reordered branch) would pass an out-of-union value to `onAddAccount` with no compiler error.
**Fix:** Extract one shared type and reuse it everywhere instead of re-declaring the literal union in four places:
```ts
export type AccountMode =
  | "claude-oauth" | "console" | "zai" | "minimax"
  | "anthropic-compatible" | "openai-compatible" | "nanogpt"
  | "vertex-ai" | "bedrock" | "kilo" | "openrouter"
  | "openrouter-anthropic" | "alibaba-coding-plan"
  | "codex" | "qwen" | "ollama" | "ollama-cloud";
```
Type `newAccount.mode`, the `onValueChange` arg, and `accountParams.mode` against it, removing the hand-maintained casts.

## Info

### IN-01: `ollama-cloud` mode reachable in the form but absent from shared/parent unions

**File:** `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx:172`, `915`; `packages/dashboard-web/src/components/AccountsTab.tsx:107-125`
**Issue:** `AccountAddForm` supports `ollama-cloud` (state union 172, submit branch 915, SelectItem 1109) and calls `onAddOllamaCloudAccount`, which `AccountsTab` wires. But the `onAddAccount` prop union (17-33) and `AccountsTab.handleAddAccount` param union (107-125) do not list `ollama-cloud`. Benign today (it early-returns via its own callback) but reinforces WR-01's drift.
**Fix:** Include `ollama-cloud` when consolidating the shared `AccountMode` type, or add a comment noting it is intentionally handled only via `onAddOllamaCloudAccount`, never the OAuth `onAddAccount` path.

### IN-02: Duplication of the `setNewAccount({...})` form-reset block

**File:** `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx` (repeated ~14 times, e.g. lines 463-478, 504-519, 547-562, 625-640, 981-996, 1014-1029)
**Issue:** The identical 14-field reset object is copy-pasted after every provider branch and in `handleCodeSubmit`/`handleCancel`. A future field addition or default change must touch ~14 sites; missing one leaves stale state across add-account attempts.
**Fix:** Hoist `const INITIAL_ACCOUNT = { name: "", mode: "claude-oauth", ... } as const;` and call `setNewAccount({ ...INITIAL_ACCOUNT })` at each reset site.

### IN-03: `console.*` used directly instead of project `Logger`

**File:** `packages/dashboard-web/src/api.ts:111-124`; `packages/dashboard-web/src/components/accounts/AccountAddForm.tsx:244`
**Issue:** CLAUDE.md conventions say "use the `Logger` class (not `console.*`)". The dashboard `API` class wraps `console.log/warn/error/debug`, and `AccountAddForm:244` calls `console.error` in the AWS-profiles catch. This is browser-side code where the server SSE-backed `Logger` likely does not apply, so it reads as informational rather than a hard violation.
**Fix:** Confirm the dashboard is intentionally exempt from the server `Logger` convention; if so, no change needed.

### IN-04: Bedrock `customEndpoint` regex parse silently drops malformed values

**File:** `packages/dashboard-web/src/components/accounts/AccountListItem.tsx:111-118`
**Issue:** `account.customEndpoint.match(/^bedrock:([^:]+):(.+)$/)` leaves `bedrockProfile`/`bedrockRegion` null when the endpoint does not match, with no fallback display. Display-only (no crash), but a malformed/legacy `custom_endpoint` renders a bedrock account with no profile/region and no indication why.
**Fix:** Acceptable as-is for a display path. Optionally render the raw `customEndpoint` when the regex fails so misconfiguration is visible.

---

_Reviewed: 2026-06-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
