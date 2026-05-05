#!/usr/bin/env bash
set -euo pipefail

PATCHES_DIR=".planning/patches"
DATE=$(date +%Y%m%d)
TAG="merged-upstream-${DATE}"

# Guard: upstream/main must be fetched before running this script.
if ! git rev-parse upstream/main > /dev/null 2>&1; then
  echo "ERROR: upstream/main not found locally. Run: git fetch upstream" >&2
  exit 1
fi

# Step 1: Apply tag with same-day collision handling (per D-05).
# git tag exits 128 on duplicate — check before tagging and add suffix if needed.
if git rev-parse "${TAG}" > /dev/null 2>&1; then
  SUFFIX=2
  while git rev-parse "${TAG}-${SUFFIX}" > /dev/null 2>&1; do
    SUFFIX=$((SUFFIX + 1))
  done
  TAG="${TAG}-${SUFFIX}"
  echo "Note: tag for today already exists; using ${TAG}"
fi
git tag "${TAG}"
echo "Tagged: ${TAG}"

# Step 2: Clear old patches and export fork-only commits (per D-07, pitfall 4).
# Format-patch silently skips merge commits (--no-merges documents this intent).
rm -f "${PATCHES_DIR}"/*.patch
git format-patch --no-merges upstream/main..thamw-main \
  --output-directory "${PATCHES_DIR}"
echo "Patches exported to ${PATCHES_DIR}/"

# Step 3: Generate MANIFEST.md (per D-08).
# format-patch numbers patches oldest-first; git log default is newest-first.
# Use --reverse so commit order matches patch file numbering.
# Use bash 3.2-compatible while-loop instead of mapfile (pitfall 2).
MANIFEST="${PATCHES_DIR}/MANIFEST.md"

PATCH_FILES=()
while IFS= read -r f; do PATCH_FILES+=("$f"); done < <(ls "${PATCHES_DIR}"/*.patch 2>/dev/null | sort)

COMMITS=()
while IFS= read -r c; do COMMITS+=("$c"); done < <(
  git log --no-merges --reverse --pretty=format:"%h|%s" upstream/main..thamw-main
)

{
  echo "# Fork Patch Manifest"
  echo ""
  echo "**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "**Tag:** ${TAG}"
  echo "**Range:** \`upstream/main..thamw-main\` (non-merge commits only)"
  echo ""
  echo "| Patch File | Commit | Message | Files Touched |"
  echo "|------------|--------|---------|---------------|"

  for i in "${!PATCH_FILES[@]}"; do
    patch_file=$(basename "${PATCH_FILES[$i]}")
    commit_info="${COMMITS[$i]:-unknown|unknown}"
    hash="${commit_info%%|*}"
    msg="${commit_info#*|}"
    files=$(git show --name-only --format="" "${hash}" | paste -sd ',' - | sed 's/,/, /g')
    echo "| \`${patch_file}\` | \`${hash}\` | ${msg} | ${files} |"
  done
} > "${MANIFEST}"

echo "MANIFEST written: ${MANIFEST}"
echo "Done. Tag: ${TAG}, patches: ${#PATCH_FILES[@]}"
