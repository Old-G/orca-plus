// Custom build (hq-chats): the projects the owner works in now keep their latest chats on view in
// HQ after they are read, instead of sinking into Quiet with every older chat.
import type { HqChatItem } from './hq-chat-list'

export const HQ_ACTIVE_PROJECT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000
/** Why: the owner returns to a project within the day; anything worked in this recently stays, past the limit. */
export const HQ_ACTIVE_PROJECT_STAY_MS = 12 * 60 * 60 * 1000
export const HQ_ACTIVE_PROJECT_LIMIT = 4
export const HQ_ACTIVE_PROJECT_CHATS = 5

export type HqActiveProject = {
  repoId: string
  projectName: string
  /** Kept by the owner, so it stays even after it goes quiet. */
  kept: boolean
  /** Its quiet chats, newest first, at most HQ_ACTIVE_PROJECT_CHATS. */
  items: HqChatItem[]
}

/** Projects with work in the last 12 hours (all of them), up to a few more from the last days, plus the
 *  kept ones, each with its latest
 *  quiet chats; `quiet` is what stays folded away. Chats that need the user, work or are unread
 *  keep their own groups above. */
export function splitHqActiveProjects(
  items: readonly HqChatItem[],
  keptRepoIds: readonly string[],
  now: number
): { active: HqActiveProject[]; quiet: HqChatItem[] } {
  const lastActivity = new Map<string, number>()
  const names = new Map<string, string>()
  for (const item of items) {
    lastActivity.set(item.repoId, Math.max(lastActivity.get(item.repoId) ?? 0, item.sortAt))
    names.set(item.repoId, item.projectName)
  }
  const kept = new Set(keptRepoIds.filter((repoId) => names.has(repoId)))
  const recent = [...lastActivity]
    .filter(([repoId, at]) => !kept.has(repoId) && at >= now - HQ_ACTIVE_PROJECT_WINDOW_MS)
    .sort((a, b) => b[1] - a[1])
    .filter(
      ([, at], index) => index < HQ_ACTIVE_PROJECT_LIMIT || at >= now - HQ_ACTIVE_PROJECT_STAY_MS
    )
    .map(([repoId]) => repoId)
  const order = [...kept, ...recent].sort(
    (a, b) => (lastActivity.get(b) ?? 0) - (lastActivity.get(a) ?? 0)
  )
  const shown = new Set<string>()
  const active: HqActiveProject[] = []
  for (const repoId of order) {
    const chats = items
      .filter((item) => item.repoId === repoId && item.group === 'quiet')
      .sort((a, b) => b.sortAt - a.sortAt)
      .slice(0, HQ_ACTIVE_PROJECT_CHATS)
    if (chats.length === 0) {
      continue
    }
    for (const chat of chats) {
      shown.add(chat.key)
    }
    active.push({
      repoId,
      projectName: names.get(repoId) ?? repoId,
      kept: kept.has(repoId),
      items: chats
    })
  }
  return {
    active,
    quiet: items.filter((item) => item.group === 'quiet' && !shown.has(item.key))
  }
}
