import { describe, expect, it } from 'vitest'
import { hqWaitingReplyBellItems } from '../../../../../shared/hq-waiting-reply-bell'
import type { PulseInboxItem, PulseWaiting } from '../../../../../shared/pulse-types'
import { groupHqWaitingReplies } from './hq-waiting-reply-toasts'

function answered(id: string, createdAt: number, reply: string): PulseWaiting {
  return {
    id,
    direction: 'on-them',
    personId: 'p1',
    project: 'voice',
    title: `Question ${id}`,
    detail: null,
    source: 'manual',
    sourceRef: null,
    status: 'open',
    dueAt: null,
    resolution: null,
    createdAt,
    resolvedAt: null,
    agentSessionId: `chat-${id}`,
    paneKey: null,
    worktreeId: 'wt',
    reply,
    replyAuthor: 'Борис',
    replyTs: '1792184300.000100',
    repliedAt: 1,
    replyDeliveredAt: null
  }
}

function inbox(waitings: PulseWaiting[]): PulseInboxItem[] {
  return hqWaitingReplyBellItems(waitings, () => null).map((input, index) => ({
    id: `i${index}`,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    urgency: input.urgency ?? 'normal',
    refKind: input.refKind ?? null,
    refId: input.refId ?? null,
    actions: input.actions ?? [],
    dedupeKey: input.dedupeKey,
    createdAt: 0,
    readAt: null,
    doneAt: null,
    doneAction: null
  }))
}

describe('groupHqWaitingReplies', () => {
  it('puts one DM answer to several waiting chats on one card, newest question first', () => {
    const groups = groupHqWaitingReplies(
      inbox([answered('old', 1, 'Привет\nдоступ выдал'), answered('new', 5, 'доступ выдал')])
    )
    expect([...groups.keys()]).toEqual(['Борис:1792184300.000100'])
    expect(groups.get('Борис:1792184300.000100')?.map((target) => target.ref.waitingId)).toEqual([
      'new',
      'old'
    ])
  })
})
