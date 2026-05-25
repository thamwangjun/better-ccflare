# CLAUDE.md

Load balancer proxy for Claude distributing requests across multiple account providers to avoid rate limiting.

## ⚠️ CRITICAL: Testing Restrictions

**NEVER curl the Anthropic endpoint** — not directly, and not via the proxy using the `claude` account. Real Anthropic accounts can get banned for automated/scripted usage. The `claude` account must only be used through real Claude Code. For testing, always use non-Anthropic accounts (ollama, litellm, omniroute, etc.) and force-route with `x-better-ccflare-account-id`.

## ⚠️ CRITICAL: File Exclusions

**README files** - Only modify `./README.md` (root). Do NOT modify `apps/cli/README.md`.

**NEVER TOUCH these auto-generated files** — must be excluded from all reads, edits, searches, and commits:
- `packages/proxy/src/inline-worker.ts`
- `packages/database/src/inline-vacuum-worker.ts`
- `packages/database/src/inline-integrity-check-worker.ts`

If accidentally modified: `git checkout -- <path>`

## Git Refspecs
This repo has both a `main` branch and a `main` tag. **Always use `refs/heads/main`** (not `main`) for local branch operations (push, checkout). For merge-base and log comparisons against the remote, use `origin/main` (the remote ref) to avoid the ambiguous refspec warning from the local tag.

## Branch Management
Always branch from `main` with a fresh pull. Never make changes directly on main.
PRs: `gh pr checkout <PR_NUMBER>` or `git checkout <branch-name>`.
- If `git push origin main` fails with `src refspec main matches more than one` (branch/tag name collision), push explicitly: `git push origin refs/heads/main:refs/heads/main`.

## PR Review Against Current Main (MANDATORY)

Before reviewing or merging any PR, always find the merge base and identify what main has added since the PR branched:

```bash
git fetch origin pull/<PR_NUMBER>/head:<branch-name>
git fetch origin main
MERGE_BASE=$(git merge-base <branch-name> origin/main)
git log $MERGE_BASE..origin/main --oneline          # commits on main the PR doesn't have
git diff $MERGE_BASE..origin/main --name-only        # files main changed since PR branched
```

Cross-check the PR's changed files against main's post-branch files. If they overlap, inspect those specific hunks to confirm the PR doesn't regress recent fixes. A PR based on an old main can silently overwrite hotfixes, security patches, or behaviour changes that landed after it branched.

## Merging PRs from External Contributors
When merging PRs from external contributors (not tombii), **create a merge commit** instead of squashing or rebasing. This preserves the contributor's commit history and ensures they appear in the git log as a contributor. Use:
```bash
git merge --no-ff <branch-name>
```
The `--no-ff` flag creates a merge commit even if the branch could be fast-forwarded.

**Do NOT use `gh pr merge`** — it may squash or rebase, losing the contributor's identity. Always merge manually with `git merge --no-ff`.

If the PR branch isn't available locally, fetch it first:
```bash
git fetch origin pull/<PR_NUMBER>/head:<branch-name>
git merge --no-ff <branch-name>
```

After merging, update the Acknowledgements section in README.md to thank the contributor for their specific contributions.

## Issue Management
- Never close issues automatically
- Wait for the issue reporter to confirm that fixes work for them before closing

## Issue Staleness Check (MANDATORY before implementing)
Before implementing any GitHub issue, always run:
```bash
git log origin/main --since='<issue-open-date>' --oneline --no-merges -- <relevant-paths>
```
Check if recent commits already partially or fully address the issue. Rate limiting, health, and proxy code change frequently. Ask the user "does this issue still apply given recent changes?" before proceeding. Especially check: has the reported symptom been fixed? Does the proposal conflict with new architecture?

## Database
- Default: `~/.config/better-ccflare/better-ccflare.db`
- Custom: Set `BETTER_CCFLARE_DB_PATH=/path/to/dev.db` in env or .env
- Query: `sqlite3 ~/.config/better-ccflare/better-ccflare.db "SELECT name, provider, custom_endpoint FROM accounts;"`

