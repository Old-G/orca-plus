// Custom build (hq-plus-journal): the agent sessions behind HQ+'s threads — which room and project
// each works in and when it was last seen. Written by the journal's adapters; no change event.
import type { SqliteRow } from '../../sqlite/sqlite-statement'
import { HQ_SESSION_STATES, type HqSession, type HqSessionInput } from '../../../shared/hq-journal'
import type { PulseCore } from './pulse-core'
import { integer, oneOf, optionalInteger, optionalText, text } from './pulse-row-fields'

function toSession(row: SqliteRow): HqSession {
  return {
    sessionId: text(row, 'session_id'),
    address: optionalText(row, 'address'),
    agent: optionalText(row, 'agent'),
    worktreeId: optionalText(row, 'worktree_id'),
    workspace: text(row, 'workspace'),
    project: optionalText(row, 'project'),
    state: oneOf(row, 'state', HQ_SESSION_STATES),
    contextPct: optionalInteger(row, 'context_pct'),
    openedAt: integer(row, 'opened_at'),
    lastActivityAt: integer(row, 'last_activity_at'),
    closedAt: optionalInteger(row, 'closed_at'),
    parentSessionId: optionalText(row, 'parent_session_id'),
    taskRef: optionalText(row, 'task_ref')
  }
}

export function getSession(core: PulseCore, sessionId: string): HqSession | null {
  const row = core.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId)
  return row ? toSession(row) : null
}

/** Records sightings of sessions: a new one opens at its sighting; a known one keeps what the
 *  sighting leaves null, and only a newer sighting moves its state and last activity. */
export function noteSessions(core: PulseCore, inputs: readonly HqSessionInput[]): number {
  if (inputs.length === 0) {
    return 0
  }
  return core.transaction(() => {
    let changed = 0
    for (const input of inputs) {
      const known = getSession(core, input.sessionId)
      const newer = !known || input.at >= known.lastActivityAt
      const state = newer ? input.state : (known?.state ?? input.state)
      const next: HqSession = {
        sessionId: input.sessionId,
        address: input.address ?? known?.address ?? null,
        agent: input.agent ?? known?.agent ?? null,
        worktreeId: input.worktreeId ?? known?.worktreeId ?? null,
        workspace: newer ? input.workspace : (known?.workspace ?? input.workspace),
        project: input.project ?? known?.project ?? null,
        state,
        contextPct: input.contextPct ?? known?.contextPct ?? null,
        openedAt: Math.min(known?.openedAt ?? input.at, input.at),
        lastActivityAt: Math.max(known?.lastActivityAt ?? input.at, input.at),
        // Custom build (hq-plus-sessions): closed to History when the dispatcher or cleanup closed it.
        closedAt: state === 'closed' ? (known?.closedAt ?? input.at) : null,
        parentSessionId: input.parentSessionId ?? known?.parentSessionId ?? null,
        taskRef: input.taskRef ?? known?.taskRef ?? null
      }
      if (known && JSON.stringify(known) === JSON.stringify(next)) {
        continue
      }
      core.db
        .prepare(
          'INSERT INTO sessions (session_id, address, agent, worktree_id, workspace, project, ' +
            'state, context_pct, opened_at, last_activity_at, closed_at, parent_session_id, ' +
            'task_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT(session_id) DO UPDATE SET address = excluded.address, ' +
            'agent = excluded.agent, worktree_id = excluded.worktree_id, ' +
            'workspace = excluded.workspace, project = excluded.project, state = excluded.state, ' +
            'context_pct = excluded.context_pct, opened_at = excluded.opened_at, ' +
            'last_activity_at = excluded.last_activity_at, closed_at = excluded.closed_at, ' +
            'parent_session_id = excluded.parent_session_id, task_ref = excluded.task_ref'
        )
        .run(
          next.sessionId,
          next.address,
          next.agent,
          next.worktreeId,
          next.workspace,
          next.project,
          next.state,
          next.contextPct,
          next.openedAt,
          next.lastActivityAt,
          next.closedAt,
          next.parentSessionId,
          next.taskRef
        )
      changed += 1
    }
    return changed
  })
}

/** Custom build (hq-plus-reports): the sessions that worked on one thread, latest activity first. */
export function listSessionsByAddress(core: PulseCore, address: string): HqSession[] {
  return core.db
    .prepare('SELECT * FROM sessions WHERE address = ? ORDER BY last_activity_at DESC')
    .all(address)
    .map(toSession)
}

/** Custom build (hq-plus-context): one project's sessions, latest activity first. */
export function listSessionsByProject(core: PulseCore, project: string, limit = 20): HqSession[] {
  return core.db
    .prepare(
      'SELECT * FROM sessions WHERE project = ? COLLATE NOCASE ORDER BY last_activity_at DESC LIMIT ?'
    )
    .all(project, limit)
    .map(toSession)
}

/** Custom build (hq-plus-sessions): the sessions seen since `since`, latest activity first. */
export function listRecentSessions(core: PulseCore, since: number, limit = 500): HqSession[] {
  return core.db
    .prepare(
      'SELECT * FROM sessions WHERE last_activity_at >= ? ORDER BY last_activity_at DESC LIMIT ?'
    )
    .all(since, limit)
    .map(toSession)
}
