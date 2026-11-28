// Custom build (slack-socket): one Socket Mode connection. It is outbound only (no port is opened
// on this machine); Slack pushes envelopes down it and each must be acknowledged within 3 s.
import WebSocket from 'ws'
import { asSlackRecord } from './slack-request'

export type SlackEnvelope = {
  envelopeId: string
  type: string
  payload: Record<string, unknown>
}

export type SlackSocketDeps = {
  /** apps.connections.open; resolves to the wss URL, or null when Slack is not connected. */
  openUrl: () => Promise<string | null>
  /** Returns the optional ack payload (a slash command's immediate reply). */
  onEnvelope: (envelope: SlackEnvelope) => Promise<Record<string, unknown> | undefined>
  createSocket?: (url: string) => WebSocket
  log?: (message: string) => void
}

const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 60_000
// Custom build (slack-socket-watchdog): after the Mac sleeps or the network changes, the socket can
// stay half-open with no 'close' for many minutes while Slack hands events elsewhere or drops them.
// A ping that gets no answer (nor any other frame) by the next tick means the connection is dead.
export const SLACK_SOCKET_PING_MS = 10_000
// Why: a handshake stuck after a network change would otherwise hang for the OS timeout (75 s+).
const HANDSHAKE_TIMEOUT_MS = 15_000

export class SlackSocket {
  private socket: WebSocket | null = null
  private running = false
  private backoffMs = MIN_BACKOFF_MS
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: SlackSocketDeps) {}

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    void this.connect(this.generation)
  }

  stop(): void {
    this.running = false
    this.generation += 1
    this.stopHeartbeat()
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.removeAllListeners()
      // Why: closing during the handshake makes ws emit 'error' a tick later; with no listener
      // left that would be an uncaught exception in main. terminate() also drops a dead link at
      // once instead of waiting for a close frame that will never come.
      socket.on('error', () => {})
      socket.terminate()
    }
  }

  /** Drops the current connection and opens a new one with the tokens saved now. */
  restart(): void {
    this.stop()
    this.backoffMs = MIN_BACKOFF_MS
    this.start()
  }

  /** True while it is connected or trying to; false once stopped or while Slack is not connected. */
  isRunning(): boolean {
    return this.running
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat()
    let heard = true
    let lastTick = Date.now()
    const hear = (): void => {
      heard = true
    }
    socket.on('pong', hear)
    socket.on('ping', hear)
    socket.on('message', hear)
    this.heartbeat = setInterval(() => {
      if (this.socket !== socket) {
        this.stopHeartbeat()
        return
      }
      const now = Date.now()
      // Why: a tick far later than planned (the process stalled or slept) may run before a pong
      // already on the wire is read; ping again instead of dropping a connection that may be fine.
      const late = now - lastTick > SLACK_SOCKET_PING_MS * 2
      lastTick = now
      if (!heard && !late) {
        this.deps.log?.(
          `no answer from Slack within ${SLACK_SOCKET_PING_MS / 1000} s of a ping, reconnecting`
        )
        // Why: terminate() closes at once and fires 'close', which schedules the reconnect.
        socket.terminate()
        return
      }
      heard = false
      try {
        socket.ping()
      } catch {
        // A socket that cannot even send a ping is caught by the next tick.
      }
    }, SLACK_SOCKET_PING_MS)
    this.heartbeat.unref?.()
  }

  private scheduleReconnect(generation: number): void {
    if (!this.running || generation !== this.generation) {
      return
    }
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect(generation)
    }, delay)
  }

  private async connect(generation: number): Promise<void> {
    let url: string | null
    try {
      url = await this.deps.openUrl()
    } catch (error) {
      this.deps.log?.(`connect failed: ${error instanceof Error ? error.message : String(error)}`)
      this.scheduleReconnect(generation)
      return
    }
    if (generation !== this.generation || !this.running) {
      return
    }
    if (!url) {
      // Not connected to Slack: stay idle until restart() after a connect.
      this.running = false
      return
    }
    const socket = (
      this.deps.createSocket ??
      ((target) => new WebSocket(target, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS }))
    )(url)
    this.socket = socket
    socket.on('message', (data) => void this.handleFrame(socket, data.toString()))
    socket.on('open', () => {
      this.backoffMs = MIN_BACKOFF_MS
      this.deps.log?.('connected')
      this.startHeartbeat(socket)
    })
    socket.on('error', (error) => this.deps.log?.(`socket error: ${error.message}`))
    socket.on('close', (code?: number) => {
      if (this.socket === socket) {
        this.socket = null
        this.stopHeartbeat()
        const delay = this.backoffMs
        this.scheduleReconnect(generation)
        this.deps.log?.(`closed (${code ?? 'no code'}), reconnecting in ${delay} ms`)
      }
    })
  }

  private async handleFrame(socket: WebSocket, raw: string): Promise<void> {
    let frame: Record<string, unknown>
    try {
      frame = asSlackRecord(JSON.parse(raw))
    } catch {
      return
    }
    if (frame.type === 'hello') {
      // Why: Slack hands each event to ONE of the app's connections; a second one (a dev build, an
      // old process) silently takes a share of the owner's reactions.
      const count = Number(frame.num_connections)
      this.deps.log?.(
        Number.isFinite(count) && count > 1
          ? `hello: ${count} connections to this Slack app, events are split between them`
          : 'hello: the only connection to this Slack app'
      )
      return
    }
    if (frame.type === 'disconnect') {
      this.deps.log?.(`Slack asked to reconnect (${String(frame.reason ?? 'no reason')})`)
      // Why: Slack rotates connections; closing lets the close handler open a fresh one.
      socket.close()
      return
    }
    const envelopeId = typeof frame.envelope_id === 'string' ? frame.envelope_id : null
    if (!envelopeId || typeof frame.type !== 'string') {
      return
    }
    const envelope = { envelopeId, type: frame.type, payload: asSlackRecord(frame.payload) }
    let ack: Record<string, unknown> | undefined
    try {
      ack = await this.deps.onEnvelope(envelope)
    } catch (error) {
      this.deps.log?.(`envelope failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ envelope_id: envelopeId, ...(ack ? { payload: ack } : {}) }))
    }
  }
}
