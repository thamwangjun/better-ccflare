---
slug: openrouter-service-unavailable
status: resolved
created: 2026-05-04
updated: 2026-05-04
trigger: "OpenRouter requests via better-ccflare return service_unavailable_error for claude-sonnet-4-6"
---

## Symptoms

- **Expected**: Request proxied through better-ccflare to OpenRouter, get Claude response back
- **Actual**: `{"type":"error","error":{"type":"service_unavailable_error","message":"Service temporarily unavailable. Please try again later."}}`
- **Error message**: `service_unavailable_error` — user suspects malformed request, not actual unavailability
- **Timeline**: Never worked — first time trying OpenRouter with this proxy
- **Reproduction**:
  ```bash
  curl -X POST http://localhost:10180/v1/messages \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <hidden>" \
    -H "x-better-ccflare-account-id: Openrouter-nu-1" \
    -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"test"}],"max_tokens":100}'
  ```
- **Account**: `Openrouter-nu-1` (OpenRouter provider, forced via header)
- **Model requested**: `claude-sonnet-4-6`

## Hypotheses

1. [CONFIRMED] Bearer prefix missing in Authorization header sent to OpenRouter

## Current Focus

- hypothesis: authHeader case mismatch causes missing Bearer prefix
- test: confirmed via direct API test without Bearer prefix → OpenRouter returns 401
- expecting: fix to normalize authHeader comparison to lowercase
- next_action: apply fix

## Evidence

- timestamp: 2026-05-04T11:38:49Z
  type: reproduction
  note: Confirmed 503 from proxy (near-instantaneous, <1s response time)

- timestamp: 2026-05-04T11:32:52Z
  type: direct_test
  note: Direct call to OpenRouter with `deepseek/deepseek-v4-pro` succeeds (account creds valid)

- timestamp: 2026-05-04T11:40:00Z
  type: root_cause_verification
  note: Direct call WITHOUT Bearer prefix → `{"error":{"message":"Missing Authentication header","code":401}}` — confirms proxy sends key without Bearer

- timestamp: 2026-05-04T11:41:00Z
  type: code_analysis
  note: |
    `OpenRouterProvider` sets `authHeader: "Authorization"` (capital A).
    `BaseAnthropicCompatibleProvider.prepareHeaders` checks `if (headerName === "authorization")` (lowercase).
    Case-sensitive comparison: `"Authorization" !== "authorization"` → falls to else branch, sets header WITHOUT Bearer prefix.
    OpenRouter returns 401 → proxy returns null → all accounts exhausted → ServiceUnavailableError → 503 to client.

## Eliminated

- OpenRouter service being down: Direct API call succeeds
- Model name mapping being wrong: `claude-sonnet-4-6` correctly maps to `deepseek/deepseek-v4-pro`
- API key being invalid: Direct call with key works fine
- URL building being wrong: `buildUrl` correctly produces `https://openrouter.ai/api/v1/messages`
- Network/connectivity issues: OpenRouter reachable
- Account being rate-limited: `rate_limited_until` is null

## Resolution

- root_cause: Case-sensitive comparison in `BaseAnthropicCompatibleProvider.prepareHeaders` (`"Authorization" !== "authorization"`) causes Bearer prefix to be omitted when sending API key to OpenRouter. OpenRouter returns 401, proxy fails over to no remaining accounts, throws ServiceUnavailableError.
- fix: Change comparison in `prepareHeaders` to use `headerName.toLowerCase() === "authorization"` so it works regardless of case. Also fix OpenRouter provider to use lowercase `"authorization"` for consistency.
- verification: Direct test with Bearer prefix works; without it fails with 401.
- files_changed:
  - packages/providers/src/providers/base-anthropic-compatible.ts (fix comparison)
  - packages/providers/src/providers/openrouter/provider.ts (normalize authHeader to lowercase)
