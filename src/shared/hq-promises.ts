// Custom build (hq-promises): what the owner promised people in Slack («сделаю», «пришлю до пт»),
// found by the Slack scout and kept in HQ → Notes as «waiting on me», with a reminder the day before.
import type { PulseBellInput } from './pulse-bell'
import type { PulseWaiting } from './pulse-types'

export const HQ_PROMISES_FILE = 'promises.json'
export const HQ_PROMISE_SOURCE = 'slack-promise'
export const HQ_PROMISE_DUE_KIND = 'hq-promise-due'
export const HQ_PROMISE_OPEN_ACTION = 'open'

const DAY_MS = 24 * 60 * 60_000
const TEXT_MAX = 300

export type HqScoutPromise = {
  /** The message's permalink; also the waiting's sourceRef, so a promise is recorded once. */
  permalink: string
  person: string
  personSlackId: string | null
  what: string
  /** Local date the owner named, `YYYY-MM-DD`; null when he named none. */
  due: string | null
}

export type HqScoutPromiseDone = { permalink: string; reason: string }

function text(value: unknown, max = TEXT_MAX): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function slackPermalink(value: unknown): string | null {
  const link = text(value, 500)
  return link && /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\//.test(link) ? link : null
}

/** The scout's file, with anything malformed dropped rather than trusted. */
export function parseHqScoutPromises(raw: string): {
  promises: HqScoutPromise[]
  done: HqScoutPromiseDone[]
} {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { promises: [], done: [] }
  }
  const list = (key: string): unknown[] => {
    const value = data && typeof data === 'object' ? Reflect.get(data, key) : null
    return Array.isArray(value) ? value : []
  }
  const promises = list('promises').flatMap((entry): HqScoutPromise[] => {
    if (!entry || typeof entry !== 'object') {
      return []
    }
    const permalink = slackPermalink(Reflect.get(entry, 'permalink'))
    const person = text(Reflect.get(entry, 'person'), 80)
    const what = text(Reflect.get(entry, 'what'))
    const due = text(Reflect.get(entry, 'due'), 10)
    if (!permalink || !person || !what) {
      return []
    }
    return [
      {
        permalink,
        person,
        personSlackId: text(Reflect.get(entry, 'personSlackId'), 20),
        what,
        due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null
      }
    ]
  })
  const done = list('done').flatMap((entry): HqScoutPromiseDone[] => {
    if (!entry || typeof entry !== 'object') {
      return []
    }
    const permalink = slackPermalink(Reflect.get(entry, 'permalink'))
    return permalink ? [{ permalink, reason: text(Reflect.get(entry, 'reason')) ?? 'done' }] : []
  })
  return { promises, done }
}

/** End of the named local day: a promise «by Friday» is due until Friday evening. */
export function hqPromiseDueAt(due: string | null): number | null {
  if (!due) {
    return null
  }
  const [year, month, day] = due.split('-').map(Number)
  const at = new Date(year, month - 1, day, 23, 59).getTime()
  return Number.isNaN(at) ? null : at
}

/** A bell line for each open promise due today or tomorrow, or already late. */
export function hqPromiseDueBellItems(
  waitings: readonly PulseWaiting[],
  personName: (personId: string) => string | null,
  now: number
): PulseBellInput[] {
  const today = new Date(now)
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime()
  const endOfTomorrow = endOfToday + DAY_MS
  return waitings.flatMap((waiting): PulseBellInput[] => {
    if (
      waiting.status !== 'open' ||
      waiting.direction !== 'on-me' ||
      waiting.dueAt === null ||
      waiting.dueAt >= endOfTomorrow
    ) {
      return []
    }
    const who = waiting.personId ? personName(waiting.personId) : null
    const when =
      waiting.dueAt < now
        ? 'Overdue promise'
        : waiting.dueAt < endOfToday
          ? 'Due today'
          : 'Due tomorrow'
    return [
      {
        kind: HQ_PROMISE_DUE_KIND,
        title: `${when}: ${waiting.title}`,
        body: who ? `You promised ${who}` : null,
        refKind: 'waiting',
        refId: waiting.id,
        actions: [{ id: HQ_PROMISE_OPEN_ACTION, label: 'Open Notes' }],
        dedupeKey: `${HQ_PROMISE_DUE_KIND}:${waiting.id}`
      }
    ]
  })
}
