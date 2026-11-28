// Custom build (pulse-next, C1): columns added to `waitings` outside the versioned steps.
import type Database from '../../sqlite/sync-database'

/** `next_action`: what to do once the answer comes (`pulse wait add --next`).
 *  Why outside STEPS: an added column needs no version bump, so the build before this one still opens
 *  the file (a newer user_version is refused); it reads rows with SELECT * and ignores the column. */
export function ensureWaitingNextColumn(db: Database.Database): void {
  const have = db
    .prepare('PRAGMA table_info(waitings)')
    .all()
    .some((row) => (row as { name?: unknown }).name === 'next_action')
  if (!have) {
    db.exec('ALTER TABLE waitings ADD COLUMN next_action TEXT')
  }
}
