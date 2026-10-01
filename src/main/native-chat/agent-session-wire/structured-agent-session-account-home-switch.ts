// Custom build (claude-subscriptions): the same Claude chat continues on another subscription. Its
// child goes to rest as the idle sweep puts one there, the record names the new config dir, and the
// next send starts a child there with `--resume` of the same conversation.
import { agentChildWorkLiveness } from '../../../shared/agent-status-child-work-liveness'
import type { AgentChildWorkView } from '../../../shared/agent-status-child-work-view'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { isQueuedAgentJournalSubmission } from '../../../shared/agent-session-queued-submission'
import { activeStructuredAgentSessionTurnId } from '../../../shared/structured-agent-session-projection'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host-types'
import { hasPendingStructuredAgentSessionPrompt } from './structured-agent-session-idle-sweep'

export type StructuredAgentSessionAccountHomeSwitchResult =
  | { ok: true }
  | {
      ok: false
      reason: 'missing' | 'unsupported' | 'sameHome' | 'busy' | 'stopUnfinished' | 'leaseHeld'
    }

export type StructuredAgentSessionAccountHomeSwitchContext = {
  deps: Pick<StructuredAgentSessionHostDeps, 'store' | 'adapter' | 'hasOpenDispatch'>
  sessions: ReadonlyMap<string, StructuredAgentSessionHostSession>
  serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
  deliveryActive: (sessionId: string) => boolean
  readChildWork: (sessionId: string) => readonly AgentChildWorkView[] | undefined
  /** Each runs inside the session's serialize and never takes it again. */
  stopAgent: (sessionId: string) => Promise<void>
  publishStatus: (sessionId: string) => void
  now: () => number
}

/** Work a switch would cut short: the same owed-work test the idle sweep puts an agent to rest by. */
function owesWork(
  context: StructuredAgentSessionAccountHomeSwitchContext,
  sessionId: string,
  session: StructuredAgentSessionHostSession,
  record: AgentSessionRecord
): boolean {
  const items = session.journal.snapshot().items
  return (
    activeStructuredAgentSessionTurnId(items) !== null ||
    context.deliveryActive(sessionId) ||
    session.journal.submissions().some(isQueuedAgentJournalSubmission) ||
    agentChildWorkLiveness(context.readChildWork(sessionId)) !== null ||
    context.deps.hasOpenDispatch?.(record) === true ||
    context.deps.adapter.holdsDispatch?.(sessionId) === true ||
    hasPendingStructuredAgentSessionPrompt(items)
  )
}

export function switchStructuredAgentSessionAccountHome(
  context: StructuredAgentSessionAccountHomeSwitchContext,
  sessionId: string,
  accountHome: AgentSessionRecord['accountHome']
): Promise<StructuredAgentSessionAccountHomeSwitchResult> {
  return context.serialize(sessionId, async () => {
    const record = context.deps.store.getRecord(sessionId)
    if (!record) {
      return { ok: false, reason: 'missing' }
    }
    if (record.provider !== 'claude' || accountHome.variable !== record.accountHome.variable) {
      return { ok: false, reason: 'unsupported' }
    }
    if (accountHome.path === record.accountHome.path) {
      return { ok: false, reason: 'sameHome' }
    }
    const session = context.sessions.get(sessionId)
    if (session) {
      if (owesWork(context, sessionId, session, record)) {
        return { ok: false, reason: 'busy' }
      }
      if (session.child) {
        await context.stopAgent(sessionId)
      }
      // Why: a stop whose exit is not proven yet keeps the child on the session until its close ends.
      if (session.child) {
        return { ok: false, reason: 'stopUnfinished' }
      }
    }
    const atRest = context.deps.store.getRecord(sessionId)
    if (!atRest || atRest.lease.claimStatus !== 'released' || atRest.lease.ownerProcess !== null) {
      return { ok: false, reason: 'leaseHeld' }
    }
    const updated = await context.deps.store.replaceSessionAccountHome({
      sessionId,
      fence: atRest.lease.runtimeFence,
      accountHome,
      now: context.now()
    })
    // Why: the open conversation keeps its attach params; a later reader must not see the old dir.
    if (session) {
      session.params = { ...session.params, accountHome: updated.accountHome }
    }
    context.publishStatus(sessionId)
    return { ok: true }
  })
}
