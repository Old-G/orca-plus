// Custom build (hq-plus-sessions): carries a dispatch decision out — the work goes to the thread's
// chat, to a new chat seeded from the last one, or into the queue — and notes it in the journal.
import { HQ_JOURNAL_KIND, hqJournalTitle } from '../../shared/hq-journal'
import type { HqDispatchDecision } from '../../shared/hq-sessions'
import type { HqCaller } from '../hq-journal/hq-journal-rooms'
import { hqNewChatPrompt } from './hq-session-prompts'
import { hqWorkKey, type HqSessionJournal, type HqSessionsDeps } from './hq-session-journal'

export type HqDispatchDone = {
  decision: HqDispatchDecision
  sessionId: string | null
  entryId: string | null
}

/** A chat that will not take the work hands the thread to a new one. */
export async function carryOutHqDispatch(
  deps: HqSessionsDeps,
  journal: HqSessionJournal,
  caller: HqCaller,
  decision: HqDispatchDecision,
  work: string
): Promise<HqDispatchDone> {
  const project = decision.address.split('/')[0] ?? ''
  const workspace = await deps.roomOf(project)
  if (decision.kind === 'queue') {
    const dedupeKey = `${HQ_JOURNAL_KIND.sessionQueued}:${decision.address}:${hqWorkKey(work)}`
    deps.pulse.record([
      {
        ...journal.row({
          workspace,
          kind: HQ_JOURNAL_KIND.sessionQueued,
          project,
          address: decision.address,
          sessionId: null,
          title: hqJournalTitle(`Queued for ${decision.address}: ${decision.why}`),
          needs: `agent:${decision.address}`,
          status: 'open',
          refKind: 'session',
          refId: caller.sessionId ?? null,
          dedupeKey
        }),
        body: work
      }
    ])
    return { decision, sessionId: null, entryId: journal.recorded(dedupeKey)?.id ?? null }
  }
  if (decision.kind === 'continue') {
    try {
      const sent = await deps.send(caller, { address: decision.address, text: work })
      const dedupeKey = `${HQ_JOURNAL_KIND.sessionContinue}:${sent.entry.id}`
      deps.pulse.record([
        journal.row({
          workspace,
          kind: HQ_JOURNAL_KIND.sessionContinue,
          project,
          address: decision.address,
          sessionId: sent.sessionId,
          title: hqJournalTitle(`Continued ${decision.address} in its chat: ${decision.why}`),
          needs: 'nobody',
          status: 'done',
          refKind: 'entry',
          refId: sent.entry.id,
          dedupeKey
        })
      ])
      return {
        decision,
        sessionId: sent.sessionId,
        entryId: journal.recorded(dedupeKey)?.id ?? null
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.log(`dispatch: ${decision.address} could not continue (${message}); opening a new chat`)
      decision = {
        kind: 'new',
        address: decision.address,
        project,
        seedFrom: decision.sessionId,
        why: `its chat did not take the work: ${message}`
      }
    }
  }
  const seed = decision.seedFrom ? deps.pulse.getSession(decision.seedFrom) : null
  const target = await deps.workspaceFor(project, seed?.worktreeId ?? null)
  if (!target) {
    throw new Error(`Project ${project} is not open in Orca+.`)
  }
  const launched = await deps.launch(target.worktreeId)
  if (!launched.ok) {
    throw new Error(launched.error)
  }
  // Why: work handed on may quote other people or other chats; full access would let it steer.
  if (!(await deps.limit(launched.sessionId))) {
    throw new Error('The new chat could not be switched to Auto, so no work went in.')
  }
  const task = decision.address.split('/')[1] ?? decision.address
  await deps.nameChat(launched.sessionId, task)
  const prompt = hqNewChatPrompt({
    address: decision.address,
    project,
    lastReport: decision.seedFrom ? journal.lastReport(decision.seedFrom) : null,
    work
  })
  if (!(await deps.deliver(launched.sessionId, prompt))) {
    throw new Error('The new chat did not take the work.')
  }
  const at = deps.now()
  deps.pulse.noteSessions([
    {
      sessionId: launched.sessionId,
      address: decision.address,
      agent: 'claude',
      worktreeId: launched.worktreeId,
      workspace,
      project,
      state: 'working',
      contextPct: null,
      parentSessionId: decision.seedFrom,
      taskRef: null,
      at
    }
  ])
  const dedupeKey = `${HQ_JOURNAL_KIND.sessionOpen}:${launched.sessionId}`
  deps.pulse.record([
    journal.row({
      workspace,
      kind: HQ_JOURNAL_KIND.sessionOpen,
      project,
      address: decision.address,
      sessionId: launched.sessionId,
      title: hqJournalTitle(
        `Opened a chat on ${decision.address} in ${target.name}: ${decision.why}`
      ),
      needs: 'nobody',
      status: 'done',
      refKind: decision.seedFrom ? 'session' : null,
      refId: decision.seedFrom,
      dedupeKey
    })
  ])
  return {
    decision,
    sessionId: launched.sessionId,
    entryId: journal.recorded(dedupeKey)?.id ?? null
  }
}
