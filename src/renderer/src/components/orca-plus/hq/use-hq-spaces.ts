// Custom build (hq-spaces): the workspaces under the global HQ and the one HQ shows — read once and
// shared by every HQ surface, so a switch filters chats, Feed, Notes and the counts together.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  hqSpaceOf,
  hqSpaceShows,
  readHqSpaces,
  type HqSpace,
  type HqSpaceRef
} from '../../../../../shared/hq-spaces'
import { useAppStore } from '@/store'

// Why: workspace.yaml changes by hand or by an agent; a minute is soon enough to notice.
const REFRESH_MS = 60_000
const NO_SPACES: HqSpace[] = []

let cached: HqSpace[] = NO_SPACES
const listeners = new Set<(spaces: HqSpace[]) => void>()
let timer: ReturnType<typeof setInterval> | null = null

function load(): void {
  // Why: started inside a promise, so a window without the runtime bridge only logs.
  Promise.resolve()
    .then(() => window.api.runtime.call({ method: 'hqProjects.spaces' }))
    .then((response) => {
      if (response.ok) {
        cached = readHqSpaces(response.result)
        listeners.forEach((listener) => listener(cached))
      }
    })
    .catch((error: unknown) => console.warn('[hq] workspaces failed:', error))
}

function subscribe(listener: (spaces: HqSpace[]) => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    load()
    timer = setInterval(load, REFRESH_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export type HqSpacesView = {
  spaces: HqSpace[]
  /** The workspace shown, or null for all of them. */
  active: HqSpace | null
  setActive: (slug: string | null) => void
  shows: (ref: HqSpaceRef) => boolean
  /** The stripe colour of a record's workspace, only while all of them are shown. */
  stripeOf: (ref: HqSpaceRef) => string | null
}

export function useHqSpaces(): HqSpacesView {
  const [spaces, setSpaces] = useState<HqSpace[]>(cached)
  useEffect(() => subscribe(setSpaces), [])
  const activeSlug = useAppStore((state) => state.settings?.hqActiveSpace ?? null)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const setActive = useCallback(
    (slug: string | null) => void updateSettings({ hqActiveSpace: slug }),
    [updateSettings]
  )
  return useMemo(() => {
    const active = spaces.find((space) => space.slug === activeSlug) ?? null
    return {
      spaces,
      active,
      setActive,
      shows: (ref) => hqSpaceShows(spaces, active?.slug, ref),
      stripeOf: (ref) => (active ? null : (hqSpaceOf(spaces, ref)?.color ?? null))
    }
  }, [spaces, activeSlug, setActive])
}

/** A thin left stripe in the record's workspace colour; none when it has none. */
export function hqSpaceStripeStyle(color: string | null | undefined): CSSProperties | undefined {
  return color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined
}
