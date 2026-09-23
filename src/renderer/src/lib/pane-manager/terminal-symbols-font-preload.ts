import { resetAndRefreshAllTerminalWebglAtlases } from './pane-manager-registry'

// Why: the bundled Powerline/Nerd symbols face has a unicode-range, so the browser
// fetches it only for DOM text. xterm draws to a canvas, which never triggers that
// fetch: terminals painted before anything else loaded it show tofu boxes for
// prompt glyphs until their atlas is rebuilt. Startup can also re-create the
// CSS face after a first load, so every unloaded face of the family is loaded
// for a short window after boot.
const SYMBOLS_FAMILY = 'Orca Nerd Font Symbols'
const WATCH_TICKS = 20
const TICK_MS = 500

type SymbolsFontFace = { family: string; status: string; load: () => Promise<unknown> }

function isUnloadedSymbolsFace(face: SymbolsFontFace): boolean {
  return face.status === 'unloaded' && face.family.replace(/["']/g, '') === SYMBOLS_FAMILY
}

export function preloadTerminalSymbolsFont(
  fonts: Iterable<SymbolsFontFace> | undefined = document.fonts,
  tickMs = TICK_MS
): void {
  if (!fonts) {
    return
  }
  let ticksLeft = WATCH_TICKS
  const tick = (): void => {
    const pending = [...fonts].filter(isUnloadedSymbolsFace)
    if (pending.length > 0) {
      void Promise.all(pending.map((face) => face.load())).then(
        () => resetAndRefreshAllTerminalWebglAtlases('symbols-font-loaded'),
        // A missing font file rejects: terminals keep the platform fallbacks.
        () => {}
      )
    }
    ticksLeft--
    if (ticksLeft > 0) {
      setTimeout(tick, tickMs)
    }
  }
  tick()
}
