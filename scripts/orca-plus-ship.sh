#!/usr/bin/env bash
# Ships a verified build into the installed Orca+ without losing the profile.
#
#   scripts/orca-plus-ship.sh --dry-run   print the steps, touch nothing
#   scripts/orca-plus-ship.sh             back up → build → quit Orca+ → swap app → launch → verify
#   scripts/orca-plus-ship.sh --no-build  ship the existing dist/mac-*/Orca Plus.app
#
# Runs itself under nohup once it quits Orca+, so it survives being started from an Orca+
# terminal. Log: $TMPDIR/orca-plus-ship.log (previous run: .log.1). Backup: ~/orca-plus-backup-<date>-<time>.
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
launch_orca_plus() {
  env $(env | sed -nE 's/^((ORCA|CLAUDE|ANTHROPIC)_[A-Z0-9_]*|CODEX_HOME)=.*/-u \1/p') \
    open -b "$bundle_id"
}
run() { if [ "$dry" = 1 ]; then echo "  would run: $*"; else "$@"; fi; }
# Why: anchored — the terminal daemon outlives the app by design and carries this path in its
# --spawner-exec-path argument, so a plain substring match waits on it forever. `-a`: pgrep skips
# its own ancestors, and Orca+ is one whenever the ship starts from an Orca+ session.
app_running() { pgrep -a -f "^$app/Contents/MacOS/Orca Plus( |\$)" >/dev/null; }
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
cli_claude_org() {
  env -u CLAUDE_CONFIG_DIR "$HOME/.local/bin/claude" auth status --json 2>/dev/null |
    python3 -c "import json,sys;print(json.load(sys.stdin).get('orgId') or '')"
}
claude_org_matches() {
  local want
  want=$(selected_claude_org) || return 1
  [ -z "$want" ] && return 0
  # Why: the runtime-auth sync runs asynchronously after startup.
  for _ in $(seq 1 15); do
    [ "$(cli_claude_org)" = "$want" ] && return 0
    sleep 2
  done
  echo "claude CLI org $(cli_claude_org) != selected account org $want"
  return 1
}
wait_runtime_ready() {
  for _ in $(seq 1 90); do
    orca_plus_cli status --json 2>/dev/null | grep -q '"state": "ready"' && return 0
    sleep 2
  done
  return 1
}

# Why: quitting Orca+ kills the terminal that started us; re-exec detached before that point.
# The flag is an argument, not an env var: `open` hands our env to the relaunched Orca+, so an
# exported marker made every later ship from an Orca+ session think it was already detached.
if [ "$dry" = 0 ] && [ "$detached" = 0 ]; then
  # Why: keep the previous run's log — a ship that died without a verdict leaves no other trace.
  [ -f "$log" ] && mv "$log" "$log.1"
  nohup "$0" "$@" --detached </dev/null >"$log" 2>&1 &
  echo "orca-plus-ship: running detached (pid $!), log $log"
  exit 0
fi

step "backup profile → $backup"
run mkdir -p "$backup"
run rsync -a "$profile/" "$backup/profile/"
if [ "$dry" = 0 ]; then
  shasum "${state_files[@]}" 2>/dev/null >"$backup/state.sha" || true
  repo_count >"$backup/repos.count"
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

step "quit Orca+ (waits up to 3 minutes)"
if [ "$dry" = 0 ]; then
  osascript -e "tell application id \"$bundle_id\" to quit" || true
  for _ in $(seq 1 180); do
    app_running || break
    sleep 1
  done
  if app_running; then
    step "Orca+ still running after 3 minutes — abort, nothing changed"
    exit 1
  fi
fi

step "swap app (old one kept in the backup)"
run mv "$app" "$backup/Orca Plus.app.old"
if [ "$dry" = 0 ] && ! ditto "$new" "$app"; then
  step "copy failed — restoring the old app"
  mv "$backup/Orca Plus.app.old" "$app"
  launch_orca_plus
  exit 1
fi
[ "$dry" = 1 ] && echo "  would run: ditto $new $app"

step "launch"
run launch_orca_plus

step "verify profile"
if [ "$dry" = 0 ]; then
  ok=1
  wait_runtime_ready || { echo "runtime not ready after 3 minutes"; ok=0; }
  shasum -c "$backup/state.sha" || ok=0
  [ "$(repo_count)" = "$(cat "$backup/repos.count")" ] || { echo "repo count changed"; ok=0; }
  "$repo/scripts/orca-plus-shared-config-snapshot.sh" check "$backup/shared" || ok=0
  claude_org_matches || ok=0
  version=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist")
  if [ "$ok" = 1 ]; then
    step "OK — Orca+ $version installed, profile intact. Backup: $backup"
  else
    step "MISMATCH — check above. Old app and profile are in $backup"
    exit 1
  fi
fi
