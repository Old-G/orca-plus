import { CLAUDE_IDE_TOOLS, claudeIdeToolInputJsonSchema } from './claude-ide-tool-catalog'
import type { ClaudeIdeCallTool } from './claude-ide-tool-executor'

// Minimal MCP server over JSON-RPC: the IDE socket only needs initialize,
// tools/list and tools/call, so a full MCP SDK dependency is not worth it.

const FALLBACK_PROTOCOL_VERSION = '2025-06-18'

type JsonRpcMessage = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export type ClaudeIdeMcpSessionDeps = {
  serverName: string
  serverVersion: string
  callTool: ClaudeIdeCallTool
  send: (message: unknown) => void
  onClientNotification?: (method: string, params: unknown) => void
}

export function createClaudeIdeMcpSession(deps: ClaudeIdeMcpSessionDeps) {
  // Why: a CLI that dies mid-review never sends close_tab; its diff tabs would linger.
  const pendingDiffTabs = new Set<string>()

  async function callTool(name: string, args: unknown): Promise<unknown> {
    const tabName =
      name === 'openDiff' && typeof args === 'object' && args !== null && 'tab_name' in args
        ? args.tab_name
        : undefined
    if (typeof tabName !== 'string') {
      return deps.callTool(name, args)
    }
    pendingDiffTabs.add(tabName)
    try {
      return await deps.callTool(name, args)
    } finally {
      pendingDiffTabs.delete(tabName)
    }
  }

  const reply = (id: string | number, result: unknown): void =>
    deps.send({ jsonrpc: '2.0', id, result })
  const fail = (id: string | number | null, code: number, message: string): void =>
    deps.send({ jsonrpc: '2.0', id, error: { code, message } })

  async function handleRequest(
    id: string | number,
    method: string,
    message: JsonRpcMessage
  ): Promise<void> {
    switch (method) {
      case 'initialize': {
        const requested = message.params?.protocolVersion
        reply(id, {
          protocolVersion: typeof requested === 'string' ? requested : FALLBACK_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: deps.serverName, version: deps.serverVersion }
        })
        return
      }
      case 'ping':
        reply(id, {})
        return
      case 'tools/list':
        reply(id, {
          tools: CLAUDE_IDE_TOOLS.map((tool) => ({
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            inputSchema: claudeIdeToolInputJsonSchema(tool),
            ...(tool.readOnly ? { annotations: { readOnlyHint: true } } : {})
          }))
        })
        return
      case 'tools/call': {
        const name = message.params?.name
        if (typeof name !== 'string') {
          fail(id, -32602, 'tools/call requires a tool name')
          return
        }
        reply(id, await callTool(name, message.params?.arguments))
        return
      }
      default:
        fail(id, -32601, `Method not found: ${method}`)
    }
  }

  return {
    async handleRawMessage(raw: string): Promise<void> {
      let message: JsonRpcMessage
      try {
        message = JSON.parse(raw)
      } catch {
        fail(null, -32700, 'Parse error')
        return
      }
      if (typeof message !== 'object' || message === null || typeof message.method !== 'string') {
        // Responses to server-initiated requests; this server sends none.
        return
      }
      if (message.id === undefined || message.id === null) {
        deps.onClientNotification?.(message.method, message.params)
        return
      }
      await handleRequest(message.id, message.method, message)
    },
    notify(method: string, params: unknown): void {
      deps.send({ jsonrpc: '2.0', method, params })
    },
    /** The client is gone: close the diffs it was still waiting on. */
    dispose(): void {
      for (const tabName of pendingDiffTabs) {
        void deps.callTool('close_tab', { tab_name: tabName })
      }
      pendingDiffTabs.clear()
    }
  }
}

export type ClaudeIdeMcpSession = ReturnType<typeof createClaudeIdeMcpSession>
