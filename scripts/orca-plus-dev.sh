#!/usr/bin/env bash
# Launches the Orca+ dev build beside the installed Orca+ (own profile, own CDP port, off screen).
#
#   scripts/orca-plus-dev.sh              run in this terminal
#   scripts/orca-plus-dev.sh --detach     run in the background; log in $TMPDIR/orca-plus-dev.log
#   scripts/orca-plus-dev.sh --foreground show the window (only when someone is watching)
#
# Profile: ~/Library/Application Support/orca-dev-custom. CDP: $ORCA_DEV_CDP_PORT or 9356
# (the runner probes another port if it is taken). Slack stays paused unless ORCA_DEV_SLACK=1.
# Drive it with: node scripts/orca-plus-cdp.mjs shot /tmp/dev.png
set -euo pipefail

detach=0
background=1
passthrough=()
for arg in "$@"; do
  case "$arg" in
    --detach) detach=1 ;;
    --foreground) background=0 ;;
    *) passthrough+=("$arg") ;;
  esac
done

# Why: started from an Orca+ terminal, the installed app's ORCA_* vars (hook port/token, pane key,
# userData) would leak into the dev build and its agents. Keep only ORCA_DEV_* knobs.
for v in $(env | sed -n 's/^\(ORCA_[A-Z0-9_]*\)=.*/\1/p' | grep -v -E '^ORCA_DEV_' || true); do unset "$v"; done
# Why: launched from a Claude Code session, its markers would make every claude in the dev
# build's terminals think it is a child session of this one.
for v in $(env | sed -n -E 's/^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_[A-Z0-9_]*)=.*/\1/p' || true); do unset "$v"; done

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null
nvm use 24 >/dev/null
# Why: the first `claude` on PATH decides managed-hook capabilities (a stale one stripped SessionEnd).
export PATH="$HOME/.local/bin:$PATH"
export ORCA_DEV_USER_DATA_PATH="$HOME/Library/Application Support/orca-dev-custom"
export ORCA_DEV_DOCK_TITLE="Orca+ dev" ORCA_DEV_INSTANCE_LABEL="custom" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
[ "$background" = 1 ] && export ORCA_BACKGROUND_LAUNCH=1
cdp_port="${ORCA_DEV_CDP_PORT:-9356}"
if ! lsof -nP -iTCP:"$cdp_port" -sTCP:LISTEN >/dev/null 2>&1; then
  export REMOTE_DEBUGGING_PORT="$cdp_port"
fi

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
if [ "$detach" = 1 ]; then
  log="${TMPDIR:-/tmp}/orca-plus-dev.log"
  nohup corepack pnpm dev -- ${passthrough[@]+"${passthrough[@]}"} >"$log" 2>&1 &
  echo "orca-plus-dev: pid $! · log $log · CDP ${REMOTE_DEBUGGING_PORT:-probed (see log)}"
else
  exec corepack pnpm dev -- ${passthrough[@]+"${passthrough[@]}"}
fi
