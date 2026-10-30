// Custom build (hq-request-ledger): while the ledger runs in shadow, it reads the cards the readers
// already raise — Slack mentions and marks, answers to waitings, scout requests — as signals. The
// same mapping the week's replay used (checked by the owner, 30.10).
import { hqPlaceKey, type HqLedgerSignal } from './hq-ledger'

export const HQ_LEDGER_SHADOW_KINDS = ['hq-intake', 'hq-waiting-reply', 'slack-request'] as const

export type HqLedgerInboxCard = {
  kind: string
  refId: string | null
  title: string
  createdAt: number
  /** Custom build (hq-ledger-feed): when the owner handled it; a handled card waits on nobody. */
  doneAt?: number | null
}

export type HqLedgerLookups = {
  waitingRef: (waitingId: string) => { sourceRef: string | null; personId: string | null } | null
  personAuthorId: (personId: string) => string | null
}

const SLACK_CHANNEL = /^[CDG][A-Z0-9]{6,}$/

function json(text: string | null): Record<string, unknown> | null {
  if (!text) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** The signal a card stands for; null when it names no place. */
export function hqLedgerSignalOfCard(
  card: HqLedgerInboxCard,
  lookups: HqLedgerLookups
): HqLedgerSignal | null {
  const ref = json(card.refId)
  if (!ref) {
    return null
  }
  const at = card.createdAt
  // Why: a card the owner already sent, skipped or closed must not come back as his move (Codex, 30.10).
  const open = !card.doneAt
  if (card.kind === 'hq-intake') {
    const channel = str(ref.channel)
    const ts = str(ref.ts)
    if (!channel || !ts) {
      return null
    }
    return {
      key: `slack:${channel}:${str(ref.threadTs) ?? ts}`,
      ts,
      at,
      author: str(ref.author),
      authorId: str(ref.authorSlackId),
      fromOwner: false,
      text: str(ref.text) ?? '',
      link: str(ref.permalink),
      reader: 'slack-mention',
      forOwner: open,
      project: str(ref.project),
      title: str(ref.summary) ?? card.title
    }
  }
  if (card.kind === 'hq-waiting-reply') {
    const waitingId = str(ref.waitingId)
    const waiting = waitingId ? lookups.waitingRef(waitingId) : null
    const key = hqPlaceKey(str(ref.link)) ?? hqPlaceKey(waiting?.sourceRef)
    if (!key) {
      return null
    }
    return {
      key,
      ts: str(ref.replyTs) ?? String(at),
      at,
      author: str(ref.author),
      authorId: waiting?.personId ? lookups.personAuthorId(waiting.personId) : null,
      fromOwner: false,
      text: str(ref.reply) ?? '',
      link: str(ref.link),
      reader: 'reply',
      forOwner: open,
      project: str(ref.project),
      title: str(ref.question) ?? card.title
    }
  }
  if (card.kind === 'slack-request') {
    const id = str(ref.id) ?? ''
    const [channel, thread] = id.split(':')
    const key =
      SLACK_CHANNEL.test(channel ?? '') && thread
        ? `slack:${channel}:${thread}`
        : (hqPlaceKey(str(ref.link)) ??
          (id.startsWith('clickup') && id.split(':')[1] ? `clickup:${id.split(':')[1]}` : null))
    if (!key) {
      return null
    }
    return {
      key,
      ts: `req:${id}`,
      at,
      author: null,
      authorId: null,
      fromOwner: false,
      text: card.title,
      link: str(ref.link),
      reader: 'scout',
      forOwner: open && ref.kind !== 'fyi',
      project: null,
      title: card.title
    }
  }
  return null
}
