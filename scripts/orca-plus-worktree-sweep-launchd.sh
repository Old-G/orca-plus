#!/usr/bin/env bash
# Custom build (worktree-sweep): runs scripts/orca-plus-worktree-sweep.mjs --apply every night as a
# per-user launchd agent (macOS). A missed time (asleep) runs once on wake.
#
#   orca-plus-worktree-sweep-launchd.sh install [--hour H] [--minute M] [--report-dir DIR]
#                                                                         write the plist and load it
#   orca-plus-worktree-sweep-launchd.sh uninstall                         unload and remove it
#   orca-plus-worktree-sweep-launchd.sh status                            show whether it is loaded
#   orca-plus-worktree-sweep-launchd.sh print [--hour H] [--minute M]     print the plist, change nothing
#
# What it removed: ~/Library/Logs/orca-plus-worktree-sweep.log (one JSON line per worktree, with the
# backup ref that brings it back). --report-dir (HQ's `worktrees` folder) also gets the week's report,
# which HQ → Reports lists. A repo whose worktree is not yet proven merged is fetched once (--fetch), so a
# merge request merged on the server an hour ago reads as merged.
set -euo pipefail

LABEL=local.orca-plus.worktree-sweep
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOG="$HOME/Library/Logs/orca-plus-worktree-sweep.launchd.log"
DOMAIN="gui/$(id -u)"
HOUR=4
MINUTE=0
REPORT_DIR=
NODE=$(command -v node || true)
ORCA_BIN_DIR=$(dirname "$(command -v orca || echo /usr/local/bin/orca)")

cmd=${1:-}
[ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --hour) HOUR=$2; shift ;;
    --minute) MINUTE=$2; shift ;;
    --report-dir) REPORT_DIR=$2; shift ;;
    *) echo "worktree-sweep-launchd: unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# Why: a path with `&`, `<` or `>` (`HQ & Notes/worktrees`) would make the plist invalid XML.
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

plist() {
  local node root report home log path
  node=$(xml "$NODE")
  root=$(xml "$ROOT")
  report=$(xml "$REPORT_DIR")
  home=$(xml "$HOME")
  log=$(xml "$LOG")
  path=$(xml "$ORCA_BIN_DIR:$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin")
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node</string>
    <string>$root/scripts/orca-plus-worktree-sweep.mjs</string>
    <string>--apply</string>
    <string>--fetch</string>${REPORT_DIR:+
    <string>--report-dir</string>
    <string>$report</string>}
  </array>
  <key>WorkingDirectory</key><string>$root</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$path</string>
    <key>HOME</key><string>$home</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
PLIST
}

case "$cmd" in
  print) plist ;;
  install)
    [ -n "$NODE" ] || { echo "worktree-sweep-launchd: node not found on PATH" >&2; exit 1; }
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    # Why staged: the running job is replaced only by a plist that parses (Codex P2 24.11).
    plist > "$PLIST.new"
    if ! plutil -lint -s "$PLIST.new"; then
      rm -f "$PLIST.new"
      echo "worktree-sweep-launchd: the new plist does not parse — the installed job is left as it was" >&2
      exit 1
    fi
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    mv "$PLIST.new" "$PLIST"
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "installed $LABEL — every day at $(printf '%02d:%02d' "$HOUR" "$MINUTE"), log $LOG"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then echo "loaded: $PLIST"; else echo "not loaded"; fi
    ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
