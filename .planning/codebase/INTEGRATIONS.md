# External Integrations

**Analysis Date:** 2026-05-04

## APIs & External Services

This project acts as a **proxy/load balancer** — it routes requests to multiple upstream AI provider APIs on behalf of clients. Each provider is a first-class integration.

**Anthropic (Claude):**
- Purpose: Primary upstream target; proxies Claude Code OAuth sessions
- Endpoint: `https://api.anthropic.com` (default)
- Auth: Claude OAuth (PKCE flow) — tokens stored in SQLite, refreshed automatically
- Implementation: `packages/providers/src/providers/anthropic/`

**Anthropic-Compatible (Generic):**
- Purpose: Any Anthropic-protocol-compatible endpoint (e.g., local LLM servers)
- Endpoint: `ANTHROPIC_COMPATIBLE_BASE_URL` env var (defaults to `https://api.anthropic.com`)
- Auth: Bearer API key stored per-account in database
- Implementation: `packages/providers/src/providers/anthropic-compatible/`

**OpenAI-Compatible (Generic):**
- Purpose: Any OpenAI-protocol endpoint (Ollama, LiteLLM, etc.)
- Endpoint: Configured per account in `custom_endpoint` field
- Auth: Bearer API key stored per-account in database
- Model mapping: `OPENAI_COMPATIBLE_MODEL_MAPPINGS` env var (JSON)
- Implementation: `packages/providers/src/providers/openai/`

**OpenRouter:**
- Purpose: Aggregator routing to many models via OpenAI/Anthropic-compatible API
- Endpoint: `https://openrouter.ai` (hardcoded in provider)
- Auth: Bearer API key stored per-account in database
- Special: Injects `cache_control` ephemeral headers; extracts `cache_write_tokens` from `prompt_tokens_details`
- Implementation: `packages/providers/src/providers/openrouter/`

**AWS Bedrock:**
- Purpose: Runs Anthropic models via AWS infrastructure
- SDK: `@aws-sdk/client-bedrock-runtime` 3.1014.0, `@aws-sdk/client-bedrock` 3.991.0
- Auth: AWS credential chain — env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) or INI profile (stored in `custom_endpoint` as `bedrock:profile:region`)
- Signing: AWS SigV4 (handled automatically by AWS SDK v3)
- Implementation: `packages/providers/src/providers/bedrock/`

**Google Vertex AI:**
- Purpose: Runs Claude models via Google Cloud
- SDK: `google-auth-library` 10.6.2
- Auth: Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` env var or `gcloud auth application-default login`)
- Project: `ANTHROPIC_VERTEX_PROJECT_ID` or `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` env vars
- Region: `CLOUD_ML_REGION` env var
- Implementation: `packages/providers/src/providers/vertex-ai/`

**Zai (Z-AI):**
- Purpose: Third-party Claude provider
- Auth: Bearer API key; usage fetched via separate usage API
- Usage fetcher: `packages/providers/src/zai-usage-fetcher.ts`
- Implementation: `packages/providers/src/providers/zai/`

**MiniMax:**
- Purpose: Third-party model provider
- Implementation: `packages/providers/src/providers/minimax/`

**Alibaba Coding Plan (DashScope/Qwen):**
- Purpose: Alibaba Cloud model provider; supports Qwen models
- Note: Qwen/DashScope sends incremental tool call argument chunks (not cumulative); streaming transform buffers all chunks
- Usage fetcher: `packages/providers/src/alibaba-coding-plan-usage-fetcher.ts`
- Implementation: `packages/providers/src/providers/alibaba-coding-plan/`, `packages/providers/src/providers/qwen/`

**Kilo:**
- Purpose: Third-party Claude provider
- Usage fetcher: `packages/providers/src/kilo-usage-fetcher.ts`
- Implementation: `packages/providers/src/providers/kilo/`

**NanoGPT:**
- Purpose: Third-party model provider
- Usage fetcher: `packages/providers/src/nanogpt-usage-fetcher.ts`
- Implementation: `packages/providers/src/providers/nanogpt/`

**OpenAI Codex (GitHub Copilot):**
- Purpose: GitHub Copilot / Codex models via OAuth device flow
- OAuth: Device OAuth flow with PKCE (`packages/providers/src/providers/codex/device-oauth.ts`)
- Implementation: `packages/providers/src/providers/codex/`

## Data Storage

**Databases:**
- Primary: SQLite via `bun:sqlite` (Bun native)
  - Default path: `~/.config/better-ccflare/better-ccflare.db`
  - Custom path: `BETTER_CCFLARE_DB_PATH` env var (also accepts legacy `ccflare_DB_PATH`)
  - Config: WAL mode enabled, `busyTimeoutMs: 10000`, `synchronous: FULL`, vacuum worker runs in a Bun Worker thread
  - Implementation: `packages/database/src/database-operations.ts`
- Alternative: PostgreSQL via `Bun.SQL` (async)
  - Activated when `DATABASE_URL` env var starts with `postgres://` or `postgresql://`
  - Migrations: `packages/database/src/migrations-pg.ts`
  - Adapter: `packages/database/src/adapters/bun-sql-adapter.ts` (unified SQLite/PostgreSQL interface)

**File Storage:**
- Local filesystem only — SQLite database file, config JSON, SSL cert files

**Caching:**
- In-process in-memory caching for usage data, model lists, and inference profiles
- No external cache (Redis/Valkey env vars referenced only in Bun type definitions, not used by application code)

## Authentication & Identity

