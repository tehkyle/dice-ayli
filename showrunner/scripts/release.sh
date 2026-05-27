#!/usr/bin/env bash
set -e

# Bump patch version in package.json only (no git commit/tag yet)
npm version patch --no-git-tag-version

VERSION=$(node -p "require('./package.json').version")
echo "Releasing v$VERSION..."

# Stage everything in the repo (site/, showrunner/, etc.)
git add -A

git commit -m "v$VERSION"
git tag "v$VERSION"
git push origin main --follow-tags

echo "✓ v$VERSION pushed — github.com/tehkyle/dice-ayli/actions"
