import { describe, expect, it, vi } from 'vitest'
import {
  parseShipRestartMarker,
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
      writtenAt: WRITTEN
    })
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
})
