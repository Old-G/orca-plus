// Custom build (hq-screen): the morning bell items — the briefing, raised by main and opened on HQ's
// Today tab, and the count of deferred sessions, raised by the renderer and opened on Agents.
export const HQ_BRIEFING_KIND = 'hq-briefing'
export const HQ_BRIEFING_OPEN_ACTION = 'open'
export const HQ_BRIEFING_TAB = 'today'
/** The once-a-morning count of deferred sessions; the renderer counts, so it syncs this kind. */
export const HQ_DEFERRED_KIND = 'hq-deferred'
export const HQ_DEFERRED_TAB = 'agents'
export const HQ_BRIEFING_HOUR = 10

export function hqLocalDay(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
