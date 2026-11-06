import { describe, expect, it, vi } from 'vitest'
import type { PulseInboxItem } from '../../../shared/pulse-types'
import { closeHqEarlierRequests } from './close-hq-earlier-requests'

function request(id: string, at: number, done = false): PulseInboxItem {
  return {
    id,
    kind: 'slack-request',
    title: `Ann: ${id}`,
    body: null,
    urgency: 'normal',
    refKind: 'slack-request',
    refId: JSON.stringify({
      id: `clickup:abc123:${id}`,
      kind: 'answer',
      link: 'https://app.clickup.com/t/abc123'
    }),
    actions: [],
    dedupeKey: null,
    createdAt: at,
    readAt: null,
    doneAt: done ? at + 1 : null,
    doneAction: done ? 'done' : null
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function inboxOf(items: PulseInboxItem[]) {
  return {
    pulseListInbox: () => items,
    pulseMarkInboxDone: vi.fn((id: string, action?: string) => {
      const item = items.find((entry) => entry.id === id)
      if (item) {
        item.doneAt = 10
        item.doneAction = action ?? 'done'
      }
    })
  }
}

describe('closeHqEarlierRequests (Codex P2, 06.11)', () => {
  it('records the scout decision of each earlier request it closes, so classic HQ drops it too', async () => {
    const inbox = inboxOf([request('a', 1), request('b', 2), request('c', 3, true)])
    const recordDecision = vi.fn(async () => undefined)

    closeHqEarlierRequests(inbox, recordDecision)
    await flush()

    expect(inbox.pulseMarkInboxDone.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
    expect(recordDecision.mock.calls).toEqual([['clickup:abc123:a'], ['clickup:abc123:b']])

    // Why: once closed they are not closed or recorded again on the next sync.
    closeHqEarlierRequests(inbox, recordDecision)
    expect(recordDecision).toHaveBeenCalledTimes(2)
  })

  it('records nothing while the newest still asks', () => {
    const inbox = inboxOf([request('a', 1), request('c', 3)])
    const recordDecision = vi.fn(async () => undefined)
    closeHqEarlierRequests(inbox, recordDecision)
    expect(recordDecision).not.toHaveBeenCalled()
  })

  it('keeps the bell open when the decision write fails, and retries on the next settle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const inbox = inboxOf([request('a', 1), request('c', 3, true)])
    closeHqEarlierRequests(inbox, async () => {
      throw new Error('disk full')
    })
    await flush()
    expect(inbox.pulseMarkInboxDone).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()

    const recordDecision = vi.fn(async () => undefined)
    closeHqEarlierRequests(inbox, recordDecision)
    await flush()
    expect(recordDecision.mock.calls).toEqual([['clickup:abc123:a']])
    expect(inbox.pulseMarkInboxDone.mock.calls.map(([id]) => id)).toEqual(['a'])
    warn.mockRestore()
  })

  it('writes one decision per request while a write is still running', async () => {
    const inbox = inboxOf([request('a', 1), request('c', 3, true)])
    let finish: () => void = () => undefined
    const recordDecision = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    closeHqEarlierRequests(inbox, recordDecision)
    closeHqEarlierRequests(inbox, recordDecision)
    expect(recordDecision).toHaveBeenCalledTimes(1)
    finish()
    await flush()
    expect(inbox.pulseMarkInboxDone).toHaveBeenCalledTimes(1)
  })
})
