#!/usr/bin/env bash
# Ships a verified build into the installed Orca+ without losing the profile.
#
#   scripts/orca-plus-ship.sh --dry-run   print the steps, touch nothing
#   scripts/orca-plus-ship.sh             back up → build → stage → quit Orca+ → swap app → launch → verify
#   scripts/orca-plus-ship.sh --no-build  ship the existing dist/mac-*/Orca Plus.app
#
# Runs itself under nohup once it quits Orca+, so it survives being started from an Orca+
# terminal. Log: $TMPDIR/orca-plus-ship.log (previous run: .log.1). Backup: ~/orca-plus-backup-<date>-<time>
# (a ship keeps one older backup while it runs; a verified ship keeps only its own).
set -euo pipefail

dry=0
build=1
detached=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --no-build) build=0 ;;
    --detached) detached=1 ;;
    *) echo "orca-plus-ship: unknown option $arg" >&2; exit 2 ;;
  esac
done

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
app="/Applications/Orca Plus.app"
bundle_id=com.oldg.orca-plus
profile="$HOME/Library/Application Support/orca-plus"
backup="$HOME/orca-plus-backup-$(date +%Y%m%d-%H%M%S)"
log="${TMPDIR:-/tmp}/orca-plus-ship.log"
# Why: after the restart Orca+ tells the chat that ran this ship to check it (ship-restart-notice).
restart_marker="$profile/orca-plus-ship-restart.json"
# Why: these must survive a reinstall byte for byte; orca-devices.json changes legitimately (lastSeenAt).
state_files=(
  "$profile/orca-e2ee-keypair.json"
  "$profile/slack/credential.enc"
  "$profile/slack/credential.json"
  "$HOME/.orca/clickup-credential.enc"
)

