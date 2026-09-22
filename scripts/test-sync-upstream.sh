#!/usr/bin/env bash
# Self-test for scripts/sync-upstream.sh against a throwaway fake upstream (no network, no pnpm).
#
#   T1 clean upstream change           → exit 0, custom rebased on the new upstream
#   T2 conflicting upstream change     → exit 1, report names the file and the feature, rebase paused
#   T3 manual resolve + --continue     → exit 0, resolution recorded by rerere
#   T4 same conflict again (replay)    → exit 0 without a human, rerere reapplies the resolution
#   T5 new conflict in --unattended    → exit 1, rebase aborted, custom untouched
#   T6 failing checks in --unattended  → exit 2, custom rolled back
#   T7 local commit on the main mirror → exit 3
#   T8–T11 sync-upstream-tests.sh triage with a fake vitest: flaky passes on retry, only known
#          failures pass, a new failure fails, a crash without a failed file fails
#   T12–T16 sync-upstream-scheduled.sh skips on a dirty tree, another branch, a held lock, a
#          running dev build and a sync in progress, and otherwise runs the sync and returns its code
#   T17 --publish after a verified sync  → exit 0, fork's custom equals custom, its main mirrors upstream
#   T18 --publish when that remote moved → exit 4, the foreign commit survives, custom intact
set -euo pipefail

SYNC="$(cd "$(dirname "$0")" && pwd)/sync-upstream.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/sync-upstream-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
check() {
  if eval "$2"; then
    PASS=$((PASS + 1)); echo "  ok   $1"
  else
    FAIL=$((FAIL + 1)); echo "  FAIL $1"; printf '%s\n' "${OUT:-}" | tail -8 | sed 's/^/       | /'
  fi
}

g() { git -c user.name=test -c user.email=test@example.com -c commit.gpgsign=false "$@"; }

# Runs the sync script in the fork; stores its exit code in RC and its output in OUT.
sync_run() {
  set +e
  OUT=$(cd "$WORK/fork" && "$SYNC" "$@" 2>&1)
  RC=$?
  set -e
}

upstream_commit() { # file content message
  (cd "$WORK/up-work" && printf '%s\n' "$2" >"$1" && g add "$1" && g commit -qm "$3" && g push -q origin main)
}

# --- fixture: fake upstream + fork with one feature commit --------------------------------------
g init -q --bare -b main "$WORK/upstream.git"
g clone -q "$WORK/upstream.git" "$WORK/up-work" 2>/dev/null
(cd "$WORK/up-work" && printf 'line1\nline2\nline3\n' >app.txt && printf 'x\n' >other.txt \
  && g add . && g commit -qm "upstream: initial" && g push -q origin main)

g clone -q -o upstream "$WORK/upstream.git" "$WORK/fork"
cd "$WORK/fork"
git config rerere.enabled true
git config rerere.autoupdate true
git config user.name test
git config user.email test@example.com
git checkout -q -b custom
printf 'line1\nline2 FEATURE\nline3\n' >app.txt
g commit -qam "custom(demo): tweak line2" -m "Custom-Feature: demo-feature"
git checkout -q main
cd - >/dev/null

echo "T1 clean upstream change"
upstream_commit other.txt "y" "upstream: touch other"
sync_run --skip-checks
check "exit 0" '[ "$RC" = 0 ]'
check "custom contains new upstream" '(cd "$WORK/fork" && git merge-base --is-ancestor upstream/main custom)'
check "main mirrors upstream" '[ "$(cd "$WORK/fork" && git rev-parse main)" = "$(cd "$WORK/fork" && git rev-parse upstream/main)" ]'
check "feature listed in report" 'printf "%s" "$OUT" | grep -q "\[demo-feature\] custom(demo): tweak line2"'
check "returned to original branch" '[ "$(cd "$WORK/fork" && git branch --show-current)" = main ]'

