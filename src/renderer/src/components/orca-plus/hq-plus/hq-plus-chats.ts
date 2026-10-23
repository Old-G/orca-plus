// Custom build (hq-plus-ui): HQ+'s chats are the same live list the classic HQ shows — every open
// agent chat and terminal, so one started a second ago is there — not only the ones the journal knows.
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import { useAppStore } from '@/store'
import type { HqPlusLiveChat } from '../../../../../shared/hq-plus-fold'
import { groupHqChats, hqChatRecentlyDone, type HqChatItem } from '../hq/hq-chat-list'
import { hqChatSessionId } from '../hq/hq-chat-cleanup'

export const HQ_PLUS_SIDE_CHATS = 10
// Why: a chat opened a moment ago has no turn yet, so the board calls it quiet; it is the newest work.
const JUST_OPENED_MS = 30 * 60_000

/** Needs you, just opened, working, then finished lately; other quiet ones fill what is left. */
export function hqPlusSideChats(
  items: readonly HqChatItem[],
  now: number,
  limit = HQ_PLUS_SIDE_CHATS
): HqChatItem[] {
  const groups = groupHqChats(items)
  const justOpened = groups.quiet.filter(
    (item) => item.card === null && now - item.sortAt < JUST_OPENED_MS
  )
  const recent = [...groups.done, ...groups.quiet].filter(
    (item) => item.group === 'done' || hqChatRecentlyDone(item, now)
  )
  const shown = [...groups.needs, ...justOpened, ...groups.working, ...recent]
  const rest = groups.quiet.filter((item) => !shown.includes(item))
  return [...shown, ...rest].slice(0, limit)
}

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
      (at < since &&
        item.group !== 'working' &&
        item.group !== 'needs' &&
        (activeAt ?? 0) < since)
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
