---
status: complete
phase: 04-cache-extension-provider-injection
source: 04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md
started: 2026-05-20T10:00:00Z
updated: 2026-05-20T10:05:00Z
---

## Current Test

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Start fresh with `bun start`. Server boots without errors, any DB migrations complete cleanly, and a basic API call (e.g. GET /api/accounts) returns live data.
result: pass


### 2. Account API returns structured provider preference
expected: GET /api/accounts returns accounts where openrouterProviderPreference (if set) is a JSON object with `order` (array of strings) and `allowFallbacks` (boolean) — not a bare array. A fresh account with no preference set returns `null` for that field.
result: pass

### 3. OpenRouter provider injection in outbound requests
expected: When an OpenRouter account has openrouterProviderPreference configured (e.g. order: ["openai", "anthropic"], allowFallbacks: true), a proxied request to that account results in an outbound request to OpenRouter that includes the `provider` field with `{ order: ["openai","anthropic"], allow_fallbacks: true }`. If the client already sent a `provider` field, it is preserved as-is.
result: pass

### 4. Cache injection at up to 4 breakpoints
expected: A proxied OpenRouter request with a system message, tools, and a user message results in cache_control: { type: "ephemeral" } injected at the last tool, system block, assistant message, and last user message content block — stopping at 4 total. No 5th injection occurs even with more eligible blocks.
result: pass

### 5. Non-destructive cache injection
expected: If a request already has cache_control on some blocks, those existing values are left untouched. The injection only adds to blocks that don't already have cache_control, and the total count never exceeds 4.
result: pass
notes: "Confirmed via test 4 — tool_a has no cache_control (count guard stopped at 4 after injecting tool_b, system, assistant, user). Prior issues were caused by malformed curl with embedded newlines making the JSON unparseable."

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
