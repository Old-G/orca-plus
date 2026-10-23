import { describe, expect, it } from 'vitest'
import { hqPlusIsFyi, hqPlusLook, hqPlusNeedsOwner, hqPlusRequestSource } from './hq-plus-kinds'
import type { HqPlusCard, HqPlusLogItem } from './hq-plus-log'
import type { PulseInboxItem } from './pulse-types'

const where = { room: '_all', project: 'acme', address: null, sessionId: null }

function bell(kind: string, refId: string | null): HqPlusCard {
  const inbox: PulseInboxItem = {
    id: 'i1',
    kind,
    title: 'Ann: look at the diff',
    body: null,
    urgency: 'normal',
    refKind: null,
    refId,
    actions: [],
    dedupeKey: null,
    createdAt: 1,
    readAt: null,
    doneAt: null,
    doneAction: null
  }
  return {
    kind: 'card',
    id: 'inbox:i1',
    at: 1,
    ...where,
    type: 'bell',
    title: inbox.title,
    body: null,
    report: null,
    open: true,
    done: null,
    entry: null,
    inbox
  }
}

describe('hqPlusLook', () => {
  it('tells a Slack ask from a ClickUp FYI by the request ref', () => {
    const ask = bell('slack-request', JSON.stringify({ id: 'D1:1.2', kind: 'answer' }))
    const fyi = bell('slack-request', JSON.stringify({ id: 'clickup-change:t1:2', kind: 'fyi' }))
    expect(hqPlusLook(ask)).toMatchObject({ kind: 'inbox', source: 'slack', fyi: false })
    expect(hqPlusLook(fyi)).toMatchObject({ kind: 'bg', source: 'clickup', fyi: true })
    expect(hqPlusNeedsOwner(ask)).toBe(true)
    expect(hqPlusNeedsOwner(fyi)).toBe(false)
    expect(hqPlusIsFyi(fyi)).toBe(true)
  })

  it('keeps reminders out of «Waiting on you» as background lines', () => {
    const remind = bell('hq-remind', 'w1')
    expect(hqPlusLook(remind)).toMatchObject({ kind: 'bg', badges: [{ label: 'NOTES' }] })
    expect(hqPlusNeedsOwner(remind)).toBe(false)
  })

  it('marks an open Approve as the owner move, a decided one only as Approve', () => {
    const open: HqPlusLogItem = { ...bell('outgoing-approval', null), type: 'approve' }
    expect(hqPlusLook(open).badges.map((badge) => badge.label)).toEqual(['YOUR MOVE', 'APPROVE'])
    expect(hqPlusLook({ ...open, open: false }).badges.map((badge) => badge.label)).toEqual([
      'APPROVE'
    ])
  })

  it('shows an agent line as a chat and a system line as background with its journal tag', () => {
    const line = { kind: 'line' as const, id: 'e1', at: 1, ...where, title: 'Fixed it' }
    expect(hqPlusLook({ ...line, tone: 'agent' }).kind).toBe('chat')
    expect(
      hqPlusLook({ ...line, tone: 'system', journalKind: 'review.finding' }).badges[0]?.label
    ).toBe('CODEX')
  })
})

describe('hqPlusRequestSource', () => {
  it('reads ClickUp and mail ids, else Slack', () => {
    expect(hqPlusRequestSource('clickup-task:abc')).toBe('clickup')
    expect(hqPlusRequestSource('clickup:t:c')).toBe('clickup')
    expect(hqPlusRequestSource('mail:42')).toBe('gmail')
    expect(hqPlusRequestSource('D1:1.2')).toBe('slack')
  })
})
