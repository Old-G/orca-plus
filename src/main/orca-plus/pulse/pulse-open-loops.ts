// Custom build (hq-open-loops): the ledger's Slack and ClickUp messages as the open-loop
// detector's timelines, and what it decided about each loop. Decisions are events, one per loop and
// kind, as the ledger's answers in shadow are — no table for what is a log of verdicts.
import {
  hqLoopTimelineOf,
  type HqLoopDirection,
  type HqLoopDisputed,
  type HqLoopMessage,
  type HqLoopOwner,
  type HqLoopTimeline
} from '../../../shared/hq-open-loops'
import type { PulseCore } from './pulse-core'

export const HQ_OPEN_LOOP_EVENTS = {
  /** A loop came due: what the detector would open. */
  open: 'open-loop.open',
  close: 'open-loop.close',
  /** A reply the detector cannot read: left to the evening check. */
  disputed: 'open-loop.disputed'
} as const

export type HqOpenLoopEvent = (typeof HQ_OPEN_LOOP_EVENTS)[keyof typeof HQ_OPEN_LOOP_EVENTS]

export type HqLoopTimelineRow = {
  timeline: HqLoopTimeline
  /** The project of each ledger conversation the timeline is made of, by key. */
  projects: Record<string, string | null>
}

export type HqLoopRecord = {
  id: string
  timeline: string
  direction: HqLoopDirection
  /** The message that asks: its conversation key, ts and time. */
  askKey: string
  askTs: string
  askAt: number
  link: string | null
  person: string | null
  personId: string | null
  title: string
  project: string | null
  disputed: HqLoopDisputed | null
  /** A waiting someone else recorded for the same talk, when the loop came due. */
  covered: string | null
  /** When the loop came due and was recorded. */
  at: number
  closed: { ts: string; link: string | null; byOwner: boolean; at: number } | null
  /** When a later reply made it disputed. */
  disputedAt: number | null
}

