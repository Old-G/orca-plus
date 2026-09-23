import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { CLAUDE_IDE_AUTH_HEADER, ClaudeIdeWsServer } from './claude-ide-ws-server'
import { createClaudeIdeToolExecutor } from './claude-ide-tool-executor'

type RpcReply = {
  id?: number
  method?: string
  params?: unknown
  jsonrpc?: string
  result?: {
    protocolVersion?: string
    serverInfo?: { name: string }
    tools?: { name: string; inputSchema: { required?: string[] } }[]
    content?: { type: string; text: string }[]
    isError?: boolean
  }
  error?: { code: number }
}

const servers: ClaudeIdeWsServer[] = []

afterEach(() => {
  servers.splice(0).forEach((server) => server.close())
})

async function startServer(
  askRenderer = vi.fn(async () => '[]'),
  acceptClient?: (pid: number) => Promise<boolean>
) {
  const server = new ClaudeIdeWsServer({
    authToken: 'secret',
    acceptClient,
    serverName: 'Orca Claude Code MCP',
    serverVersion: '1.0.0',
    callTool: createClaudeIdeToolExecutor({
      askRenderer,
      latestSelection: () => null
    })
  })
  servers.push(server)
  const port = await server.listen(0)
  return { server, port, askRenderer }
}

function connect(port: number, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { [CLAUDE_IDE_AUTH_HEADER]: token }
  })
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function call(socket: WebSocket, id: number, method: string, params: unknown): Promise<RpcReply> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData): void => {
      const message = JSON.parse(data.toString())
      if (message.id === id) {
        socket.off('message', onMessage)
        resolve(message)
      }
    }
    socket.on('message', onMessage)
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

describe('ClaudeIdeWsServer', () => {
  it('closes connections without the lock-file auth token', async () => {
    const { port } = await startServer()
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { [CLAUDE_IDE_AUTH_HEADER]: 'wrong' }
    })
    const code = await new Promise<number>((resolve) => socket.once('close', resolve))
    expect(code).toBe(1008)
  })

  it('speaks MCP: initialize echoes the protocol, tools/list and tools/call reach the renderer', async () => {
    const askRenderer = vi.fn(async () => '[{"uri":"file:///a.ts","diagnostics":[]}]')
    const { port } = await startServer(askRenderer)
    const socket = await connect(port, 'secret')

    const init = await call(socket, 1, 'initialize', {
      protocolVersion: '2025-11-25'
    })
    expect(init.result?.protocolVersion).toBe('2025-11-25')
    expect(init.result?.serverInfo?.name).toBe('Orca Claude Code MCP')

    const list = await call(socket, 2, 'tools/list', {})
    const tools = list.result?.tools ?? []
    const names = tools.map((tool) => tool.name)
    expect(names).toEqual(
      expect.arrayContaining(['getDiagnostics', 'openFile', 'getCurrentSelection'])
    )
    const openDiff = tools.find((tool) => tool.name === 'openDiff')
    expect(openDiff?.inputSchema.required).toEqual([
      'old_file_path',
      'new_file_path',
      'new_file_contents',
      'tab_name'
    ])
    const openFile = tools.find((tool) => tool.name === 'openFile')
    expect(openFile?.inputSchema.required).toEqual(['filePath'])

    const result = await call(socket, 3, 'tools/call', {
      name: 'getDiagnostics',
      arguments: { uri: 'file:///a.ts' }
    })
    expect(askRenderer).toHaveBeenCalledWith(
      'getDiagnostics',
      { uri: 'file:///a.ts' },
      { waitForUser: false }
    )
    expect(result.result?.content?.[0]?.text).toContain('file:///a.ts')

    const missing = await call(socket, 4, 'resources/list', {})
    expect(missing.error?.code).toBe(-32601)
    socket.close()
  })

  it('remembers the pid a CLI reports in ide_connected so mentions can target it', async () => {
    const { server, port } = await startServer()
    const socket = await connect(port, 'secret')
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'ide_connected', params: { pid: 4321 } }))
    await vi.waitFor(() => expect(server.clients().map((client) => client.pid)).toEqual([4321]))
    socket.close()
    await vi.waitFor(() => expect(server.clients()).toEqual([]))
  })

  it('closes a CLI that acceptClient refuses once it reports its pid', async () => {
    const acceptClient = vi.fn(async (pid: number) => pid !== 666)
    const { server, port } = await startServer(undefined, acceptClient)
    const refused = await connect(port, 'secret')
    const closed = new Promise<number>((resolve) => refused.once('close', resolve))
    refused.send(JSON.stringify({ jsonrpc: '2.0', method: 'ide_connected', params: { pid: 666 } }))
    expect(await closed).toBe(1008)
    const accepted = await connect(port, 'secret')
    accepted.send(JSON.stringify({ jsonrpc: '2.0', method: 'ide_connected', params: { pid: 7 } }))
    await vi.waitFor(() => expect(server.clients().map((client) => client.pid)).toEqual([7]))
    expect(acceptClient).toHaveBeenCalledWith(666)
    accepted.close()
  })

  it('reports renderer failures as tool errors, not transport errors', async () => {
    const { port } = await startServer(
      vi.fn(async () => {
        throw new Error('Orca editor window is not available')
      })
    )
    const socket = await connect(port, 'secret')
    const result = await call(socket, 1, 'tools/call', {
      name: 'getOpenEditors',
      arguments: {}
    })
    expect(result.result).toEqual({
      content: [{ type: 'text', text: 'Orca editor window is not available' }],
      isError: true
    })
    socket.close()
  })

  it('broadcasts notifications to every connected CLI', async () => {
    const { server, port } = await startServer()
    const sockets = await Promise.all([connect(port, 'secret'), connect(port, 'secret')])
    await vi.waitFor(() => expect(server.clientCount).toBe(2))
    const received = sockets.map(
      (socket) =>
        new Promise<RpcReply>((resolve) =>
          socket.once('message', (data) => resolve(JSON.parse(data.toString())))
        )
    )
    server.broadcast('selection_changed', { text: 'x' })
    for (const message of await Promise.all(received)) {
      expect(message).toEqual({
        jsonrpc: '2.0',
        method: 'selection_changed',
        params: { text: 'x' }
      })
    }
    sockets.forEach((socket) => socket.close())
  })
})
