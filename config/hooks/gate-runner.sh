#!/usr/bin/env sh

# Shared parallel gate runner for the git hooks.
#
# Extracted from .husky/pre-commit when the quality gates were split across
# two stages, so the commit hook and the push hook cannot drift apart in how
# they schedule gates, report failures, or preserve logs.
#
# Usage from a hook:
#   . "$(dirname "$0")/../config/hooks/gate-runner.sh"
#   gate_init "commit"
#   run_gate "id" "Human label" some command
#   wait_gates "id" ...

# gate_init <stage-name>
# Creates the scratch directory the gates write their output into and
# arranges for it to be removed when the hook exits.
gate_init() {
  GATE_STAGE="$1"
  GATE_DIR=$(mktemp -d)
  trap 'rm -rf "$GATE_DIR"' EXIT
}

# run_gate <id> <label> <command...>
# Runs a gate in the background, capturing output, duration and exit code.
#
# The command runs as an `if` condition so that `sh -e` (how husky invokes the
# hooks) cannot abort the subshell before the exit code is recorded. Without
# that, every failing gate was reported as the fallback "exit 1" regardless of
# what it actually returned.
run_gate() {
  _id="$1"; _label="$2"; shift 2
  (
    _started=$(date +%s)
    echo "Running: ${_label}" > "$GATE_DIR/${_id}.log"
    if "$@" >> "$GATE_DIR/${_id}.log" 2>&1; then _code=0; else _code=$?; fi
    echo $(( $(date +%s) - _started )) > "$GATE_DIR/${_id}.secs"
    echo "$_code" > "$GATE_DIR/${_id}.exit"
  ) &
}

# wait_gates <id1> <id2> ...
# Waits for all listed gates, prints results, exits on first failure.
wait_gates() {
  wait
  _failed=""
  for _id in "$@"; do
    _exit_code=$(cat "$GATE_DIR/${_id}.exit" 2>/dev/null || echo 1)
    _secs=$(cat "$GATE_DIR/${_id}.secs" 2>/dev/null || echo "?")
    if [ "$_exit_code" = "0" ]; then
      echo "  ✅ $_id (${_secs}s)"
    else
      echo "  ❌ $_id (exit $_exit_code, ${_secs}s)"
      _failed="${_failed} ${_id}"
    fi
  done
  if [ -n "$_failed" ]; then
    echo ""
    echo "❌ FAILED GATES:${_failed}"
    echo ""
    # Preserve logs before the EXIT trap removes GATE_DIR. Without this the
    # only copy is the scrollback below, which is unrecoverable after a
    # parallel run — losing the evidence for intermittent failures.
    # mktemp -d guarantees uniqueness: concurrent hook runs (or a rapid
    # amend/retry) can share a whole-second timestamp and would otherwise
    # overwrite each other's logs. The timestamp is kept only for readability.
    _keep_root=".git/${GATE_STAGE:-hook}-failures"
    _keep_dir=""
    if mkdir -p "$_keep_root" 2>/dev/null; then
      _keep_dir=$(mktemp -d "$_keep_root/$(date +%Y%m%d-%H%M%S)-XXXXXX" 2>/dev/null) || _keep_dir=""
    fi

    # Track per-gate copy results so the summary never claims a log was
    # preserved when mkdir/mktemp/cp actually failed.
    _kept=""
    _keep_failed=""
    for _id in $_failed; do
      if [ -n "$_keep_dir" ] && cp "$GATE_DIR/${_id}.log" "$_keep_dir/${_id}.log" 2>/dev/null; then
        _kept="${_kept} ${_id}"
      else
        _keep_failed="${_keep_failed} ${_id}"
      fi
      echo "── Output of $_id ──"
      cat "$GATE_DIR/${_id}.log" 2>/dev/null
      echo ""
    done

    if [ -n "$_kept" ]; then
      echo "📁 Logs preserved in ${_keep_dir}:${_kept}"
    fi
    if [ -n "$_keep_failed" ]; then
      echo "⚠️  Could not preserve logs for:${_keep_failed} — see output above."
    fi
    exit 1
  fi
}
