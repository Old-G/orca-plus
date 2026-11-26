// Custom build (hq-lead-handover, T2): the old Lead of a plan closes itself. The sweep sees that a plan's
// `Lead chat:` names another live chat, does what `orca hq reassign --from <old> --to <new>` does (the
// chats and held messages go to the new Lead), and closes the old chat once the grace is over.
import { HQ_JOURNAL_ALL_ROOMS, HQ_JOURNAL_KIND, hqJournalTitle } from '../../shared/hq-journal'
import type { HqLiveSession, HqSweepAction } from '../../shared/hq-sessions'
import { decideHqLeadClose, decideHqLeadHandovers } from './hq-session-decide'
import type { HqSessionJournal, HqSessionsDeps } from './hq-session-journal'

type LeadHandoverAction = Extract<HqSweepAction, { kind: 'lead-handover' }>

/** The Lead handovers now: what the plans and the chats say. */
export async function findHqLeadHandovers(
  deps: Pick<HqSessionsDeps, 'planLeads' | 'launchedBy' | 'log'>,
  live: readonly HqLiveSession[]
): Promise<LeadHandoverAction[]> {
  const leads = live.filter(
    (session) => session.role === 'lead' && session.tabOpen && session.state !== 'closed'
  )
  // Why: one open Lead with no handoff has nobody to hand over to; the plans are not read for it.
  if (leads.length < 2 && !leads.some((session) => session.handedOffTo)) {
    return []
  }
  const plans = await deps.planLeads().catch((error: unknown) => {
    deps.log(`sweep: the plans' Lead lines were not read: ${String(error)}`)
    return []
  })
  return decideHqLeadHandovers({ sessions: live, plans, launchedBy: deps.launchedBy }).map(
    (found) => ({
      kind: 'lead-handover',
      from: found.from.sessionId,
      to: found.to.sessionId,
      sameThread: found.sameThread,
      why: found.why
    })
  )
}

export function hqLeadHandoverKey(action: LeadHandoverAction): string {
  return `${HQ_JOURNAL_KIND.sessionPlan}:lead-handover:${action.from}:${action.to}`
}

/** One step: move the old Lead's chats (the first sweep), close the old chat (a later one). */
export async function carryOutHqLeadHandover(
  deps: HqSessionsDeps,
  journal: HqSessionJournal,
  action: LeadHandoverAction,
  live: readonly HqLiveSession[]
): Promise<void> {
  const old = live.find((session) => session.sessionId === action.from)
  const next = live.find((session) => session.sessionId === action.to)
  if (!old || !next) {
    return
  }
  const key = hqLeadHandoverKey(action)
  const moved = journal.recorded(key)
  if (!moved) {
    // Why: a handoff on the Lead's own address keeps its chats and messages there; nothing to move.
    if (!action.sameThread) {
      const result = await deps.reassignLead(old.sessionId, next.sessionId)
      if (!result.ok) {
        deps.log(
          `sweep: the Lead handover ${old.sessionId} → ${next.sessionId} failed: ${result.error}`
        )
        return
      }
    }
    deps.pulse.record([
      journal.row({
        workspace: old.project ? await deps.roomOf(old.project) : HQ_JOURNAL_ALL_ROOMS,
        kind: HQ_JOURNAL_KIND.sessionPlan,
        at: deps.now(),
        project: old.project,
        address: old.address,
        sessionId: old.sessionId,
        title: hqJournalTitle(
          `Lead handover: ${next.address ?? next.sessionId} leads now; ${old.address ?? old.sessionId} closes in 2 min`
        ),
        needs: 'nobody',
        status: 'done',
        refKind: 'session',
        refId: next.sessionId,
        dedupeKey: key
      })
    ])
    return
  }
  const verdict = decideHqLeadClose({ session: old, movedAt: moved.at, now: deps.now() })
  if (!verdict.close) {
    return
  }
  if (!(await deps.closeChat(old.sessionId, old.worktreeId))) {
    deps.log(`sweep: the old Lead ${old.sessionId} did not close; it is tried again next sweep`)
  }
}
