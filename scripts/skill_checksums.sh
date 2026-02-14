#!/usr/bin/env bash
#
# skill_checksums.sh — Generate SHA-256 checksums for all skill JSON files
# and update skills_repo/manifest.json with the computed hashes.
#
# Usage:
#   ./scripts/skill_checksums.sh
#
# Requires: jq, shasum (macOS) or sha256sum (Linux)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills_repo"
MANIFEST="$SKILLS_DIR/manifest.json"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: manifest.json not found at $MANIFEST"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install with: brew install jq"
  exit 1
fi

# Detect SHA-256 command
if command -v shasum &>/dev/null; then
  sha_cmd() { shasum -a 256 "$1" | awk '{print $1}'; }
elif command -v sha256sum &>/dev/null; then
  sha_cmd() { sha256sum "$1" | awk '{print $1}'; }
else
  echo "ERROR: shasum or sha256sum required"
  exit 1
fi

echo "Updating checksums in $MANIFEST"
echo ""

# Read manifest, compute checksums, update in place
SKILL_COUNT=$(jq '.skills | length' "$MANIFEST")
UPDATED=0

for i in $(seq 0 $((SKILL_COUNT - 1))); do
  SKILL_PATH=$(jq -r ".skills[$i].path" "$MANIFEST")
  FULL_PATH="$SKILLS_DIR/$SKILL_PATH"

  if [ ! -f "$FULL_PATH" ]; then
    echo "  SKIP  $SKILL_PATH (file not found)"
    continue
  fi

  CHECKSUM=$(sha_cmd "$FULL_PATH")
  OLD_CHECKSUM=$(jq -r ".skills[$i].checksum" "$MANIFEST")

  if [ "$CHECKSUM" = "$OLD_CHECKSUM" ]; then
    echo "  OK    $SKILL_PATH ($CHECKSUM)"
  else
    echo "  SET   $SKILL_PATH ($CHECKSUM)"
    UPDATED=$((UPDATED + 1))
  fi

  # Update manifest in memory (we'll write once at the end)
  MANIFEST_CONTENT=$(jq ".skills[$i].checksum = \"$CHECKSUM\"" "$MANIFEST")
  echo "$MANIFEST_CONTENT" > "$MANIFEST"
done

# Update timestamp
MANIFEST_CONTENT=$(jq ".updated_at = \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" "$MANIFEST")
echo "$MANIFEST_CONTENT" > "$MANIFEST"

echo ""
echo "Done. $UPDATED checksum(s) updated, $SKILL_COUNT total skills."
