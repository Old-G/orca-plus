#!/usr/bin/env bash
# Sync our feature stack (`custom`) onto the latest upstream Orca.
#
#   fetch upstream → fast-forward the `main` mirror → rebase `custom` onto it
#   → guard: nothing of ours went missing → install / typecheck / build / tests → report
#   → (--publish) push `custom` to our fork
#   → (--ci-verify) instead of local checks: push the stack to sync/<ts> on the fork and let the
#     `Sync verify` workflow check it there and promote it to `custom` when green
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
  --ci-verify     no local install / typecheck / build / tests: push the rebased stack to
                  sync/<timestamp> on the fork and dispatch the `Sync verify` workflow, which runs
                  them on GitHub and promotes the stack to custom when green (default path:
                  the full suite froze the owner's laptop; local checks only when asked)
  -h, --help      this help

Env overrides: SYNC_REMOTE (upstream), SYNC_REMOTE_BRANCH (main), SYNC_MIRROR (main),
               SYNC_CUSTOM (custom), SYNC_CHECKS_CMD (replace all checks with one shell command),
               SYNC_GUARD_ACCEPT (a file explaining every line the guard reports, plus one
               `guard-accept <fingerprint>` line per guard report it accepts),
               SYNC_PUBLISH_REMOTE (origin), SYNC_PUBLISH_BRANCH (custom),
               SYNC_PUBLISH_MIRROR (main; empty = don't push the mirror),
               SYNC_CI_WORKFLOW (sync-verify.yml), SYNC_CI_PROMOTE (1; 0 = check only, no promotion)

Exit codes: 0 ok · 1 conflict needs a human · 2 checks failed · 3 precondition / git failure
            4 synced and verified, but the push to the fork was refused
            5 the guard found our changes missing after the rebase (not published)
            6 the stack is on GitHub, but whether a Sync verify run started is unknown
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
CI_WORKFLOW=${SYNC_CI_WORKFLOW:-sync-verify.yml}
CI_PROMOTE=${SYNC_CI_PROMOTE:-1}

MODE=start
MANUAL_PENDING=0
PUBLISH_BLOCKED=0
UNATTENDED=0
FULL_TESTS=0
SKIP_CHECKS=0
PUBLISH=0
CI_VERIFY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --continue) MODE=continue ;;
    --unattended) UNATTENDED=1 ;;
    --full-tests) FULL_TESTS=1 ;;
    --skip-checks) SKIP_CHECKS=1 ;;
    --publish) PUBLISH=1 ;;
    --ci-verify) CI_VERIFY=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "sync-upstream: unknown option: $1" >&2; usage >&2; exit 3 ;;
  esac
  shift
done

if [ "$CI_VERIFY" = 1 ] && { [ "$PUBLISH" = 1 ] || [ "$SKIP_CHECKS" = 1 ]; }; then
  echo "sync-upstream: --ci-verify replaces --publish and the local checks; drop the other flag" >&2
  exit 3
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/sync-upstream-rollback.sh
. "$SCRIPT_DIR/sync-upstream-rollback.sh"
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
GIT_DIR=$(git rev-parse --absolute-git-dir)
STATE_DIR="$GIT_DIR/custom-sync"
STATE_FILE="$STATE_DIR/state"
# Present while a rebased stack has unexplained guard findings; publishing waits for it to clear.
GUARD_BLOCK="$STATE_DIR/guard-blocked"
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
  ensure_pinned_bun
}

