# Architecture

**Analysis Date:** 2026-05-04

## Pattern Overview

**Overall:** Layered monorepo proxy — a Bun HTTP server that intercepts Claude API requests, applies session-aware load balancing across multiple upstream accounts, and streams responses back to clients.

**Key Characteristics:**
- Request routing is synchronous per-request: account selection → provider auth → upstream fetch → response streaming
- Provider abstraction layer allows routing to 13+ backends (Anthropic, Bedrock, OpenRouter, Qwen, etc.) from a single endpoint
- Background workers (Bun `Worker`) handle usage accounting asynchronously to avoid blocking the response path
- State lives in a single SQLite database; all server processes share it via WAL mode
- DI container (`packages/core-di`) wires singletons (Config, Logger, DatabaseOps) at startup

## Layers

**HTTP Server Layer:**
- Purpose: Accept incoming requests, authenticate/authorize, route to proxy or dashboard/API handlers
- Location: `apps/server/src/server.ts`
- Contains: Bun `serve()` call, request dispatching, TLS config, graceful shutdown
- Depends on: `@better-ccflare/http-api`, `@better-ccflare/proxy`, `@better-ccflare/database`, `@better-ccflare/config`
- Used by: Process entry point (`bun run start`)

**API/Management Layer:**
- Purpose: REST endpoints for account CRUD, config, stats, OAuth, combos, debug
- Location: `packages/http-api/src/`
- Contains: `router.ts` (APIRouter class), `handlers/` (one file per resource), `services/auth-service.ts`
- Depends on: `@better-ccflare/database`, `@better-ccflare/types`
- Used by: Server layer, dashboard UI (via fetch)

**Proxy Orchestration Layer:**
- Purpose: Core load-balancing and upstream forwarding logic
- Location: `packages/proxy/src/`
- Contains: `proxy.ts` (main `handleProxy()` orchestrator), `handlers/` (account-selector, request-handler, proxy-operations, response-processor, token-manager, agent-interceptor, sse-rate-limit-sniffer)
- Depends on: `@better-ccflare/load-balancer`, `@better-ccflare/providers`, `@better-ccflare/database`, `@better-ccflare/core`
- Used by: Server layer

**Load Balancing Layer:**
- Purpose: Account ordering and session stickiness logic
- Location: `packages/load-balancer/src/strategies/index.ts`
- Contains: `SessionStrategy` — the sole concrete strategy implementing `LoadBalancingStrategy`
- Depends on: `@better-ccflare/core`, `@better-ccflare/types`
- Used by: Proxy orchestration layer via `ProxyContext.strategy`

**Provider Abstraction Layer:**
- Purpose: Per-provider authentication, header transformation, rate-limit parsing, model mapping
- Location: `packages/providers/src/providers/`
- Contains: 13 providers — `anthropic`, `bedrock`, `openrouter`, `qwen`, `minimax`, `nanogpt`, `zai`, `kilo`, `codex`, `openai`, `vertex-ai`, `anthropic-compatible`, `alibaba-coding-plan`; base class at `packages/providers/src/base.ts`; registry at `packages/providers/src/registry.ts`
- Depends on: `@better-ccflare/core`, `@better-ccflare/types`, `@better-ccflare/http-common`
- Used by: Proxy orchestration layer

**Database Layer:**
- Purpose: Persist accounts, requests, stats, OAuth sessions, combos, API keys, agent preferences
- Location: `packages/database/src/`
- Contains: `database-operations.ts` (facade over repositories), `repositories/` (9 repositories), `adapters/bun-sql-adapter.ts`, `migrations.ts`, `async-writer.ts`
- Depends on: `bun:sqlite`
- Used by: Proxy layer, HTTP API layer, CLI

**Background Workers:**
- Purpose: Async usage/token accounting without blocking SSE streams
- Location: `packages/proxy/src/post-processor.worker.ts` (inlined as `inline-worker.ts`), `packages/database/src/vacuum-worker.ts`
- Contains: Token counting, payload storage, summary emission; WAL vacuum operations
- Depends on: `@better-ccflare/database`
- Used by: `UsageWorkerController` in proxy layer

