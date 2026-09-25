import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { SlackSocket, type SlackSocketDeps } from './slack-socket'

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN
  sent: string[] = []
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = WebSocket.CLOSED
    this.emit('close')
  }
}

function makeSocket(onEnvelope = vi.fn<SlackSocketDeps['onEnvelope']>(async () => undefined)) {
  const sockets: FakeSocket[] = []
  const openUrl = vi.fn<SlackSocketDeps['openUrl']>(async () => 'wss://slack.test')
  const socket = new SlackSocket({
    openUrl,
    onEnvelope,
    createSocket: () => {
      const fake = new FakeSocket()
      sockets.push(fake)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SlackSocket only uses on/send/close/readyState/removeAllListeners, which FakeSocket implements.
      return fake as unknown as WebSocket
    }
  })
  return { socket, sockets, openUrl, onEnvelope }
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

  it('stays idle while Slack is not connected', async () => {
    const { socket, sockets, openUrl } = makeSocket()
    openUrl.mockResolvedValueOnce(null)
    socket.start()
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalled())
    expect(sockets).toHaveLength(0)
  })
})
