// Custom build (hq-open-loops): every few minutes the detector reads the ledger's Slack and
// ClickUp timelines, records each loop that came due, each answer and each reply it cannot read, and
// says so in one quiet journal line at most once an hour. Report mode: no waiting is added or closed.
import { createHash } from 'node:crypto'
import {
  hqLoopAnswer,
  hqLoopTimelineOf,
  hqOpenLoop,
  type HqLoopMessage,
  type HqLoopOwner,
  type HqOpenLoop
} from '../../shared/hq-open-loops'
import { HQ_LOOP_QUOTED_LINE } from '../../shared/hq-open-loop-text'
import { HQ_JOURNAL_ALL_ROOMS, hqJournalTitle, type HqJournalInput } from '../../shared/hq-journal'
import { hqPlaceKey } from '../../shared/hq-ledger'
import type { PulsePerson, PulseWaiting } from '../../shared/pulse-types'
import { hqJobRow } from '../hq-journal/hq-journal-jobs'
import {
  HQ_OPEN_LOOP_EVENTS,
  type HqLoopRecord,
  type HqLoopTimelineRow,
  type HqOpenLoopEvent
} from '../orca-plus/pulse/pulse-open-loops'

export const HQ_OPEN_LOOPS_JOB = 'open-loops'
const DAY_MS = 24 * 60 * 60_000
/** Why two weeks: the ledger pairs a person's answer with a question no older than that either. */
export const HQ_OPEN_LOOPS_WINDOW_MS = 14 * DAY_MS
/** Why: the journal is read by the owner; a line per five-minute pass would be noise. */
const LINE_EVERY_MS = 60 * 60_000
const LINE_ITEMS = 12
const TITLE_CHARS = 120

export type HqOpenLoopsDeps = {
  enabled: () => boolean
  timelines: (since: number) => HqLoopTimelineRow[]
  owner: () => HqLoopOwner
  records: (since: number) => HqLoopRecord[]
  record: (kind: HqOpenLoopEvent, loopId: string, payload: Record<string, unknown>) => boolean
  /** Every waiting, closed ones too: one closed after the ask still covered the loop. */
  waitings: () => PulseWaiting[]
  people: () => PulsePerson[]
  /** When the detector's last journal line was written; null before the first. */
  lastLineAt: () => number | null
  journal: (rows: HqJournalInput[]) => void
  now: () => number
}

export type HqOpenLoopsPass = { opened: number; closed: number; disputed: number; line: boolean }

const MENTION = /<@([A-Z0-9]+)(?:\|([^>]*))?>/g

function loopTitle(message: HqLoopMessage, names: ReadonlyMap<string, string>): string {
  const lines = message.text.split('\n').map((line) => line.trim())
  const line = lines.find((entry) => entry && !HQ_LOOP_QUOTED_LINE.test(entry)) ?? lines.join(' ')
  const plain = line.replace(
    MENTION,
    (_, id: string, name?: string) => `@${name || names.get(id) || 'someone'}`
  )
  return hqJournalTitle(plain || '(a file or a voice note)').slice(0, TITLE_CHARS)
}

/** A ClickUp task the waiting names, as its id: the place key's, or the raw id of a task link. */
function clickUpTaskOf(ref: string | null): string | null {
  const key = hqPlaceKey(ref)
  return key?.startsWith('clickup:') ? key.slice('clickup:'.length) : null
}

