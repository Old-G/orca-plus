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

export class SlackSocket {
  private socket: WebSocket | null = null
  private running = false
  private backoffMs = MIN_BACKOFF_MS
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private generation = 0

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
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.socket?.removeAllListeners()
    this.socket?.close()
    this.socket = null
  }

  /** Drops the current connection and opens a new one with the tokens saved now. */
  restart(): void {
    this.stop()
    this.start()
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
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
    const socket = (this.deps.createSocket ?? ((target) => new WebSocket(target)))(url)
    this.socket = socket
    socket.on('message', (data) => void this.handleFrame(socket, data.toString()))
    socket.on('open', () => {
      this.backoffMs = MIN_BACKOFF_MS
    })
    socket.on('error', (error) => this.deps.log?.(`socket error: ${error.message}`))
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null
        this.scheduleReconnect(generation)
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
    if (frame.type === 'disconnect') {
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
