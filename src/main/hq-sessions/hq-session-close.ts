// Custom build (hq-plus-sessions): may a chat close, and the journal's row when it does — a chat closes
// only once its turn is in the journal. Custom build (hq-dispatcher-cleanup, A5): the sweep's own closes
// ask the same check, close the tab, and only then write the row.
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  hqJournalTitle,
  type HqSession
} from '../../shared/hq-journal'
import type { HqMayCloseResult } from '../../shared/hq-sessions'
import type { HqSessionJournal, HqSessionsDeps } from './hq-session-journal'

// Why: a finished turn's report reaches the journal within one sync; older than this it is missing.
const REPORT_GRACE_MS = 2 * 60_000

/** `cleanup`: its last turn must be reported; `handoff`: a new chat took it over; `empty`: it had no turn. */
export type HqCloseReason = 'cleanup' | 'handoff' | 'empty'

export async function hqCloseCheck(
  deps: HqSessionsDeps,
  journal: HqSessionJournal,
  sessionId: string,
  reason: HqCloseReason
): Promise<{ ok: true; session: HqSession | null } | { ok: false; why: string }> {
  await deps.sync().catch(() => undefined)
  const session = deps.pulse.getSession(sessionId)
  // Why: a handoff's chat is closed the moment its successor starts; its handoff file is the report.
  if (reason !== 'handoff') {
    const live = (await deps.live()).find((candidate) => candidate.sessionId === sessionId)
    if (live?.midTurn) {
      return { ok: false, why: 'its turn has not ended' }
    }
  }
  if (session && reason === 'cleanup') {
    const report = journal.lastReport(sessionId)
    if (!report || report.at < session.lastActivityAt - REPORT_GRACE_MS) {
      return { ok: false, why: 'its last turn has no report in the journal yet' }
    }
  }
  if (reason === 'empty' && journal.lastReport(sessionId)) {
    return { ok: false, why: 'it has a report' }
  }
  return { ok: true, session }
}

function closeTitle(reason: HqCloseReason, session: HqSession | null, now: number): string {
  if (reason === 'handoff') {
    return `Closed to History: a new chat took ${session?.address ?? 'its work'} over`
  }
  if (reason === 'empty') {
    return 'Closed to History: launched and never used'
  }
  return session
    ? `Closed to History: quiet ${Math.round((now - session.lastActivityAt) / 3_600_000)} h`
    : 'Closed to History'
}

export function hqRecordClose(
  deps: HqSessionsDeps,
  journal: HqSessionJournal,
  sessionId: string,
  reason: HqCloseReason,
  session: HqSession | null
): void {
  deps.pulse.record([
    journal.row({
      workspace: session?.workspace ?? HQ_JOURNAL_ALL_ROOMS,
      kind: HQ_JOURNAL_KIND.sessionClose,
      project: session?.project ?? null,
      address: session?.address ?? null,
      sessionId,
      title: hqJournalTitle(closeTitle(reason, session, deps.now())),
      needs: 'nobody',
      status: 'done',
      refKind: 'session',
      refId: sessionId,
      dedupeKey: `${HQ_JOURNAL_KIND.sessionClose}:${sessionId}:${session?.lastActivityAt ?? 0}`
    })
  ])
  if (session) {
    // Why: closing is not activity; a chat closed after a quiet day must not look fresh to continue.
    deps.pulse.noteSessions([{ ...session, state: 'closed', at: session.lastActivityAt }])
  }
}

/** The check chat cleanup asks before it closes a chat; ok writes the close row. */
export async function hqMayClose(
  deps: HqSessionsDeps,
  journal: HqSessionJournal,
  sessionId: string,
  reason: 'cleanup' | 'handoff'
): Promise<HqMayCloseResult> {
  if (!deps.enabled()) {
    return { ok: true }
  }
  const checked = await hqCloseCheck(deps, journal, sessionId, reason)
  if (!checked.ok) {
    return checked
  }
  hqRecordClose(deps, journal, sessionId, reason, checked.session)
  return { ok: true }
}
