// Custom build (hq-router, plan router T1): what the router reads from Orca+'s own records — which
// chat sent the message someone answers (by a footer's id or ref, by the thread, by a link to it), the
// chat that carries on for it now and its Lead, the chat a thread was already sent to, and where the
// owner sent this person's messages before. Read only.
import { readOutgoingSentContext } from '../../../shared/outgoing-approval/outgoing-sent-context'
import type { HqCrumbFooter, HqRouterCrumb } from '../../../shared/hq-router-crumb'
import { hqCrumbChatId } from '../../../shared/hq-router-crumb'
import {
  bindChosenThread,
  bindSentMessage,
  chainBack,
  liveChatOf,
  logChoice,
  logRoute,
  ownerTaskOf,
  routerBindingFor,
  taskOfChat,
  type RouterBinding,
  type RouterLogEntry
} from './pulse-router-graph'
import type { PulseCore } from './pulse-core'

const LEAD_ROLES = new Set(['lead', 'sublead'])
const HISTORY_MAX = 5

function roleOf(core: PulseCore, sessionId: string): string | null {
  const row = core.db.prepare('SELECT role FROM chat_roles WHERE session_id = ?').get(sessionId)
  return row ? String(row.role) : null
}

/** The session ids a footer's short id may name (a chat's id cut to 8 hex). */
function sessionsByShortId(core: PulseCore, chatId: string): string[] {
  if (!/^[0-9a-f]{8}$/.test(chatId)) {
    return []
  }
  // Why LIKE on both spellings: older chats are `claude_<uuid with _>`, newer ones a bare uuid.
  return core.db
    .prepare(
      'SELECT session_id FROM sessions WHERE session_id LIKE ? OR session_id LIKE ? OR session_id LIKE ? ' +
        'ORDER BY opened_at DESC'
    )
    .all(`${chatId}%`, `claude_${chatId}%`, `codex_${chatId}%`)
    .map((row) => String(row.session_id))
    .filter((id) => hqCrumbChatId(id) === chatId)
}

