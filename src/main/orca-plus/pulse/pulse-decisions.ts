// Custom build (pulse): decisions — ones an agent or the owner logs, and every approval of a draft.
import type { SqliteRow } from '../../sqlite/sqlite-statement'
import type {
  PulseApprovalOutcome,
  PulseDecision,
  PulseDecisionInput,
  PulseDecisionKind,
  PulseDraft
} from '../../../shared/pulse-types'
import type { PulseCore } from './pulse-core'
import { moveDraft } from './pulse-drafts'
import { integer, oneOf, optionalOneOf, optionalText, text } from './pulse-row-fields'

const KINDS = ['decision', 'approval'] as const

export type PulseDecisionListOptions = {
  limit?: number
  unmirrored?: boolean
  kind?: PulseDecisionKind
}
const OUTCOMES = ['approved', 'edited', 'rejected'] as const

function toDecision(row: SqliteRow): PulseDecision {
  return {
    id: text(row, 'id'),
    kind: oneOf(row, 'kind', KINDS),
    title: text(row, 'title'),
    body: optionalText(row, 'body'),
    outcome: optionalOneOf(row, 'outcome', OUTCOMES),
    project: optionalText(row, 'project'),
    personId: optionalText(row, 'person_id'),
    draftId: optionalText(row, 'draft_id'),
    source: text(row, 'source'),
    decidedAt: integer(row, 'decided_at'),
    mirroredPath: optionalText(row, 'mirrored_path')
  }
}

function insertDecision(core: PulseCore, decision: PulseDecision): void {
  core.db
    .prepare(
      'INSERT INTO decisions (id, kind, title, body, outcome, project, person_id, draft_id, ' +
        'source, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      decision.id,
      decision.kind,
      decision.title,
      decision.body,
      decision.outcome,
      decision.project,
      decision.personId,
      decision.draftId,
      decision.source,
      decision.decidedAt
    )
  core.emit('decision.logged', 'decision', decision.id, decision)
}

export function logDecision(core: PulseCore, input: PulseDecisionInput): PulseDecision {
  return core.transaction(() => {
    const decision: PulseDecision = {
      id: core.clock.newId(),
      kind: 'decision',
      title: input.title,
      body: input.body ?? null,
      outcome: null,
      project: input.project ?? null,
      personId: input.personId ?? null,
      draftId: null,
      source: input.source,
      decidedAt: core.clock.now(),
      mirroredPath: null
    }
    insertDecision(core, decision)
    return decision
  })
}

/**
 * The owner's answer to a pending draft: approved as is, approved with `editedBody`, or rejected.
 * The draft's move and its approval record land together or not at all.
 */
export function decideDraft(
  core: PulseCore,
  draftId: string,
  outcome: PulseApprovalOutcome,
  editedBody?: string
): { draft: PulseDraft; decision: PulseDecision } {
  if (outcome === 'edited' && !editedBody?.trim()) {
    throw new Error('pulse: an edited approval needs the edited text')
  }
  return core.transaction(() => {
    const draft = moveDraft(
      core,
      draftId,
      outcome === 'rejected' ? 'rejected' : 'approved',
      outcome === 'edited' ? editedBody : undefined
    )
    const decision: PulseDecision = {
      id: core.clock.newId(),
      kind: 'approval',
      title: draft.title ?? `${draft.kind} → ${draft.target ?? 'no target'}`,
      body: draft.body,
      outcome,
      project: draft.project,
      personId: draft.personId,
      draftId: draft.id,
      source: 'owner',
      decidedAt: core.clock.now(),
      mirroredPath: null
    }
    core.emit('draft.decided', 'draft', draft.id, draft)
    insertDecision(core, decision)
    return { draft, decision }
  })
}

/** Records where the decision was mirrored in HQ (4.4). */
export function setDecisionMirror(core: PulseCore, id: string, path: string): void {
  core.transaction(() => {
    core.db.prepare('UPDATE decisions SET mirrored_path = ? WHERE id = ?').run(path, id)
    const row = core.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id)
    if (!row) {
      throw new Error(`pulse: no decision ${id}`)
    }
    core.emit('decision.mirrored', 'decision', id, toDecision(row))
  })
}

/** Newest first, at most `limit`. */
export function listDecisions(
  core: PulseCore,
  options: PulseDecisionListOptions = {}
): PulseDecision[] {
  const where = [
    options.unmirrored ? 'mirrored_path IS NULL' : null,
    options.kind ? 'kind = ?' : null
  ].filter((clause): clause is string => clause !== null)
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  const sql = `SELECT * FROM decisions${whereSql} ORDER BY decided_at DESC, rowid DESC LIMIT ?`
  const bindings = options.kind ? [options.kind, options.limit ?? 100] : [options.limit ?? 100]
  return core.db
    .prepare(sql)
    .all(...bindings)
    .map(toDecision)
}
