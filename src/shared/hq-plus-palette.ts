// Custom build (hq-palette): which colour palette HQ+ wears. `classic` is the look HQ+ always had (the
// ice-blue HUD / Paper); `graphite` is «Графит» (dark) and «Бумага» (light), the quieter one from the U2
// page. Default and anything unknown = classic, so a missing or damaged setting never changes the look.
export type HqPlusPalette = 'classic' | 'graphite'

export const HQ_PLUS_PALETTES: readonly HqPlusPalette[] = ['classic', 'graphite']

export const HQ_PLUS_PALETTE_ATTRIBUTE = 'data-hqp-palette'

export function hqPlusPalette(
  settings: { hqPlusPalette?: unknown } | null | undefined
): HqPlusPalette {
  return settings?.hqPlusPalette === 'graphite' ? 'graphite' : 'classic'
}
