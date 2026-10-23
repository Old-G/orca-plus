// Custom build (hq-plus-room-mcp): a room's `mcp: { deny: [...] }` as the tool rules its Claude chats
// start with. An entry names a server as its tools do (`acme_crm`, `claude_ai_Acme*`) or as /mcp lists
// it (`claude.ai Acme CRM`); a trailing `*` takes every server with that prefix.

const PLAIN_PREFIX = /^[A-Za-z0-9_-]{2}/

/** The server name Claude puts in its tool names, or null for an entry that could hide everything. */
export function hqRoomMcpServerName(entry: string): string | null {
  const name = entry
    .trim()
    .replace(/^mcp__/, '')
    .replace(/__.*$/, '')
    .replace(/[^A-Za-z0-9_*-]/g, '_')
  // Why: a wildcard with fewer than two plain characters before it would take every server.
  return PLAIN_PREFIX.test(name) ? name : null
}

/** The servers a room hides, deduplicated; entries that could hide everything are left out. */
export function hqRoomMcpHidden(entries: readonly string[] | undefined): string[] {
  return [...new Set((entries ?? []).flatMap((entry) => hqRoomMcpServerName(entry) ?? []))]
}

/** `--disallowedTools` rules: `mcp__<server>` hides the whole server, connectors included. */
export function hqRoomMcpDenyRules(entries: readonly string[] | undefined): string[] {
  return hqRoomMcpHidden(entries).map((name) => `mcp__${name}`)
}
