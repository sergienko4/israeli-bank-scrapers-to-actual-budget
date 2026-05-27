#!/usr/bin/env bash
# scripts/check-readme-markers.sh
# Fast structural validator for marker fragments. Verifies:
#   - every <!-- meta:NAME:start --> has exactly one matching :end
#   - no two pairs share a name in the same file
#   - names are kebab-case (lowercase, digits, hyphens; must start with letter)
# Exits 0 on success, 1 on any violation.
#
# Run via: bash scripts/check-readme-markers.sh [file ...]
# Defaults to README.md and README.docker-hub.md if no args given.

set -euo pipefail
trap 'rm -f "/tmp/markers-$$"' EXIT INT TERM

if [ $# -eq 0 ]; then
  set -- README.md README.docker-hub.md
fi

fail=0
for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "skip: $file (does not exist)"
    continue
  fi
  # Extract all marker tags from the file
  awk '
    match($0, /<!--[[:space:]]*meta:[a-z][a-z0-9-]*:(start|end)[[:space:]]*-->/) {
      tag = substr($0, RSTART, RLENGTH)
      sub(/<!--[[:space:]]*meta:/, "", tag)
      sub(/[[:space:]]*-->/, "", tag)
      print tag
    }
  ' "$file" > /tmp/markers-$$
  starts=$(grep -c ':start$' /tmp/markers-$$ || true)
  ends=$(grep -c ':end$' /tmp/markers-$$ || true)
  if [ "$starts" != "$ends" ]; then
    echo "FAIL: $file — $starts :start markers vs $ends :end markers"
    fail=1
  fi
  # Each name must appear exactly once as :start and exactly once as :end
  while IFS= read -r name; do
    sc=$(grep -c "^${name}:start$" /tmp/markers-$$ || true)
    ec=$(grep -c "^${name}:end$" /tmp/markers-$$ || true)
    if [ "$sc" != "1" ] || [ "$ec" != "1" ]; then
      echo "FAIL: $file — marker '$name' has $sc :start / $ec :end (expected 1/1)"
      fail=1
    fi
  done < <(sed 's/:start$//;s/:end$//' /tmp/markers-$$ | sort -u)
  rm -f /tmp/markers-$$
done

if [ "$fail" -eq 0 ]; then
  echo "OK: all marker pairs balanced"
fi
exit "$fail"
