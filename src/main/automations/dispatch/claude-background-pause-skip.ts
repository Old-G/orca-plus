// Custom build (claude-background-pause): a scheduled Claude automation that comes due while the week's
// limit is at 95% is skipped, not queued — the schedule moves on. After the pause it is caught up once:
// however many of its occurrences were skipped, one run, and none for an automation that was not skipped.
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { AutomationRunWriter } from '../run-history/run-writer'
import { claudeBackgroundAdmits } from '../../claude-limit-guard/claude-background-gate'
import { AutomationDispatchCancelledError } from './automation-dispatch-cancelled-error'

// Why: one wording for every skip, so repeated skips of a job fold into one history row.
export const CLAUDE_BACKGROUND_PAUSE_SKIP =
  'Skipped: background paused — the weekly Claude limit passed 95%. Runs again after the reset.'

/** Records the skip and returns true when the automation must not start now. */
export async function skipForClaudeBackgroundPause(input: {
  runs: AutomationRunWriter
  automation: Automation
  scheduledFor: number
  /** False once the scheduler stopped or its automations changed while the gate waited. */
  isActive: () => boolean
}): Promise<boolean> {
  const { automation, runs, scheduledFor } = input
  // Why: the pause is about the Claude subscription; other agents have limits of their own.
  if (automation.agentId !== 'claude') {
    return false
  }
  const admitted = await claudeBackgroundAdmits(`automation «${automation.name}»`)
  // Why: the gate may wait up to 20 s for a reading; the tick's view of the schedule may be gone by then.
  if (!input.isActive()) {
    throw new AutomationDispatchCancelledError()
  }
  if (admitted) {
    return false
  }
  if (!(await runs.repeatSkip(automation.id, CLAUDE_BACKGROUND_PAUSE_SKIP, scheduledFor))) {
    const run = await runs.createRun(automation, scheduledFor)
    if (run.status === 'pending') {
      await runs.updateRun({
        runId: run.id,
        status: 'skipped_unavailable',
        workspaceId: automation.workspaceId,
        error: CLAUDE_BACKGROUND_PAUSE_SKIP
      })
    }
  }
  return true
}

// Why: an automation due again this soon runs on its own schedule; a catch-up would run it twice.
export const CLAUDE_BACKGROUND_CATCH_UP_UNLESS_DUE_WITHIN_MS = 15 * 60_000

/**
 * Whether `automation` owes the one catch-up run: no run came after its pause skip. Several skipped
 * occurrences fold into that one row; any run after it (the catch-up, a scheduled or a manual run)
 * settles the debt, so it is paid once.
 */
export function owesClaudeBackgroundCatchUp(
  automation: Automation,
  runs: () => readonly AutomationRun[],
  now: number
): boolean {
  if (
    !automation.enabled ||
    automation.agentId !== 'claude' ||
    automation.nextRunAt - now <= CLAUDE_BACKGROUND_CATCH_UP_UNLESS_DUE_WITHIN_MS
  ) {
    return false
  }
  const all = runs()
  const skip = all
    .filter(
      (run) =>
        run.status === 'skipped_unavailable' &&
        run.trigger === 'scheduled' &&
        run.error === CLAUDE_BACKGROUND_PAUSE_SKIP
    )
    .reduce<AutomationRun | undefined>(
      (latest, run) => (!latest || run.createdAt > latest.createdAt ? run : latest),
      undefined
    )
  // Why: a run made in the same millisecond as the skip (a manual run right after it) also settles it.
  return (
    skip !== undefined && !all.some((run) => run.id !== skip.id && run.createdAt >= skip.createdAt)
  )
}
