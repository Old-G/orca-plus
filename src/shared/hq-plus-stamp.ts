// Custom build (hq-plus-stamp, owner 04.11: «write the date and time a message was sent, so I see old
// stuff I need not answer»): a time on an HQ+ card — today's as «14:02», an earlier day's with its date.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function hqPlusStamp(at: number, now: number = Date.now()): string {
  const when = new Date(at)
  const today = new Date(now)
  const time = when.toTimeString().slice(0, 5)
  if (when.toDateString() === today.toDateString()) {
    return time
  }
  const day = `${when.getDate()} ${MONTHS[when.getMonth()]}`
  return when.getFullYear() === today.getFullYear()
    ? `${day} ${time}`
    : `${day} ${when.getFullYear()} ${time}`
}

/** A Slack message's ts («1793717177.237889») as the time it was sent; null for anything else. */
export function slackTsAt(ts: string | null | undefined): number | null {
  return ts && /^\d+\.\d+$/.test(ts) ? Math.round(Number(ts) * 1000) : null
}
