# Codebase Concerns

**Analysis Date:** 2026-05-04

---

## CRITICAL

### Internal Control Headers Are Not Stripped from External Requests

- **Issue:** The `x-better-ccflare-account-id` and `x-better-ccflare-bypass-session` headers are special internal control headers. Any external caller who knows these header names can force the proxy to route their request to a specific account by name, and can bypass session tracking. The server entry point (`apps/server/src/server.ts`, lines 884–932) passes the raw `req` object directly to `handleProxy` without stripping these headers first.
- **Files:** `apps/server/src/server.ts:932`, `packages/proxy/src/handlers/account-selector.ts:76-102`
- **Impact:** An authenticated user with a valid API key (even an `api`-role key) can target any specific account in the pool, and can suppress session tracking counters that feed the auto-pause-on-overage logic. If the proxy is exposed to an untrusted network or multi-tenant, this is a privilege-escalation vector.
- **Fix approach:** Strip `x-better-ccflare-*` control headers from all inbound requests in the server entry point before calling `handleProxy`. Only allow the scheduler and keepalive code paths (which originate on `localhost`) to set those headers.

---

### Debug Log Dumps Full HTTP Headers (Including Auth Tokens)

- **Issue:** `packages/proxy/src/auto-refresh-scheduler.ts:394-395` logs all request headers at `log.debug` level with `JSON.stringify(Object.fromEntries(headers.entries()))`. Those headers include the proxied access token (`Authorization: Bearer ...`) if one is present. Any operator who enables debug mode (`BETTER_CCFLARE_DEBUG=1` or `DEBUG=true`) gets access tokens in their log file.
- **Files:** `packages/proxy/src/auto-refresh-scheduler.ts:391-396`
- **Impact:** Token exposure in debug logs. Lower risk since debug mode is opt-in, but production systems sometimes enable debug mode during incidents.
- **Fix approach:** Before logging, redact headers whose names match `authorization`, `x-api-key`, `cookie`.

---

## HIGH

### Authentication Disabled by Default (No API Keys = Open Access)

- **Issue:** The entire proxy (all `/v1/*` routes and all `/api/*` routes) is open to unauthenticated access until at least one API key is created. The `isAuthenticationEnabled()` check in `packages/http-api/src/services/auth-service.ts:29-30` returns `false` when the `api_keys` table has no active rows, causing `authenticateRequest` to return `isAuthenticated: true` unconditionally (line 218).
- **Files:** `packages/http-api/src/services/auth-service.ts:29-30`, `packages/http-api/src/services/auth-service.ts:216-219`
- **Impact:** A freshly installed instance exposed on a LAN or cloud without immediate API key setup is fully open. All stored OAuth tokens and proxied traffic are accessible.
- **Fix approach:** Warn loudly at startup when no API keys exist. Consider requiring at least a static env-variable secret (`BETTER_CCFLARE_SECRET`) before any request is served.

### All OAuth Endpoints Are Authentication-Exempt

- **Issue:** `packages/http-api/src/services/auth-service.ts:148-150` exempts all paths starting with `/api/oauth` from authentication. This covers `POST /api/oauth/anthropic/reauth/init`, `POST /api/oauth/qwen/init`, etc. — endpoints that trigger outbound OAuth flows and can be used to re-authenticate accounts.
- **Files:** `packages/http-api/src/services/auth-service.ts:148-150`, `packages/http-api/src/router.ts:249-268`
- **Impact:** An unauthenticated attacker can initiate re-authentication flows for any account (invalidating active tokens) even when API key auth is enabled. Combined with the default open-access concern above, this is a DoS and account-takeover risk.
- **Fix approach:** Require authentication for `reauth` endpoints (only exempt the initial PKCE callback, which must accept browser redirects). Consider an allow-list instead of a prefix match.

### Request Payloads (Including Conversation Content) Stored in Plaintext by Default

