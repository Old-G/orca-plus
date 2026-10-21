// Custom build (hq-marked-chats): chats the owner marked in HQ to come back to — they gather in
// their own section at the top until he takes the mark off.
import type { HqChatGroup, HqChatItem } from './hq-chat-list'

/** Marked chats leave their groups for the section on top, newest first; one that needs the user
 *  stays in Needs you, where it can be answered and the next-waiting shortcut finds it. */
export function splitHqMarkedChats(
  groups: Record<HqChatGroup, HqChatItem[]>,
  markedKeys: readonly string[]
): { marked: HqChatItem[]; groups: Record<HqChatGroup, HqChatItem[]> } {
  if (markedKeys.length === 0) {
    return { marked: [], groups }
  }
  const keys = new Set(markedKeys)
  const isMarked = (item: HqChatItem) => keys.has(item.key)
  const rest = (items: HqChatItem[]) => items.filter((item) => !isMarked(item))
  return {
    marked: [...groups.working, ...groups.done, ...groups.quiet]
      .filter(isMarked)
      .sort((a, b) => b.sortAt - a.sortAt),
    groups: {
      needs: groups.needs,
      working: rest(groups.working),
      done: rest(groups.done),
      quiet: rest(groups.quiet)
    }
  }
}