**Scheduler Layer:**
- Purpose: Periodic background operations that must run continuously
- Location: `packages/proxy/src/auto-refresh-scheduler.ts`, `packages/proxy/src/cache-keepalive-scheduler.ts`
- Contains: `AutoRefreshScheduler` (sends dummy messages when usage windows reset), `CacheKeepaliveScheduler` (maintains prompt cache warmth)
- Depends on: Proxy context, database, core heartbeat registry
- Used by: Server layer (started at startup)

**CLI Layer:**
- Purpose: Account management, authentication, maintenance commands
- Location: `apps/cli/src/main.ts`, `packages/cli-commands/src/`
- Contains: `--add-account`, `--list`, `--remove`, `--reauthenticate`, `--set-priority`, `--stats`, `--repair-db` etc.
- Depends on: `@better-ccflare/database`, `@better-ccflare/providers`, `@better-ccflare/oauth-flow`
- Used by: Users directly; server may trigger via API reload endpoints

**Dashboard Layer:**
- Purpose: Web UI for monitoring accounts, requests, analytics, configuration
- Location: `packages/dashboard-web/src/`
- Contains: React components under `components/` (accounts, analytics, charts, combos, conversation, overview, agents, ui), contexts, hooks, utils
- Depends on: Server API endpoints
- Used by: End users via browser; embedded in server binary as base64 assets

## Data Flow

**Normal Proxy Request:**

1. Client sends `POST /v1/messages` with `Authorization: Bearer <key>` to server (`apps/server/src/server.ts`)
2. `AuthService.authenticateRequest()` validates the Bearer token against hashed API keys in SQLite (skip if no keys configured)
3. `handleProxy()` (`packages/proxy/src/proxy.ts`) takes control:
   - Validates provider can handle the path via `provider.canHandle(pathname)`
   - Buffers request body into `ArrayBuffer` for multi-account retry
   - Optionally injects `ttl: "1h"` into system cache_control blocks
   - `interceptAndModifyRequest()` reads system prompt to detect agent usage and swaps model if agent preference exists
   - `selectAccountsForRequest()` checks for combo routing first, then falls back to `SessionStrategy.select()`
4. `SessionStrategy.select()` (`packages/load-balancer/src/strategies/index.ts`):
   - Returns accounts ordered by: active session stickiness → priority → utilization (ascending)
   - Auto-unpauses accounts whose usage window has reset (auto-fallback)
5. For each account in order, `proxyWithAccount()` (`packages/proxy/src/handlers/proxy-operations.ts`):
   - Calls `getValidAccessToken()` to get/refresh OAuth or API key token
   - Calls `provider.buildRequest()` to produce a provider-specific `Request`
   - Calls `makeProxyRequest()` to fetch from upstream
   - On 429/rate-limit: marks account rate-limited in DB, tries next account
   - On success: calls `forwardToClient()` which streams SSE or JSON back
6. Response post-processing: `updateAccountMetadata()` (via `AsyncDbWriter`) records session stats; usage worker processes token counts off the critical path

**Combo Routing (alternative path):**

1. Request model (e.g., `claude-opus-4-5`) is extracted from body
2. `getModelFamily()` determines family (`opus`/`sonnet`/`haiku`)
3. `dbOps.getActiveComboForFamily()` retrieves combo slot configuration
4. Each slot specifies an `account_id` + `model` override; accounts are tried in slot priority order
5. If all slots fail, falls back to normal `SessionStrategy` routing

**State Management:**
- Account state (sessions, rate limits, pause) lives in SQLite, mutated via `AsyncDbWriter` to batch writes
- In-memory `usageCache` (in `packages/providers/`) stores polled utilization data for tie-breaking in `SessionStrategy`
- `refreshInFlight` map on `ProxyContext` prevents concurrent OAuth refresh storms for the same account
- Config is event-emitting (`Config extends EventEmitter`); strategy is hot-swappable without restart

## Key Abstractions

