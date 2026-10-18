#!/usr/bin/env bash
# scripts/check-pii.sh
# Fails when TypeScript source interpolates a PII-bearing variable into a
# thrown error or a log line. Three pattern families:
#   1. ${password|token|otp|secret|digits|creditCard} on a throw/Error/fail( line
#   2. ${...proxy...} on a logger/.info/.warn/.error line
#   3. getLogger().info(...) interpolating merchant/amount/payee/customer names
# Static field names ("password is missing") are not matched.
#
# Run via: npm run lint:pii   (or: bash scripts/check-pii.sh [root])
# Root defaults to src/. Exits 0 when clean, 1 on a hit, 2 on a bad root.

set -euo pipefail

ROOT="${1:-src}"

if [ ! -d "$ROOT" ]; then
  echo "PII scan root not found: $ROOT"
  exit 2
fi

HITS=$(grep -rn "\${password}\|\${token}\|\${otp}\|\${secret}\|\${digits}\|\${creditCard}" "$ROOT" --include="*.ts" | grep -i "throw\|Error\|fail(" || true)
HITS2=$(grep -rn "\${.*proxy.*}" "$ROOT" --include="*.ts" | grep -i "logger\|\.info\|\.warn\|\.error" || true)
HITS3=$(grep -rn "getLogger().info.*\${.*\.merchant\|getLogger().info.*\${.*\.amount\|getLogger().info.*\${.*\.payee\|getLogger().info.*\${.*customerName\|getLogger().info.*\${.*payeeName" "$ROOT" --include="*.ts" || true)
ALL="${HITS}${HITS2}${HITS3}"

if [ -n "$ALL" ]; then
  echo "PII variable interpolation detected:"
  echo "$ALL"
  exit 1
fi
echo "No PII detected in error messages or info logs"
