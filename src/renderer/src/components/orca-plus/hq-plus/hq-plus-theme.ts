// Custom build (paper-theme): HQ+ follows Orca's theme — the ice-blue HUD while Orca is dark, «Paper»
// (hq-plus-paper.css) while it is light. Every HQ+ root takes its class from here; the `dark` class also
// keeps shared components (native chat, menus) dark inside it.
import { useLayoutEffect } from 'react'
import { useDocumentDarkTheme } from '@/hooks/theme/use-document-dark-theme'
import { useAppStore } from '@/store'
import {
  HQ_PLUS_PALETTE_ATTRIBUTE,
  hqPlusPalette,
  type HqPlusPalette
} from '../../../../../shared/hq-plus-palette'
import {
  HQ_PLUS_DECOR_ATTRIBUTE,
  hqPlusDecor,
  type HqPlusDecor
} from '../../../../../shared/hq-plus-decor'

export function hqPlusRootClass(dark: boolean, extra?: string): string {
  return ['hq-plus', dark ? 'dark' : null, extra ?? null].filter(Boolean).join(' ')
}

/** Custom build (hq-palette): the palette goes on <html>, not on the root, because menus portal out of the
 *  HQ+ root. Classic leaves no attribute at all, so nothing in hq-plus-palette.css matches. */
export function applyHqPlusPalette(
  root: Pick<Element, 'setAttribute' | 'removeAttribute'>,
  palette: HqPlusPalette
): void {
  if (palette === 'graphite') {
    root.setAttribute(HQ_PLUS_PALETTE_ATTRIBUTE, palette)
  } else {
    root.removeAttribute(HQ_PLUS_PALETTE_ATTRIBUTE)
  }
}

/** Custom build (hq-decor): same as the palette — on <html>, `full` leaves no attribute. */
export function applyHqPlusDecor(
  root: Pick<Element, 'setAttribute' | 'removeAttribute'>,
  decor: HqPlusDecor
): void {
  if (decor === 'calm') {
    root.setAttribute(HQ_PLUS_DECOR_ATTRIBUTE, decor)
  } else {
    root.removeAttribute(HQ_PLUS_DECOR_ATTRIBUTE)
  }
}

export function useHqPlusRootClass(extra?: string): string {
  const palette = useAppStore((s) => hqPlusPalette(s.settings))
  const decor = useAppStore((s) => hqPlusDecor(s.settings))
  // Why not undone on unmount: several HQ+ roots can be mounted at once, and the rules only match inside
  // `.hq-plus`; every mount syncs the attribute again.
  useLayoutEffect(() => {
    applyHqPlusPalette(document.documentElement, palette)
  }, [palette])
  useLayoutEffect(() => {
    applyHqPlusDecor(document.documentElement, decor)
  }, [decor])
  return hqPlusRootClass(useDocumentDarkTheme(), extra)
}
