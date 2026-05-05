#!/usr/bin/env bash
set -euo pipefail

PATCHES_DIR=".planning/patches"
# IN-01: Personal fork branch name — change here if renamed
FORK_BRANCH="thamw-main"
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
# WR-03: mkdir -p ensures the directory exists before first use.
# WR-04: nullglob prevents rm -f from receiving a literal glob string on empty dir.
mkdir -p "${PATCHES_DIR}"
shopt -s nullglob
rm -f "${PATCHES_DIR}"/*.patch
shopt -u nullglob
git format-patch --no-merges "upstream/main..${FORK_BRANCH}" \
  --output-directory "${PATCHES_DIR}"
echo "Patches exported to ${PATCHES_DIR}/"

# Step 3: Generate MANIFEST.md (per D-08).
# format-patch numbers patches oldest-first; git log default is newest-first.
# Use --reverse so commit order matches patch file numbering.
# Use bash 3.2-compatible while-loop instead of mapfile (pitfall 2).
MANIFEST="${PATCHES_DIR}/MANIFEST.md"

# WR-01: Use find instead of ls — find exits 0 when no files match, safe under set -e.
PATCH_FILES=()
while IFS= read -r f; do PATCH_FILES+=("$f"); done < <(
  find "${PATCHES_DIR}" -maxdepth 1 -name "*.patch" | sort
)

{
  echo "# Fork Patch Manifest"
  echo ""
  echo "**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "**Tag:** ${TAG}"
  echo "**Range:** \`upstream/main..${FORK_BRANCH}\` (non-merge commits only)"
  echo ""
  echo "| Patch File | Commit | Message | Files Touched |"
  echo "|------------|--------|---------|---------------|"

  # WR-02: Extract commit hash from the patch file header itself so array ordering
  # cannot cause misalignment between PATCH_FILES and COMMITS.
  # IN-02: grep -v '^$' strips the leading blank line that some git versions emit.
  for patch_file in "${PATCH_FILES[@]}"; do
    hash=$(grep -m1 "^From " "${patch_file}" | awk '{print $2}' | cut -c1-7)
    msg=$(git log -1 --pretty=format:"%s" "${hash}" 2>/dev/null || echo "unknown")
    files=$(git show --name-only --format="" "${hash}" | grep -v '^$' | paste -sd ',' - | sed 's/,/, /g')
    echo "| \`$(basename "${patch_file}")\` | \`${hash}\` | ${msg} | ${files} |"
  done
} > "${MANIFEST}"

echo "MANIFEST written: ${MANIFEST}"
echo "Done. Tag: ${TAG}, patches: ${#PATCH_FILES[@]}"
