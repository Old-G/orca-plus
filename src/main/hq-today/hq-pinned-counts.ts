// Custom build (hq-pinned-counts): the counts beside HQ's pinned items, read on the Mac for the
// desktop window and the paired phone alike, and the «seen» moment each item keeps.
import type { HqFeedItem, HqFeedQuery } from '../../shared/hq-feed'
import type { HqClientSettings, HqClientSettingsUpdate } from '../../shared/hq-client-settings'
import type { HqReportsResult } from '../../shared/hq-reports'
import {
  computeHqPinnedCounts,
  type HqPinnedCounts,
  type HqPinnedSeenId
} from '../../shared/hq-pinned-counts'
import type { PulseDecision, PulseInboxItem, PulseWaiting } from '../../shared/pulse-types'

// Why: the counts show «99+» past two digits, so more rows would add nothing.
const FEED_LIMIT = 100
const DECISIONS_LIMIT = 100

export type HqPinnedPulse = {
  pulseListInbox(): PulseInboxItem[]
  pulseListWaitings(filter: { status: 'open' }): PulseWaiting[]
  pulseListDecisions(limit: number): PulseDecision[]
  pulseFeed(query: HqFeedQuery): { items: HqFeedItem[] }
}

export type HqPinnedSettings = {
  settings(): HqClientSettings
  updateSettings(update: HqClientSettingsUpdate): HqClientSettings
  reports(): Promise<HqReportsResult>
}

export async function readHqPinnedCounts(
  pulse: HqPinnedPulse,
  hq: HqPinnedSettings,
  now: number
): Promise<HqPinnedCounts> {
  const reports = await hq.reports().catch(() => null)
  return computeHqPinnedCounts({
    inbox: pulse.pulseListInbox(),
    waitings: pulse.pulseListWaitings({ status: 'open' }),
    decisions: pulse.pulseListDecisions(DECISIONS_LIMIT),
    feed: pulse.pulseFeed({ limit: FEED_LIMIT }).items,
    reports: reports?.ok ? reports.reports : [],
    seenAt: hq.settings().hqPinnedSeenAt ?? {},
    now
  })
}

export function markHqPinnedSeen(
  hq: HqPinnedSettings,
  id: HqPinnedSeenId,
  now: number
): { ok: true } {
  hq.updateSettings({ hqPinnedSeenAt: { ...hq.settings().hqPinnedSeenAt, [id]: now } })
  return { ok: true }
}
