// Custom build (pulse): the change feed. Readers page through it by seq, so a phone that was
// offline catches up with exactly what it missed.
import type { SqliteRow } from '../../sqlite/sqlite-statement'
import type { PulseEvent } from '../../../shared/pulse-types'
import type { PulseCore } from './pulse-core'
import { integer, oneOf, text } from './pulse-row-fields'

const ENTITIES = ['person', 'waiting', 'draft', 'decision', 'inbox'] as const
const MAX_PAGE = 500

function toEvent(row: SqliteRow): PulseEvent {
  let payload: unknown = null
  try {
    payload = JSON.parse(text(row, 'payload'))
  } catch {
    payload = null
  }
  return {
    seq: integer(row, 'seq'),
    at: integer(row, 'at'),
    kind: text(row, 'kind'),
    entity: oneOf(row, 'entity', ENTITIES),
    entityId: text(row, 'entity_id'),
    payload
  }
}

/** Events after `afterSeq` (0 = from the start), oldest first, at most `limit` (≤ 500). */
export function listEventsSince(core: PulseCore, afterSeq: number, limit = MAX_PAGE): PulseEvent[] {
  return core.db
    .prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?')
    .all(afterSeq, Math.max(1, Math.min(limit, MAX_PAGE)))
    .map(toEvent)
}

export function latestEventSeq(core: PulseCore): number {
  const row = core.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get()
  return row ? integer(row, 'seq') : 0
}

/** Drops events older than `beforeAt`; the records themselves stay. Returns how many went. */
export function pruneEvents(core: PulseCore, beforeAt: number): number {
  return core.transaction(() =>
    Number(core.db.prepare('DELETE FROM events WHERE at < ?').run(beforeAt).changes)
  )
}
