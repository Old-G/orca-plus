// Custom build (T5b board): the board's narrow Age column shows «3h», not «3 hours ago» that got cut off.
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function hqPlusShortAge(at: number, now: number): string {
  const ms = Math.max(0, now - at)
  if (ms < MINUTE) {
    return 'now'
  }
  if (ms < HOUR) {
    return `${Math.floor(ms / MINUTE)}m`
  }
  if (ms < DAY) {
    return `${Math.floor(ms / HOUR)}h`
  }
  if (ms < 7 * DAY) {
    return `${Math.floor(ms / DAY)}d`
  }
  return `${Math.floor(ms / (7 * DAY))}w`
}
