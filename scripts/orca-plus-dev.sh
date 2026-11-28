#!/usr/bin/env bash
# Launches the Orca+ dev build beside the installed Orca+ (own profile, own CDP port, off screen).
#
#   scripts/orca-plus-dev.sh              run in this terminal
#   scripts/orca-plus-dev.sh --detach     run in the background; log in $TMPDIR/orca-plus-dev.log
#   scripts/orca-plus-dev.sh --foreground show the window (only when someone is watching)
#   scripts/orca-plus-dev.sh --check      only say whether DEV is free (exit 0) or taken (exit 2)
#
# One DEV per machine: a second start does not fight for the profile, it exits 2 with the first
# one's worktree, pid, CDP address and log. Claim file: ~/Library/Application Support/orca-dev-custom.owner
# ($ORCA_DEV_OWNER_FILE overrides it); a dead pid's claim is replaced silently.
#
# Profile: ~/Library/Application Support/orca-dev-custom. CDP: $ORCA_DEV_CDP_PORT or 9356
# (the runner probes another port if it is taken). Slack stays paused unless ORCA_DEV_SLACK=1.
# Drive it with: node scripts/orca-plus-cdp.mjs shot /tmp/dev.png
set -euo pipefail

detach=0
background=1
check_only=0
passthrough=()
for arg in "$@"; do
  case "$arg" in
    --detach) detach=1 ;;
    --foreground) background=0 ;;
    --check) check_only=1 ;;
    *) passthrough+=("$arg") ;;
  esac
done

owner_file="${ORCA_DEV_OWNER_FILE:-$HOME/Library/Application Support/orca-dev-custom.owner}"
lstart_of() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'; }
# Claim format, one line each: pid, process start time (guards against pid reuse), worktree, log.
owner_alive() {
  [ -f "$owner_file" ] || return 1
  local pid started
  pid="$(sed -n 1p "$owner_file")"
  started="$(sed -n 2p "$owner_file")"
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  [ "$(lstart_of "$pid")" = "$started" ]
}
refuse_if_taken() {
  owner_alive || return 0
  local pid tree log cdp=""
  pid="$(sed -n 1p "$owner_file")"
  tree="$(sed -n 3p "$owner_file")"
  log="$(sed -n 4p "$owner_file")"
  if [ -f "$tree/out/dev-instance.json" ]; then
    cdp="$(sed -n 's/.*"cdpUrl": *"\([^"]*\)".*/\1/p' "$tree/out/dev-instance.json" | head -1)"
  fi
  echo "orca-plus-dev: DEV already runs (pid $pid, worktree ${tree:-?}, CDP ${cdp:-see its log}, log ${log:--}). Use that one, or stop it first: kill $pid" >&2
  exit 2
}
refuse_if_taken
if [ "$check_only" = 1 ]; then echo "orca-plus-dev: DEV is free"; exit 0; fi
# Claim under a mkdir lock, so two simultaneous starts (and stale-claim cleanup) cannot both win.
claim() { # $1 pid  $2 log
  local lock="$owner_file.lock" tries=0
  mkdir -p "$(dirname "$owner_file")"
  until mkdir "$lock" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 50 ]; then rm -rf "$lock"; tries=0; fi # a crashed holder left it
    sleep 0.1
  done
  if owner_alive; then
    rmdir "$lock"
    # Lost the race: stop the detached copy just started (a foreground one is this very shell).
    [ "$1" = "$$" ] || kill "$1" 2>/dev/null || true
    refuse_if_taken
  fi
  printf '%s\n%s\n%s\n%s\n' "$1" "$(lstart_of "$1")" "$PWD" "$2" >"$owner_file"
  rmdir "$lock"
}
release_stale_claim() { owner_alive || rm -f "$owner_file"; }
release_stale_claim

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
  claim "$!" "$log"
  echo "orca-plus-dev: pid $! · log $log · CDP ${REMOTE_DEBUGGING_PORT:-probed (see log)}"
else
  claim "$$" "-"
  exec corepack pnpm dev -- ${passthrough[@]+"${passthrough[@]}"}
fi
