// Custom build (hq-plus-ui-v2): how wide the owner dragged HQ+'s left and right panels. Kept per window,
// like a view choice; a missing or broken value falls back to the default.
import { clampSidebarResizeWidth } from '@/hooks/useSidebarResize'

export const HQ_PLUS_PANEL = {
  left: { key: 'orca-plus.hq-plus-left-width', min: 200, max: 420, initial: 260 },
  right: { key: 'orca-plus.hq-plus-right-width', min: 320, max: 720, initial: 420 }
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
