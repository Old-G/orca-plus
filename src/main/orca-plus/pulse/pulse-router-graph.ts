// Custom build (hq-router graph, plan router T1 variant b, owner 26.11): an answer goes to a task, not
// to a chat. A task is a chain of chats that carried one piece of work on (handoffs), named by its first
// chat; its Lead is above it. A one-off chat with no role that another chat started writes for that
// chat's task. Every message sent through Approve binds its Slack ts to the sending task, and the owner's
// choice on a router card binds the thread; the router reads these bindings first. `router_log` keeps
// what the router offered and what the owner chose — the week's evidence for sending by itself.
import { liveSessionOf } from './pulse-chat-chain'
import type { PulseCore } from './pulse-core'

/** Why outside the versioned steps: added tables need no version bump (as chat_roles). */
export const ROUTER_TABLES = `
CREATE TABLE IF NOT EXISTS router_bindings (
  channel TEXT NOT NULL,
  ts TEXT NOT NULL,
  thread_ts TEXT,
  task TEXT NOT NULL,
  chat TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('approve', 'choice')),
  at INTEGER NOT NULL,
  PRIMARY KEY (channel, ts)
);
CREATE INDEX IF NOT EXISTS router_bindings_by_thread ON router_bindings(channel, thread_ts, at);
CREATE TABLE IF NOT EXISTS router_log (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  how TEXT NOT NULL,
  target TEXT NOT NULL,
  top TEXT NOT NULL,
  auto INTEGER NOT NULL,
  chosen TEXT,
  chosen_at INTEGER
);
CREATE TABLE IF NOT EXISTS router_card_routes (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  route TEXT,
  tries INTEGER NOT NULL DEFAULT 1
);
`

const MAX_HOPS = 32
const LEADS = new Set(['lead', 'sublead'])

function roleOf(core: PulseCore, sessionId: string): string | null {
  const row = core.db.prepare('SELECT role FROM chat_roles WHERE session_id = ?').get(sessionId)
  return row ? String(row.role) : null
}

/** A Lead launched by a Lead of the same role took the work over: the older one's successor. */
function leadBefore(core: PulseCore, sessionId: string): string | null {
  const role = roleOf(core, sessionId)
  if (!role || !LEADS.has(role)) {
    return null
  }
  const row = core.db
    .prepare("SELECT parent_session_id FROM chat_links WHERE session_id = ? AND via = 'launch'")
    .get(sessionId)
  const parent = row ? String(row.parent_session_id) : null
  return parent && roleOf(core, parent) === role ? parent : null
}

/**
 * The chat carrying a task on now: handoffs forward, and a Lead's same-role Lead it launched
 * (the newest), until neither moves.
 */
export function liveChatOf(core: PulseCore, sessionId: string): string {
  let current = liveSessionOf(core, sessionId)
  const role = roleOf(core, current)
  for (let hop = 0; hop < MAX_HOPS && role && LEADS.has(role); hop += 1) {
    const next = core.db
      .prepare(
        "SELECT l.session_id FROM chat_links l JOIN chat_roles r ON r.session_id = l.session_id WHERE l.parent_session_id = ? AND l.via = 'launch' AND r.role = ? ORDER BY l.at DESC LIMIT 1"
      )
      .get(current, role)
    if (!next || String(next.session_id) === current) {
      break
    }
    current = liveSessionOf(core, String(next.session_id))
  }
  return current
}

/** The chats this one continued (handoffs), back to the first — the task's name. */
export function chainBack(core: PulseCore, sessionId: string): string[] {
  const out = [sessionId]
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const current = out.at(-1) as string
    const row = core.db
      .prepare(
        "SELECT ref_id AS prev FROM journal WHERE kind = 'session.handoff' AND session_id = ? AND ref_id IS NOT NULL " +
          'UNION SELECT parent_session_id AS prev FROM sessions WHERE session_id = ? AND parent_session_id IS NOT NULL'
      )
      .get(current, current)
    const prev = row ? String(row.prev) : leadBefore(core, current)
    if (!prev || out.includes(prev)) {
      break
    }
    out.push(prev)
  }
  return out
}

/** The task a chat works on: the first chat of its handoff chain. */
export function taskOfChat(core: PulseCore, sessionId: string): string {
  return chainBack(core, sessionId).at(-1) as string
}

/**
 * The task a chat writes for. A chat with no role that another chat started (an «ask HQ», a «send this
 * as is») writes for its parent's task; any other chat — or one with no parent — for its own.
 */
export function ownerTaskOf(core: PulseCore, sessionId: string): string {
  const task = taskOfChat(core, sessionId)
  if (roleOf(core, task) || roleOf(core, sessionId)) {
    return task
  }
  const parent = core.db
    .prepare('SELECT parent_session_id FROM chat_links WHERE session_id = ?')
    .get(task)
  return parent ? taskOfChat(core, String(parent.parent_session_id)) : task
}

export type RouterBinding = {
  task: string
  /** The task's live chat now (its handoff successor). */
  chat: string
  source: 'approve' | 'choice'
}

