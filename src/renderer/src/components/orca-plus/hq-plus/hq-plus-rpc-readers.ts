// Custom build (hq-plus-ui): checks on what the HQ+ screen's runtime calls return, so a host on an
// older build answers with an empty screen instead of a crash.
import type { HqJournalEntry, HqSession } from '../../../../../shared/hq-journal'
import type { HqFeedResult, HqPlusScreenStats } from '../../../../../shared/hq-plus-screen'
import type { HqSessionsResult } from '../../../../../shared/hq-sessions'
import type { PulseInboxItem, PulsePerson, PulseWaiting } from '../../../../../shared/pulse-types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function isHqJournalEntries(value: unknown): value is HqJournalEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        isRecord(row) &&
        typeof row.id === 'string' &&
        typeof row.at === 'number' &&
        typeof row.kind === 'string' &&
        typeof row.needs === 'string' &&
        Array.isArray(row.links)
    )
  )
}

function isHqSessions(value: unknown): value is HqSession[] {
  return (
    Array.isArray(value) && value.every((row) => isRecord(row) && typeof row.sessionId === 'string')
  )
}

function isInbox(value: unknown): value is PulseInboxItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        isRecord(row) &&
        typeof row.id === 'string' &&
        typeof row.kind === 'string' &&
        typeof row.createdAt === 'number' &&
        Array.isArray(row.actions)
    )
  )
}

export function isHqFeed(value: unknown): value is HqFeedResult {
  return (
    isRecord(value) &&
    isHqJournalEntries(value.entries) &&
    isHqSessions(value.sessions) &&
    // Why: a host from before the bell joined the feed sends none; the screen then has no cards from it.
    (value.inbox === undefined || isInbox(value.inbox)) &&
    typeof value.now === 'number'
  )
}

export function isHqScreenStats(value: unknown): value is HqPlusScreenStats {
  return (
    isRecord(value) &&
    'plan' in value &&
    'manual' in value &&
    typeof value.journalDay === 'number' &&
    Array.isArray(value.activity) &&
    value.activity.every(
      (row) => isRecord(row) && typeof row.project === 'string' && typeof row.at === 'number'
    )
  )
}

export type HqPlusUpcoming = { at: number; name: string }

/** Enabled automations whose next run is still today, soonest first. */
export function readUpcomingAutomations(value: unknown, now: number): HqPlusUpcoming[] {
  const list = hqResultField(value, 'automations')
  const end = new Date(now)
  end.setHours(24, 0, 0, 0)
  return (Array.isArray(list) ? list : [])
    .flatMap((row: unknown) =>
      isRecord(row) &&
      row.enabled === true &&
      typeof row.nextRunAt === 'number' &&
      typeof row.name === 'string' &&
      row.nextRunAt >= now &&
      row.nextRunAt < end.getTime()
        ? [{ at: row.nextRunAt, name: row.name }]
        : []
    )
    .sort((a, b) => a.at - b.at)
}

export function isPulseWaitings(value: unknown): value is PulseWaiting[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        isRecord(row) &&
        typeof row.id === 'string' &&
        typeof row.createdAt === 'number' &&
        typeof row.direction === 'string'
    )
  )
}

export function isPulsePeople(value: unknown): value is PulsePerson[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) => isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string'
    )
  )
}

export function isHqSessionsResult(value: unknown): value is HqSessionsResult {
  return (
    isRecord(value) &&
    typeof value.unreviewed === 'number' &&
    typeof value.queued === 'number' &&
    Array.isArray(value.sessions) &&
    value.sessions.every((row) => isRecord(row) && typeof row.sessionId === 'string')
  )
}

/** A field of a result object, unknown until checked. */
export function hqResultField(value: unknown, field: string): unknown {
  return isRecord(value) ? value[field] : undefined
}
