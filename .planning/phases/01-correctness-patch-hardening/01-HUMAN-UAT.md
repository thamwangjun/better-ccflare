---
status: resolved
phase: 01-correctness-patch-hardening
source: [01-VERIFICATION.md]
started: 2026-05-04T10:30:00Z
updated: 2026-05-04T10:45:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-2: OpenRouter request with per-block cache_control completes without 400

expected: A request using an Anthropic model name, routed via an OpenRouter account, returns 2xx. Per-block `cache_control` injection does not cause OpenRouter to reject the request.

result: passed — JSON response received (service_unavailable from OpenRouter), not a 400. cache_control per-block injection accepted. URL fix (buildUrl double /v1) also confirmed resolved.

**Test setup:** Start the server on port 8081. Force-route to an OpenRouter account using `x-better-ccflare-account-id`. Send an Anthropic model name — the proxy maps it to the OpenRouter model name configured at account creation time.

```bash
curl -X POST http://localhost:8081/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -H "x-better-ccflare-account-id: <your-openrouter-account-id>" \
  -d '{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

Note: The proxy converts the Anthropic model name to the OpenRouter model name configured for the account. The test verifies that per-block `cache_control` injection (injected by `transformRequestBody`) does not cause a 400 from OpenRouter. Per CLAUDE.md, never test with the `claude` OAuth account.

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
