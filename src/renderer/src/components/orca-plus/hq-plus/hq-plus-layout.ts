// Custom build (hq-plus-map): which layout HQ+ shows — the current one (feed in the middle, tabs on the
// right), Map (the room's map or the feed by tabs, the chat docked on the right) or Work (the chat tree on
// the whole screen, hq-plus-work-view). A per-device choice,
// remembered in this browser profile; the current layout is the default. Switching needs no restart.
import { useSyncExternalStore } from 'react'

export type HqPlusLayout = 'current' | 'map' | 'work'

const KEY = 'orca-plus.hq-plus-layout'
const listeners = new Set<() => void>()

function read(): HqPlusLayout {
  try {
    const saved = window.localStorage.getItem(KEY)
    return saved === 'map' || saved === 'work' ? saved : 'current'
  } catch {
    return 'current'
  }
}

let current: HqPlusLayout | null = null

export function hqPlusLayout(): HqPlusLayout {
  current ??= read()
  return current
}

export function setHqPlusLayout(next: HqPlusLayout): void {
  current = next
  try {
    window.localStorage.setItem(KEY, next)
  } catch {
    // Why: a profile without storage still switches for this session.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHqPlusLayout(): HqPlusLayout {
  return useSyncExternalStore(subscribe, hqPlusLayout, hqPlusLayout)
}
