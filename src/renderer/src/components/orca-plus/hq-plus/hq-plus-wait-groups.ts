// Custom build (hq-plus-round6): what we wait for, split for the left column — still to chase, moving
// along a linked task (Tracked), and put off until a day (Snoozed, shown last and quiet).
export type HqPlusWaitTagged = { task: string | null; snoozedUntil: number | null }

export function hqPlusWaitGroups<T extends HqPlusWaitTagged>(
  waits: readonly T[],
  now: number
): { chase: T[]; tracked: T[]; snoozed: T[] } {
  const snoozed = waits.filter((wait) => wait.snoozedUntil !== null && wait.snoozedUntil > now)
  const awake = waits.filter((wait) => !snoozed.includes(wait))
  return {
    chase: awake.filter((wait) => !wait.task),
    tracked: awake.filter((wait) => Boolean(wait.task)),
    snoozed
  }
}
