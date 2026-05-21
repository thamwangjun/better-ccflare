---
status: complete
phase: 06-dashboard-ui-maintenance-hardening
source: [06-VERIFICATION.md]
started: 2026-05-21T05:45:00Z
updated: 2026-05-21T08:30:00Z
---

## Current Test

All 3 UAT tests completed and passed.

## Tests

### 1. Provider Preferences dropdown item visibility (SC-1)
expected: "Provider Preferences" dropdown item appears only on OpenRouter accounts, not on Anthropic/Bedrock/other accounts
result: PASSED — Provider Preferences appears only on OpenRouter accounts, as expected.

### 2. Save preference → proxy injects provider order (SC-2)
expected: With a non-Anthropic test account (use ollama, litellm, omniroute, or similar; force-route with x-better-ccflare-account-id), save a provider list in the dialog and confirm the proxy injects `provider.order` in the upstream request body
result: PASSED — nc output confirmed `"provider":{"order":["anthropic/claude-3-5-sonnet"],"allow_fallbacks":true}` in the upstream body after saving preference.

### 3. Clear preference → proxy stops injecting (SC-3)
expected: After clearing the preference via the dialog, confirm the upstream request body no longer contains a `provider` field
result: PASSED — nc output confirmed no "provider" field in upstream body after clearing preference.

### 4. Discard Changes discards unsaved edits (SC-4)
expected: Open the dialog, type something new in the Provider Order field, click "Discard Changes", then reopen the dialog — the original saved value should be restored, not the unsaved edit
result: PASSED — original saved value restored on reopen after clicking Discard Changes.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
