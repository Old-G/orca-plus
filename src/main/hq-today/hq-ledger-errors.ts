// Custom build (hq-ledger-sources): a ledger reader failing in silence leaves its conversations stale
// with no word anywhere, so a failure becomes one background row in the journal — the same failure at
// most once an hour. Shared by the Slack, GitLab To-Do and mail readers.
import type { HqJournalInput } from '../../shared/hq-journal'
import { HQ_JOURNAL_ALL_ROOMS } from '../../shared/hq-journal'
import { hqJobRow } from '../hq-journal/hq-journal-jobs'

const ERROR_REPEAT_MS = 60 * 60_000

/** `what` is the reader's loss in words («Slack DMs and threads not read»). */
export function hqLedgerErrorReporter(
  tag: string,
  what: string,
  record: (rows: HqJournalInput[]) => void,
  now: () => number = Date.now
): (error: unknown) => void {
  let last: { found: string; at: number } | null = null
  return (error) => {
    console.warn(`[${tag}] pass failed:`, error)
    const found = `${what}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200)
    if (last?.found === found && now() - last.at < ERROR_REPEAT_MS) {
      return
    }
    last = { found, at: now() }
    record([
      hqJobRow(
        { job: 'ledger', found },
        { room: HQ_JOURNAL_ALL_ROOMS, project: null, firm: false },
        now()
      )
    ])
  }
}
