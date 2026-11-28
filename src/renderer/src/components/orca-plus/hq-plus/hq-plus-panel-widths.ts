// Custom build (hq-plus-ui-v2): how wide the owner dragged HQ+'s left and right panels. Kept per window,
// like a view choice; a missing or broken value falls back to the default.
import { clampSidebarResizeWidth } from '@/hooks/useSidebarResize'

export const HQ_PLUS_PANEL = {
  left: { key: 'orca-plus.hq-plus-left-width', min: 200, max: 560, initial: 260 },
  right: { key: 'orca-plus.hq-plus-right-width', min: 320, max: 1200, initial: 420 },
  // Board layout (T5): the feed is the left zone, so it gets its own, wider range.
  boardLeft: { key: 'orca-plus.hq-plus-board-left-width', min: 300, max: 720, initial: 380 }
} as const

export type HqPlusPanelSide = keyof typeof HQ_PLUS_PANEL

export function readHqPlusPanelWidth(side: HqPlusPanelSide): number {
  const panel = HQ_PLUS_PANEL[side]
  try {
    const stored = Number(localStorage.getItem(panel.key))
    return Number.isFinite(stored) && stored > 0
      ? clampSidebarResizeWidth(stored, panel.min, panel.max)
      : panel.initial
  } catch {
    return panel.initial
  }
}

export function saveHqPlusPanelWidth(side: HqPlusPanelSide, width: number): void {
  try {
    localStorage.setItem(HQ_PLUS_PANEL[side].key, String(Math.round(width)))
  } catch {
    // Why: a window without storage keeps the width until it closes.
  }
}

// Custom build (U3 board feed window): the Board's feed is a window of this share of its column's height,
// pulled by a grip between 35% and 80% and kept per window, like the widths above.
export const HQ_PLUS_FEED_WINDOW = {
  key: 'orca-plus.hq-plus-feed-window-pct',
  min: 35,
  max: 80,
  initial: 55
} as const

export function clampHqPlusFeedWindow(pct: number): number {
  return Math.min(HQ_PLUS_FEED_WINDOW.max, Math.max(HQ_PLUS_FEED_WINDOW.min, Math.round(pct)))
}

export function readHqPlusFeedWindow(): number {
  try {
    const stored = Number(localStorage.getItem(HQ_PLUS_FEED_WINDOW.key))
    return Number.isFinite(stored) && stored > 0
      ? clampHqPlusFeedWindow(stored)
      : HQ_PLUS_FEED_WINDOW.initial
  } catch {
    return HQ_PLUS_FEED_WINDOW.initial
  }
}

export function saveHqPlusFeedWindow(pct: number): void {
  try {
    localStorage.setItem(HQ_PLUS_FEED_WINDOW.key, String(clampHqPlusFeedWindow(pct)))
  } catch {
    // Why: a window without storage keeps the height until it closes.
  }
}
