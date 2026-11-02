// Custom build (hq-attribution-log, owner 03.11): one row per guess about a conversation's field, closed
// by the owner's choice — kept, changed or dropped. A newer guess before he chose replaces the open one;
// a guess after he chose opens a new row. Readers and the model write guesses; only his buttons write
// finals.
import {
  hqAttributionSource,
  type HqAttributionAccuracy,
  type HqAttributionEdit,
  type HqAttributionField,
  type HqAttributionGuessHow,
  type HqAttributionSlice
} from '../../../shared/hq-attribution'
import type { PulseCore } from './pulse-core'

export type HqAttributionGuess = {
  key: string
  field: HqAttributionField
  value: string | null
  how: Exclude<HqAttributionGuessHow, 'unrecorded'>
  confidence?: number | null
  why?: string | null
}

function openRow(
  core: PulseCore,
  key: string,
  field: HqAttributionField
): { id: string; guess: string | null } | null {
  const row = core.db
    .prepare(
      `SELECT id, guess FROM attribution_log
        WHERE conversation_key = ? AND field = ? AND final_at IS NULL
        ORDER BY guessed_at DESC LIMIT 1`
    )
    .get(key, field)
  return row ? { id: String(row.id), guess: row.guess == null ? null : String(row.guess) } : null
}

