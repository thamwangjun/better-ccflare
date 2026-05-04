# Technology Stack

**Analysis Date:** 2026-05-04

## Languages

**Primary:**
- TypeScript 6.0.2 - All application logic across `apps/` and `packages/`
- TSX/JSX - Dashboard frontend (`packages/dashboard-web/src/`)

**Secondary:**
- Bash - GitHub Actions scripts (`.github/scripts/`)

## Runtime

**Environment:**
- Bun >= 1.2.8 (enforced via `engines.bun` in root `package.json`)
- Node.js LTS (declared in `mise.toml` for compatibility; CLI binary targets `node >= 18.0.0`)

**Package Manager:**
- Bun workspaces
- Lockfile: `bun.lock` (present, committed)

## Frameworks

**Core:**
- No HTTP server framework — uses Bun's native `Bun.serve()` in `apps/server/src/server.ts`
- React 19.2.4 - Dashboard UI (`packages/dashboard-web/`)
- React Router DOM 7.14.0 - Client-side routing in dashboard

**UI Component Libraries:**
- Radix UI (dialog, dropdown-menu, label, popover, progress, select, separator, slot, switch, tabs) - Headless accessible components
- `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 - Drag-and-drop for account priority ordering
- Lucide React 1.7.0 - Icon set
- Recharts 3.8.1 - Charts for usage/stats dashboards

**Styling:**
- Tailwind CSS 4.2.2 - Utility CSS (`bun-plugin-tailwind` for build integration)
- `tailwindcss-animate` 1.0.7 - Animation utilities
- `class-variance-authority` 0.7.1 + `clsx` 2.1.1 + `tailwind-merge` 3.5.0 - Class composition helpers

**State & Data Fetching:**
- TanStack React Query 5.96.2 - Server state and polling in dashboard

**Testing:**
- `bun:test` (built-in Bun test runner) - 69 test files across all packages; no separate test framework needed

**Build/Dev:**
- Biome 2.4.10 - Linting, formatting, and import organization (replaces ESLint + Prettier)
- TypeScript compiler (`bunx tsc --noEmit`) - Type checking only; no transpile step
- Bun bundler (`bun build`) - Compiles CLI to a standalone self-contained binary (target: `bun`)
- `bun-plugin-tailwind` 0.1.2 - Tailwind CSS Bun build plugin for dashboard

## Key Dependencies

**Critical:**
- `@dqbd/tiktoken` 1.0.22 - Token counting for request cost estimation; WASM binary is base64-embedded at build time into `packages/proxy/src/embedded-tiktoken-wasm.ts`
- `dotenv` 17.4.0 - Loads `.env` file in CLI entry point (`apps/cli/src/main.ts`)

**Cloud Provider SDKs:**
- `@aws-sdk/client-bedrock` 3.991.0 - AWS Bedrock model discovery (`packages/providers/`)
- `@aws-sdk/client-bedrock-runtime` 3.1014.0 - AWS Bedrock inference invocation
- `@aws-sdk/credential-providers` 3.1021.0 - AWS credential chain (env vars, INI profile)
- `google-auth-library` 10.6.2 - Google Vertex AI Application Default Credentials

**Date Utilities:**
- `date-fns` 4.1.0 - Date formatting in dashboard

## Configuration

**Environment:**
- Configuration is loaded from process environment variables and an optional `.env` file
- See `.env.example` for all supported variables
- Central config parsing lives in `packages/config/src/index.ts`

**Build:**
- `tsconfig.json` - Root TypeScript config (targets ESNext, `jsx: react-jsx`, `moduleResolution: bundler`)
- `biome.json` - Linting/formatting config (tab indentation, double quotes for JS)
- `mise.toml` - Dev toolchain versions (`bun = "latest"`, `node = "lts"`)

## Platform Requirements

**Development:**
- Bun >= 1.2.8
- Node.js LTS (for `node -p` calls in build scripts)
- `mise` recommended for toolchain version management

**Production:**
- Docker: `debian:bookworm-slim` base image with `sqlite3`, `ca-certificates`, `curl` packages
- Runs as non-root user `ccflare` (UID 1000)
- Distributed as a self-contained Bun binary (no Bun runtime required in container)
- Targets: `linux-amd64`, `linux-arm64`, `macos-arm64`, `macos-x86_64`, `windows-x64`
- Docker image published to GitHub Container Registry: `ghcr.io/tombii/better-ccflare`

---

*Stack analysis: 2026-05-04*