echo "T2 conflicting upstream change"
PRE_T2_CUSTOM=$(cd "$WORK/fork" && git rev-parse custom)
PRE_T2_UPSTREAM=$(cd "$WORK/fork" && git rev-parse upstream/main)
upstream_commit app.txt $'line1\nline2 UPSTREAM\nline3' "upstream: rewrite line2"
sync_run --skip-checks
check "exit 1" '[ "$RC" = 1 ]'
check "report names the file" 'printf "%s" "$OUT" | grep -q -- "- app.txt"'
check "report names the feature" 'printf "%s" "$OUT" | grep -q "Фича:   demo-feature"'
check "report names the upstream commit" 'printf "%s" "$OUT" | grep -q "upstream: rewrite line2"'
check "rebase left in progress" '[ -d "$WORK/fork/.git/rebase-merge" ]'

echo "T3 manual resolve + --continue"
(cd "$WORK/fork" && printf 'line1\nline2 UPSTREAM+FEATURE\nline3\n' >app.txt && git add app.txt)
sync_run --continue --skip-checks
check "exit 0" '[ "$RC" = 0 ]'
check "resolution committed" '(cd "$WORK/fork" && git show custom:app.txt | grep -qx "line2 UPSTREAM+FEATURE")'
check "rerere cache has an entry" '[ -n "$(ls "$WORK/fork/.git/rr-cache" 2>/dev/null)" ]'

echo "T4 same conflict again → rerere replays it"
(cd "$WORK/fork" && git update-ref refs/heads/custom "$PRE_T2_CUSTOM" \
  && git checkout -q main && git reset -q --hard "$PRE_T2_UPSTREAM")
sync_run --skip-checks
check "exit 0 without a human" '[ "$RC" = 0 ]'
check "report says rerere replayed" 'printf "%s" "$OUT" | grep -q "rerere применил сохранённое решение: app.txt"'
check "same resolution as by hand" '(cd "$WORK/fork" && git show custom:app.txt | grep -qx "line2 UPSTREAM+FEATURE")'

echo "T5 new conflict in --unattended"
BEFORE=$(cd "$WORK/fork" && git rev-parse custom)
upstream_commit app.txt $'line1\nline2 UPSTREAM v2\nline3' "upstream: rewrite line2 again"
sync_run --skip-checks --unattended
check "exit 1" '[ "$RC" = 1 ]'
check "no rebase left behind" '[ ! -d "$WORK/fork/.git/rebase-merge" ]'
check "custom untouched" '[ "$(cd "$WORK/fork" && git rev-parse custom)" = "$BEFORE" ]'
check "back on original branch" '[ "$(cd "$WORK/fork" && git branch --show-current)" = main ]'

echo "T6 failing checks in --unattended → rollback"
# Re-base the feature on upstream by hand so only the checks can fail.
(cd "$WORK/fork" && git checkout -q custom && git reset -q --hard upstream/main \
  && printf 'line1\nline2 UPSTREAM v2 FEATURE\nline3\n' >app.txt \
  && g commit -qam "custom(demo): tweak line2" -m "Custom-Feature: demo-feature" && git checkout -q main)
upstream_commit other.txt "z" "upstream: touch other again"
BEFORE=$(cd "$WORK/fork" && git rev-parse custom)
SYNC_CHECKS_CMD='echo boom >&2; exit 1' sync_run --unattended
check "exit 2" '[ "$RC" = 2 ]'
check "failing output in report" 'printf "%s" "$OUT" | grep -q "boom"'
check "custom rolled back" '[ "$(cd "$WORK/fork" && git rev-parse custom)" = "$BEFORE" ]'

echo "T7 local commit on the main mirror"
(cd "$WORK/fork" && printf 'oops\n' >oops.txt && git add oops.txt && g commit -qm "oops on main")
upstream_commit other.txt "w" "upstream: yet another"
sync_run --skip-checks
check "exit 3" '[ "$RC" = 3 ]'
check "report lists the stray commit" 'printf "%s" "$OUT" | grep -q "oops on main"'

