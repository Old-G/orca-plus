#!/usr/bin/env bash
# Sync our feature stack (`custom`) onto the latest upstream Orca.
#
#   fetch upstream → fast-forward the `main` mirror → rebase `custom` onto it
#   → install / typecheck / build / tests → report → (--publish) push `custom` to our fork
#
# Every commit on `custom` is one feature and carries a `Custom-Feature: <name>` trailer, so a
# conflict can be reported per feature. git rerere replays conflict resolutions it has seen before;
# only new conflicts stop the run. Reports and state live in .git/custom-sync/ (never committed).
#
# Must stay compatible with macOS /bin/bash 3.2 (launchd/cron): no associative arrays, no mapfile,
# no empty-array expansion under `set -u`.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/sync-upstream.sh [options]

  --continue      resume after resolving a conflict by hand (`git add` the files first)
  --unattended    for scheduled runs: abort the rebase on conflict, roll back on failed checks
  --full-tests    run the whole vitest suite instead of tests related to our changes
  --skip-checks   rebase only; no install / typecheck / build / tests
  --publish       after a verified sync, force-push custom to the fork (lease-protected) and
                  fast-forward the fork's mirror branch to upstream
  -h, --help      this help

Env overrides: SYNC_REMOTE (upstream), SYNC_REMOTE_BRANCH (main), SYNC_MIRROR (main),
               SYNC_CUSTOM (custom), SYNC_CHECKS_CMD (replace all checks with one shell command),
               SYNC_PUBLISH_REMOTE (origin), SYNC_PUBLISH_BRANCH (custom),
               SYNC_PUBLISH_MIRROR (main; empty = don't push the mirror)

Exit codes: 0 ok · 1 conflict needs a human · 2 checks failed · 3 precondition / git failure
            4 synced and verified, but the push to the fork was refused
EOF
}

REMOTE=${SYNC_REMOTE:-upstream}
REMOTE_BRANCH=${SYNC_REMOTE_BRANCH:-main}
MIRROR=${SYNC_MIRROR:-main}
CUSTOM=${SYNC_CUSTOM:-custom}
UPSTREAM_REF="refs/remotes/$REMOTE/$REMOTE_BRANCH"
PUBLISH_REMOTE=${SYNC_PUBLISH_REMOTE:-origin}
PUBLISH_BRANCH=${SYNC_PUBLISH_BRANCH:-custom}
PUBLISH_MIRROR=${SYNC_PUBLISH_MIRROR-main}

MODE=start
MANUAL_PENDING=0
UNATTENDED=0
FULL_TESTS=0
SKIP_CHECKS=0
PUBLISH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --continue) MODE=continue ;;
    --unattended) UNATTENDED=1 ;;
    --full-tests) FULL_TESTS=1 ;;
    --skip-checks) SKIP_CHECKS=1 ;;
    --publish) PUBLISH=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "sync-upstream: unknown option: $1" >&2; usage >&2; exit 3 ;;
  esac
  shift
done

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
GIT_DIR=$(git rev-parse --absolute-git-dir)
STATE_DIR="$GIT_DIR/custom-sync"
STATE_FILE="$STATE_DIR/state"
mkdir -p "$STATE_DIR/logs"

TS=$(date +%Y%m%d-%H%M%S)
REPORT="$STATE_DIR/report-$TS.md"
: >"$REPORT"
GIT_LOG="$STATE_DIR/logs/$TS-git.log"
STEP_OUT="$STATE_DIR/logs/$TS-git-step.log"
: >"$STEP_OUT"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
short() { git rev-parse --short "$1"; }

feature_of() {
  local f
  f=$(git log -1 --format='%(trailers:key=Custom-Feature,valueonly,separator=%x2C)' "$1" | tr -d '\n')
  if [ -n "$f" ]; then printf '%s' "$f"; else printf '(без Custom-Feature trailer)'; fi
}

