// Custom build (hq-plus-ui-v3): HQ+'s feed shows one row per chat.
import type { HqPlusLogItem } from './hq-plus-log'

function chatFoldKey(item: HqPlusLogItem): string | null {
  return item.kind === 'line' && item.tone === 'agent' ? (item.sessionId ?? item.address) : null
}

/**
 * Custom build (hq-plus-ui-v3): one row per chat — each chat's turn lines fold into its newest one,
 * which sits where that turn happened and carries the earlier ones. Display only: the journal and
 * every reader of it keep each turn. Cards (the owner's move, Approve, reports, inbox) never fold.
 */
export function hqPlusFoldChats(items: readonly HqPlusLogItem[]): HqPlusLogItem[] {
  const newest = new Map<string, number>()
  items.forEach((item, index) => {
    const key = chatFoldKey(item)
    if (key) {
      newest.set(key, index)
    }
  })
  const earlier = new Map<string, { id: string; at: number; title: string }[]>()
  const folded: HqPlusLogItem[] = []
  items.forEach((item, index) => {
    const key = chatFoldKey(item)
    if (!key || item.kind !== 'line') {
      folded.push(item)
    } else if (newest.get(key) !== index) {
      earlier.set(key, [
        ...(earlier.get(key) ?? []),
        { id: item.id, at: item.at, title: item.title }
      ])
    } else {
      folded.push({ ...item, earlier: earlier.get(key) ?? [] })
    }
  })
  return folded
}
