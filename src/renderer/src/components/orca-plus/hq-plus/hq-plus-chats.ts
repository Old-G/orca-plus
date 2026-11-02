// Custom build (hq-plus-ui): HQ+'s chats are the same live list the classic HQ shows — every open
// agent chat and terminal, so one started a second ago is there — not only the ones the journal knows.
import { structuredAgentSessionTabId } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import { useAppStore } from '@/store'
import type { HqPlusLiveChat } from '../../../../../shared/hq-plus-fold'
import { groupHqChats, type HqChatItem } from '../hq/hq-chat-list'
import { splitHqMarkedChats } from '../hq/hq-marked-chats'
import { hqChatSessionId } from '../hq/hq-chat-cleanup'

// Why: a chat opened a moment ago has no turn yet, so the board calls it quiet; it is the newest work.
const JUST_OPENED_MS = 30 * 60_000

/** The listed chat a native session runs in; null while its tab is closed or not there yet. */
export function hqPlusChatOfSession(
  items: readonly HqChatItem[],
  sessionId: string | null
): HqChatItem | null {
  if (!sessionId) {
    return null
  }
  const tabId = structuredAgentSessionTabId(sessionId)
  return items.find((item) => item.kind === 'chat' && item.tab.id === tabId) ?? null
}

/** Custom build (hq-plus-ui-v3): finished, read and not just opened — folded under «Idle» on the left. */
export function hqPlusChatIsIdle(item: HqChatItem, now: number): boolean {
  return item.group === 'quiet' && !(item.card === null && now - item.sortAt < JUST_OPENED_MS)
}

/**
 * Custom build (hq-plus-ui-v5): when a chat last started working or finished, so its feed card moves
 * to the bottom before the journal writes the turn. Null for a read, quiet chat.
 */
function hqPlusChatActiveAt(item: HqChatItem): number | null {
  if (!item.card || item.group === 'quiet') {
    return null
  }
  return Math.max(item.card.stateChangedAt, item.card.finishedAt ?? 0) || null
}

/**
 * Custom build (hq-plus-ui-v3): the open chats the feed shows before the journal knows them — today's,
 * and older ones only while they work or wait on the owner. `place` gives a project's room.
 */
export function hqPlusLiveChats(
  items: readonly HqChatItem[],
  since: number,
  place: (project: string) => string
): HqPlusLiveChat[] {
  return items.flatMap((item) => {
    if (item.kind !== 'chat') {
      return []
    }
    const sessionId = hqChatSessionId(item.tab.id)
    const at = item.tab.createdAt
    const activeAt = hqPlusChatActiveAt(item)
    if (
      !sessionId ||
      (at < since && item.group !== 'working' && item.group !== 'needs' && (activeAt ?? 0) < since)
    ) {
      return []
    }
    return [
      {
        sessionId,
        project: item.projectName,
        room: place(item.projectName),
        title: item.tab.label || item.projectName,
        at,
        activeAt
      }
    ]
  })
}

/** Closes a chat's tab the way the classic HQ's cleanup does; it stays in History to reopen. */
export function closeHqPlusChat(item: HqChatItem): void {
  const state = useAppStore.getState()
  if (item.kind === 'chat') {
    state.closeUnifiedTab(item.tab.id, { preserveWorktreeSelection: true })
    return
  }
  // Custom build (hq-plus-close-terminal): a terminal agent's × closes its terminal tab (owner, 01.11).
  // Why both ids: a dashboard card names the tab by its unified id or by the terminal's entity id.
  const { tabId, worktreeId } = item.card
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const tab =
    tabs.find((entry) => entry.id === tabId) ??
    tabs.find((entry) => entry.contentType === 'terminal' && entry.entityId === tabId)
  if (tab) {
    state.closeUnifiedTab(tab.id, { preserveWorktreeSelection: true })
  } else {
    state.closeTab(tabId)
  }
}

/** Custom build (hq-plus-close-terminal): the other agents a terminal's × would close with it —
 *  split panes of one terminal tab share it. */