rebase_in_progress() { [ -d "$GIT_DIR/rebase-merge" ] || [ -d "$GIT_DIR/rebase-apply" ]; }

finish() {
  local code=$1
  cp "$REPORT" "$STATE_DIR/last-report.md"
  echo
  echo "Отчёт: $REPORT"
  exit "$code"
}

fail() {
  local code=$1
  shift
  say ""
  say "## ОШИБКА"
  say "$*"
  finish "$code"
}

save_state() {
  cat >"$STATE_FILE" <<EOF
ORIG_BRANCH='$ORIG_BRANCH'
OLD_CUSTOM='$OLD_CUSTOM'
OLD_BASE='$OLD_BASE'
OLD_UPSTREAM='$OLD_UPSTREAM'
NEW_UPSTREAM='$NEW_UPSTREAM'
BACKUP_REF='$BACKUP_REF'
EOF
}

restore_orig_branch() {
  local cur
  cur=$(git symbolic-ref --quiet --short HEAD || true)
  if [ -n "$ORIG_BRANCH" ] && [ "$ORIG_BRANCH" != "$cur" ]; then
    git checkout -q "$ORIG_BRANCH"
  fi
}

rollback_hint() {
  say "Откат к состоянию до синхронизации:"
  say "    git rebase --abort 2>/dev/null; git checkout $CUSTOM && git reset --hard $(short "$OLD_CUSTOM")"
  say "    (бэкап также в $BACKUP_REF)"
}

# --- conflict handling -------------------------------------------------------------------------

conflict_stop() {
  local files=$1 stopped subject feature file
  stopped=$(git rev-parse --verify -q REBASE_HEAD || true)
  say ""
  say "## КОНФЛИКТ — нужна ручная правка"
  if [ -n "$stopped" ]; then
    subject=$(git log -1 --format=%s "$stopped")
    feature=$(feature_of "$stopped")
    say "Фича:   $feature"
    say "Коммит: $(short "$stopped") $subject"
  fi
  say "Файлы с конфликтом и изменения upstream, которые их задели:"
  for file in $files; do
    say "  - $file"
    # Why -n, not `| head`: under pipefail, head closing early kills git log with SIGPIPE and
    # set -e exits before the --unattended abort below, leaving the rebase half-done.
    git log -n 5 --no-merges --format='        upstream %h %s' "$OLD_BASE..$NEW_UPSTREAM" -- "$file" \
      | tee -a "$REPORT"
  done
  if [ "$UNATTENDED" = 1 ]; then
    git rebase --abort >>"$GIT_LOG" 2>&1 || true
    restore_orig_branch
    rm -f "$STATE_FILE"
    say ""
    say "Режим --unattended: rebase отменён, $CUSTOM остался на $(short "$OLD_CUSTOM")."
    say "Запусти скрипт вручную, чтобы разрешить конфликт (rerere запомнит решение)."
  else
    say ""
    say "Что делать:"
    say "  1. поправь файлы выше, затем: git add <файлы>"
    say "  2. scripts/sync-upstream.sh --continue"
    say "rerere запомнит решение — в следующий раз этот конфликт решится сам."
    rollback_hint
  fi
  finish 1
}

# Runs one rebase command, keeping its output: rerere reports replayed resolutions only there
# ("Staged 'x' using previous resolution."), and `git rerere status` is empty once it has staged them.
rebase_step() {
  GIT_EDITOR=true git "$@" >"$STEP_OUT" 2>&1 || true
  cat "$STEP_OUT" >>"$GIT_LOG"
}

