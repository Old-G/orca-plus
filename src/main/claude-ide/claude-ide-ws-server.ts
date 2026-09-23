import { createServer, type Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { createClaudeIdeMcpSession, type ClaudeIdeMcpSession } from './claude-ide-mcp-session'
import type { ClaudeIdeCallTool } from './claude-ide-tool-executor'

export const CLAUDE_IDE_AUTH_HEADER = 'x-claude-code-ide-authorization'

export type ClaudeIdeWsServerOptions = {
  authToken: string
  serverName: string
  serverVersion: string
  callTool: ClaudeIdeCallTool
  /** Runs once per client after the MCP handshake settles (VS Code replays the selection then). */
  onClientReady?: (notify: (method: string, params: unknown) => void) => void
  /** Checked once the CLI reports its pid; false closes the connection. */
  acceptClient?: (pid: number) => Promise<boolean>
}

export type ClaudeIdeClient = {
  /** From the CLI's `ide_connected` notification; absent until it arrives. */
  pid?: number
  connectedAt: number
  notify: (method: string, params: unknown) => void
}

/** Loopback MCP-over-WebSocket server, the transport the Claude CLI uses for IDEs. */
export class ClaudeIdeWsServer {
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private readonly sessions = new Map<WebSocket, ClaudeIdeMcpSession>()
  private readonly clientInfo = new Map<WebSocket, ClaudeIdeClient>()

  constructor(private readonly options: ClaudeIdeWsServerOptions) {}

  listen(port: number): Promise<number> {
    const httpServer = createServer((_request, response) => {
      response.writeHead(426).end()
    })
    const wss = new WebSocketServer({ server: httpServer })
    wss.on('connection', (socket, request) => this.accept(socket, request.headers))
    return new Promise((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(port, '127.0.0.1', () => {
        httpServer.off('error', reject)
        const address = httpServer.address()
        this.httpServer = httpServer
        this.wss = wss
        resolve(typeof address === 'object' && address ? address.port : port)
      })
    })
  }

  private accept(socket: WebSocket, headers: Record<string, string | string[] | undefined>): void {
    if (headers[CLAUDE_IDE_AUTH_HEADER] !== this.options.authToken) {
      socket.close(1008, 'Unauthorized')
      return
    }
    const session = createClaudeIdeMcpSession({
      serverName: this.options.serverName,
      serverVersion: this.options.serverVersion,
      callTool: this.options.callTool,
      send: (message) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message))
        }
      },
      onClientNotification: (method, params) => {
        if (method === 'ide_connected') {
          const pid =
            typeof params === 'object' && params !== null && 'pid' in params ? params.pid : null
          const info = this.clientInfo.get(socket)
          if (info && typeof pid === 'number' && Number.isInteger(pid)) {
            info.pid = pid
            void this.options
              .acceptClient?.(pid)
              .then((accepted) => {
                if (!accepted) {
                  socket.close(1008, 'Claude CLI belongs to another Orca')
                }
              })
              .catch(() => {
                // Unverifiable client: keep it, as before this check existed.
              })
          }
        }
        if (method === 'notifications/initialized') {
          // Why: VS Code waits 500ms after connect so the CLI has registered its handlers.
          setTimeout(() => this.options.onClientReady?.(session.notify), 500)
        }
      }
    })
    this.sessions.set(socket, session)
    this.clientInfo.set(socket, { connectedAt: Date.now(), notify: session.notify })
    socket.on('message', (data) => {
      void session.handleRawMessage(data.toString())
    })
    const drop = (): void => {
      this.clientInfo.delete(socket)
      if (this.sessions.delete(socket)) {
        session.dispose()
      }
    }
    socket.on('close', drop)
    socket.on('error', drop)
  }

  /** Unlike VS Code (one CLI per window), every Orca terminal's CLI stays connected. */
  broadcast(method: string, params: unknown): void {
    for (const session of this.sessions.values()) {
      session.notify(method, params)
    }
  }

  clients(): ClaudeIdeClient[] {
    return [...this.clientInfo.values()]
  }

  get clientCount(): number {
    return this.sessions.size
  }

  close(): void {
    for (const socket of this.sessions.keys()) {
      socket.terminate()
    }
    this.sessions.clear()
    this.clientInfo.clear()
    this.wss?.close()
    this.httpServer?.close()
    this.wss = null
    this.httpServer = null
  }
}
