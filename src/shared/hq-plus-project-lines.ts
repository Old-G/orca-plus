// Custom build (hq-project-cards): a project card's lines — one conversation or decision on the owner,
// told as source, who, what and since when — and the chats a card lists, each with its newest turn.
import { HQ_INTAKE_KIND, readHqIntake } from './hq-slack-intake'
import { HQ_REMIND_KIND } from './hq-remind'
import { HQ_WAITING_REPLY_KIND, readHqWaitingReplyRef } from './hq-waiting-reply-bell'
import { hqPlusLook, type HqPlusBadge } from './hq-plus-kinds'
import type { HqPlusCard, HqPlusLogItem } from './hq-plus-log'
import type { HqPlusMapChatState } from './hq-plus-map'

export type HqPlusProjectChatLine = Extract<HqPlusLogItem, { kind: 'line' }>

/** One conversation (or one decision) on the owner, as a line of its project's card. */
export type HqPlusProjectLine = {
  id: string
  /** The card the line opens to, with its own buttons. */
  card: HqPlusCard
  badge: HqPlusBadge
  /** Who it is from, when the card names a person; else the person's id, for the caller's names. */
  who: string | null
  personId: string | null
  what: string
  /** Since when it waits on the owner. */
  since: number
  at: number
  /** A person answered the owner: the line is green. */
  replied: boolean
  /** The chat that holds the conversation. */
  sessionId: string | null
}

/** An open chat as its list knows it: the desktop's and the phone's chat rows both map to this. */
export type HqPlusProjectChatInput = {
  key: string
  project: string | null
  state: HqPlusMapChatState
  sessionId: string | null
  title: string
  at: number
}

export type HqPlusProjectChat = HqPlusProjectChatInput & {
  /** The chat's newest turn in the feed, for its card; null before the journal has one. */
  line: HqPlusProjectChatLine | null
}

const CHAT_BADGE: HqPlusBadge = { label: 'CHAT', tone: 'chat' }
const NOTES_BADGE: HqPlusBadge = { label: 'NOTES', tone: 'bg' }
const TEXT_MAX = 200

export function hqPlusProjectOneLine(text: string): string {
  const said = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  const plain = (said ?? '').replace(/\*\*|`/g, '')
  return plain.length > TEXT_MAX ? `${plain.slice(0, TEXT_MAX - 1)}…` : plain
}

/** What a card asks, not who did what: an answer names its question, a reminder its gist. */
function whatOf(card: HqPlusCard): string {
  if (card.conversation) {
    return card.conversation.title
  }
  const answer =
    card.inbox?.kind === HQ_WAITING_REPLY_KIND ? readHqWaitingReplyRef(card.inbox.refId) : null
  if (answer) {
    return answer.question
  }
  if (card.type === 'approve') {
    return card.title.replace(/^Approve:\s*/, '')
  }
  // Why: «No answer from Ann: …», «Ann waits on the owner: …» — the part after the colon.
  const said = /^[^:]{1,60}:\s+(.+)$/s.exec(card.title)
  return card.inbox?.kind === HQ_REMIND_KIND || card.type === 'wait'
    ? (said?.[1] ?? card.title)
    : card.title
}

function whoOf(card: HqPlusCard): string | null {
  const said = card.conversation?.messages.findLast((message) => message.direction === 'in')
  if (said?.author) {
    return said.author
  }
  const parts = card.conversation?.parts ?? [card]
  for (const part of parts.toReversed()) {
    const kind = part.inbox?.kind
    const author =
      kind === HQ_WAITING_REPLY_KIND
        ? readHqWaitingReplyRef(part.inbox?.refId ?? null)?.author
        : kind === HQ_INTAKE_KIND
          ? readHqIntake(part.inbox?.refId ?? null)?.author
          : null
    if (author) {
      return author
    }
  }
  return null
}

/** Since when it waits: its oldest open card, or the first message after the owner's last one. */
function sinceOf(card: HqPlusCard): number {
  const parts = card.conversation?.parts ?? []
  if (parts.length > 0) {
    return Math.min(...parts.map((part) => part.at))
  }
  const messages = card.conversation?.messages ?? []
  if (messages.length > 0) {
    const lastOut = messages.findLastIndex((message) => message.direction === 'out')
    return messages[lastOut + 1]?.at ?? card.at
  }
  return card.at
}

function badgeOf(card: HqPlusCard): HqPlusBadge {
  const own = hqPlusLook(card).badges.find((badge) => badge.tone !== 'move')
  return own ?? (card.type === 'wait' ? NOTES_BADGE : CHAT_BADGE)
}

export function hqPlusProjectLine(card: HqPlusCard): HqPlusProjectLine {
  const who = whoOf(card)
  const what = hqPlusProjectOneLine(whatOf(card)) || card.title
  return {
    id: card.id,
    card,
    badge: badgeOf(card),
    who,
    personId: card.entry?.personId ?? null,
    // Why: «Ann: can you merge?» under Ann's name says her name twice.
    what: who && what.startsWith(`${who}:`) ? what.slice(who.length + 1).trim() || what : what,
    since: sinceOf(card),
    at: card.at,
    replied:
      card.type === 'reply' || (card.conversation?.parts ?? []).some((p) => p.type === 'reply'),
    sessionId: card.sessionId
  }
}

/** The chat's newest turn for its card; a chat the journal has no turn of yet stands in by its name. */
export function hqPlusProjectChatLine(chat: HqPlusProjectChat): HqPlusProjectChatLine | null {
  if (chat.line) {
    return chat.line
  }
  return chat.sessionId
    ? {
        kind: 'line',
        id: `live:${chat.sessionId}`,
        at: chat.at,
        room: '',
        project: chat.project,
        address: null,
        sessionId: chat.sessionId,
        tone: 'agent',
        title: chat.title,
        journalKind: null
      }
    : null
}
