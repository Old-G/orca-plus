// Custom build (hq-plus-ui-v4): «NEW» on what came while the owner was away from HQ+ — in Code, in the
// classic HQ, or with the app in the background — until the card has been in view for a second.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'

const SEEN_KEY = 'orca-plus.hq-plus-seen-until'
const SEEN_TICK_MS = 5_000
export const HQ_PLUS_SEEN_AFTER_MS = 1_000

function readSeenUntil(): number | null {
  try {
    const stored = Number(localStorage.getItem(SEEN_KEY))
    return Number.isFinite(stored) && stored > 0 ? stored : null
  } catch {
    return null
  }
}

function saveSeenUntil(at: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(at))
  } catch {
    // Why: without storage only what arrives while HQ+ is open but unfocused is marked.
  }
}

/** The owner is looking: the window is focused and HQ+ is on screen. */
export function hqPlusOwnerPresent(): boolean {
  const screen = document.querySelector('.hq-plus')
  return (
    document.visibilityState === 'visible' &&
    document.hasFocus() &&
    screen !== null &&
    screen.checkVisibility()
  )
}

export function useHqPlusNewMarks(
  items: readonly HqPlusLogItem[],
  ready: boolean
): { newIds: ReadonlySet<string>; markSeen: (id: string) => void } {
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set())
  const known = useRef<Set<string> | null>(null)
  const awayFrom = useRef(readSeenUntil())

  useEffect(() => {
    if (!ready) {
      return
    }
    if (known.current === null) {
      const since = awayFrom.current
      known.current = new Set(items.map((item) => item.id))
      if (since !== null) {
        setNewIds(
          new Set(items.flatMap((item) => (item.kind !== 'me' && item.at > since ? [item.id] : [])))
        )
      }
      return
    }
    const seen = known.current
    const added = items.filter((item) => !seen.has(item.id) && item.kind !== 'me')
    for (const item of items) {
      seen.add(item.id)
    }
    if (added.length > 0 && !hqPlusOwnerPresent()) {
      setNewIds((current) => new Set([...current, ...added.map((item) => item.id)]))
    }
  }, [items, ready])

  useEffect(() => {
    const stamp = (): void => {
      if (hqPlusOwnerPresent()) {
        saveSeenUntil(Date.now())
      }
    }
    // Why: leaving is the moment that counts; the next visit marks what came after it.
    const leave = (): void => saveSeenUntil(Date.now())
    stamp()
    const timer = window.setInterval(stamp, SEEN_TICK_MS)
    window.addEventListener('blur', leave)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('blur', leave)
      leave()
    }
  }, [])

  const markSeen = useCallback((id: string) => {
    setNewIds((current) => {
      if (!current.has(id)) {
        return current
      }
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }, [])

  return { newIds, markSeen }
}

/** Calls `onSeen` for each `[data-new]` row that stays in the scroller's view for a second. */
export function observeHqPlusNewRows(
  scroller: HTMLElement,
  onSeen: (id: string) => void
): () => void {
  const timers = new Map<Element, number>()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const pending = timers.get(entry.target)
        // Why: a card taller than the view never reaches the ratio; half the view filled counts too.
        const inView =
          entry.isIntersecting &&
          (entry.intersectionRatio >= 0.6 ||
            entry.intersectionRect.height >= scroller.clientHeight * 0.5)
        if (inView && pending === undefined) {
          const id = entry.target.id.replace(/^hqp-/, '')
          timers.set(
            entry.target,
            window.setTimeout(() => {
              timers.delete(entry.target)
              if (hqPlusOwnerPresent()) {
                onSeen(id)
              }
            }, HQ_PLUS_SEEN_AFTER_MS)
          )
        } else if (!inView && pending !== undefined) {
          window.clearTimeout(pending)
          timers.delete(entry.target)
        }
      }
    },
    { root: scroller, threshold: [0, 0.25, 0.6, 1] }
  )
  for (const row of scroller.querySelectorAll('[data-new="true"]')) {
    observer.observe(row)
  }
  return () => {
    observer.disconnect()
    for (const pending of timers.values()) {
      window.clearTimeout(pending)
    }
  }
}
