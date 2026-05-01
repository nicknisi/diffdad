#!/usr/bin/env bash
set -euo pipefail

CURRENT=$(jq -r .version package.json)
echo "Current version: $CURRENT"

if [ -n "${1:-}" ]; then
  NEXT="$1"
else
  IFS='.' read -r major minor patch <<< "$CURRENT"
  NEXT="$major.$minor.$((patch + 1))"
  read -rp "Next version [$NEXT]: " input
  NEXT="${input:-$NEXT}"
fi

echo "Releasing v$NEXT..."

# Update version in package.json
jq --arg v "$NEXT" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json

# Commit, tag, push
git add package.json
git commit -m "chore: v$NEXT"
git tag "v$NEXT"
git push origin main --tags

echo ""
echo "  v$NEXT released — CI will build binaries and update the Homebrew formula."
echo "  https://github.com/nicknisi/diffdad/actions"
