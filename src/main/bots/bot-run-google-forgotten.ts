// Custom build (google-send-again-memory-30d): Send again replays what a run's card kept. A Gmail or
// Calendar run's words leave run history when their account is disconnected or 30 days after the
// event; the card still holds them, so Send again asks run history first and stays quiet once they went.
import type { AutomationRun } from '../../shared/automations/history/automation-run'
import type { AutomationRunMessage } from '../../shared/automations/automation-run-message'
import { GOOGLE_RUN_EVENT_KEEP_MS } from '../persistence/scheduling-automations/automation-run-google-forget'

export const RUN_GOOGLE_EVENT_FORGOTTEN =
  "This run's Gmail or Calendar event was forgotten (the account was disconnected or the event is over 30 days old), so it can't be sent again."

const GOOGLE_SOURCES = new Set(['gmail', 'calendar'])
// What an unfinished run loses at a disconnect while it keeps folding by the event's key.
const WORDS = ['text', 'actor', 'place', 'url'] as const

/** True when the card's run came from Google and run history no longer keeps that event's words. */
export function runGoogleEventForgotten(
  run: Pick<AutomationRunMessage, 'runId' | 'event'>,
  stored: Pick<AutomationRun, 'id' | 'event'> | undefined,
  now: number
): boolean {
  const event = run.event
  if (!event || !GOOGLE_SOURCES.has(event.source)) {
    return false
  }
  // The sweep runs hourly; the age alone already settles it.
  if (event.occurredAt < now - GOOGLE_RUN_EVENT_KEEP_MS) {
    return true
  }
  // Gone from history, event dropped (finished run) or words dropped (unfinished run): all forgotten.
  // A run the history cap pruned is refused too: nothing left says its account is still connected.
  if (!stored?.event?.google) {
    return true
  }
  const kept = stored.event
  return WORDS.some((field) => event[field] !== undefined && kept[field] === undefined)
}
