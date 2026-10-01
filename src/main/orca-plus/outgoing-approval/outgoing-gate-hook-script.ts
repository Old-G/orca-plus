// Custom build (outgoing-approval): the PreToolUse hook that holds outgoing calls. POSIX sh only; a quick
// local prefilter lets ordinary commands through in a few ms, the hook server decides the rest.

export const OUTGOING_GATE_SCRIPT_FILE = 'outgoing-gate.sh'

/** Endpoint file for sessions whose env has no terminal hook coordinates (native chat). */
export const ORCA_OUTGOING_GATE_ENDPOINT_ENV = 'ORCA_OUTGOING_GATE_ENDPOINT'

// Why: a superset of the shell rules (a test holds it to that), loose enough that a miss here cannot
// wave a send through; anything it matches costs one loopback round trip.
export const OUTGOING_GATE_BASH_PREFILTER =
  'git|gh |glab|ssh|curl|wget|POST|PUT|PATCH|DELETE|\\.(post|put|patch|delete)|method|urlopen|psql|mysql|mongosh|publish|kubectl|terraform|fly |aws |xh |http'

const UNREACHABLE_REASON =
  'Orca+ is not reachable, so this outgoing action cannot be approved and was not sent. Try again once Orca+ is running, or ask the user.'
const UNREADABLE_REASON =
  'Orca+ gave an unreadable answer, so this outgoing action was not approved. Tell the user.'

export function buildOutgoingGateScript(): string {
  return [
    '#!/bin/sh',
    '# Orca+ outgoing approval gate. Managed by Orca+ and rewritten on start; edits are lost.',
    "pass() { printf '{}\\n'; exit 0; }",
    'deny() {',
    `  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\\n' "$1"`,
    '  exit 0',
    '}',
    'endpoint=${ORCA_AGENT_HOOK_ENDPOINT:-${ORCA_OUTGOING_GATE_ENDPOINT-}}',
    'if [ -z "$endpoint" ] && [ -n "${ORCA_USER_DATA_PATH-}" ]; then',
    '  endpoint="$ORCA_USER_DATA_PATH/agent-hooks/endpoint.env"',
    'fi',
    '# Not started by Orca: nothing could show the card, so the gate stays out of the way.',
    'if [ -z "$endpoint" ] && [ -z "${ORCA_AGENT_HOOK_PORT-}" ]; then',
    '  cat >/dev/null',
    '  pass',
    'fi',
    'dir=$(mktemp -d "${TMPDIR:-/tmp}/orca-gate.XXXXXX") || deny "Orca+ could not create a temp file to hold this outgoing action."',
    'trap \'rm -rf "$dir"\' EXIT',
    '# Why: Claude ends an interrupted hook with a signal; exiting runs the EXIT cleanup.',
    "trap 'exit 1' HUP INT TERM",
    'cat > "$dir/in"',
    `if grep -Eq '"tool_name" *: *"Bash"' "$dir/in"; then`,
    `  grep -Eq '${OUTGOING_GATE_BASH_PREFILTER}' "$dir/in" || pass`,
    `elif ! grep -Eq '"tool_name" *: *"mcp__' "$dir/in"; then`,
    '  pass',
    'fi',
    'load() {',
    '  if [ -n "$endpoint" ] && [ -r "$endpoint" ]; then',
    '    . "$endpoint" 2>/dev/null || :',
    '  fi',
    '}',
    'post() {',
    `  curl -sS -o "$dir/out" -w '%{http_code}' --max-time 60 -X POST \\`,
    `    -H 'Content-Type: application/json' \\`,
    '    -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN-}" \\',
    '    -H "X-Orca-Pane-Key: ${ORCA_PANE_KEY-}" \\',
    '    -H "X-Orca-Agent-Session-Id: ${ORCA_AGENT_SESSION_ID-}" \\',
    '    --data-binary "@$2" "http://127.0.0.1:${ORCA_AGENT_HOOK_PORT:-0}/outgoing-gate/$1" 2>/dev/null',
    '}',
    'reply() {',
    `  verb=$(sed -n '1p' "$dir/out" | cut -d' ' -f1)`,
    '  case "$verb" in',
    '    pass) [ -z "${id-}" ] && pass ;;',
    `    final) sed -n '2p' "$dir/out"; exit 0 ;;`,
    `    pending) id=$(sed -n '1p' "$dir/out" | cut -d' ' -f2); return 0 ;;`,
    '  esac',
    `  deny "${UNREADABLE_REASON}"`,
    '}',
    '# First contact: an older Orca+ without the gate answers 404; one that is down gets 30 s.',
    'tries=0',
    'while :; do',
    '  load',
    '  code=$(post submit "$dir/in")',
    '  case "$code" in',
    '    200) reply; break ;;',
    '    404) pass ;;',
    '  esac',
    '  tries=$((tries + 1))',
    `  [ "$tries" -ge 15 ] && deny "${UNREACHABLE_REASON}"`,
    '  sleep 2',
    'done',
    '# Held: ask until the owner decides, reconnecting across Orca+ restarts.',
    `printf '{"id":"%s"}' "$id" > "$dir/wait"`,
    'while :; do',
    '  load',
    '  code=$(post wait "$dir/wait")',
    '  if [ "$code" = 200 ]; then',
    '    reply',
    '  else',
    '    sleep 3',
    '  fi',
    'done',
    ''
  ].join('\n')
}
