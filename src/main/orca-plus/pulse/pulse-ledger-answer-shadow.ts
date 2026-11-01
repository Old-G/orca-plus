// Custom build (hq-ledger-answers, plan 19.13 part 1): the ledger's own answers to waitings, kept in
// shadow beside the reply reader's — as events, so nothing the owner sees changes and no table is
// added for a comparison that lasts days. The day's line compares both by the message each took.
import type { HqLedgerAnswer, HqLedgerAnswerHow } from '../../../shared/hq-ledger'
import type { PulseCore } from './pulse-core'
import { ledgerHasSlackMessage } from './pulse-ledger'

const LEDGER_ANSWER = 'ledger.answer'
const HOWS: readonly HqLedgerAnswerHow[] = ['place', 'dm', 'pick', 'which', 'none']

export function recordLedgerAnswer(core: PulseCore, answer: HqLedgerAnswer): void {
  core.transaction(() => core.emit(LEDGER_ANSWER, 'waiting', answer.waitingId, answer))
}

function parse(payload: unknown): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(String(payload))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function listLedgerAnswers(core: PulseCore, since: number): HqLedgerAnswer[] {
  return core.db
    .prepare('SELECT payload FROM events WHERE kind = ? AND at >= ? ORDER BY seq')
    .all(LEDGER_ANSWER, since)
    .flatMap((row) => {
      const value = parse(row.payload)
      const how = value?.how
      if (
        !value ||
        typeof value.waitingId !== 'string' ||
        !HOWS.includes(how as HqLedgerAnswerHow) ||
        !Array.isArray(value.messages)
      ) {
        return []
      }
      return [
        {
          waitingId: value.waitingId,
          ts: typeof value.ts === 'string' ? value.ts : null,
          messages: value.messages.filter((ts): ts is string => typeof ts === 'string'),
          how: how as HqLedgerAnswerHow,
          at: Number(value.at) || 0
        }
      ]
    })
}

/** The reply reader's answers: every `waiting.replied` since, with whose message it took. */
export function listReaderAnswers(
  core: PulseCore,
  since: number
): { waitingId: string; ts: string; authorId: string | null }[] {
  return core.db
    .prepare(
      `SELECT entity_id, payload FROM events WHERE kind = 'waiting.replied' AND at >= ? ORDER BY seq`
    )
    .all(since)
    .flatMap((row) => {
      const value = parse(row.payload)
      return value && typeof value.replyTs === 'string'
        ? [
            {
              waitingId: String(row.entity_id),
              ts: value.replyTs,
              authorId: typeof value.replyAuthorId === 'string' ? value.replyAuthorId : null
            }
          ]
        : []
    })
}

/** The shadow's calls on one database, for PulseDb: the ledger's answers and the reader's, and
 *  whether a message the scout raised is in the ledger. */
export function pulseLedgerShadow(core: () => PulseCore) {
  return {
    record: (answer: HqLedgerAnswer) => recordLedgerAnswer(core(), answer),
    list: (since: number) => listLedgerAnswers(core(), since),
    reader: (since: number) => listReaderAnswers(core(), since),
    hasSlackMessage: (channel: string, ts: string) => ledgerHasSlackMessage(core(), channel, ts)
  }
}