**Upstream Provider Auth (OAuth):**
- PKCE-based OAuth flows for Anthropic and Codex providers
- OAuth tokens (access + refresh) stored encrypted in SQLite `accounts` table
- Auto-refresh scheduler: `packages/proxy/src/auto-refresh-scheduler.ts`
- Implementation: `packages/providers/src/oauth/`, `packages/oauth-flow/`

**Dashboard / Proxy API Auth:**
- API key authentication — keys stored in `api_keys` table in SQLite
- Keys presented in `Authorization: Bearer <key>` header
- Dashboard stores key in `localStorage` (`packages/dashboard-web/src/api.ts`)
- API key repository: `packages/database/src/repositories/api-key.repository.ts`

## Monitoring & Observability

**Error Tracking:**
- None — no external error tracking service (e.g., Sentry) detected

**Logs:**
- Structured logger in `packages/logger/src/`
- Format controlled by `LOG_FORMAT` env var: `pretty` (default) or `json`
- Level controlled by `LOG_LEVEL` env var: `DEBUG | INFO | WARN | ERROR` (default: `INFO`)
- Optional log directory: `BETTER_CCFLARE_LOG_DIR` env var

## CI/CD & Deployment

**Hosting:**
- Docker: `ghcr.io/tombii/better-ccflare` (GitHub Container Registry)
- npm: `better-ccflare` package published from `apps/cli/`
- Binary releases: GitHub Releases for `linux-amd64`, `linux-arm64`, `macos-arm64`, `macos-x86_64`, `windows-x64`

**CI Pipeline:**
- GitHub Actions (`.github/workflows/`)
  - `release.yml` — Builds multi-arch binaries on `v*` tag push, creates GitHub Release
  - `docker-publish.yml` — Builds and pushes Docker image (triggered after release workflow)
  - `claude-code-review.yml` — Automated Claude AI code review on PRs
  - `issue-triage.yml` — Automated issue triage
  - `auto-rerun-failed.yml` — Auto-reruns failed workflow runs

## Environment Configuration

**Required env vars (for non-default configuration):**
- `BETTER_CCFLARE_DB_PATH` — Override SQLite database path
- `DATABASE_URL` — PostgreSQL connection URL (activates PostgreSQL mode)
- `PORT` — Server port (default: 8080)
- `SSL_KEY_PATH` + `SSL_CERT_PATH` — Enable TLS (both required together)
- `PAYLOAD_ENCRYPTION_KEY` — 64-char hex string for AES-256-GCM payload encryption at rest

**Provider-specific env vars:**
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` — Bedrock credentials (env chain)
- `GOOGLE_APPLICATION_CREDENTIALS` — Vertex AI service account JSON path
- `ANTHROPIC_VERTEX_PROJECT_ID` / `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` — Vertex AI project
- `CLOUD_ML_REGION` — Vertex AI region
- `ANTHROPIC_COMPATIBLE_BASE_URL` — Override base URL for anthropic-compatible provider
- `OPENAI_COMPATIBLE_MODEL_MAPPINGS` — JSON model name mapping for OpenAI-compatible provider

**Operational env vars:**
- `LOG_LEVEL` — `DEBUG | INFO | WARN | ERROR` (default: `INFO`)
- `LOG_FORMAT` — `pretty | json` (default: `pretty`)
- `LB_STRATEGY` — Load-balancing strategy (default: `session`)
- `DATA_RETENTION_DAYS` — Payload cleanup window (default: 3)
- `REQUEST_RETENTION_DAYS` — Request metadata retention (default: 90)
- `STORE_PAYLOADS` — Enable request/response payload persistence
- `USAGE_POLL_INTERVAL_MS` — How often to poll provider usage APIs
- `CACHE_KEEPALIVE_TTL_MINUTES` — Cache keepalive TTL
- `SYSTEM_PROMPT_CACHE_TTL_1H` — System prompt cache TTL override
- `SESSION_DURATION_MS` — Session window duration
- `RETRY_ATTEMPTS`, `RETRY_DELAY_MS`, `RETRY_BACKOFF` — Retry configuration
- `CLIENT_ID` — Override OAuth client ID
- `BEDROCK_MODEL_CACHE_TTL_HOURS` — Bedrock model list cache TTL (default: 6)
- `BEDROCK_INFERENCE_PROFILE_CACHE_TTL_HOURS` — Bedrock inference profile cache TTL (default: 6)
- `CF_STREAM_TIMEOUT_MS`, `CF_STREAM_CHUNK_TIMEOUT_MS`, `CF_STREAM_TOTAL_TIMEOUT_MS` — Streaming timeouts
- `CF_STREAM_USAGE_BUFFER_KB` — Streaming usage buffer size
- `XDG_CONFIG_HOME` — Base config directory (Linux/Docker)
- `BETTER_CCFLARE_LOG_DIR` — Log output directory

**Secrets location:**
- `.env` file present at project root — loads at runtime via `dotenv` in CLI entry point
- OAuth tokens stored in SQLite `accounts` table (optionally AES-256-GCM encrypted)
- AWS credentials via environment or `~/.aws/credentials` INI file

## Webhooks & Callbacks

**Incoming:**
- `/health` — Health check endpoint (used by Docker `HEALTHCHECK` and load balancers)
- `/v1/messages` — Main Anthropic-protocol proxy endpoint
- `/api/accounts/:id/reload|pause|resume` — Account management REST endpoints
- All other API endpoints served from `packages/http-api/src/`

**Outgoing:**
- OAuth PKCE flows call provider authorization endpoints (Anthropic, Codex)
- Usage polling makes periodic HTTP requests to provider usage APIs
- Cache keepalive scheduler makes internal requests to itself (`packages/proxy/src/cache-keepalive-scheduler.ts`)

---

*Integration audit: 2026-05-04*
