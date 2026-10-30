// Custom build (hq-plus-map): where the owner left the Map layout — the unfolded projects, the map's zoom
// and the panel over it (its width, where it was dragged, folded or not) — so leaving HQ+ for Orca and
// coming back lands on the same view.
const KEY = 'orca-plus.hq-plus-map-view'
const MAX_EXPANDED = 100

export type HqPlusMapCamera = { x: number; y: number; k: number }

/** The panel over the map: docked to the right edge (`float` null) or dragged somewhere. */
export type HqPlusMapDockPlace = {
  width: number
  float: { x: number; y: number; height: number } | null
}

export type HqPlusMapView = {
  /** Unfolded projects per room ('' for All). */
  expanded: Record<string, string[]>
  camera: HqPlusMapCamera | null
  dock: HqPlusMapDockPlace
  /** The panel folded to a small button at the top right. */
  dockFolded: boolean
}

export const HQ_PLUS_MAP_DOCK_WIDTH = 440

const INITIAL: HqPlusMapView = {
  expanded: {},
  camera: null,
  dock: { width: HQ_PLUS_MAP_DOCK_WIDTH, float: null },
  dockFolded: false
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function readCamera(value: unknown): HqPlusMapCamera | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const [x, y, k] = ['x', 'y', 'k'].map((name) => num(Reflect.get(value, name)))
  return x !== null && y !== null && k !== null && k > 0 ? { x, y, k } : null
}

function readDock(value: unknown): HqPlusMapDockPlace {
  if (!value || typeof value !== 'object') {
    return { ...INITIAL.dock }
  }
  const width = num(Reflect.get(value, 'width'))
  const float: unknown = Reflect.get(value, 'float')
  const place =
    float && typeof float === 'object'
      ? ['x', 'y', 'height'].map((name) => num(Reflect.get(float, name)))
      : null
  return {
    width: width !== null && width >= 280 ? width : HQ_PLUS_MAP_DOCK_WIDTH,
    float:
      place && place.every((part) => part !== null)
        ? { x: place[0] ?? 0, y: place[1] ?? 0, height: place[2] ?? 0 }
        : null
  }
}

export function parseHqPlusMapView(raw: unknown): HqPlusMapView {
  if (!raw || typeof raw !== 'object') {
    return { ...INITIAL }
  }
  const get = (name: string): unknown => Reflect.get(raw, name)
  const expanded = get('expanded')
  return {
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
    dock: readDock(get('dock')),
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