**ProxyContext:**
- Purpose: Dependency bundle passed through proxy call stack, avoiding global state
- Examples: `packages/proxy/src/handlers/proxy-types.ts`
- Pattern: Struct/record type — `{ strategy, dbOps, runtime, config, provider, refreshInFlight, asyncWriter, usageWorker }`

**Provider (BaseProvider):**
- Purpose: Adapts each upstream API to a common interface
- Examples: `packages/providers/src/providers/anthropic/provider.ts`, `packages/providers/src/providers/openrouter/provider.ts`
- Pattern: Abstract class with `canHandle()`, `buildRequest()`, `refreshToken()`, `parseRateLimit()`, `getUsage()`

**LoadBalancingStrategy:**
- Purpose: Interface for account ordering; sole implementation is `SessionStrategy`
- Examples: `packages/load-balancer/src/strategies/index.ts`
- Pattern: Strategy pattern — `interface { initialize(store): void; select(accounts, meta): Account[] }`

**DatabaseOperations:**
- Purpose: Facade over all repositories providing a single import point for all DB access
- Examples: `packages/database/src/database-operations.ts`
- Pattern: Repository aggregator — delegates to `AccountRepository`, `RequestRepository`, `StatsRepository`, etc.

**AsyncDbWriter:**
- Purpose: Queues DB write operations to execute after response is sent, preventing write latency from affecting streaming
- Examples: `packages/database/src/async-writer.ts`
- Pattern: Write queue / fire-and-forget with flush on shutdown

**UsageWorkerController:**
- Purpose: Manages a Bun Worker for off-thread token counting and payload storage
- Examples: `packages/proxy/src/usage-worker-controller.ts`
- Pattern: Worker lifecycle manager with pending-ack tracking and restart-on-error

## Entry Points

**HTTP Server:**
- Location: `apps/server/src/server.ts`
- Triggers: `bun run start` or `bun run apps/server/src/server.ts`
- Responsibilities: Initialize DI container, DB, strategy, schedulers, Bun HTTP server; register signal handlers for graceful shutdown

**CLI:**
- Location: `apps/cli/src/main.ts`
- Triggers: `bun run cli` or the compiled binary
- Responsibilities: Parse argv, dispatch to command handlers in `packages/cli-commands/src/commands/`

**Dashboard (build output):**
- Location: `packages/dashboard-web/src/index.tsx` (source), `packages/dashboard-web/dist/` (built)
- Triggers: Embedded in server binary as base64 assets; loaded via `import '@better-ccflare/dashboard-web/dist/embedded'`
- Responsibilities: React SPA served from server for `/` and non-API routes

## Error Handling

**Strategy:** Typed error classes + per-account fallback iteration

**Patterns:**
- `ValidationError`, `RateLimitError`, `ProviderError`, `ServiceUnavailableError` defined in `packages/errors/src/` and `packages/core/src/errors.ts`
- `handleProxyError()` in `packages/proxy/src/handlers/response-processor.ts` classifies upstream errors and decides whether to retry with next account or surface to client
- Rate-limit responses trigger `markAccountRateLimited()` via `AsyncDbWriter` then try next account; exhausting all accounts throws `ServiceUnavailableError`
- OAuth token expiry detected by `isRefreshTokenLikelyExpired()`; all-accounts-failed path includes re-auth instructions in error message
- DB errors in `getOrderedAccounts()` are caught and return `[]` (graceful degradation to unauthenticated proxy)

## Cross-Cutting Concerns

**Logging:** `packages/logger/src/` — `Logger` class used with named context strings (e.g., `new Logger("Proxy")`); all modules instantiate their own named logger

**Validation:** `packages/security/src/path-validator.ts` for file paths; `packages/core/src/validation.ts` for config values; provider-level header sanitization in `packages/http-common/src/`

**Authentication:** Bearer token validated by `AuthService` (`packages/http-api/src/services/auth-service.ts`); if no API keys configured, all requests pass through unauthenticated; OAuth account tokens refreshed lazily per-request with deduplication via `refreshInFlight` map

---

*Architecture analysis: 2026-05-04*
