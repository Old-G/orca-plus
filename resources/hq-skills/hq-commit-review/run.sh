#!/bin/bash
# Background commit review (hq-setup → schedule.py install commit-review): Codex reviews the owner's new commits
# in every HQ project (review.py). No Claude model runs here.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
LOG_DIR="$HOME/Library/Logs"; [ -d "$LOG_DIR" ] || LOG_DIR="$HOME/.cache/orca-plus"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/orca-plus-commit-review.log"
LOCK="${TMPDIR:-/tmp}/orca-plus-commit-review.lock"
log() { echo "[$(date '+%F %T')] $*" >>"$LOG"; }
for v in $(env | sed -n -E 's/^((ORCA|CLAUDE)[A-Z0-9_]*)=.*/\1/p'); do unset "$v"; done
HQ=$(python3 "$DIR/../hq-setup/hq_location.py" 2>>"$LOG") || exit 1
cd "$HQ" || exit 1
[ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1048576 ] && tail -c 512000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
mkdir "$LOCK" 2>/dev/null || { log "skip: previous run still going"; exit 0; }
trap 'rmdir "$LOCK"' EXIT
log "run"
HQ_DIR="$HQ" python3 -I "$DIR/review.py" run --max "${COMMIT_REVIEW_MAX:-6}" >>"$LOG" 2>&1
log "exit $?"
