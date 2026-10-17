// Custom build (quiet-hours): hours when Orca+ does not reach the owner's phone or Slack — only urgent
// bell items (an Approve, a blocker) still push; everything waits in the bell and HQ.

export type OrcaPlusQuietHours = { start: number; end: number }

/** The scout's working day is 9–21, so the phone is quiet outside it unless the owner says otherwise. */
export const DEFAULT_ORCA_PLUS_QUIET_HOURS: OrcaPlusQuietHours = { start: 21, end: 9 }

/** Unset reads as the default; null turns quiet hours off. */
export function orcaPlusQuietHours(settings: {
  orcaPlusQuietHours?: OrcaPlusQuietHours | null
}): OrcaPlusQuietHours | null {
  return settings.orcaPlusQuietHours === undefined
    ? DEFAULT_ORCA_PLUS_QUIET_HOURS
    : settings.orcaPlusQuietHours
}

/** `start` inclusive, `end` exclusive, local time; a span past midnight (21 → 9) wraps. */
export function isOrcaPlusQuietHour(hours: OrcaPlusQuietHours | null, now: Date): boolean {
  if (!hours || hours.start === hours.end) {
    return false
  }
  const hour = now.getHours()
  return hours.start < hours.end
    ? hour >= hours.start && hour < hours.end
    : hour >= hours.start || hour < hours.end
}
