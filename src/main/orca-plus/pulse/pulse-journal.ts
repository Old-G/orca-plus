// Custom build (hq-plus-journal): HQ+'s event journal. Every row added, settled or moved appends a
// `journal` event in the same transaction, so the phone and the UI follow it through the one change
// feed. Nothing else reads or writes the table.
import type { SqliteBindings, SqliteRow } from '../../sqlite/sqlite-statement'
import {
  HQ_JOURNAL_DEFAULT_LIMIT,
  HQ_JOURNAL_MAX_LIMIT,
  HQ_JOURNAL_NEEDS_PARTIES,
  HQ_JOURNAL_STATUSES,
  HQ_JOURNAL_UNASSIGNED,
  hqJournalBody,
  hqJournalTitle,
  isHqJournalNeeds,
  type HqJournalEntry,
  type HqJournalInput,
  type HqJournalLink,
  type HqJournalQuery,
  type HqJournalRecordResult,
  type HqJournalStatus
} from '../../../shared/hq-journal'
import type { PulseCore } from './pulse-core'
import { integer, oneOf, optionalText, text } from './pulse-row-fields'

const LINK_KINDS = ['mr', 'commit', 'clickup', 'slack', 'artifact', 'file', 'url'] as const

function readLinks(raw: string): HqJournalLink[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return (Array.isArray(parsed) ? parsed : []).flatMap((entry: unknown): HqJournalLink[] => {
      const field = (key: string): unknown =>
        entry && typeof entry === 'object' ? Reflect.get(entry, key) : undefined
      const kind = LINK_KINDS.find((candidate) => candidate === field('kind'))
      const url = field('url')
      const id = field('id')
      return kind && (typeof url === 'string' || typeof id === 'string')
        ? [
            {
              kind,
              ...(typeof url === 'string' ? { url } : {}),
              ...(typeof id === 'string' ? { id } : {})
            }
          ]
        : []
    })
  } catch {
    return []
  }
}

function toEntry(row: SqliteRow): HqJournalEntry {
  return {
    id: text(row, 'id'),
    at: integer(row, 'at'),
    workspace: text(row, 'workspace'),
    kind: text(row, 'kind'),
    project: optionalText(row, 'project'),
    address: optionalText(row, 'address'),
    sessionId: optionalText(row, 'session_id'),
    personId: optionalText(row, 'person_id'),
    title: text(row, 'title'),
    body: optionalText(row, 'body'),
    needs: text(row, 'needs'),
    status: oneOf(row, 'status', HQ_JOURNAL_STATUSES),
    replyTo: optionalText(row, 'reply_to'),
    refKind: optionalText(row, 'ref_kind'),
    refId: optionalText(row, 'ref_id'),
    links: readLinks(text(row, 'links')),
    source: text(row, 'source'),
    dedupeKey: optionalText(row, 'dedupe_key')
  }
}

function entryByDedupeKey(core: PulseCore, key: string): HqJournalEntry | null {
  const row = core.db.prepare('SELECT * FROM journal WHERE dedupe_key = ?').get(key)
  return row ? toEntry(row) : null
}

// Why: a source that still reports a thing open must not reopen what was already settled.
function settles(from: HqJournalStatus, to: HqJournalStatus): boolean {
  return from === 'open' && to !== 'open'
}

function settleInTransaction(
  core: PulseCore,
  entry: HqJournalEntry,
  status: HqJournalStatus
): HqJournalEntry {
  if (!settles(entry.status, status)) {
    return entry
  }
  const settled = { ...entry, status }
  core.db.prepare('UPDATE journal SET status = ? WHERE id = ?').run(status, entry.id)
  core.emit(`journal.${status}`, 'journal', entry.id, settled)
  return settled
}

function insertInTransaction(core: PulseCore, input: HqJournalInput): HqJournalEntry {
  if (!isHqJournalNeeds(input.needs)) {
    throw new Error(`pulse: journal needs "${input.needs}" is not one the journal knows`)
  }
  const entry: HqJournalEntry = {
    id: `e-${core.clock.newId()}`,
    at: input.at ?? core.clock.now(),
    workspace: input.workspace,
    kind: input.kind,
    project: input.project,
    address: input.address,
    sessionId: input.sessionId,
    personId: input.personId,
    title: hqJournalTitle(input.title),
    body: hqJournalBody(input.body),
    needs: input.needs,
    status: input.status ?? 'open',
    replyTo: input.replyTo,
    refKind: input.refKind,
    refId: input.refId,
    links: input.links ?? [],
    source: input.source,
    dedupeKey: input.dedupeKey
  }
  if (!entry.title) {
    throw new Error('pulse: a journal entry needs a title')
  }
  core.db
    .prepare(
      'INSERT INTO journal (id, at, workspace, kind, project, address, session_id, person_id, ' +
        'title, body, needs, status, reply_to, ref_kind, ref_id, links, source, dedupe_key) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      entry.id,
      entry.at,
      entry.workspace,
      entry.kind,
      entry.project,
      entry.address,
      entry.sessionId,
      entry.personId,
      entry.title,
      entry.body,
      entry.needs,
      entry.status,
      entry.replyTo,
      entry.refKind,
      entry.refId,
      JSON.stringify(entry.links),
      entry.source,
      entry.dedupeKey
    )
  core.emit('journal.added', 'journal', entry.id, entry)
  return entry
}

