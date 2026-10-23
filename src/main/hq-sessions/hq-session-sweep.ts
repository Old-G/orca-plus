// Custom build (hq-plus-sessions): the dispatcher's sweep — handoffs nobody took up, queued work
// that can go now, and threads with open work but no chat — listed, and on a run carried out.
import { HQ_JOURNAL_KIND, HQ_JOURNAL_MAX_LIMIT, isHqThreadAddress } from '../../shared/hq-journal'
import type { HqSessionsResult, HqSweepAction } from '../../shared/hq-sessions'
import { journalEntryAsInput } from '../hq-journal/hq-journal-adapters'
import { carryOutHqDispatch } from './hq-session-act'
import { decideHqDispatch, decideHqHandoff } from './hq-session-decide'
import {
  describeHqDispatch,
  type HqSessionJournal,
  type HqSessionsDeps
} from './hq-session-journal'

// Why: work handed to a thread a moment ago may still be on its way to a chat.
const LOST_AFTER_MS = 15 * 60_000

export async function sweepHqSessions(
  deps: HqSessionsDeps,
  journal: HqSessionJournal,
  run: boolean
): Promise<HqSessionsResult> {
  const mode = deps.mode()
  const now = deps.now()
  const queued = deps.pulse.list({
    kind: HQ_JOURNAL_KIND.sessionQueued,
    status: 'open',
    oldestFirst: true,
    limit: HQ_JOURNAL_MAX_LIMIT
  })
  const live = await deps.live(queued.flatMap((entry) => (entry.address ? [entry.address] : [])))
  const open = journal.unreviewed()
  const actions: HqSweepAction[] = []
  for (const offer of deps.offers()) {
    const session = offer.sessionId
      ? (live.find((candidate) => candidate.sessionId === offer.sessionId) ?? null)
      : null
    const verdict = decideHqHandoff({ raisedAt: offer.raisedAt, session, now })
    if (verdict.start && offer.sessionId) {
      actions.push({
        kind: 'successor',
        offerId: offer.id,
        sessionId: offer.sessionId,
        address: session?.address ?? null,
        why: verdict.why
      })
    }
  }
  for (const entry of queued) {
    if (!entry.address || !entry.project) {
      continue
    }
    const decision = decideHqDispatch({
      project: entry.project,
      address: entry.address,
      sessions: live,
      unreviewed: open,
      now
    })
    if (decision.kind !== 'queue') {
      actions.push({ kind: 'drain', entryId: entry.id, decision })
    }
  }
  const onThread = new Set(
    live
      .filter((session) => session.address && session.tabOpen && session.state !== 'closed')
      .map((session) => session.address)
  )
  const handed = new Map<string, string[]>()
  for (const entry of deps.pulse.list({
    needs: 'agent',
    status: 'open',
    limit: HQ_JOURNAL_MAX_LIMIT
  })) {
    const address = entry.needs.slice('agent:'.length)
    if (
      isHqThreadAddress(address) &&
      entry.kind !== HQ_JOURNAL_KIND.sessionQueued &&
      now - entry.at >= LOST_AFTER_MS &&
      !onThread.has(address)
    ) {
      handed.set(address, [...(handed.get(address) ?? []), entry.id])
    }
  }
  for (const [address, entryIds] of handed) {
    actions.push({
      kind: 'lost',
      address,
      entryIds,
      why: `${entryIds.length} open ${entryIds.length === 1 ? 'row waits' : 'rows wait'} for a chat on ${address}, and none is open`
    })
  }
  const result: HqSessionsResult = {
    mode,
    dryRun: !run,
    sessions: live,
    queued: queued.length,
    unreviewed: open,
    actions
  }
  if (!run || mode === 'off' || !deps.enabled()) {
    return result
  }
  for (const action of actions) {
    try {
      if (action.kind === 'successor') {
        const project = live.find((session) => session.sessionId === action.sessionId)?.project
        if (mode === 'report') {
          await journal.plan(
            `start the handoff of ${action.address ?? action.sessionId}: ${action.why}`,
            project ?? null,
            action.address,
            `${HQ_JOURNAL_KIND.sessionPlan}:successor:${action.offerId}`
          )
          continue
        }
        const started = await deps.startHandoff(action.offerId)
        if (!started.ok) {
          deps.log(`sweep: the handoff ${action.offerId} did not start: ${started.error}`)
        }
      } else if (action.kind === 'drain') {
        const entry = queued.find((candidate) => candidate.id === action.entryId)
        if (!entry) {
          continue
        }
        if (mode === 'report') {
          await journal.plan(
            describeHqDispatch(action.decision),
            entry.project,
            entry.address,
            `${HQ_JOURNAL_KIND.sessionPlan}:drain:${entry.id}:${action.decision.kind}`
          )
          continue
        }
        await carryOutHqDispatch(
          deps,
          journal,
          deps.dispatcherCaller(),
          action.decision,
          entry.body ?? ''
        )
        deps.pulse.record([journalEntryAsInput(entry, { status: 'done' })])
      }
    } catch (error) {
      deps.log(
        `sweep: ${action.kind} failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return result
}