## ⚠️ CRITICAL: Database Migrations — Port to PostgreSQL

**Every migration added to `packages/database/src/migrations.ts` MUST also be ported to `packages/database/src/migrations-pg.ts`.**

When adding a new column or table to SQLite:
1. Add it to `ensureSchema()` in `migrations.ts` (SQLite CREATE TABLE)
2. Add it to `runMigrations()` in `migrations.ts` (SQLite ALTER TABLE for existing DBs)
3. Add it to `ensureSchemaPg()` in `migrations-pg.ts` (PG CREATE TABLE for new installs)
4. Add an entry to the `columnsToAdd` array in `runMigrationsPg()` in `migrations-pg.ts` (PG ALTER TABLE for existing DBs)
5. If there's a backfill/data migration in SQLite, add the equivalent `adapter.unsafe(UPDATE ...)` call in `runMigrationsPg()` as well.

New tables also need to be created in `ensureSchemaPg()` AND in `runMigrationsPg()` (using `CREATE TABLE IF NOT EXISTS` so upgrades work).

## Subagents for Multi-Task Work
When a session involves multiple independent tasks, always spawn subagents rather than doing them sequentially in the main context. This conserves tokens and keeps the main context clean. Tasks don't need to run in parallel — the goal is context isolation, not speed.

**Default to subagents for any task that can be handed off:** code changes, research, code review, test runs, exploration, impact analysis, and any work that doesn't require direct interaction with the user mid-task. Only work inline in the main session for short, one-off responses or when you need to ask the user something before proceeding.

## Plan Execution
When executing implementation plans, always use subagent-driven development (superpowers:subagent-driven-development). Never execute plans inline in the main session. Always dispatch a fresh subagent per task.

## Test-Driven Development
When creating new functionality: write tests first, then implement, then run tests. This ensures the implementation matches the specs/request before and after coding.

## After Code Changes
Always run: `bun run lint && bun run typecheck && bun run format`

After pushing commits to main, run `npx gitnexus analyze` to keep the GitNexus index up to date.

## Git Commits
- **Before making any changes, run `git status` to check for pre-existing uncommitted changes.** Note which files were already modified so you can distinguish your changes from theirs throughout the session.
- Use `git add <specific-files>` (not `git add .`) to avoid committing inline-worker.ts
- Check `git status` before committing

## Publishing to npm
- Use `cd apps/cli && bun publish` (avoids workspace errors)
- When pushing to git (triggers auto-publish), show complete output including npmjs.com auth URL: `https://www.npmjs.com/auth/cli/[uuid]`
- **NEVER bump the version** — version bumps are handled automatically by the release system

## Version Updates
**NEVER bump the version** — handled automatically by the release system.
`CLAUDE_CLI_VERSION` in `packages/core/src/version.ts` tracks Claude Code CLI version (auto-updated by pre-push hook).
If ever needed manually: update both `package.json` (root) and `apps/cli/package.json`.

## Commands

### Server
- First run: `bun run build` (builds dashboard/CLI)
- Start: `bun start` (port 8080) or `bun start --serve --port 8081` (testing)
- Startup: Takes ~15 seconds, wait before testing with curl
- Production: runs on port 8082. Test local changes on port 8081.

### Account Management
- Add: `bun run cli --add-account <name> --mode <claude-oauth|console|zai|minimax|anthropic-compatible|openai-compatible> --priority <number>`
- List: `bun run cli --list`
- Remove: `bun run cli --remove <name>`
- Reauth: `bun run cli --reauthenticate <name>` (preserves metadata, auto-notifies servers)
- Priority: `bun run cli --set-priority <name> <priority>` (lower = higher priority, 0 = first)
- Provider behavior: OAuth (5hr windows, session-based), API keys (pay-as-you-go, no sessions)

### Maintenance
- `bun run cli --reset-stats|--clear-history|--stats|--analyze`

### API Endpoints
- `POST /api/accounts/:id/reload|pause|resume`

