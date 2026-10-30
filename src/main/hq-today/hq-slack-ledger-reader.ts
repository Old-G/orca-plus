// Custom build (hq-request-ledger): the owner's DMs and the threads he takes part in, read straight
// from Slack with his token every half minute and put into the request ledger — the reading the scout
// session did every 15 minutes with a large model. A small model looks once at each new conversation
// (project, whose move, gist); everything after that is the ledger's own ladder.
import type { HqLedgerResult, HqLedgerSignal } from '../../shared/hq-ledger'
import { slackMessageForOwner } from '../../shared/hq-reply-addressee'
import type { HqLedgerGuess } from '../orca-plus/pulse/pulse-ledger'
import { createDebouncedSingleFlight } from '../orca-plus/debounced-single-flight'

// Why half a minute: a message should be in its conversation within a minute (plan 19.8).
const POLL_MS = 30_000
const FIRST_POLL_MS = 25_000
/** Why: on start it catches up on the last day; ingest is idempotent per message. */
const CATCH_UP_MS = 24 * 60 * 60_000
/** Why: Slack's search index can lag a little; re-reading a few minutes costs nothing. */
const OVERLAP_MS = 5 * 60_000
/** Why: a burst of new talks must not hold the pass on the model; the rest wait for the next pass. */
const GUESSES_PER_PASS = 5

/** One message from Slack's search over the owner's DMs and threads. */
export type HqSlackLedgerMessage = {
  channel: string
  ts: string
  /** The thread it lives in; null for a top-level line. */
  threadTs: string | null
  user: string | null
  /** Plain text, links and mentions made readable. */
  text: string
  /** Slack's markup, for whom it mentions. */
  rawText: string
  permalink: string | null
  /** A DM or a group DM. */
  dm: boolean
  bot: boolean
}

export type HqSlackLedgerReadApi = {
  owner: string
  /** Messages in the owner's DMs and threads since `since` (ms), newest first. */
  withOwner: (since: number) => Promise<HqSlackLedgerMessage[]>
  name: (userId: string) => Promise<string>
}

export type HqSlackLedgerDeps = {
  enabled: () => boolean
  /** Null when no reader token is saved. */
  read: <T>(run: (api: HqSlackLedgerReadApi) => Promise<T>) => Promise<T | null>
  ingest: (signal: HqLedgerSignal) => HqLedgerResult
  lastDirection: (key: string) => 'in' | 'out' | null
  /** The small model on a new conversation's first message; null when it could not say. */
  guess: (
    message: HqSlackLedgerMessage,
    author: string | null,
    fromOwner: boolean
  ) => Promise<HqLedgerGuess | null>
  setGuess: (conversationId: string, guess: HqLedgerGuess) => void
  now: () => number
}

export type HqSlackLedgerState = {
  cursor: number
  /** Seconds from a message to its conversation, for the day's parity line. */
  delays: number[]
}

/** The ledger signal of one Slack message; null for bots and system lines. */
export function hqLedgerSignalOfSlack(
  message: HqSlackLedgerMessage,
  owner: string,
  author: string | null,
  lastDirection: 'in' | 'out' | null
): HqLedgerSignal | null {
  if (message.bot || !message.user) {
    return null
  }
  const fromOwner = message.user === owner
  const mentionsOwner = message.rawText.includes(`<@${owner}`)
  // Why: in a channel thread only what is said to the owner is his move — he is mentioned, or someone
  // answers him (he wrote last) without turning to another person.
  const forOwner =
    !fromOwner &&
    (message.dm ||
      mentionsOwner ||
      (lastDirection === 'out' && slackMessageForOwner(message.rawText, owner)))
  const line = message.text.replace(/\s+/g, ' ').trim()
  return {
    key: `slack:${message.channel}:${message.threadTs ?? message.ts}`,
    ts: message.ts,
    at: Math.round(Number(message.ts) * 1000),
    author,
    authorId: message.user,
    fromOwner,
    text: message.text,
    link: message.permalink,
    reader: 'slack-api',
    forOwner,
    project: null,
    title: line.length > 100 ? `${line.slice(0, 99)}…` : line || '(no text)'
  }
}

