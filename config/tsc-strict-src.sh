#!/usr/bin/env bash
# Runs tsc but only fails on errors in project source, not node_modules.
# Needed because @actual-app/core ships raw .ts via exports field —
# skipLibCheck only skips .d.ts, so tsc follows imports into their
# strict-incompatible source and reports 1600+ false positives.
# See: https://github.com/microsoft/TypeScript/issues/41883
set +e
OUTPUT=$(npx tsc "$@" 2>&1)
EXIT=$?
set -e

if [ "$EXIT" -eq 0 ]; then
  exit 0
fi

SRC_ERRORS=$(echo "$OUTPUT" | grep ": error TS" | grep -v "^node_modules/" || true)
if [ -n "$SRC_ERRORS" ]; then
  echo "$OUTPUT"
  exit 1
fi

COUNT=$(echo "$OUTPUT" | grep -c "^node_modules/.*: error TS" || true)
echo "⚠️ ${COUNT} type error(s) in node_modules/ only (upstream) — ignored" >&2
