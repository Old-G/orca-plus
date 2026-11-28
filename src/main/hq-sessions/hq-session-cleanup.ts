// Custom build (hq-dispatcher-cleanup, A5 28.11): which open chats the dispatcher's sweep closes to
// History by itself — only finished chats off every plan row, that the owner neither opened himself nor
// is looking at: parked after a handoff, launched by another chat and quiet with a report, or launched
// and never used. A close is the tab's ×; History brings the chat back.
import {
  HQ_CLEANUP_EMPTY_MS,
  HQ_CLEANUP_MAX_PER_SWEEP,
  HQ_CLEANUP_QUIET_MS,
  type HqCleanupReason,
  type HqLiveSession,
  type HqSweepAction
} from '../../shared/hq-sessions'
import { hqOwnerIn } from './hq-session-decide'

/** Why: a launch's first sighting lands a moment after it; activity this close to the launch is no turn. */
const EMPTY_ACTIVITY_SLACK_MS = 5 * 60_000

export type HqChatLaunchRef = { by: string; at: number }

export type HqCleanupInput = {
  sessions: readonly HqLiveSession[]
  /** The live chats on a plan row now; null when not known — then nothing closes. */
  onRow: ReadonlySet<string> | null
  /** Who launched the chat with `orca agent launch`, and when; null for a chat the owner opened. */
  launch: (sessionId: string) => HqChatLaunchRef | null
  /** The chat has a report in the journal. */
  hasReport: (sessionId: string) => boolean
  now: number
}

type HqCleanupAction = Extract<HqSweepAction, { kind: 'cleanup' }>

function minutes(ms: number): string {
  const value = Math.round(ms / 60_000)
  return value >= 120 ? `${Math.round(value / 60)} h` : `${value} min`
}

/** Finished, closable at all: open, its turn over, not the owner's to read now, no Lead, no plan row. */
function closable(session: HqLiveSession, onRow: ReadonlySet<string>, now: number): boolean {
  return (
    session.tabOpen &&
    session.state === 'done' &&
    !session.midTurn &&
    !session.onScreen &&
    !hqOwnerIn(session, now) &&
    session.role !== 'lead' &&
    session.worktreeId !== null &&
    !onRow.has(session.sessionId)
  )
}

function reasonOf(
  session: HqLiveSession,
  input: HqCleanupInput
): { reason: HqCleanupReason; why: string } | null {
  if (session.handedOffTo) {
    return { reason: 'parked', why: `handed off to ${session.handedOffTo}` }
  }
  const launch = input.launch(session.sessionId)
  // Why: a chat the owner opened himself is his to close.
  if (!launch) {
    return null
  }
  const quiet = input.now - session.lastActivityAt
  if (input.hasReport(session.sessionId)) {
    return quiet >= HQ_CLEANUP_QUIET_MS
      ? { reason: 'quiet', why: `launched by ${launch.by}, quiet ${minutes(quiet)}, reported` }
      : null
  }
  const age = input.now - launch.at
  const used =
    session.lastActivityAt > 0 && session.lastActivityAt - launch.at >= EMPTY_ACTIVITY_SLACK_MS
  return age >= HQ_CLEANUP_EMPTY_MS && quiet >= HQ_CLEANUP_EMPTY_MS && !used
    ? { reason: 'empty', why: `launched by ${launch.by} ${minutes(age)} ago and never used` }
    : null
}

/** The chats to close now, the quietest first, at most five. */
export function decideHqChatCleanup(input: HqCleanupInput): HqCleanupAction[] {
  const { onRow } = input
  if (!onRow) {
    return []
  }
  const found: (HqCleanupAction & { quietSince: number })[] = []
  for (const session of input.sessions) {
    if (!closable(session, onRow, input.now)) {
      continue
    }
    const verdict = reasonOf(session, input)
    if (verdict && session.worktreeId) {
      found.push({
        kind: 'cleanup',
        sessionId: session.sessionId,
        worktreeId: session.worktreeId,
        address: session.address,
        reason: verdict.reason,
        why: verdict.why,
        quietSince: session.lastActivityAt
      })
    }
  }
  return found
    .sort((a, b) => a.quietSince - b.quietSince)
    .slice(0, HQ_CLEANUP_MAX_PER_SWEEP)
    .map(({ quietSince: _quietSince, ...action }) => action)
}
