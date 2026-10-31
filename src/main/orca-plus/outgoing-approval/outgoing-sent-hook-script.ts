// Custom build (hq-request-ledger): the PostToolUse hook that tells Orca+ what a finished call sent, so
// every message an agent writes to a person reaches the request ledger — held or not, in a terminal or
// a native chat. POSIX sh; a quick local prefilter lets other calls through in a few ms, and it never
// fails the agent: one POST, answered once the message is in the ledger (at most a few seconds).

export const OUTGOING_SENT_SCRIPT_FILE = 'outgoing-sent.sh'

/** Tools that may message a person; Claude matches it against the tool name. */
export const OUTGOING_SENT_MATCHER =
  'Bash|mcp__.*(Slack|slack|ClickUp|Clickup|clickup|GitLab|Gitlab|gitlab|Gmail|gmail).*'

export function buildOutgoingSentScript(): string {
  return [
    '#!/bin/sh',
    '# Orca+ sent-message recorder. Managed by Orca+ and rewritten on start; edits are lost.',
    'endpoint=${ORCA_AGENT_HOOK_ENDPOINT:-${ORCA_OUTGOING_GATE_ENDPOINT-}}',
    'if [ -z "$endpoint" ] && [ -n "${ORCA_USER_DATA_PATH-}" ]; then',
    '  endpoint="$ORCA_USER_DATA_PATH/agent-hooks/endpoint.env"',
    'fi',
    'if [ -z "$endpoint" ] && [ -z "${ORCA_AGENT_HOOK_PORT-}" ]; then',
    '  cat >/dev/null',
    '  exit 0',
    'fi',
    'dir=$(mktemp -d "${TMPDIR:-/tmp}/orca-sent.XXXXXX") || { cat >/dev/null; exit 0; }',
    'trap \'rm -rf "$dir"\' EXIT',
    "trap 'exit 0' HUP INT TERM",
    'cat > "$dir/in"',
    `grep -Eq '"hook_event_name" *: *"PostToolUse"' "$dir/in" || exit 0`,
    `if grep -Eq '"tool_name" *: *"Bash"' "$dir/in"; then`,
    `  grep -q 'glab' "$dir/in" || exit 0`,
    `elif ! grep -Eiq '"tool_name" *: *"mcp__[^"]*(slack|clickup|gitlab|gmail)' "$dir/in"; then`,
    '  exit 0',
    'fi',
    'if [ -n "$endpoint" ] && [ -r "$endpoint" ]; then',
    '  . "$endpoint" 2>/dev/null || :',
    'fi',
    `curl -sS -o /dev/null --max-time 5 -X POST \\`,
    `  -H 'Content-Type: application/json' \\`,
    '  -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN-}" \\',
    '  -H "X-Orca-Pane-Key: ${ORCA_PANE_KEY-}" \\',
    '  -H "X-Orca-Agent-Session-Id: ${ORCA_AGENT_SESSION_ID-}" \\',
    '  --data-binary "@$dir/in" "http://127.0.0.1:${ORCA_AGENT_HOOK_PORT:-0}/outgoing-gate/sent" \\',
    '  >/dev/null 2>&1 || :',
    'exit 0',
    ''
  ].join('\n')
}
