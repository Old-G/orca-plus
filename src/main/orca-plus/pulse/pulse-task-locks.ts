// Custom build (hq-task-lock, A3 28.11): which chat holds a row of a Lead's plan. One holder per row;
// a new holder replaces the old one. Whether the holder still holds it (its chat is open) is decided by
// hq-task-lock, not here.
import type { HqTaskKey } from '../../../shared/hq-task-lock'
import type { PulseCore } from './pulse-core'

/** Side table (see SIDE_TABLES in pulse-schema): no version bump, an older build still opens the file. */
export const TASK_LOCKS_TABLE = `
CREATE TABLE IF NOT EXISTS task_locks (
  plan TEXT NOT NULL,
  row TEXT NOT NULL,
  session_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (plan, row)
);
`

export type PulseTaskLock = HqTaskKey & { sessionId: string; at: number }

export function taskLockOf(core: PulseCore, key: HqTaskKey): PulseTaskLock | null {
  const row = core.db
    .prepare('SELECT session_id, at FROM task_locks WHERE plan = ? AND row = ?')
    .get(key.plan, key.row)
  return row ? { ...key, sessionId: String(row.session_id), at: Number(row.at) } : null
}

export function setTaskLock(core: PulseCore, lock: PulseTaskLock): void {
  core.db
    .prepare(
      'INSERT INTO task_locks (plan, row, session_id, at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(plan, row) DO UPDATE SET session_id = excluded.session_id, at = excluded.at'
    )
    .run(lock.plan, lock.row, lock.sessionId, lock.at)
}

/** Custom build (hq-task-lock, D1 28.11): every chat that holds a row, as stored (not followed through
 *  handoffs) — what `orca hq reassign` reads to tell a chat on a plan row from an empty launch. */
export function taskLockHolders(core: PulseCore): string[] {
  return core.db
    .prepare('SELECT DISTINCT session_id FROM task_locks')
    .all()
    .map((row) => String(row.session_id))
}

/** Custom build (hq-task-progress, C7): the plan rows held by any of these chats (the chat and where
 *  its handoffs went), oldest first. */
export function taskRowsOf(core: PulseCore, sessionIds: readonly string[]): HqTaskKey[] {
  if (sessionIds.length === 0) {
    return []
  }
  const marks = sessionIds.map(() => '?').join(', ')
  return core.db
    .prepare(`SELECT plan, row FROM task_locks WHERE session_id IN (${marks}) ORDER BY at`)
    .all(...sessionIds)
    .map((row) => ({ plan: String(row.plan), row: String(row.row) }))
}
