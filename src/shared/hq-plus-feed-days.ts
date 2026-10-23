// Custom build (hq-plus-ui-v4): where HQ+'s feed crosses midnight — by the owner's local calendar.
function dayStart(at: number): number {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

export function hqPlusSameDay(a: number, b: number): boolean {
  return dayStart(a) === dayStart(b)
}

/** 0 for today, 1 for yesterday; counted in calendar days, so a DST shift is not a day. */
export function hqPlusDaysAgo(at: number, now: number): number {
  return Math.round((dayStart(now) - dayStart(at)) / (24 * 60 * 60_000))
}
