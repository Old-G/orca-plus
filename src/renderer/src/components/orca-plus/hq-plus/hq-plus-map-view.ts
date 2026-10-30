// Custom build (hq-plus-map): where the owner was in the Map layout — Map or Feed, the feed's tab, the
// unfolded projects and the map's zoom — so leaving HQ+ for Orca and coming back lands on the same view.
import { HQ_PLUS_MAP_FEED_TABS, type HqPlusMapFeedTab } from '../../../../../shared/hq-plus-map'

const KEY = 'orca-plus.hq-plus-map-view'
const MAX_EXPANDED = 100

export type HqPlusMapCamera = { x: number; y: number; k: number }

export type HqPlusMapView = {
  view: 'map' | 'feed'
  tab: HqPlusMapFeedTab
  /** Unfolded projects per room ('' for All). */
  expanded: Record<string, string[]>
  camera: HqPlusMapCamera | null
  /** The dock over the map folded to its edge. */
  dockFolded: boolean
}

const INITIAL: HqPlusMapView = {
  view: 'map',
  tab: 'all',
  expanded: {},
  camera: null,
  dockFolded: false
}

function readCamera(value: unknown): HqPlusMapCamera | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const [x, y, k] = ['x', 'y', 'k'].map((name) => Reflect.get(value, name))
  return typeof x === 'number' && typeof y === 'number' && typeof k === 'number' && k > 0
    ? { x, y, k }
    : null
}

export function parseHqPlusMapView(raw: unknown): HqPlusMapView {
  if (!raw || typeof raw !== 'object') {
    return { ...INITIAL }
  }
  const get = (name: string): unknown => Reflect.get(raw, name)
  const expanded = get('expanded')
  return {
    view: get('view') === 'feed' ? 'feed' : 'map',
    tab: HQ_PLUS_MAP_FEED_TABS.find((tab) => tab === get('tab')) ?? INITIAL.tab,
    expanded:
      expanded && typeof expanded === 'object'
        ? Object.fromEntries(
            Object.entries(expanded).map(([room, ids]) => [
              room,
              Array.isArray(ids)
                ? ids.filter((id): id is string => typeof id === 'string').slice(-MAX_EXPANDED)
                : []
            ])
          )
        : {},
    camera: readCamera(get('camera')),
    dockFolded: get('dockFolded') === true
  }
}

let current: HqPlusMapView | null = null

export function readHqPlusMapView(): HqPlusMapView {
  if (!current) {
    try {
      const stored = localStorage.getItem(KEY)
      current = parseHqPlusMapView(stored ? JSON.parse(stored) : null)
    } catch {
      current = { ...INITIAL }
    }
  }
  return current
}

let writeTimer: ReturnType<typeof setTimeout> | null = null

export function saveHqPlusMapView(patch: Partial<HqPlusMapView>): void {
  current = { ...readHqPlusMapView(), ...patch }
  if (writeTimer) {
    clearTimeout(writeTimer)
  }
  writeTimer = setTimeout(() => {
    writeTimer = null
    try {
      localStorage.setItem(KEY, JSON.stringify(current))
    } catch {
      // Why: a window without storage keeps the view until it closes.
    }
  }, 300)
}
