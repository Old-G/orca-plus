import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { SLACK_SOCKET_PING_MS, SlackSocket, type SlackSocketDeps } from './slack-socket'

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN
  sent: string[] = []
  pings = 0
  terminated = false
  send(data: string): void {
    this.sent.push(data)
  }
  ping(): void {
    this.pings += 1
  }
  close(): void {
    this.readyState = WebSocket.CLOSED
    this.emit('close', 1000)
  }
  terminate(): void {
    this.terminated = true
    this.readyState = WebSocket.CLOSED
    this.emit('close', 1006)
  }
}

/** Like ws while the handshake runs: terminate() reports the abort as an 'error' a tick later. */
class ConnectingSocket extends FakeSocket {
  readyState: number = WebSocket.CONNECTING
  close(): void {
    this.terminate()
  }
  terminate(): void {
    process.nextTick(() => this.emit('error', new Error('closed before the connection')))
  }
}

function makeSocket(
  onEnvelope = vi.fn<SlackSocketDeps['onEnvelope']>(async () => undefined),
  Fake: typeof FakeSocket = FakeSocket
) {
  const sockets: FakeSocket[] = []
  const lines: string[] = []
  const openUrl = vi.fn<SlackSocketDeps['openUrl']>(async () => 'wss://slack.test')
  const socket = new SlackSocket({
    openUrl,
    onEnvelope,
    log: (line) => lines.push(line),
    createSocket: () => {
      const fake = new Fake()
      sockets.push(fake)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SlackSocket only uses on/send/close/readyState/removeAllListeners, which FakeSocket implements.
      return fake as unknown as WebSocket
    }
  })
  return { socket, sockets, openUrl, onEnvelope, lines }
}

function frame(body: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(body))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SlackSocket', () => {
  it('acknowledges every envelope, carrying a slash command reply', async () => {
    const onEnvelope = vi.fn<SlackSocketDeps['onEnvelope']>(async () => ({ text: 'Starting…' }))
    const { socket, sockets } = makeSocket(onEnvelope)
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit(
      'message',
      Buffer.from(
        JSON.stringify({ envelope_id: 'env-1', type: 'slash_commands', payload: { text: 'x' } })
      )
    )
    await vi.waitFor(() => expect(sockets[0].sent).toHaveLength(1))
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      envelope_id: 'env-1',
      payload: { text: 'Starting…' }
    })
    expect(onEnvelope).toHaveBeenCalledWith({
      envelopeId: 'env-1',
      type: 'slash_commands',
      payload: { text: 'x' }
    })
    socket.stop()
  })

  it('reconnects after Slack asks it to, and stays down once stopped', async () => {
    vi.useFakeTimers()
    const { socket, sockets, openUrl } = makeSocket()
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'disconnect', reason: 'refresh' }))
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    socket.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(openUrl).toHaveBeenCalledTimes(2)
  })

  it('keeps a live connection that answers pings', async () => {
    vi.useFakeTimers()
    const { socket, sockets } = makeSocket()
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit('open')
    for (let tick = 0; tick < 3; tick += 1) {
      await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
      sockets[0].emit('pong')
    }
    expect(sockets[0].pings).toBe(3)
    expect(sockets[0].terminated).toBe(false)
    expect(sockets).toHaveLength(1)
    socket.stop()
  })

  it('drops a half-open connection that stopped answering and opens a fresh one', async () => {
    vi.useFakeTimers()
    const { socket, sockets, lines } = makeSocket()
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit('open')
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    expect(sockets[0].pings).toBe(1)
    // No pong, no ping, no envelope until the next tick: the connection is dead.
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    expect(sockets[0].terminated).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    expect(lines.some((line) => line.startsWith('no answer from Slack'))).toBe(true)
    socket.stop()
  })

  it('counts any frame from Slack as a sign of life', async () => {
    vi.useFakeTimers()
    const { socket, sockets } = makeSocket()
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit('open')
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    sockets[0].emit('message', frame({ type: 'hello', num_connections: 1 }))
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    expect(sockets[0].terminated).toBe(false)
    socket.stop()
  })

  it('stops pinging once stopped', async () => {
    vi.useFakeTimers()
    const { socket, sockets } = makeSocket()
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit('open')
    socket.stop()
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS * 3)
    expect(sockets[0].pings).toBe(0)
    expect(socket.isRunning()).toBe(false)
  })

  it('says when another connection to the same app takes a share of the events', async () => {
    const { socket, sockets, lines } = makeSocket()
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit('message', frame({ type: 'hello', num_connections: 2 }))
    await vi.waitFor(() =>
      expect(lines).toContain(
        'hello: 2 connections to this Slack app, events are split between them'
      )
    )
    expect(sockets[0].sent).toHaveLength(0)
    socket.stop()
  })

  it('takes a ping from Slack as a sign of life too', async () => {
    vi.useFakeTimers()
    const { socket, sockets } = makeSocket()
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit('open')
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    sockets[0].emit('ping')
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    expect(sockets[0].terminated).toBe(false)
    socket.stop()
  })

  it('does not drop the connection on a tick that comes late after a stall', async () => {
    vi.useFakeTimers()
    const { socket, sockets } = makeSocket()
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].emit('open')
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    vi.setSystemTime(Date.now() + 5 * 60_000)
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    expect(sockets[0].terminated).toBe(false)
    expect(sockets[0].pings).toBe(2)
    // The next on-time tick with still no answer does drop it.
    await vi.advanceTimersByTimeAsync(SLACK_SOCKET_PING_MS)
    expect(sockets[0].terminated).toBe(true)
    socket.stop()
  })

  it('stops cleanly while the handshake is still running', async () => {
    const { socket, sockets } = makeSocket(undefined, ConnectingSocket)
    socket.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    socket.stop()
    // Why: an 'error' with no listener would throw here as an uncaught exception.
    await new Promise((resolve) => setImmediate(resolve))
    expect(socket.isRunning()).toBe(false)
  })

  it('retries at once after restart, not at the backoff a long outage built up', async () => {
    vi.useFakeTimers()
    const { socket, openUrl } = makeSocket()
    openUrl.mockRejectedValue(new Error('offline'))
    socket.start()
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000)
    expect(openUrl).toHaveBeenCalledTimes(4)
    socket.restart()
    await vi.advanceTimersByTimeAsync(0)
    expect(openUrl).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(openUrl).toHaveBeenCalledTimes(6)
    socket.stop()
  })

  it('stays idle while Slack is not connected', async () => {
    const { socket, sockets, openUrl } = makeSocket()
    openUrl.mockResolvedValueOnce(null)
    socket.start()
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalled())
    expect(sockets).toHaveLength(0)
    await vi.waitFor(() => expect(socket.isRunning()).toBe(false))
  })
})