- **Issue:** `packages/proxy/src/post-processor.worker.ts:838-842` stores full request and response bodies (conversation content) in the `request_payloads` table. The optional `PAYLOAD_ENCRYPTION_KEY` in `packages/database/src/payload-encryption.ts:47-50` is clearly documented as opt-in; without it, payloads are plaintext in the SQLite database at `~/.config/better-ccflare/better-ccflare.db`.
- **Files:** `packages/proxy/src/post-processor.worker.ts:813-842`, `packages/database/src/payload-encryption.ts:47-50`
- **Impact:** All user conversations (including system prompts, tool calls, and potentially PII) are persisted on disk without encryption. Attacker with filesystem access gets full conversation history.
- **Fix approach:** Document the encryption key setup more prominently. Optionally generate and persist a random key at first run.

### Body Parsed Multiple Times Per Request in Hot Path

- **Issue:** The request body `ArrayBuffer` is deserialized from UTF-8 and parsed as JSON in at least five distinct places for a single proxied request: `proxy.ts:142-144` (model extraction), `proxy.ts:361` (cache TTL injection), `proxy-operations.ts:105-106` (thinking-block filter), `proxy-operations.ts:429-430` (model override patch), and `proxy-operations.ts:579-582` (model extraction for fallback). Each call allocates a new string and a new parsed object.
- **Files:** `packages/proxy/src/proxy.ts:142`, `packages/proxy/src/handlers/proxy-operations.ts:105,429,580`
- **Impact:** CPU and allocator pressure proportional to body size on every request. For large conversation contexts (4MB cap), this creates sustained GC pauses.
- **Fix approach:** Parse the body once in `handleProxy` and pass the parsed object as a parameter to downstream functions, or attach it to `RequestMeta`.

### `getAllAccounts()` Hits SQLite on Every Request

- **Issue:** `packages/proxy/src/handlers/account-selector.ts:37` calls `ctx.dbOps.getAllAccounts()` for every proxied request. `getAllAccounts` delegates to `AccountRepository.findAll()` with retry wrapping but no in-memory cache. With 20+ accounts and sustained load, this is a synchronous SQLite read on every request.
- **Files:** `packages/proxy/src/handlers/account-selector.ts:37`, `packages/database/src/database-operations.ts:334-340`
- **Impact:** SQLite reads under load contend with concurrent writes from the async writer, increasing latency and reducing throughput.
- **Fix approach:** Add a short-lived in-memory account cache (e.g., 500 ms TTL) with invalidation on account create/update/delete events.

---

## MEDIUM

### TODO: Custom Endpoints Not Supported for Console Accounts

- **Issue:** `packages/http-api/src/handlers/accounts.ts:557` has an explicit TODO noting that custom endpoints for Claude API (console) accounts are not implemented for enterprise users who have their own Anthropic API deployments.
- **Files:** `packages/http-api/src/handlers/accounts.ts:557`
- **Impact:** Enterprises with custom Anthropic API endpoints cannot use console account mode. They must work around it with `anthropic-compatible` provider mode.
- **Fix approach:** Implement custom endpoint support for console accounts following the existing pattern in anthropic-compatible provider.

### Dead Code: `_extractSystemPrompt()` in Post-Processor Worker

- **Issue:** `packages/proxy/src/response-handler.ts:126-131` contains a TODO comment noting that `_extractSystemPrompt()` in the post-processor worker is dead code — the agent interceptor handles that on the main thread. The worker still receives `requestBody` via the `StartMessage` postMessage boundary (a structured-clone copy of up to 256 KB per request) solely to feed this unused code path.
- **Files:** `packages/proxy/src/response-handler.ts:126-131`, `packages/proxy/src/post-processor.worker.ts`
- **Impact:** Unnecessary cross-worker data transfer (up to 256 KB per request), increasing structured-clone overhead.
- **Fix approach:** Remove `_extractSystemPrompt()` from the worker and remove `requestBody` from `StartMessage`. Write the payload directly from the main thread.

### `model_fallbacks` Field Is Deprecated but Still Active

