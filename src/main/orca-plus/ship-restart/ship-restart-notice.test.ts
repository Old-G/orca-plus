import { describe, expect, it, vi } from 'vitest'
import {
  parseShipRestartMarker,
  restartAlarmsPrompt,
  runShipRestartNotice,
  SHIP_RESTART_MAX_AGE_MS,
  shipRestartPrompt,
  type ShipRestartNoticeDeps
} from './ship-restart-notice'

const WRITTEN = Date.parse('2026-10-19T10:00:00Z')
const MARKER = JSON.stringify({
  agentSessionId: 'claude_abc',
  sha: '1234abcd',
  writtenAt: '2026-10-19T10:00:00Z'
})

function harness(
  text: string | null,
  delivered: boolean[],
  now = WRITTEN + 60_000,
  startedAt = WRITTEN + 5_000
) {
  let marker = text
  const scheduled: (() => void)[] = []
  const deps: ShipRestartNoticeDeps = {
    readMarker: async () => marker,
    removeMarker: vi.fn(async () => {
      marker = null
    }),
    writeMarker: vi.fn(async (next: string) => {
      marker = next
    }),
    deliver: vi.fn(async () => delivered.shift() ?? false),
    now: () => now,
    startedAt,
    schedule: (run) => void scheduled.push(run)
  }
  return { deps, scheduled, marker: () => marker }
}

describe('parseShipRestartMarker', () => {
  it('reads what the ship script writes', () => {
    expect(parseShipRestartMarker(MARKER)).toEqual({
      agentSessionId: 'claude_abc',
      sha: '1234abcd',
      writtenAt: WRITTEN,
      chats: []
    })
  })

  it('A9: reads the cut-off chats, with or without the shipping chat', () => {
    expect(
      parseShipRestartMarker(
        '{"sha":"1","writtenAt":"2026-10-19T10:00:00Z","chats":["a","",3,"b","a"]}'
      )
    ).toEqual({ agentSessionId: null, sha: '1', writtenAt: WRITTEN, chats: ['a', 'b'] })
    expect(
      parseShipRestartMarker('{"sha":"1","writtenAt":"2026-10-19T10:00:00Z","chats":[]}')
    ).toBeNull()
  })

  it('refuses a marker without a session, sha or time', () => {
    expect(parseShipRestartMarker('{"sha":"1","writtenAt":"2026-10-19T10:00:00Z"}')).toBeNull()
    expect(parseShipRestartMarker('{"agentSessionId":"a","writtenAt":"x","sha":"1"}')).toBeNull()
    expect(parseShipRestartMarker('not json')).toBeNull()
  })
})

describe('runShipRestartNotice', () => {
  it('sends one message to the marked chat and removes the marker', async () => {
    const h = harness(MARKER, [true])
    await runShipRestartNotice(h.deps)
    expect(h.deps.deliver).toHaveBeenCalledExactlyOnceWith(
      'claude_abc',
      shipRestartPrompt('1234abcd')
    )
    expect(h.marker()).toBeNull()
    expect(h.scheduled).toHaveLength(0)
  })

  it('stays silent without a marker', async () => {
    const h = harness(null, [true])
    await runShipRestartNotice(h.deps)
    expect(h.deps.deliver).not.toHaveBeenCalled()
  })

  it('drops a marker written more than 30 minutes before this launch without sending', async () => {
    const launched = WRITTEN + SHIP_RESTART_MAX_AGE_MS + 1
    const h = harness(MARKER, [true], launched + 1_000, launched)
    await runShipRestartNotice(h.deps)
    expect(h.deps.deliver).not.toHaveBeenCalled()
    expect(h.marker()).toBeNull()
  })

  it('still sends after a start that hung 33 minutes on the Keychain window', async () => {
    const h = harness(MARKER, [true], WRITTEN + 34 * 60_000, WRITTEN + 3_000)
    await runShipRestartNotice(h.deps)
    expect(h.deps.deliver).toHaveBeenCalledOnce()
  })

  it('drops an unreadable marker', async () => {
    const h = harness('{', [true])
    await runShipRestartNotice(h.deps)
    expect(h.deps.deliver).not.toHaveBeenCalled()
    expect(h.marker()).toBeNull()
  })

  it('retries a chat that cannot take it yet, keeping the marker until it does', async () => {
    const h = harness(MARKER, [false, true])
    await runShipRestartNotice(h.deps)
    expect(h.marker()).toBe(MARKER)
    h.scheduled.shift()?.()
    await vi.waitFor(() => expect(h.marker()).toBeNull())
    expect(h.deps.deliver).toHaveBeenCalledTimes(2)
  })

  it('A9: tells every cut-off chat to re-arm, the shipping chat to check the ship', async () => {
    const marker = JSON.stringify({
      agentSessionId: 'ship',
      sha: 'abc',
      writtenAt: '2026-10-19T10:00:00Z',
      chats: ['ship', 'w1', 'w2']
    })
    const h = harness(marker, [true, true, true])
    await runShipRestartNotice(h.deps)
    expect(vi.mocked(h.deps.deliver).mock.calls).toEqual([
      ['ship', shipRestartPrompt('abc')],
      ['w1', restartAlarmsPrompt('abc')],
      ['w2', restartAlarmsPrompt('abc')]
    ])
    expect(h.marker()).toBeNull()
  })

  it('A9: retries only the chats that did not take it, then drops the marker', async () => {
    const marker = JSON.stringify({
      sha: 'abc',
      writtenAt: '2026-10-19T10:00:00Z',
      chats: ['w1', 'w2']
    })
    const h = harness(marker, [true, false, true])
    await runShipRestartNotice(h.deps)
    // Why: another restart now would tell only w2, not w1 again.
    expect(parseShipRestartMarker(h.marker() ?? '')?.chats).toEqual(['w2'])
    h.scheduled.shift()?.()
    await vi.waitFor(() => expect(h.marker()).toBeNull())
    expect(vi.mocked(h.deps.deliver).mock.calls.map(([id]) => id)).toEqual(['w1', 'w2', 'w2'])
  })

  it('A9: drops the marker after 30 minutes even with chats still untold', async () => {
    const marker = JSON.stringify({
      sha: 'abc',
      writtenAt: '2026-10-19T10:00:00Z',
      chats: ['w1']
    })
    let now = WRITTEN + 60_000
    const h = harness(marker, [false])
    h.deps.now = () => now
    await runShipRestartNotice(h.deps)
    expect(h.marker()).toBe(marker)
    now += SHIP_RESTART_MAX_AGE_MS + 1
    h.scheduled.shift()?.()
    await vi.waitFor(() => expect(h.marker()).toBeNull())
    expect(h.deps.deliver).toHaveBeenCalledOnce()
  })

  it('A9: keeps retrying when the marker cannot be rewritten', async () => {
    const marker = JSON.stringify({
      sha: 'abc',
      writtenAt: '2026-10-19T10:00:00Z',
      chats: ['w1', 'w2']
    })
    const h = harness(marker, [true, false, true])
    h.deps.writeMarker = vi.fn(async () => {
      throw new Error('disk full')
    })
    await runShipRestartNotice(h.deps)
    expect(h.scheduled).toHaveLength(1)
    h.scheduled.shift()?.()
    await vi.waitFor(() => expect(h.marker()).toBeNull())
    expect(h.deps.deliver).toHaveBeenCalledTimes(3)
  })
})
