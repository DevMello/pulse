#!/usr/bin/env bash
# Builds packages/sdk and publishes it to a standalone branch (sdk-dist) whose
# root *is* the package, so plain `npm install github:<repo>#sdk-dist` works
# (npm has no support for installing from a subdirectory of a git repo; pnpm
# does via #path:, but this branch keeps npm/yarn/pnpm all working the same way).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="sdk-dist"
WORKTREE_DIR="$(mktemp -d)"

cd "$REPO_ROOT/packages/sdk"
rm -rf dist
npm run build

cd "$REPO_ROOT"

# Set up an orphan branch in a scratch worktree so we never touch the
# checked-out working tree on main.
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git worktree add --detach "$WORKTREE_DIR" "origin/$BRANCH"
  cd "$WORKTREE_DIR"
  git checkout -B "$BRANCH"
else
  git worktree add --detach "$WORKTREE_DIR"
  cd "$WORKTREE_DIR"
  git checkout --orphan "$BRANCH"
fi

# Clear everything except .git, then copy in the built package.
find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -R "$REPO_ROOT/packages/sdk/dist" ./dist
cp "$REPO_ROOT/packages/sdk/package.json" ./package.json
cp "$REPO_ROOT/packages/sdk/README.md" ./README.md
cp "$REPO_ROOT/LICENSE" ./LICENSE

# Drop the monorepo-only "directory" hint and dev-only build scripts; this
# branch ships prebuilt dist, so consumers never run them.
node --input-type=commonjs -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  delete pkg.repository?.directory;
  delete pkg.scripts;
  delete pkg.devDependencies;
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

git add -A
if git diff --cached --quiet; then
  echo "No changes to publish."
else
  VERSION="$(node -p "require('./package.json').version")"
  git commit -m "Publish SDK v$VERSION"
fi

git push origin "HEAD:refs/heads/$BRANCH" --force

cd "$REPO_ROOT"
git worktree remove --force "$WORKTREE_DIR"

echo "Published to origin/$BRANCH"