- **Issue:** `packages/core/src/model-mappings.ts:153-155` documents that `model_fallbacks` is deprecated in favour of `model_mappings` arrays, but the field is still read and merged at runtime for every request. The `Account` type in `packages/types/src/account.ts` still carries the field.
- **Files:** `packages/core/src/model-mappings.ts:153-158`, `packages/types/src/account.ts`
- **Impact:** Technical debt that requires ongoing compatibility shim. Risk of divergent behaviour if both fields are set.
- **Fix approach:** Run a one-time migration to convert `model_fallbacks` data into `model_mappings` format, then remove the backward-compatibility merge code.

### `AsyncDbWriter` Silently Drops Jobs Under Load

- **Issue:** `packages/database/src/async-writer.ts:27-36` silently drops database write jobs when the queue reaches 1000 entries. Dropped jobs are only logged every 100th drop. This includes request persistence, rate-limit updates, and token refresh writes.
- **Files:** `packages/database/src/async-writer.ts:27-36`
- **Impact:** Under sustained high load, request records, cost tracking, and rate-limit cooldown times may not be persisted. Rate-limited accounts may not be correctly marked, causing repeated 429s on the same account.
- **Fix approach:** Apply backpressure to callers (await or block when queue is full) or at minimum emit a metric/alert when drops begin, rather than silently continuing.

### Verbose `log.info` Calls in Auto-Refresh Hot Loop

- **Issue:** `packages/proxy/src/auto-refresh-scheduler.ts:254-259` emits four `log.info` messages for every account considered by the auto-refresh scheduler every minute. With many accounts, this fills logs and adds I/O overhead.
- **Files:** `packages/proxy/src/auto-refresh-scheduler.ts:254-259`
- **Impact:** Noisy logs, increased log-storage cost.
- **Fix approach:** Downgrade to `log.debug`.

### `console.*` Used Alongside Structured Logger

- **Issue:** Multiple files use raw `console.error`/`console.warn`/`console.log` instead of the structured `Logger` class. Instances in `packages/database/src/database-operations.ts:77-82,148`, `packages/proxy/src/handlers/account-selector.ts:42-51`, and `packages/proxy/src/auto-refresh-scheduler.ts:975` bypass the logging infrastructure (level filtering, structured output, log event emission).
- **Files:** `packages/database/src/database-operations.ts:77-82`, `packages/proxy/src/handlers/account-selector.ts:42-51`, `packages/proxy/src/auto-refresh-scheduler.ts:975`
- **Impact:** These messages do not appear in the dashboard log viewer or log-level-filtered output. They always print to stdout regardless of log level.
- **Fix approach:** Replace all `console.*` calls in non-CLI code with the `Logger` class.

### Qwen and Codex Proactive Token Refresh Is Copy-Pasted

- **Issue:** `packages/proxy/src/auto-refresh-scheduler.ts:682-801` and `808-928` contain two near-identical private methods `checkAndRefreshQwenTokens` and `checkAndRefreshCodexTokens`. The only differences are the `provider` string and minor logging strings.
- **Files:** `packages/proxy/src/auto-refresh-scheduler.ts:682-928`
- **Impact:** Bug fixes and enhancements must be applied twice. The duplication has already diverged in minor ways (comment wording).
- **Fix approach:** Extract a single `checkAndRefreshOAuthTokens(provider: string)` method parameterised on the provider name.

### Large God Files

- **Issue:** Several files exceed 1000–3000 lines and handle multiple distinct concerns:
  - `packages/http-api/src/handlers/accounts.ts` (3211 lines) — account CRUD, usage display, rate limit management, token refresh UI, OAuth reauth
  - `packages/cli-commands/src/commands/account.ts` (2245 lines) — all CLI account subcommands
  - `packages/database/src/migrations.ts` (1185 lines) — schema creation and 30+ incremental migrations in one file
  - `packages/proxy/src/auto-refresh-scheduler.ts` (1079 lines) — scheduler logic, Qwen refresh, Codex refresh, peak-hours pause
- **Files:** `packages/http-api/src/handlers/accounts.ts`, `packages/cli-commands/src/commands/account.ts`, `packages/database/src/migrations.ts`, `packages/proxy/src/auto-refresh-scheduler.ts`
- **Impact:** Hard to navigate, review, and test in isolation. High merge-conflict risk.
- **Fix approach:** Split by concern. For `accounts.ts`: separate into crud, rate-limit, token-health, usage sub-handlers. For `migrations.ts`: consider individual migration files or at minimum break into schema and migration phases.

