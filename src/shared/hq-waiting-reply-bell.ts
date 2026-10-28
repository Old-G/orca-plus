// Custom build (hq-reply-approve): a person answered what a chat waits for. The answer waits in the
// bell (and pops bottom-right) until the owner passes it to that chat, opens the chat, or skips it —
// it never reaches the chat on its own.
import type { PulseBellInput } from './pulse-bell'
import type { PulseWaiting } from './pulse-types'
import { clickUpWaitingUrl, slackThreadUrl } from './hq-waiting-replies'
import { readHqWaitingTags } from './hq-waiting-tags'

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
  /** Custom build (hq-plus-cards): the owner's own words that asked, when the reader found them. */
  asked?: string | null
  author: string
  replyTs: string
  reply: string
  /** Custom build (hq-reply-source-link): where it was said — the answer, else the question. */
  link: string | null
}

export type HqWaitingReplyPassResult =
  | { ok: true }
  | { ok: false; reason: 'gone' | 'no-chat' | 'chat-closed' }

/** Custom build (hq-plus-person-replies): the routing rule's word on an answer — held while it is
 *  still being judged, else why it was left for the owner. */
export type HqWaitingReplyNote = (waiting: PulseWaiting) => { hold: boolean; why: string | null }

export function hqWaitingReplyBellItems(
  open: readonly PulseWaiting[],
  personName: (personId: string) => string | null,
  note?: HqWaitingReplyNote
): PulseBellInput[] {
  return open.flatMap((waiting) => {
    const routed = note?.(waiting) ?? { hold: false, why: null }
    if (
      routed.hold ||
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
      asked: readHqWaitingTags(waiting.detail).text?.slice(0, 600) ?? null,
      author,
      replyTs: waiting.replyTs,
      reply: waiting.reply,
      link:
        waiting.replyLink ??
        slackThreadUrl(waiting.sourceRef) ??
        clickUpWaitingUrl(waiting.sourceRef, null)
    }
    const chat = waiting.agentSessionId !== null
    return [
      {
        kind: HQ_WAITING_REPLY_KIND,
        title: `${author} replied`,
        body: [
          [waiting.project, `«${waiting.title}»`].filter(Boolean).join(' · '),
          ref.reply.replace(/\s+/g, ' ').slice(0, 400),
          ...(routed.why ? [routed.why] : [])
        ].join('\n'),
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
        dedupeKey: `${HQ_WAITING_REPLY_KIND}:${waiting.id}:${waiting.replyTs}`,
        // Why: a person answers in a burst; each new message grows the same card, not a new one.
        replaces: `${HQ_WAITING_REPLY_KIND}:${waiting.id}:`
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
    asked: field('asked'),
    askedAt:
      typeof Reflect.get(raw, 'askedAt') === 'number' ? Number(Reflect.get(raw, 'askedAt')) : 0,
    author: field('author') ?? 'Someone',
    replyTs,
    reply: field('reply') ?? '',
    link: field('link')
  }
}
