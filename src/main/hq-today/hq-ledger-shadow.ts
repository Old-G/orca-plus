// Custom build (hq-request-ledger): the ledger in shadow — it reads every card the readers raise into
// conversations beside them, changing nothing the owner sees, and once a day says in the journal how
// many cards became how many conversations, so switching it on is decided on numbers.
import type { HqLedgerSignal } from '../../shared/hq-ledger'
import {
  HQ_LEDGER_SHADOW_KINDS,
  hqLedgerCardHandled,
  hqLedgerSignalOfCard,
  type HqLedgerInboxCard,
  type HqLedgerLookups
} from '../../shared/hq-ledger-from-inbox'

const POLL_MS = 60_000
const FIRST_POLL_MS = 45_000
/** Why: on start it catches up on the last day; ingest is idempotent per message. */
const CATCH_UP_MS = 24 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000
/** The daily line goes out after this hour, local time. */
const REPORT_HOUR = 18

export type HqLedgerShadowDeps = HqLedgerLookups & {
  enabled: () => boolean
  cards: (since: number) => HqLedgerInboxCard[]
  ingest: (signal: HqLedgerSignal) => void
  /** A message the owner handled from its card is no longer his move. */
  settle: (ts: string) => void
  conversations: (since: number) => { state: string }[]
  report: (did: string) => void
  /** Custom build (hq-request-ledger): the Slack API reader against the scout, added to the line. */
  parity?: () => string | null
  now: () => number
  onError: (error: unknown) => void
}

export type HqLedgerShadowState = {
  cursor: number
  reportedDay: string | null
  /** The last card handled that was settled. */
  handledCursor?: number
}

/** One pass: new cards into the ledger, and the day's line when it is due. Returns the next state. */
export function runHqLedgerShadow(
  deps: HqLedgerShadowDeps,
  state: HqLedgerShadowState
): HqLedgerShadowState {
  const now = deps.now()
  const since = state.cursor || now - CATCH_UP_MS
  let cursor = since
  for (const card of deps.cards(since)) {
    if (!(HQ_LEDGER_SHADOW_KINDS as readonly string[]).includes(card.kind)) {
      continue
    }
    const signal = hqLedgerSignalOfCard(card, deps)
    if (signal) {
      deps.ingest(signal)
    }
    cursor = Math.max(cursor, card.createdAt)
  }
  // Why: a card the owner sent or skipped must not come back as a To work conversation once the
  // ledger is on — also when he handled it after this pass had read it.
  let handledCursor = state.handledCursor ?? 0
  for (const card of deps.cards(now - CATCH_UP_MS)) {
    if (
      !(HQ_LEDGER_SHADOW_KINDS as readonly string[]).includes(card.kind) ||
      !hqLedgerCardHandled(card) ||
      (card.doneAt ?? 0) <= (state.handledCursor ?? 0)
    ) {
      continue
    }
    const signal = hqLedgerSignalOfCard(card, deps)
    if (signal) {
      deps.settle(signal.ts)
    }
    handledCursor = Math.max(handledCursor, card.doneAt ?? 0)
  }
  const date = new Date(now)
  const day = date.toDateString()
  if (date.getHours() >= REPORT_HOUR && state.reportedDay !== day) {
    const cards = deps
      .cards(now - DAY_MS)
      .filter((card) => (HQ_LEDGER_SHADOW_KINDS as readonly string[]).includes(card.kind)).length
    const conversations = deps.conversations(now - DAY_MS)
    const you = conversations.filter((c) => c.state === 'you').length
    const parity = deps.parity?.() ?? null
    deps.report(
      `24 h in shadow: ${cards} cards → ${conversations.length} conversations (${you} your move)${parity ? `. ${parity}` : ''}`
    )
    return { cursor, reportedDay: day, handledCursor }
  }
  return { cursor, reportedDay: state.reportedDay, handledCursor }
}

export function startHqLedgerShadow(deps: HqLedgerShadowDeps): () => void {
  let state: HqLedgerShadowState = { cursor: 0, reportedDay: null }
  const tick = (): void => {
    if (!deps.enabled()) {
      return
    }
    try {
      state = runHqLedgerShadow(deps, state)
    } catch (error) {
      deps.onError(error)
    }
  }
  const first = setTimeout(tick, FIRST_POLL_MS)
  const timer = setInterval(tick, POLL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
