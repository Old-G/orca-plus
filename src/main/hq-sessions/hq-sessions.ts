// Custom build (hq-plus-sessions): HQ+'s session dispatcher. `orca hq dispatch` hands work to a
// thread — its chat continues it, a new chat takes it over, or it waits in the queue; a timer drains
// the queue and starts handoffs nobody took up; a chat closes only once its turn is in the journal.
// Off does nothing, report mode only writes what it would do, on acts.
import { HQ_JOURNAL_KIND, isHqThreadAddress } from '../../shared/hq-journal'
import type {
  HqDispatchDecision,
  HqDispatchResult,
  HqLiveSession,
  HqMayCloseResult,
  HqSessionsResult
} from '../../shared/hq-sessions'
import type { HqCaller } from '../hq-journal/hq-journal-rooms'
import { carryOutHqDispatch, HqChatOpeningError } from './hq-session-act'
import { decideHqDispatch } from './hq-session-decide'
import { decideHqColdChat } from './hq-cold-chat'
import { hqMayClose } from './hq-session-close'
import {
  createHqSessionJournal,
  describeHqDispatch,
  hqWorkKey,
  type HqSessionsDeps
} from './hq-session-journal'
import { sweepHqSessions } from './hq-session-sweep'

export type { HqHandoffOfferRef, HqSessionsDeps } from './hq-session-journal'

const OFF = 'The session dispatcher is off (Settings → Workspace → «Session dispatcher»).'

export type HqDispatchRequest = { address: string; prompt: string; dryRun?: boolean }

export type HqSessionsService = {
  dispatch: (caller: HqCaller, request: HqDispatchRequest) => Promise<HqDispatchResult>
  /** The chats and what the dispatcher would do now; `run` carries it out (mode on). */
  sweep: (options?: { run?: boolean }) => Promise<HqSessionsResult>
  mayClose: (sessionId: string, reason: 'cleanup' | 'handoff') => Promise<HqMayCloseResult>
  /**
   * Custom build (hq-cold-handoff, L3): with the switch on, a message for a cold chat (quiet over an hour,
   * 100k+ tokens) starts a new chat on its thread from its report, which takes `work`; its session id, or
   * null — then the message goes to the old chat as before.
   */
  coldHandoff: (request: {
    sessionId: string
    work: string
    from: string | null
  }) => Promise<string | null>
  /** Custom build (hq-lead-reassign): the chats now, nothing carried out. */
  live: () => Promise<HqLiveSession[]>
}

export function createHqSessions(deps: HqSessionsDeps): HqSessionsService {
  const journal = createHqSessionJournal(deps)
  let sweeping: Promise<HqSessionsResult> | null = null

  return {
    live: () => deps.live(),

    async dispatch(caller, request) {
      const address = request.address.trim()
      if (!isHqThreadAddress(address)) {
        throw new Error(`Not a thread address (<project>/<task>): ${request.address}`)
      }
      if (!request.prompt.trim()) {
        throw new Error('Say what the work is: --prompt <text>.')
      }
      // Custom build (chat-send-anywhere): a chat of any room hands work to any room's thread.
      const project = address.split('/')[0] ?? ''
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
      try {
        return result(
          true,
          await carryOutHqDispatch(deps, journal, caller, decision, request.prompt),
          null
        )
      } catch (error) {
        // Custom build (hq-handoff-once): a second piece of work while the thread's new chat opens
        // waits in the queue; the sweep hands it to that chat instead of dropping it.
        if (!(error instanceof HqChatOpeningError)) {
          throw error
        }
        const queued: HqDispatchDecision = {
          kind: 'queue',
          address: decision.address,
          why: 'its new chat is still opening'
        }
        return result(
          true,
          await carryOutHqDispatch(deps, journal, caller, queued, request.prompt),
          null
        )
      }
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

    mayClose: (sessionId, reason) => hqMayClose(deps, journal, sessionId, reason),

    async coldHandoff(request) {
      if (deps.coldChatHandoff?.() !== true || !deps.enabled()) {
        return null
      }
      try {
        const session = (await deps.live()).find(
          (candidate) => candidate.sessionId === request.sessionId
        )
        const tokens = session ? ((await deps.contextTokens?.(session.sessionId)) ?? null) : null
        const verdict = decideHqColdChat({ session, tokens, from: request.from, now: deps.now() })
        if (!verdict.cold || !session?.address) {
          return null
        }
        const done = await carryOutHqDispatch(
          deps,
          journal,
          deps.dispatcherCaller(),
          {
            kind: 'new',
            address: session.address,
            project: session.address.split('/')[0] ?? '',
            seedFrom: session.sessionId,
            why: `a message came to a cold chat: ${verdict.why}`
          },
          request.work
        )
        return done.sessionId
      } catch (error) {
        // Why: a new chat that did not start must not lose the message; it goes to the old chat.
        deps.log(
          `cold handoff of ${request.sessionId} failed, delivering as before: ${error instanceof Error ? error.message : String(error)}`
        )
        return null
      }
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
