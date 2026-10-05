// Custom build (hq-closing): every write to the owner's per-task HQ decisions goes through one queue
// that re-reads the store after the previous write landed — a settings write replaces the whole
// record, so two overlapping writes (a late agent pane, a quick second click) would drop one.
import type { HqTriageDecision, HqTriageDecisions } from '../../../../../shared/hq-triage'
import { useAppStore } from '@/store'
import { waitForNewAgentPane } from './hq-today-actions'

let queue: Promise<void> = Promise.resolve()

export function updateHqTriageDecisions(
  change: (current: HqTriageDecisions) => HqTriageDecisions
): Promise<void> {
  const write = queue.then(() => {
    const state = useAppStore.getState()
    return state.updateSettings({
      hqTriageDecisions: change({ ...state.settings?.hqTriageDecisions })
    })
  })
  // Why: a failed write must not stall every later one.
  queue = write.catch(() => undefined)
  return write
}

export function patchHqTriageDecision(
  taskId: string,
  patch: Partial<HqTriageDecision>
): Promise<void> {
  return updateHqTriageDecisions((current) => {
    const decision = current[taskId]
    return decision ? { ...current, [taskId]: { ...decision, ...patch } } : current
  })
}

export type HqTakenSession = {
  worktreeId: string
  /** Agent panes already in the worktree before the launch. */
  before: ReadonlySet<string>
  coordinator: boolean
}

/** Remembers a taken task with its worktree, then its agent's pane once that appears. */
export async function rememberHqTake(
  taskId: string,
  repoId: string,
  session: HqTakenSession | null
): Promise<void> {
  const decision: HqTriageDecision = {
    decision: 'taken',
    at: Date.now(),
    repoId,
    ...(session ? { worktreeId: session.worktreeId } : {}),
    ...(session?.coordinator ? { coordinator: true } : {})
  }
  await updateHqTriageDecisions((current) => ({ ...current, [taskId]: decision }))
  if (session) {
    void waitForNewAgentPane(session.worktreeId, session.before).then((paneKey) =>
      paneKey ? patchHqTriageDecision(taskId, { paneKey }) : undefined
    )
  }
}
