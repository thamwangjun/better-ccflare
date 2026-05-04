# Codebase Structure

**Analysis Date:** 2026-05-04

## Directory Layout

```
better-ccflare/
├── apps/
│   ├── server/src/server.ts        # HTTP server entry point
│   ├── cli/src/main.ts             # CLI entry point
│   └── lander/src/                 # Marketing landing page (separate build)
├── packages/
│   ├── proxy/                      # Core proxy orchestration
│   ├── load-balancer/              # SessionStrategy load balancer
│   ├── providers/                  # 13 upstream provider adapters
│   ├── database/                   # SQLite persistence (repositories + migrations)
│   ├── http-api/                   # REST API handlers (accounts, config, stats, etc.)
│   ├── http-common/                # Shared HTTP utilities (header sanitization)
│   ├── core/                       # Shared constants, errors, model mappings, utils
│   ├── core-di/                    # Simple DI container (singleton registry)
│   ├── config/                     # Config file loading + EventEmitter
│   ├── types/                      # Shared TypeScript interfaces
│   ├── errors/                     # Typed error classes
│   ├── logger/                     # Logger class
│   ├── security/                   # Path validation utilities
│   ├── agents/                     # Agent registry and workspace persistence
│   ├── cli-commands/               # CLI command implementations
│   ├── oauth-flow/                 # OAuth PKCE flow for account auth
│   ├── openai-formats/             # OpenAI <-> Anthropic format converters
│   ├── dashboard-web/              # React dashboard SPA
│   └── ui-common/, ui-constants/   # Shared UI components and constants
├── __tests__/                      # Root-level integration tests
├── scripts/                        # Maintenance/build scripts
├── docs/                           # Developer documentation
├── .github/                        # CI workflows and issue templates
├── biome.json                      # Linter + formatter config
├── tsconfig.json                   # Root TypeScript config
├── package.json                    # Workspace root (bun workspaces)
├── Dockerfile                      # Production container build
└── docker-compose.yml              # Local Docker Compose config
```

## Directory Purposes

**`apps/server/`:**
- Purpose: Runnable HTTP server process — wires all packages together
- Contains: Single file `src/server.ts` (~1400 lines); no sub-packages
- Key files: `apps/server/src/server.ts` — exports `startServer()`, handles graceful shutdown, embeds dashboard assets

**`apps/cli/`:**
- Purpose: Compiled CLI binary for account management
- Contains: `src/main.ts` (entry), `__tests__/` (CLI integration tests), `dist/` (compiled output)
- Key files: `apps/cli/src/main.ts` — dispatches to `packages/cli-commands/`
- Note: Published to npm as standalone binary via `bun build --compile`

**`apps/lander/`:**
- Purpose: Static marketing landing page; separate build target
- Contains: `src/` with standalone HTML/JS
- Not bundled into the server binary

**`packages/proxy/`:**
- Purpose: Main request orchestration — the heart of the load balancer
- Contains:
  - `src/proxy.ts` — `handleProxy()` (entry), `injectSystemCacheTtl()`
  - `src/handlers/account-selector.ts` — `selectAccountsForRequest()`, combo routing
  - `src/handlers/request-handler.ts` — `makeProxyRequest()`, `prepareRequestBody()`
  - `src/handlers/proxy-operations.ts` — `proxyWithAccount()`, `extractCooldownUntil()`
  - `src/handlers/response-processor.ts` — `handleRateLimitResponse()`, `updateAccountMetadata()`
  - `src/handlers/token-manager.ts` — `getValidAccessToken()` with dedup via `refreshInFlight`
  - `src/handlers/agent-interceptor.ts` — `interceptAndModifyRequest()`
  - `src/handlers/sse-rate-limit-sniffer.ts` — detects 429s in SSE streams
  - `src/auto-refresh-scheduler.ts` — `AutoRefreshScheduler` class
  - `src/cache-keepalive-scheduler.ts` — `CacheKeepaliveScheduler` class
  - `src/usage-worker-controller.ts` — manages Bun worker lifecycle
  - `src/response-handler.ts` — `forwardToClient()` streaming
  - `src/inline-worker.ts` — **AUTO-GENERATED: never edit or read**
  - `src/post-processor.worker.ts` — Bun worker source for usage accounting
- Key files: `packages/proxy/src/proxy.ts`, `packages/proxy/src/handlers/account-selector.ts`

**`packages/load-balancer/`:**
- Purpose: Account selection algorithm
- Contains: `src/strategies/index.ts` — `SessionStrategy` class (the only strategy)
- Key files: `packages/load-balancer/src/strategies/index.ts`

**`packages/providers/`:**
- Purpose: Per-provider API adaptation
- Contains:
  - `src/providers/<name>/provider.ts` — each provider's implementation
  - `src/base.ts` — `BaseProvider` abstract class
  - `src/registry.ts` — `registerProvider()`, `getProvider()`, `listProviders()`
  - `src/index.ts` — auto-registers all 13 providers at module load
  - `src/usage-fetcher.ts`, `src/zai-usage-fetcher.ts`, etc. — usage polling per provider
  - `src/oauth/` — OAuth helpers used by provider refresh flows
  - `src/utils/` — shared model-mapping, header transformation utilities
