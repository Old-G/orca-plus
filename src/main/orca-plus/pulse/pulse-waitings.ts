// Custom build (pulse): waitings — "Ann waits for my answer" (on-me) and "I wait for Ann" (on-them).
import type { SqliteBindings, SqliteRow } from '../../sqlite/sqlite-statement'
import type {
  PulseWaiting,
  PulseWaitingFilter,
  PulseWaitingInput,
  PulseWaitingStatus
} from '../../../shared/pulse-types'
import type { PulseCore } from './pulse-core'
import { integer, oneOf, optionalInteger, optionalText, text } from './pulse-row-fields'

const DIRECTIONS = ['on-me', 'on-them'] as const
const STATUSES = ['open', 'resolved', 'cancelled'] as const

function toWaiting(row: SqliteRow): PulseWaiting {
  return {
    id: text(row, 'id'),
    direction: oneOf(row, 'direction', DIRECTIONS),
    personId: optionalText(row, 'person_id'),
    project: optionalText(row, 'project'),
    title: text(row, 'title'),
    detail: optionalText(row, 'detail'),
    source: text(row, 'source'),
    sourceRef: optionalText(row, 'source_ref'),
    status: oneOf(row, 'status', STATUSES),
    dueAt: optionalInteger(row, 'due_at'),
    resolution: optionalText(row, 'resolution'),
    createdAt: integer(row, 'created_at'),
    resolvedAt: optionalInteger(row, 'resolved_at')
  }
}

export function getWaiting(core: PulseCore, id: string): PulseWaiting | null {
  const row = core.db.prepare('SELECT * FROM waitings WHERE id = ?').get(id)
  return row ? toWaiting(row) : null
}

export function addWaiting(core: PulseCore, input: PulseWaitingInput): PulseWaiting {
  return core.transaction(() => {
    const waiting: PulseWaiting = {
      id: core.clock.newId(),
      direction: input.direction,
      personId: input.personId ?? null,
      project: input.project ?? null,
      title: input.title,
      detail: input.detail ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      status: 'open',
      dueAt: input.dueAt ?? null,
      resolution: null,
      createdAt: core.clock.now(),
      resolvedAt: null
    }
    core.db
      .prepare(
        'INSERT INTO waitings (id, direction, person_id, project, title, detail, source, ' +
          'source_ref, status, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        waiting.id,
        waiting.direction,
        waiting.personId,
        waiting.project,
        waiting.title,
        waiting.detail,
        waiting.source,
        waiting.sourceRef,
        waiting.status,
        waiting.dueAt,
        waiting.createdAt
      )
    core.emit('waiting.added', 'waiting', waiting.id, waiting)
    return waiting
  })
}

/** Closes an open waiting; closing one that is already closed is an error, not a no-op. */
export function closeWaiting(
  core: PulseCore,
  id: string,
  status: Exclude<PulseWaitingStatus, 'open'>,
  resolution?: string | null
): PulseWaiting {
  return core.transaction(() => {
    const existing = getWaiting(core, id)
    if (!existing) {
      throw new Error(`pulse: no waiting ${id}`)
    }
    if (existing.status !== 'open') {
      throw new Error(`pulse: waiting ${id} is already ${existing.status}`)
    }
    const closed: PulseWaiting = {
      ...existing,
      status,
      resolution: resolution ?? null,
      resolvedAt: core.clock.now()
    }
    core.db
      .prepare('UPDATE waitings SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?')
      .run(closed.status, closed.resolution, closed.resolvedAt, id)
    core.emit(`waiting.${status}`, 'waiting', id, closed)
    return closed
  })
}

/** Newest first. */
export function listWaitings(core: PulseCore, filter: PulseWaitingFilter = {}): PulseWaiting[] {
  const where: string[] = []
  const bindings: SqliteBindings = []
  const add = (column: string, value: string | undefined): void => {
    if (value !== undefined) {
      where.push(`${column} = ?`)
      bindings.push(value)
    }
  }
  add('status', filter.status)
  add('direction', filter.direction)
  add('person_id', filter.personId)
  add('project', filter.project)
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  const sql = `SELECT * FROM waitings${whereSql} ORDER BY created_at DESC, rowid DESC`
  return core.db
    .prepare(sql)
    .all(...bindings)
    .map(toWaiting)
}
