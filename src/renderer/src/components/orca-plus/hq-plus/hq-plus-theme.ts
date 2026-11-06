// Custom build (paper-theme): HQ+ follows Orca's theme — the ice-blue HUD while Orca is dark, «Paper»
// (hq-plus-paper.css) while it is light. Every HQ+ root takes its class from here; the `dark` class also
// keeps shared components (native chat, menus) dark inside it.
import { useDocumentDarkTheme } from '@/hooks/use-document-dark-theme'

export function hqPlusRootClass(dark: boolean, extra?: string): string {
  return ['hq-plus', dark ? 'dark' : null, extra ?? null].filter(Boolean).join(' ')
}

export function useHqPlusRootClass(extra?: string): string {
  return hqPlusRootClass(useDocumentDarkTheme(), extra)
}
