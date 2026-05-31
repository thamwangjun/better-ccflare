---
quick_id: "260531-cel"
slug: "add-multi-stage-dockerfile-that-builds-f"
date: "2026-05-31"
status: complete
duration: "~2 min"
tasks_completed: 1
files_created: 1
files_modified: 0
commits:
  - hash: "9dc306db"
    message: "feat: add Dockerfile.local for local source builds"
---

# Quick Task 260531-cel: add multi-stage Dockerfile that builds from local source

## One-liner

Multi-stage `Dockerfile.local` that compiles the fork from source using `oven/bun:latest` builder and produces a `debian:bookworm-slim` runtime image identical in structure to the existing upstream `Dockerfile`.

## What Was Done

Created `/Dockerfile.local` at the repo root with two stages:

1. **Builder stage** (`oven/bun:latest`): copies full workspace, runs `bun install --frozen-lockfile`, builds the dashboard first (`bun run build:dashboard`), then builds the arch-specific CLI binary (`build:linux-amd64` or `build:linux-arm64`) controlled by `TARGETARCH` ARG.

2. **Runtime stage** (`debian:bookworm-slim`): installs `sqlite3 ca-certificates curl file`, copies the compiled binary from builder, verifies it runs (`--version`), creates the `ccflare` user (UID 1000), sets env vars, exposes port 8080, and runs as non-root.

## Usage

```bash
# Build from local source (amd64 default)
docker build --no-cache -f Dockerfile.local -t better-ccflare:local .

# Cross-arch (arm64)
docker build --no-cache -f Dockerfile.local --build-arg TARGETARCH=arm64 -t better-ccflare:local-arm64 .
```

## Files

| File | Action |
|------|--------|
| `Dockerfile.local` | Created |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `Dockerfile.local` exists at repo root
- [x] Contains both `FROM oven/bun:latest AS builder` and `FROM debian:bookworm-slim` stages
- [x] Commit `9dc306db` exists

## Self-Check: PASSED