drive_rebase() {
  local unresolved markers replayed
  while rebase_in_progress; do
    unresolved=$(git diff --name-only --diff-filter=U)
    if [ -n "$unresolved" ]; then
      conflict_stop "$unresolved"
    fi
    # rerere.autoupdate stages replayed resolutions; refuse to commit anything that still has markers.
    markers=$(git diff --cached --name-only -G'^(<<<<<<<|>>>>>>>)( |$)' || true)
    if [ -n "$markers" ]; then
      conflict_stop "$markers"
    fi
    if [ "$MANUAL_PENDING" = 1 ]; then
      say "  ручное решение принято, rerere его запомнит (фича: $(feature_of REBASE_HEAD))"
      MANUAL_PENDING=0
    else
      replayed=$(sed -nE "s/^(Staged|Resolved) '(.*)' using previous resolution.*/\2/p" "$STEP_OUT" | tr '\n' ' ')
      if [ -n "$replayed" ]; then
        say "  rerere применил сохранённое решение: $replayed(фича: $(feature_of REBASE_HEAD))"
      fi
    fi
    rebase_step rebase --continue
  done
  if ! git merge-base --is-ancestor "$NEW_UPSTREAM" HEAD; then
    fail 3 "rebase не завершился (см. $GIT_LOG)"
  fi
}

# --- checks ------------------------------------------------------------------------------------

ensure_toolchain() {
  local want have
  want=$(sed -n '/"engines"/,/}/s/.*"node": *"\([0-9][0-9]*\).*/\1/p' package.json | head -1)
  have=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)
  if [ -n "$want" ] && [ "$have" != "$want" ]; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null && nvm use "$want" >/dev/null 2>&1 \
      || fail 3 "нужен Node $want (сейчас $have), а nvm не нашёл его: nvm install $want"
  fi
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
}

pnpm_() { corepack pnpm "$@"; }

# Steps print "NOTE: ..." for what the report must show even on success (e.g. accepted test failures).
notes() { sed -n 's/^NOTE: /    /p' "$1" | tee -a "$REPORT"; }

run_step() {
  local name=$1 log start secs
  shift
  log="$STATE_DIR/logs/$TS-$name.log"
  start=$(date +%s)
  if "$@" >"$log" 2>&1; then
    secs=$(($(date +%s) - start))
    say "  ✓ $name (${secs}s)"
    notes "$log"
    return 0
  fi
  secs=$(($(date +%s) - start))
  say "  ✗ $name (${secs}s) — лог: $log"
  notes "$log"
  tail -30 "$log" | sed 's/^/      /' | tee -a "$REPORT"
  return 1
}

tests_step() { bash "$ROOT/scripts/sync-upstream-tests.sh" "$STATE_DIR/logs/$TS" "$@"; }

run_checks() {
  say ""
  say "## Проверки"
  if [ -n "${SYNC_CHECKS_CMD:-}" ]; then
    run_step checks bash -c "$SYNC_CHECKS_CMD"
    return
  fi
  ensure_toolchain
  if [ ! -d node_modules ] || ! git diff --quiet "$OLD_CUSTOM" HEAD -- package.json pnpm-lock.yaml pnpm-workspace.yaml; then
    run_step install pnpm_ install --frozen-lockfile || return 1
  else
    say "  · install пропущен (lockfile не менялся)"
  fi
  run_step typecheck pnpm_ tc || return 1
  run_step build pnpm_ build:electron-vite || return 1
  if [ "$FULL_TESTS" = 1 ]; then
    run_step tests-full tests_step full || return 1
  else
    run_step tests-related tests_step related "$MIRROR" || return 1
  fi
}

# Why no force: the fork's mirror only ever follows upstream; if it diverged, a human decides.
publish_mirror() {
  [ -n "$PUBLISH_MIRROR" ] || return 0
  local mirror_head
  mirror_head=$(git rev-parse "refs/heads/$MIRROR")
  [ "$(git rev-parse -q --verify "refs/remotes/$PUBLISH_REMOTE/$PUBLISH_MIRROR" || true)" = "$mirror_head" ] && return 0
  if git push --quiet "$PUBLISH_REMOTE" "$mirror_head:refs/heads/$PUBLISH_MIRROR" >>"$GIT_LOG" 2>&1; then
    say "## Зеркало: $MIRROR → $PUBLISH_REMOTE/$PUBLISH_MIRROR ($(short "$mirror_head"))"
  else
    say "## ВНИМАНИЕ: $PUBLISH_REMOTE/$PUBLISH_MIRROR не fast-forward до $MIRROR — зеркало не обновлено (лог: $GIT_LOG)"
  fi
}