/** One pass: new messages into the ledger, a guess for each new conversation. Returns the next state. */
export async function runHqSlackLedgerReader(
  deps: HqSlackLedgerDeps,
  state: HqSlackLedgerState
): Promise<HqSlackLedgerState> {
  const now = deps.now()
  const since = Math.max(state.cursor - OVERLAP_MS, now - CATCH_UP_MS)
  const read = await deps.read(async (api) => {
    const messages = await api.withOwner(since)
    const names = new Map<string, string>()
    const fresh: {
      message: HqSlackLedgerMessage
      author: string | null
      fromOwner: boolean
      result: HqLedgerResult
    }[] = []
    let cursor = state.cursor
    const roots = new Set(
      messages.flatMap((message) =>
        message.threadTs && message.threadTs !== message.ts
          ? [`${message.channel}:${message.threadTs}`]
          : []
      )
    )
    // Why oldest first: the ledger's ladder needs the owner's line before the answer to it.
    for (const message of [...messages].sort((a, b) => Number(a.ts) - Number(b.ts))) {
      const key = `slack:${message.channel}:${message.threadTs ?? message.ts}`
      const last = deps.lastDirection(key)
      // Why: a top-level channel line is a talk only once a thread grows under it; the owner's own
      // posts to channels are not conversations.
      if (
        !message.dm &&
        !message.threadTs &&
        last === null &&
        !roots.has(`${message.channel}:${message.ts}`)
      ) {
        continue
      }
      const user = message.user
      if (user && !names.has(user)) {
        names.set(user, await api.name(user))
      }
      const author = user ? (names.get(user) ?? null) : null
      const signal = hqLedgerSignalOfSlack(message, api.owner, author, last)
      if (!signal) {
        continue
      }
      const result = deps.ingest(signal)
      cursor = Math.max(cursor, signal.at)
      if (result.added) {
        fresh.push({ message, author, fromOwner: signal.fromOwner, result })
      }
    }
    return { fresh, cursor }
  })
  if (!read) {
    return state
  }
  const delays = [...state.delays]
  let guessed = 0
  for (const { message, author, fromOwner, result } of read.fresh) {
    // Why not on the first pass: catching up on a day would read as a day's delay.
    if (state.cursor > 0) {
      delays.push(Math.max(0, Math.round((deps.now() - Number(message.ts) * 1000) / 1000)))
    }
    if ((result.step === 'new' || result.step === 'owner') && guessed < GUESSES_PER_PASS) {
      guessed += 1
      const guess = await deps.guess(message, author, fromOwner).catch(() => null)
      if (guess) {
        deps.setGuess(result.conversationId, guess)
      }
    }
  }
  return { cursor: Math.max(read.cursor, state.cursor), delays: delays.slice(-500) }
}

/** The day's line: what the scout looked at that the ledger has not, and how fast the API reader was. */
export function hqSlackParityLine(
  scoutIds: readonly string[],
  inLedger: (channel: string, ts: string) => boolean,
  delays: readonly number[]
): string {
  const missing = scoutIds.filter((id) => {
    const [channel, ts] = id.split(':')
    return !channel || !ts || !inLedger(channel, ts)
  })
  const sorted = [...delays].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const speed =
    sorted.length > 0
      ? `delay median ${median} s, max ${sorted.at(-1)} s over ${sorted.length}`
      : 'no new messages read'
  const shown = missing.slice(0, 5).join(', ')
  return `Slack API vs scout: ${scoutIds.length - missing.length} of ${scoutIds.length} in conversations${missing.length > 0 ? `, missing ${shown}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}` : ''}; ${speed}`
}

/** A scout id with its ts written without the dot (`C1:1793359387819889`) made Slack's form. */
export function normalizeScoutId(id: string): string {
  const [channel, ts] = id.split(':')
  if (!channel || !ts) {
    return id
  }
  return /^\d{16}$/.test(ts) ? `${channel}:${ts.slice(0, 10)}.${ts.slice(10)}` : `${channel}:${ts}`
}

export function startHqSlackLedgerReader(
  deps: HqSlackLedgerDeps,
  onError: (error: unknown) => void
): { stop: () => void; delays: () => number[] } {
  let state: HqSlackLedgerState = { cursor: 0, delays: [] }
  const flight = createDebouncedSingleFlight(
    async () => {
      if (deps.enabled()) {
        state = await runHqSlackLedgerReader(deps, state)
      }
    },
    onError,
    FIRST_POLL_MS
  )
  const timer = setInterval(() => void flight.runNow(), POLL_MS)
  timer.unref?.()
  flight.schedule()
  return {
    stop: () => {
      clearInterval(timer)
      flight.dispose()
    },
    delays: () => {
      const taken = state.delays
      state = { ...state, delays: [] }
      return taken
    }
  }
}
