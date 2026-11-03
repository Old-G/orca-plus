// Custom build (hq-ledger-draft, plan 20.9 step 1): what the scout's card gave and the ledger's did not —
// the card's kind for the person's newest message, what they want in a line, and a reply in the owner's
// words. Kept as events, not a table: an older build opens the database as it is (no schema step to
// roll back), and the day's count is read from the same rows.
import type { PulseCore } from './pulse-core'
import { noteAttributionGuess } from './pulse-attribution'
import { HQ_ATTRIBUTION_KINDS, type HqAttributionKind } from '../../../shared/hq-attribution'

export const LEDGER_DRAFT_EVENT = 'conversation.draft'
/** A conversation's `state_why` once its newest message was read as for information. */
export const LEDGER_DRAFT_QUIET = 'draft:fyi'

export type HqLedgerDraft = {
  /** The person's message it answers; a newer one wants a new draft. */
  lastTs: string
  kind: HqAttributionKind
  /** What they want from the owner, one line. */
  ask: string
  /** The reply in the owner's words; null when there is nothing to say back yet (a task to do). */
  draft: string | null
}

function readDraft(payload: unknown): HqLedgerDraft | null {
  let raw: unknown
  try {
    raw = typeof payload === 'string' ? JSON.parse(payload) : null
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const lastTs = Reflect.get(raw, 'lastTs')
  const kind = Reflect.get(raw, 'kind')
  const ask = Reflect.get(raw, 'ask')
  const draft = Reflect.get(raw, 'draft')
  return typeof lastTs === 'string' &&
    (HQ_ATTRIBUTION_KINDS as readonly unknown[]).includes(kind) &&
    typeof ask === 'string'
    ? {
        lastTs,
        kind: kind as HqAttributionKind,
        ask,
        draft: typeof draft === 'string' && draft.trim() ? draft : null
      }
    : null
}

export type HqLedgerDrafts = ReturnType<typeof pulseLedgerDrafts>

export function pulseLedgerDrafts(core: () => PulseCore) {
  return {
    set: (conversationId: string, draft: HqLedgerDraft): void =>
      core().transaction(() =>
        core().emit(LEDGER_DRAFT_EVENT, 'conversation', conversationId, draft)
      ),
    /** The newest draft of a conversation, whatever message it answers. */
    of: (conversationId: string): HqLedgerDraft | null => {
      const row = core()
        .db.prepare(
          'SELECT payload FROM events WHERE kind = ? AND entity_id = ? ORDER BY seq DESC LIMIT 1'
        )
        .get(LEDGER_DRAFT_EVENT, conversationId)
      return row ? readDraft(row.payload) : null
    },
    /** Custom build (hq-ledger-draft, 03.11: 3 of 8 «your move» cards were thanks): the newest message
     *  read as for information takes the talk off the owner — a state guess like «in work», so his
     *  «it was mine» is counted. A newer message from the person makes it his move again. */
    quiet: (conversationId: string, lastTs: string, why: string): boolean =>
      core().transaction(() => {
        // Why (Codex 03.11): a request said while the model read the thanks before it stays his move.
        const row = core()
          .db.prepare(
            `SELECT key FROM conversations c WHERE id = ? AND state = 'you'
               AND (SELECT ts FROM conversation_messages m WHERE m.conversation_id = c.id
                     AND m.direction = 'in' AND m.ts NOT LIKE 'req:%'
                     ORDER BY m.at DESC, m.ts DESC LIMIT 1) = ?`
          )
          .get(conversationId, lastTs)
        if (!row) {
          return false
        }
        core()
          .db.prepare(`UPDATE conversations SET state = 'fyi', state_why = ? WHERE id = ?`)
          .run(LEDGER_DRAFT_QUIET, conversationId)
        noteAttributionGuess(core(), {
          key: String(row.key),
          field: 'state',
          value: 'fyi',
          how: 'model',
          why
        })
        core().emit('conversation.updated', 'conversation', conversationId, { state: 'fyi' })
        return true
      }),
    /** The talk's last lines, both ways, oldest first — a scout's request line is its summary, not
     *  something said. */
    lines: (
      conversationId: string,
      limit = 12
    ): { fromOwner: boolean; author: string | null; text: string }[] =>
      core()
        .db.prepare(
          `SELECT direction, author, text FROM conversation_messages
            WHERE conversation_id = ? AND ts NOT LIKE 'req:%'
            ORDER BY at DESC, ts DESC LIMIT ?`
        )
        .all(conversationId, limit)
        .map((row) => ({
          fromOwner: row.direction === 'out',
          author: row.author == null ? null : String(row.author),
          text: String(row.text)
        }))
        .toReversed(),
    /** Drafts written since `since` — the day's budget survives a restart. */
    madeSince: (since: number): number =>
      Number(
        core()
          .db.prepare('SELECT COUNT(*) n FROM events WHERE kind = ? AND at >= ?')
          .get(LEDGER_DRAFT_EVENT, since)?.n ?? 0
      ),
    /** The Slack conversation that holds a message — by its place, or a DM talk keyed by its first
     *  line — with its newest kind (the draft's, else the model's decision) and whether it has a draft;
     *  for the day's line beside the scout's cards. */
    kindOfSlack: (
      channel: string,
      ts: string
    ): { kind: HqAttributionKind | null; drafted: boolean } | null => {
      const db = core().db
      const row = db
        .prepare(
          `SELECT id, key FROM conversations WHERE key = ?
           UNION ALL
           SELECT c.id, c.key FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
            WHERE c.key LIKE ? AND m.ts = ? LIMIT 1`
        )
        .get(`slack:${channel}:${ts}`, `slack:${channel}:%`, ts)
      if (!row) {
        return null
      }
      const draft = readDraft(
        db
          .prepare(
            'SELECT payload FROM events WHERE kind = ? AND entity_id = ? ORDER BY seq DESC LIMIT 1'
          )
          .get(LEDGER_DRAFT_EVENT, String(row.id))?.payload
      )
      const decided = db
        .prepare(
          `SELECT coalesce(final, guess) kind FROM attribution_log
            WHERE conversation_key = ? AND field = 'kind' ORDER BY guessed_at DESC LIMIT 1`
        )
        .get(String(row.key))?.kind
      const kind = draft?.kind ?? decided
      return {
        kind: (HQ_ATTRIBUTION_KINDS as readonly unknown[]).includes(kind)
          ? (kind as HqAttributionKind)
          : null,
        drafted: draft?.draft != null
      }
    }
  }
}
