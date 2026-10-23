// Custom build (pulse): waitings — "Ann waits for my answer" (on-me) and "I wait for Ann" (on-them).
import type { SqliteBindings, SqliteRow } from '../../sqlite/sqlite-statement'
import type {
  PulseWaiting,
  PulseWaitingAdded,
  PulseWaitingFilter,
  PulseWaitingInput,
  PulseWaitingPatch,
  PulseWaitingReply,
  PulseWaitingStatus
} from '../../../shared/pulse-types'
import { findDuplicateWaiting } from '../../../shared/pulse-waiting-similarity'
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
    resolvedAt: optionalInteger(row, 'resolved_at'),
    agentSessionId: optionalText(row, 'agent_session_id'),
    paneKey: optionalText(row, 'pane_key'),
    worktreeId: optionalText(row, 'worktree_id'),
    reply: optionalText(row, 'reply'),
    replyAuthor: optionalText(row, 'reply_author'),
    replyTs: optionalText(row, 'reply_ts'),
    repliedAt: optionalInteger(row, 'replied_at'),
    replyDeliveredAt: optionalInteger(row, 'reply_delivered_at'),
    replyLink: optionalText(row, 'reply_link')
  }
}

export function getWaiting(core: PulseCore, id: string): PulseWaiting | null {
  const row = core.db.prepare('SELECT * FROM waitings WHERE id = ?').get(id)
  return row ? toWaiting(row) : null
}

export function addWaiting(core: PulseCore, input: PulseWaitingInput): PulseWaitingAdded {
  return core.transaction(() => {
    if (!input.allowDuplicate) {
      const open = listWaitings(core, { status: 'open' })
      const duplicate = findDuplicateWaiting(open, input)
      if (duplicate) {
        return { ...duplicate, duplicate: true }
      }
    }
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
      resolvedAt: null,
      agentSessionId: input.agentSessionId ?? null,
      paneKey: input.paneKey ?? null,
      worktreeId: input.worktreeId ?? null,
      reply: null,
      replyAuthor: null,
      replyTs: null,
      repliedAt: null,
      replyDeliveredAt: null
    }
    core.db
      .prepare(
        'INSERT INTO waitings (id, direction, person_id, project, title, detail, source, ' +
          'source_ref, status, due_at, created_at, agent_session_id, pane_key, worktree_id) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
        waiting.createdAt,
        waiting.agentSessionId,
        waiting.paneKey,
        waiting.worktreeId
      )
    core.emit('waiting.added', 'waiting', waiting.id, waiting)
    return waiting
  })
}

/** Custom build (hq-notes-dedup): the same note with a new date or detail updates, not repeats. */
export function updateWaiting(core: PulseCore, id: string, patch: PulseWaitingPatch): PulseWaiting {
  return core.transaction(() => {
    const existing = getWaiting(core, id)
    if (!existing) {
      throw new Error(`pulse: no waiting ${id}`)
    }
    if (existing.status !== 'open') {
      throw new Error(`pulse: waiting ${id} is already ${existing.status}`)
    }
    const updated: PulseWaiting = {
      ...existing,
      title: patch.title ?? existing.title,
      detail: patch.detail === undefined ? existing.detail : patch.detail,
      dueAt: patch.dueAt === undefined ? existing.dueAt : patch.dueAt
    }
    core.db
      .prepare('UPDATE waitings SET title = ?, detail = ?, due_at = ? WHERE id = ?')
      .run(updated.title, updated.detail, updated.dueAt, id)
    core.emit('waiting.updated', 'waiting', id, updated)
    return updated
  })
}

/** Custom build (claude-handoff-launch): open waitings follow the chat that took over the work. */
export function moveOpenWaitingsToChat(
  core: PulseCore,
  fromSessionId: string,
  toSessionId: string
): PulseWaiting[] {
  return core.transaction(() => {
    const moved = listWaitings(core, { status: 'open' }).filter(
      (waiting) => waiting.agentSessionId === fromSessionId
    )
    const update = core.db.prepare(
      'UPDATE waitings SET agent_session_id = ?, pane_key = NULL WHERE id = ?'
    )
    return moved.map((waiting) => {
      update.run(toSessionId, waiting.id)
      const updated: PulseWaiting = { ...waiting, agentSessionId: toSessionId, paneKey: null }
      core.emit('waiting.updated', 'waiting', waiting.id, updated)
      return updated
    })
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

/** Custom build (hq-waiting-replies): keeps the person's newest answer; an older or repeated ts is
 *  ignored, so the scout re-reporting a thread changes nothing. Null when nothing changed. */
export function recordWaitingReply(
  core: PulseCore,
  id: string,
  reply: PulseWaitingReply
): PulseWaiting | null {
  return core.transaction(() => {
    const existing = getWaiting(core, id)
    if (!existing || existing.status !== 'open') {
      return null
    }
    if (existing.replyTs !== null && Number(existing.replyTs) >= Number(reply.ts)) {
      return null
    }
    const replied: PulseWaiting = {
      ...existing,
      reply: reply.text,
      replyAuthor: reply.author,
      replyTs: reply.ts,
      repliedAt: core.clock.now(),
      replyDeliveredAt: null,
      replyLink: reply.link ?? null
    }
    core.db
      .prepare(
        'UPDATE waitings SET reply = ?, reply_author = ?, reply_ts = ?, replied_at = ?, ' +
          'reply_delivered_at = NULL, reply_link = ? WHERE id = ?'
      )
      .run(
        replied.reply,
        replied.replyAuthor,
        replied.replyTs,
        replied.repliedAt,
        reply.link ?? null,
        id
      )
    core.emit('waiting.replied', 'waiting', id, replied)
    return replied
  })
}

/** `replyTs`: only that answer counts as handled; a newer one that came meanwhile stays pending. */
export function markWaitingReplyDelivered(
  core: PulseCore,
  id: string,
  replyTs?: string
): PulseWaiting | null {
  return core.transaction(() => {
    const existing = getWaiting(core, id)
    if (
      !existing?.repliedAt ||
      existing.replyDeliveredAt !== null ||
      (replyTs !== undefined && existing.replyTs !== replyTs)
    ) {
      return null
    }
    const delivered: PulseWaiting = { ...existing, replyDeliveredAt: core.clock.now() }
    core.db
      .prepare('UPDATE waitings SET reply_delivered_at = ? WHERE id = ?')
      .run(delivered.replyDeliveredAt, id)
    core.emit('waiting.replyDelivered', 'waiting', id, delivered)
    return delivered
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
