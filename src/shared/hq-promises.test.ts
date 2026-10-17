import { describe, expect, it } from 'vitest'
import {
  HQ_PROMISE_DUE_KIND,
  hqPromiseDueAt,
  hqPromiseDueBellItems,
  parseHqScoutPromises
} from './hq-promises'
import type { PulseWaiting } from './pulse-types'

export function pulseWaitingFixture(overrides: Partial<PulseWaiting> = {}): PulseWaiting {
  return {
    id: 'w',
    direction: 'on-me',
    personId: null,
    project: null,
    title: 'Promise',
    detail: null,
    source: 'slack-promise',
    sourceRef: null,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: 0,
    resolvedAt: null,
    agentSessionId: null,
    paneKey: null,
    worktreeId: null,
    reply: null,
    replyAuthor: null,
    replyTs: null,
    repliedAt: null,
    replyDeliveredAt: null,
    ...overrides
  }
}

const LINK = 'https://acme.slack.com/archives/D123/p1792000000000100'

describe('parseHqScoutPromises', () => {
  it('keeps well-formed promises and done marks, drops the rest', () => {
    const parsed = parseHqScoutPromises(
      JSON.stringify({
        promises: [
          {
            permalink: LINK,
            person: 'Ann',
            personSlackId: 'U1',
            what: 'Send the export',
            due: '2026-10-23'
          },
          { permalink: 'https://evil.example/x', person: 'Ann', what: 'x' },
          { permalink: LINK, person: 'Ann', what: 'No due', due: 'Friday' },
          { person: 'Bob', what: 'no link' }
        ],
        done: [{ permalink: LINK, reason: 'sent it' }, { permalink: 'nope' }, 'junk']
      })
    )
    expect(parsed.promises).toEqual([
      {
        permalink: LINK,
        person: 'Ann',
        personSlackId: 'U1',
        what: 'Send the export',
        due: '2026-10-23'
      },
      { permalink: LINK, person: 'Ann', personSlackId: null, what: 'No due', due: null }
    ])
    expect(parsed.done).toEqual([{ permalink: LINK, reason: 'sent it' }])
  })

  it('reads a broken file as empty', () => {
    expect(parseHqScoutPromises('{not json')).toEqual({ promises: [], done: [] })
  })
})

describe('hqPromiseDueBellItems', () => {
  const now = new Date(2026, 9, 22, 12).getTime()
  const waiting = (id: string, dueAt: number | null, extra: Partial<PulseWaiting> = {}) =>
    pulseWaitingFixture({ id, title: `Promise ${id}`, personId: 'p1', dueAt, ...extra })

  it('rings for a promise due today, tomorrow or late, not later ones or closed ones', () => {
    const items = hqPromiseDueBellItems(
      [
        waiting('soon', hqPromiseDueAt('2026-10-23')),
        waiting('today', hqPromiseDueAt('2026-10-22')),
        waiting('late', hqPromiseDueAt('2026-10-20')),
        waiting('later', hqPromiseDueAt('2026-10-30')),
        waiting('none', null),
        waiting('closed', hqPromiseDueAt('2026-10-22'), { status: 'resolved' }),
        waiting('theirs', hqPromiseDueAt('2026-10-22'), { direction: 'on-them' })
      ],
      () => 'Ann',
      now
    )
    expect(items.map((item) => [item.refId, item.title])).toEqual([
      ['soon', 'Due tomorrow: Promise soon'],
      ['today', 'Due today: Promise today'],
      ['late', 'Overdue promise: Promise late']
    ])
    expect(items[0]).toMatchObject({
      kind: HQ_PROMISE_DUE_KIND,
      body: 'You promised Ann',
      dedupeKey: `${HQ_PROMISE_DUE_KIND}:soon`
    })
  })
})