step() { echo "[$(date +%T)] $*"; }
# Why: `open` hands this shell's env to Orca+; started from an agent chat that env names the chat's
# Claude subscription dir, and Orca+ then treated it as the base login and overwrote that sign-in.
# By path, not -b: LaunchServices picks the highest version, often the dist/ copy just built.
launch_orca_plus() {
  env $(env | sed -nE 's/^((ORCA|CLAUDE|ANTHROPIC)_[A-Z0-9_]*|CODEX_HOME)=.*/-u \1/p') \
    open "$app"
}
run() { if [ "$dry" = 1 ]; then echo "  would run: $*"; else "$@"; fi; }
# Why: anchored — the terminal daemon outlives the app by design and carries this path in its
# --spawner-exec-path argument, so a plain substring match waits on it forever. `-a`: pgrep skips
# its own ancestors, and Orca+ is one whenever the ship starts from an Orca+ session. Any copy
# counts: Orca+ is often running from dist/, and the quit reaches it by bundle id.
app_running() { pgrep -a -f "^($app|$repo/dist/mac[^/]*/Orca Plus\.app)/Contents/MacOS/Orca Plus( |\$)" >/dev/null; }
# Why: the CLI asks the running app — since upstream moved profiles to SQLite, orca-data.json is
# only a compatibility export refreshed on clean quit, so reading it would compare stale copies.
orca_plus_cli() { env -u ORCA_USER_DATA_PATH -u ORCA_PLUS_USER_DATA_PATH /usr/local/bin/orca-plus "$@"; }
repo_count() {
  orca_plus_cli repo list --json | python3 -c "import json,sys;print(len(json.load(sys.stdin)['result']['repos']))"
}
# Why: the selection survives a restart but the CLI login may not (plan 10.4); a mismatch means new
# chats run under another org and lose its connectors. Empty output = nothing selected, skip.
selected_claude_org() {
  orca_plus_cli account list --json | python3 -c "
import json, sys
c = json.load(sys.stdin)['result']['claude']
active = c['activeAccountIdsByRuntime'].get('host')
print(next((a.get('organizationUuid') or '' for a in c['accounts'] if a['id'] == active), ''))"
}
# Why the pointer: launches run in the selected account's own folder (upstream per-account
# CLAUDE_CONFIG_DIR); empty means System default, i.e. ~/.claude.
routed_claude_home() {
  local pointer="$profile/claude-profiles/selected-host"
  [ -f "$pointer" ] && cat "$pointer" || true
}
cli_claude_status() {
  local home
  home=$(routed_claude_home)
  if [ -n "$home" ]; then
    CLAUDE_CONFIG_DIR="$home" "$HOME/.local/bin/claude" auth status --json 2>/dev/null
  else
    env -u CLAUDE_CONFIG_DIR "$HOME/.local/bin/claude" auth status --json 2>/dev/null
  fi
}
cli_claude_org() {
  cli_claude_status | python3 -c "import json,sys;print(json.load(sys.stdin).get('orgId') or '')" 2>/dev/null || true
}
claude_org_matches() {
  local want got
  want=$(selected_claude_org) || return 1
  [ -z "$want" ] && return 0
  # Why: the router writes its pointer once the login shell's env arrives after startup.
  for _ in $(seq 1 15); do
    got=$(cli_claude_org)
    [ "$got" = "$want" ] && return 0
    sleep 2
  done
  # Why not a failure: a folder nobody signed in to yet asks for a login, it never runs another org.
  if [ -z "$got" ]; then
    echo "WARNING: the selected Claude account's folder $(routed_claude_home) is not signed in — sign in once (Settings → Accounts)"
    return 0
  fi
  echo "claude CLI org $got (folder: $(routed_claude_home || true)) != selected account org $want"
  return 1
}
# Why: 45 minutes — a launch sits on the macOS Keychain window until the owner answers it (24.10: 33 min);
# the log says so once, so a stalled ship reads as «answer the window», not as a broken app.
wait_runtime_ready() {
  local told=0
  for _ in $(seq 1 1350); do
    orca_plus_cli status --json 2>/dev/null | grep -q '"state": "ready"' && return 0
    if [ "$told" = 0 ] && pgrep -x SecurityAgent >/dev/null; then
      step "waiting for the Keychain window — answer «Always Allow» so the next ship does not ask"
      told=1
    fi
    sleep 2
  done
  return 1
}
# Why the profile check: a chat of another Orca (DEV) has an id the installed one does not know.
write_restart_marker() {
  [ -n "${ORCA_AGENT_SESSION_ID:-}" ] && [ "${ORCA_USER_DATA_PATH:-$profile}" = "$profile" ] || return 0
  SESSION="$ORCA_AGENT_SESSION_ID" SHA=$(git -C "$repo" rev-parse --short HEAD) python3 -c "
import datetime, json, os
print(json.dumps({'agentSessionId': os.environ['SESSION'], 'sha': os.environ['SHA'],
  'writtenAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))" >"$restart_marker.tmp"
  mv "$restart_marker.tmp" "$restart_marker"
}
# Why: each backup is a full profile plus the old app (~2.6 GB); unpruned, 40 of them ate 57 GB.
# Pruning only after a verified ship let failed ships pile up, so the start prunes too.
prune_backups() {
  local keep=$1 all=("$HOME"/orca-plus-backup-[0-9]*-[0-9]*/) i
  for ((i = 0; i < ${#all[@]} - keep; i++)); do
    [ -d "${all[i]}" ] && run rm -rf "${all[i]:?}"
  done
}
# Why: a ship that stops before the swap changed nothing, so its backup only takes space.
drop_unused_backup() { [ -e "$backup/Orca Plus.app.old" ] || rm -rf "${backup:?}"; }

# Why: quitting Orca+ kills the terminal that started us; re-exec detached before that point.
# The flag is an argument, not an env var: `open` hands our env to the relaunched Orca+, so an
# exported marker made every later ship from an Orca+ session think it was already detached.
if [ "$dry" = 0 ] && [ "$detached" = 0 ]; then
  # Why: keep the previous run's log — a ship that died without a verdict leaves no other trace.
  [ -f "$log" ] && mv "$log" "$log.1"
  # Why: from an Orca+ chat we would share its agent's process group, which its supervisor kills when
  # the chat stops; setsid leaves that group so the ship outlives it.
  nohup perl -MPOSIX -e 'POSIX::setsid() >= 0 or die "setsid: $!\n"; exec @ARGV or die "exec: $!\n"' \
    "$0" "$@" --detached </dev/null >"$log" 2>&1 &
  echo "orca-plus-ship: running detached (pid $!), log $log"
  exit 0
fi

# Why: a ship cut off mid-copy (before staging, 24.10) left an app without Info.plist that cannot
# start; then there is nothing to ask for a repo count, and the new app goes in all the same.
installed_whole=1
[ -f "$app/Contents/Info.plist" ] || installed_whole=0
[ "$installed_whole" = 0 ] && step "the installed Orca+ is incomplete — installing the new one over it"

# Why: the repo count and Claude org below are read from the running app.
if [ "$dry" = 0 ] && [ "$installed_whole" = 1 ] && ! app_running; then
  step "Orca+ is not running — launch the installed one first"
  launch_orca_plus
  wait_runtime_ready || { step "runtime not ready after 45 minutes — abort, nothing changed"; exit 1; }
fi

step "prune backups, keeping the newest one"
prune_backups 1

step "backup profile → $backup"
run mkdir -p "$backup"
[ "$dry" = 0 ] && trap drop_unused_backup EXIT
# Why: the profile is live — an agent can delete a temp file mid-copy (rsync 24, or 23 when it goes
# between listing and open); one more pass picks up the rest. state_files are checked below.
# Claude's per-process session records (sessions/<pid>.json) come and go every second; a backup needs none.
copy_profile() {
  rsync -a --exclude '/claude-profiles/*/home/sessions/' "$profile/" "$backup/profile/" || [ $? = 24 ]
}
# Why: macOS openrsync fails the whole pass on one vanished file, so one retry was not always enough.
backup_profile() { copy_profile || copy_profile || copy_profile; }
run backup_profile
if [ "$dry" = 0 ]; then
  shasum "${state_files[@]}" 2>/dev/null >"$backup/state.sha" || true
  if [ "$installed_whole" = 1 ]; then repo_count >"$backup/repos.count"; fi
  "$repo/scripts/orca-plus-shared-config-snapshot.sh" save "$backup/shared"
fi

if [ "$build" = 1 ]; then
  step "build"
  run env PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" "$repo/scripts/build-orca-plus-mac.sh"
fi
new=$(ls -d "$repo"/dist/mac*/"Orca Plus.app" 2>/dev/null | head -1 || true)
if [ -z "$new" ] && [ "$dry" = 0 ]; then
  step "no built app in dist/ — abort"
  exit 1
fi
step "new app: ${new:-<dist/mac-*/Orca Plus.app>}"
[ "$dry" = 0 ] && codesign --verify --deep --strict "$new"

# Why: the long copy happens while the old app still runs; after the quit only two renames are left,
# so a ship killed at any moment never leaves a half-copied app in /Applications (24.10).
staged="$backup/Orca Plus.app.new"
step "stage the new app beside the backup"
run ditto "$new" "$staged"
[ "$dry" = 0 ] && codesign --verify --deep --strict "$staged"

step "restart marker for chat ${ORCA_AGENT_SESSION_ID:-<none>}"
run write_restart_marker

# Why: a step that fails after the quit must not leave Orca+ closed, nor die without a word in the log.
on_error() {
  step "failed at line $1: $2"
  [ "$dry" = 0 ] && ! app_running && [ -x "$app/Contents/MacOS/Orca Plus" ] && launch_orca_plus
}
trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

step "quit Orca+ (waits up to 3 minutes)"
if [ "$dry" = 0 ]; then
  osascript -e "tell application id \"$bundle_id\" to quit" || true
  for _ in $(seq 1 180); do
    app_running || break
    sleep 1
  done
  if app_running; then
    step "Orca+ still running after 3 minutes — abort, nothing changed"
    rm -f "$restart_marker"
    exit 1
  fi
fi

step "swap app (old one kept in the backup)"
[ -e "$app" ] && run mv "$app" "$backup/Orca Plus.app.old"
if [ "$dry" = 0 ] && ! mv "$staged" "$app"; then
  step "swap failed — restoring the old app"
  rm -f "$restart_marker"
  [ -e "$backup/Orca Plus.app.old" ] && mv "$backup/Orca Plus.app.old" "$app"
  launch_orca_plus
  exit 1
fi

# Why: a registered dist/ copy is what Spotlight, Raycast and `open -b` start next time.
# A copy that was never registered fails with -10814; under set -e that ended the ship before launch.
run /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$new" || true
run "$repo/scripts/orca-plus-open-at-login.sh"

step "launch"
run launch_orca_plus

step "verify profile"
if [ "$dry" = 0 ]; then
  ok=1
  wait_runtime_ready || { echo "runtime not ready after 45 minutes"; ok=0; }
  shasum -c "$backup/state.sha" || ok=0
  if [ -f "$backup/repos.count" ]; then
    [ "$(repo_count)" = "$(cat "$backup/repos.count")" ] || { echo "repo count changed"; ok=0; }
  else
    echo "repo count not compared: the old app was incomplete — now $(repo_count)"
  fi
  "$repo/scripts/orca-plus-shared-config-snapshot.sh" check "$backup/shared" || ok=0
  claude_org_matches || ok=0
  version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")
  commit=$(git -C "$repo" rev-parse --short HEAD)
  # Why: HQ+ shows the ship in thread job/ship, so nobody has to ask whether it landed (24.10).
  if [ "$ok" = 1 ]; then
    step "OK — Orca+ $version installed, profile intact. Backup: $backup"
    orca_plus_cli hq job --job ship --did "Orca+ $version installed ($commit), profile intact" >/dev/null || true
    step "prune backups, keeping only this one"
    prune_backups 1
  else
    step "MISMATCH — check above. Old app and profile are in $backup"
    orca_plus_cli hq job --job ship --found "Orca+ $version ($commit) installed, profile check failed; old app and profile in $backup" \
      --ask "Roll back to the backup?" --options "roll back|keep" >/dev/null || true
    exit 1
  fi
fi
