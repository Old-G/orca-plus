// Custom build (hq-plus-sessions): HQ+'s session dispatcher. `orca hq dispatch` hands work to a
// thread — its chat continues it, a new chat takes it over, or it waits in the queue; a timer drains
// the queue and starts handoffs nobody took up; a chat closes only once its turn is in the journal.
// Off does nothing, report mode only writes what it would do, on acts.
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  hqJournalTitle,
  isHqThreadAddress
} from '../../shared/hq-journal'
import {
  type HqDispatchDecision,
  type HqDispatchResult,
  type HqMayCloseResult,
  type HqSessionsResult
} from '../../shared/hq-sessions'
import type { HqCaller } from '../hq-journal/hq-journal-rooms'
import { carryOutHqDispatch } from './hq-session-act'
import { decideHqDispatch } from './hq-session-decide'
import {
  createHqSessionJournal,
  describeHqDispatch,
  hqWorkKey,
  type HqSessionsDeps
} from './hq-session-journal'
import { sweepHqSessions } from './hq-session-sweep'

export type { HqHandoffOfferRef, HqSessionsDeps } from './hq-session-journal'

// Why: a finished turn's report reaches the journal within one sync; older than this it is missing.
const REPORT_GRACE_MS = 2 * 60_000
const OFF = 'The session dispatcher is off (Settings → Workspace → «Session dispatcher»).'

export type HqDispatchRequest = { address: string; prompt: string; dryRun?: boolean }

export type HqSessionsService = {
  dispatch: (caller: HqCaller, request: HqDispatchRequest) => Promise<HqDispatchResult>
  /** The chats and what the dispatcher would do now; `run` carries it out (mode on). */
  sweep: (options?: { run?: boolean }) => Promise<HqSessionsResult>
  mayClose: (sessionId: string, reason: 'cleanup' | 'handoff') => Promise<HqMayCloseResult>
}

export function createHqSessions(deps: HqSessionsDeps): HqSessionsService {
  const journal = createHqSessionJournal(deps)
  let sweeping: Promise<HqSessionsResult> | null = null

  return {
    async dispatch(caller, request) {
      const address = request.address.trim()
      if (!isHqThreadAddress(address)) {
        throw new Error(`Not a thread address (<project>/<task>): ${request.address}`)
      }
      if (!request.prompt.trim()) {
        throw new Error('Say what the work is: --prompt <text>.')
      }
      const project = address.split('/')[0] ?? ''
      const scope = await deps.scope(caller)
      if (scope.kind === 'room' && (await deps.roomOf(project)) !== scope.room) {
        throw new Error(
          `${project} is not in this chat's room; only HQ+ dispatches to other rooms.`
        )
      }
      const mode = deps.mode()
      const dryRun = request.dryRun === true
      const decision = decideHqDispatch({
        project,
        address,
        sessions: await deps.live([address]),
        now: deps.now()
      })
      const result = (
        acted: boolean,
        done: { decision: HqDispatchDecision; sessionId: string | null; entryId: string | null },
        note: string | null
      ): HqDispatchResult => ({
        mode,
        dryRun,
        acted,
        decision: done.decision,
        sessionId: done.sessionId,
        entryId: done.entryId,
        note
      })
      const nothing = { decision, sessionId: null, entryId: null }
      if (dryRun) {
        return result(false, nothing, null)
      }
      if (mode === 'off' || !deps.enabled()) {
        return result(false, nothing, OFF)
      }
      if (mode === 'report') {
        const entryId = await journal.plan(
          describeHqDispatch(decision),
          project,
          address,
          `${HQ_JOURNAL_KIND.sessionPlan}:dispatch:${address}:${hqWorkKey(request.prompt)}`
        )
        return result(
          false,
          { ...nothing, entryId },
          'Report mode: written to the journal, nothing done. Hand it over yourself (`orca chat send`) or switch the dispatcher on.'
        )
      }
      return result(
        true,
        await carryOutHqDispatch(deps, journal, caller, decision, request.prompt),
        null
      )
    },

    sweep(options = {}) {
      const run = options.run === true
      if (!run) {
        return sweepHqSessions(deps, journal, false)
      }
      // Why: the timer and a manual run must not start one handoff twice.
      if (!sweeping) {
        sweeping = sweepHqSessions(deps, journal, true).finally(() => {
          sweeping = null
        })
      }
      return sweeping
    },

    async mayClose(sessionId, reason) {
      if (!deps.enabled()) {
        return { ok: true }
      }
      await deps.sync().catch(() => undefined)
      const session = deps.pulse.getSession(sessionId)
      // Why: a handoff's chat is closed the moment its successor starts; its handoff file is the report.
      if (reason === 'cleanup') {
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
      const now = deps.now()
      const quiet = session ? now - session.lastActivityAt : null
      const workspace = session?.workspace ?? HQ_JOURNAL_ALL_ROOMS
      deps.pulse.record([
        journal.row({
          workspace,
          kind: HQ_JOURNAL_KIND.sessionClose,
          project: session?.project ?? null,
          address: session?.address ?? null,
          sessionId,
          title: hqJournalTitle(
            reason === 'handoff'
              ? `Closed to History: a new chat took ${session?.address ?? 'its work'} over`
              : quiet === null
                ? 'Closed to History'
                : `Closed to History: quiet ${Math.round(quiet / 3_600_000)} h`
          ),
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
      return { ok: true }
    }
  }
}

let provided: HqSessionsService | null = null

export function provideHqSessions(service: HqSessionsService | null): void {
  provided = service
}

export function getHqSessions(): HqSessionsService | null {
  return provided
}
