---
quick_id: "260531-cel"
slug: "add-multi-stage-dockerfile-that-builds-f"
description: "add multi-stage Dockerfile that builds from local source"
date: "2026-05-31"
must_haves:
  truths:
    - "Dockerfile.local exists at repo root"
    - "Builder stage uses oven/bun:latest and runs bun install + bun run build"
    - "Dashboard is built before CLI binary (bun run build:dashboard then arch-specific CLI build)"
    - "TARGETARCH selects between build:linux-amd64 and build:linux-arm64"
    - "Runtime stage copies binary from builder, matches structure of existing Dockerfile"
    - "docker build --no-cache -f Dockerfile.local -t better-ccflare:local . produces a working image"
  artifacts:
    - "Dockerfile.local"
  key_links: []
---

# Quick Task 260531-cel: add multi-stage Dockerfile that builds from local source

## Context

The existing `Dockerfile` downloads a pre-built binary from `github.com/tombii/better-ccflare/releases` — it never uses local source. This means v1.1 fork patches (OpenRouter cache injection, provider preference UI) are absent from the Docker image.

**Build facts gathered:**
- `bun run build` = `bun run build:dashboard` + `bun run --cwd apps/cli build`
- Dashboard output: `packages/dashboard-web/dist/` (must build before CLI)
- CLI build embeds tiktoken WASM and post-processor workers as base64, then compiles a self-contained binary via `bun build --compile`
- Cross-arch binaries: `apps/cli build:linux-amd64` → `apps/cli/dist/better-ccflare-linux-amd64`; same for arm64
- `build:linux-amd64` in `apps/cli/package.json` first runs the CLI's own `build` (generates inline workers), then does the cross-compile step
- Runtime stage needs: `debian:bookworm-slim`, `sqlite3 ca-certificates curl file`
- `.dockerignore` excludes `dist/**` (fine — builder generates its own) and `node_modules`

**Why `Dockerfile.local` (separate file):** The existing `Dockerfile` is used by GitHub Actions CI to package upstream releases. Keeping it untouched avoids breaking CI. Users build locally with `-f Dockerfile.local`.

## Tasks

### Task 1: Write Dockerfile.local

**File:** `Dockerfile.local`
**Action:** Create multi-stage Dockerfile at repo root

```
# Stage 1 — Builder
FROM oven/bun:latest AS builder
WORKDIR /app

# Copy all source (bun install needs workspace structure intact)
COPY . .

# Install deps using the committed lockfile
RUN bun install --frozen-lockfile

# Build dashboard first (CLI embeds it), then build arch-specific CLI binary
ARG TARGETARCH=amd64
RUN bun run build:dashboard && \
    cd apps/cli && \
    if [ "${TARGETARCH}" = "arm64" ]; then \
      bun run build:linux-arm64; \
    else \
      bun run build:linux-amd64; \
    fi

# Stage 2 — Runtime (mirrors existing Dockerfile structure)
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y sqlite3 ca-certificates curl file && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG TARGETARCH=amd64
COPY --from=builder /app/apps/cli/dist/better-ccflare-linux-${TARGETARCH} /usr/local/bin/better-ccflare

RUN chmod +x /usr/local/bin/better-ccflare && \
    /usr/local/bin/better-ccflare --version

RUN useradd -r -u 1000 -m -s /bin/bash ccflare && \
    mkdir -p /data /app/logs && \
    chown -R ccflare:ccflare /data /app

ENV NODE_ENV=production
ENV BETTER_CCFLARE_DB_PATH=/data/better-ccflare.db
ENV XDG_CONFIG_HOME=/data
ENV BETTER_CCFLARE_LOG_DIR=/app/logs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

LABEL org.opencontainers.image.title="better-ccflare"
LABEL org.opencontainers.image.description="Load balancer proxy for Claude API — local fork build"

VOLUME ["/data"]
USER ccflare

ENTRYPOINT ["/usr/local/bin/better-ccflare"]
CMD ["--serve", "--port", "8080"]
```

**Verify:** `Dockerfile.local` exists at repo root and contains both FROM stages
**Done:** File present with builder + runtime stages

## Usage (for SUMMARY.md)

```bash
# Build from local source
docker build --no-cache -f Dockerfile.local -t better-ccflare:local .

# Cross-arch (e.g. arm64)
docker build --no-cache -f Dockerfile.local --build-arg TARGETARCH=arm64 -t better-ccflare:local-arm64 .
```