/** Our sent Slack message binds to the task of the chat that sent it; the first binding stays. */
export function bindSentMessage(
  core: PulseCore,
  input: { channel: string; ts: string; threadTs: string | null; sender: string; at: number }
): void {
  const task = ownerTaskOf(core, input.sender)
  core.db
    .prepare(
      'INSERT OR IGNORE INTO router_bindings (channel, ts, thread_ts, task, chat, source, at) ' +
        "VALUES (?, ?, ?, ?, ?, 'approve', ?)"
    )
    .run(input.channel, input.ts, input.threadTs ?? input.ts, task, input.sender, input.at)
}

/** The owner's choice on a router card binds the thread (by its root) to the chosen chat's task. */
export function bindChosenThread(
  core: PulseCore,
  input: { channel: string; threadTs: string; chat: string; at: number }
): void {
  core.db
    .prepare(
      'INSERT OR REPLACE INTO router_bindings (channel, ts, thread_ts, task, chat, source, at) ' +
        "VALUES (?, ?, ?, ?, ?, 'choice', ?)"
    )
    .run(
      input.channel,
      `choice:${input.threadTs}`,
      input.threadTs,
      taskOfChat(core, input.chat),
      input.chat,
      input.at
    )
}

function toBinding(
  core: PulseCore,
  row: Record<string, unknown> | undefined
): RouterBinding | null {
  if (!row) {
    return null
  }
  const task = String(row.task)
  return {
    task,
    chat: liveChatOf(core, task),
    source: row.source === 'choice' ? 'choice' : 'approve'
  }
}

/**
 * The binding a message falls under: the owner's choice for its thread first, then the message of ours
 * it links, then our latest message in the thread before it (the root counts: its ts is the thread's).
 */
export function routerBindingFor(
  core: PulseCore,
  input: {
    channel: string
    threadTs: string | null
    linked: { channel: string; ts: string } | null
    at: number
  }
): RouterBinding | null {
  if (input.threadTs) {
    const chosen = core.db
      .prepare(
        "SELECT task, source FROM router_bindings WHERE channel = ? AND ts = ? AND source = 'choice'"
      )
      .get(input.channel, `choice:${input.threadTs}`)
    if (chosen) {
      return toBinding(core, chosen)
    }
  }
  if (input.linked) {
    const linked = core.db
      .prepare('SELECT task, source FROM router_bindings WHERE channel = ? AND ts = ?')
      .get(input.linked.channel, input.linked.ts)
    if (linked) {
      return toBinding(core, linked)
    }
  }
  if (!input.threadTs) {
    return null
  }
  return toBinding(
    core,
    core.db
      .prepare(
        "SELECT task, source FROM router_bindings WHERE channel = ? AND thread_ts = ? AND source = 'approve' " +
          'AND at <= ? ORDER BY at DESC LIMIT 1'
      )
      .get(input.channel, input.threadTs, input.at)
  )
}

export type RouterLogEntry = {
  key: string
  at: number
  how: string
  target: string
  /** The card's first three, best first. */
  top: readonly string[]
  auto: boolean
}

/** What the router offered for a card; a later route of the same card keeps the first. */
export function logRoute(core: PulseCore, entry: RouterLogEntry): void {
  core.db
    .prepare(
      'INSERT OR IGNORE INTO router_log (key, at, how, target, top, auto) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      entry.key,
      entry.at,
      entry.how,
      entry.target,
      JSON.stringify(entry.top),
      entry.auto ? 1 : 0
    )
}

/** Where the owner sent the card in the end. */
export function logChoice(core: PulseCore, key: string, chosen: string, at: number): void {
  core.db
    .prepare('UPDATE router_log SET chosen = ?, chosen_at = ? WHERE key = ? AND chosen IS NULL')
    .run(chosen, at, key)
}

export type RouterCardRoute = { at: number; route: unknown; tries: number }

/** Custom build (hq-router T7): what the router said about a To work card, kept by the card's key so
 *  the card is routed once — a poll, a restart or a rebuilt card reads it back. `route` is null when
 *  the router found nothing (the card is tried again later, up to a few times). */
export function cardRouteOf(core: PulseCore, key: string): RouterCardRoute | null {
  const row = core.db
    .prepare('SELECT at, route, tries FROM router_card_routes WHERE key = ?')
    .get(key)
  if (!row) {
    return null
  }
  let route: unknown = null
  try {
    route = typeof row.route === 'string' ? JSON.parse(row.route) : null
  } catch {
    route = null
  }
  return { at: Number(row.at), route, tries: Number(row.tries) }
}

export function saveCardRoute(core: PulseCore, key: string, route: unknown, at: number): void {
  core.db
    .prepare(
      'INSERT INTO router_card_routes (key, at, route, tries) VALUES (?, ?, ?, 1) ' +
        'ON CONFLICT(key) DO UPDATE SET at = excluded.at, route = excluded.route, tries = tries + 1'
    )
    .run(key, at, route ? JSON.stringify(route) : null)
}
