// Custom build (hq-request-ledger): with the ledger switched on, a Slack conversation waiting on the
// owner is one «To work» card — the same card a 👾 mark makes, so its buttons, Send to chat and the
// classic HQ toasts stay as they are. It shows the people's last messages and the conversation's gist.
import type { HqIntake } from '../../shared/hq-slack-intake'
import type { HqLedgerCardRow } from '../orca-plus/pulse/pulse-ledger-cards'
import type { HqLedgerDraft } from '../orca-plus/pulse/pulse-ledger-draft'

const SLACK_KEY = /^slack:([A-Z0-9]+):(.+)$/

/** Custom build (hq-ledger-quiet-thanks, owner 09.11): how long a person's newest message waits for
 *  the model's read before its card shows anyway — a model down or the day's budget spent must not
 *  hide a request for good. */
export const HQ_LEDGER_CARD_HOLD_MS = 5 * 60_000

/** Custom build (hq-ledger-quiet-thanks, owner 09.11: «спасибо, всё супер» made five cards in ten
 *  minutes, each gone a minute later): a conversation's card shows once the model read its newest
 *  message — a thanks or small talk is taken off the owner's move before it ever pops. */
export function hqLedgerCardReady(
  row: Pick<HqLedgerCardRow, 'messages'>,
  draft: Pick<HqLedgerDraft, 'lastTs'> | null,
  now: number
): boolean {
  const newest = row.messages.at(-1)
  return !newest || draft?.lastTs === newest.ts || newest.at <= now - HQ_LEDGER_CARD_HOLD_MS
}

function threadOf(link: string | null): string | null {
  try {
    return link ? new URL(link).searchParams.get('thread_ts') : null
  } catch {
    return null
  }
}

/** The card of one conversation; null when its key names no Slack place. Custom build
 *  (hq-ledger-draft): a draft written for an older message is left off — it answers what was said
 *  before. */
export function hqIntakeOfConversation(
  row: HqLedgerCardRow,
  draft: HqLedgerDraft | null = null
): HqIntake | null {
  const place = SLACK_KEY.exec(row.key)
  const newest = row.messages.at(-1)
  if (!place || !newest) {
    return null
  }
  const [, channel, root] = place
  const dm = channel.startsWith('D')
  // Why: a DM talk is top-level lines keyed by its first one — answering it in a thread would hide
  // the answer; a real thread (its links carry thread_ts) is answered in place.
  const threaded = !dm || row.messages.some((message) => threadOf(message.link) !== null)
  const lines = row.messages.map((message) => {
    const said = message.text.replace(/\s+/g, ' ').trim()
    const who = message.author ?? 'Someone'
    // Why: an answer the reply reader took is already written «Name: text».
    return said.startsWith(`${who}:`) ? said : `${who}: ${said}`
  })
  return {
    channel,
    ts: root,
    threadTs: threaded ? root : null,
    author: newest.author ?? 'Someone',
    authorSlackId: newest.authorId,
    venue: dm ? 'dm' : channel.startsWith('G') ? 'group' : 'channel',
    text: lines.join('\n'),
    links: [],
    files: [],
    permalink: newest.link,
    at: row.messages[0]?.at ?? newest.at,
    via: 'mention',
    lastAt: newest.at,
    conversationId: row.id,
    lastTs: newest.ts,
    repoId: null,
    project: row.project,
    summary: row.title,
    ...(draft?.lastTs === newest.ts ? { ask: draft.ask } : {})
  }
}
