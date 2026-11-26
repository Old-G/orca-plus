// Custom build (hq-plus-sessions): the dispatcher's rules, without side effects — continue the
// thread's chat, open a new one seeded from it, or queue; and when a handoff starts by itself.
import {
  HQ_SESSION_CONTINUE_BELOW_PCT,
  HQ_SESSION_LEAD_HANDOVER_GRACE_MS,
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
  const onThread = input.sessions.filter((session) => session.address === address)
  // Custom build (hq-handoff-parked, T7): a chat that handed off is parked; the one that continues it
  // takes the thread's work even while the old one is still finishing its turn.
  const unparked = onThread.filter((session) => !session.handedOffTo)
  const latest = (unparked.length > 0 ? unparked : onThread).sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt
  )[0]
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
  /** Custom build (hq-handoff-auto): that chat stopped on a usage limit or a rejected sign-in. */
  limitStopped: boolean
  /** How long the owner gets to take the offer up himself. */
  graceMs: number
  /**
   * Custom build (hq-handoff-auto, owner 24.11): «New chat after a handoff» is on — the new chat
   * starts even beside a chat on his screen; the old one stays open for him to close.
   */
  auto?: boolean
  now: number
}

/**
 * Whether to start a handoff's successor now. The old chat has stopped, so a new chat beside it
 * touches nothing of the owner's; only a chat on his screen right now is left for his own click.
 * He gets a moment to take it up himself. The successor replaces its predecessor, so no cap.
 */
export function decideHqHandoff(
  input: HqHandoffInput
): { start: true; why: string } | { start: false; why: string } {
  if (input.session?.onScreen && !input.auto) {
    return { start: false, why: `the owner is looking at ${label(input.session)}` }
  }
  // Why: a new chat would stop on the same limit; the limit guard leaves a handed-off chat alone, and
  // once the limit lifts its stop is gone and the successor starts.
  if (input.limitStopped) {
    return { start: false, why: 'its chat stopped on a limit; the new one waits until it lifts' }
  }
  const age = input.now - input.raisedAt
  if (age < input.graceMs) {
    return { start: false, why: 'the offer is fresh; the owner may take it up' }
  }
  const ago = age < 60_000 ? `${Math.round(age / 1000)} s` : `${Math.round(age / 60_000)} min`
  return {
    start: true,
    why: input.session ? `${label(input.session)} handed off ${ago} ago` : `a handoff waited ${ago}`
  }
}

/** What the sweep needs of a plan's `Lead chat:` line: who leads now, and who the line names as before. */
export type HqLeadLine = { current: readonly string[]; was: readonly string[]; text?: string }

export type HqLeadHandoverInput = {
  sessions: readonly HqLiveSession[]
  plans: readonly HqLeadLine[]
  /** The chat that started `sessionId` with `orca agent launch`; null when none did. */
  launchedBy: (sessionId: string) => string | null
}

export type HqLeadHandover = {
  from: HqLiveSession
  to: HqLiveSession
  sameThread: boolean
  why: string
}

function isOpenLead(session: HqLiveSession): boolean {
  return session.role === 'lead' && session.tabOpen && session.state !== 'closed'
}

function named(words: readonly string[], session: HqLiveSession): boolean {
  return (
    words.includes(session.sessionId) ||
    (session.address !== null && words.includes(session.address))
  )
}

function mentions(text: string | undefined, session: HqLiveSession): boolean {
  return (
    text !== undefined &&
    (text.includes(session.sessionId) ||
      (session.address !== null && text.includes(session.address)))
  )
}

/**
 * Custom build (hq-lead-handover, T2): Leads whose work another live chat took over. Two signs:
 * the Lead's context handoff went to a live chat (same thread), or a plan's `Lead chat:` line now names a
 * live Lead that the old one started and the plan names as before (or the line keeps the old one as «was») while no plan names the old
 * Lead any more. A Lead a plan still names, or one nobody took over from, is left alone.
 */
export function decideHqLeadHandovers(input: HqLeadHandoverInput): HqLeadHandover[] {
  const leads = input.sessions.filter(isOpenLead)
  const found: HqLeadHandover[] = []
  for (const old of leads) {
    const next = old.handedOffTo
      ? input.sessions.find(
          (candidate) =>
            candidate.sessionId === old.handedOffTo &&
            candidate.tabOpen &&
            candidate.state !== 'closed' &&
            (candidate.role === 'lead' || candidate.role === null)
        )
      : undefined
    if (next) {
      found.push({
        from: old,
        to: next,
        sameThread: true,
        why: `${label(old)} handed off to ${label(next)}`
      })
      continue
    }
    if (input.plans.some((plan) => named(plan.current, old))) {
      continue
    }
    const successor = leads
      .filter(
        (candidate) =>
          candidate.sessionId !== old.sessionId &&
          input.plans.some(
            (plan) =>
              named(plan.current, candidate) &&
              (named(plan.was, old) ||
                (input.launchedBy(candidate.sessionId) === old.sessionId &&
                  mentions(plan.text, old)))
          )
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
    if (successor) {
      found.push({
        from: old,
        to: successor,
        sameThread: false,
        why: `the plan names ${label(successor)} as Lead, not ${label(old)}`
      })
    }
  }
  return found
}

/**
 * The old Lead closes once its chats moved, the grace is over, its turn has ended and it is not on the
 * owner's screen; until then the sweep asks again.
 */
export function decideHqLeadClose(input: {
  session: HqLiveSession
  movedAt: number
  now: number
}): { close: true } | { close: false; why: string } {
  if (input.now - input.movedAt < HQ_SESSION_LEAD_HANDOVER_GRACE_MS) {
    return { close: false, why: 'its chats moved a moment ago' }
  }
  if (input.session.midTurn) {
    return { close: false, why: 'its turn has not ended' }
  }
  if (input.session.onScreen) {
    return { close: false, why: 'the owner is looking at it' }
  }
  return { close: true }
}