# Why: `pnpm test` runs vitest under the Bun pinned in config/.bun-version; an older global Bun fails
# at startup. The pinned one is installed once beside the sync state, never over the global one.
ensure_pinned_bun() {
  local want have dir
  [ -f config/.bun-version ] || return 0
  want=$(tr -d '[:space:]' <config/.bun-version)
  have=$(bun --version 2>/dev/null || echo none)
  [ "$have" = "$want" ] && return 0
  dir="$STATE_DIR/tools/bun-$want"
  if [ ! -x "$dir/node_modules/.bin/bun" ]; then
    mkdir -p "$dir"
    npm install --prefix "$dir" --no-save --silent "bun@$want" >>"$GIT_LOG" 2>&1 \
      || fail 3 "нужен Bun $want (сейчас $have), а npm не смог его поставить (см. $GIT_LOG)"
  fi
  export PATH="$dir/node_modules/.bin:$PATH"
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

# Compares the old stack with the rebased one: every line a feature added must still be there.
# Returns 1 when something is missing and no SYNC_GUARD_ACCEPT file explains it.
# Why the pending block: a guard report nobody accepted stays blocking until it is accepted, even
# when a later comparison is clean (its old side may already lack the lost feature).
run_guard() { # [new head, default HEAD]
  local log="$STATE_DIR/logs/$TS-guard.md" code=0 new_head=${1:-HEAD} pending=""
  [ -f "$GUARD_BLOCK" ] && pending=$(cat "$GUARD_BLOCK")
  say ""
  say "## Сверка: наши изменения после rebase"
  ensure_toolchain
  node "$SCRIPT_DIR/sync-upstream-guard.mjs" "$OLD_BASE" "$OLD_CUSTOM" "refs/heads/$MIRROR" "$new_head" \
    >"$log" 2>&1 || code=$?
  if [ "$code" = 0 ]; then
    say "  ✓ ничего нашего не пропало"
    # publish / ci_verify still ask guard_accepted for the pending reports.
    [ -n "$pending" ] || rm -f "$GUARD_BLOCK"
    return 0
  fi
  grep -E '^(### |- [0-9a-f]{10} |## (Explain|Commits))' "$log" | sed 's/^/  /' | tee -a "$REPORT"
  say "  полный список: $log"
  if [ "$code" = 1 ] && guard_accepted "$(printf '%s\n%s' "$log" "$pending")"; then
    return 0
  fi
  printf '%s\n%s\n' "$log" "$pending" | sed '/^$/d' | sort -u >"$GUARD_BLOCK"
  return 1
}

# The fingerprint sync-upstream-guard.mjs computed from its full findings; empty when the log is
# gone or holds no findings (a guard error), which nothing can accept.
guard_digest() { sed -n 's/^Fingerprint: \([0-9a-f][0-9a-f]*\)$/\1/p' "$1" 2>/dev/null | tail -1; }

# Why fingerprints: an explanation file left from an earlier run must not accept a loss nobody has
# looked at. Each guard log listed (one path per line) needs a `guard-accept <fingerprint>` line.
guard_accepted() { # guard logs
  local log digest missing=""
  while IFS= read -r log; do
    [ -n "$log" ] || continue
    digest=$(guard_digest "$log")
    if [ -z "$digest" ]; then
      say "  не принято: в $log нет отпечатка находок (сверка упала или лог из старой версии). Прочитай его, восстанови или объясни потери, затем убери эту строку из $GUARD_BLOCK"
      return 1
    fi
    # Why tr: a file saved with Windows line endings still counts.
    if [ -z "${SYNC_GUARD_ACCEPT:-}" ] \
      || ! tr -d '\r' <"$SYNC_GUARD_ACCEPT" 2>/dev/null | grep -Eq "^guard-accept $digest( |$)"; then
      missing="$missing $digest"
    fi
  done <<LOGS
$1
LOGS
  if [ -n "$missing" ]; then
    say "  не принято: объясни каждую находку в файле SYNC_GUARD_ACCEPT и добавь строки:"
    for digest in $missing; do say "    guard-accept $digest"; done
    return 1
  fi
  say "  принято с объяснением ($SYNC_GUARD_ACCEPT):"
  sed 's/^/    /' "$SYNC_GUARD_ACCEPT" | tee -a "$REPORT"
  rm -f "$GUARD_BLOCK"
}

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
  # Why: mobile/ is its own workspace; the desktop build bundles its web app from there.
  if [ -f mobile/pnpm-lock.yaml ] && { [ ! -d mobile/node_modules ] \
    || ! git diff --quiet "$OLD_CUSTOM" HEAD -- mobile/package.json mobile/pnpm-lock.yaml; }; then
    run_step install-mobile bash -c 'cd mobile && corepack pnpm install --frozen-lockfile' || return 1
  fi
  # Why: one project at a time at low priority; `pnpm tc` in parallel froze the laptop (04.11).
  run_step typecheck scripts/typecheck-once.sh || return 1
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
  if [ "$PUBLISH_BLOCKED" = 0 ] && [ -f "$GUARD_BLOCK" ]; then
    say "Сверка прошлой синхронизации не принята ($(cat "$GUARD_BLOCK"))."
    guard_accepted "$(cat "$GUARD_BLOCK")" || PUBLISH_BLOCKED=1
  fi
  if [ "$PUBLISH_BLOCKED" = 1 ]; then
    say "## Не опубликовано: сверка нашла пропавшие изменения — объясни их в файле и запусти с SYNC_GUARD_ACCEPT=<файл>"
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

publish_repo() { git remote get-url "$PUBLISH_REMOTE" | sed -e 's#^.*github\.com[:/]##' -e 's#\.git$##'; }

# Why: the workflow moves PUBLISH_BRANCH on GitHub, and nothing here fetches it afterwards, so the
# next lease would name the pre-promotion head and fail. Every promoting dispatch is recorded in
# ci-promotions (repo, branch, run, stack sent, lease); the tracking ref takes over a recorded stack
# only for the same repo and branch, from its own lease, and only while the fork's branch is exactly
# on it: any other move stays unseen, so the lease still refuses it.
reconcile_promoted_lease() {
  local tracking="refs/remotes/$PUBLISH_REMOTE/$PUBLISH_BRANCH" file="$STATE_DIR/ci-promotions"
  local repo seen remote_head candidates r_repo r_branch r_run r_head r_expect
  [ -s "$file" ] || return 0
  seen=$(git rev-parse -q --verify "$tracking" || true)
  [ -n "$seen" ] || return 0
  repo=$(publish_repo)
  # Why first: ask the fork only when a recorded dispatch could have moved it from the lease we hold.
  candidates=$(awk -v repo="$repo" -v branch="$PUBLISH_BRANCH" -v seen="$seen" \
    '$1 == repo && $2 == branch && $5 == seen' "$file")
  [ -n "$candidates" ] || return 0
  remote_head=$(git ls-remote "$PUBLISH_REMOTE" "refs/heads/$PUBLISH_BRANCH" 2>>"$GIT_LOG" | cut -f1 || true)
  [ -n "$remote_head" ] && [ "$remote_head" != "$seen" ] || return 0
  while read -r r_repo r_branch r_run r_head r_expect; do
    if [ "$r_repo" = "$repo" ] && [ "$r_branch" = "$PUBLISH_BRANCH" ] && [ "$r_head" = "$remote_head" ] \
      && [ "$r_expect" = "$seen" ]; then
      git update-ref "$tracking" "$remote_head" "$seen"
      say "$PUBLISH_REMOTE/$PUBLISH_BRANCH: прогон $r_run перевёл его на $(short "$remote_head") — lease обновлён"
      return 0
    fi
  done <<CANDIDATES
$candidates
CANDIDATES
}

record_promotion() { # repo run head expect
  local file="$STATE_DIR/ci-promotions"
  printf '%s %s %s %s %s\n' "$1" "$PUBLISH_BRANCH" "$2" "$3" "$4" >>"$file"
  # Keep the 20 newest.
  tail -n 20 "$file" >"$file.tmp" && mv "$file.tmp" "$file"
}

# Why: a stack resent with nothing new upstream (fixups after a red run) skips the rebase and its
# guard; it must still keep every line of the stack the fork publishes before it goes to promotion.
# Findings left from the sync's own guard stay blocked even when this comparison is clean: the
# published stack may never have had the feature that went missing.
guard_against_published() {
  local published keep_base=$OLD_BASE keep_custom=$OLD_CUSTOM
  published=$(git rev-parse -q --verify "refs/remotes/$PUBLISH_REMOTE/$PUBLISH_BRANCH" || true)
  [ -n "$published" ] && [ "$published" != "$(git rev-parse "refs/heads/$CUSTOM")" ] || return 0
  OLD_BASE=$(git merge-base "$published" "refs/heads/$MIRROR")
  OLD_CUSTOM=$published
  run_guard "refs/heads/$CUSTOM" || PUBLISH_BLOCKED=1
  OLD_BASE=$keep_base
  OLD_CUSTOM=$keep_custom
}

# Why: under --unattended a stack that never reached GitHub must not stay on local custom either; it
# goes back to the pre-sync head while custom still points at that stack.
ci_fail() { # message
  local why
  if [ "$UNATTENDED" = 1 ] && [ -n "${CI_SENT:-}" ] && [ "$CI_SENT" != "$OLD_CUSTOM" ]; then
    if why=$(rollback_branch "$CUSTOM" "$CI_SENT" "$OLD_CUSTOM"); then
      say "Режим --unattended: $CUSTOM откатан на $(short "$OLD_CUSTOM")."
    else
      say "Режим --unattended: $CUSTOM не откатан — $why."
    fi
  fi
  fail 3 "$1"
}

# Why not a rollback: once the stack is on GitHub, a lost or odd answer does not mean the dispatch
# was refused; a run may still promote it. The candidate stays, the promotion is recorded so the
# lease can follow it, and the sync stops with exit 6 until someone finds the run.
dispatch_unknown() { # repo, message
  if [ "$promote" = true ]; then
    record_promotion "$1" "?" "$head" "$expect"
  fi
  say ""
  say "## ИСХОД ЗАПУСКА НЕИЗВЕСТЕН — стек $(short "$head") в $branch, $CUSTOM не откатан"
  say "$2"
  say "Найди прогон: gh run list -R $1 --workflow $CI_WORKFLOW --branch $branch"
  finish 6
}

# The fork's Sync verify workflow checks the stack on GitHub and, when green, moves PUBLISH_BRANCH
# to it with a lease on the head we last saw there — the same lease `publish` uses.
ci_verify() {
  [ "$CI_VERIFY" = 1 ] || return 0
  local head expect branch repo promote run_id run_url
  # The scheduled wrapper waits on the run named here; no file means nothing was sent.
  rm -f "$STATE_DIR/ci-run"
  say ""
  if [ "$PUBLISH_BLOCKED" = 0 ] && [ -f "$GUARD_BLOCK" ]; then
    say "Сверка прошлой синхронизации не принята ($(cat "$GUARD_BLOCK"))."
    guard_accepted "$(cat "$GUARD_BLOCK")" || PUBLISH_BLOCKED=1
  fi
  if [ "$PUBLISH_BLOCKED" = 1 ]; then
    say "## Не отправлено на проверку: сверка нашла пропавшие изменения — объясни их в файле и запусти с SYNC_GUARD_ACCEPT=<файл>"
    return 0
  fi
  publish_mirror
  head=$(git rev-parse "refs/heads/$CUSTOM")
  expect=$(git rev-parse -q --verify "refs/remotes/$PUBLISH_REMOTE/$PUBLISH_BRANCH" || true)
  CI_SENT=$head
  [ -n "$expect" ] || ci_fail "нет $PUBLISH_REMOTE/$PUBLISH_BRANCH — нечего защищать lease'ом (git fetch $PUBLISH_REMOTE)"
  if [ "$expect" = "$head" ]; then
    say "## Проверка не нужна: $PUBLISH_REMOTE/$PUBLISH_BRANCH уже $(short "$head")"
    return 0
  fi
  branch="sync/$TS"
  repo=$(publish_repo)
  git push --quiet "$PUBLISH_REMOTE" "$head:refs/heads/$branch" >>"$GIT_LOG" 2>&1 \
    || ci_fail "push $branch в $PUBLISH_REMOTE не удался (лог: $GIT_LOG)"
  promote=true
  [ "$CI_PROMOTE" = 1 ] || promote=false
  # Why ref = the sync branch: the stack runs its own verifier, so a fix to the workflow travels with
  # the fixups it checks. GitHub still lists a workflow only from the default branch (custom here).
  # Why the API version: since 2026-03-10 the dispatch answers with the run it created, so the
  # wrapper watches exactly that run, never the newest one in a listing.
  run_id=$(gh api -X POST -H "X-GitHub-Api-Version: 2026-03-10" \
    "repos/$repo/actions/workflows/$CI_WORKFLOW/dispatches" -f ref="$branch" -f "inputs[branch]=$branch" \
    -f "inputs[expect_target]=$expect" -f "inputs[target]=$PUBLISH_BRANCH" -f "inputs[promote]=$promote" \
    --jq '.workflow_run_id' 2>>"$GIT_LOG") \
    || dispatch_unknown "$repo" "Запуск $CI_WORKFLOW не подтверждён (workflow должен лежать и в ветке по умолчанию; лог: $GIT_LOG)."
  case "$run_id" in
    '' | *[!0-9]*) dispatch_unknown "$repo" "GitHub не назвал прогон (ответ: '$run_id')." ;;
  esac
  run_url="https://github.com/$repo/actions/runs/$run_id"
  # repo, run, the stack sent, the lease, promotion on/off, the local head before this sync
  printf '%s %s %s %s %s %s\n' "$repo" "$run_id" "$head" "$expect" "$promote" "$OLD_CUSTOM" >"$STATE_DIR/ci-run"
  if [ "$promote" = true ]; then
    record_promotion "$repo" "$run_id" "$head" "$expect"
  fi
  say "## Отправлено на проверку в GitHub: $branch ($(short "$head"))"
  say "Прогон: $run_url"
  say "Ждать: gh run watch $run_id -R $repo --exit-status"
  if [ "$promote" = true ]; then
    say "После зелёного прогона workflow сам переведёт $PUBLISH_BRANCH $(short "$expect") → $(short "$head");"
    say "прежняя вершина останется веткой sync-backup/$TS. Красный прогон $PUBLISH_BRANCH не трогает."
  else
    say "Только проверка (SYNC_CI_PROMOTE=0): $PUBLISH_BRANCH не переводится."
  fi
}