const CLICKUP_CUSTOM_KEY = /^clickup:[A-Z][A-Z0-9]*-\d+$/
const CLICKUP_RAW_ID = /app\.clickup\.com\/t\/([0-9a-z]{6,})(?=[?#/]|$)/

/** Why: a ClickUp task is `clickup:<custom id>` when its reader saw it and `clickup:<raw id>` when a send
 *  named it; the reader's comment links carry the raw id, so the two keys are one task. */
function clickUpAliases(core: PulseCore): Map<string, string> {
  const aliases = new Map<string, string>()
  const rows = core.db
    .prepare(
      `SELECT DISTINCT c.key, m.link FROM conversations c
         JOIN conversation_messages m ON m.conversation_id = c.id
        WHERE c.key LIKE 'clickup:%' AND m.link LIKE '%app.clickup.com/t/%'`
    )
    .all()
  for (const row of rows) {
    const key = String(row.key)
    const raw = CLICKUP_RAW_ID.exec(String(row.link))?.[1]
    if (raw && CLICKUP_CUSTOM_KEY.test(key)) {
      aliases.set(`clickup:${raw}`, key)
    }
  }
  return aliases
}

/** Why: the ledger keeps a ClickUp bot's comments (author id -1) and the retired scout's summaries
 *  (`req:` rows) beside people's words; neither is anyone speaking. An empty text stays: it is a file
 *  or a voice note. */
const MESSAGES_SQL = `
  SELECT c.key, m.ts, m.at, m.direction, m.author, m.author_id, m.text, m.link, m.reader
    FROM conversations c JOIN conversation_messages m ON m.conversation_id = c.id
   WHERE c.id IN (SELECT value FROM json_each(?))
     AND m.ts NOT LIKE 'req:%' AND COALESCE(m.author_id, '') <> '-1'
   ORDER BY m.at, m.ts`

const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Why: the reply reader stores what it found as «Name: text» lines, sometimes hours later; lines
 *  the timeline already holds are a copy, not a new message. */
function repeats(text: string, timeline: HqLoopTimeline): boolean {
  const said = timeline.messages.map((message) => squeeze(message.text))
  const lines = text
    .split('\n')
    .map((line) => squeeze(line.replace(/^[^:\n]{1,60}:\s*/, '')))
    .filter((line) => line.length > 2)
  return lines.length > 0 && lines.every((line) => said.some((earlier) => earlier.includes(line)))
}

/** The timelines with a message since `since`, each read whole, so a loop keeps its first ask. */
export function loopTimelines(core: PulseCore, since: number): HqLoopTimelineRow[] {
  const aliases = clickUpAliases(core)
  const conversations = core.db
    .prepare(
      `SELECT id, key, project, last_at FROM conversations
        WHERE key LIKE 'slack:%' OR key LIKE 'clickup:%'`
    )
    .all()
    .map((row) => {
      const key = String(row.key)
      return {
        id: String(row.id),
        key,
        timeline: hqLoopTimelineOf(aliases.get(key) ?? key),
        project: row.project == null ? null : String(row.project),
        lastAt: Number(row.last_at)
      }
    })
  const active = new Set(conversations.filter((c) => c.lastAt >= since).map((c) => c.timeline.id))
  const read = conversations.filter((c) => active.has(c.timeline.id))
  const rows = new Map<string, HqLoopTimelineRow>()
  const byKey = new Map(read.map((c) => [c.key, c]))
  for (const c of read) {
    const row = rows.get(c.timeline.id) ?? {
      timeline: { ...c.timeline, messages: [] },
      projects: {}
    }
    row.projects[c.key] = c.project
    rows.set(c.timeline.id, row)
  }
  const messages = core.db.prepare(MESSAGES_SQL).all(JSON.stringify(read.map((c) => c.id)))
  for (const message of messages) {
    const key = String(message.key)
    const row = rows.get(byKey.get(key)?.timeline.id ?? '')
    if (!row || (message.reader === 'reply' && repeats(String(message.text), row.timeline))) {
      continue
    }
    ;(row.timeline.messages as HqLoopMessage[]).push({
      key,
      ts: String(message.ts),
      at: Number(message.at),
      fromOwner: message.direction === 'out',
      author: message.author == null ? null : String(message.author),
      authorId: message.author_id == null ? null : String(message.author_id),
      text: String(message.text),
      link: message.link == null ? null : String(message.link)
    })
  }
  return [...rows.values()]
}

/** Who the owner is, from the ledger's own outgoing rows: his Slack ids and the names he writes under. */
export function loopOwner(core: PulseCore): HqLoopOwner {
  const slackIds = core.db
    .prepare(
      `SELECT DISTINCT m.author_id id FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.direction = 'out' AND c.key LIKE 'slack:%' AND m.author_id IS NOT NULL`
    )
    .all()
    .map((row) => String(row.id))
    .filter((id) => /^[UW][A-Z0-9]+$/.test(id))
  const names = core.db
    .prepare(
      `SELECT DISTINCT author FROM conversation_messages WHERE direction = 'out' AND author IS NOT NULL`
    )
    .all()
    .map((row) => String(row.author))
    .filter((name) => name.trim().length > 1)
  return { slackIds, names }
}

function parse(payload: unknown): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(String(payload))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const disputedOf = (value: unknown): HqLoopDisputed | null =>
  (text(value) as HqLoopDisputed | null) ?? null

/** Every loop that came due since `since`, with how it closed or why it is disputed. */
export function loopRecords(core: PulseCore, since: number): HqLoopRecord[] {
  const kinds = Object.values(HQ_OPEN_LOOP_EVENTS)
  const rows = core.db
    .prepare(
      `SELECT kind, entity_id, at, payload FROM events
        WHERE kind IN (${kinds.map(() => '?').join(', ')}) AND entity_id IN (
          SELECT entity_id FROM events WHERE kind = ? AND at >= ?)
        ORDER BY seq`
    )
    .all(...kinds, HQ_OPEN_LOOP_EVENTS.open, since)
  const records = new Map<string, HqLoopRecord>()
  for (const row of rows) {
    const value = parse(row.payload)
    const id = String(row.entity_id)
    const at = Number(row.at)
    if (!value) {
      continue
    }
    if (row.kind === HQ_OPEN_LOOP_EVENTS.open) {
      records.set(id, {
        id,
        timeline: text(value.timeline) ?? '',
        direction: value.direction === 'on-me' ? 'on-me' : 'on-them',
        askKey: text(value.askKey) ?? '',
        askTs: text(value.askTs) ?? '',
        askAt: Number(value.askAt) || 0,
        link: text(value.link),
        person: text(value.person),
        personId: text(value.personId),
        title: text(value.title) ?? '',
        project: text(value.project),
        disputed: disputedOf(value.disputed),
        covered: text(value.covered),
        at,
        closed: null,
        disputedAt: null
      })
      continue
    }
    const record = records.get(id)
    if (!record) {
      continue
    }
    if (row.kind === HQ_OPEN_LOOP_EVENTS.disputed) {
      record.disputed = disputedOf(value.disputed) ?? record.disputed
      record.disputedAt = at
    } else {
      record.closed = {
        ts: text(value.ts) ?? '',
        link: text(value.link),
        byOwner: value.byOwner === true,
        at
      }
    }
  }
  return [...records.values()]
}

/** Records one verdict on one loop; false when that loop already has it — a pass after a restart
 *  repeats nothing. */
export function recordLoopEvent(
  core: PulseCore,
  kind: HqOpenLoopEvent,
  loopId: string,
  payload: Record<string, unknown>
): boolean {
  return core.transaction(() => {
    const seen = core.db
      .prepare('SELECT 1 FROM events WHERE kind = ? AND entity_id = ? LIMIT 1')
      .get(kind, loopId)
    if (seen) {
      return false
    }
    core.emit(kind, 'conversation', loopId, payload)
    return true
  })
}

export function pulseOpenLoops(core: () => PulseCore) {
  return {
    timelines: (since: number) => loopTimelines(core(), since),
    owner: () => loopOwner(core()),
    records: (since: number) => loopRecords(core(), since),
    record: (kind: HqOpenLoopEvent, loopId: string, payload: Record<string, unknown>) =>
      recordLoopEvent(core(), kind, loopId, payload)
  }
}
