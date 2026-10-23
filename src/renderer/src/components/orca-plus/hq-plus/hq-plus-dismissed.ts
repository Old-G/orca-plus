// Custom build (hq-plus-ui-v5): × on a chat card whose chat is no longer open hides the card from the
// feed; the journal keeps every row, and a newer turn of that chat brings its card back.
const KEY = 'orca-plus.hq-plus-dismissed'
const KEEP_MS = 14 * 24 * 60 * 60_000

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

/** Chat key → the time of the turn the owner dismissed. */
export function readHqPlusDismissed(): ReadonlyMap<string, number> {
  return new Map(Object.entries(read()))
}

export function dismissHqPlusChatCard(key: string, at: number, now: number): void {
  const kept = Object.fromEntries(Object.entries(read()).filter(([, when]) => when > now - KEEP_MS))
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...kept, [key]: at }))
  } catch {
    // Why: storage can be blocked; the card then stays.
  }
}

/** Shown unless the owner dismissed this very turn or a later one. */
export function hqPlusChatCardShown(
  dismissed: ReadonlyMap<string, number>,
  key: string | null,
  at: number
): boolean {
  const until = key ? dismissed.get(key) : undefined
  return until === undefined || at > until
}
