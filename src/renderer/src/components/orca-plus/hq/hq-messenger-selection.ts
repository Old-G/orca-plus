// Custom build (hq-chats): what HQ's messenger view shows on its right — a chat, or one of the
// pinned items that hold the earlier tabs — and how a request for an earlier tab maps onto it.

export const HQ_PINNED_IDS = ['today', 'waiting', 'projects', 'wiki', 'map', 'agents'] as const

export type HqPinnedId = (typeof HQ_PINNED_IDS)[number]

export type HqSelection = { kind: 'chat' } | { kind: 'pinned'; id: HqPinnedId }

let remembered: HqSelection = { kind: 'chat' }

export function rememberedHqSelection(): HqSelection {
  return remembered
}

export function rememberHqSelection(selection: HqSelection): void {
  remembered = selection
}

/** A tab another surface asked HQ to open on: «chats» and the earlier tab ids; null for anything
 *  else. */
export function hqSelectionForRequest(tab: string | null): HqSelection | null {
  if (tab === 'chats') {
    return { kind: 'chat' }
  }
  const pinned = HQ_PINNED_IDS.find((id) => id === tab)
  return pinned ? { kind: 'pinned', id: pinned } : null
}
