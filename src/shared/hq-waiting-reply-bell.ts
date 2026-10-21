// Custom build (hq-reply-approve): a person answered what a chat waits for. The answer waits in the
// bell (and pops bottom-right) until the owner passes it to that chat, opens the chat, or skips it —
// it never reaches the chat on its own.
import type { PulseBellInput } from './pulse-bell'
import type { PulseWaiting } from './pulse-types'

export const HQ_WAITING_REPLY_KIND = 'hq-waiting-reply'

export const HQ_WAITING_REPLY_ACTION = {
  deliver: 'reply-deliver',
  open: 'reply-open',
  skip: 'reply-skip'
} as const

export type HqWaitingReplyRef = {
  waitingId: string
  /** The native chat that asked; null for a waiting recorded by hand. */
  sessionId: string | null
  worktreeId: string | null
  project: string | null
  /** What the chat waits for, and when it asked. */
  question: string
  askedAt: number
  author: string
  replyTs: string
  reply: string
}

export type HqWaitingReplyPassResult =
  | { ok: true }
  | { ok: false; reason: 'gone' | 'no-chat' | 'chat-closed' }

const PREVIEW_MAX = 400

export function hqWaitingReplyBellItems(
  open: readonly PulseWaiting[],
  personName: (personId: string) => string | null
): PulseBellInput[] {
  return open.flatMap((waiting) => {
    if (
      waiting.direction !== 'on-them' ||
      waiting.repliedAt === null ||
      waiting.replyDeliveredAt !== null ||
      !waiting.replyTs ||
      !waiting.reply
    ) {
      return []
    }
    const author =
      waiting.replyAuthor ?? (waiting.personId ? personName(waiting.personId) : null) ?? 'Someone'
    const ref: HqWaitingReplyRef = {
      waitingId: waiting.id,
      sessionId: waiting.agentSessionId,
      worktreeId: waiting.worktreeId,
      project: waiting.project,
      question: waiting.title,
      askedAt: waiting.createdAt,
      author,
      replyTs: waiting.replyTs,
      reply: waiting.reply.slice(0, PREVIEW_MAX)
    }
    const chat = waiting.agentSessionId !== null
    return [
      {
        kind: HQ_WAITING_REPLY_KIND,
        title: `${author} replied`,
        body: `${[waiting.project, `«${waiting.title}»`].filter(Boolean).join(' · ')}\n${ref.reply.replace(/\s+/g, ' ')}`,
        urgency: 'urgent',
        refKind: 'waiting',
        refId: JSON.stringify(ref),
        actions: chat
          ? [
              { id: HQ_WAITING_REPLY_ACTION.deliver, label: 'Pass to chat' },
              { id: HQ_WAITING_REPLY_ACTION.open, label: 'Open chat' },
              { id: HQ_WAITING_REPLY_ACTION.skip, label: 'Skip' }
            ]
          : [{ id: HQ_WAITING_REPLY_ACTION.skip, label: 'Got it' }],
        dedupeKey: `${HQ_WAITING_REPLY_KIND}:${waiting.id}:${waiting.replyTs}`
      }
    ]
  })
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export function readHqWaitingReplyRef(refId: string | null): HqWaitingReplyRef | null {
  let raw: unknown
  try {
    raw = refId ? JSON.parse(refId) : null
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const field = (key: string): string | null => text(Reflect.get(raw, key))
  const waitingId = field('waitingId')
  const replyTs = field('replyTs')
  if (!waitingId || !replyTs) {
    return null
  }
  return {
    waitingId,
    sessionId: field('sessionId'),
    worktreeId: field('worktreeId'),
    project: field('project'),
    question: field('question') ?? '',
    askedAt:
      typeof Reflect.get(raw, 'askedAt') === 'number' ? Number(Reflect.get(raw, 'askedAt')) : 0,
    author: field('author') ?? 'Someone',
    replyTs,
    reply: field('reply') ?? ''
  }
}