- Key files: `packages/providers/src/providers/anthropic/provider.ts`, `packages/providers/src/registry.ts`

**`packages/database/`:**
- Purpose: All SQLite persistence
- Contains:
  - `src/database-operations.ts` — `DatabaseOperations` facade (implements all `dbOps.*` calls)
  - `src/factory.ts` — `DatabaseFactory` singleton factory
  - `src/adapters/bun-sql-adapter.ts` — thin wrapper over `bun:sqlite`
  - `src/repositories/` — 9 focused repositories:
    - `account.repository.ts` — CRUD + session/rate-limit state
    - `request.repository.ts` — request history storage
    - `stats.repository.ts` — aggregated usage statistics
    - `api-key.repository.ts` — API key management
    - `combo.repository.ts` — combo routing configuration
    - `oauth.repository.ts` — OAuth session tokens
    - `strategy.repository.ts` — load balancing strategy config
    - `agent-preference.repository.ts` — per-agent model overrides
    - `model-translation.repository.ts` — cached model name translations
  - `src/migrations.ts` — SQLite schema migrations
  - `src/async-writer.ts` — `AsyncDbWriter` write queue
  - `src/payload-encryption.ts` — optional AES-256-GCM payload encryption
- Key files: `packages/database/src/database-operations.ts`, `packages/database/src/repositories/account.repository.ts`

**`packages/http-api/`:**
- Purpose: REST management API (not proxy traffic)
- Contains:
  - `src/router.ts` — `APIRouter` class dispatching to handlers
  - `src/handlers/` — one file per resource: `accounts.ts`, `stats.ts`, `config.ts`, `combos.ts`, `api-keys.ts`, `oauth.ts`, `health.ts`, `logs.ts`, `analytics.ts`, `agents.ts`, `maintenance.ts`, `debug.ts`, `system.ts`, `features.ts`, `token-health.ts`, `version.ts`, `requests.ts`, `requests-stream.ts`, `logs-history.ts`
  - `src/services/auth-service.ts` — `AuthService` class
  - `src/utils/` — shared handler utilities
- Key files: `packages/http-api/src/router.ts`, `packages/http-api/src/services/auth-service.ts`

**`packages/core/`:**
- Purpose: Shared pure utilities with no infrastructure deps
- Contains: `constants.ts`, `errors.ts`, `model-mappings.ts`, `models.ts`, `pricing.ts`, `strategy.ts`, `utils.ts`, `validation.ts`, `version.ts`, `lifecycle.ts` (disposables/heartbeat registry), `interval-manager.ts`, `request-events.ts`
- Key files: `packages/core/src/errors.ts`, `packages/core/src/model-mappings.ts`

**`packages/core-di/`:**
- Purpose: Lightweight IoC container for singleton wiring at startup
- Contains: `src/container.ts` — `Container` class with `register()`, `resolve()`, `registerInstance()`
- Key files: `packages/core-di/src/container.ts`

**`packages/config/`:**
- Purpose: JSON config file reading/writing with live change events
- Contains: `src/index.ts` — `Config extends EventEmitter` with typed getters/setters
- Config file path: `~/.config/better-ccflare/config.json` (default)

**`packages/types/`:**
- Purpose: Shared TypeScript interfaces, no runtime logic
- Contains: `account.ts`, `request.ts`, `strategy.ts`, `combo.ts`, `api-key.ts`, `agent.ts`, `context.ts`, `stats.ts`, `logging.ts`, `conversation.ts`, `provider-config.ts`, `constants.ts`, `api.ts`

**`packages/agents/`:**
- Purpose: Agent discovery and workspace lifecycle management
- Contains: `src/discovery.ts` — `AgentRegistry` class scanning filesystem for agent configs; `src/workspace-persistence.ts`

**`packages/cli-commands/`:**
- Purpose: Individual CLI command implementations
- Contains: `src/commands/` — one file per command group; `src/prompts/` — interactive CLI prompts; `src/utils/`

**`packages/oauth-flow/`:**
- Purpose: OAuth PKCE flow used during `--add-account` and `--reauthenticate`
- Contains: Authorization URL generation, token exchange, device flow support

**`packages/openai-formats/`:**
- Purpose: Bidirectional format conversion between OpenAI and Anthropic message schemas
- Contains: `src/converters.ts`, `src/stream.ts`, `src/types.ts`, `src/utils.ts`

**`packages/dashboard-web/`:**
- Purpose: React-based management UI
- Contains: `src/components/` (tab components per feature area), `src/contexts/`, `src/hooks/`, `src/lib/`, `src/utils/`; `dist/` (built assets embedded into server binary)
- Note: `dist/` is built output — committed to repo for binary packaging

**`packages/security/`:**
- Purpose: Input validation for file paths (prevent path traversal)
- Contains: `src/path-validator.ts` — `validatePathOrThrow()`, `validatePath()`

