#!/usr/bin/env bash
# Opens the installed Orca+ at login through a LaunchAgent (idempotent).
#
#   scripts/orca-plus-open-at-login.sh           install or refresh the agent
#   scripts/orca-plus-open-at-login.sh --remove  remove it
#
# Why a LaunchAgent: Orca has no open-at-login of its own, and the Login Items entry for this locally
# signed app was found switched off after reinstalls; launchd runs `open` regardless of signature.
set -euo pipefail

label=local.orca-plus.open-at-login
plist="$HOME/Library/LaunchAgents/$label.plist"
app="/Applications/Orca Plus.app"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$plist"
  echo "orca-plus-open-at-login: removed"
  exit 0
fi

want=$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>$app</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict>
</plist>
EOF
)

if [ -f "$plist" ] && [ "$(cat "$plist")" = "$want" ]; then
  echo "orca-plus-open-at-login: already installed"
  exit 0
fi
mkdir -p "$(dirname "$plist")"
printf '%s\n' "$want" >"$plist"
# Why no bootstrap: RunAtLoad would open the app right now; launchd loads the file at next login.
echo "orca-plus-open-at-login: installed $plist"
