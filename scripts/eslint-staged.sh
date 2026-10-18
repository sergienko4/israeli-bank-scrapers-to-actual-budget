#!/usr/bin/env bash
# scripts/eslint-staged.sh
# Commit-stage ESLint. Lints the staged path set (added, copied, modified
# or renamed files) as it is in the working tree:
#   src/**/*.ts                → main config (eslint.config.mjs)
#   src/Portal/Public/**/*.js  → config/eslint.portal-public.mjs
# Anything else is not ESLint's business at commit time. A set with no
# staged files is skipped, and so is a staged path deleted from the working
# tree (ESLint would crash on it; CI lints the committed blob). Caches live
# under node_modules/.cache/eslint/:
# ESLint deletes the default .eslintcache whenever it runs without --cache,
# which emptied the old commit-stage cache on every run.
#
# The push hook and CI run full uncached ESLint (`npm run lint`), which also
# catches a typed rule failing an unchanged file when a type it uses changes.
#
# Run via: npm run lint:staged
# Works with bash 3.2 (macOS /bin/bash): no mapfile, and empty arrays are
# never expanded under `set -u`.

set -euo pipefail

CACHE_DIR="node_modules/.cache/eslint"
STAGED_LIST=$(mktemp)
trap 'rm -f "$STAGED_LIST"' EXIT

git diff --cached --name-only --diff-filter=ACMR -z > "$STAGED_LIST"

ts_files=()
js_files=()
while IFS= read -r -d '' path; do
  case "$path" in
    src/Portal/Public/*.js) target=js ;;
    src/*.ts) target=ts ;;
    *) continue ;;
  esac
  if [ ! -f "$path" ]; then
    echo "ESLint: not linting $path (staged, but missing from the working tree)"
    continue
  fi
  if [ "$target" = js ]; then js_files+=("$path"); else ts_files+=("$path"); fi
done < "$STAGED_LIST"

if [ "${#ts_files[@]}" -eq 0 ]; then
  echo "ESLint: skipped (no staged src TS files)"
else
  npx eslint --cache --cache-strategy content \
    --cache-location "$CACHE_DIR/src.cache" --no-warn-ignored \
    -- "${ts_files[@]}"
fi

if [ "${#js_files[@]}" -eq 0 ]; then
  echo "Portal ESLint: skipped (no staged portal JS files)"
else
  npx eslint --config config/eslint.portal-public.mjs \
    --cache --cache-strategy content \
    --cache-location "$CACHE_DIR/portal.cache" --no-warn-ignored \
    -- "${js_files[@]}"
fi