### Testing OpenRouter
Always use model `z-ai/glm-4.5-air:free`:
```bash
curl -X POST http://localhost:8081/v1/messages -H "Content-Type: application/json" -H "Authorization: Bearer test" -d '{"model":"z-ai/glm-4.5-air:free","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

## Environment
- OS timezone is UTC+2. Timestamps in logs and `/tmp` files are UTC — add 2 hours for local time.

## Qwen Provider
- When working on the Qwen provider or streaming transform, **always mirror the qwen-code implementation** at `/home/tom/git_repos/qwen-code/`. Check how qwen-code handles the same scenario before implementing.
- Qwen/DashScope sends incremental tool call argument chunks (not cumulative like standard OpenAI). The streaming transform buffers all chunks and emits complete JSON at stream end, matching `StreamingToolCallParser` in qwen-code.

## Commit Message Categories
Automated release system uses commit prefixes for changelog:
- Features: `feat:|add:|new:`
- Fixes: `fix:|bug:|resolve:`
- Security: `security:|vulnerabilit:|redact:|ReDoS:`
- Improvements: `improve:|enhance:|update:|refactor:`

**Acknowledgement commits** (when merging external PRs): always use `chore: acknowledge <name> for PR #<N>` as the commit subject. This prefix is excluded from release notes. If the merge also includes real fixes, commit them separately with the appropriate prefix.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **better-ccflare** (9981 symbols, 18731 relationships, 238 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/better-ccflare/context` | Codebase overview, check index freshness |
| `gitnexus://repo/better-ccflare/clusters` | All functional areas |
| `gitnexus://repo/better-ccflare/processes` | All execution flows |
| `gitnexus://repo/better-ccflare/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- GSD:project-start source:PROJECT.md -->
## Project

**better-ccflare (Personal Fork)**

A maintained personal fork of [better-ccflare](https://github.com/tombii/better-ccflare) — a Bun-based Claude API load balancer proxy that distributes requests across multiple account providers to avoid rate limiting. This fork continuously pulls upstream releases and layers personal improvements: provider enhancements, bug fixes that haven't landed upstream, and infra customizations.

**Core Value:** Stay current with upstream while running a stable personal instance enhanced with features I need — primarily around OpenRouter caching, provider selection, and a clean patch workflow.

### Constraints

- **Safety**: Never curl Anthropic endpoint in tests — risk of account ban
- **Generated file**: `inline-worker.ts` is auto-generated — never edit directly
- **Versioning**: Version bumps are automated — never bump manually
- **Compatibility**: Patches must apply cleanly after upstream merges; avoid structural changes to shared packages
- **Stack**: Bun runtime, TypeScript, biome for lint/format — must pass `bun run lint && bun run typecheck && bun run format` after every change
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 6.0.2 - All application logic across `apps/` and `packages/`
- TSX/JSX - Dashboard frontend (`packages/dashboard-web/src/`)
- Bash - GitHub Actions scripts (`.github/scripts/`)
## Runtime
- Bun >= 1.2.8 (enforced via `engines.bun` in root `package.json`)
- Node.js LTS (declared in `mise.toml` for compatibility; CLI binary targets `node >= 18.0.0`)
- Bun workspaces
- Lockfile: `bun.lock` (present, committed)
## Frameworks
- No HTTP server framework — uses Bun's native `Bun.serve()` in `apps/server/src/server.ts`
- React 19.2.4 - Dashboard UI (`packages/dashboard-web/`)
- React Router DOM 7.14.0 - Client-side routing in dashboard
- Radix UI (dialog, dropdown-menu, label, popover, progress, select, separator, slot, switch, tabs) - Headless accessible components
- `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 - Drag-and-drop for account priority ordering
- Lucide React 1.7.0 - Icon set
- Recharts 3.8.1 - Charts for usage/stats dashboards
- Tailwind CSS 4.2.2 - Utility CSS (`bun-plugin-tailwind` for build integration)
- `tailwindcss-animate` 1.0.7 - Animation utilities
- `class-variance-authority` 0.7.1 + `clsx` 2.1.1 + `tailwind-merge` 3.5.0 - Class composition helpers
- TanStack React Query 5.96.2 - Server state and polling in dashboard
- `bun:test` (built-in Bun test runner) - 69 test files across all packages; no separate test framework needed
- Biome 2.4.10 - Linting, formatting, and import organization (replaces ESLint + Prettier)
- TypeScript compiler (`bunx tsc --noEmit`) - Type checking only; no transpile step
- Bun bundler (`bun build`) - Compiles CLI to a standalone self-contained binary (target: `bun`)
- `bun-plugin-tailwind` 0.1.2 - Tailwind CSS Bun build plugin for dashboard
## Key Dependencies
- `@dqbd/tiktoken` 1.0.22 - Token counting for request cost estimation; WASM binary is base64-embedded at build time into `packages/proxy/src/embedded-tiktoken-wasm.ts`
- `dotenv` 17.4.0 - Loads `.env` file in CLI entry point (`apps/cli/src/main.ts`)
- `@aws-sdk/client-bedrock` 3.991.0 - AWS Bedrock model discovery (`packages/providers/`)
- `@aws-sdk/client-bedrock-runtime` 3.1014.0 - AWS Bedrock inference invocation
- `@aws-sdk/credential-providers` 3.1021.0 - AWS credential chain (env vars, INI profile)
- `google-auth-library` 10.6.2 - Google Vertex AI Application Default Credentials
- `date-fns` 4.1.0 - Date formatting in dashboard
## Configuration
- Configuration is loaded from process environment variables and an optional `.env` file
- See `.env.example` for all supported variables
- Central config parsing lives in `packages/config/src/index.ts`
- `tsconfig.json` - Root TypeScript config (targets ESNext, `jsx: react-jsx`, `moduleResolution: bundler`)
- `biome.json` - Linting/formatting config (tab indentation, double quotes for JS)
- `mise.toml` - Dev toolchain versions (`bun = "latest"`, `node = "lts"`)
## Platform Requirements
- Bun >= 1.2.8
- Node.js LTS (for `node -p` calls in build scripts)
- `mise` recommended for toolchain version management
- Docker: `debian:bookworm-slim` base image with `sqlite3`, `ca-certificates`, `curl` packages
- Runs as non-root user `ccflare` (UID 1000)
- Distributed as a self-contained Bun binary (no Bun runtime required in container)
- Targets: `linux-amd64`, `linux-arm64`, `macos-arm64`, `macos-x86_64`, `windows-x64`
- Docker image published to GitHub Container Registry: `ghcr.io/tombii/better-ccflare`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Source files: `kebab-case.ts` — e.g., `proxy-operations.ts`, `response-processor.ts`, `cache-body-store.ts`
- Repository files: `kebab-case.repository.ts` — e.g., `account.repository.ts`, `stats.repository.ts`
- Test files: `kebab-case.test.ts` — co-located with source or inside `__tests__/` subdirectory
- Worker files: `kebab-case.worker.ts` — e.g., `post-processor.worker.ts`, `vacuum-worker.ts`
- All functions use `camelCase` — e.g., `levenshteinDistance`, `proxyWithAccount`, `parseRateLimit`
- Async functions are prefixed/suffixed by role, not by `async` — e.g., `fetchNanoGPTPricingData`, `handleProxyError`
- Factory functions use `make` prefix in test files — e.g., `makeAccount()`, `makeProxyContext()`, `makeRequestMeta()`
- `camelCase` for all local variables and parameters
- `SCREAMING_SNAKE_CASE` for module-level constants — e.g., `ERROR_MESSAGES`, `TEST_DB_PATH`
- DB column names remain `snake_case` (matching SQLite schema) — e.g., `rate_limited_until`, `session_start`
- Interfaces: `PascalCase` — e.g., `UsageWindowData`, `AccountResponse`, `ProxyContext`
- Type aliases: `PascalCase` — e.g., `FullUsageData`, `LogFormat`
- Enums: `PascalCase` name, `SCREAMING_SNAKE_CASE` members — e.g., `LogLevel.DEBUG`, `LogLevel.INFO`
- Classes: `PascalCase` — e.g., `DatabaseOperations`, `BunSqlAdapter`, `AccountRepository`
- Error classes: `PascalCase` suffixed with `Error` — e.g., `AuthError`, `ProviderError`, `RateLimitError`
## Code Style
- Indent style: **tabs** (not spaces)
- Quote style: **double quotes** for JavaScript/TypeScript strings
- Scope: `apps/**` and `packages/**` only
- CSS modules: disabled; Tailwind directives: enabled
## TypeScript Configuration
- `target: "esnext"`, `module: "esnext"`, `moduleResolution: "bundler"`
- `noEmit: true` — compilation is type-checking only; Bun handles execution
- `allowImportingTsExtensions: true` — `.ts` extensions allowed in import paths
- `forceConsistentCasingInFileNames: true`
- `resolveJsonModule: true`
- `types: ["bun-types"]` — Bun runtime types used globally
- `jsx: "react-jsx"` — React JSX transform used for dashboard
## Import Organization
- `@better-ccflare/*` → `./packages/*/src` — use for all cross-package imports; never use relative `../../` across package boundaries
- `@better-ccflare/server` → `./apps/server/src/server.ts`
- `@better-ccflare/dashboard-web/dist/*` → `./packages/dashboard-web/dist/*`
- Every package exposes a `src/index.ts` that re-exports its public API surface
- Internal modules use named exports (not `export default`)
- Barrel files use both `export { ... } from "./module"` (selective) and `export * from "./module"` (full re-export)
- Use `import type { ... }` for pure type imports — enforced by convention across the codebase
## Error Handling
- `AppError` (abstract base) → extends `Error`, carries `code`, `statusCode`, `context`, `timestamp`
- Domain subclasses: `AuthError` (401), `TokenRefreshError`, `RateLimitError`, `ValidationError`, `ProviderError`, `OAuthError`
- Use typed error classes instead of raw `new Error()` wherever possible
- Catch errors and re-throw as domain errors:
- Silent catch (`} catch { }`) is used when a fallback path handles the failure — avoid for errors that should propagate
- Error serialization via `.toJSON()` on `AppError` for HTTP responses
- `logError(error, log)` utility used for standardized error logging before re-throwing
## Logging
- Console output is silenced unless `BETTER_CCFLARE_DEBUG` env var is set or level is DEBUG
- Logs are emitted to a `logBus` EventEmitter for SSE streaming to the dashboard
- Do not use `console.log`/`console.error` directly in application code — use the `Logger` class
## Comments
- Module-level JSDoc blocks for public classes and exported functions with non-obvious behavior
- Inline comments for non-obvious logic or intentional workarounds
- Section dividers using `// ─────────────────────` in long test files to separate describe blocks
- Used selectively for exported functions with `@throws`, `@param`, or complex return shapes
- Not applied uniformly — focus on places where a reader would need context
## Function Design
- Async functions return `Promise<T>` — never mix sync/async signatures
- Functions returning result shapes use typed interfaces, not untyped objects
## Module Design
- All public APIs exported from `src/index.ts` barrel
- Internal helpers stay unexported unless tests or other packages require them
- No `export default` — use named exports exclusively
- `feat:` / `add:` / `new:` — new features (triggers changelog "Features" section)
- `fix:` / `bug:` / `resolve:` — bug fixes
- `security:` / `vulnerabilit:` / `redact:` / `ReDoS:` — security changes
- `improve:` / `enhance:` / `update:` / `refactor:` — improvements and refactors
- NEVER bump version in commits — handled by automated release system
- Use `git add <specific-files>` not `git add .` to avoid committing `inline-worker.ts`
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Request routing is synchronous per-request: account selection → provider auth → upstream fetch → response streaming
- Provider abstraction layer allows routing to 13+ backends (Anthropic, Bedrock, OpenRouter, Qwen, etc.) from a single endpoint
- Background workers (Bun `Worker`) handle usage accounting asynchronously to avoid blocking the response path
- State lives in a single SQLite database; all server processes share it via WAL mode
- DI container (`packages/core-di`) wires singletons (Config, Logger, DatabaseOps) at startup
## Layers
- Purpose: Accept incoming requests, authenticate/authorize, route to proxy or dashboard/API handlers
- Location: `apps/server/src/server.ts`
- Contains: Bun `serve()` call, request dispatching, TLS config, graceful shutdown
- Depends on: `@better-ccflare/http-api`, `@better-ccflare/proxy`, `@better-ccflare/database`, `@better-ccflare/config`
- Used by: Process entry point (`bun run start`)
- Purpose: REST endpoints for account CRUD, config, stats, OAuth, combos, debug
- Location: `packages/http-api/src/`
- Contains: `router.ts` (APIRouter class), `handlers/` (one file per resource), `services/auth-service.ts`
- Depends on: `@better-ccflare/database`, `@better-ccflare/types`
- Used by: Server layer, dashboard UI (via fetch)
- Purpose: Core load-balancing and upstream forwarding logic
- Location: `packages/proxy/src/`
- Contains: `proxy.ts` (main `handleProxy()` orchestrator), `handlers/` (account-selector, request-handler, proxy-operations, response-processor, token-manager, agent-interceptor, sse-rate-limit-sniffer)
- Depends on: `@better-ccflare/load-balancer`, `@better-ccflare/providers`, `@better-ccflare/database`, `@better-ccflare/core`
- Used by: Server layer
- Purpose: Account ordering and session stickiness logic
- Location: `packages/load-balancer/src/strategies/index.ts`
- Contains: `SessionStrategy` — the sole concrete strategy implementing `LoadBalancingStrategy`
- Depends on: `@better-ccflare/core`, `@better-ccflare/types`
- Used by: Proxy orchestration layer via `ProxyContext.strategy`
- Purpose: Per-provider authentication, header transformation, rate-limit parsing, model mapping
- Location: `packages/providers/src/providers/`
- Contains: 13 providers — `anthropic`, `bedrock`, `openrouter`, `qwen`, `minimax`, `nanogpt`, `zai`, `kilo`, `codex`, `openai`, `vertex-ai`, `anthropic-compatible`, `alibaba-coding-plan`; base class at `packages/providers/src/base.ts`; registry at `packages/providers/src/registry.ts`
- Depends on: `@better-ccflare/core`, `@better-ccflare/types`, `@better-ccflare/http-common`
- Used by: Proxy orchestration layer
- Purpose: Persist accounts, requests, stats, OAuth sessions, combos, API keys, agent preferences
- Location: `packages/database/src/`
- Contains: `database-operations.ts` (facade over repositories), `repositories/` (9 repositories), `adapters/bun-sql-adapter.ts`, `migrations.ts`, `async-writer.ts`
- Depends on: `bun:sqlite`
- Used by: Proxy layer, HTTP API layer, CLI
- Purpose: Async usage/token accounting without blocking SSE streams
- Location: `packages/proxy/src/post-processor.worker.ts` (inlined as `inline-worker.ts`), `packages/database/src/vacuum-worker.ts`
- Contains: Token counting, payload storage, summary emission; WAL vacuum operations
- Depends on: `@better-ccflare/database`
- Used by: `UsageWorkerController` in proxy layer
- Purpose: Periodic background operations that must run continuously
- Location: `packages/proxy/src/auto-refresh-scheduler.ts`, `packages/proxy/src/cache-keepalive-scheduler.ts`
- Contains: `AutoRefreshScheduler` (sends dummy messages when usage windows reset), `CacheKeepaliveScheduler` (maintains prompt cache warmth)
- Depends on: Proxy context, database, core heartbeat registry
- Used by: Server layer (started at startup)
- Purpose: Account management, authentication, maintenance commands
- Location: `apps/cli/src/main.ts`, `packages/cli-commands/src/`
- Contains: `--add-account`, `--list`, `--remove`, `--reauthenticate`, `--set-priority`, `--stats`, `--repair-db` etc.
- Depends on: `@better-ccflare/database`, `@better-ccflare/providers`, `@better-ccflare/oauth-flow`
- Used by: Users directly; server may trigger via API reload endpoints
- Purpose: Web UI for monitoring accounts, requests, analytics, configuration
- Location: `packages/dashboard-web/src/`
- Contains: React components under `components/` (accounts, analytics, charts, combos, conversation, overview, agents, ui), contexts, hooks, utils
- Depends on: Server API endpoints
- Used by: End users via browser; embedded in server binary as base64 assets
## Data Flow
- Account state (sessions, rate limits, pause) lives in SQLite, mutated via `AsyncDbWriter` to batch writes
- In-memory `usageCache` (in `packages/providers/`) stores polled utilization data for tie-breaking in `SessionStrategy`
- `refreshInFlight` map on `ProxyContext` prevents concurrent OAuth refresh storms for the same account
- Config is event-emitting (`Config extends EventEmitter`); strategy is hot-swappable without restart
## Key Abstractions
- Purpose: Dependency bundle passed through proxy call stack, avoiding global state
- Examples: `packages/proxy/src/handlers/proxy-types.ts`
- Pattern: Struct/record type — `{ strategy, dbOps, runtime, config, provider, refreshInFlight, asyncWriter, usageWorker }`
- Purpose: Adapts each upstream API to a common interface
- Examples: `packages/providers/src/providers/anthropic/provider.ts`, `packages/providers/src/providers/openrouter/provider.ts`
- Pattern: Abstract class with `canHandle()`, `buildRequest()`, `refreshToken()`, `parseRateLimit()`, `getUsage()`
- Purpose: Interface for account ordering; sole implementation is `SessionStrategy`
- Examples: `packages/load-balancer/src/strategies/index.ts`
- Pattern: Strategy pattern — `interface { initialize(store): void; select(accounts, meta): Account[] }`
- Purpose: Facade over all repositories providing a single import point for all DB access
- Examples: `packages/database/src/database-operations.ts`
- Pattern: Repository aggregator — delegates to `AccountRepository`, `RequestRepository`, `StatsRepository`, etc.
- Purpose: Queues DB write operations to execute after response is sent, preventing write latency from affecting streaming
- Examples: `packages/database/src/async-writer.ts`
- Pattern: Write queue / fire-and-forget with flush on shutdown
- Purpose: Manages a Bun Worker for off-thread token counting and payload storage
- Examples: `packages/proxy/src/usage-worker-controller.ts`
- Pattern: Worker lifecycle manager with pending-ack tracking and restart-on-error
## Entry Points
- Location: `apps/server/src/server.ts`
- Triggers: `bun run start` or `bun run apps/server/src/server.ts`
- Responsibilities: Initialize DI container, DB, strategy, schedulers, Bun HTTP server; register signal handlers for graceful shutdown
- Location: `apps/cli/src/main.ts`
- Triggers: `bun run cli` or the compiled binary
- Responsibilities: Parse argv, dispatch to command handlers in `packages/cli-commands/src/commands/`
- Location: `packages/dashboard-web/src/index.tsx` (source), `packages/dashboard-web/dist/` (built)
- Triggers: Embedded in server binary as base64 assets; loaded via `import '@better-ccflare/dashboard-web/dist/embedded'`
- Responsibilities: React SPA served from server for `/` and non-API routes
## Error Handling
- `ValidationError`, `RateLimitError`, `ProviderError`, `ServiceUnavailableError` defined in `packages/errors/src/` and `packages/core/src/errors.ts`
- `handleProxyError()` in `packages/proxy/src/handlers/response-processor.ts` classifies upstream errors and decides whether to retry with next account or surface to client
- Rate-limit responses trigger `markAccountRateLimited()` via `AsyncDbWriter` then try next account; exhausting all accounts throws `ServiceUnavailableError`
- OAuth token expiry detected by `isRefreshTokenLikelyExpired()`; all-accounts-failed path includes re-auth instructions in error message
- DB errors in `getOrderedAccounts()` are caught and return `[]` (graceful degradation to unauthenticated proxy)
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