# Why no fetch before the push: the lease compares against what we last saw of the fork, so a
# commit someone else pushed there makes the push fail instead of being overwritten.
publish() {
  [ "$PUBLISH" = 1 ] || return 0
  local target="refs/heads/$PUBLISH_BRANCH"
  local head
  head=$(git rev-parse "refs/heads/$CUSTOM")
  say ""
  if [ "$SKIP_CHECKS" = 1 ]; then
    say "## Не опубликовано: с --skip-checks стек не проверен"
    return 0
  fi
  publish_mirror
  if [ "$(git rev-parse -q --verify "refs/remotes/$PUBLISH_REMOTE/$PUBLISH_BRANCH" || true)" = "$head" ]; then
    say "## Публикация не нужна: $PUBLISH_REMOTE/$PUBLISH_BRANCH уже $(short "$head")"
    return 0
  fi
  if git push --quiet --force-with-lease="$target" "$PUBLISH_REMOTE" "$head:$target" >>"$GIT_LOG" 2>&1; then
    say "## Опубликовано: $CUSTOM → $PUBLISH_REMOTE/$PUBLISH_BRANCH ($(short "$head"))"
  else
    say "## ПУБЛИКАЦИЯ НЕ УДАЛАСЬ — $PUBLISH_REMOTE/$PUBLISH_BRANCH изменился с прошлого push или недоступен"
    say "Стек пересобран и проверен локально. Разберись: git fetch $PUBLISH_REMOTE && git log $CUSTOM..$PUBLISH_REMOTE/$PUBLISH_BRANCH (лог: $GIT_LOG)"
    finish 4
  fi
}

# --- main --------------------------------------------------------------------------------------

say "# sync-upstream $TS"

if [ "$MODE" = start ]; then
  if rebase_in_progress; then
    fail 3 "rebase уже идёт. Закончи его (scripts/sync-upstream.sh --continue) или отмени (git rebase --abort)."
  fi
  if ! git diff --quiet || ! git diff --cached --quiet; then
    fail 3 "в рабочем дереве есть незакоммиченные изменения — закоммить или спрячь их (git stash)."
  fi
  git rev-parse --verify -q "refs/heads/$CUSTOM" >/dev/null || fail 3 "нет ветки $CUSTOM"

  ORIG_BRANCH=$(git symbolic-ref --quiet --short HEAD || true)
  OLD_CUSTOM=$(git rev-parse "refs/heads/$CUSTOM")
  OLD_UPSTREAM=$(git rev-parse --verify -q "$UPSTREAM_REF" || true)

  git fetch --no-tags --quiet "$REMOTE" "+refs/heads/$REMOTE_BRANCH:$UPSTREAM_REF" >>"$GIT_LOG" 2>&1 \
    || fail 3 "git fetch $REMOTE не удался (см. $GIT_LOG)"
  NEW_UPSTREAM=$(git rev-parse "$UPSTREAM_REF")

  # `main` is a pure mirror: refuse to overwrite local commits someone made on it by mistake.
  if git rev-parse --verify -q "refs/heads/$MIRROR" >/dev/null; then
    if ! git merge-base --is-ancestor "refs/heads/$MIRROR" "$NEW_UPSTREAM"; then
      say "В $MIRROR есть коммиты, которых нет в upstream:"
      git log --format='  %h %s' "$NEW_UPSTREAM..refs/heads/$MIRROR" | tee -a "$REPORT"
      fail 3 "$MIRROR должен быть чистым зеркалом upstream. Перенеси эти коммиты в $CUSTOM."
    fi
    if [ "$ORIG_BRANCH" = "$MIRROR" ]; then
      git merge --ff-only -q "$NEW_UPSTREAM" >>"$GIT_LOG" 2>&1
    else
      git update-ref "refs/heads/$MIRROR" "$NEW_UPSTREAM"
    fi
  else
    git branch -q "$MIRROR" "$NEW_UPSTREAM"
  fi

  OLD_BASE=$(git merge-base "$OLD_CUSTOM" "$NEW_UPSTREAM")
  BACKUP_REF="refs/custom-sync/backup/$TS"
  NEW_COUNT=$(git rev-list --count "$OLD_BASE..$NEW_UPSTREAM")
  say "upstream: $REMOTE/$REMOTE_BRANCH $(short "$OLD_BASE") → $(short "$NEW_UPSTREAM") (новых коммитов: $NEW_COUNT)"

  if [ "$NEW_COUNT" = 0 ]; then
    rm -f "$STATE_FILE"
    say ""
    say "## OK — $CUSTOM уже стоит на свежем upstream, делать нечего"
    publish
    finish 0
  fi

  git update-ref "$BACKUP_REF" "$OLD_CUSTOM"
  # Keep the 10 newest backups.
  git for-each-ref --sort=-refname --format='%(refname)' refs/custom-sync/backup | tail -n +11 \
    | while read -r ref; do git update-ref -d "$ref"; done
  save_state

  say ""
  say "## Rebase $CUSTOM → $MIRROR"
  git checkout -q "$CUSTOM"
  rebase_step rebase "$MIRROR"
  drive_rebase
