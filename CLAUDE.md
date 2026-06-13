# CLAUDE.md

Load balancer proxy for Claude distributing requests across multiple account providers to avoid rate limiting.

## ⚠️ CRITICAL Safety Rules

- **NEVER curl the Anthropic endpoint** — not directly, and not via the proxy using the `claude` account. Real Anthropic accounts can get banned for automated/scripted usage. The `claude` account is only for real Claude Code. For testing, use non-Anthropic accounts (ollama, litellm, omniroute, etc.) and force-route with `x-better-ccflare-account-id`.
- **NEVER bump the version** — handled automatically by the release system (root `package.json` + `apps/cli/package.json`). `CLAUDE_CLI_VERSION` in `packages/core/src/version.ts` is auto-updated by a pre-push hook.
- **NEVER edit these auto-generated files** (exclude from reads, edits, searches, commits). If touched: `git checkout -- <path>`:
  - `packages/proxy/src/inline-worker.ts`
  - `packages/database/src/inline-vacuum-worker.ts`
  - `packages/database/src/inline-integrity-check-worker.ts`
- **README:** only modify `./README.md` (root). Do NOT modify `apps/cli/README.md`.

## ⚠️ CRITICAL: Database Migrations — Port to PostgreSQL

**Every migration added to `packages/database/src/migrations.ts` MUST also be ported to `packages/database/src/migrations-pg.ts`.** When adding a column/table to SQLite:
1. `ensureSchema()` in `migrations.ts` (SQLite CREATE TABLE)
2. `runMigrations()` in `migrations.ts` (SQLite ALTER TABLE for existing DBs)
3. `ensureSchemaPg()` in `migrations-pg.ts` (PG CREATE TABLE for new installs)
4. `columnsToAdd` array in `runMigrationsPg()` in `migrations-pg.ts` (PG ALTER TABLE)
5. Any SQLite backfill/data migration → equivalent `adapter.unsafe(UPDATE ...)` in `runMigrationsPg()`.

New tables go in BOTH `ensureSchemaPg()` and `runMigrationsPg()` (use `CREATE TABLE IF NOT EXISTS`).

## Git

- **Refspecs:** this repo has both a `main` branch and a `main` tag. Use `refs/heads/main` for local branch ops (push, checkout); use `origin/main` for merge-base/log comparisons. If `git push origin main` fails with `src refspec main matches more than one`, push explicitly: `git push origin refs/heads/main:refs/heads/main`.
- **Branching:** always branch from `main` with a fresh pull; never edit main directly. PRs: `gh pr checkout <PR_NUMBER>` or `git checkout <branch-name>`.
- **Commits:** run `git status` first to note pre-existing changes (distinguish yours from theirs). Use `git add <specific-files>` (never `git add .`) to avoid committing `inline-worker.ts`.
- **Commit prefixes** (drive the release changelog): `feat:|add:|new:` (features), `fix:|bug:|resolve:` (fixes), `security:|vulnerabilit:|redact:|ReDoS:` (security), `improve:|enhance:|update:|refactor:` (improvements). Acknowledgement commits use `chore: acknowledge <name> for PR #<N>` (excluded from release notes).

## Pre-PR Review with Greptile

Before opening a pull request, run a Greptile review from the terminal:

```bash
greptile review
```

Greptile reviews your branch against its base branch and shows comments directly in the terminal. Run this after checking out your branch and before pushing/opening a PR.

## PR Review Against Current Main (MANDATORY)

Before reviewing/merging any PR, find the merge base and check what main added since the PR branched:
```bash
git fetch origin pull/<PR_NUMBER>/head:<branch-name>
git fetch origin main
MERGE_BASE=$(git merge-base <branch-name> origin/main)
git log $MERGE_BASE..origin/main --oneline      # commits on main the PR lacks
git diff $MERGE_BASE..origin/main --name-only    # files main changed since branch
```
If the PR's changed files overlap main's post-branch files, inspect those hunks — a stale-based PR can silently regress hotfixes, security patches, or behaviour changes.

## Merging External PRs (not tombii)
Create a merge commit to preserve the contributor's history/identity:
```bash
git fetch origin pull/<PR_NUMBER>/head:<branch-name>   # if not local
git merge --no-ff <branch-name>
```
Do NOT use `gh pr merge` (may squash/rebase, losing identity). After merging, thank the contributor in the README Acknowledgements section.

## Issues
- Never close issues automatically; wait for the reporter to confirm fixes.
- **Staleness check before implementing:** `git log origin/main --since='<issue-open-date>' --oneline --no-merges -- <relevant-paths>`. Rate-limiting/health/proxy code changes often — confirm the issue still applies before proceeding.

