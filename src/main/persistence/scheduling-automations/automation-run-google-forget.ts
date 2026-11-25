// Custom build (google-disconnect-forget): a Gmail or Calendar run keeps the mail's subject and snippet,
// the sender, the meeting's title, place and link. They leave run history when their account is
// disconnected here, and 30 days after the event on any account. What stays is ours: the run, its
// times and status, and that a Gmail or Calendar event started it.
import { isFinalAutomationRunStatus } from '../../../shared/automations/history/automation-run'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { AutomationRunOperations } from './automation-run-operations'

export const GOOGLE_RUN_EVENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000

export type GoogleRunForget = { account: string } | { before: number }

// Who did it and where go; that a Gmail or Calendar event did it stays.
const sourceOnly = ({ triggeredBy }: AutomationRun): Pick<AutomationRun, 'triggeredBy'> =>
  triggeredBy
    ? {
        triggeredBy: {
          source: triggeredBy.source,
          ...(triggeredBy.event ? { event: triggeredBy.event } : {})
        }
      }
    : {}

// A finished run loses the event outright; Run now then has nothing of it to replay.
function forgottenRun(run: AutomationRun): AutomationRun {
  const { event: _event, eventKeys: _eventKeys, ...kept } = run
  return {
    ...kept,
    outputSnapshot: null,
    ...sourceOnly(run)
  }
}

// An unfinished run still folds and dedupes by the event's key, so only the words go.
function quietedRun(run: AutomationRun): AutomationRun {
  if (!run.event) {
    return run
  }
  const {
    text: _text,
    actor: _actor,
    actorId: _actorId,
    place: _place,
    url: _url,
    ...event
  } = run.event
  return {
    ...run,
    event,
    ...sourceOnly(run)
  }
}

/** Forgets what Google gave the matching runs; returns how many changed. */
export function forgetAutomationRunGoogleEvents(
  operations: Pick<AutomationRunOperations, 'state' | 'flush' | 'recordAutomationRunsMutation'>,
  forget: GoogleRunForget
): number {
  let changed = 0
  const runs = (operations.state.automationRuns ?? []).map((run) => {
    const google = run.event?.google
    if (!run.event || !google) {
      return run
    }
    const final = isFinalAutomationRunStatus(run.status)
    if ('account' in forget) {
      if (google.account.toLowerCase() !== forget.account.toLowerCase()) {
        return run
      }
      changed += 1
      return final ? forgottenRun(run) : quietedRun(run)
    }
    if (!final || run.event.occurredAt >= forget.before) {
      return run
    }
    changed += 1
    return forgottenRun(run)
  })
  if (changed > 0) {
    // A new array, so identity-keyed list projections see the change.
    operations.state.automationRuns = runs
    operations.recordAutomationRunsMutation?.(runs)
    operations.flush()
  }
  return changed
}