**`packages/errors/`:**
- Purpose: Package-level error class definitions
- Contains: `src/index.ts`

**`packages/logger/`:**
- Purpose: Structured logger with named contexts
- Contains: `src/index.ts` — `Logger` class

## Key File Locations

**Entry Points:**
- `apps/server/src/server.ts`: HTTP server — `startServer()` export and `import.meta.main` guard
- `apps/cli/src/main.ts`: CLI — argv parsing and command dispatch
- `packages/dashboard-web/src/index.tsx`: React app root

**Configuration:**
- `biome.json`: Linter and formatter rules
- `tsconfig.json`: Root TypeScript config (extended by packages)
- `package.json`: Workspace root; scripts, engine requirements (`bun >= 1.2.8`)
- `~/.config/better-ccflare/config.json`: Runtime config (created by server, not committed)
- `.env.example`: Documents supported environment variables

**Core Logic:**
- `packages/proxy/src/proxy.ts`: Main `handleProxy()` — 11-step orchestration
- `packages/proxy/src/handlers/account-selector.ts`: `selectAccountsForRequest()` — combo + session routing
- `packages/load-balancer/src/strategies/index.ts`: `SessionStrategy` — the load balancing algorithm
- `packages/providers/src/index.ts`: Provider registry auto-registration
- `packages/database/src/database-operations.ts`: All database access (facade)

**Testing:**
- `__tests__/api-auth.test.ts`: Root integration test
- `packages/*/src/**/__tests__/`: Co-located unit tests per package
- `apps/cli/__tests__/`: CLI command tests

## Naming Conventions

**Files:**
- Kebab-case for all source files: `account-selector.ts`, `proxy-operations.ts`
- `*.repository.ts` for repository classes
- `*.worker.ts` for Bun worker files
- `*.test.ts` for test files; test directories named `__tests__/`
- Provider directories match the `account.provider` string value: `anthropic/`, `openrouter/`, `bedrock/`

**Directories:**
- All lowercase kebab-case: `cli-commands/`, `http-api/`, `load-balancer/`
- `__tests__/` for test directories (double-underscore convention)

## Where to Add New Code

**New Provider:**
- Implementation: `packages/providers/src/providers/<name>/provider.ts` — extend `BaseProvider`
- Registration: Add `registry.registerProvider(new <Name>Provider())` in `packages/providers/src/index.ts`
- Usage fetcher (if provider has usage API): `packages/providers/src/<name>-usage-fetcher.ts`, export from `packages/providers/src/index.ts`
- Tests: `packages/providers/src/providers/<name>/__tests__/provider.test.ts`

**New API Endpoint:**
- Handler: `packages/http-api/src/handlers/<resource>.ts`
- Register: Wire into `packages/http-api/src/router.ts` `handleRequest()` method
- Tests: `packages/http-api/src/handlers/__tests__/<resource>.test.ts`

**New CLI Command:**
- Implementation: `packages/cli-commands/src/commands/<command>.ts`
- Register: Import and dispatch in `apps/cli/src/main.ts`
- Tests: `packages/cli-commands/src/commands/__tests__/<command>.test.ts`

**New Feature (proxy behavior):**
- Primary code: `packages/proxy/src/handlers/` — add a new handler file
- Wire into: `packages/proxy/src/proxy.ts` `handleProxy()` function
- Tests: `packages/proxy/src/handlers/__tests__/`

**Shared Types:**
- Add interfaces to the appropriate file in `packages/types/src/`; re-export from `packages/types/src/index.ts`

**Shared Utilities:**
- Pure utilities with no infra deps: `packages/core/src/utils.ts` or a new file in `packages/core/src/`
- HTTP-specific utilities: `packages/http-common/src/`

**Dashboard Feature:**
- New tab/panel: `packages/dashboard-web/src/components/<feature>/`
- New shared UI primitive: `packages/ui-common/src/components/`

## Special Directories

**`packages/proxy/src/inline-worker.ts`:**
- Purpose: Auto-generated inlined Bun worker code (base64 of `post-processor.worker.ts`)
- Generated: Yes — generated at build time
- Committed: Yes (to avoid requiring a build step at runtime)
- **NEVER read or edit manually.** Restore with `git checkout -- packages/proxy/src/inline-worker.ts`

**`packages/dashboard-web/dist/`:**
- Purpose: Built React dashboard assets embedded into the server binary
- Generated: Yes — `bun run build:dashboard`
- Committed: Yes (required for binary distribution)

**`apps/cli/dist/`:**
- Purpose: Compiled CLI binary
- Generated: Yes — `bun run build:cli`
- Committed: No (`.gitignore`)

**`.planning/codebase/`:**
- Purpose: Architecture analysis documents for AI-assisted development
- Generated: Yes — written by `/gsd-map-codebase`
- Committed: Yes

**`.gitnexus/`:**
- Purpose: GitNexus code intelligence index (symbol graph, embeddings)
- Generated: Yes — `npx gitnexus analyze`
- Committed: No

---

*Structure analysis: 2026-05-04*
