#!/usr/bin/env bash
# Vitest for scripts/sync-upstream.sh: runs the suite, retries failed files once (flaky), then
# passes if every file still failing is listed in scripts/sync-known-test-failures.txt.
#
#   sync-upstream-tests.sh <report-prefix> related <base-ref>   tests related to src/ changes since base
#   sync-upstream-tests.sh <report-prefix> full                 whole suite
#
# Lines starting with "NOTE:" are copied into the sync report. Must stay bash 3.2 compatible.
set -euo pipefail

PREFIX=$1
MODE=$2
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
KNOWN="$ROOT/scripts/sync-known-test-failures.txt"
VITEST=${SYNC_VITEST_CMD:-corepack pnpm exec vitest}

run_vitest() { # json-out, vitest args...
  local json=$1
  shift
  rm -f "$json"
  # shellcheck disable=SC2086 # VITEST is a command line
  $VITEST "$@" --config config/vitest.config.ts --reporter=default --reporter=json \
    --outputFile.json="$json"
}

failed_files() { node "$ROOT/scripts/sync-upstream-test-triage.mjs" "$1" "$ROOT"; }

case "$MODE" in
  related)
    files=$(git diff --name-only --diff-filter=AMR "$3...HEAD" -- src)
    if [ -z "$files" ]; then
      echo "no custom files under src/ — nothing related to test"
      exit 0
    fi
    node config/scripts/ensure-native-runtime.mjs --runtime=node
    # Why --exclude: `related` crawls every included test's import graph, and the config/scripts
    # tests import mobile/, a separate workspace we do not install; our changes live under src/.
    # shellcheck disable=SC2086 # newline-separated paths without spaces
    # Why: these ratchets scan the tree instead of importing our files, so `related` never
    # picks them, yet a feature can break them (direct child_process spawns).
    ratchets="src/shared/child-process/child-process-import-boundary.test.ts src/shared/child-process/windows-console-visibility.test.ts"
    # shellcheck disable=SC2086
    set -- related --run --passWithNoTests --exclude 'config/scripts/**' $files $ratchets
    ;;
  full) set -- run ;;
  *) echo "sync-upstream-tests: unknown mode: $MODE" >&2; exit 3 ;;
esac

if run_vitest "$PREFIX-vitest.json" "$@"; then
  exit 0
fi

# A failed run with no failed file (config error, crash) is a real failure.
failed=$(failed_files "$PREFIX-vitest.json") || exit 1
[ -n "$failed" ] || exit 1

echo
echo "retrying failed files once:"
printf '  %s\n' $failed
# shellcheck disable=SC2086
if run_vitest "$PREFIX-vitest-retry.json" run $failed; then
  echo "NOTE: flaky, passed on retry: $(echo $failed)"
  exit 0
fi
still=$(failed_files "$PREFIX-vitest-retry.json") || exit 1
[ -n "$still" ] || exit 1

known_list=$(sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$KNOWN" 2>/dev/null || true)
unknown=""
known=""
for file in $still; do
  if printf '%s\n' "$known_list" | grep -qxF "$file"; then
    known="$known $file"
  else
    unknown="$unknown $file"
  fi
done
if [ -n "$unknown" ]; then
  echo "NOTE: new failures (not in sync-known-test-failures.txt):$unknown"
  exit 1
fi
echo "NOTE: only known failures remain:$known"
exit 0
