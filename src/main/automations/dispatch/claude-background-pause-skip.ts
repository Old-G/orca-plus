// Custom build (claude-background-pause): a scheduled Claude automation that comes due while the week's
// limit is at 95% is skipped, not queued — the schedule moves on, and after the reset its next
// occurrence runs as usual, so nothing missed is caught up in a batch.
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRunWriter } from '../run-history/run-writer'
import { claudeBackgroundAdmits } from '../../claude-limit-guard/claude-background-gate'

// Why: one wording for every skip, so repeated skips of a job fold into one history row.
export const CLAUDE_BACKGROUND_PAUSE_SKIP =
  'Skipped: background paused — the weekly Claude limit passed 95%. Runs again after the reset.'

/** Records the skip and returns true when the automation must not start now. */
export async function skipForClaudeBackgroundPause(input: {
  runs: AutomationRunWriter
  automation: Automation
  scheduledFor: number
}): Promise<boolean> {
  const { automation, runs, scheduledFor } = input
  // Why: the pause is about the Claude subscription; other agents have limits of their own.
  if (automation.agentId !== 'claude') {
    return false
  }
  if (await claudeBackgroundAdmits(`automation «${automation.name}»`)) {
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