export function hqPlusTerminalTabMates(items: readonly HqChatItem[], item: HqChatItem): number {
  if (item.kind !== 'terminal') {
    return 0
  }
  return items.filter(
    (other) =>
      other.kind === 'terminal' &&
      other.key !== item.key &&
      other.card.worktreeId === item.card.worktreeId &&
      other.card.tabId === item.card.tabId
  ).length
}

export type HqPlusProjectChats = {
  repoId: string
  projectName: string
  /** Kept by the owner, so it stays even when it has gone quiet. */
  kept: boolean
  items: HqChatItem[]
}

const GROUP_ORDER = { needs: 0, working: 1, done: 2, quiet: 3 } as const

/**
 * Custom build (hq-plus-chats-by-project): the left column's chats by project — what needs the owner,
 * works or is unread first, then the rest by time; marked chats above. Custom build
 * (hq-plus-all-open-chats, owner 02.11): every open chat stays under its project however quiet or old —
 * no time window, no cap, no Quiet fold; the owner closes chats himself. A project that waits on him
 * comes first.
 */
export function hqPlusProjectChats(
  items: readonly HqChatItem[],
  keptRepoIds: readonly string[],
  markedKeys: readonly string[],
  // Why kept: the screen still passes the time the active window used; the list no longer needs it.
  _now?: number
): { marked: HqChatItem[]; projects: HqPlusProjectChats[]; quiet: HqChatItem[] } {
  const { marked, groups } = splitHqMarkedChats(groupHqChats(items), markedKeys)
  const byRepo = new Map<string, HqPlusProjectChats>()
  for (const item of [...groups.needs, ...groups.working, ...groups.done, ...groups.quiet]) {
    const project = byRepo.get(item.repoId) ?? {
      repoId: item.repoId,
      projectName: item.projectName,
      kept: keptRepoIds.includes(item.repoId),
      items: []
    }
    project.items.push(item)
    byRepo.set(item.repoId, project)
  }
  const rank = (project: HqPlusProjectChats): number =>
    Math.min(...project.items.map((item) => GROUP_ORDER[item.group]), GROUP_ORDER.quiet)
  const latest = (project: HqPlusProjectChats): number =>
    Math.max(0, ...project.items.map((item) => item.sortAt))
  const projects = [...byRepo.values()]
    .map((project) => ({
      ...project,
      items: project.items.sort(
        (a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || b.sortAt - a.sortAt
      )
    }))
    .sort((a, b) => rank(a) - rank(b) || latest(b) - latest(a))
  return { marked, projects, quiet: [] }
}

const KEEP_OPEN = /(?:не\s+закрывай|don['’]?t\s+close)/i

/**
 * Custom build (hq-plus-chat-waiting, owner 02.11): what a chat said it waits for at the end of its last
 * turn — «Не закрывай: жду ответа от Ann» — so its row says «waiting» and the owner keeps it open to
 * bring the answer back. Null when its last words do not ask to stay open.
 */
export function hqPlusChatWaitingFor(text: string | null | undefined): string | null {
  const lines = (text ?? '')
    .split('\n')
    .map((line) => line.replace(/[*_`]/g, '').trim())
    .filter(Boolean)
  const said = lines
    .slice(-3)
    .toReversed()
    .find((line) => KEEP_OPEN.test(line))
  if (!said) {
    return null
  }
  const what = said
    .slice((said.search(KEEP_OPEN) ?? 0) + (KEEP_OPEN.exec(said)?.[0].length ?? 0))
    .replace(/^\s*[:,—–-]\s*/, '')
    .replace(/[.!]\s*$/, '')
    .trim()
  return what || 'waiting'
}

/**
 * Custom build (hq-plus-waiting-after-read, owner 02.11): a finished chat the owner has not opened yet
 * says «done» even when its last words wait on someone; it turns «waiting» once he has read it — opened
 * in HQ+, or on screen in a focused Orca window, which is what marks a chat read.
 */
export function hqPlusChatWaitingLabel(
  item: HqChatItem,
  text: string | null | undefined
): string | null {
  return item.group === 'quiet' ? hqPlusChatWaitingFor(text) : null
}
