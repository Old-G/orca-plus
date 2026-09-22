#!/usr/bin/env bash
# Scheduled entry point (launchd): runs `sync-upstream.sh --unattended --publish` only when nobody is working
# in the repo, then posts one macOS notification. Skips leave the stack untouched and try next time.
# Must stay bash 3.2 compatible.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 3
GIT_DIR=$(git rev-parse --absolute-git-dir) || exit 3
STATE_DIR="$GIT_DIR/custom-sync"
LOG="$STATE_DIR/scheduled.log"
LOCK="$STATE_DIR/scheduled.lock"
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
branch=$(git symbolic-ref --quiet --short HEAD || echo detached)
case "$branch" in
  custom | main) ;;
  *) skip "checked out on '$branch', not custom/main" ;;
esac

log "start"
"$ROOT/scripts/sync-upstream.sh" --unattended --publish "$@"
code=$?
report="$STATE_DIR/last-report.md"
log "exit $code ($(sed -n 's/^## //p' "$report" 2>/dev/null | tail -1))"

case "$code" in
  0)
    if grep -q '^## OK — custom пересобран' "$report" 2>/dev/null; then
      notify "orca-custom sync" "Стек пересобран на свежем upstream. Перезапусти dev-сборку."
    fi
    ;;
  1) notify "orca-custom sync" "Конфликт с upstream — стек не тронут. Запусти scripts/sync-upstream.sh вручную." ;;
  2) notify "orca-custom sync" "Проверки упали после rebase — стек откатан. Отчёт: .git/custom-sync/last-report.md" ;;
  4) notify "orca-custom sync" "Стек пересобран, но push в форк отклонён — там чужие коммиты? Отчёт: .git/custom-sync/last-report.md" ;;
  *) notify "orca-custom sync" "Синхронизация не запустилась (код $code). Отчёт: .git/custom-sync/last-report.md" ;;
esac
exit "$code"
