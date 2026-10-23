// Custom build (hq-plus-ui): which HQ the HQ view shows — HQ+ (the feed of threads) or the classic one.
// A per-device choice, remembered in this browser profile; the classic HQ is the default.
import { useSyncExternalStore } from 'react'

export type HqFlavor = 'plus' | 'classic'

const KEY = 'orca-plus.hq-flavor'
const listeners = new Set<() => void>()

function read(): HqFlavor {
  try {
    return window.localStorage.getItem(KEY) === 'plus' ? 'plus' : 'classic'
  } catch {
    return 'classic'
  }
}

let current: HqFlavor | null = null

export function hqFlavor(): HqFlavor {
  current ??= read()
  return current
}

export function setHqFlavor(next: HqFlavor): void {
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

export function useHqFlavor(): HqFlavor {
  return useSyncExternalStore(subscribe, hqFlavor, hqFlavor)
}
