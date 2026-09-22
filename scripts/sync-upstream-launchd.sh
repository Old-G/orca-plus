#!/usr/bin/env bash
# Installs the daily scheduled sync as a per-user launchd agent (macOS).
#
#   sync-upstream-launchd.sh install [--hour H] [--minute M]   write the plist and load it
#   sync-upstream-launchd.sh uninstall                         unload and remove it
#   sync-upstream-launchd.sh status                            show whether it is loaded
#   sync-upstream-launchd.sh print [--hour H] [--minute M]     print the plist, change nothing
set -euo pipefail

LABEL=local.orca-custom.sync-upstream
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOG_DIR="$(git -C "$ROOT" rev-parse --absolute-git-dir)/custom-sync/logs"
DOMAIN="gui/$(id -u)"
HOUR=5
MINUTE=0

cmd=${1:-}
[ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --hour) HOUR=$2; shift ;;
    --minute) MINUTE=$2; shift ;;
    *) echo "sync-upstream-launchd: unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/sync-upstream-scheduled.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <!-- A missed time (asleep) runs once on wake. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/launchd.log</string>
</dict>
</plist>
PLIST
}

case "$cmd" in
  print) plist ;;
  install)
    mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
    plist >"$PLIST"
    plutil -lint "$PLIST" >/dev/null
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "installed $PLIST (daily at $(printf '%02d:%02d' "$HOUR" "$MINUTE"))"
    echo "run once now: launchctl kickstart $DOMAIN/$LABEL"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E 'state|last exit code|runs' || true
    else
      echo "$LABEL is not loaded"
    fi
    ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
