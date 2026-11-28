// Custom build (hq-decor, V2 of the AI-UX wave 2): how much decoration HQ+ wears. `full` is the look HQ+
// always had (background spots, glows, gradient edges, mono capitals, the project's own card edge);
// `calm` is the quiet one from the U2 page (decisions.md#u2, 1c-2). Default and anything unknown = full,
// so a missing or damaged setting never changes the look.
export type HqPlusDecor = 'full' | 'calm'

export const HQ_PLUS_DECORS: readonly HqPlusDecor[] = ['full', 'calm']

export const HQ_PLUS_DECOR_ATTRIBUTE = 'data-hqp-decor'

export function hqPlusDecor(settings: { hqPlusDecor?: unknown } | null | undefined): HqPlusDecor {
  return settings?.hqPlusDecor === 'calm' ? 'calm' : 'full'
}
