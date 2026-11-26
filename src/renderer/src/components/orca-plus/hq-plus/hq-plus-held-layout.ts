// Custom build (hq-close-steady, owner 26.11): closing a chat with its ✕ takes only that chat out of the
// left column. Everything else stays where it was shown: a lead that lost its last open chat does not
// drop out of the «By work» tree to its project, workers of a closed lead do not jump to other rows, and
// a chat that went quiet since does not hop to Quiet — until the pointer leaves the column.
import type { HqChatItem } from '../hq/hq-chat-list'
import type { HqPlusProjectChats } from './hq-plus-chats'
import type { HqPlusTreeRow } from './hq-plus-chat-tree'

export type HqPlusSideChats = {
  marked: HqChatItem[]
  projects: HqPlusProjectChats[]
  quiet: HqChatItem[]
}

/** What the column showed: the chats by place, and the «By work» rows. */
export type HqPlusSideLayout = { chats: HqPlusSideChats; tree: HqPlusTreeRow[] }

function keysOf(chats: HqPlusSideChats): Set<string> {
  return new Set([
    ...chats.marked.map((item) => item.key),
    ...chats.projects.flatMap((project) => project.items.map((item) => item.key)),
    ...chats.quiet.map((item) => item.key)
  ])
}

/** Rows of a tree after some chats left: a row whose parent left stands on its own level up. */
function closeTreeRows(
  rows: readonly HqPlusTreeRow[],
  current: ReadonlyMap<string, HqChatItem>
): HqPlusTreeRow[] {
  // Why a stack: ancestors[d] says whether the nearest row above at depth d is still open.
  const ancestors: boolean[] = []
  const kept: HqPlusTreeRow[] = []
  for (const row of rows) {
    const item = current.get(row.item.key)
    // Why not for an older chat of a line: the chats under the line hang from its first row.
    if (!row.earlier) {
      ancestors.length = row.depth
      ancestors.push(item !== undefined)
    }
    if (!item) {
      continue
    }
    const depth = ancestors.slice(0, row.depth).filter(Boolean).length
    kept.push({
      ...row,
      item,
      depth,
      children: 0,
      startedBy: depth === 0 && row.depth > 0 ? null : row.startedBy
    })
  }
  // An older chat of a line is not a child: only the rows one level down count.
  kept.forEach((row, index) => {
    if (row.earlier) {
      return
    }
    for (let next = index + 1; next < kept.length && kept[next].depth > row.depth; next += 1) {
      if (kept[next].depth === row.depth + 1 && !kept[next].earlier) {
        row.children += 1
      }
    }
  })
  return kept
}

/**
 * The column as it was shown, minus the chats now gone, each chat in the place it had. Rows are the
 * current ones (their state is live); only the places are held. A chat the held layout never showed
 * (a new one) ends the hold: null, and the column shows its current layout.
 */
export function holdSideLayout(
  held: HqPlusSideLayout,
  current: HqPlusSideLayout
): HqPlusSideLayout | null {
  const byKey = new Map<string, HqChatItem>()
  const currentChats = [
    ...current.chats.marked,
    ...current.chats.projects.flatMap((project) => project.items),
    ...current.chats.quiet
  ]
  currentChats.forEach((item) => byKey.set(item.key, item))
  const heldKeys = keysOf(held.chats)
  if (currentChats.some((item) => !heldKeys.has(item.key))) {
    return null
  }
  const live = (items: readonly HqChatItem[]): HqChatItem[] =>
    items.flatMap((item) => byKey.get(item.key) ?? [])
  const keptOf = new Map(current.chats.projects.map((project) => [project.repoId, project.kept]))
  return {
    chats: {
      marked: live(held.chats.marked),
      projects: held.chats.projects
        .map((project) => ({
          ...project,
          kept: keptOf.get(project.repoId) ?? project.kept,
          items: live(project.items)
        }))
        .filter((project) => project.items.length > 0 || project.kept),
      quiet: live(held.chats.quiet)
    },
    tree: closeTreeRows(held.tree, byKey)
  }
}