## Database
- Default: `~/.config/better-ccflare/better-ccflare.db`
- Custom: `BETTER_CCFLARE_DB_PATH=/path/to/dev.db`
- Query: `sqlite3 ~/.config/better-ccflare/better-ccflare.db "SELECT name, provider, custom_endpoint FROM accounts;"`

## Workflow Conventions
- **After code changes:** `bun run lint && bun run typecheck && bun run format`. After pushing to main: `npx gitnexus analyze`.
- **TDD:** for new functionality, write tests first, then implement, then run.
- **Subagents:** for multi-task sessions, hand off independent work (code, research, review, tests, exploration) to subagents for context isolation. Work inline only for short one-offs or when you must ask the user mid-task.
- **Plan execution:** use subagent-driven development; dispatch a fresh subagent per task, never inline.

## Commands

### Server
- First run: `bun run build`. Start: `bun start` (port 8080) or `bun start --serve --port 8081` (testing). Startup ~15s before curling. Production runs on 8082; test local changes on 8081.

### Accounts
- Add: `bun run cli --add-account <name> --mode <claude-oauth|console|zai|minimax|anthropic-compatible|openai-compatible> --priority <number>`
- `--list`, `--remove <name>`, `--reauthenticate <name>`, `--set-priority <name> <priority>` (lower = higher, 0 = first)
- OAuth = 5hr session windows; API keys = pay-as-you-go, no sessions.

### Maintenance & API
- `bun run cli --reset-stats|--clear-history|--stats|--analyze`
- `POST /api/accounts/:id/reload|pause|resume`

### Testing OpenRouter (model `z-ai/glm-4.5-air:free`)
```bash
curl -X POST http://localhost:8081/v1/messages -H "Content-Type: application/json" -H "Authorization: Bearer test" -d '{"model":"z-ai/glm-4.5-air:free","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

### Publishing to npm
`cd apps/cli && bun publish` (avoids workspace errors). Pushing to git triggers auto-publish — show the full npmjs auth URL `https://www.npmjs.com/auth/cli/[uuid]`.

## Environment
OS timezone is UTC+2. Log/`/tmp` timestamps are UTC — add 2 hours for local.

## Qwen Provider
- Always mirror the qwen-code implementation at `/home/tom/git_repos/qwen-code/` — check it before implementing.
- Qwen/DashScope sends incremental (not cumulative) tool-call argument chunks. The streaming transform buffers all chunks and emits complete JSON at stream end, matching `StreamingToolCallParser` in qwen-code.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

Indexed as **better-ccflare**. Use GitNexus MCP tools to understand code, assess impact, and navigate. If a tool warns the index is stale, run `npx gitnexus analyze`.

**Always:** run `gitnexus_impact({target, direction:"upstream"})` before editing any symbol and report the blast radius; run `gitnexus_detect_changes()` before committing; warn on HIGH/CRITICAL risk; use `gitnexus_query`/`gitnexus_context` to explore instead of grepping.

**Never:** edit a symbol without `gitnexus_impact`; ignore HIGH/CRITICAL warnings; rename via find-and-replace (use `gitnexus_rename`); commit without `gitnexus_detect_changes()`.

Skill files for deeper workflows live under `.claude/skills/gitnexus/` (exploring, impact-analysis, debugging, refactoring, guide, cli).
<!-- gitnexus:end -->

<!-- GSD:project-start source:PROJECT.md -->
## Project

