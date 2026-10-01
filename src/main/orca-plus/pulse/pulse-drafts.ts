// Custom build (pulse): drafts — what an agent wants to send, held until the owner decides. Nothing here
// sends anything; a sender marks the draft sent or failed after it tried.
import type { SqliteRow } from '../../sqlite/sqlite-statement'
import type {
  PulseAddResult,
  PulseDraft,
  PulseDraftInput,
  PulseDraftStatus
} from '../../../shared/pulse-types'
import { parseOutgoingDraftCall } from '../../../shared/outgoing-approval/outgoing-action'
import type { PulseCore } from './pulse-core'
import { integer, oneOf, optionalText, text } from './pulse-row-fields'

const KINDS = ['message', 'clickup-task', 'clickup-comment', 'other'] as const
export const DRAFT_STATUSES = ['pending', 'approved', 'rejected', 'sent', 'failed'] as const

function toDraft(row: SqliteRow): PulseDraft {
  return {
    id: text(row, 'id'),
    kind: oneOf(row, 'kind', KINDS),
    target: optionalText(row, 'target'),
    title: optionalText(row, 'title'),
    body: text(row, 'body'),
    project: optionalText(row, 'project'),
    personId: optionalText(row, 'person_id'),
    source: text(row, 'source'),
    sourceRef: optionalText(row, 'source_ref'),
    fingerprint: optionalText(row, 'fingerprint'),
    status: oneOf(row, 'status', DRAFT_STATUSES),
    createdAt: integer(row, 'created_at'),
    updatedAt: integer(row, 'updated_at'),
    call: parseOutgoingDraftCall(optionalText(row, 'payload'))
  }
}

export function getDraft(core: PulseCore, id: string): PulseDraft | null {
  const row = core.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id)
  return row ? toDraft(row) : null
}

/** Adds a pending draft — unless one with the same kind and fingerprint exists in any status. */
export function addDraft(core: PulseCore, input: PulseDraftInput): PulseAddResult<PulseDraft> {
  return core.transaction(() => {
    if (input.fingerprint) {
      const row = core.db
        .prepare('SELECT * FROM drafts WHERE kind = ? AND fingerprint = ?')
        .get(input.kind, input.fingerprint)
      if (row) {
        return { record: toDraft(row), created: false }
      }
    }
    const now = core.clock.now()
    const draft: PulseDraft = {
      id: core.clock.newId(),
      kind: input.kind,
      target: input.target ?? null,
      title: input.title ?? null,
      body: input.body,
      project: input.project ?? null,
      personId: input.personId ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      fingerprint: input.fingerprint ?? null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      call: input.call ?? null
    }
    core.db
      .prepare(
        'INSERT INTO drafts (id, kind, target, title, body, project, person_id, source, ' +
          'source_ref, fingerprint, status, created_at, updated_at, payload) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        draft.id,
        draft.kind,
        draft.target,
        draft.title,
        draft.body,
        draft.project,
        draft.personId,
        draft.source,
        draft.sourceRef,
        draft.fingerprint,
        draft.status,
        now,
        now,
        draft.call ? JSON.stringify(draft.call) : null
      )
    core.emit('draft.added', 'draft', draft.id, draft)
    return { record: draft, created: true }
  })
}

// Why: an approved draft is sent at most once; a failed send may be retried, a rejection is final.
const NEXT: Record<PulseDraftStatus, readonly PulseDraftStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['sent', 'failed'],
  failed: ['sent', 'failed'],
  rejected: [],
  sent: []
}

/** Moves a draft along NEXT; call inside a transaction. Returns the updated draft. */
export function moveDraft(
  core: PulseCore,
  id: string,
  status: PulseDraftStatus,
  body?: string
): PulseDraft {
  const existing = getDraft(core, id)
  if (!existing) {
    throw new Error(`pulse: no draft ${id}`)
  }
  if (!NEXT[existing.status].includes(status)) {
    throw new Error(`pulse: draft ${id} cannot go from ${existing.status} to ${status}`)
  }
  const moved: PulseDraft = {
    ...existing,
    status,
    body: body ?? existing.body,
    updatedAt: core.clock.now()
  }
  core.db
    .prepare('UPDATE drafts SET status = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(moved.status, moved.body, moved.updatedAt, id)
  return moved
}

/** A sender reports the outcome of an approved draft. */
export function markDraftDelivery(
  core: PulseCore,
  id: string,
  status: 'sent' | 'failed'
): PulseDraft {
  return core.transaction(() => {
    const moved = moveDraft(core, id, status)
    core.emit(`draft.${status}`, 'draft', id, moved)
    return moved
  })
}

/** Custom build (outgoing-approval): the agent stopped waiting before anyone decided; no approval is recorded. */
export function abandonDraft(core: PulseCore, id: string): PulseDraft {
  return core.transaction(() => {
    const moved = moveDraft(core, id, 'rejected')
    core.emit('draft.abandoned', 'draft', id, moved)
    return moved
  })
}

/** Newest first; all statuses unless one is given. */
export function listDrafts(core: PulseCore, status?: PulseDraftStatus): PulseDraft[] {
  const rows = status
    ? core.db
        .prepare('SELECT * FROM drafts WHERE status = ? ORDER BY created_at DESC, rowid DESC')
        .all(status)
    : core.db.prepare('SELECT * FROM drafts ORDER BY created_at DESC, rowid DESC').all()
  return rows.map(toDraft)
}