---

## LOW

### Hardcoded SGT Timezone in Peak-Hours Logic

- **Issue:** `packages/proxy/src/auto-refresh-scheduler.ts:17-21` computes peak hours by hardcoding UTC+8 (Singapore Standard Time) with no configuration option. The 14:00–18:00 SGT window is also hardcoded.
- **Files:** `packages/proxy/src/auto-refresh-scheduler.ts:17-21`
- **Impact:** Users in other timezones get peak-hour pausing at unexpected local times. The function is not configurable without code changes.
- **Fix approach:** Read timezone offset and hour range from the account's configuration or from a server config env variable.

### Error Messages Leak Internal Architecture Details

- **Issue:** The `ServiceUnavailableError` thrown when all accounts fail (`packages/proxy/src/proxy.ts:349`) includes the count of attempted accounts in its message, which is returned to the client. The re-authentication message includes `bun run cli` commands.
- **Files:** `packages/proxy/src/proxy.ts:343-352`
- **Impact:** Clients learn how many accounts are in the pool and how the system is administered.
- **Fix approach:** Use generic user-facing messages in the API response; log internal details server-side only.

### OAuth Endpoints' Broad Exemption Creates Future Risk

- **Issue:** The `/api/oauth` prefix exemption in auth-service is a broad wildcard. Future routes added under `/api/oauth/` will automatically be unauthenticated unless a developer knows to handle them explicitly.
- **Files:** `packages/http-api/src/services/auth-service.ts:148-150`
- **Impact:** Accidental authentication bypass when adding new OAuth-adjacent endpoints.
- **Fix approach:** Switch from a prefix exemption to an explicit allow-list of exact paths that are legitimately pre-auth.

### `storePayloads` Defaults to `true` in Worker Before Config Arrives

- **Issue:** `packages/proxy/src/post-processor.worker.ts:122` initialises `storePayloads = true`. If the main thread sends a `config-update` message to disable payload storage, there is a window on startup during which payloads are written even if storage is configured off.
- **Files:** `packages/proxy/src/post-processor.worker.ts:122`, `packages/proxy/src/proxy.ts:44-50`
- **Impact:** A few early payloads may be persisted even when `storePayloads = false` is the operator's intent.
- **Fix approach:** Do not process any `end` messages until the first `config-update` is received, or change the default to `false` and require explicit opt-in.

---

## Test Coverage Gaps

### Auto-Refresh Scheduler Peak-Hours Logic

- **What's not tested:** The `isZaiPeakHour()` function and `checkPeakHoursPause()` method have no direct unit tests. The scheduler's integration with peak-hours pause/resume is exercised only through the broad auto-refresh test file.
- **Files:** `packages/proxy/src/auto-refresh-scheduler.ts:17-21,992-1011`
- **Risk:** Time-zone arithmetic bugs would not be caught until operators observe unexpected pausing behaviour in production.
- **Priority:** Medium

### Internal Header Stripping (Security Gap)

- **What's not tested:** There is no test verifying that an external request bearing `x-better-ccflare-account-id` cannot force-route to a specific account. The existing `agent-interceptor.security.test.ts` tests agent security but not header-based account forcing.
- **Files:** `packages/proxy/src/handlers/__tests__/agent-interceptor.security.test.ts`, `packages/proxy/src/handlers/account-selector.ts:76-102`
- **Risk:** The privilege-escalation vector (described in CRITICAL section) could regress without detection.
- **Priority:** High

### AsyncDbWriter Under Queue-Full Conditions

- **What's not tested:** The drop behaviour when queue reaches 1000 is not tested. No test verifies which job types are actually dropped or that the system recovers correctly.
- **Files:** `packages/database/src/async-writer.ts:27-36`
- **Risk:** Silent data loss under load would not surface in CI.
- **Priority:** Medium

---

*Concerns audit: 2026-05-04*
