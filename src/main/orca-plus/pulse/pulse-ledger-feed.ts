// Custom build (hq-ledger-feed): what HQ+'s feed needs from the ledger — the window's conversations with
// their last messages, and which conversation each waiting lives in — so every card of one Slack
// thread, ClickUp task or MR folds into one. The owner's pick of a project is kept for the thread and,
// in a channel, for the channel's new threads.
import { hqPlaceKey } from '../../../shared/hq-ledger'
import type { HqFeedConversation, HqFeedLedger } from '../../../shared/hq-feed-ledger'
import type { PulseCore } from './pulse-core'

const FEED_MESSAGES = 6
/** Why: a waiting asked a week before the window may still get its answer inside it. */
const WAITING_LOOKBACK_MS = 14 * 24 * 60 * 60_000
/** A channel's rule; a DM spans every project, so it never gets one. */
const CHANNEL_OF = /^slack:([CG][A-Z0-9]+):/

function str(value: unknown): string | null {
  return value == null ? null : String(value)
}

export function listLedgerFeed(core: PulseCore, since: number): HqFeedLedger {
  const waitingPlaces: Record<string, string> = {}
  const keyOf = new Map<string, string>()
  for (const row of core.db.prepare('SELECT id, key FROM conversations').iterate()) {
    keyOf.set(String(row.id), String(row.key))
  }
  const rows = core.db
    .prepare(
      `SELECT id, source_ref, conversation_id FROM waitings
        WHERE status = 'open' OR created_at >= ? OR resolved_at >= ?`
    )
    .all(since - WAITING_LOOKBACK_MS, since)
  for (const row of rows) {
    const conversation = str(row.conversation_id)
    const key = (conversation ? keyOf.get(conversation) : null) ?? hqPlaceKey(str(row.source_ref))
    if (key) {
      waitingPlaces[String(row.id)] = key
    }
  }
  const messages = core.db.prepare(
    `SELECT direction, author, text, link, at FROM conversation_messages
      WHERE conversation_id = ? AND ts NOT LIKE 'req:%'
      ORDER BY at DESC, ts DESC LIMIT ${FEED_MESSAGES}`
  )
  const wanted = new Set(Object.values(waitingPlaces))
  const conversations: HqFeedConversation[] = core.db
    .prepare('SELECT * FROM conversations ORDER BY last_at')
    .all()
    .filter((row) => Number(row.last_at) >= since || wanted.has(String(row.key)))
    .map((row) => ({
      id: String(row.id),
      key: String(row.key),
      project: str(row.project),
      projectHow: str(row.project_how),
      title: String(row.title),
      state: String(row.state),
      lastAt: Number(row.last_at),
      sessionId: str(row.session_id),
      messages: messages
        .all(String(row.id))
        .map((m) => ({
          direction: m.direction === 'out' ? ('out' as const) : ('in' as const),
          author: str(m.author),
          text: String(m.text),
          link: str(m.link),
          at: Number(m.at)
        }))
        .toReversed()
    }))
  return { conversations, waitingPlaces }
}

/** The owner's project for a conversation; in a channel it becomes the channel's rule too. */
export function setLedgerProject(core: PulseCore, key: string, project: string): void {
  core.transaction(() => {
    core.db
      .prepare(`UPDATE conversations SET project = ?, project_how = 'owner' WHERE key = ?`)
      .run(project, key)
    const channel = CHANNEL_OF.exec(key)
    if (channel) {
      core.db
        .prepare(
          `INSERT INTO ledger_rules (place, project, at) VALUES (?, ?, ?)
           ON CONFLICT(place) DO UPDATE SET project = excluded.project, at = excluded.at`
        )
        .run(`slack:${channel[1]}`, project, core.clock.now())
    }
    core.emit('conversation.updated', 'conversation', key, { project })
  })
}

/** The owner's rule for the channel a new thread starts in; null when there is none. */
export function ledgerRuleOf(core: PulseCore, key: string): string | null {
  const channel = CHANNEL_OF.exec(key)
  const row = channel
    ? core.db.prepare('SELECT project FROM ledger_rules WHERE place = ?').get(`slack:${channel[1]}`)
    : undefined
  return row ? String(row.project) : null
}
