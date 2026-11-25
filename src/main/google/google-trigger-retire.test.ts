// Custom build (google-disconnect-forget)
import { describe, expect, it, vi } from 'vitest'
import type { GoogleApi } from './google-api-client'
import { retirableGoogleTriggerChecker } from './google-trigger-retire'
import type { GoogleTriggerState } from './google-trigger-state'

const NOW = Date.parse('2026-11-22T12:00:00Z')

// One meeting starting 10 min 50 s from now; every read waits for `wait()` first.
function calendarApi(email: string, wait: () => Promise<void>): GoogleApi {
  const startsAt = new Date(NOW + 10 * 60_000 + 50_000).toISOString()
  const get: GoogleApi['get'] = async (_service, url, read) => {
    await wait()
    const body = new URL(url).searchParams.has('timeMin')
      ? { items: [{ id: 'standup', start: { dateTime: startsAt }, end: { dateTime: startsAt } }] }
      : { items: [], nextSyncToken: 'token' }
    const value = read(body)
    if (value === null) {
      throw new Error('unexpected page')
    }
    return value
  }
  return {
    email,
    get,
    find: async () => null,
    send: async () => {
      throw new Error('no writes')
    },
    bytes: async () => new Uint8Array(),
    tool: async () => {
      throw new Error('no MCP')
    }
  }
}

describe('a retired Google trigger checker', () => {
  it('starts no bot and writes no state from a check that was waiting on Google', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let slow = true
    const runForEvent = vi.fn(async () => undefined)
    const writes: GoogleTriggerState[] = []
    const checker = retirableGoogleTriggerChecker({
      automations: () => [
        {
          id: 'auto',
          enabled: true,
          bot: { botId: 'b1', runsIn: 'new', resultsTo: 'chat' },
          // Due 11 minutes before a meeting 10 min 50 s away: the check fires it at once.
          on: [
            {
              id: 'r1',
              source: 'calendar',
              event: 'starting_soon',
              account: 'ann@acme.example',
              minutesBefore: 11
            }
          ]
        }
      ],
      bots: () => [{ id: 'b1', google: true }],
      accounts: () => ['ann@acme.example'],
      defaultAccount: async () => ({ email: 'ann@acme.example' }),
      api: (account) => calendarApi(account, () => (slow ? gate : Promise.resolve())),
      runForEvent,
      readState: () => ({ accounts: {}, listeners: {} }),
      writeState: (state) => {
        writes.push(state)
      },
      now: () => NOW,
      tickMs: 120_000
    })

    const waiting = checker.tick()
    checker.retire()
    slow = false
    release()
    await waiting
    expect(runForEvent).not.toHaveBeenCalled()
    expect(writes).toEqual([])

    // The next tick is a fresh checker that works as before.
    await checker.tick()
    expect(runForEvent).toHaveBeenCalledTimes(1)
    expect(writes).toHaveLength(1)
    checker.stop()
  })
})
