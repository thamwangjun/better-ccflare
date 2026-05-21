#!/usr/bin/env bash
set -euo pipefail

# Guard: upstream/main must be fetched before running this script.
# The SOP (UPSTREAM_MERGE.md) documents git fetch upstream as Step 1.
if ! git rev-parse upstream/main > /dev/null 2>&1; then
  echo "ERROR: upstream/main not found locally. Run: git fetch upstream" >&2
  exit 1
fi

HIGH_RISK_FILES=(
  "packages/providers/src/providers/openai/provider.ts"
  "packages/providers/src/providers/openrouter/provider.ts"
  "packages/types/src/account.ts"
  "packages/database/src/migrations.ts"
  "packages/http-api/src/handlers/accounts.ts"
)

# IN-01: Personal fork branch name — change here if renamed
FORK_BRANCH="thamw-main"

for file in "${HIGH_RISK_FILES[@]}"; do
  echo "======================================================"
  echo "FILE: ${file}"
  echo "------------------------------------------------------"
  echo "DIFF vs upstream/main:"
  git diff upstream/main -- "${file}"
  echo ""
  echo "FORK COMMITS TOUCHING THIS FILE:"
  git log --oneline "upstream/main..${FORK_BRANCH}" -- "${file}"
  echo ""
done
