// Custom build (hq-attribution-log, owner 03.11): the guess → final log counted — per source and field
// what was kept, changed or skipped, how many cards needed a change, what he changes most and why —
// and his latest changes in one place, for the model's next guess there.
import type {
  HqAttributionAccuracy,
  HqAttributionEdit,
  HqAttributionField,
  HqAttributionSlice
} from '../../../shared/hq-attribution'
import type { PulseCore } from './pulse-core'

/** Kept, changed and dropped guesses since `since`, by source and field, and the most common changes. */
export function attributionAccuracy(core: PulseCore, since: number): HqAttributionAccuracy {
  const slices: HqAttributionSlice[] = core.db
    .prepare(
      `SELECT source, field,
              SUM(final_how = 'confirm') confirmed,
              SUM(final_how = 'edit') edited,
              SUM(final_how = 'skip') skipped
         FROM attribution_log
        WHERE final_at >= ? AND guess_how != 'unrecorded'
        GROUP BY source, field ORDER BY source, field`
    )
    .all(since)
    .map((row) => {
      const confirmed = Number(row.confirmed ?? 0)
      const edited = Number(row.edited ?? 0)
      const decided = confirmed + edited
      return {
        source: String(row.source),
        field: String(row.field) as HqAttributionField,
        decided,
        confirmed,
        edited,
        skipped: Number(row.skipped ?? 0),
        rate: decided > 0 ? confirmed / decided : null
      }
    })
  const topEdits: HqAttributionEdit[] = core.db
    .prepare(
      `SELECT source, field, guess, final, COUNT(*) n FROM attribution_log
        WHERE final_at >= ? AND final_how = 'edit' AND guess_how != 'unrecorded'
        GROUP BY source, field, guess, final ORDER BY n DESC, source LIMIT 10`
    )
    .all(since)
    .map((row) => ({
      source: String(row.source),
      field: String(row.field) as HqAttributionField,
      guess: row.guess == null ? null : String(row.guess),
      final: row.final == null ? null : String(row.final),
      count: Number(row.n)
    }))
  // Custom build (owner 03.11): a card is wrong when he changed at least one of its fields.
  const cards = core.db
    .prepare(
      `SELECT COUNT(*) decided, SUM(edits > 0) wrong FROM (
         SELECT conversation_key, SUM(final_how = 'edit') edits FROM attribution_log
          WHERE final_at >= ? AND final_how IN ('confirm', 'edit') AND guess_how != 'unrecorded'
          GROUP BY conversation_key)`
    )
    .get(since)
  const whys = core.db
    .prepare(
      `SELECT source, field, owner_why FROM attribution_log
        WHERE final_at >= ? AND owner_why IS NOT NULL ORDER BY final_at DESC LIMIT 10`
    )
    .all(since)
    .map((row) => ({
      source: String(row.source),
      field: String(row.field) as HqAttributionField,
      text: String(row.owner_why)
    }))
  return {
    since,
    cards: { decided: Number(cards?.decided ?? 0), wrong: Number(cards?.wrong ?? 0) },
    slices,
    topEdits,
    whys
  }
}

/** Custom build (hq-intake-decide): the owner's latest changes to guesses in one place (a channel, a
 *  DM, a repo), one line each, for the model to learn from on the next message there. */
export function attributionHints(core: PulseCore, keyPrefix: string, limit = 8): string[] {
  return core.db
    .prepare(
      `SELECT field, guess, final, owner_why FROM attribution_log
        WHERE conversation_key LIKE ? AND final_how = 'edit' AND guess_how != 'unrecorded'
        ORDER BY final_at DESC LIMIT ?`
    )
    .all(`${keyPrefix.replace(/[%_]/g, '')}%`, limit)
    .map(
      (row) =>
        `${String(row.field)}: guessed ${row.guess == null ? 'none' : String(row.guess)}, the user chose ${row.final == null ? 'none' : String(row.final)}${row.owner_why == null ? '' : ` — his reason: ${String(row.owner_why).replace(/\s+/g, ' ').slice(0, 160)}`}`
    )
}
