// Custom build (router v2 T2, owner 28.11): the registry «person × topic» — the open topics we have with
// one Slack person: the works our recent messages to them came from, our open waitings on them, and the
// chats the owner sent their messages to. A DM reply with no breadcrumb goes to its topic: one topic →
// there, several → the model chooses among them only. Read only.
import type { HqRouterTopic } from '../../../shared/hq-router'
import { ownerTaskOf, taskOfChat } from './pulse-router-graph'
import { routerWorkTarget, sessionOfOut } from './pulse-router'
import type { PulseCore } from './pulse-core'

/** Why two weeks: a DM answer older than that is a new talk; an open waiting stays a topic until closed. */
export const ROUTER_TOPIC_WINDOW_MS = 14 * 24 * 60 * 60_000
const TOPICS_MAX = 8
const TEXT_MAX = 240
const ROWS_MAX = 80

type Seen = { work: string; text: string; at: number; source: HqRouterTopic['source'] }

const clip = (text: unknown): string =>
  typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX) : ''

/** The DM channels this person wrote us in, plus the one the message came in. */
function channelsOf(core: PulseCore, slackUserId: string, channel: string | null): string[] {
  const out = channel && /^[DG]/.test(channel) ? [channel] : []
  const rows = core.db
    .prepare(
      'SELECT DISTINCT c.key FROM conversations c JOIN conversation_messages m ON m.conversation_id = c.id ' +
        "WHERE m.direction = 'in' AND m.author_id = ? AND c.key LIKE 'slack:D%'"
    )
    .all(slackUserId)
  for (const row of rows) {
    const id = String(row.key).split(':')[1]
    if (id && !out.includes(id)) {
      out.push(id)
    }
  }
  return out
}

/** Our messages in those channels: the work each was bound to on Approve, else its sender's work. */
function ourMessages(
  core: PulseCore,
  channels: readonly string[],
  since: number,
  now: number
): Seen[] {
  if (channels.length === 0) {
    return []
  }
  const like = channels.map(() => 'c.key LIKE ?').join(' OR ')
  const rows = core.db
    .prepare(
      'SELECT c.key, m.ts, m.text, m.at, m.session_id, m.decision_id FROM conversation_messages m ' +
        `JOIN conversations c ON c.id = m.conversation_id WHERE m.direction = 'out' AND (${like}) ` +
        'AND m.at >= ? AND m.at <= ? ORDER BY m.at DESC LIMIT ?'
    )
    .all(...channels.map((id) => `slack:${id}:%`), since, now, ROWS_MAX)
  const out: Seen[] = []
  for (const row of rows) {
    const channel = String(row.key).split(':')[1]
    const bound = core.db
      .prepare('SELECT task FROM router_bindings WHERE channel = ? AND ts = ?')
      .get(channel, String(row.ts))
    const sender = bound ? null : sessionOfOut(core, row)
    const work = bound ? String(bound.task) : sender ? ownerTaskOf(core, sender) : null
    if (work) {
      out.push({ work, text: clip(row.text), at: Number(row.at), source: 'message' })
    }
  }
  // Why the bindings too: a message sent before the ledger saw the DM is only bound, not recorded.
  const marks = channels.map(() => '?').join(',')
  for (const row of core.db
    .prepare(
      `SELECT task, source, at FROM router_bindings WHERE channel IN (${marks}) AND at >= ? AND at <= ? ` +
        'ORDER BY at DESC LIMIT ?'
    )
    .all(...channels, since, now, ROWS_MAX)) {
    out.push({
      work: String(row.task),
      text: '',
      at: Number(row.at),
      source: row.source === 'choice' ? 'choice' : 'message'
    })
  }
  return out
}

/** Our waitings on this person open at `now`, by the work of the chat that asked. */
function openWaitings(core: PulseCore, slackUserId: string, now: number): Seen[] {
  return core.db
    .prepare(
      'SELECT w.title, w.agent_session_id, w.created_at FROM waitings w JOIN people p ON p.id = w.person_id ' +
        "WHERE p.slack_user_id = ? AND w.direction = 'on-them' AND w.agent_session_id IS NOT NULL " +
        "AND w.created_at <= ? AND ((w.status = 'open' AND w.resolved_at IS NULL) OR w.resolved_at > ?) " +
        'ORDER BY w.created_at DESC LIMIT ?'
    )
    .all(slackUserId, now, now, ROWS_MAX)
    .map((row) => ({
      work: ownerTaskOf(core, String(row.agent_session_id)),
      text: clip(row.title),
      at: Number(row.created_at),
      source: 'waiting' as const
    }))
}

/** The chats the owner sent this person's conversations to, with our last word there (else theirs). */
function ownerChoices(core: PulseCore, slackUserId: string, since: number, now: number): Seen[] {
  const rows = core.db
    .prepare(
      'SELECT c.id, c.session_id, MAX(m.at) AS at FROM conversations c JOIN conversation_messages m ' +
        "ON m.conversation_id = c.id WHERE m.direction = 'in' AND m.author_id = ? AND c.session_id IS NOT NULL " +
        'AND m.at >= ? AND m.at <= ? GROUP BY c.id ORDER BY at DESC LIMIT ?'
    )
    .all(slackUserId, since, now, ROWS_MAX)
  return rows.map((row) => {
    const last = core.db
      .prepare(
        'SELECT text FROM conversation_messages WHERE conversation_id = ? AND at <= ? ' +
          "ORDER BY direction = 'out' DESC, at DESC LIMIT 1"
      )
      .get(String(row.id), now)
    return {
      work: taskOfChat(core, String(row.session_id)),
      text: clip(last?.text),
      at: Number(row.at),
      source: 'choice' as const
    }
  })
}

/**
 * The open topics with one Slack person at `now`, newest first: one per work, named by the chat that
 * carries it now (or its Lead once that closed); a work with neither is closed and left out.
 */
export function routerPersonTopics(
  core: PulseCore,
  input: { slackUserId: string; channel: string | null; now: number }
): HqRouterTopic[] {
  const since = input.now - ROUTER_TOPIC_WINDOW_MS
  const seen = [
    ...openWaitings(core, input.slackUserId, input.now),
    ...ourMessages(core, channelsOf(core, input.slackUserId, input.channel), since, input.now),
    ...ownerChoices(core, input.slackUserId, since, input.now)
  ].sort((a, b) => b.at - a.at)
  const byWork = new Map<string, HqRouterTopic>()
  const chats = new Set<string>()
  for (const entry of seen) {
    const held = byWork.get(entry.work)
    if (held) {
      // Why: the newest entry names the topic; an older one only fills a missing text.
      held.text ||= entry.text
      continue
    }
    if (chats.size >= TOPICS_MAX) {
      continue
    }
    const target = routerWorkTarget(core, entry.work)
    const chat = target.chat ?? target.lead
    if (!chat || chats.has(chat)) {
      continue
    }
    chats.add(chat)
    byWork.set(entry.work, {
      chat,
      work: entry.work,
      text: entry.text,
      at: entry.at,
      source: entry.source
    })
  }
  return [...byWork.values()]
}
