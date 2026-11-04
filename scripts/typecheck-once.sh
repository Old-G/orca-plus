#!/usr/bin/env bash
# One typecheck at a time, lowest CPU priority, projects one after another.
# Why: `pnpm tc` runs every project in parallel with up to 75% of RAM, and two of those at once froze
# the owner's laptop (04.11). Used by the upstream sync and by the ship build only when asked
# (ORCA_PLUS_TYPECHECK=1); agents are kept away from tsc by the owner's PreToolUse hook.
#
#   scripts/typecheck-once.sh            every root project, as `pnpm tc` checks them
#   scripts/typecheck-once.sh <tsconfig>  just these projects
set -euo pipefail
cd "$(dirname "$0")/.."

lock="${TMPDIR:-/tmp}/orca-typecheck.lock"
until mkdir "$lock" 2>/dev/null; do
  holder=$(cat "$lock/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$lock"
    continue
  fi
  echo "typecheck-once: another typecheck is running (pid ${holder:-?}), waiting…" >&2
  sleep 15
done
echo $$ >"$lock/pid"
trap 'rm -rf "$lock"' EXIT

node config/scripts/build-workspace-packages.mjs
if [ $# -gt 0 ]; then
  projects=("$@")
else
  projects=()
  while IFS= read -r p; do projects+=("$p"); done < <(node --input-type=module -e "
    import { TYPECHECK_PROJECTS } from './config/scripts/run-typecheck-projects-in-parallel.mjs'
    for (const p of TYPECHECK_PROJECTS) console.log(p.config)")
fi
for p in "${projects[@]}"; do
  echo "typecheck-once: $p" >&2
  nice -n 19 node config/scripts/run-typecheck-projects-in-parallel.mjs --project="$p"
done