/** A waiting someone else recorded for this talk — open, or closed only after the ask. */
function coveringWaiting(
  loop: HqOpenLoop,
  row: HqLoopTimelineRow,
  waitings: readonly PulseWaiting[],
  people: readonly PulsePerson[]
): string | null {
  const keys = new Set(Object.keys(row.projects))
  const links = row.timeline.messages.flatMap((message) => (message.link ? [message.link] : []))
  const dmPeople =
    row.timeline.kind === 'dm' && loop.personId
      ? new Set(people.filter((p) => p.slackUserId === loop.personId).map((p) => p.id))
      : new Set<string>()
  const samePlace = (waiting: PulseWaiting): boolean => {
    const key = hqPlaceKey(waiting.sourceRef)
    if (key && (keys.has(key) || hqLoopTimelineOf(key).id === row.timeline.id)) {
      return true
    }
    const task = clickUpTaskOf(waiting.sourceRef)
    return (
      row.timeline.kind === 'clickup' &&
      task !== null &&
      links.some((link) => link.includes(`/t/${task}`))
    )
  }
  const hit = waitings.find(
    (waiting) =>
      waiting.direction === loop.direction &&
      (waiting.status === 'open' || (waiting.resolvedAt ?? 0) >= loop.opening.at) &&
      (samePlace(waiting) || (waiting.personId !== null && dmPeople.has(waiting.personId)))
  )
  return hit?.id ?? null
}

function asLoop(
  record: HqLoopRecord
): Pick<HqOpenLoop, 'direction' | 'opening' | 'person' | 'personId'> {
  return {
    direction: record.direction,
    person: record.person,
    personId: record.personId,
    opening: {
      key: record.askKey,
      ts: record.askTs,
      at: record.askAt,
      fromOwner: record.direction === 'on-them',
      author: null,
      authorId: null,
      text: '',
      link: record.link
    }
  }
}

/** One pass over the window's timelines; what it recorded. */
export function runHqOpenLoops(deps: HqOpenLoopsDeps): HqOpenLoopsPass {
  const pass: HqOpenLoopsPass = { opened: 0, closed: 0, disputed: 0, line: false }
  if (!deps.enabled()) {
    return pass
  }
  const owner = deps.owner()
  if (owner.slackIds.length === 0 && owner.names.length === 0) {
    return pass
  }
  const now = deps.now()
  const since = now - HQ_OPEN_LOOPS_WINDOW_MS
  const records = deps.records(since - HQ_OPEN_LOOPS_WINDOW_MS)
  const recorded = new Set(records.map((record) => record.id))
  const waitings = deps.waitings()
  const people = deps.people()
  const names = new Map(
    people.flatMap((person) => (person.slackUserId ? [[person.slackUserId, person.name]] : []))
  )
  for (const row of deps.timelines(since)) {
    for (const message of row.timeline.messages) {
      if (message.authorId && message.author && !names.has(message.authorId)) {
        names.set(message.authorId, message.author)
      }
    }
    for (const record of records) {
      // Why by the ask's conversation: a ClickUp alias learned later renames the timeline, not the talk.
      if (!(record.askKey in row.projects) || record.closed) {
        continue
      }
      const answer = hqLoopAnswer(asLoop(record), row.timeline, owner)
      if (answer?.kind === 'answer') {
        const done = deps.record(HQ_OPEN_LOOP_EVENTS.close, record.id, {
          ts: answer.message.ts,
          link: answer.message.link,
          byOwner: answer.message.fromOwner
        })
        pass.closed += done ? 1 : 0
      } else if (
        answer?.kind === 'disputed' &&
        record.disputedAt === null &&
        record.disputed !== answer.why
      ) {
        const marked = deps.record(HQ_OPEN_LOOP_EVENTS.disputed, record.id, {
          disputed: answer.why,
          ts: answer.message.ts,
          link: answer.message.link
        })
        pass.disputed += marked ? 1 : 0
      }
    }
    const loop = hqOpenLoop(row.timeline, owner)
    if (!loop || now < loop.dueAt || loop.opening.at < since || recorded.has(loop.id)) {
      continue
    }
    const reply = hqLoopAnswer(loop, row.timeline, owner)
    const opened = deps.record(HQ_OPEN_LOOP_EVENTS.open, loop.id, {
      timeline: loop.timeline,
      direction: loop.direction,
      askKey: loop.opening.key,
      askTs: loop.opening.ts,
      askAt: loop.opening.at,
      link: loop.opening.link,
      person: loop.person ?? (loop.personId ? (names.get(loop.personId) ?? null) : null),
      personId: loop.personId,
      title: loopTitle(loop.opening, names),
      project: row.projects[loop.opening.key] ?? null,
      disputed: loop.disputed ?? (reply?.kind === 'disputed' ? reply.why : null),
      covered: coveringWaiting(loop, row, waitings, people)
    })
    pass.opened += opened ? 1 : 0
  }
  pass.line = writeLine(deps, now)
  return pass
}

