// Custom build (hq-pinned-counts): the counts beside HQ's pinned items, in place of the bell for what
// has a page of its own — «waits for you» (Today's requests, Notes on you and people to remind,
// Reports not opened) and «new since you looked» (Feed, Done for you).
import type { HqFeedItem } from './hq-feed'
import type { HqReport } from './hq-reports'
import type { PulseDecision, PulseInboxItem, PulseWaiting } from './pulse-types'
import { HQ_SLACK_REQUEST_BELL_KIND } from './hq-slack-request-bell'
import { HQ_REPORT_BELL_KIND } from './hq-reports'
import { HQ_PROMISE_DUE_KIND } from './hq-promises'
import { HQ_DEFERRED_KIND } from './hq-morning-briefing'
import { HQ_REMIND_KIND, hqRemindDue } from './hq-remind'
import type { HqPinnedCounts, HqPinnedSeenId } from './hq-pinned-counts-wire'

const DAY_MS = 24 * 60 * 60_000

/** Bell kinds HQ shows on a page of their own; the bell lists them but does not count them. */
export const HQ_PAGE_BELL_KINDS: readonly string[] = [
  HQ_SLACK_REQUEST_BELL_KIND,
  HQ_REPORT_BELL_KIND,
  HQ_PROMISE_DUE_KIND,
  HQ_DEFERRED_KIND,
  HQ_REMIND_KIND
]

// Why: with nothing seen yet, only the last days count as new — not two months of feed.
const FIRST_LOOK_DAYS = 3

export type HqPinnedCountsInput = {
  inbox: readonly PulseInboxItem[]
  waitings: readonly PulseWaiting[]
  decisions: readonly PulseDecision[]
  feed: readonly HqFeedItem[]
  reports: readonly HqReport[]
  seenAt: Partial<Record<string, number>>
  now: number
  /** Custom build (hq-spaces): only what the chosen workspace shows. */
  shows?: (project: string | null) => boolean
  /** Custom build (hq-spaces): the chosen workspace's undecided requests, counted from the scout. */
  today?: number
}

export function computeHqPinnedCounts(input: HqPinnedCountsInput): HqPinnedCounts {
  const since = (id: HqPinnedSeenId): number =>
    Math.max(input.seenAt[id] ?? 0, input.now - FIRST_LOOK_DAYS * DAY_MS)
  const shows = input.shows ?? (() => true)
  const open = input.waitings.filter(
    (waiting) => waiting.status === 'open' && shows(waiting.project)
  )
  return {
    today:
      input.today ??
      input.inbox.filter((item) => item.kind === HQ_SLACK_REQUEST_BELL_KIND && item.doneAt === null)
        .length,
    onYou: open.filter((waiting) => waiting.direction === 'on-me').length,
    remind: hqRemindDue(open, input.now).length,
    reports: input.reports.filter((report) => report.at > since('reports')).length,
    feed: input.feed.filter((item) => item.at > since('feed') && shows(item.project)).length,
    journal: input.decisions.filter(
      (decision) => decision.decidedAt > since('journal') && shows(decision.project)
    ).length
  }
}