// Custom build (hq-plus-reports): a row written before its chat had an address joins the thread.
function addressInTransaction(
  core: PulseCore,
  entry: HqJournalEntry,
  input: HqJournalInput
): HqJournalEntry {
  if (entry.address !== null || !input.address) {
    return entry
  }
  const addressed = { ...entry, address: input.address }
  core.db.prepare('UPDATE journal SET address = ? WHERE id = ?').run(input.address, entry.id)
  core.emit('journal.addressed', 'journal', entry.id, addressed)
  return addressed
}

// Why: a project placed in a room later takes its earlier rows along — but a guess (the default
// room, no room) never pulls a row out of a real room, so a misread workspace file moves nothing.
function placeInTransaction(
  core: PulseCore,
  entry: HqJournalEntry,
  input: HqJournalInput
): HqJournalEntry {
  const allowed =
    input.placement === 'firm' ||
    (input.placement === 'fallback' && entry.workspace === HQ_JOURNAL_UNASSIGNED)
  if (!allowed || (entry.workspace === input.workspace && entry.project === input.project)) {
    return entry
  }
  const moved = { ...entry, workspace: input.workspace, project: input.project }
  core.db
    .prepare('UPDATE journal SET workspace = ?, project = ? WHERE id = ?')
    .run(moved.workspace, moved.project, entry.id)
  core.emit('journal.moved', 'journal', entry.id, moved)
  return moved
}

function settleSupersededInTransaction(core: PulseCore, input: HqJournalInput): number {
  const older = core.db
    .prepare(
      "SELECT * FROM journal WHERE kind = ? AND ref_id = ? AND status = 'open' AND dedupe_key != ?"
    )
    .all(input.kind, input.refId, input.dedupeKey)
    .map(toEntry)
  for (const entry of older) {
    settleInTransaction(core, entry, 'done')
  }
  return older.length
}

/**
 * Writes what the sources report now, in one transaction: a new dedupe key adds a row; a known one
 * follows its source's room as `placement` allows, and moves its status only from open to done or
 * dropped. A `supersedes` row then settles the older open rows of its kind and ref.
 */
export function recordJournal(
  core: PulseCore,
  inputs: readonly HqJournalInput[]
): HqJournalRecordResult {
  const result: HqJournalRecordResult = { added: 0, settled: 0, moved: 0 }
  if (inputs.length === 0) {
    return result
  }
  return core.transaction(() => {
    for (const input of inputs) {
      const known = input.dedupeKey ? entryByDedupeKey(core, input.dedupeKey) : null
      if (!known) {
        insertInTransaction(core, input)
        result.added += 1
        continue
      }
      const addressed = addressInTransaction(core, known, input)
      const placed = placeInTransaction(core, addressed, input)
      if (placed !== addressed) {
        result.moved += 1
      }
      if (settleInTransaction(core, placed, input.status ?? 'open') !== placed) {
        result.settled += 1
      }
    }
    for (const input of inputs) {
      if (input.supersedes && input.refId && input.dedupeKey) {
        result.settled += settleSupersededInTransaction(core, input)
      }
    }
    return result
  })
}

export function getJournalEntry(core: PulseCore, id: string): HqJournalEntry | null {
  const row = core.db.prepare('SELECT * FROM journal WHERE id = ?').get(id)
  return row ? toEntry(row) : null
}

/** Newest first; a `needs` party matches all its values, a `kind` ending in `*` a whole family. */
export function listJournal(core: PulseCore, query: HqJournalQuery = {}): HqJournalEntry[] {
  const where: string[] = []
  const args: SqliteBindings = []
  if (query.workspaces) {
    if (query.workspaces.length === 0) {
      return []
    }
    where.push(`workspace IN (${query.workspaces.map(() => '?').join(', ')})`)
    args.push(...query.workspaces)
  }
  if (query.since !== undefined) {
    where.push('at >= ?')
    args.push(query.since)
  }
  if (query.project) {
    // Why: records name a project by its slug or by its folder («Billing»), in either case.
    where.push('lower(project) = lower(?)')
    args.push(query.project)
  }
  if (query.needs) {
    const party = HQ_JOURNAL_NEEDS_PARTIES.find((candidate) => candidate === query.needs)
    if (party && party !== 'nobody') {
      where.push("substr(needs, 1, length(?) + 1) = ? || ':'")
      args.push(party, party)
    } else {
      where.push('needs = ?')
      args.push(query.needs)
    }
  }
  if (query.status) {
    where.push('status = ?')
    args.push(query.status)
  }
  for (const [column, value] of [
    ['address', query.address],
    ['session_id', query.sessionId],
    ['source', query.source]
  ] as const) {
    if (value) {
      where.push(`${column} = ?`)
      args.push(value)
    }
  }
  if (query.kind) {
    const family = query.kind.endsWith('*') ? query.kind.slice(0, -1) : null
    if (family !== null) {
      where.push('substr(kind, 1, length(?)) = ?')
      args.push(family, family)
    } else {
      where.push('kind = ?')
      args.push(query.kind)
    }
  }
  const limit = Math.max(1, Math.min(query.limit ?? HQ_JOURNAL_DEFAULT_LIMIT, HQ_JOURNAL_MAX_LIMIT))
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  return core.db
    .prepare(
      `SELECT * FROM journal${whereSql} ORDER BY ${query.oldestFirst ? 'at, rowid' : 'at DESC, rowid DESC'} LIMIT ?`
    )
    .all(...args, limit)
    .map(toEntry)
}