**better-ccflare (Personal Fork)** — a maintained fork of [better-ccflare](https://github.com/tombii/better-ccflare), a Bun-based Claude API load balancer proxy. This fork pulls upstream releases and layers personal improvements (OpenRouter caching, provider selection, clean patch workflow).

**Constraints:** never curl Anthropic in tests; `inline-worker.ts` is generated; version bumps are automated; patches must apply cleanly after upstream merges (avoid structural changes to shared packages); must pass `bun run lint && bun run typecheck && bun run format`.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

- **Language/runtime:** TypeScript 6.0.2, Bun >= 1.2.8 (workspaces, `bun.lock`). Node LTS for compatibility; CLI binary targets node >= 18.
- **Server:** Bun native `Bun.serve()` (no HTTP framework) in `apps/server/src/server.ts`.
- **Dashboard:** React 19, React Router 7, Radix UI, Tailwind 4, TanStack Query, Recharts, `@dnd-kit`.
- **Tooling:** Biome 2.4 (lint/format/imports), `tsc --noEmit` (type-check only), Bun bundler (standalone CLI binary), `bun:test`.
- **Key deps:** `@dqbd/tiktoken` (token counting, WASM base64-embedded), `dotenv`, `@aws-sdk/*` (Bedrock), `google-auth-library` (Vertex AI), `date-fns`.
- **Config:** env vars + optional `.env` (see `.env.example`); parsing in `packages/config/src/index.ts`. Targets linux/macos/windows; Docker `debian:bookworm-slim`, runs as non-root `ccflare`, published to `ghcr.io/tombii/better-ccflare`.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

- **Files:** `kebab-case.ts`; repositories `*.repository.ts`; tests `*.test.ts` (co-located or `__tests__/`); workers `*.worker.ts`.
- **Naming:** `camelCase` functions/vars; `PascalCase` types/interfaces/classes; error classes suffixed `Error`; `SCREAMING_SNAKE_CASE` module constants; DB columns stay `snake_case`. Test factories use `make` prefix.
- **Style:** tabs for indent, double quotes for JS/TS strings. Scope: `apps/**` and `packages/**`.
- **TS config:** `target/module: esnext`, `moduleResolution: bundler`, `noEmit`, `allowImportingTsExtensions`, `jsx: react-jsx`, `types: ["bun-types"]`.
- **Imports:** cross-package via `@better-ccflare/*` (never relative `../../` across packages); each package exposes `src/index.ts` barrel; named exports only (no `export default`); `import type` for pure types.
- **Errors:** `AppError` base (code/statusCode/context/timestamp) → `AuthError`, `RateLimitError`, `ValidationError`, `ProviderError`, `OAuthError`, etc. Use typed errors; `.toJSON()` for HTTP; `logError(error, log)` before re-throw. Silent catch only when a fallback handles it.
- **Logging:** use the `Logger` class (not `console.*`); output silenced unless `BETTER_CCFLARE_DEBUG` set or level DEBUG; logs emit to `logBus` for SSE.
- **Comments:** selective — JSDoc on public/non-obvious exports; inline only for non-obvious logic.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Per-request flow: account selection → provider auth → upstream fetch → response streaming. State lives in a single SQLite DB (WAL mode, shared); a DI container (`packages/core-di`) wires Config/Logger/DatabaseOps singletons. Background Bun Workers handle usage accounting off the response path.

**Layers / locations:**
- Server entry: `apps/server/src/server.ts` (Bun serve, dispatch, graceful shutdown).
- HTTP API: `packages/http-api/src/` — `router.ts` + `handlers/` (account/config/stats/oauth/combos/debug) + `services/auth-service.ts`.
- Proxy: `packages/proxy/src/` — `proxy.ts` (`handleProxy()`) + `handlers/` (account-selector, request-handler, proxy-operations, response-processor, token-manager, agent-interceptor, sse-rate-limit-sniffer).
- Load balancer: `packages/load-balancer/src/strategies/` — `SessionStrategy` (sole strategy; session stickiness + usage tie-breaking).
- Providers: `packages/providers/src/providers/` — 13 providers + `base.ts` + `registry.ts`. Abstract class: `canHandle/buildRequest/refreshToken/parseRateLimit/getUsage`.
- Database: `packages/database/src/` — `database-operations.ts` facade over `repositories/`, `adapters/bun-sql-adapter.ts`, `migrations.ts`, `async-writer.ts`.
- Workers/schedulers: `post-processor.worker.ts` (inlined), `vacuum-worker.ts`, `auto-refresh-scheduler.ts`, `cache-keepalive-scheduler.ts`.
- CLI: `apps/cli/src/main.ts` + `packages/cli-commands/src/`.
- Dashboard: `packages/dashboard-web/src/` (built to `dist/`, embedded as base64).

**Key abstractions:** `ProxyContext` (DI bundle through proxy stack), provider abstract class, `LoadBalancingStrategy`, `DatabaseOperations` facade, `AsyncDbWriter` (deferred write queue), `UsageWorkerController` (Bun Worker lifecycle).

**Error handling:** `handleProxyError()` classifies upstream errors and decides retry-next-account vs surface; rate-limit → `markAccountRateLimited()` then next account; all-accounts-failed → `ServiceUnavailableError` with re-auth instructions; DB errors in `getOrderedAccounts()` degrade to `[]`.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add to `.claude/skills/` (or `.agents/`, `.cursor/`, `.github/`, `.codex/`) with a `SKILL.md` index.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Start file-changing work through a GSD command so planning artifacts stay in sync: `/gsd-quick` (small fixes/docs/ad-hoc), `/gsd-debug` (investigation), `/gsd-execute-phase` (planned phase work). Don't make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate. Managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