// Why only these hosts: the line names where to look; a link from anywhere else is not shown.
const SOURCE_LINK = /^https:\/\/(?:[\w-]+\.)?slack\.com\/|^https:\/\/app\.clickup\.com\//

/** One loop in the journal line: direction, person, when asked, where — never the message's words,
 *  since the journal is read by agents in every room and the words are someone else's. */
function item(
  record: HqLoopRecord,
  verb: string,
  extra: string | null,
  link: string | null
): string {
  const asked = new Date(record.askAt).toISOString().slice(0, 10)
  return [
    `\u2022 ${verb} ${record.direction}`,
    record.person ?? 'someone',
    `asked ${asked}`,
    extra,
    record.covered ? 'already a waiting' : null,
    link && SOURCE_LINK.test(link) ? link : null
  ]
    .filter((part): part is string => part !== null)
    .join(' \u00b7 ')
}

/** The verdicts since the last line, in one quiet line; keyed by the loops it lists, so a retry adds
 *  nothing. */
function writeLine(deps: HqOpenLoopsDeps, now: number): boolean {
  const last = deps.lastLineAt()
  if (last !== null && now - last < LINE_EVERY_MS) {
    return false
  }
  const from = last ?? now - DAY_MS
  const records = deps.records(now - 2 * HQ_OPEN_LOOPS_WINDOW_MS)
  const opened = records.filter((record) => record.at > from)
  const closed = records.filter((record) => record.closed && record.closed.at > from)
  const disputed = records.filter(
    (record) => record.disputedAt !== null && record.disputedAt > from
  )
  if (opened.length + closed.length + disputed.length === 0) {
    return false
  }
  const items = [
    ...opened.map((record) =>
      item(record, 'open', record.disputed ? `disputed: ${record.disputed}` : null, record.link)
    ),
    ...closed.map((record) =>
      item(
        record,
        'close',
        record.closed?.byOwner ? 'you answered' : 'answered',
        record.closed?.link ?? null
      )
    ),
    ...disputed.map((record) => item(record, 'disputed', record.disputed, record.link))
  ]
  const head = `would open ${opened.length}, close ${closed.length}, disputed ${disputed.length} (report only, no waiting changed)`
  const found = [
    head,
    ...items.slice(0, LINE_ITEMS),
    ...(items.length > LINE_ITEMS ? [`\u2026and ${items.length - LINE_ITEMS} more`] : [])
  ].join('\n')
  const ids = [
    ...opened.map((record) => `o:${record.id}`),
    ...closed.map((record) => `c:${record.id}`),
    ...disputed.map((record) => `d:${record.id}`)
  ].toSorted()
  const key = createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16)
  // Why the newest verdict's time: events are stamped as written, after the pass began; the next
  // line starts after the last one it listed, never before it.
  const at = Math.max(
    now,
    ...opened.map((record) => record.at),
    ...closed.map((record) => record.closed?.at ?? 0),
    ...disputed.map((record) => record.disputedAt ?? 0)
  )
  deps.journal([
    {
      ...hqJobRow(
        { job: HQ_OPEN_LOOPS_JOB, found },
        { room: HQ_JOURNAL_ALL_ROOMS, project: null, firm: false },
        at
      ),
      title: hqJournalTitle(`${HQ_OPEN_LOOPS_JOB}: ${head}`),
      dedupeKey: `job:${HQ_OPEN_LOOPS_JOB}:${key}`
    }
  ])
  return true
}
