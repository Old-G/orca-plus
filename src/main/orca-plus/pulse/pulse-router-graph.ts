// Custom build (hq-router graph, plan router T1 variant b, owner 26.11): an answer goes to a task, not
// to a chat. A task is a chain of chats that carried one piece of work on (handoffs), named by its first
// chat; its Lead is above it. A one-off chat with no role that another chat started writes for that
// chat's task. Every message sent through Approve binds its Slack ts to the sending task, and the owner's
// choice on a router card binds the thread; the router reads these bindings first. `router_log` keeps
// what the router offered and what the owner chose — the week's evidence for sending by itself.
import { liveSessionOf } from './pulse-chat-chain'
import type { PulseCore } from './pulse-core'
import { approvalOfCall, type HqAgentSend } from './pulse-sent'

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
  chosen_at INTEGER,
  outcome TEXT,
  outcome_at INTEGER,
  reason TEXT,
  target_task TEXT,
  chosen_task TEXT,
  auto_class TEXT
);
CREATE TABLE IF NOT EXISTS router_card_routes (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  route TEXT,
  tries INTEGER NOT NULL DEFAULT 1
);
`

/** T0 (router v2): columns a router_log made before outcomes lacks; CREATE IF NOT EXISTS adds none. */
const ROUTER_LOG_OUTCOME_COLUMNS = [
  ['outcome', 'TEXT'],
  ['outcome_at', 'INTEGER'],
  ['reason', 'TEXT'],
  ['target_task', 'TEXT'],
  ['chosen_task', 'TEXT'],
  // Router v2 T4: the class of exact signal the route rested on; the auto gate counts by it.
  ['auto_class', 'TEXT']
] as const

export function ensureRouterLogColumns(db: {
  prepare: (sql: string) => { all: () => Record<string, unknown>[] }
  exec: (sql: string) => unknown
}): void {
  const have = new Set(
    db
      .prepare('PRAGMA table_info(router_log)')
      .all()
      .map((row) => row.name)
  )
  for (const [name, type] of ROUTER_LOG_OUTCOME_COLUMNS) {
    if (!have.has(name)) {
      db.exec(`ALTER TABLE router_log ADD COLUMN ${name} ${type}`)
    }
  }
}

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

/**
 * Custom build (router v2 T1): the work a sending chat writes for, and whether Orca+ knows it — false
 * for a one-off chat with no role and no parent (the owner started it), whose work the router suggests
 * on the Approve card instead.
 */
export function senderWorkOf(core: PulseCore, sessionId: string): { work: string; known: boolean } {
  const task = taskOfChat(core, sessionId)
  const work = ownerTaskOf(core, sessionId)
  if (work !== task || roleOf(core, task) || roleOf(core, sessionId)) {
    return { work, known: true }
  }
  // Why the chain counts: a chat that took a handoff carries on its predecessor's work.
  return { work, known: task !== sessionId }
}

/** Custom build (router v2 T1): the work the owner confirmed on this call's Approve card, if any. */
export function approvedWorkOf(core: PulseCore, call: HqAgentSend['call']): string | null {
  const approval = approvalOfCall(core, call)
  if (!approval) {
    return null
  }
  const row = core.db
    .prepare("SELECT json_extract(context, '$.workId') AS work FROM decisions WHERE id = ?")
    .get(approval.id)
  return row && typeof row.work === 'string' && row.work ? row.work : null
}

export type RouterBinding = {
  task: string
  /** The task's live chat now (its handoff successor). */
  chat: string
  source: 'approve' | 'choice'
}

/**
 * Our sent Slack message binds to its work: the one the owner confirmed on the Approve card (router v2
 * T1), else the task of the chat that sent it; the first binding stays.
 */
export function bindSentMessage(
  core: PulseCore,
  input: {
    channel: string
    ts: string
    threadTs: string | null
    sender: string
    at: number
    /** The work the Approve card bound it to. */
    work?: string | null
  }
): void {
  const task = input.work || ownerTaskOf(core, input.sender)
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
  /** Router v2 T4: the route's class, when it rested on one. */
  autoClass?: string | null
  /** Router v2 T4: a 👾's route replaces an earlier one of the same card (its mention card's) while
   *  the card is open, so its class and send are what the log counts. */
  replace?: boolean
}

const LOG_ROUTE_INSERT =
  'INTO router_log (key, at, how, target, top, auto, target_task, auto_class) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
const LOG_ROUTE_KEEP = `INSERT OR IGNORE ${LOG_ROUTE_INSERT}`
const LOG_ROUTE_REPLACE =
  `INSERT ${LOG_ROUTE_INSERT} ON CONFLICT(key) DO UPDATE SET how = excluded.how, target = excluded.target, ` +
  'top = excluded.top, auto = excluded.auto, target_task = excluded.target_task, ' +
  'auto_class = excluded.auto_class WHERE router_log.outcome IS NULL'

/** What the router offered for a card; a later route of the same card keeps the first. */
export function logRoute(core: PulseCore, entry: RouterLogEntry): void {
  core.db
    .prepare(entry.replace ? LOG_ROUTE_REPLACE : LOG_ROUTE_KEEP)
    .run(
      entry.key,
      entry.at,
      entry.how,
      entry.target,
      JSON.stringify(entry.top),
      entry.auto ? 1 : 0,
      taskOfTarget(core, entry.target),
      entry.autoClass ?? null
    )
}

/** The task a route's target chat carries; null for «new» or a target that is no chat. */
export function taskOfTarget(core: PulseCore, target: string): string | null {
  return target && target !== 'new' ? taskOfChat(core, target) : null
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