/** The chat that sent the approved message with this footer ref. */
function senderByRef(core: PulseCore, ref: string): string | null {
  const row = core.db
    .prepare(
      "SELECT context FROM decisions WHERE kind = 'approval' AND json_extract(context, '$.ref') = ? " +
        'ORDER BY decided_at DESC LIMIT 1'
    )
    .get(ref)
  const sent = row ? readOutgoingSentContext(safeJson(String(row.context ?? ''))) : null
  return sent?.agentSessionId ?? null
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The chat that sent one of our Slack messages, by the message's ts (a link to it, a thread root). */
function senderOfMessage(core: PulseCore, channel: string, ts: string): string | null {
  const row = core.db
    .prepare(
      'SELECT m.session_id, m.decision_id FROM conversation_messages m JOIN conversations c ' +
        "ON c.id = m.conversation_id WHERE m.direction = 'out' AND m.ts = ? AND c.key LIKE ? LIMIT 1"
    )
    .get(ts, `slack:${channel}:%`)
  return row ? sessionOfOut(core, row) : null
}

function sessionOfOut(
  core: PulseCore,
  row: { session_id?: unknown; decision_id?: unknown }
): string | null {
  if (typeof row.session_id === 'string' && row.session_id) {
    return row.session_id
  }
  if (typeof row.decision_id !== 'string' || !row.decision_id) {
    return null
  }
  const decision = core.db
    .prepare('SELECT context FROM decisions WHERE id = ?')
    .get(row.decision_id)
  return decision
    ? (readOutgoingSentContext(safeJson(String(decision.context ?? '')))?.agentSessionId ?? null)
    : null
}

/** The chat behind our latest approved message in this thread before `beforeMs`. */
function senderInThread(
  core: PulseCore,
  channel: string,
  threadTs: string,
  beforeMs: number
): string | null {
  const row = core.db
    .prepare(
      'SELECT m.session_id, m.decision_id FROM conversation_messages m JOIN conversations c ' +
        "ON c.id = m.conversation_id WHERE c.key = ? AND m.direction = 'out' AND m.decision_id IS NOT NULL " +
        'AND m.at <= ? ORDER BY m.at DESC LIMIT 1'
    )
    .get(`slack:${channel}:${threadTs}`, beforeMs)
  if (row) {
    return sessionOfOut(core, row)
  }
  // Why: a message sent before the ledger saw the thread is only in the approval history.
  const sent = core.db
    .prepare(
      "SELECT context FROM decisions WHERE kind = 'approval' AND outcome <> 'rejected' AND " +
        "json_extract(context, '$.targetId') = ? AND json_extract(context, '$.threadTs') = ? AND " +
        'decided_at <= ? ORDER BY decided_at DESC LIMIT 1'
    )
    .get(channel, threadTs, beforeMs)
  return sent
    ? (readOutgoingSentContext(safeJson(String(sent.context ?? '')))?.agentSessionId ?? null)
    : null
}

/** The Lead of a chat now: an `orca hq reassign` move first, else the Lead that launched or briefed it
 *  (on any chat of its handoff chain), followed to that Lead's live successor. */
export function leadOfChat(core: PulseCore, sessionId: string): string | null {
  const chain = chainBack(core, sessionId)
  const marks = [...chain].map(() => '?').join(',')
  const moved = core.db
    .prepare(
      `SELECT to_session_id FROM chat_lead_moves WHERE session_id IN (${marks}) AND to_lead <> 'none' ` +
        'ORDER BY at DESC LIMIT 1'
    )
    .get(...chain)
  if (moved && typeof moved.to_session_id === 'string' && moved.to_session_id) {
    return liveChatOf(core, moved.to_session_id)
  }
  const links = core.db
    .prepare(
      `SELECT parent_session_id FROM chat_links WHERE session_id IN (${marks}) ORDER BY at DESC`
    )
    .all(...chain)
    .map((row) => String(row.parent_session_id))
  const lead = links.find((parent) => LEAD_ROLES.has(roleOf(core, parent) ?? ''))
  return lead ? liveChatOf(core, lead) : null
}

function crumbFor(
  core: PulseCore,
  sender: string | null,
  title: string | null
): HqRouterCrumb | null {
  if (!sender) {
    return null
  }
  // Why the task, not the sender: a one-off chat writes for its parent's task (variant b, 26.11).
  const chat = liveChatOf(core, ownerTaskOf(core, sender))
  return { chat, lead: leadOfChat(core, chat), chatTitle: title }
}

export type HqRouterCrumbLookup = {
  /** Footers found in the message, in what it quotes, or in the message it answers; newest first. */
  footers: readonly HqCrumbFooter[]
  channel: string
  /** The thread's root when the message is a reply. */
  threadTs: string | null
  /** Our message the text links to, when it links one. */
  linked: { channel: string; ts: string } | null
  at: number
}

/**
 * Custom build (hq-router crumbs): the crumb for a message — a footer's id or ref, else the chat behind a
 * linked message of ours, else our latest message in the same thread. Null when nothing ties it to us.
 */
export function routerCrumb(core: PulseCore, lookup: HqRouterCrumbLookup): HqRouterCrumb | null {
  for (const footer of lookup.footers) {
    const sender =
      (footer.chatId ? sessionsByShortId(core, footer.chatId)[0] : null) ??
      (footer.ref ? senderByRef(core, footer.ref) : null)
    if (sender) {
      return crumbFor(core, sender, footer.chatTitle)
    }
  }
  if (lookup.linked) {
    const sender = senderOfMessage(core, lookup.linked.channel, lookup.linked.ts)
    if (sender) {
      return crumbFor(core, sender, null)
    }
  }
  if (lookup.threadTs) {
    return crumbFor(core, senderInThread(core, lookup.channel, lookup.threadTs, lookup.at), null)
  }
  return null
}

/** The live chat a Slack thread was already sent to, when it was. */
export function routerBoundChat(core: PulseCore, conversationKey: string): string | null {
  const row = core.db
    .prepare('SELECT session_id FROM conversations WHERE key = ? AND session_id IS NOT NULL')
    .get(conversationKey)
  return row && typeof row.session_id === 'string' ? liveChatOf(core, row.session_id) : null
}

/** The live chats this Slack user's conversations were sent to, newest first. */
export function routerAuthorHistory(core: PulseCore, slackUserId: string): string[] {
  const rows = core.db
    .prepare(
      'SELECT c.session_id, MAX(c.last_at) AS at FROM conversations c JOIN conversation_messages m ' +
        "ON m.conversation_id = c.id WHERE m.direction = 'in' AND m.author_id = ? AND c.session_id IS NOT NULL " +
        'GROUP BY c.session_id ORDER BY at DESC LIMIT 20'
    )
    .all(slackUserId)
  const out: string[] = []
  for (const row of rows) {
    const live = liveChatOf(core, String(row.session_id))
    if (!out.includes(live)) {
      out.push(live)
    }
    if (out.length >= HISTORY_MAX) {
      break
    }
  }
  return out
}

export function pulseRouter(core: () => PulseCore) {
  return {
    crumb: (lookup: HqRouterCrumbLookup): HqRouterCrumb | null => routerCrumb(core(), lookup),
    boundChat: (key: string): string | null => routerBoundChat(core(), key),
    authorHistory: (slackUserId: string): string[] => routerAuthorHistory(core(), slackUserId),
    leadOf: (sessionId: string): string | null => leadOfChat(core(), sessionId),
    roleOf: (sessionId: string): string | null => roleOf(core(), sessionId),
    taskOf: (sessionId: string): string => taskOfChat(core(), sessionId),
    ownerTask: (sessionId: string): string => ownerTaskOf(core(), sessionId),
    binding: (input: Parameters<typeof routerBindingFor>[1]): RouterBinding | null =>
      routerBindingFor(core(), input),
    bindSent: (input: Parameters<typeof bindSentMessage>[1]): void =>
      bindSentMessage(core(), input),
    bindChoice: (input: Parameters<typeof bindChosenThread>[1]): void =>
      bindChosenThread(core(), input),
    logRoute: (entry: RouterLogEntry): void => logRoute(core(), entry),
    logChoice: (key: string, chosen: string, at: number): void => logChoice(core(), key, chosen, at)
  }
}
