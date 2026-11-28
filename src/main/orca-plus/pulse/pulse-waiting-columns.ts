// Custom build (pulse-next, C1): columns added to `waitings` outside the versioned steps.
import type Database from '../../sqlite/sync-database'

/** `next_action`: what to do once the answer comes (`pulse wait add --next`).
 *  Why outside STEPS: an added column needs no version bump, so the build before this one still opens
 *  the file (a newer user_version is refused); it reads rows with SELECT * and ignores the column. */
export function ensureWaitingNextColumn(db: Database.Database): void {
  const have = new Set(
    db
      .prepare('PRAGMA table_info(waitings)')
      .all()
      .map((row) => (row as { name?: unknown }).name)
  )
  if (!have.has('next_action')) {
    db.exec('ALTER TABLE waitings ADD COLUMN next_action TEXT')
  }
  // Custom build (pulse-wake, C2): `pulse wait add --wake` — the person's answer brings the chat back.
  if (!have.has('wake')) {
    db.exec('ALTER TABLE waitings ADD COLUMN wake INTEGER')
  }
}
