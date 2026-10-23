// Custom build (hq-plus-ui): HQ+'s chats are the same live list the classic HQ shows — every open
// agent chat and terminal, so one started a second ago is there — not only the ones the journal knows.
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import { groupHqChats, hqChatRecentlyDone, type HqChatItem } from '../hq/hq-chat-list'

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
