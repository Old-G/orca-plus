import { describe, expect, it } from 'vitest'
import { computeHqPinnedCounts } from './hq-pinned-counts'
import { hqCountText } from './hq-pinned-counts-wire'
import { pulseWaitingFixture } from './hq-promises.test'
import type { HqFeedItem } from './hq-feed'
import type { PulseDecision, PulseInboxItem } from './pulse-types'

const NOW = new Date(2026, 9, 14, 12).getTime()
const HOUR = 60 * 60_000

function inbox(kind: string, doneAt: number | null = null): PulseInboxItem {
  return {
    id: kind,
    kind,
    title: kind,
    body: null,
    urgency: 'normal',
    refKind: null,
    refId: null,
    actions: [],
    dedupeKey: null,
    createdAt: NOW,
    readAt: null,
    doneAt,
    doneAction: null
  }
}

function feed(at: number): HqFeedItem {
  return {
    id: `f${at}`,
    source: 'git',
    kind: 'commit',
    at,
    title: 't',
    body: null,
    url: null,
    project: null,
    person: null
  }
}

function decision(decidedAt: number): PulseDecision {
  return {
    id: `d${decidedAt}`,
    kind: 'approval',
    title: 't',
    body: null,
    outcome: 'approved',
    project: null,
    personId: null,
    draftId: null,
    source: 'gate',
    decidedAt,
    mirroredPath: null,
    sentContext: null
  }
}

describe('computeHqPinnedCounts', () => {
  it('counts what waits and what is new since each item was opened', () => {
    const counts = computeHqPinnedCounts({
      inbox: [inbox('slack-request'), inbox('slack-request', NOW), inbox('agent-finished')],
      waitings: [
        pulseWaitingFixture({ id: 'a', direction: 'on-me' }),
        pulseWaitingFixture({ id: 'b', direction: 'on-them', createdAt: NOW - 3 * 24 * HOUR })
      ],
      decisions: [decision(NOW - HOUR), decision(NOW - 5 * HOUR)],
      feed: [feed(NOW - HOUR), feed(NOW - 2 * HOUR), feed(NOW - 10 * 24 * HOUR)],
      reports: [{ path: 'daily/x.md', title: 'x', folder: 'daily', at: NOW - HOUR }],
      seenAt: { journal: NOW - 2 * HOUR, reports: NOW },
      now: NOW
    })
    expect(counts).toEqual({ today: 1, onYou: 1, remind: 1, reports: 0, feed: 2, journal: 1 })
  })
})

describe('hqCountText', () => {
  it('caps at 99+', () => {
    expect(hqCountText(7)).toBe('7')
    expect(hqCountText(120)).toBe('99+')
  })
})
