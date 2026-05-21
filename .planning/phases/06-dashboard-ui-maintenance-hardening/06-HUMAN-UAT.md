---
status: partial
phase: 06-dashboard-ui-maintenance-hardening
source: [06-VERIFICATION.md]
started: 2026-05-21T05:45:00Z
updated: 2026-05-21T05:45:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Provider Preferences dropdown item visibility (SC-1)
expected: "Provider Preferences" dropdown item appears only on OpenRouter accounts, not on Anthropic/Bedrock/other accounts
result: [pending]

### 2. Save preference → proxy injects provider order (SC-2)
expected: With a non-Anthropic test account (use ollama, litellm, omniroute, or similar; force-route with x-better-ccflare-account-id), save a provider list in the dialog and confirm the proxy injects `provider.order` in the upstream request body
result: [pending]

### 3. Clear preference → proxy stops injecting (SC-3)
expected: After clearing the preference via the dialog, confirm the upstream request body no longer contains a `provider` field
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