# --- main --------------------------------------------------------------------------------------

say "# sync-upstream $TS"
if [ "$CI_VERIFY" = 1 ]; then
  reconcile_promoted_lease
fi

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
    if [ "$CI_VERIFY" = 1 ]; then
      guard_against_published
    fi
    publish
    ci_verify
    [ "$PUBLISH_BLOCKED" = 1 ] && finish 5
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

PRE_BLOCK=$(cat "$GUARD_BLOCK" 2>/dev/null || true)
if ! run_guard; then
  if [ "$UNATTENDED" = 1 ]; then
    # Why: the stack this report is about is thrown away below; only what blocked before stays.
    if [ -n "$PRE_BLOCK" ]; then printf '%s\n' "$PRE_BLOCK" >"$GUARD_BLOCK"; else rm -f "$GUARD_BLOCK"; fi
    git checkout -q "$CUSTOM"
    git reset -q --hard "$OLD_CUSTOM"
    restore_orig_branch
    rm -f "$STATE_FILE"
    fail 5 "После rebase пропали наши изменения (см. сверку выше). Режим --unattended: $CUSTOM откатан на $(short "$OLD_CUSTOM")."
  fi
  PUBLISH_BLOCKED=1
fi

if [ "$SKIP_CHECKS" = 1 ]; then
  say ""
  say "## Проверки пропущены (--skip-checks)"
