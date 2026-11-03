// Custom build (hq-request-ledger): the day's comparison of the Slack ledger with the scout — the
// topics and cards the scout raised that the ledger holds, and how fast messages reached it. Read
// until the scout is switched off (plan 20.9).
/** A topic the scout raised (a request, a quiet item, a thread he waits in) and its messages. Custom
 *  build (hq-ledger-parity, 03.11): `quiet` — one it filed «for information»; most come from reading an
 *  author's other messages and are not said to the owner, so the ledger rightly leaves them. */
export type HqScoutTopic = { id: string; messages: string[]; quiet?: boolean }

/** Custom build (hq-ledger-draft, plan 20.9): the scout's cards of the day against the ledger's — how
 *  many the ledger holds, how many of those it gave the same kind, and how many have its reply draft. */
export type HqSlackParityCards = { cards: number; held: number; sameKind: number; drafted: number }

/** Over this a message missed «in its conversation within a minute» (plan 19.8). */
const LATE_S = 60

/**
 * The day's comparison with the scout: of the topics it raised, how many the ledger holds, and how
 * fast messages reached it. Custom build (hq-ledger-sources, 31.10): topics, not every message the
 * scout looked at — it also looks at what it then skips («not for the owner»), which the ledger rightly
 * leaves alone; a catch-up after a gap is named apart from the delay.
 */
export function hqSlackParityLine(
  topics: readonly HqScoutTopic[],
  inLedger: (channel: string, ts: string) => boolean,
  delays: readonly number[],
  gaps: readonly number[] = [],
  more: { slowest?: { seconds: number; id: string } | null; cards?: HqSlackParityCards } = {}
): string {
  const held = (topic: HqScoutTopic): boolean =>
    topic.messages.some((id) => {
      const [channel, ts] = normalizeScoutId(id).split(':')
      return Boolean(channel && ts && inLedger(channel, ts))
    })
  const raised = topics.filter((topic) => !topic.quiet)
  const quiet = topics.filter((topic) => topic.quiet)
  const missing = raised.filter((topic) => !held(topic))
  const sorted = [...delays].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const late = sorted.filter((seconds) => seconds > LATE_S).length
  const slowest =
    more.slowest && more.slowest.seconds === sorted.at(-1) ? ` (${more.slowest.id})` : ''
  const speed =
    sorted.length > 0
      ? `delay median ${median} s, max ${sorted.at(-1)} s${slowest} over ${sorted.length}${late > 0 ? `, ${late} over 1 min` : ''}`
      : 'no new messages read'
  const caughtUp =
    gaps.length > 0
      ? `; ${gaps.length} catch-up${gaps.length === 1 ? '' : 's'} after up to ${Math.ceil(Math.max(...gaps) / 60)} min without Slack`
      : ''
  const shown = missing
    .slice(0, 5)
    .map((topic) => topic.id)
    .join(', ')
  const quietLine =
    quiet.length > 0
      ? `; quiet: ${quiet.filter(held).length} of ${quiet.length} (the rest not said to you)`
      : ''
  const cards = more.cards
  const cardsLine =
    cards && cards.cards > 0
      ? `; scout cards: ${cards.held} of ${cards.cards} held, kind as the scout's ${cards.sameKind} of ${cards.held}, reply drafted ${cards.drafted} of ${cards.held}`
      : ''
  return `Slack API vs scout: ${raised.length - missing.length} of ${raised.length} topics in conversations${missing.length > 0 ? `, missing ${shown}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}` : ''}${quietLine}${cardsLine}; ${speed}${caughtUp}`
}

/** A scout id with its ts written without the dot (`C1:1793359387819889`) made Slack's form. */
export function normalizeScoutId(id: string): string {
  const [channel, ts] = id.split(':')
  if (!channel || !ts) {
    return id
  }
  return /^\d{16}$/.test(ts) ? `${channel}:${ts.slice(0, 10)}.${ts.slice(10)}` : `${channel}:${ts}`
}