/** Call inside a transaction. Writes what was guessed; the same guess again changes nothing. */
export function noteAttributionGuess(core: PulseCore, guess: HqAttributionGuess): void {
  const open = openRow(core, guess.key, guess.field)
  if (open) {
    if (open.guess === guess.value) {
      // Why: the model agreeing with a rule keeps the rule as the source, and adds how sure it is.
      if (guess.confidence != null || guess.why) {
        core.db
          .prepare(
            `UPDATE attribution_log SET confidence = COALESCE(?, confidence), why = COALESCE(?, why)
              WHERE id = ?`
          )
          .run(guess.confidence ?? null, guess.why ?? null, open.id)
      }
      return
    }
    core.db
      .prepare(
        `UPDATE attribution_log SET guess = ?, guess_how = ?, confidence = ?, why = ?, guessed_at = ?
          WHERE id = ?`
      )
      .run(
        guess.value,
        guess.how,
        guess.confidence ?? null,
        guess.why ?? null,
        core.clock.now(),
        open.id
      )
    return
  }
  core.db
    .prepare(
      `INSERT INTO attribution_log
         (id, conversation_key, source, field, guess, guess_how, confidence, why, guessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      core.clock.newId(),
      guess.key,
      hqAttributionSource(guess.key),
      guess.field,
      guess.value,
      guess.how,
      guess.confidence ?? null,
      guess.why ?? null,
      core.clock.now()
    )
}

/** Call inside a transaction. The owner chose `value` for the field: the open guess is kept (same
 *  value) or changed; with no guess written, the choice is kept apart as `unrecorded`. */
export function noteAttributionFinal(
  core: PulseCore,
  key: string,
  field: HqAttributionField,
  value: string | null
): void {
  const now = core.clock.now()
  const open = openRow(core, key, field)
  if (open) {
    core.db
      .prepare(`UPDATE attribution_log SET final = ?, final_how = ?, final_at = ? WHERE id = ?`)
      .run(value, open.guess === value ? 'confirm' : 'edit', now, open.id)
    return
  }
  core.db
    .prepare(
      `INSERT INTO attribution_log
         (id, conversation_key, source, field, guess, guess_how, guessed_at, final, final_how, final_at)
       VALUES (?, ?, ?, ?, NULL, 'unrecorded', ?, ?, 'edit', ?)`
    )
    .run(core.clock.newId(), key, hqAttributionSource(key), field, now, value, now)
}

/** Call inside a transaction. The owner dropped the conversation's card: its open guesses close as
 *  skipped, so a later choice does not judge them. */
export function noteAttributionSkip(core: PulseCore, key: string): void {
  core.db
    .prepare(
      `UPDATE attribution_log SET final_how = 'skip', final_at = ?
        WHERE conversation_key = ? AND final_at IS NULL`
    )
    .run(core.clock.now(), key)
}

/** The project a conversation holds now, as a guess — unless the owner set it himself. */
export function noteConversationProjectGuess(core: PulseCore, conversationId: string): void {
  const row = core.db
    .prepare('SELECT key, project, project_how FROM conversations WHERE id = ?')
    .get(conversationId)
  if (!row || row.project_how === 'owner') {
    return
  }
  const how = row.project_how == null ? 'reader' : String(row.project_how)
  noteAttributionGuess(core, {
    key: String(row.key),
    field: 'project',
    value: row.project == null ? null : String(row.project),
    how: isGuessHow(how) ? how : 'reader'
  })
}

function isGuessHow(how: string): how is HqAttributionGuess['how'] {
  return ['rule', 'reply', 'named', 'model', 'reader', 'card'].includes(how)
}

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
  return { since, slices, topEdits }
}

export type HqAttributionTake = {
  key: string
  /** What the card proposed when he pressed «To work»: its project and chat (`new` for a new chat). */
  proposedProject: string | null
  proposedChat: string
  project: string | null
  chat: string
}

/** The owner sent a conversation to work. A guess written earlier (the ledger's, later the model's)
 *  is what gets judged; without one, the card's proposal is. Confirm = the proposed project and chat
 *  went unchanged. */
export function noteAttributionTake(core: PulseCore, take: HqAttributionTake): void {
  core.transaction(() => {
    judgeTaken(core, take.key, 'project', take.proposedProject, take.project)
    judgeTaken(core, take.key, 'chat', take.proposedChat, take.chat)
  })
}

/** One field of a take. Why (Codex 03.11): a field he already chose on the card (the project chip)
 *  was judged then; judging it again here would count one decision twice. */
function judgeTaken(
  core: PulseCore,
  key: string,
  field: HqAttributionField,
  proposed: string | null,
  chosen: string | null
): void {
  if (!openRow(core, key, field)) {
    const decided = core.db
      .prepare(
        `SELECT 1 FROM attribution_log WHERE conversation_key = ? AND field = ?
            AND final_at IS NOT NULL AND final_how != 'skip' LIMIT 1`
      )
      .get(key, field)
    if (decided) {
      return
    }
    noteAttributionGuess(core, { key, field, value: proposed, how: 'card' })
  }
  noteAttributionFinal(core, key, field, chosen)
}

/** Custom build (hq-intake-decide): the open guess of a conversation's chat, with how sure the model
 *  was and why — what its card proposes. */
export function openAttributionGuesses(
  core: PulseCore,
  key: string
): { chat: string | null; confidence: number | null; why: string | null } | null {
  const rows = core.db
    .prepare(
      `SELECT field, guess, confidence, why FROM attribution_log
        WHERE conversation_key = ? AND final_at IS NULL AND field IN ('chat', 'project')
          AND guess_how = 'model'`
    )
    .all(key)
  if (rows.length === 0) {
    return null
  }
  const of = (field: string) => rows.find((row) => row.field === field)
  const any = rows.find((row) => row.confidence != null) ?? rows[0]
  return {
    chat: of('chat')?.guess == null ? null : String(of('chat')?.guess),
    confidence: any?.confidence == null ? null : Number(any.confidence),
    why: any?.why == null ? null : String(any.why)
  }
}

/** Custom build (hq-intake-decide): the owner's latest changes to guesses in one place (a channel, a
 *  DM, a repo), one line each, for the model to learn from on the next message there. */
export function attributionHints(core: PulseCore, keyPrefix: string, limit = 8): string[] {
  return core.db
    .prepare(
      `SELECT field, guess, final FROM attribution_log
        WHERE conversation_key LIKE ? AND final_how = 'edit' AND guess_how != 'unrecorded'
        ORDER BY final_at DESC LIMIT ?`
    )
    .all(`${keyPrefix.replace(/[%_]/g, '')}%`, limit)
    .map(
      (row) =>
        `${String(row.field)}: guessed ${row.guess == null ? 'none' : String(row.guess)}, the user chose ${row.final == null ? 'none' : String(row.final)}`
    )
}
