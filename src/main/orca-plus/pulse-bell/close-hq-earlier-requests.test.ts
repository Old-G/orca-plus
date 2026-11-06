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
    await Promise.resolve()

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

  it('keeps closing the bell when the decision write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const inbox = inboxOf([request('a', 1), request('c', 3, true)])
    closeHqEarlierRequests(inbox, async () => {
      throw new Error('disk full')
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(inbox.pulseMarkInboxDone).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
