import { describe, expect, it } from 'vitest'
import {
  HQ_WAITING_REPLY_ACTION,
  hqWaitingReplyBellItems,
  readHqWaitingReplyRef
} from './hq-waiting-reply-bell'
import type { PulseWaiting } from './pulse-types'

function waiting(overrides: Partial<PulseWaiting> = {}): PulseWaiting {
  return {
    id: 'w1',
    direction: 'on-them',
    personId: 'p1',
    project: 'phone-bot',
    title: 'Phone hours',
    detail: null,
    source: 'slack',
    sourceRef: 'slack:D0AAAAAAAAA:1792184213.178000',
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt: 1,
    resolvedAt: null,
    agentSessionId: 'chat-1',
    paneKey: null,
    worktreeId: 'wt-1',
    reply: 'Sun–Thu 9–18',
    replyAuthor: 'Анна',
    replyTs: '1792184300.000100',
    repliedAt: 2,
    replyDeliveredAt: null,
    ...overrides
  }
}

describe('hqWaitingReplyBellItems', () => {
  it('offers an answer to its chat with who, project, question and the words', () => {
    const [item] = hqWaitingReplyBellItems([waiting()], () => null)
    expect(item).toMatchObject({
      title: 'Анна replied',
      body: 'phone-bot · «Phone hours»\nSun–Thu 9–18',
      urgency: 'urgent',
      dedupeKey: 'hq-waiting-reply:w1:1792184300.000100'
    })
    expect((item?.actions ?? []).map((action) => action.id)).toEqual([
      HQ_WAITING_REPLY_ACTION.deliver,
      HQ_WAITING_REPLY_ACTION.open,
      HQ_WAITING_REPLY_ACTION.skip
    ])
    expect(readHqWaitingReplyRef(item?.refId ?? null)).toMatchObject({
      waitingId: 'w1',
      sessionId: 'chat-1',
      worktreeId: 'wt-1',
      author: 'Анна'
    })
  })

  it('links where the answer was said, else where the question was asked', () => {
    const link = (overrides: Partial<PulseWaiting>): string | null =>
      readHqWaitingReplyRef(
        hqWaitingReplyBellItems([waiting(overrides)], () => null)[0]?.refId ?? null
      )?.link ?? null
    expect(link({ replyLink: 'https://acme.slack.com/archives/D0AAAAAAAAA/p1' })).toBe(
      'https://acme.slack.com/archives/D0AAAAAAAAA/p1'
    )
    expect(link({})).toBe('https://slack.com/app_redirect?channel=D0AAAAAAAAA')
    expect(link({ sourceRef: 'clickup:86abc:90' })).toBe(
      'https://app.clickup.com/t/86abc?comment=90'
    )
    expect(link({ sourceRef: null })).toBeNull()
  })

  it('only acknowledges an answer when no chat asked', () => {
    const [item] = hqWaitingReplyBellItems([waiting({ agentSessionId: null })], () => null)
    expect((item?.actions ?? []).map((action) => action.id)).toEqual([HQ_WAITING_REPLY_ACTION.skip])
  })

  it('leaves out answers already handled and waitings with none', () => {
    expect(
      hqWaitingReplyBellItems(
        [
          waiting({ replyDeliveredAt: 3 }),
          waiting({ reply: null, repliedAt: null, replyTs: null })
        ],
        () => null
      )
    ).toEqual([])
  })
})
