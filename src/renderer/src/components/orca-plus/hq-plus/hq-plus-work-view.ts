// Custom build (hq-plus-work-view, owner 06.11): HQ+'s «Work» view — the «By work» tree on the whole
// screen. On top, the tree's chats that wait on the owner; below, one block per lead (a chat that
// started others) with its chats in tree order; at the bottom, the work's chats closed today. Built from
// the same tree as «By work», so its links are the recorded facts, never names.
import type { HqChatLinksResult } from '../../../../../shared/hq-chat-links'
import type { HqLiveSession } from '../../../../../shared/hq-sessions'
import type { HqChatItem } from '../hq/hq-chat-list'
import type { HqPlusTreeRow } from './hq-plus-chat-tree'

export type HqPlusWorkRun = {
  key: string
  /** The chat on view that started the rest; null when the lead is closed (or in another room). */
  lead: HqChatItem | null
  /** That lead's session, for its name, when it is not on view; null when `lead` is set. */
  leadSession: string | null
  /** The lead's row first when it is open, then its chats in tree order. */
  rows: HqPlusTreeRow[]
  counts: { chats: number; projects: number; working: number; needsYou: number }
}

export type HqPlusWorkModel = {
  /** The tree's chats that wait on the owner, in the blocks' order. */
  needsYou: HqChatItem[]
  runs: HqPlusWorkRun[]
  /** Chats of the work (a recorded link names them) closed since `since`, newest first. */
  closedToday: HqLiveSession[]
}

function countsOf(rows: readonly HqPlusTreeRow[]): HqPlusWorkRun['counts'] {
  return {
    chats: rows.length,
    projects: new Set(rows.map((row) => row.item.repoId)).size,
    working: rows.filter((row) => row.item.group === 'working').length,
    needsYou: rows.filter((row) => row.item.group === 'needs').length
  }
}

export function hqPlusWorkView({
  tree,
  links,
  sessions,
  since
}: {
  /** `hqPlusChatTree` of the chats on view. */
  tree: readonly HqPlusTreeRow[]
  links: HqChatLinksResult | null
  /** The dispatcher's sessions, closed ones included; only those for the closed list. */
  sessions: readonly HqLiveSession[]
  since: number
}): HqPlusWorkModel {
  const runs: HqPlusWorkRun[] = []
  // Why: chats a closed lead started hang from no chat on view; they gather under that lead's name.
  const closedRuns = new Map<string, HqPlusWorkRun>()
  let current: HqPlusWorkRun | null = null
  for (const row of tree) {
    if (row.depth > 0 || row.earlier) {
      current?.rows.push(row)
      continue
    }
    if (row.children > 0 || !row.startedBy) {
      current = {
        key: row.item.key,
        lead: row.item,
        leadSession: null,
        rows: [row],
        counts: countsOf([])
      }
      runs.push(current)
      continue
    }
    const known = closedRuns.get(row.startedBy)
    if (known) {
      current = known
    } else {
      current = {
        key: `closed:${row.startedBy}`,
        lead: null,
        leadSession: row.startedBy,
        rows: [],
        counts: countsOf([])
      }
      closedRuns.set(row.startedBy, current)
      runs.push(current)
    }
    current.rows.push(row)
  }
  for (const run of runs) {
    run.counts = countsOf(run.rows)
  }
  const onView = new Set(
    tree.flatMap((row) => (row.item.kind === 'chat' ? [row.item.tab.entityId] : []))
  )
  const linked = new Set(
    (links?.links ?? []).flatMap((link) => [link.sessionId, link.parentSessionId])
  )
  return {
    needsYou: runs.flatMap((run) =>
      run.rows.filter((row) => row.item.group === 'needs').map((row) => row.item)
    ),
    runs,
    closedToday: sessions
      .filter(
        (session) =>
          !session.tabOpen &&
          !onView.has(session.sessionId) &&
          linked.has(session.sessionId) &&
          session.lastActivityAt >= since
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }
}

/** The first line of a reply, without its markdown marks; null when it has no words. */
export function hqPlusFirstLine(text: string | null | undefined): string | null {
  for (const raw of (text ?? '').split('\n')) {
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, '')
      .replace(/\*\*|__|`/g, '')
      .trim()
    if (line) {
      return line
    }
  }
  return null
}

/** The merge request a reply names — `!41`, a GitLab `merge_requests/41` or a GitHub `pull/41` link. */
export function hqPlusMrOf(text: string | null | undefined): string | null {
  if (!text) {
    return null
  }
  const link = /\/merge_requests\/(\d+)|\/pull\/(\d+)/.exec(text)
  if (link) {
    return link[1] ? `!${link[1]}` : `#${link[2]}`
  }
  const bang = /(?:^|[\s(«"'[])!(\d+)\b/.exec(text)
  return bang ? `!${bang[1]}` : null
}
