// Custom build (t8b-feed-sql): hqPlusFeedInbox's rule as a WHERE clause, so HQ+'s feed reads only the
// settled bell items it draws — not a week of them (4,400 rows, ~70 ms on every reload).
import type { HqPlusFeedKeep } from '../../../shared/hq-plus-feed-inbox'

export function inboxFeedKeepSql(keep: HqPlusFeedKeep): { sql: string; args: (string | number)[] } {
  return {
    sql: `(done_at IS NULL OR created_at >= ? OR done_at >= ?
      OR kind IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?))
      OR (kind = ? AND ref_id IN (SELECT value FROM json_each(?))))`,
    args: [
      keep.settledSince,
      keep.settledSince,
      JSON.stringify(keep.kinds),
      JSON.stringify(keep.ids),
      keep.refKind,
      JSON.stringify(keep.refIds)
    ]
  }
}
