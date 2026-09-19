#!/usr/bin/env bash
# Merge every pushed demo/<slug> branch into main, build, deploy, and check the live pages.
# Usage: scripts/merge-deploy.sh [slug ...]   (no args = every origin/demo/* branch not yet merged)
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch -q origin
if [ $# -gt 0 ]; then branches=(); for s in "$@"; do branches+=("origin/demo/$s"); done
else mapfile -t branches < <(git branch -r --no-merged main | grep 'origin/demo/' | sed 's/^ *//'); fi
merged=()
for b in "${branches[@]}"; do
  slug=${b#origin/demo/}
  if git merge -q --no-edit "$b" 2>/dev/null; then merged+=("$slug"); continue; fi
  # Only the lockfile may conflict: take ours, reinstall, keep going.
  if git diff --name-only --diff-filter=U | grep -qvE '^(pnpm-lock.yaml|package.json)$'; then
    echo "!! conflict on $b outside lockfile:"; git diff --name-only --diff-filter=U; git merge --abort; continue
  fi
  git checkout --theirs package.json 2>/dev/null || true
  git checkout --ours pnpm-lock.yaml 2>/dev/null || true
  pnpm install --prefer-offline >/dev/null 2>&1
  git add package.json pnpm-lock.yaml && git commit -q --no-edit && merged+=("$slug")
done
echo "merged: ${merged[*]:-none}"
[ ${#merged[@]} -gt 0 ] || exit 0
pnpm install --prefer-offline >/dev/null 2>&1
pnpm build 2>&1 | tail -n 3
npx wrangler deploy --env production 2>&1 | tail -n 2
git push -q origin main
sleep 8
for s in "${merged[@]}"; do
  printf '%s -> %s\n' "$s" "$(curl -s -o /dev/null -w '%{http_code}' "https://demo.milliseconds.ai/$s/")"
done
