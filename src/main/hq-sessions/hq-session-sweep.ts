// Custom build (hq-plus-sessions): the dispatcher's sweep — handoffs nobody took up, queued work
// that can go now, and threads with open work but no chat — listed, and on a run carried out.
// Custom build (hq-handoff-auto): a handoff's successor starts by its own switch, whatever the mode.
import {
  HQ_JOURNAL_ALL_ROOMS,
  HQ_JOURNAL_KIND,
  HQ_JOURNAL_MAX_LIMIT,
  hqJournalTitle,
  isHqThreadAddress
} from '../../shared/hq-journal'
import {
  HQ_SESSION_HANDOFF_AUTO_GRACE_MS,
  HQ_SESSION_HANDOFF_GRACE_MS,
  type HqSessionsResult,
  type HqSweepAction
} from '../../shared/hq-sessions'
import { journalEntryAsInput } from '../hq-journal/hq-journal-adapters'
import { carryOutHqDispatch } from './hq-session-act'
import { decideHqChatCleanup } from './hq-session-cleanup'
import { hqCloseCheck, hqRecordClose } from './hq-session-close'
import { decideHqDispatch, decideHqHandoff } from './hq-session-decide'
import { carryOutHqLeadHandover, findHqLeadHandovers } from './hq-session-lead-handover'
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
  const auto = deps.autoHandoff()
  const actions: HqSweepAction[] = []
  for (const offer of deps.offers()) {
    const session = offer.sessionId
      ? (live.find((candidate) => candidate.sessionId === offer.sessionId) ?? null)
      : null
    const verdict = decideHqHandoff({
      raisedAt: offer.raisedAt,
      session,
      limitStopped: offer.limitStopped,
      graceMs: auto ? HQ_SESSION_HANDOFF_AUTO_GRACE_MS : HQ_SESSION_HANDOFF_GRACE_MS,
      auto,
      now
    })
    // Custom build (hq-handoff-once): with auto-start on, the owner sees the offer only when it waits.
    if (auto && !verdict.start && offer.limitStopped) {
      deps.handoffNotStarted?.(offer.id, verdict.why)
    }
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
      now
    })
    if (decision.kind !== 'queue') {
      actions.push({ kind: 'drain', entryId: entry.id, decision })
    }
  }
  actions.push(...(await findHqLeadHandovers(deps, live)))
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
  // Custom build (hq-dispatcher-cleanup, A5): chats nobody needs open, by their own switch.
  const cleanup = deps.enabled() ? (deps.cleanupMode?.() ?? 'off') : 'off'
  if (cleanup !== 'off' && deps.planRowChats && deps.launchOf) {
    const launchOf = deps.launchOf
    actions.push(
      ...decideHqChatCleanup({
        sessions: live,
        onRow: deps.planRowChats(),
        launch: (sessionId) => launchOf(sessionId),
        hasReport: (sessionId) => journal.lastReport(sessionId) !== null,
        now
      })
    )
  }
  const result: HqSessionsResult = {
    mode,
    dryRun: !run,
    sessions: live,
    queued: queued.length,
    unreviewed: open,
    actions
  }
  const dispatching = mode !== 'off' && deps.enabled()
  if (!run || (!dispatching && !auto && cleanup === 'off')) {
    return result
  }
  for (const action of actions) {
    try {
      if (action.kind === 'successor') {
        const project = live.find((session) => session.sessionId === action.sessionId)?.project
        if (!auto && !dispatching) {
          continue
        }
        if (!auto && mode === 'report') {
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
          if (!started.skipped) {
            deps.handoffNotStarted?.(action.offerId, started.error)
          }
          continue
        }
        if (!deps.enabled()) {
          continue
        }
        // Why: the started chat opens with the same «Continue from …» line a hand start has;
        // the evening count of manual routing (17.11) tells them apart by this row.
        deps.pulse.record([
          journal.row({
            workspace: project ? await deps.roomOf(project) : HQ_JOURNAL_ALL_ROOMS,
            kind: HQ_JOURNAL_KIND.sessionOpen,
            project: project ?? null,
            address: action.address,
            sessionId: null,
            title: hqJournalTitle(
              `Started the handoff of ${action.address ?? action.sessionId}: ${action.why}`
            ),
            needs: 'nobody',
            status: 'done',
            refKind: 'session',
            refId: action.sessionId,
            dedupeKey: `${HQ_JOURNAL_KIND.sessionOpen}:handoff:${action.offerId}`
          })
        ])
      } else if (action.kind === 'lead-handover') {
        // Why: like a handoff's successor, the owner's «New chat after a handoff» switch lets it run.
        // Custom build (hq-handoff-once, owner 27.11): report mode carries it out too — a note in the plan
        // left two Leads working on one plan. It opens no chat; it moves chats and closes one.
        if (!auto && !dispatching) {
          continue
        }
        await carryOutHqLeadHandover(deps, journal, action, live)
      } else if (action.kind === 'cleanup') {
        await carryOutHqCleanup(deps, journal, action, cleanup === 'on')
      } else if (action.kind === 'drain') {
        if (!dispatching) {
          continue
        }
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
      const message = error instanceof Error ? error.message : String(error)
      deps.log(`sweep: ${action.kind} failed: ${message}`)
      // Custom build (hq-handoff-once): a start that threw is a failure too — the offer, hidden
      // while auto-start runs, comes back as a card instead of failing silently every sweep.
      if (action.kind === 'successor') {
        deps.handoffNotStarted?.(action.offerId, message)
      }
    }
  }
  return result
}

/** Custom build (hq-dispatcher-cleanup, A5): report mode writes «Would close …»; on closes the tab — the
 *  same check `mayClose` asks first, the journal row only once the tab is closed. */
async function carryOutHqCleanup(
  deps: HqSessionsDeps,
  journal: HqSessionJournal,
  action: Extract<HqSweepAction, { kind: 'cleanup' }>,
  act: boolean
): Promise<void> {
  const label = action.address ?? action.sessionId
  if (!act) {
    await journal.plan(
      `close ${label} to History: ${action.why}`,
      action.address?.split('/')[0] ?? null,
      action.address,
      `${HQ_JOURNAL_KIND.sessionPlan}:cleanup:${action.sessionId}:${action.reason}`
    )
    return
  }
  const reason =
    action.reason === 'parked' ? 'handoff' : action.reason === 'empty' ? 'empty' : 'cleanup'
  const checked = await hqCloseCheck(deps, journal, action.sessionId, reason)
  if (!checked.ok) {
    deps.log(`sweep: ${label} stays open: ${checked.why}`)
    return
  }
  if (!(await deps.closeChat(action.sessionId, action.worktreeId))) {
    deps.log(`sweep: ${label} could not be closed`)
    return
  }
  hqRecordClose(deps, journal, action.sessionId, reason, checked.session)
}
