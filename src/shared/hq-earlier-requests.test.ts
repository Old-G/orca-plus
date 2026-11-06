import { describe, expect, it } from 'vitest'
import type { PulseInboxItem } from './pulse-types'
import { hqEarlierRequestsToClose } from './hq-earlier-requests'

function request(id: string, at: number, done = false, task = 'abc123'): PulseInboxItem {
  return {
    id,
    kind: 'slack-request',
    title: `Ann: ${id}`,
    body: null,
    urgency: 'normal',
    refKind: 'slack-request',
    refId: JSON.stringify({
      id: `clickup:${task}:${id}`,
      link: `https://app.clickup.com/t/${task}`
    }),
    actions: [],
    dedupeKey: null,
    createdAt: at,
    readAt: null,
    doneAt: done ? at + 1 : null,
    doneAction: done ? 'done' : null
  }
}

describe('hqEarlierRequestsToClose', () => {
  it('closes the earlier open requests of a task once its newest is decided', () => {
    expect(
      hqEarlierRequestsToClose([request('a', 1), request('b', 2), request('c', 3, true)])
    ).toEqual(['a', 'b'])
  })

  it('closes nothing while the newest still asks, or in another task', () => {
    expect(hqEarlierRequestsToClose([request('a', 1), request('c', 3)])).toEqual([])
    expect(hqEarlierRequestsToClose([request('a', 1), request('c', 3, true, 'zzz')])).toEqual([])
  })
})