echo "T8–T11 test triage (fake vitest)"
TESTS="$(cd "$(dirname "$SYNC")" && pwd)/sync-upstream-tests.sh"
REPO_ROOT=$(cd "$(dirname "$SYNC")" && git rev-parse --show-toplevel)
KNOWN_FILE=src/main/ipc/pty-runtime-hidden-at-spawn-mark.test.ts
# Fake vitest: FAKE_FIRST / FAKE_RETRY are the files failing on the first run / on the retry.
cat >"$WORK/fake-vitest.sh" <<'FAKE'
#!/usr/bin/env bash
out=""; retry=0
for a in "$@"; do
  case "$a" in
    --outputFile.json=*) out=${a#--outputFile.json=} ;;
    src/*) retry=1 ;;
  esac
done
failing=$FAKE_FIRST
[ "$retry" = 1 ] && failing=$FAKE_RETRY
[ "${FAKE_NO_REPORT:-0}" = 1 ] && exit 1
{
  printf '{"testResults":['
  sep=""
  for f in $FAKE_ALL; do
    st=passed
    for x in $failing; do [ "$x" = "$f" ] && st=failed; done
    printf '%s{"name":"%s/%s","status":"%s"}' "$sep" "$REPO_ROOT" "$f" "$st"; sep=","
  done
  printf ']}'
} >"$out"
[ -z "$failing" ]
FAKE
triage_run() {
  set +e
  OUT=$(cd "$REPO_ROOT" && REPO_ROOT="$REPO_ROOT" SYNC_VITEST_CMD="bash $WORK/fake-vitest.sh" \
    bash "$TESTS" "$WORK/triage" full 2>&1)
  RC=$?
  set -e
}
export FAKE_ALL="src/a.test.ts src/b.test.ts $KNOWN_FILE"

FAKE_FIRST="src/a.test.ts" FAKE_RETRY="" triage_run
check "T8 flaky passes on retry" '[ "$RC" = 0 ] && printf "%s" "$OUT" | grep -q "NOTE: flaky, passed on retry: src/a.test.ts"'

FAKE_FIRST="src/a.test.ts $KNOWN_FILE" FAKE_RETRY="$KNOWN_FILE" triage_run
check "T9 only known failures pass" '[ "$RC" = 0 ] && printf "%s" "$OUT" | grep -q "NOTE: only known failures remain: $KNOWN_FILE"'

FAKE_FIRST="src/b.test.ts $KNOWN_FILE" FAKE_RETRY="src/b.test.ts $KNOWN_FILE" triage_run
check "T10 new failure fails" '[ "$RC" = 1 ] && printf "%s" "$OUT" | grep -q "NOTE: new failures (not in sync-known-test-failures.txt): src/b.test.ts"'

FAKE_NO_REPORT=1 FAKE_FIRST="" FAKE_RETRY="" triage_run
check "T11 crash without a report fails" '[ "$RC" = 1 ]'

echo "T12–T16 scheduled wrapper (stub sync)"
SCHED="$(cd "$(dirname "$SYNC")" && pwd)/sync-upstream-scheduled.sh"
S="$WORK/sched"
g init -q -b custom "$S"
S=$(cd "$S" && pwd) # Why: TMPDIR may end in "/"; the wrapper matches the dev process by its pwd path
mkdir -p "$S/scripts"
cp "$SCHED" "$S/scripts/"
printf '#!/usr/bin/env bash\necho "stub sync $*"; mkdir -p .git/custom-sync; echo "## OK — stub" >.git/custom-sync/last-report.md; exit ${STUB_CODE:-0}\n' \
  >"$S/scripts/sync-upstream.sh"
chmod +x "$S/scripts/"*.sh
(cd "$S" && printf 'a\n' >f.txt && g add . && g commit -qm init)
sched_run() {
  set +e
  OUT=$(cd "$S" && SYNC_NO_NOTIFY=1 bash scripts/sync-upstream-scheduled.sh 2>&1)
  RC=$?
  set -e
}

(cd "$S" && printf 'b\n' >f.txt)
sched_run
check "T12 dirty tree → skip, sync not run" '[ "$RC" = 0 ] && printf "%s" "$OUT" | grep -q "skip: uncommitted" && ! printf "%s" "$OUT" | grep -q "stub sync"'
(cd "$S" && git checkout -q f.txt && git checkout -q -b topic)
sched_run
check "T13 other branch → skip" '[ "$RC" = 0 ] && printf "%s" "$OUT" | grep -q "skip: checked out on .topic."'
(cd "$S" && git checkout -q custom && mkdir .git/custom-sync/scheduled.lock)
sched_run
check "T14 held lock → skip" '[ "$RC" = 0 ] && printf "%s" "$OUT" | grep -q "skip: another scheduled sync"'
rmdir "$S/.git/custom-sync/scheduled.lock"
FAKE_APP="$S/out/electron-dev/abc/Orca Custom.app/Contents"
mkdir -p "$FAKE_APP/MacOS" "$FAKE_APP/Frameworks"
printf 'sleep 30\n' >"$FAKE_APP/MacOS/Electron"
printf 'sleep 30\n' >"$FAKE_APP/Frameworks/chrome_crashpad_handler"
bash "$FAKE_APP/Frameworks/chrome_crashpad_handler" &
FAKE_HELPER=$!
sleep 0.3
sched_run
check "T15a orphaned dev helper alone → no skip" '! printf "%s" "$OUT" | grep -q "skip: a dev build"'
bash "$FAKE_APP/MacOS/Electron" . &
FAKE_DEV=$!
sleep 0.3
sched_run
kill "$FAKE_DEV" "$FAKE_HELPER" 2>/dev/null || true
wait "$FAKE_DEV" "$FAKE_HELPER" 2>/dev/null || true
check "T15 running dev build → skip" '[ "$RC" = 0 ] && printf "%s" "$OUT" | grep -q "skip: a dev build"'
rm -rf "$S/out"
touch "$S/.git/custom-sync/state"
sched_run
check "T15b sync in progress (state file) → skip" '[ "$RC" = 0 ] && printf "%s" "$OUT" | grep -q "skip: a sync is already in progress"'
rm -f "$S/.git/custom-sync/state"
set +e
OUT=$(cd "$S" && SYNC_NO_NOTIFY=1 STUB_CODE=2 bash scripts/sync-upstream-scheduled.sh 2>&1)
RC=$?
set -e
check "T16 clean → runs --unattended, returns its code" '[ "$RC" = 2 ] && printf "%s" "$OUT" | grep -q "stub sync --unattended"'
check "T16 scheduled run publishes" 'printf "%s" "$OUT" | grep -q "stub sync --unattended --publish"'
check "T16 lock released" '[ ! -d "$S/.git/custom-sync/scheduled.lock" ]'

echo "T17 --publish after a verified sync"
g init -q --bare -b main "$WORK/published.git"
(cd "$WORK/fork" && git remote add origin "$WORK/published.git" && git checkout -q main && git reset -q --hard upstream/main)
upstream_commit other.txt "publish-1" "upstream: before first publish"
SYNC_CHECKS_CMD=true sync_run --publish
check "T17 exit 0" '[ "$RC" = 0 ]'
check "T17 remote custom equals custom" '[ "$(git --git-dir="$WORK/published.git" rev-parse custom)" = "$(cd "$WORK/fork" && git rev-parse custom)" ]'
check "T17 remote main mirrors upstream" '[ "$(git --git-dir="$WORK/published.git" rev-parse main)" = "$(cd "$WORK/fork" && git rev-parse upstream/main)" ]'
check "T17 report says published" 'printf "%s" "$OUT" | grep -q "Опубликовано"'

echo "T18 --publish when the remote moved"
g clone -q "$WORK/published.git" "$WORK/pub-other"
(cd "$WORK/pub-other" && git checkout -q custom && printf 'foreign\n' >foreign.txt && g add foreign.txt && g commit -qm "someone else" && g push -q origin custom)
FOREIGN=$(git --git-dir="$WORK/published.git" rev-parse custom)
PRE_T18_CUSTOM=$(cd "$WORK/fork" && git rev-parse custom)
upstream_commit other.txt "publish-2" "upstream: before second publish"
SYNC_CHECKS_CMD=true sync_run --publish
check "T18 exit 4" '[ "$RC" = 4 ]'
check "T18 foreign commit kept" '[ "$(git --git-dir="$WORK/published.git" rev-parse custom)" = "$FOREIGN" ]'
check "T18 mirror still follows upstream" '[ "$(git --git-dir="$WORK/published.git" rev-parse main)" = "$(cd "$WORK/fork" && git rev-parse upstream/main)" ]'
check "T18 custom rebased, not rolled back" '[ "$(cd "$WORK/fork" && git rev-parse custom)" != "$PRE_T18_CUSTOM" ] && (cd "$WORK/fork" && git merge-base --is-ancestor upstream/main custom)'

echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ]
