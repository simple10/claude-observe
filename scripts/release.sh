#!/usr/bin/env bash
# Release script for Claude Observe.
# Bumps version in all files, commits, tags, and pushes.
#
# Usage: scripts/release.sh <version>
#   e.g.  scripts/release.sh 0.6.0
#         scripts/release.sh v0.6.0

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: scripts/release.sh <version>  (e.g. 0.6.0)"
  exit 1
fi

# Normalize: strip leading "v", then build tag
VERSION="${VERSION#v}"
TAG="v${VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working directory is not clean — commit or stash changes first"
  exit 1
fi

echo "=== Releasing $TAG ==="

# ── Bump versions ────────────────────────────────────────

echo "Bumping version to $VERSION..."

# package.json (root)
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json

# .claude-plugin/plugin.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" .claude-plugin/plugin.json

# observe_cli.mjs — pin Docker image to this release tag
sed -i '' "s|ghcr.io/simple10/claude-observe:[^'\"]*|ghcr.io/simple10/claude-observe:$TAG|" hooks/scripts/observe_cli.mjs

# ── Test and build ───────────────────────────────────────

echo ""
echo "=== Running tests ==="
npm test

echo ""
echo "=== Building Docker image ==="
docker build -t claude-observe:local .

# ── Commit, tag, push ────────────────────────────────────

echo ""
echo "Committing version bump..."
git add package.json .claude-plugin/plugin.json hooks/scripts/observe_cli.mjs
git commit -m "release: v${VERSION}"

echo "Tagging $TAG..."
git tag "$TAG"

echo "Pushing tag..."
git push origin "$TAG"

echo ""
echo "=== Released $TAG ==="
echo "GitHub Actions will build and publish the Docker image."
echo "Watch: https://github.com/simple10/claude-observe/actions"
