#!/usr/bin/env bash
# Scheduled entry point (launchd, daily): every SYNC_EVERY_DAYS days (default 3) runs
# `sync-upstream.sh --unattended --publish --full-tests` when nobody is working in the repo, then
# posts one macOS notification. A stop (conflict, failed checks, our changes missing) leaves the
# stack untouched and hands the sync to a Claude agent in Orca+ (SYNC_AGENT=0: notify only).
# Skips try again the next day. Must stay bash 3.2 compatible.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 3
GIT_DIR=$(git rev-parse --absolute-git-dir) || exit 3
STATE_DIR="$GIT_DIR/custom-sync"
LOG="$STATE_DIR/scheduled.log"
LOCK="$STATE_DIR/scheduled.lock"
LAST_RUN="$STATE_DIR/scheduled.last-run"
EVERY_DAYS=${SYNC_EVERY_DAYS:-3}
mkdir -p "$STATE_DIR"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

notify() { # title, message
  [ "${SYNC_NO_NOTIFY:-0}" = 1 ] && return 0
  osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true
}

skip() {
  log "skip: $*"
  echo "skip: $*"
  exit 0
}

if ! mkdir "$LOCK" 2>/dev/null; then
  skip "another scheduled sync is running ($LOCK)"
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# Why: the rebase rewrites files under a running dev build (HMR) and `build` replaces out/.
# Only the main process (`Electron .`): orphaned helpers of a killed build must not block syncs.
if pgrep -f "$ROOT/out/electron-dev/.*/Contents/MacOS/Electron \." >/dev/null 2>&1; then
  skip "a dev build from this repo is running"
fi
# Why: a manual sync keeps its state file until its checks finish (or a conflict awaits --continue).
if [ -f "$STATE_DIR/state" ]; then
  skip "a sync is already in progress or waiting for --continue ($STATE_DIR/state)"
fi
if [ -d "$GIT_DIR/rebase-merge" ] || [ -d "$GIT_DIR/rebase-apply" ]; then
  skip "a rebase is in progress"
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  skip "uncommitted changes in the working tree"
fi
# Why: an agent in this checkout may be mid-edit with a clean tree; the rebase would pull files
# from under it. Without Orca+ (no CLI or not running) there is no agent to wait for.
working_here=$(orca-plus worktree ps --json 2>/dev/null | ROOT="$ROOT" python3 -c '
import json, os, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit()
rows = data.get("worktrees", data.get("result", {}).get("worktrees", []))
print(sum(1 for w in rows if w.get("path") == os.environ["ROOT"]
          for a in (w.get("agents") or []) if a.get("state") == "working"))
' 2>/dev/null || true)
if [ -n "$working_here" ] && [ "$working_here" != 0 ]; then
  skip "an agent is working in this checkout"
fi
branch=$(git symbolic-ref --quiet --short HEAD || echo detached)
case "$branch" in
  custom | main) ;;
  *) skip "checked out on '$branch', not custom/main" ;;
esac

# Why the hour of slack: launchd fires at the same time each day; a run that took a while must not
# push the next one a whole day later.
now=$(date +%s)
last=$(cat "$LAST_RUN" 2>/dev/null || echo 0)
if [ "${SYNC_FORCE:-0}" != 1 ] && [ $((now - last)) -lt $((EVERY_DAYS * 86400 - 3600)) ]; then
  skip "not due: last run $(date -r "$last" '+%Y-%m-%d %H:%M' 2>/dev/null || echo never), every $EVERY_DAYS days"
fi
echo "$now" >"$LAST_RUN"

# Hands a stopped sync to a Claude agent in Orca+, with the brief and the report. False when Orca+
# or its CLI is not there; the notification then says to run the sync by hand.
hand_to_agent() { # exit code
  [ "${SYNC_AGENT:-1}" = 1 ] || return 1
  local cli prompt
  cli=$(command -v orca-plus 2>/dev/null || true)
  [ -n "$cli" ] || return 1
  prompt=$(sed "s/{{CODE}}/$1/" "$ROOT/scripts/sync-upstream-agent-brief.md")
  "$cli" agent launch --agent claude --worktree "path:$ROOT" --prompt "$prompt" --json \
    >>"$LOG" 2>&1
}

log "start"
"$ROOT/scripts/sync-upstream.sh" --unattended --publish --full-tests "$@"
code=$?
report="$STATE_DIR/last-report.md"
log "exit $code ($(sed -n 's/^## //p' "$report" 2>/dev/null | tail -1))"

case "$code" in
  0)
    if grep -q '^## OK — custom пересобран' "$report" 2>/dev/null; then
      notify "orca-custom sync" "Стек пересобран на свежем upstream. Перезапусти dev-сборку."
    fi
    ;;
  1 | 2 | 5)
    if hand_to_agent "$code"; then
      log "handed to an agent (code $code)"
      notify "orca-custom sync" "Синхронизация остановилась (код $code), стек не тронут. Агент в Orca+ доводит её до конца."
    else
      notify "orca-custom sync" "Синхронизация остановилась (код $code), стек не тронут. Запусти scripts/sync-upstream.sh вручную. Отчёт: .git/custom-sync/last-report.md"
    fi
    ;;
  4) notify "orca-custom sync" "Стек пересобран, но push в форк отклонён — там чужие коммиты? Отчёт: .git/custom-sync/last-report.md" ;;
  *) notify "orca-custom sync" "Синхронизация не запустилась (код $code). Отчёт: .git/custom-sync/last-report.md" ;;
esac
exit "$code"
