// Custom build (hq-plus-feed-trim, owner 13.11: «UI подтормаживает»): the settled bell items HQ+'s feed
// still draws. A week of them was 3,400 rows and 5 MB sent on every pulse write — about every six
// seconds — while the feed drops any item raised and settled before the day began (hqPlusLog). Only
// those are left out here; a row the journal points at, a report and a person's answer stay whatever
// their age, because the log reads them for older rows that are still on screen.
import type { HqJournalEntry } from './hq-journal'
import type { PulseInboxItem } from './pulse-types'
import { OUTGOING_APPROVAL_BELL_KIND } from './outgoing-approval/outgoing-approval-bell'
import { HQ_WAITING_REPLY_KIND } from './hq-waiting-reply-bell'
import { HQ_REPORT_BELL_KIND } from './hq-reports'

/** Kinds the log reads whole: a newer report supersedes an older one; an answer hides its journal line. */
const KEEP_KINDS: ReadonlySet<string> = new Set([HQ_REPORT_BELL_KIND, HQ_WAITING_REPLY_KIND])

/** `settledSince` undefined keeps every item (the phone and older callers). */
export function hqPlusFeedInbox(
  inbox: readonly PulseInboxItem[],
  entries: readonly HqJournalEntry[],
  settledSince: number | undefined
): PulseInboxItem[] {
  if (settledSince === undefined) {
    return [...inbox]
  }
  const byId = new Set<string>()
  const byRef = new Set<string>()
  for (const entry of entries) {
    if (entry.refId) {
      byRef.add(entry.refId)
      if (entry.refKind === 'inbox') {
        byId.add(entry.refId)
      }
    }
  }
  return inbox.filter(
    (item) =>
      item.doneAt === null ||
      item.createdAt >= settledSince ||
      item.doneAt >= settledSince ||
      KEEP_KINDS.has(item.kind) ||
      byId.has(item.id) ||
      (item.kind === OUTGOING_APPROVAL_BELL_KIND && item.refId !== null && byRef.has(item.refId))
  )
}