else
  [ -f "$STATE_FILE" ] || fail 3 "нечего продолжать: нет сохранённого состояния в $STATE_FILE"
  # shellcheck disable=SC1090
  . "$STATE_FILE"
  say "Продолжение синхронизации (upstream $(short "$NEW_UPSTREAM"))"
  say ""
  say "## Rebase $CUSTOM → $MIRROR (продолжение)"
  if rebase_in_progress; then MANUAL_PENDING=1; fi
  drive_rebase
fi

say "  ✓ rebase завершён"

if [ "$SKIP_CHECKS" = 1 ]; then
  say ""
  say "## Проверки пропущены (--skip-checks)"
elif ! run_checks; then
  if [ "$UNATTENDED" = 1 ]; then
    git checkout -q "$CUSTOM"
    git reset -q --hard "$OLD_CUSTOM"
    restore_orig_branch
    rm -f "$STATE_FILE"
    fail 2 "Проверки упали после rebase. Режим --unattended: $CUSTOM откатан на $(short "$OLD_CUSTOM")."
  fi
  rm -f "$STATE_FILE"
  say ""
  say "## ПРОВЕРКИ УПАЛИ — rebase сделан, но сборка/тесты не прошли"
  rollback_hint
  finish 2
fi

rm -f "$STATE_FILE"
restore_orig_branch

say ""
say "## OK — $CUSTOM пересобран на upstream $(short "$NEW_UPSTREAM")"
say "Стек фич (снизу вверх):"
git log --reverse --format='%H' "refs/heads/$MIRROR..refs/heads/$CUSTOM" | while read -r sha; do
  say "  $(short "$sha") [$(feature_of "$sha")] $(git log -1 --format=%s "$sha")"
done
DROPPED=$(
  git log --format=%s "$OLD_BASE..$OLD_CUSTOM" | while read -r subj; do
    git log --format=%s "refs/heads/$MIRROR..refs/heads/$CUSTOM" | grep -qxF "$subj" || echo "$subj"
  done
)
if [ -n "$DROPPED" ]; then
  say "Выпали из стека (изменения уже есть в upstream — вероятно, наш PR влит):"
  printf '%s\n' "$DROPPED" | sed 's/^/  - /' | tee -a "$REPORT"
fi
say "Бэкап прежнего $CUSTOM: $BACKUP_REF ($(short "$OLD_CUSTOM"))"
publish
finish 0
