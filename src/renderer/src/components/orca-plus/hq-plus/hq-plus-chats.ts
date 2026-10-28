// Custom build (hq-plus-ui): HQ+'s chats are the same live list the classic HQ shows — every open
// agent chat and terminal, so one started a second ago is there — not only the ones the journal knows.
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import { useAppStore } from '@/store'
import type { HqPlusLiveChat } from '../../../../../shared/hq-plus-fold'
import { groupHqChats, type HqChatItem } from '../hq/hq-chat-list'
import { splitHqActiveProjects } from '../hq/hq-active-projects'
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
  if (item.kind === 'chat') {
    useAppStore.getState().closeUnifiedTab(item.tab.id, { preserveWorktreeSelection: true })
  }
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
 * Custom build (hq-plus-chats-by-project): the left column's chats as the classic HQ's Active projects
 * (owner, 25.10) — each project with what needs him, works or is unread, then its recent read chats;
 * marked chats above, every other quiet chat folded. A project that waits on him comes first.
 */
export function hqPlusProjectChats(
  items: readonly HqChatItem[],
  keptRepoIds: readonly string[],
  markedKeys: readonly string[],
  now: number
): { marked: HqChatItem[]; projects: HqPlusProjectChats[]; quiet: HqChatItem[] } {
  const { marked, groups } = splitHqMarkedChats(groupHqChats(items), markedKeys)
  const split = splitHqActiveProjects(items, keptRepoIds, now, new Set(markedKeys))
  const byRepo = new Map<string, HqPlusProjectChats>(
    split.active.map((project) => [project.repoId, { ...project, items: [...project.items] }])
  )
  for (const item of [...groups.needs, ...groups.working, ...groups.done]) {
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
  return { marked, projects, quiet: split.quiet.filter((item) => !markedKeys.includes(item.key)) }
}
