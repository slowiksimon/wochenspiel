#!/bin/bash
# Builds both bundles and runs every suite; prints one summary line per suite and exits with 1 if one of them failed.
# Needs Chromium: set CHROMIUM=/path/to/chromium if it is not at /opt/pw-browsers/chromium.
cd "$(dirname "$0")/.."
LOG="${LOGDIR:-${TMPDIR:-/tmp}/slowik-test-logs}"; mkdir -p "$LOG"
FAIL=0
run() { name="$1"; shift; "$@" > "$LOG/$name.log" 2>&1; code=$?; echo "$name: $(grep -E '^[0-9]+/[0-9]+ checks passed' "$LOG/$name.log" | tail -1) (exit $code)"; [ $code -eq 0 ] || FAIL=1; }
node build.mjs > "$LOG/build.log" 2>&1 && FAKE=1 node build.mjs >> "$LOG/build.log" 2>&1 || { echo "BUILD FAILED"; cat "$LOG/build.log"; exit 1; }
run unit node tests/unit.mjs
run subpath node tests/run-subpath.mjs
run lists node tests/run-lists.mjs
run regress node tests/run-regress.mjs
run real env DIST=dist node tests/run-real.mjs
run e2e node tests/run-e2e.mjs
echo "logs: $LOG"
exit $FAIL
