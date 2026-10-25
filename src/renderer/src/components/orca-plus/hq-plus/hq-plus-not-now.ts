// Custom build (hq-plus-ui): «Not now» on a card — it leaves «Waiting on you» until tomorrow and folds;
// what it waits for (a held message, a bell item) stays as it is. Kept per window, like a view choice.
const KEY = 'orca-plus.hq-plus-not-now'

function read(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number'
      )
    )
  } catch {
    return {}
  }
}

/** Cards put off and still within their «until». */
export function readHqPlusNotNow(now: number): ReadonlySet<string> {
  return new Set(
    Object.entries(read())
      .filter(([, until]) => until > now)
      .map(([id]) => id)
  )
}

/** Until the start of the owner's next day. */
export function putOffHqPlusCard(id: string, now: number): void {
  const until = new Date(now)
  until.setHours(24, 0, 0, 0)
  const kept = Object.fromEntries(Object.entries(read()).filter(([, at]) => at > now))
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...kept, [id]: until.getTime() }))
  } catch {
    // Why: storage can be blocked; the card then stays where it was.
  }
}
