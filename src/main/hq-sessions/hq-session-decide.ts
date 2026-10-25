// Custom build (hq-plus-sessions): the dispatcher's rules, without side effects — continue the
// thread's chat, open a new one seeded from it, or queue; and when a handoff starts by itself.
import {
  HQ_SESSION_CONTINUE_BELOW_PCT,
  HQ_SESSION_HANDOFF_GRACE_MS,
  HQ_SESSION_OWNER_IN_MS,
  HQ_SESSION_QUIET_MS,
  type HqDispatchDecision,
  type HqLiveSession
} from '../../shared/hq-sessions'

function hours(ms: number): string {
  const value = ms / 3_600_000
  return value >= 10 ? `${Math.round(value)} h` : `${value.toFixed(1)} h`
}

function label(session: HqLiveSession): string {
  return session.name ? `«${session.name}»` : session.sessionId
}

export function hqOwnerIn(session: HqLiveSession, now: number): boolean {
  return session.ownerAt !== null && now - session.ownerAt < HQ_SESSION_OWNER_IN_MS
}

export type HqDispatchInput = {
  project: string
  address: string
  sessions: readonly HqLiveSession[]
  now: number
}

/**
 * Section 11 of the HQ+ plan: the same thread continues in its chat while context < 60% and it was
 * active in the last 12 h; otherwise a new chat takes it over, seeded from the old one. A chat the
 * owner is in, or one mid-turn, is not handed work — it waits in the queue. New chats have no cap.
 */
export function decideHqDispatch(input: HqDispatchInput): HqDispatchDecision {
  const { address, project, now } = input
  const latest = input.sessions
    .filter((session) => session.address === address)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
  let seedFrom: string | null = null
  let why = 'no chat has worked on this thread'
  if (latest) {
    const quiet = now - latest.lastActivityAt
    // Why: a second chat on a thread mid-turn would do the same work twice; one «working» for
    // 12 h has hung, and waiting on it would lose the work.
    if (latest.midTurn && quiet < HQ_SESSION_QUIET_MS) {
      const why =
        latest.state === 'working'
          ? 'is mid-turn'
          : "is mid-turn, waiting for the owner's permission"
      return { kind: 'queue', address, why: `${label(latest)} ${why}` }
    }
    const full = latest.contextPct !== null && latest.contextPct >= HQ_SESSION_CONTINUE_BELOW_PCT
    if (!full && quiet < HQ_SESSION_QUIET_MS) {
      // Why: only work typed into his chat would cut across the owner; a new chat beside it does not.
      if (latest.tabOpen && hqOwnerIn(latest, now)) {
        return { kind: 'queue', address, why: `the owner is in ${label(latest)}` }
      }
      const context =
        latest.contextPct === null ? 'context unknown' : `context ${latest.contextPct}%`
      return {
        kind: 'continue',
        address,
        sessionId: latest.sessionId,
        why: `${label(latest)}: ${context}, active ${hours(quiet)} ago`
      }
    }
    seedFrom = latest.sessionId
    why = full
      ? `${label(latest)} is ${latest.contextPct}% full`
      : `${label(latest)} has been quiet ${hours(quiet)}`
  }
  return { kind: 'new', address, project, seedFrom, why }
}

export type HqHandoffInput = {
  /** When the offer was raised. */
  raisedAt: number
  /** The chat that wrote the handoff; null when the dispatcher does not know it. */
  session: HqLiveSession | null
  now: number
}

/**
 * Whether to start a handoff's successor now. The old chat has stopped, so a new chat beside it
 * touches nothing of the owner's; only a chat he is looking at right now is left for his own click.
 * He gets a few minutes to take it up himself. The successor replaces its predecessor, so no cap.
 */
export function decideHqHandoff(
  input: HqHandoffInput
): { start: true; why: string } | { start: false; why: string } {
  const lookedAt = input.session?.ownerAt ?? null
  if (input.session && lookedAt !== null && input.now - lookedAt < HQ_SESSION_HANDOFF_GRACE_MS) {
    return { start: false, why: `the owner is looking at ${label(input.session)}` }
  }
  const age = input.now - input.raisedAt
  if (age < HQ_SESSION_HANDOFF_GRACE_MS) {
    return { start: false, why: 'the offer is fresh; the owner may take it up' }
  }
  return {
    start: true,
    why: input.session
      ? `${label(input.session)} handed off ${Math.round(age / 60_000)} min ago`
      : `a handoff waited ${Math.round(age / 60_000)} min`
  }
}
