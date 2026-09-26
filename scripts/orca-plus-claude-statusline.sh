#!/bin/bash
# Installed copy: ~/.claude/statusline-command.sh; settings.json statusLine = "bash <that path>".
# Claude Code status line: model, folder, branch, context bar, cost, time.
# Also forwards the raw payload to Orca+ (context % and usage limits per pane), using the same
# protocol as Orca's managed status line, which Orca does not install over a custom one.
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'

# Bar color follows the handoff policy: red at the 60% handoff threshold, yellow from 50%.
if [ "$PCT" -ge 60 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 50 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

BRANCH=""
git rev-parse --git-dir > /dev/null 2>&1 && BRANCH=" | 🌿 $(git branch --show-current 2>/dev/null)"

COST_FMT=$(printf '$%.2f' "$COST")
printf '%b\n' "${CYAN}[$MODEL]${RESET} 📁 ${DIR##*/}$BRANCH"
printf '%b\n' "${BAR_COLOR}${BAR}${RESET} ${PCT}% | ${YELLOW}${COST_FMT}${RESET} | ⏱️ ${MINS}m ${SECS}s"

# --- forward to Orca+ (skipped outside Orca terminals and for background jobs) ---
post_to_orca() {
  curl -sS -X POST "http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/statusline/claude" \
    --connect-timeout 0.5 --max-time 1.5 \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN}" \
    --data-urlencode "paneKey=${ORCA_PANE_KEY}" \
    --data-urlencode "configDir=${CLAUDE_CONFIG_DIR}" \
    --data-urlencode "env=${ORCA_AGENT_HOOK_ENV}" \
    --data-urlencode "version=${ORCA_AGENT_HOOK_VERSION}" \
    --data-urlencode "payload@$1" >/dev/null 2>&1
}

forward_to_orca() {
  [ -n "$CLAUDE_JOB_DIR" ] && return
  if [ -n "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ -r "$ORCA_AGENT_HOOK_ENDPOINT" ]; then
    . "$ORCA_AGENT_HOOK_ENDPOINT" 2>/dev/null
  fi
  [ -z "$ORCA_AGENT_HOOK_PORT" ] || [ -z "$ORCA_AGENT_HOOK_TOKEN" ] || [ -z "$ORCA_PANE_KEY" ] && return
  local pane base now last wait
  pane=$(printf '%s' "$ORCA_PANE_KEY" | tr -c 'A-Za-z0-9._-' '_')
  base="${TMPDIR:-/tmp}/orca-claude-statusline-last-${pane}"
  # Why: the 15 s floor (same rate as Orca's managed script) now DELAYS the newest payload instead of
  # dropping it — the render right after an answer usually lands inside the floor and carries the final context %.
  printf '%s' "$input" >"$base.pending.$$" 2>/dev/null && mv -f "$base.pending.$$" "$base.pending"
  # One flusher per pane; a lock older than a minute belongs to a flusher that died.
  if ! mkdir "$base.lock" 2>/dev/null; then
    [ -n "$(find "$base.lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] || return
    rm -rf "$base.lock"
    mkdir "$base.lock" 2>/dev/null || return
  fi
  while :; do
    while [ -f "$base.pending" ]; do
      now=$(date +%s)
      last=$(cat "$base" 2>/dev/null)
      [[ "$last" =~ ^[0-9]+$ ]] || last=0
      wait=$((last + 15 - now))
      [ "$wait" -gt 15 ] && wait=0
      [ "$wait" -gt 0 ] && sleep "$wait"
      mv -f "$base.pending" "$base.sending" 2>/dev/null || break
      date +%s >"$base" 2>/dev/null
      post_to_orca "$base.sending"
      rm -f "$base.sending"
    done
    rmdir "$base.lock" 2>/dev/null
    # Why: a render that lost the lock race while it was being released would otherwise wait for the next render.
    [ -f "$base.pending" ] && mkdir "$base.lock" 2>/dev/null || break
  done
}
( forward_to_orca & ) >/dev/null 2>&1
exit 0
