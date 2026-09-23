import type * as ClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk'
import { CLAUDE_IDE_TOOLS } from './claude-ide-tool-catalog'
import type { ClaudeIdeCallTool } from './claude-ide-tool-executor'

// Entry points called from upstream code (PTY env, structured chat launch).
// Deliberately Electron-free: both paths also run in hosts that never start the
// IDE server, where they must be no-ops.

export const CLAUDE_IDE_PORT_ENV = 'CLAUDE_CODE_SSE_PORT'

type ActiveIdeServer = {
  port: number
  version: string
  callTool: ClaudeIdeCallTool
}

let active: ActiveIdeServer | null = null

export function setActiveClaudeIdeServer(server: ActiveIdeServer | null): void {
  active = server
}

/**
 * Points a local terminal's Claude CLI at this Orca. Always strips an inherited
 * port (e.g. Orca launched from a Cursor terminal) so a pane never talks to a
 * different IDE; WSL's loopback is a separate namespace, so it gets none.
 */
export function applyClaudeIdeTerminalEnv(
  env: Record<string, string>,
  opts: { isWsl?: boolean }
): void {
  delete env[CLAUDE_IDE_PORT_ENV]
  if (active && opts.isWsl !== true) {
    env[CLAUDE_IDE_PORT_ENV] = String(active.port)
  }
}

/**
 * The native chat's `ide` MCP server (the SDK CLI ignores IDE sockets). One
 * instance per query: an SDK server binds a single transport.
 */
export function buildClaudeIdeSdkOptions(
  sdk: Pick<typeof ClaudeAgentSdk, 'createSdkMcpServer' | 'tool'>
): {
  mcpServers?: Record<string, ClaudeAgentSdk.McpSdkServerConfigWithInstance>
} {
  if (!active) {
    return {}
  }
  const { callTool, version } = active
  return {
    mcpServers: {
      ide: sdk.createSdkMcpServer({
        name: 'ide',
        version,
        tools: CLAUDE_IDE_TOOLS.filter((definition) => !definition.terminalOnly).map((definition) =>
          sdk.tool(
            definition.name,
            definition.description ?? '',
            definition.argumentSchema,
            (args) => callTool(definition.name, args),
            definition.readOnly ? { annotations: { readOnlyHint: true } } : undefined
          )
        )
      })
    }
  }
}
