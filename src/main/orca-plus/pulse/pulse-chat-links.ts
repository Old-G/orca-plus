// Custom build (hq-plus-chat-tree, owner 04.11): which chat started or handed work to which. One parent
// per chat, the first fact wins; a link that would close a loop — the parent already under the child,
// or the two being one chat across a handoff — is not written.
import type {
  HqChatContinuation,
  HqChatLink,
  HqChatLinksResult,
  HqChatLinkVia
} from '../../../shared/hq-chat-links'
import { liveSessionOf } from './pulse-chat-chain'
import type { PulseCore } from './pulse-core'

const MAX_HOPS = 64
const MAX_ROWS = 2000

/** The sessions above `sessionId`: who started it and which chat it continues, all the way up. */
function ancestorsOf(core: PulseCore, sessionId: string): Set<string> {
  const seen = new Set<string>()
  const queue = [sessionId]
  for (let hop = 0; hop < MAX_HOPS && queue.length > 0; hop += 1) {
    const current = queue.shift() as string
    const rows = core.db
      .prepare(
        `SELECT parent_session_id AS up FROM chat_links WHERE session_id = ?
         UNION
         SELECT parent_session_id AS up FROM sessions
           WHERE session_id = ? AND parent_session_id IS NOT NULL`
      )
      .all(current, current)
    for (const row of rows) {
      const up = String(row.up)
      if (!seen.has(up)) {
        seen.add(up)
        queue.push(up)
      }
    }
  }
  return seen
}

/** Records that `parentSessionId` started or handed work to `sessionId`; false when nothing was written. */
export function linkChat(
  core: PulseCore,
  input: { sessionId: string; parentSessionId: string; via: HqChatLinkVia; at: number }
): boolean {
  const { sessionId, parentSessionId } = input
  if (!sessionId || !parentSessionId || sessionId === parentSessionId) {
    return false
  }
  if (
    ancestorsOf(core, parentSessionId).has(sessionId) ||
    ancestorsOf(core, sessionId).has(parentSessionId)
  ) {
    return false
  }
  const result = core.db
    .prepare(
      'INSERT INTO chat_links (session_id, parent_session_id, via, at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(session_id) DO NOTHING'
    )
    .run(sessionId, parentSessionId, input.via, input.at)
  return result.changes > 0
}

/** Every link and handoff step, newest first; the open chats they join can be weeks old. */
export function listChatLinks(core: PulseCore): HqChatLinksResult {
  const links: HqChatLink[] = core.db
    .prepare(
      'SELECT session_id, parent_session_id, via, at FROM chat_links ORDER BY at DESC LIMIT ?'
    )
    .all(MAX_ROWS)
    .map((row) => ({
      sessionId: String(row.session_id),
      parentSessionId: String(row.parent_session_id),
      via: row.via === 'send' ? 'send' : 'launch',
      at: Number(row.at)
    }))
  const continues: HqChatContinuation[] = core.db
    .prepare(
      'SELECT session_id, parent_session_id FROM sessions WHERE parent_session_id IS NOT NULL ' +
        'ORDER BY last_activity_at DESC LIMIT ?'
    )
    .all(MAX_ROWS)
    .map((row) => ({
      sessionId: String(row.session_id),
      fromSessionId: String(row.parent_session_id)
    }))
  return { links: [...links, ...sentBefore(core, links)], continues }
}

// Why: the journal's `orca chat send` rows name the sending chat's thread in their title — written by
// hq-journal-send as «From <project>/<task>: …» — so chats that handed work before links were written
// still hang under the chat that sent it (owner 05.11: the tree was empty).
const SENT_FROM = /^From ([^\s/:]+\/[^\s:]+): /

function sentBefore(core: PulseCore, known: readonly HqChatLink[]): HqChatLink[] {
  const parentOf = new Map(known.map((link) => [link.sessionId, link.parentSessionId]))
  // Why: an answer sent back up to the parent is no new link; the first fact wins, no loops.
  const above = (from: string, target: string): boolean => {
    let current: string | undefined = from
    for (let hop = 0; current && hop < MAX_HOPS; hop += 1) {
      if (current === target) {
        return true
      }
      current = parentOf.get(current)
    }
    return false
  }
  const rows = core.db
    .prepare(
      `SELECT j.session_id AS child, j.title AS title, j.at AS at FROM journal j
         WHERE j.source = 'chat-send' AND j.session_id IS NOT NULL ORDER BY j.at ASC LIMIT ?`
    )
    .all(MAX_ROWS)
  const out: HqChatLink[] = []
  for (const row of rows) {
    const child = String(row.child)
    const address = SENT_FROM.exec(String(row.title))?.[1]
    if (!address || parentOf.has(child)) {
      continue
    }
    // Why: the chat working on that thread when it sent — the latest one opened by then.
    const sender = core.db
      .prepare(
        'SELECT session_id FROM sessions WHERE address = ? AND opened_at <= ? ' +
          'ORDER BY opened_at DESC LIMIT 1'
      )
      .get(address, Number(row.at))
    const parent = sender ? String(sender.session_id) : null
    if (!parent || above(parent, child)) {
      continue
    }
    parentOf.set(child, parent)
    out.push({ sessionId: child, parentSessionId: parent, via: 'send', at: Number(row.at) })
  }
  return out
}

/** The chats' links in one place: where a handed-off chat went on, and which chat started which. */
export function pulseChats(core: () => PulseCore) {
  return {
    liveSessionOf: (sessionId: string): string => liveSessionOf(core(), sessionId),
    link: (input: Parameters<typeof linkChat>[1]): boolean => linkChat(core(), input),
    list: (): HqChatLinksResult => listChatLinks(core())
  }
}
