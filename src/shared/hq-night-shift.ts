// Custom build (hq-night-shift): tasks the owner queued «Tonight» start on their own at night, one try per
// night, and are waiting in «Ready for you» by morning.
import type { HqTriageDecisions } from './hq-triage'

/** Night starts at this hour unless the owner set another (`hqNightShiftHour`). */
export const HQ_NIGHT_SHIFT_DEFAULT_HOUR = 23
/** Morning: a queue still waiting at this hour waits for the next night. */
export const HQ_NIGHT_SHIFT_END_HOUR = 7

const RETRY_AFTER_MS = 12 * 60 * 60_000

export function isHqNightShiftHour(now: number, startHour: number): boolean {
  const hour = new Date(now).getHours()
  return startHour > HQ_NIGHT_SHIFT_END_HOUR
    ? hour >= startHour || hour < HQ_NIGHT_SHIFT_END_HOUR
    : hour >= startHour && hour < HQ_NIGHT_SHIFT_END_HOUR
}

/** A task edited after the owner queued it could carry new instructions nobody has read. */
export function hqNightTaskChanged(
  queuedUpdatedAt: number | null | undefined,
  currentUpdatedAt: number | null
): boolean {
  return (queuedUpdatedAt ?? null) !== currentUpdatedAt
}

/** Queued tasks to start now: inside the night, not tried tonight, not set aside as changed. */
export function dueHqNightTasks(
  decisions: HqTriageDecisions,
  now: number,
  startHour: number
): { taskId: string; repoIds: string[] }[] {
  if (!isHqNightShiftHour(now, startHour)) {
    return []
  }
  return Object.entries(decisions).flatMap(([taskId, decision]) =>
    decision.decision === 'night' &&
    decision.repoIds?.length &&
    !decision.nightSkipped &&
    (decision.nightTriedAt === undefined || now - decision.nightTriedAt >= RETRY_AFTER_MS)
      ? [{ taskId, repoIds: decision.repoIds }]
      : []
  )
}
