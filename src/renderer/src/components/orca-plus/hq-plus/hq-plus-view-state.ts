// Custom build (hq-plus-ui-v5): where the owner was in HQ+ — scope, right tab, open chat or project,
// unfolded cards, feed scroll — so leaving for Code or HQ and coming back (or a restart) lands on the
// same screen. Kept per window like the panel widths; anything missing or broken falls back.
import type { HqPlusPick } from './HqPlusSession'

const KEY = 'orca-plus.hq-plus-view'
const MAX_EXPANDED = 200

export const HQ_PLUS_VIEW_TABS = ['graph', 'river', 'session', 'report', 'agents'] as const
export type HqPlusViewTab = (typeof HQ_PLUS_VIEW_TABS)[number]

export type HqPlusViewState = {
  scope: string | null
  tab: HqPlusViewTab
  chatKey: string | null
  chatFolded: boolean
  wide: boolean
  pickedFrom: 'river' | 'graph' | null
  pick: HqPlusPick | null
  reportPath: string | null
  expanded: string[]
  showIdle: boolean
  showAllWaiting: boolean
  /** Pixels between the feed's bottom edge and the end of the log; null = following the bottom. */
  fromBottom: number | null
}

const INITIAL: HqPlusViewState = {
  scope: null,
  tab: 'graph',
  chatKey: null,
  chatFolded: false,
  wide: false,
  pickedFrom: null,
  pick: null,
  reportPath: null,
  expanded: [],
  showIdle: false,
  showAllWaiting: false,
  fromBottom: null
}

let current: HqPlusViewState | null = null

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function readPick(value: unknown): HqPlusPick | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const field = (name: string): string | null => text(Reflect.get(value, name))
  return {
    project: field('project'),
    address: field('address'),
    sessionId: field('sessionId'),
    name: field('name')
  }
}

/** A stored value as a view state, field by field; a bad field keeps its default. */
export function parseHqPlusViewState(raw: unknown): HqPlusViewState {
  if (!raw || typeof raw !== 'object') {
    return { ...INITIAL }
  }
  const get = (name: string): unknown => Reflect.get(raw, name)
  const tab = HQ_PLUS_VIEW_TABS.find((name) => name === get('tab')) ?? INITIAL.tab
  const pickedFrom = get('pickedFrom')
  const fromBottom = get('fromBottom')
  const expanded = get('expanded')
  return {
    scope: text(get('scope')),
    tab,
    chatKey: text(get('chatKey')),
    chatFolded: get('chatFolded') === true,
    wide: get('wide') === true,
    pickedFrom: pickedFrom === 'river' || pickedFrom === 'graph' ? pickedFrom : null,
    pick: readPick(get('pick')),
    reportPath: text(get('reportPath')),
    expanded: Array.isArray(expanded)
      ? expanded.filter((id): id is string => typeof id === 'string').slice(-MAX_EXPANDED)
      : [],
    showIdle: get('showIdle') === true,
    showAllWaiting: get('showAllWaiting') === true,
    fromBottom:
      typeof fromBottom === 'number' && Number.isFinite(fromBottom) && fromBottom > 0
        ? fromBottom
        : null
  }
}

export function readHqPlusViewState(): HqPlusViewState {
  if (current) {
    return current
  }
  try {
    const stored = localStorage.getItem(KEY)
    current = parseHqPlusViewState(stored ? JSON.parse(stored) : null)
  } catch {
    current = { ...INITIAL }
  }
  return current
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Why: a window without storage keeps the view until it closes.
  }
}

let writeTimer: ReturnType<typeof setTimeout> | null = null

/** Merges into the remembered view; the memory copy is immediate, the stored one follows shortly. */
export function saveHqPlusViewState(patch: Partial<HqPlusViewState>): void {
  current = { ...readHqPlusViewState(), ...patch }
  if (writeTimer) {
    clearTimeout(writeTimer)
  }
  writeTimer = setTimeout(() => {
    writeTimer = null
    persist()
  }, 300)
}

/** Writes now — on leaving the screen or the window closing. */
export function flushHqPlusViewState(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (current) {
    persist()
  }
}
