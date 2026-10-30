// Custom build (hq-plus-map): which layout HQ+ shows — the current one (feed in the middle, tabs on the
// right) or Map (the room's map or the feed by tabs, the chat docked on the right). A per-device choice,
// remembered in this browser profile; the current layout is the default. Switching needs no restart.
import { useSyncExternalStore } from 'react'

export type HqPlusLayout = 'current' | 'map'

const KEY = 'orca-plus.hq-plus-layout'
const listeners = new Set<() => void>()

function read(): HqPlusLayout {
  try {
    return window.localStorage.getItem(KEY) === 'map' ? 'map' : 'current'
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
