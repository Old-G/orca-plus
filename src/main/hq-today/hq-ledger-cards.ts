// Custom build (hq-request-ledger): with the ledger switched on, a Slack conversation waiting on the
// owner is one «To work» card — the same card a 👾 mark makes, so its buttons, Send to chat and the
// classic HQ toasts stay as they are. It shows the people's last messages and the conversation's gist.
import type { HqIntake } from '../../shared/hq-slack-intake'
import type { HqLedgerCardRow } from '../orca-plus/pulse/pulse-ledger-cards'

const SLACK_KEY = /^slack:([A-Z0-9]+):(.+)$/

function threadOf(link: string | null): string | null {
  try {
    return link ? new URL(link).searchParams.get('thread_ts') : null
  } catch {
    return null
  }
}

/** The card of one conversation; null when its key names no Slack place. */
export function hqIntakeOfConversation(row: HqLedgerCardRow): HqIntake | null {
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
    summary: row.title
  }
}