elif [ "$CI_VERIFY" = 1 ]; then
  say ""
  say "## Проверки — на GitHub (--ci-verify), локально не гоняются"
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
    # Why not grep -q: it exits on the first match, git log dies of SIGPIPE and pipefail reports a miss.
    git log --format=%s "refs/heads/$MIRROR..refs/heads/$CUSTOM" | grep -xF "$subj" >/dev/null || echo "$subj"
  done
)
if [ -n "$DROPPED" ]; then
  say "Выпали из стека (изменения уже есть в upstream — вероятно, наш PR влит):"
  printf '%s\n' "$DROPPED" | sed 's/^/  - /' | tee -a "$REPORT"
fi
say "Бэкап прежнего $CUSTOM: $BACKUP_REF ($(short "$OLD_CUSTOM"))"
publish
ci_verify
if [ "$PUBLISH_BLOCKED" = 1 ]; then
  # Why: an earlier unaccepted report kept this rebased stack from being sent; unattended, it must
  # not stay on local custom either.
  if [ "$UNATTENDED" = 1 ] && [ "$(git rev-parse "refs/heads/$CUSTOM")" != "$OLD_CUSTOM" ]; then
    if why=$(rollback_branch "$CUSTOM" "$(git rev-parse "refs/heads/$CUSTOM")" "$OLD_CUSTOM"); then
      say "Режим --unattended: $CUSTOM откатан на $(short "$OLD_CUSTOM")."
    else
      say "Режим --unattended: $CUSTOM не откатан — $why."
    fi
  fi
  finish 5
fi
finish 0
