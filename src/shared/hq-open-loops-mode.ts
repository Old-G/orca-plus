// Custom build (hq-open-loops): the open-loop detector is off, or reports what it finds
// to the HQ+ journal without touching waitings — the task's first week. Writing waitings comes later.
export const HQ_OPEN_LOOPS_MODES = ['off', 'report'] as const
export type HqOpenLoopsMode = (typeof HQ_OPEN_LOOPS_MODES)[number]

export function hqOpenLoopsMode(
  settings: { hqOpenLoops?: HqOpenLoopsMode } | null | undefined
): HqOpenLoopsMode {
  return settings?.hqOpenLoops ?? 'report'
}
