#!/usr/bin/env bash
# Scheduled entry point (launchd, daily): every SYNC_EVERY_DAYS days (default 3) runs
# `sync-upstream.sh --unattended --ci-verify` when nobody is working in the repo: the rebase and the
# guard run here, typecheck / build / tests run in the fork's Sync verify workflow, which promotes
# the stack to custom when green. The wrapper waits for that run (`gh run watch`, no local load),
# then posts one macOS notification. A stop (conflict, red checks, our changes missing) leaves
# custom untouched (local custom goes back to its pre-sync head) and hands the sync to a Claude agent in Orca+ (SYNC_AGENT=0: notify only).
# Why not local checks: the full suite took 55 minutes and froze the owner's laptop (22.11).
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
  log "notify: $2"
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

# Custom build (upstream-updates): the weekly check of plugins, archify, CLIs and brew tools rides this
# run, whatever the sync decides below; it gates itself to once a week and never fails the sync.
UPSTREAM_CHECK=${SYNC_UPSTREAM_CHECK-$HOME/.claude/skills/upstream-updates/run.sh}
[ -x "$UPSTREAM_CHECK" ] && "$UPSTREAM_CHECK" || true

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

# Why: a red run leaves the fork's custom alone, and local custom must not keep code that failed
# verification either (a dev build restarted from it would run it). Rolled back only while it is
# still on the stack that was sent; the candidate stays under refs/custom-sync/failed/<run>.
rollback_local() { # run, stack sent, local head before the sync
  local custom=${SYNC_CUSTOM:-custom} run=$1 sent=$2 old=$3
  [ -n "$old" ] && [ "$old" != "$sent" ] || return 0
  # Why: moving a branch another worktree has checked out turns its files into stray local edits.
  if git worktree list --porcelain | grep -qx "branch refs/heads/$custom" \
    && [ "$(git symbolic-ref --quiet --short HEAD || true)" != "$custom" ]; then
    printf 'Локальный %s не откатан: он открыт в другом worktree.\n' "$custom" >>"$report"
    return 0
  fi
  if [ "$(git rev-parse -q --verify "refs/heads/$custom" || true)" != "$sent" ]; then
    printf 'Локальный %s сдвинулся после отправки — не откатан.\n' "$custom" >>"$report"
    return 0
  fi
  git update-ref "refs/custom-sync/failed/$run" "$sent"
  if [ "$(git symbolic-ref --quiet --short HEAD || true)" = "$custom" ]; then
    git reset -q --keep "$old" || { printf 'Локальный %s не откатан: в дереве правки.\n' "$custom" >>"$report"; return 0; }
  else
    git update-ref "refs/heads/$custom" "$old" "$sent" || return 0
  fi
  printf 'Локальный %s откатан на %s; проверенный кандидат — refs/custom-sync/failed/%s.\n' \
    "$custom" "$(git rev-parse --short "$old")" "$run" >>"$report"
}

log "start"
"$ROOT/scripts/sync-upstream.sh" --unattended --ci-verify "$@"
code=$?
report="$STATE_DIR/last-report.md"
log "exit $code ($(sed -n 's/^## //p' "$report" 2>/dev/null | tail -1))"

CI_RESULT=""
if [ "$code" = 0 ] && [ -f "$STATE_DIR/ci-run" ]; then
  read -r ci_repo ci_run ci_head _ ci_promote ci_old <"$STATE_DIR/ci-run"
  log "waiting for GitHub run $ci_run"
  if gh run watch "$ci_run" -R "$ci_repo" --exit-status --interval 60 >/dev/null 2>&1; then
    CI_RESULT=green
  else
    # Why: watch also fails when it cannot reach the run, which may still go (or have gone) green.
    CI_RESULT=$(gh run view "$ci_run" -R "$ci_repo" --json status,conclusion \
      --jq 'if .status != "completed" then "unknown" elif .conclusion == "success" then "green" else "red" end' \
      2>/dev/null || echo unknown)
    case "$CI_RESULT" in green | red) ;; *) CI_RESULT=unknown ;; esac
  fi
  if [ "$CI_RESULT" = unknown ]; then
    code=6
    printf '\n## НЕ ДОЖДАЛСЯ ПРОГОНА — результат неизвестен, custom не тронут\nПрогон: https://github.com/%s/actions/runs/%s\n' \
      "$ci_repo" "$ci_run" >>"$report"
  elif [ "$CI_RESULT" = red ]; then
    code=2
    printf '\n## ПРОВЕРКИ НА GITHUB УПАЛИ — custom не тронут\nПрогон: https://github.com/%s/actions/runs/%s (gh run view %s -R %s --log-failed)\n' \
      "$ci_repo" "$ci_run" "$ci_run" "$ci_repo" >>"$report"
    rollback_local "$ci_run" "${ci_head:-}" "${ci_old:-}"
  fi
  log "GitHub run $ci_run: $CI_RESULT"
fi

case "$code" in
  0)
    if [ "$CI_RESULT" = green ] && [ "${ci_promote:-true}" != true ]; then
      notify "orca-custom sync" "Стек пересобран и проверен на GitHub (только проверка): custom не переведён."
    elif [ "$CI_RESULT" = green ]; then
      notify "orca-custom sync" "Стек пересобран, проверен на GitHub и опубликован в custom. Перезапусти dev-сборку."
    elif grep -q '^## OK — custom пересобран' "$report" 2>/dev/null; then
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
  6) notify "orca-custom sync" "Не дождался прогона на GitHub, результат неизвестен. Проверь: https://github.com/$ci_repo/actions/runs/$ci_run" ;;
  4) notify "orca-custom sync" "Стек пересобран, но push в форк отклонён — там чужие коммиты? Отчёт: .git/custom-sync/last-report.md" ;;
  *) notify "orca-custom sync" "Синхронизация не запустилась (код $code). Отчёт: .git/custom-sync/last-report.md" ;;
esac
exit "$code"
