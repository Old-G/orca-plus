// Custom build (pulse): the bell's items. An item with a dedupe key is raised once while it is
// open, so a producer can re-announce the same thing on every tick without piling up copies.
import type { SqliteRow } from '../../sqlite/sqlite-statement'
import type {
  PulseAddResult,
  PulseInboxAction,
  PulseInboxInput,
  PulseInboxItem
} from '../../../shared/pulse-types'
import type { PulseCore } from './pulse-core'
import { integer, oneOf, optionalInteger, optionalText, text } from './pulse-row-fields'

const URGENCIES = ['normal', 'urgent'] as const

function readActions(raw: string): PulseInboxAction[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((entry: unknown) => {
      const id: unknown = entry && typeof entry === 'object' ? Reflect.get(entry, 'id') : null
      const label: unknown = entry && typeof entry === 'object' ? Reflect.get(entry, 'label') : null
      return typeof id === 'string' && typeof label === 'string' ? [{ id, label }] : []
    })
  } catch {
    return []
  }
}

function toItem(row: SqliteRow): PulseInboxItem {
  return {
    id: text(row, 'id'),
    kind: text(row, 'kind'),
    title: text(row, 'title'),
    body: optionalText(row, 'body'),
    urgency: oneOf(row, 'urgency', URGENCIES),
    refKind: optionalText(row, 'ref_kind'),
    refId: optionalText(row, 'ref_id'),
    actions: readActions(text(row, 'actions')),
    dedupeKey: optionalText(row, 'dedupe_key'),
    createdAt: integer(row, 'created_at'),
    readAt: optionalInteger(row, 'read_at'),
    doneAt: optionalInteger(row, 'done_at'),
    doneAction: optionalText(row, 'done_action')
  }
}

export function getInboxItem(core: PulseCore, id: string): PulseInboxItem | null {
  const row = core.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id)
  return row ? toItem(row) : null
}

export function addInboxItem(
  core: PulseCore,
  input: PulseInboxInput
): PulseAddResult<PulseInboxItem> {
  return core.transaction(() => addInboxItemInTransaction(core, input))
}

function addInboxItemInTransaction(
  core: PulseCore,
  input: PulseInboxInput
): PulseAddResult<PulseInboxItem> {
  if (input.dedupeKey) {
    const row = core.db
      .prepare('SELECT * FROM inbox WHERE dedupe_key = ? AND done_at IS NULL')
      .get(input.dedupeKey)
    if (row) {
      return { record: toItem(row), created: false }
    }
  }
  const item: PulseInboxItem = {
    id: core.clock.newId(),
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    urgency: input.urgency ?? 'normal',
    refKind: input.refKind ?? null,
    refId: input.refId ?? null,
    actions: input.actions ?? [],
    dedupeKey: input.dedupeKey ?? null,
    createdAt: core.clock.now(),
    readAt: null,
    doneAt: null,
    doneAction: null
  }
  core.db
    .prepare(
      'INSERT INTO inbox (id, kind, title, body, urgency, ref_kind, ref_id, actions, ' +
        'dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      item.id,
      item.kind,
      item.title,
      item.body,
      item.urgency,
      item.refKind,
      item.refId,
      JSON.stringify(item.actions),
      item.dedupeKey,
      item.createdAt
    )
  core.emit('inbox.added', 'inbox', item.id, item)
  return { record: item, created: true }
}

function update(core: PulseCore, id: string, change: 'read' | 'done', action?: string) {
  return core.transaction(() => updateInTransaction(core, id, change, action))
}

function updateInTransaction(
  core: PulseCore,
  id: string,
  change: 'read' | 'done',
  action?: string
): PulseInboxItem {
  const existing = getInboxItem(core, id)
  if (!existing) {
    throw new Error(`pulse: no inbox item ${id}`)
  }
  const now = core.clock.now()
  const next: PulseInboxItem =
    change === 'read'
      ? { ...existing, readAt: existing.readAt ?? now }
      : {
          ...existing,
          readAt: existing.readAt ?? now,
          doneAt: existing.doneAt ?? now,
          doneAction: existing.doneAt ? existing.doneAction : (action ?? null)
        }
  if (next.readAt === existing.readAt && next.doneAt === existing.doneAt) {
    return existing
  }
  core.db
    .prepare('UPDATE inbox SET read_at = ?, done_at = ?, done_action = ? WHERE id = ?')
    .run(next.readAt, next.doneAt, next.doneAction, id)
  core.emit(`inbox.${change}`, 'inbox', id, next)
  return next
}

export function markInboxRead(core: PulseCore, id: string): PulseInboxItem {
  return update(core, id, 'read')
}

/** Done with the button that was pressed, if any; done twice keeps the first answer. */
export function markInboxDone(core: PulseCore, id: string, action?: string): PulseInboxItem {
  return update(core, id, 'done', action)
}

/** Open items (not done), urgent first, then newest. */
export function listInbox(core: PulseCore, options: { includeDone?: boolean } = {}) {
  const whereSql = options.includeDone ? '' : ' WHERE done_at IS NULL'
  const sql = `SELECT * FROM inbox${whereSql} ORDER BY urgency = 'urgent' DESC, created_at DESC, rowid DESC`
  return core.db.prepare(sql).all().map(toItem)
}

// Custom build (pulse-bell): closing reason for an item whose source no longer reports it.
export const INBOX_GONE_ACTION = 'gone'

/**
 * Makes the open items of `kind` match what a producer reports now: raises the missing ones,
 * closes those it no longer reports. One the user already answered stays closed for its key.
 */
export function syncInboxKind(
  core: PulseCore,
  kind: string,
  desired: readonly (PulseInboxInput & { dedupeKey: string })[]
): { raised: number; closed: number } {
  return core.transaction(() => {
    const wanted = new Map(desired.map((input) => [input.dedupeKey, input]))
    let closed = 0
    for (const item of listInbox(core).filter((entry) => entry.kind === kind)) {
      if (!item.dedupeKey || !wanted.has(item.dedupeKey)) {
        updateInTransaction(core, item.id, 'done', INBOX_GONE_ACTION)
        closed += 1
      }
    }
    let raised = 0
    for (const input of wanted.values()) {
      const answered = core.db
        .prepare(
          'SELECT 1 FROM inbox WHERE dedupe_key = ? AND done_at IS NOT NULL AND ' +
            '(done_action IS NULL OR done_action != ?) LIMIT 1'
        )
        .get(input.dedupeKey, INBOX_GONE_ACTION)
      if (!answered && addInboxItemInTransaction(core, { ...input, kind }).created) {
        raised += 1
      }
    }
    return { raised, closed }
  })
}
