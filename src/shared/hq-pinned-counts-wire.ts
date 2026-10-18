// Custom build (hq-pinned-counts): the counts beside HQ's pinned items as they cross the wire — kept
// apart from the counting, so the phone's bundle does not pull in the bell's producers.
import { z } from 'zod'

/** Pinned items whose «seen» moment is kept; opening one clears its «new» count. */
export const HQ_PINNED_SEEN_IDS = ['reports', 'feed', 'journal'] as const
export type HqPinnedSeenId = (typeof HQ_PINNED_SEEN_IDS)[number]

export const HqPinnedCountsSchema = z.object({
  /** Slack and ClickUp requests not decided yet. */
  today: z.number().int().nonnegative(),
  /** Open notes waiting on the owner. */
  onYou: z.number().int().nonnegative(),
  /** People who have not answered for two working days. */
  remind: z.number().int().nonnegative(),
  reports: z.number().int().nonnegative(),
  feed: z.number().int().nonnegative(),
  journal: z.number().int().nonnegative()
})
export type HqPinnedCounts = z.infer<typeof HqPinnedCountsSchema>

export function readHqPinnedCounts(value: unknown): HqPinnedCounts | null {
  const parsed = HqPinnedCountsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** «99+» past two digits. */
export function hqCountText(count: number): string {
  return count > 99 ? '99+' : String(count)
}
